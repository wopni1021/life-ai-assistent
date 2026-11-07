# Life Project: instructions for AI assistants

Read `README.md` first for the architecture. Then read the `projects/<name>/README.md` of the project being worked on.

## Rules

- Keep everything Claude-independent: no claude.ai artifact features (their database, hosting or `sample` calls) in code meant to last. Prototypes that use them go in `legacy/`.
- Plain HTML, CSS and JS for the app. No build step or framework unless a project's requirements justify it and the user agrees.
- Data lives in Google Sheets. An independent project may have its own sheet. Do not invent another kind of data store.
- AI features must be optional and work without an API key through manual entry or simple parsing.
- Never ask for or store bank credentials, card numbers or passwords. E-statements are read only inside the user's own Google account (her Apps Script); only extracted lines go to the sheet, never to the repo or an outside service.
- Each minor project has its own requirements. Do not apply one project's assumptions to another.
- Before writing app or backend code for a project, confirm a short build plan with the user.
- Pushing to `main` publishes the apps and deploys each backend (`.github/workflows/deploy-<project>.yml`, sharing `deploy-apps-script.yml`). Never commit tokens, web app addresses, deployment ids or `.clasprc.json`. Code changes go in the repo, not the Apps Script website.
- The user mostly uses a phone, so every screen must work at about 400px wide with large touch targets.
- Everything for a project stays in `projects/<name>/` (`README.md`, `app/`, `backend/`, `scripts/`). Nothing project-specific goes at the top level.
- When adding a project, create `projects/<name>/README.md` from the template in `projects/expenses/README.md`, add it to the table in `README.md`, and add its `app/` to `.github/workflows/pages.yml`. If it has a backend, copy `deploy-todo.yml`, add a `.claspignore`, and add its two id secrets.
