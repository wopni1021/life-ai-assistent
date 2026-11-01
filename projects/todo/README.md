# Todo tool

Status: built and tested locally with sample data and a stand-in for Google's services. Not yet deployed. Live Apps Script, real AI calls, the iPhone Shortcut, ntfy, the Shopee link, the haptic tick and real dictation output still need trying on the phone.

Setup steps: `backend/SETUP.md`. App: `app/`. Backend: `backend/`.

Phone API (POST JSON `{token, action, ...}`): `todoList`, `todoAdd` (`{id?, text}`; returns `{tasks, message}`), `todoUpdate`. Tab `Todos`: `id, text, due, group, repeat, status, raw, createdAt, doneAt`. `status` is `open` or `done`. `repeat` is `1d`, `2w`, `1m` (every N days, weeks, months), `w3` (every Wednesday) or `m5` (the 5th of each month).

## Goal
- Log a chore the moment it comes to mind, by voice, mostly in Chinese.
- Open the app and know what to do now.
- Spend less effort remembering, and feel good finishing.

## Inputs
- iPhone Shortcut: one press, speak, saved. Fastest.
- The app: a text box used with the iOS keyboard microphone.
- `app/parser.js` turns the sentence into a task with no AI. The same file is pasted into Apps Script as `TodoParser`, so there is one copy.
- Long or messy sentences go to optional AI, after the task is already saved. Any AI failure leaves the rules result.

## Data per task
Text, due date, group, repeat, your original words, created and finished times.

## Groups
Where or how a task gets done, because the useful question is "what can I do from here?": 买东西, 出门办, 手机办, 在家做, otherwise 未分组. Assigned by keywords first, then AI when no keyword fits.

## Phone behavior
- Sections: 现在要做 (overdue and today), 这周 (next 7 days), 以后. Filter chips by group.
- Opens from a saved copy. Unsent changes stay in a saved queue and retry, so closing the app loses nothing.
- 买东西 tasks have a Shopee search button.
- Finishing a task: tick animation, sparks, soft ding, varied praise, bigger reward for tasks that waited longer, a 今天 N/M progress bar, a full-screen moment when 现在要做 is cleared, and a weekly trophy count.

## Reminders
Optional morning push through ntfy at about 8am: overdue and today's tasks, how many were finished yesterday, and how many remain this week. Nothing is sent on a day with nothing due.

## Sharing
Only the user.

## Existing data to import
None.

## Open questions
- Does the Shopee web link open the Shopee app on iPhone?
- Which phrases does real dictation produce that the parser misreads? Add each one to `backend/tests/run.html`.
- How long does a real AI call take? If Opus feels slow, set `AI_MODEL` to `claude-haiku-5-5`.

## Decisions
- Own sheet, script and token, separate from Expenses: no shared lock with the Gmail check, the token in the Shortcut cannot reach bank data, and the AI key does not sit beside Gmail access.
- No date said means due in 7 days. 不急 means 30 days.
- A week runs Monday to Sunday. 这周 is the coming Sunday, 周末 the coming Saturday, 下周 the Sunday of next week.
- A repeating task comes back one interval after it is finished. 每周三 and 每月5号 use the next such date.
- No daily streaks, because one missed day resets them. The weekly count only goes up. Overdue wording stays calm.
- In-app speech recognition is left out because it is unreliable in Home Screen apps.
- Left out of v1: quick re-add of past purchases, location reminders, learning from group corrections.
