# France Article Map

A map of France for pinning article links by location, date, tags, and a
circle radius. Runs two ways from one codebase:

- **Locally**, as a Node/Express app backed by SQLite, where you can add and
  delete articles through the UI.
- **On GitHub Pages** (`https://xavierdpt.github.io/lafranceenliens/`), as a
  static, read-only snapshot of the same data. Since a static site can't
  write to a database, visitors "submit" new articles by opening a GitHub
  issue, which gets reviewed and imported later.

## Project layout

| Path | What it is |
| --- | --- |
| `server.js`, `db.js` | The local Express server and SQLite schema/connection. |
| `public/` | Frontend for the local server — full add/delete UI, talks to the `/api/*` routes. |
| `data.sqlite` | The source-of-truth database. Tracked in git. |
| `lib/articles.js` | Validation and insert logic shared by the server and the issue-import script. |
| `web-static/` | Template for the GitHub Pages frontend — same form/filter UI, but read-only and backed by a static JSON file instead of an API. |
| `docs/` | **Generated.** The actual GitHub Pages site (`index.html`, `app.js`, `style.css`, `data.json`), built from `web-static/` + `data.sqlite`. This is what's published. |
| `scripts/build.js` | Regenerates `docs/` from `data.sqlite` + `web-static/`. |
| `scripts/import-issues.js` | Scans GitHub issues for pending submissions and imports valid ones into `data.sqlite`. |
| `.github/ISSUE_TEMPLATE/` | The issue template submissions use (and that the static site's form pre-fills). |

## Running locally

```
npm install
npm start
```

Open `http://localhost:3000`. You can add articles (with tags, a location
picked by clicking the map, and a radius) and delete them; everything is
written straight to `data.sqlite`.

## GitHub Pages

The Pages site is configured (repo Settings → Pages) to serve the `docs/`
folder from the `main` branch — no CI, no build step on GitHub's side.
Publishing a change means committing an already-built `docs/` and pushing.

The static site has no server, so its "Submit an article" form doesn't save
anything directly. Submitting it:

1. Builds a formatted issue body from the form fields.
2. Shows it in a copyable text box, and offers a pre-filled
   "Open GitHub issue" link (`.../issues/new?title=...&body=...&labels=submission`).
3. The visitor opens the issue (or pastes the text into a new one manually,
   using the `submit-article` issue template as a guide).

Every such issue is labeled `submission` and left open until reviewed.

## Importing submissions

Run this whenever you want to process pending submissions:

```
GITHUB_TOKEN=<a token with repo/issues access> npm run import-issues
```

For each open issue labeled `submission` (and not yet `integrated`), the
script:

- Parses the `### Label` / value sections of the issue body.
- Validates the result with the same rules the local app uses
  (`lib/articles.js`): valid URL, `YYYY-MM-DD` date, coordinates inside
  France, radius in range, etc.
- **On success:** inserts the article (with tags) into `data.sqlite`,
  comments with the new article's id, adds the `integrated` label, and
  closes the issue.
- **On failure:** comments with the specific validation errors and adds the
  `needs-changes` label, leaving the issue open so it's picked up again
  (and the `needs-changes` label cleared) once someone edits it and you
  re-run the script.

## Updating the data and redeploying

The full cycle, from either local edits or GitHub issue submissions, to the
live Pages site:

```
# 1. Bring in any pending GitHub issue submissions (optional)
GITHUB_TOKEN=<token> npm run import-issues

# 2. (or/also) add or remove articles locally via `npm start` + the UI

# 3. Rebuild the static site from the current data.sqlite
npm run build

# 4. Commit the updated database and the rebuilt docs/, then push
git add data.sqlite docs
git commit -m "Update articles"
git push
```

Steps 1 and 3 are combined in `npm run sync`
(`GITHUB_TOKEN=<token> npm run sync`).

GitHub Pages picks up the new `docs/` content shortly after the push — there
is no separate deploy step.

## Data model

- **articles**: title, url, date, location name, lat/lng, radius (km).
- **tags**: many-to-many with articles via `article_tags`; deleting an
  article cascades to its tag links.
- `GET /api/articles` accepts `from`/`to` (date range) and `tags`
  (comma-separated, OR-matched) query params; the static site applies the
  same filters client-side against `docs/data.json`.
