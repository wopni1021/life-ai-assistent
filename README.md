# Life Project

A personal toolkit for the small, repeated jobs of daily life: expenses, to-dos, reminders, shopping, research, e-statements. It is built as many small projects, each with its own requirements in `projects/<name>/README.md`.

Main rule: **every piece must keep working and be redeployable without Claude.** Claude (or any AI) helps build and maintain it, and can be an optional feature inside it, but nothing depends on it.

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Data | Google Sheets in my Drive, one tab per minor project | Editable by hand, exports to CSV, works on phone and Mac |
| Backend | Google Apps Script web app bound to the sheet | Free, runs under my own Google account, small JSON API |
| App | Static PWA (plain HTML/JS, no framework) on free hosting (GitHub Pages or Cloudflare Pages) | Installs on the phone home screen, easy for anyone to maintain |
| Reminders | Apps Script time trigger, push via ntfy or email | Works with every device off |
| AI | Optional. Provider and API key are settings. Without a key the app uses manual entry and simple parsing | Not locked to one vendor |
| Mac tools | Plain scripts in `scripts/` (for example e-statement analysis) | Run by hand or by any AI |

Each layer is built only when the project in progress needs it.

## Layout

- `projects/<name>/README.md`: requirements, status and open questions for each minor project
- `docs/`: the phone app (PWA). It is called `docs` because GitHub Pages publishes that folder. Use "Try with sample data" on the first screen to see it without a backend
- `backend/apps-script/`: Apps Script code and the deploy guide
- `scripts/`: Mac-side tools
- `exports/`: CSV backups of the sheet (do not commit if the folder is ever made public)
- `legacy/`: earlier prototypes kept for reference (`home-desk.html` was a claude.ai page and only runs there)

## Projects

| Project | Status |
| --- | --- |
| expenses | Gathering requirements |
| todos, reminders, research, e-statements, baby shopping | Not started |

## Privacy

- Never store bank logins, card numbers or passwords in this folder or the sheet.
- E-statements stay on this Mac; only the extracted rows go to the sheet.
- API keys live in Apps Script properties or a local, untracked file, never in the app source.
