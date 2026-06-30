# StudyShare

A minimal, dark-themed website for a small class to upload, browse, search, and
download classwork/homework images and PDFs. No accounts, no login — anyone
with the link can use it.

## Stack

- Flask (Python) backend
- SQLite database (auto-created on first run)
- Local file storage in `uploads/`
- Plain HTML / CSS / JavaScript frontend (no build step)

## Setup

1. Install Python 3.9+.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Run the app:

   ```bash
   python app.py
   ```

4. Open `http://localhost:5050` in your browser.

The SQLite database (`instance/studyshare.db`) and the `uploads/` folder are
created automatically the first time the app runs. Both are excluded from
version control on purpose — they hold your live data.

## Using it on your local network

Since there are no accounts, the simplest setup for ~10 students is running
this on one laptop/server and sharing the local network address
(`http://<your-ip>:5050`) with the group. The app already binds to
`0.0.0.0`, so it's reachable from other devices on the same network.

For anything beyond casual local use, run it behind a real WSGI server
(e.g. `gunicorn app:app`) instead of the Flask dev server, and put it behind
a reverse proxy (e.g. Nginx) if you expose it to the internet.

## Project structure

```
studyshare/
├── app.py                 # Flask app: routes, upload handling, search API
├── requirements.txt
├── instance/               # SQLite database lives here (auto-created)
├── uploads/                 # Uploaded files live here (auto-created)
├── static/
│   ├── css/style.css         # All styling (dark glassmorphism theme)
│   └── js/main.js            # Search, upload modal, lightbox behaviour
└── templates/
    ├── base.html             # Header, search, upload modal, footer
    ├── index.html            # Homepage — subject grid
    ├── subject.html          # Per-subject file list
    └── 404.html
```

## Notes

- Subjects are a fixed list defined in `app.py` (`SUBJECTS`) — Physics,
  Chemistry, Biology, History, Civics, Economics, Geography, Hindi R,
  Hindi Gr, English R, English Gr, Computer. Add or rename subjects there
  if your class list changes; existing uploaded files keep their subject
  by slug, so renaming a subject's `slug` will orphan old files — change
  `name`/`tag` freely, but treat `slug` as permanent once files exist.
- Accepted upload types: JPG, JPEG, PNG, WEBP, PDF — up to 25 MB each.
- Search matches only the file title, and updates as you type.
- Images open in a full-size lightbox on click; PDFs open in a new browser
  tab (most browsers render PDFs inline) before downloading.
