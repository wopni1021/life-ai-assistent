# Set up the email reader (about 15 minutes, on the Mac)

This creates your expense sheet and a script that reads DBS and UOB alert emails from your own Gmail whenever the phone app opens. It runs inside your Google account. Nothing is sent anywhere else.

## 1. Create the sheet and script
1. Go to https://sheets.new and name the sheet "Life Expenses".
2. Menu: Extensions > Apps Script. A code editor opens.
3. Delete the default `myFunction` code in the file `Code.gs`.
4. Paste in everything from `projects/expenses/backend/Code.gs` (replace the whole file).
5. Click the plus next to Files > Script, name it `Parsers`, and paste in `projects/expenses/backend/Parsers.gs`.
6. Click the gear (Project Settings), tick "Show appsscript.json manifest file", go back to the editor, open `appsscript.json` and paste in `projects/expenses/backend/appsscript.json`.
7. Click Save.

## 2. Run setup
1. In the function drop-down choose `setup`, then click Run.
2. Google asks you to authorize. Choose your account, then "Advanced" > "Go to project (unsafe)" (it says unsafe only because you wrote it yourself, not Google), then Allow. It asks for Gmail read access, because the script has to read the alerts.
3. Go back to the sheet. You now have tabs: Transactions, Accounts, Rules, Settings, Unparsed, Seen.

## 3. Fill in two things
- **Accounts tab, column `last4`:** the last 4 digits of each account or card, as they appear in the alert emails:
  - DBS savings: the digits after "A/C ending" in a DBS alert.
  - UOB account: the last 4 after the X's in "a/c XXXXXX____".
  - UOB card: the digits after "UOB Card ending".
  Change names or add rows if you have more accounts.
- **Settings tab, `ownNames` value:** your name as it appears in transfers between your own accounts (for example the name in DBS "From: ..."). Several names are separated by commas. This lets the script call transfers between your own accounts "transfer", not spending.

## 4. Test
1. Run `backfill` (it imports the last 30 days of alerts). Check the Transactions tab.
2. Merchants with no rule go to a default category with status `guess` (`defaultCategory` and `defaultTransferCategory` in the Settings tab; without them, Dining and Other). Fix them when you like, in the app or by adding a row to the Rules tab. Status `review` means a number is missing, such as the SGD amount of a foreign purchase.
3. Emails the script could not read go to the Unparsed tab. Tell the assistant what they look like.
4. New alerts are fetched when you open the app or pull down to refresh. Run `checkMail` to fetch by hand. After adding rules in the sheet, run `reapplyRules`.

## 5. Turn on the phone app's connection (second install step)
1. In Apps Script, add two new script files named `Ledger` and `Api` and paste in `Ledger.gs` and `Api.gs` from `projects/expenses/backend/`. Replace `appsscript.json` with the new version (it now has a `webapp` block). Save.
2. Choose `makeToken` in the function drop-down and click Run. A box shows your secret app token. Copy it somewhere private. Running `makeToken` again creates a new token and signs out every phone.
3. Click **Deploy** (top right) > **New deployment**. Click the gear next to "Select type", choose **Web app**. Set "Execute as" to **Me** and "Who has access" to **Anyone**. Click **Deploy** and approve the permission screens.
4. Copy the **Web app URL** (ends in `/exec`). The phone app needs this URL and the token. Keep the URL private too.
5. After changing any code later: **Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy**. The URL stays the same.

In the Accounts tab, add a row for cash if you want to track it (`id` cash, `name` Cash, `type` bank, `bank` manual).

## 6. Put the app online
The app lives in `projects/expenses/app/`. A GitHub Actions workflow (`.github/workflows/pages.yml`) publishes it on every push to `main`. In the GitHub repo, open **Settings > Pages** and set Source to "GitHub Actions" (do this before the first push of the workflow). The address is `https://wopni1021.github.io/life-ai-assistent/`. Open it on the iPhone in Safari, enter the web app URL and token once, then Share > Add to Home Screen.

## Automatic deploys
Pushing a change under `projects/expenses/backend/` to `main` runs the tests, uploads the code and updates the web app at the same address (`.github/workflows/deploy-expenses.yml`). A failed test stops the deploy. Check runs in the repo's **Actions** tab.

- Do not edit code in the Apps Script website. The next deploy overwrites it. Run functions there as before.
- It needs three repo secrets: `CLASPRC_JSON` (the contents of `~/.clasprc.json` after `clasp login`), `EXPENSES_SCRIPT_ID` (Project Settings) and `EXPENSES_DEPLOYMENT_ID` (Deploy > Manage deployments).
- Sign in with only three permissions: Apps Script projects, Apps Script deployments, and publish as a web app.
- If a deploy fails on sign-in, run `clasp login` again and replace `CLASPRC_JSON`.
- `CLASPRC_JSON` can change this script, and this script can read your Gmail, so keep two-factor sign-in on for GitHub. To cancel it, remove clasp at https://myaccount.google.com/permissions.
- By hand, without GitHub: paste the files into the Apps Script editor and use Deploy > Manage deployments > New version.

## Adding an account
1. Add a row to the Accounts tab: a short id, a name, `bank` or `card`, the bank (`DBS`, `UOB` or `OCBC`), and the last 4 digits as they appear in alerts.
2. In Apps Script, run `backfill` (pulls in the last 30 days of alerts; change the number inside to go further back) and then `reapplyRules`, so earlier rows that mention the account become transfers.
3. In the app, open the account and set its real balance.

## Vouchers
The `Vouchers` tab is created the first time you add a voucher in the app. To change when a voucher counts as due soon, add a row to the Settings tab: `voucherWarnDays` and a number of days (30 if there is no row).

## Statement review
After the deploy that added it, open the Apps Script editor once, pick `authorizeStatements` and press Run, then allow the new permissions (files this script creates in Drive, and calls to Google's Drive API). Until then the app says statements need permission and everything else works as before.

Optional Settings row: `suspiciousAmount` and a number (200 if there is no row). A first-time merchant at or above it is flagged.

## Rules tab
Each row: `pattern` (text the merchant name contains, not case-sensitive; or `re:` followed by a regular expression), then `name`, `category`, `tag`. The first matching row wins.

## Privacy
- Bank alerts stay in your Gmail and your sheet.
- Statement PDFs stay in Gmail. Each is copied to a temporary Google Doc in your Drive to read its text, then deleted. Only the extracted lines go to the sheet.
- The script only searches for emails from `ibanking.alert@dbs.com` and `unialerts@uobgroup.com`.
- Google's permission is for your whole mailbox, so read `Code.gs` if you want to check what it does.
