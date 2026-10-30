# Life Project: instructions for AI assistants

Read `README.md` first for the architecture. Then read the `projects/<name>/README.md` of the project being worked on.

## Rules

- Keep everything Claude-independent: no claude.ai artifact features (their database, hosting or `sample` calls) in code meant to last. Prototypes that use them go in `legacy/`.
- Plain HTML, CSS and JS for the app. No build step or framework unless a project's requirements justify it and the user agrees.
- Data lives in the Google Sheet. Do not invent a second data store.
- AI features must be optional and work without an API key through manual entry or simple parsing.
- Never ask for or store bank credentials, card numbers or passwords. Keep statements local.
- Each minor project has its own requirements. Do not apply one project's assumptions to another.
- Before writing app or backend code for a project, confirm a short build plan with the user.
- The user mostly uses a phone, so every screen must work at about 400px wide with large touch targets.
- When adding a project, create `projects/<name>/README.md` from the template in `projects/expenses/README.md` and add it to the table in `README.md`.
