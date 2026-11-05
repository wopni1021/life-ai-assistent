# Life Project

A personal toolkit for the small, repeated jobs of daily life: expenses, to-dos, reminders, shopping, research, e-statements. It is built as many small projects, each with its own requirements in `projects/<name>/README.md`.

Main rule: **every piece must keep working and be redeployable without Claude.** Claude (or any AI) helps build and maintain it, and can be an optional feature inside it, but nothing depends on it.

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Data | Google Sheets in my Drive. Projects that share data use tabs in one sheet; independent projects get their own sheet | Editable by hand, exports to CSV, works on phone and Mac |
| Backend | Google Apps Script web app bound to each sheet | Free, runs under my own Google account, small JSON API |
| App | Static PWA (plain HTML/JS, no framework) on GitHub Pages | Installs on the phone home screen, easy for anyone to maintain |
| Reminders | Apps Script time trigger, push via ntfy or email | Works with every device off |
| AI | Optional. Provider and API key are settings. Without a key the app uses manual entry and simple parsing | Not locked to one vendor |
| Mac tools | Plain scripts in the project's own `scripts/` folder (for example e-statement analysis) | Run by hand or by any AI |

Each layer is built only when the project in progress needs it.

## Layout

Each project keeps everything in `projects/<name>/`:

- `README.md`: requirements, status and open questions
- `app/`: the phone app (PWA). Use the sample data button on its first screen to see it without a backend
- `backend/`: Apps Script code, tests and the setup guide (`SETUP.md`)
- `scripts/`: Mac-side tools, if the project has any

At the top level:

- `.github/workflows/pages.yml`: publishes each app to GitHub Pages by copying its `app/` folder. It only copies files; there is no build step
- `.github/workflows/deploy-*.yml`: test each backend and update its live web app when it changes on `main`. `.github/scripts/` runs the HTML test pages under Node
- `exports/`: CSV backups of the sheet (do not commit if the folder is ever made public)
- `legacy/`: earlier prototypes kept for reference (`home-desk.html` was a claude.ai page and only runs there)

## Projects

| Project | Status |
| --- | --- |
| expenses | In use |
| todo | Deployed |
| reminders, research, e-statements, baby shopping | Not started |

## Privacy

- Never store bank logins, card numbers or passwords in this folder or the sheet.
- E-statements stay on this Mac; only the extracted rows go to the sheet.
- API keys live in Apps Script properties or a local, untracked file, never in the app source.
