# Expense tracker

Status: DBS and UOB email reader installed and logging real alerts. Phone app v1 (Home, Review, Activity, Add) written in `docs/` and tested with sample data; backend API (`Api.gs`, `Ledger.gs`) written, not yet deployed. OCBC reader still to do. Tests: 32 pass in `backend/apps-script/tests/run.html`.

Phone app API (POST text/plain JSON `{token, action, ...}`): `summary`, `list`, `reviewQueue`, `setCategory`, `addManual`, `setBalance`, `deleteRow`. Balances come from `Accounts.openingBalance` plus all non-duplicate rows; "set actual balance" adds an `adjust` row. Card balance is negative when money is owed.

Repo: https://github.com/wopni1021/life-ai-assistent (public; never commit personal data).
Reader code: `backend/apps-script/` (setup steps in `SETUP.md`).

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
- Review queue for emails the parser could not read.

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
- Banks: OCBC, DBS, UOB. Currency: SGD.
- Notification emails show only amount and merchant, not balance. Balances are opening balance plus logged transactions, with a manual "set actual balance" correction.
- Up to a minute of delay is fine.
- Single user, no sharing.
- No history to import.
