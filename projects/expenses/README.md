# Expense tracker

Status: DBS, UOB and OCBC readers and phone app (Home, Activity, Vouchers, Add) in use. Alerts are fetched on demand when the app opens or on pull to refresh, not on a timer. Statement review added 2026-11-07, to be checked on the first real statements. Tests: 104 pass in `projects/expenses/backend/tests/run.html`.

Phone app API (POST text/plain JSON `{token, action, ...}`): `sync` (fetches new alerts, returns everything for the current month, or `{unchanged: true}`), `list` (an older month), `setCategory`, `addManual`, `setBalance`, `deleteRow`, `voucherSave`, `voucherUse`, `voucherDelete`, `statementCheck` (reads new statement emails, returns `{processed, waiting}`), `statementItem` (`{id, choice: add | use | dismiss}`). The app keeps a saved copy on the phone so it opens and switches tabs without waiting. Row status: `ok`, `guess` (default category, fix when convenient), `review` (a number is missing or would be wrong), `dup`. Balances come from `Accounts.openingBalance` plus all non-duplicate rows; "set actual balance" adds an `adjust` row. Card balance is negative when money is owed.

Repo: https://github.com/wopni1021/life-ai-assistent (public; never commit personal data).
Reader code: `projects/expenses/backend/` (setup steps in `SETUP.md`).

## Goal
- See total money across all accounts at a glance.
- See the balance of each account.
- Track spending on credit cards (amount owed so far, not just a list).
- Log every expense in real time, with no manual typing.

## Inputs
- Every expense triggers BOTH an SMS and an email notification.
- Source of truth for automatic logging: the email (readable by a script; SMS is not).
- Which banks, cards and wallets send them: TBD (need one redacted sample email per sender).
- Manual entry stays as a fallback for cash and anything unparsed.

## Email formats seen (from a read-only look at the inbox, 2026-10-27)
Sender `ibanking.alert@dbs.com` (DBS/POSB). Each is a small table: Date & Time, Amount, From, To.
- PayNow payment: subject "iBanking Alerts", body "We refer to your PAYNOW dated ...". Amount `SGD9.40`; From = account (last 4 digits); To = payee name.
- NETS Scan & Pay: subject "digibank Alert - Successful NETS Scan & Pay". Amount `S$5.30`; To = merchant. Has a Transaction Ref.
- FAST / DBS-to-DBS transfers: subject "iBanking Alerts". Outgoing transfer.
- Incoming FAST: subject "digibank Alerts - You've received a transfer", "You have received SGD ... via FAST".
- GIRO deduction: subject "digibank Alerts - Successful GIRO deduction".
- Ignore: eDocument/e-statement notices, eGIRO set-up, "Your transfer is on hold", marketing (`emktg@dbs.com`, `serviceinfo@dbs.com`).

Sender `Notifications@ocbc.com`:
- Funds transfer: subject "We have processed your funds transfer request". Amount `SGD 100000.00`, From account (360 Account), To account and bank, Reference number.
- OCBC credit card e-statement notices exist (`documents@ocbc.com`), but no per-purchase card alerts were found in the last 90 days.

Sender `unialerts@uobgroup.com` (UOB), about 200 alerts in 90 days. The snippet already contains everything needed.
- Card purchase: subject "UOB - Transaction Alert". "A transaction of SGD 2.11 was made with your UOB Card ending NNNN on 27/10/26 at BUS/MRT." Date is DD/MM/YY with no time; use the email timestamp for time. Merchant names are messy and truncated (for example "SHENG SIONG SUPERMARKET -").
- Account debit: subject "UOB Transaction Alert". "A transaction of SGD1593.82 was debited from your a/c XXXXXXNNNN at 09:31PM 22-Oct-2026, SGT. Ref: Inward DR - GIRO, <payee>, ...". A GIRO to "UOB CARD CENTRE" is the card bill payment (transfer to the card, not spending). A GIRO to anyone else is real spending.
- Card bill payment confirmation: subject "UOB-Credit Card Payment Received", amount in the body. It duplicates the GIRO debit above, so it only confirms.
- Reversal/refund: subject "Your transaction has been reversed". "A transaction of 6.93 SGD made with your UOB card ending NNNN on 11 Oct 26, 3:29PM at <merchant> has been reversed." Money back to the card.
- No transaction reference in card alerts. Deduplicate with the Gmail message id.

Implications:
- UOB card: balance owed = card purchases minus reversals minus bill payments. Bill payment is a transfer from the UOB account to the card.
- Amounts use different formats (`SGD9.40`, `S$5.30`, `SGD 100000.00`), so the parser must handle all.
- Transfers between own accounts show up twice (OCBC out, DBS in). Match by amount and time, and mark them as transfers, not spending or income.
- No balances in any email, as expected.

## OCBC and more accounts (added 2026-11-05)
Sender `notifications@ocbc.com` also sends offers and statements; only payment emails are kept.
- Funds transfer: subject "We have processed your funds transfer request". Amount, "From your account : 360 Account (-NNNNNN)", "To account : NAME (-NNNNNN) at BANK", reference.
- PayNow made: subject "PayNow transfer made". "has been made to NAME using ...". The name can be masked ("JAXE TAX"); an x matches any letter when checking own names.
- Deposit: subject "OCBC Alert: Deposit in your account" (alerts turned on 5 Nov). "Account that money was deposited in: (-NNNNNN)", "Reference: from NAME".
- 90°N card purchases: format not seen yet. The reader has a guess; anything with an amount that doesn't match goes to Unparsed.
- DBS Multiplier uses the normal DBS formats. "Funds Transfer to own account" counts as a transfer.
- A transfer with no known destination is paired with a matching incoming payment with no sender (same amount, 30 minutes) and gets that account.
- Accounts tab rows: `dbs-multiplier` (bank, DBS), `ocbc-360` (bank, OCBC), `ocbc-90n` (card, OCBC), each with its last 4 digits.

## Data per expense
<!-- Proposed: date/time, amount, currency, merchant, category, account, direction (spend/income/transfer/card payment), source email id (prevents duplicates), note, status (parsed / needs review). -->

## Accounts
- Types: bank/debit accounts, credit cards, possibly cash and e-wallets: TBD.
- Per account: name, type, opening balance (or latest balance from a notification), currency.
- Credit card: spend since last statement, outstanding total, limit and due date if known.
- Total money = sum of asset accounts, shown separately from credit card debt: TBD.

## Categories
<!-- TBD -->

## Reports and alerts
<!-- TBD. Minimum: total money, per-account balance, credit card outstanding. -->

## Phone behavior
- Installable web app; opens straight to totals.
- Quick manual add in a few taps.
- Opens from a saved copy; updates in the background.
- Unsorted and Needs attention filters in Activity. Nothing blocks.

## Vouchers
- Tracks how much is left on each dollar-value voucher and when it expires. Tab `Vouchers`: `id, name, amountLeft, expires, note, status, createdAt`. `status` is `active` or `used`. Not counted in Total money.
- Due soon means within `voucherWarnDays` (Settings tab, default 30). Red at 7 days or fewer, amber before that. Shown as a banner at the top of Home and a count on the Vouchers tab. Worked out on the phone from today's date.
- In-app warning only, so a voucher can expire unseen if the app isn't opened. Using a voucher is entered by hand and keeps no history.

## Statement review (added 2026-11-07)
- Send a statement PDF from the bank app to yourself with the subject `e` (or `E`). No password on the PDF.
- After the app loads, it sends a separate `statementCheck` request, so balances load as fast as before. The header shows "Reviewing statements..." while it runs. It reads every new statement (up to 4 minutes; anything left waits for the next open) and refreshes when done. At most every 2 minutes.
- The PDF is turned into text through a temporary Google Doc in your Drive, deleted at once. Only the lines it finds go to the sheet: tabs `Statements` and `StatementItems`.
- Home shows a red banner for fees (annual fee, finance charge, late fee and similar, often waivable) and suspicious lines (same charge twice in a day, foreign currency, a new merchant at or above `suspiciousAmount` in Settings, default 200). It also says how many statement lines are not in the app.
- The review screen (from the banner or Activity) groups Warnings, Balance (bank accounts: statement closing balance vs the app), Not in the app (Add), and In the app, not on the statement. Each can be dismissed.
- A statement line matches a logged entry with the same amount within 3 days. Lines before an account's first logged entry, or before a balance correction, are not counted as missing.
- Readers built from real samples: OCBC 360, OCBC card, UOB account, UOB card. DBS uses a generic reader until a sample is seen. A statement that yields no lines shows "could not read it".

## Sharing
Only the user.

## Existing data to import
None. Starting fresh; opening balances entered once per account.

## Open questions
- Which banks, cards and wallets, and which currencies?
- Do notification emails include the account balance, or only the amount?
- Do credit card payments and transfers between own accounts appear as notifications?
- Is a new notification delay of up to a minute acceptable as "real time"?
- Which categories do you want?

## Decisions
- Pushing backend changes to `main` tests and deploys them through GitHub Actions (see `backend/SETUP.md`).
- Banks: OCBC, DBS, UOB. Currency: SGD.
- Notification emails show only amount and merchant, not balance. Balances are opening balance plus logged transactions, with a manual "set actual balance" correction.
- Fetch alerts when the app opens or on pull to refresh; no timer.
- Merchants with no rule default to Dining (card, NETS, PayNow) or Other (transfers, GIRO), marked as guesses.
- Single user, no sharing.
- No history to import.
