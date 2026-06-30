# StudyShare

A minimal, dark-themed website for a small class to upload, browse, search, and
download classwork/homework images and PDFs. No accounts, no login — anyone
with the link can use it.

## Stack

- Flask (Python) backend
- SQLite database (metadata only — auto-created on first run)
- **Supabase Storage** for the actual image/PDF files (so uploads survive
  Render redeploys/restarts, unlike local disk storage)
- Plain HTML / CSS / JavaScript frontend (no build step)

## Supabase setup (one-time)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **Storage** → create a new bucket named exactly `uploads`, and set
   it to **Public** (so images/PDFs can be viewed and downloaded directly by
   URL, with no login).
3. Go to **Project Settings → API** and copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (or anon key, if you keep the bucket public and
     don't need elevated upload permissions) → this is `SUPABASE_KEY`

## Environment variables

The app reads these from the environment — it will refuse to start without
them:

```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-key
```

For local development, copy `.env.example` to `.env`, fill in your values,
and load it before running (e.g. `export $(cat .env | xargs)` on macOS/Linux,
or use a tool like `python-dotenv` / your IDE's run config on Windows).

On **Render**, set both as Environment Variables in your service's
Settings → Environment tab — do not commit real keys to the repo.

## Setup

1. Install Python 3.9+.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set `SUPABASE_URL` and `SUPABASE_KEY` (see above).
4. Run the app:

   ```bash
   python app.py
   ```

5. Open `http://localhost:5050` in your browser.

The SQLite database (`instance/studyshare.db`) is created automatically the
first time the app runs and stores file metadata — titles, subjects, upload
dates, and each file's public Supabase URL. It's excluded from version
control on purpose.

## How file storage works

- On upload, the file is sent directly to the Supabase Storage bucket
  `uploads`, under a path like `physics/<random-id>.jpg` — no file ever
  touches the server's local disk.
- SQLite stores the public URL Supabase returns (`file_url`), plus the
  original filename, title, subject, and upload date.
- Images display directly from their Supabase public URL (`<img src="...">`)
  and open full-size in the lightbox from that same URL.
- PDFs open directly from their Supabase public URL in a new browser tab.
- The Download button links to the Supabase URL with a `?download=filename`
  query param, which Supabase Storage uses to force a real download with the
  original filename — no extra backend route is needed.

This means Render's ephemeral filesystem is no longer a problem: redeploys
and restarts no longer wipe uploaded files, since none of them ever lived on
Render's disk in the first place.

## Project structure

```
studyshare/
├── app.py                 # Flask app: routes, Supabase upload, search API
├── requirements.txt
├── .env.example             # Template for local SUPABASE_URL / SUPABASE_KEY
├── instance/                # SQLite database lives here (auto-created)
├── static/
│   ├── css/style.css         # All styling (dark glassmorphism theme) — unchanged
│   └── js/main.js            # Search, upload modal, lightbox — unchanged
└── templates/
    ├── base.html             # Header, search, upload modal, footer — unchanged
    ├── index.html            # Homepage — subject grid — unchanged
    ├── subject.html           # Per-subject file list — now links to Supabase URLs
    └── 404.html
```

## Notes

- Subjects are a fixed list defined in `app.py` (`SUBJECTS`) — Physics,
  Chemistry, Biology, History, Civics, Economics, Geography, Hindi R,
  Hindi Gr, English R, English Gr, Computer.
- Accepted upload types: JPG, JPEG, PNG, WEBP, PDF — up to 25 MB each.
- Search matches only the file title, and updates as you type.
- If you're upgrading an older deployment that used local file storage, the
  SQLite schema is migrated automatically on startup (the old
  `stored_filename` column is renamed to `file_url`). However, any rows from
  before this change held a local filename, not a real URL, and the files
  themselves are already gone (Render's local disk was never persistent). The
  old rows will show broken previews/downloads — easiest fix is to delete
  `instance/studyshare.db` once on Render so the table starts fresh, then
  have everyone re-upload their files into Supabase.
