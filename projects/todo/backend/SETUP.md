# Set up the todo tool (about 25 minutes, on the Mac, then the phone)

Todos have their own Google Sheet, script and token, separate from Expenses. Parts 1 to 3 are needed. Parts 4 to 6 are optional and can be done later.

## 1. Publish the app (GitHub, 2 minutes)
Do this **before** pushing the new folder layout, because Pages stops updating from `docs/` once that folder is gone.

1. In the GitHub repo, open **Settings > Pages**.
2. Set Source to **GitHub Actions**.
3. Push `main`. The workflow in `.github/workflows/pages.yml` publishes both apps. Check the **Actions** tab shows a green tick.

The addresses:
- Expenses stays at `https://wopni1021.github.io/life-ai-assistent/`, so its Home Screen icon keeps working.
- Todos is at `https://wopni1021.github.io/life-ai-assistent/todo/`.

## 2. Create the sheet and script
1. Go to https://sheets.new and name the sheet "Life Todos".
2. Menu: Extensions > Apps Script.
3. Delete the default code in `Code.gs` and paste in `projects/todo/backend/Code.gs`.
4. Click the plus next to Files > Script three times, and paste these in:
   - `TodoParser`: `projects/todo/app/parser.js`
   - `Ai`: `projects/todo/backend/Ai.gs`
   - `Push`: `projects/todo/backend/Push.gs`
5. Click the gear (Project Settings), tick "Show appsscript.json manifest file", go back to the editor, and replace `appsscript.json` with `projects/todo/backend/appsscript.json`. Click Save.
6. Choose `setup` in the function drop-down and click Run. Approve the permissions (choose your account, then "Advanced" > "Go to project (unsafe)", then Allow). It says unsafe only because you wrote it yourself, not Google. This script has no access to Gmail.
7. Choose `makeToken` and click Run. Copy the token somewhere private. It only opens todos, not your expense data.
8. Click **Deploy > New deployment**. Click the gear next to "Select type" and choose **Web app**. Set "Execute as" to **Me** and "Who has access" to **Anyone**. Click **Deploy**.
9. Copy the **Web app URL** (ends in `/exec`). Keep it private too.

After changing any code later: **Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy**. The URL stays the same.

After the secrets below are in, pushing to `main` deploys for you, so the pasting and the "New version" step above are only for doing it by hand.

### Automatic deploys
Pushing a change under `projects/todo/backend/`, or to `app/parser.js`, runs the tests, uploads the code and updates the web app at the same address (`.github/workflows/deploy-todo.yml`). It reuses the `CLASPRC_JSON` secret from Expenses and needs two more repo secrets: `TODO_SCRIPT_ID` (Project Settings) and `TODO_DEPLOYMENT_ID` (Deploy > Manage deployments).

For a new project, add `TODO_SCRIPT_ID` first and run **Deploy Todo backend** from the repo's Actions tab: the code is uploaded with no pasting. Then run `setup` and `makeToken` in the editor, make the first web app deployment by hand, and add `TODO_DEPLOYMENT_ID`. Do not edit code in the Apps Script website, because the next deploy overwrites it.

## 3. Add the icon to the iPhone
1. In Safari, open `https://wopni1021.github.io/life-ai-assistent/todo/`.
2. Share > Add to Home Screen. The icon is called 待办.
3. Open it from the Home Screen and paste the web app URL and token. iPhone keeps each Home Screen app's storage separate, so this has to be done inside the installed app.

## 4. One-press voice logging (iPhone Shortcut, 5 minutes)
This is the fastest way to log: one press, speak, done, without opening the app.

1. Open the **Shortcuts** app, tap **+**, and name it `记待办`.
2. Add the action **Dictate Text**. Set Language to Chinese (Mainland China) and Stop Listening to After Pause.
3. Add **Get Contents of URL**. Paste the web app URL, then tap the arrow to show more:
   - Method: **POST**
   - Request Body: **JSON**
   - Add three Text fields: `token` (your todo token), `action` (`todoAdd`), and `text` (choose the variable **Dictated Text**).
4. Add **Get Dictionary Value**. Get Value for `data` in Contents of URL.
5. Add **Get Dictionary Value**. Get Value for `message` in Dictionary Value.
6. Add **Show Notification** with that Dictionary Value.

Then choose how to start it:
- **Action Button** (iPhone 15 Pro or newer): Settings > Action Button > Shortcut > `记待办`.
- **Back Tap** (any other recent iPhone): Settings > Accessibility > Touch > Back Tap > Double Tap > `记待办`.
- **Siri**: say "嘿 Siri,记待办".

If the Shortcut shows an error, check the sheet before saying it again: the task is saved before the reply comes back, so it may already be there.

## 5. AI cleanup for long or messy sentences (optional)
Without this, everything still works. A long sentence stays as one task until you edit it.

1. Create an API key at https://platform.claude.com.
2. In Apps Script, open Project Settings > Script properties and add `AI_KEY` with your key.

Short phrases never call AI. Your task text goes to the AI provider only when a sentence is long, mentions several things (还有, 另外, 顺便), or fits no group.

Optional properties:
- `AI_MODEL`: defaults to `claude-opus-5-5`. `claude-haiku-5-5` costs much less and is usually faster.
- `AI_PROVIDER`: defaults to `claude`. To use another provider, add a function for it to `AI_PROVIDERS_` in `Ai.gs`.

## 6. Morning push (optional)
1. Install the **ntfy** app on the iPhone.
2. Make up a long random topic name, such as `todo-` followed by 20 random letters and digits. Anyone who knows the name can read the messages, so do not use a guessable one.
3. In the ntfy app, subscribe to that topic on the default server.
4. In Apps Script, add two script properties: `NTFY_TOPIC` with your topic, and `APP_URL` with the todo address from part 1.
5. Run `sendPushNow` to test, then run `turnOnPush` once. `turnOffPush` stops it.

It sends around 8am on days with something due today or overdue. On other days it stays quiet. Your task text passes through the ntfy.sh service.

## Tests
Serve the repo with any static server and open:
- `projects/todo/backend/tests/run.html`: parser, AI reply checks and the push text.
- `projects/todo/backend/tests/backend.html`: the real backend files against a stand-in for Google's services.
