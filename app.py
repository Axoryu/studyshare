"""
StudyShare — a minimal homework & classwork sharing site.
Flask + Supabase Storage (files) + Supabase PostgreSQL (metadata).
No accounts, no login. No SQLite.

Every uploaded image/PDF goes straight to the Supabase Storage bucket
"uploads". Metadata (title, subject, file_url, upload_date) is stored in
and read from the Supabase PostgreSQL "files" table via the PostgREST API
that supabase-py exposes through supabase.table(...).
"""

import os
from dotenv import load_dotenv
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

load_dotenv()

from flask import (
    Flask, render_template, request, redirect, url_for,
    jsonify, abort, flash
)
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "pdf"}
MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25 MB per upload

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_BUCKET = "uploads"
SUPABASE_TABLE  = "files"

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
# File-type helpers
# ---------------------------------------------------------------------------

def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[-1].lower() in ALLOWED_EXTENSIONS
    )


def ext_from_url(url):
    """Return the lowercase file extension from a Supabase Storage URL."""
    # Strip any query string (?download=...) then grab the part after the
    # last dot.  Falls back to empty string if there is no dot.
    path = url.split("?")[0]
    return path.rsplit(".", 1)[-1].lower() if "." in path.split("/")[-1] else ""


def file_type_from_url(url):
    """Derive 'image' or 'pdf' from the extension embedded in the URL."""
    ext = ext_from_url(url)
    if ext in {"jpg", "jpeg", "png", "webp"}:
        return "image"
    if ext == "pdf":
        return "pdf"
    return "image"  # safe visual fallback


def content_type_for(ext):
    return {
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "png":  "image/png",
        "webp": "image/webp",
        "pdf":  "application/pdf",
    }.get(ext, "application/octet-stream")


# ---------------------------------------------------------------------------
# Supabase Storage helpers  (unchanged from previous version)
# ---------------------------------------------------------------------------

def upload_to_supabase(file_storage, subject_slug):
    """
    Uploads a Werkzeug FileStorage object straight to Supabase Storage
    (no local disk involved) and returns the public URL of the object.
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
    except Exception as exc:
        raise RuntimeError(f"Storage upload failed: {exc}") from exc

    file_url = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(storage_path)
    return file_url


def build_download_url(file_url, title):
    """
    Appends Supabase's ?download=<filename> param so the browser forces a
    download with a human-readable name (title + original extension) instead
    of the raw UUID filename.
    """
    ext = ext_from_url(file_url)
    # Build a safe filename from the title — keep alphanumeric, spaces, hyphens.
    safe_title = "".join(
        c if c.isalnum() or c in " -_" else "_" for c in title
    ).strip() or "file"
    download_name = f"{safe_title}.{ext}" if ext else safe_title
    separator = "&" if "?" in file_url else "?"
    return f"{file_url}{separator}download={quote(download_name)}"


# ---------------------------------------------------------------------------
# Supabase PostgreSQL helpers
# ---------------------------------------------------------------------------

def insert_file_row(title, subject_slug, file_url):
    """
    Inserts one row into the Supabase PostgreSQL "files" table.
    Columns: title, subject, file_url, upload_date.
    Raises RuntimeError on failure.
    """
    try:
        supabase.table(SUPABASE_TABLE).insert({
            "title":       title,
            "subject":     subject_slug,
            "file_url":    file_url,
            "upload_date": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:
        raise RuntimeError(f"Database insert failed: {exc}") from exc


def row_to_dict(row):
    """
    Converts a raw PostgREST row dict (from supabase.table().select()) into
    the shape that templates and the search JSON response expect.

    Supabase PG columns:  id, title, subject, file_url, upload_date
    Added computed keys:  subject_slug, subject_name, file_type,
                          download_url, uploaded_display
    """
    d = dict(row)

    # The Supabase table uses "subject" for what the templates call
    # "subject_slug" (the URL-safe identifier, e.g. "hindi-r").
    # Expose both so templates and the JS search handler work unchanged.
    d["subject_slug"] = d.get("subject", "")

    d["subject_name"] = SUBJECT_BY_SLUG.get(
        d["subject_slug"], {}
    ).get("name", d["subject_slug"])

    # Derive file type from the URL extension — no separate DB column needed.
    d["file_type"] = file_type_from_url(d.get("file_url", ""))

    # Build a forced-download URL using the file title as the filename.
    d["download_url"] = build_download_url(d.get("file_url", ""), d.get("title", "file"))

    # Format upload_date (Postgres ISO timestamp) into a friendly display string.
    try:
        raw = d.get("upload_date") or ""
        # Postgres may return "2026-06-30T10:25:42+00:00" or "...Z" or no tz.
        raw = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        d["uploaded_display"] = dt.strftime("%d %b %Y")
    except Exception:
        d["uploaded_display"] = d.get("upload_date", "")

    return d


# ---------------------------------------------------------------------------
# Routes — pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    # Fetch just the subject column for every row so we can count per-subject
    # in Python. PostgREST doesn't expose GROUP BY, and with ~10 users the
    # total row count will always be small.
    try:
        result = supabase.table(SUPABASE_TABLE).select("subject").execute()
        rows = result.data or []
    except Exception:
        rows = []

    counts = {}
    for r in rows:
        slug = r.get("subject", "")
        counts[slug] = counts.get(slug, 0) + 1

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

    try:
        result = (
            supabase.table(SUPABASE_TABLE)
            .select("*")
            .eq("subject", slug)
            .order("upload_date", desc=True)
            .execute()
        )
        rows = result.data or []
    except Exception:
        rows = []

    files = [row_to_dict(r) for r in rows]
    return render_template(
        "subject.html", subject=subject, files=files, subjects=SUBJECTS
    )


# ---------------------------------------------------------------------------
# Routes — upload
# ---------------------------------------------------------------------------

@app.route("/upload", methods=["POST"])
def upload_file():
    title        = (request.form.get("title")   or "").strip()
    subject_slug = (request.form.get("subject") or "").strip()
    file         = request.files.get("file")

    # --- Validation ---
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

    # --- Upload file bytes to Supabase Storage ---
    try:
        file_url = upload_to_supabase(file, subject_slug)
    except RuntimeError as exc:
        errors = [str(exc)]
        if request.headers.get("X-Requested-With") == "fetch":
            return jsonify({"ok": False, "errors": errors}), 502
        for e in errors:
            flash(e)
        return redirect(request.referrer or url_for("index"))

    # --- Insert metadata row into Supabase PostgreSQL ---
    try:
        insert_file_row(title, subject_slug, file_url)
    except RuntimeError as exc:
        errors = [str(exc)]
        if request.headers.get("X-Requested-With") == "fetch":
            return jsonify({"ok": False, "errors": errors}), 502
        for e in errors:
            flash(e)
        return redirect(request.referrer or url_for("index"))

    if request.headers.get("X-Requested-With") == "fetch":
        return jsonify({"ok": True, "subject_slug": subject_slug})

    return redirect(url_for("subject_page", slug=subject_slug))


# ---------------------------------------------------------------------------
# Routes — search  (JSON API consumed by main.js for instant results)
# ---------------------------------------------------------------------------

@app.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": []})

    try:
        result = (
            supabase.table(SUPABASE_TABLE)
            .select("*")
            .ilike("title", f"%{q}%")
            .order("upload_date", desc=True)
            .limit(30)
            .execute()
        )
        rows = result.data or []
    except Exception:
        rows = []

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
    port = int(os.getenv("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=True)
