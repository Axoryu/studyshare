"""
StudyShare — a minimal homework & classwork sharing site.
Flask + SQLite (metadata) + Supabase Storage (file bytes). No accounts, no login.

Storage backend: every uploaded image/PDF is sent straight to a Supabase
Storage bucket called "uploads". SQLite only stores the file's metadata and
its public Supabase URL (file_url) — it no longer touches the local disk for
files, which keeps everything intact across Render redeploys/restarts.
"""

import os
from dotenv import load_dotenv
import uuid
from datetime import datetime
from urllib.parse import quote

load_dotenv()

import sqlite3
from flask import (
    Flask, render_template, request, redirect, url_for,
    jsonify, abort, flash
)
from supabase import create_client, Client


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "instance", "studyshare.db")

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "pdf"}
MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25 MB per upload

# --- Supabase Storage ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = "uploads"

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_KEY must be set as environment variables "
        "(Render → your service → Environment)."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Fixed subject list — slug, display name, short label for the tile mark.
SUBJECTS = [
    {"slug": "physics",     "name": "Physics",     "tag": "PHY"},
    {"slug": "chemistry",   "name": "Chemistry",   "tag": "CHM"},
    {"slug": "biology",     "name": "Biology",     "tag": "BIO"},
    {"slug": "history",     "name": "History",     "tag": "HIS"},
    {"slug": "civics",      "name": "Civics",      "tag": "CIV"},
    {"slug": "economics",   "name": "Economics",   "tag": "ECO"},
    {"slug": "geography",   "name": "Geography",   "tag": "GEO"},
    {"slug": "hindi-r",     "name": "Hindi R",     "tag": "HN-R"},
    {"slug": "hindi-gr",    "name": "Hindi Gr",    "tag": "HN-G"},
    {"slug": "english-r",   "name": "English R",   "tag": "EN-R"},
    {"slug": "english-gr",  "name": "English Gr",  "tag": "EN-G"},
    {"slug": "computer",    "name": "Computer",    "tag": "CMP"},
]
SUBJECT_BY_SLUG = {s["slug"]: s for s in SUBJECTS}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.secret_key = "studyshare-local-secret"  # only used for flash messages


@app.context_processor
def inject_subjects():
    # Makes the full subject list available in every template (for the
    # upload modal's subject dropdown and the subject nav chips).
    return {"SUBJECTS": SUBJECTS}


# ---------------------------------------------------------------------------
# Database helpers (SQLite — unchanged storage engine, just a new column)
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject_slug TEXT NOT NULL,
            file_url TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            file_type TEXT NOT NULL,        -- 'image' or 'pdf'
            uploaded_at TEXT NOT NULL
        )
    """)

    # Migration safety net: if an older database from before the Supabase
    # switch is still around, it will have "stored_filename" instead of
    # "file_url". Rename the column in place rather than dropping data.
    existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(files)")}
    if "stored_filename" in existing_cols and "file_url" not in existing_cols:
        conn.execute("ALTER TABLE files RENAME COLUMN stored_filename TO file_url")

    conn.commit()
    conn.close()


def file_type_for(filename):
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext in {"jpg", "jpeg", "png", "webp"}:
        return "image"
    if ext == "pdf":
        return "pdf"
    return None


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[-1].lower() in ALLOWED_EXTENSIONS
    )


def content_type_for(ext):
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "pdf": "application/pdf",
    }.get(ext, "application/octet-stream")


def upload_to_supabase(file_storage, subject_slug):
    """
    Uploads a Werkzeug FileStorage object straight to Supabase Storage
    (no local disk involved) and returns (file_url, stored_path).
    Raises RuntimeError on failure.
    """
    ext = file_storage.filename.rsplit(".", 1)[-1].lower()
    storage_path = f"{subject_slug}/{uuid.uuid4().hex}.{ext}"
    file_bytes = file_storage.read()

    try:
        supabase.storage.from_(SUPABASE_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": content_type_for(ext)},
        )
    except Exception as exc:  # supabase-py raises its own StorageException
        raise RuntimeError(f"Supabase upload failed: {exc}") from exc

    file_url = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(storage_path)
    return file_url, storage_path


def build_download_url(file_url, original_filename):
    """
    Supabase's public object endpoint honors a `download` query param that
    forces Content-Disposition: attachment with the given filename, so the
    Download button can link straight to Supabase — no proxy route needed.
    """
    separator = "&" if "?" in file_url else "?"
    return f"{file_url}{separator}download={quote(original_filename)}"


def row_to_dict(row):
    d = dict(row)
    d["subject_name"] = SUBJECT_BY_SLUG.get(d["subject_slug"], {}).get("name", d["subject_slug"])
    d["download_url"] = build_download_url(d["file_url"], d["original_filename"])
    # Friendly date e.g. "12 Jun 2026"
    try:
        dt = datetime.fromisoformat(d["uploaded_at"])
        d["uploaded_display"] = dt.strftime("%d %b %Y")
    except Exception:
        d["uploaded_display"] = d["uploaded_at"]
    return d


# ---------------------------------------------------------------------------
# Routes — pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    conn = get_db()
    counts_rows = conn.execute(
        "SELECT subject_slug, COUNT(*) as cnt FROM files GROUP BY subject_slug"
    ).fetchall()
    conn.close()
    counts = {r["subject_slug"]: r["cnt"] for r in counts_rows}
    subjects = []
    for s in SUBJECTS:
        item = dict(s)
        item["count"] = counts.get(s["slug"], 0)
        subjects.append(item)
    return render_template("index.html", subjects=subjects)


@app.route("/subject/<slug>")
def subject_page(slug):
    subject = SUBJECT_BY_SLUG.get(slug)
    if not subject:
        abort(404)
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM files WHERE subject_slug = ? ORDER BY uploaded_at DESC",
        (slug,),
    ).fetchall()
    conn.close()
    files = [row_to_dict(r) for r in rows]
    return render_template(
        "subject.html", subject=subject, files=files, subjects=SUBJECTS
    )


# ---------------------------------------------------------------------------
# Routes — upload (now goes straight to Supabase Storage, no local disk)
# ---------------------------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload_file():
    title = (request.form.get("title") or "").strip()
    subject_slug = (request.form.get("subject") or "").strip()
    file = request.files.get("file")

    errors = []
    if not title:
        errors.append("Title is required.")
    if subject_slug not in SUBJECT_BY_SLUG:
        errors.append("Please choose a valid subject.")
    if not file or file.filename == "":
        errors.append("Please choose a file to upload.")
    elif not allowed_file(file.filename):
        errors.append("Only JPG, PNG, WEBP, or PDF files are allowed.")

    if errors:
        if request.headers.get("X-Requested-With") == "fetch":
            return jsonify({"ok": False, "errors": errors}), 400
        for e in errors:
            flash(e)
        return redirect(request.referrer or url_for("index"))

    ftype = file_type_for(file.filename)
    safe_original = file.filename  # only used as a display/download name

    try:
        file_url, _storage_path = upload_to_supabase(file, subject_slug)
    except RuntimeError as exc:
        errors = [str(exc)]
        if request.headers.get("X-Requested-With") == "fetch":
            return jsonify({"ok": False, "errors": errors}), 502
        for e in errors:
            flash(e)
        return redirect(request.referrer or url_for("index"))

    uploaded_at = datetime.utcnow().isoformat()

    conn = get_db()
    conn.execute(
        """INSERT INTO files
           (title, subject_slug, file_url, original_filename, file_type, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (title, subject_slug, file_url, safe_original, ftype, uploaded_at),
    )
    conn.commit()
    conn.close()

    if request.headers.get("X-Requested-With") == "fetch":
        return jsonify({"ok": True, "subject_slug": subject_slug})

    return redirect(url_for("subject_page", slug=subject_slug))


# ---------------------------------------------------------------------------
# Routes — search (JSON API, used for instant global search)
# ---------------------------------------------------------------------------

@app.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": []})
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM files WHERE title LIKE ? ORDER BY uploaded_at DESC LIMIT 30",
        (f"%{q}%",),
    ).fetchall()
    conn.close()
    results = [row_to_dict(r) for r in rows]
    return jsonify({"results": results})


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.errorhandler(404)
def not_found(e):
    return render_template("404.html"), 404


@app.errorhandler(413)
def too_large(e):
    return jsonify({"ok": False, "errors": ["File is too large. Max size is 25 MB."]}), 413


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=True)
else:
    init_db()
