# Todo tool

Status: deployed automatically from GitHub. Tested with sample data and a stand-in for Google's services. Live use of Apps Script, real AI calls, the iPhone Shortcut, ntfy, the Shopee link, the haptic tick and real dictation output still need trying on the phone.

Setup steps: `backend/SETUP.md`. App: `app/`. Backend: `backend/`.

Phone API (POST JSON `{token, action, ...}`): `todoList` (returns `{todos, ideas}`), `todoAdd` (`{id?, text, plain?}`; returns `{tasks, message}`; without `plain` a sentence starting with 想法 or 补充 is filed as an idea or a note instead), `todoUpdate`, `ideaAdd` (`{id, text, kind?, raw?}`), `ideaUpdate` (`{id, text?, kind?, stage?, note?, removeNote?, remove?}`). Tab `Todos`: `id, text, due, group, repeat, status, raw, createdAt, doneAt, showFrom`. `status` is `open` or `done`. `repeat` is a count and unit (`1d`, `2w`, `1.5m`, `45d`: every N days, weeks, months; decimals allowed, up to a year), `w3` (every Wednesday) or `m5` (the 5th of each month). `1.5m` means one calendar month and then 15 days. `showFrom` is set only on the next round of a repeating task; until that date the task waits out of the main list. The next round is counted from the planned `due`, not the day it was finished, so finishing early or late keeps the rhythm; rounds already gone by are skipped.

## Goal
- Log a chore the moment it comes to mind, by voice, mostly in Chinese.
- Keep ideas (improving the apps, new things to build, ways to make money) in the same app but apart from the chores, and carry each from first thought to something usable.
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

## Ideas (想法)
- A 待办 | 想法 switch at the top. Tab `Ideas` in the same sheet, made automatically on first use: `id, text, kind, stage, notes, raw, createdAt, updatedAt, stageAt`.
- Logging: start with 想法, 灵感 or 点子 (or "idea:"), in the app or the Shortcut. In the 想法 tab every sentence is an idea. 想法子 ("find a way") stays a todo.
- Kind: 改进, 新东西 or 赚钱, guessed from keywords, changed with one tap.
- Stage: `new` 新想法 → `doing` 在做 → `usable` 能用了 (works, still being improved) → or `shelved` 放下. An idea in 在做 with no update for 21 days moves to the top with a gentle nudge to ship a usable version.
- Notes (补充): dated lines, newest first, in the `notes` cell. By voice: "补充 发票流程：先用 Gmail 标签" goes to the idea that best matches the name (shared two-character pieces, at least half); "补充：…" with no name goes to the idea updated last. The confirmation has 换一个 to move the note. In the app, each idea has a ＋ button. A 补充 that names no known idea stays a todo, so "补充维生素D" is still a chore.
- Ideas are not in the morning push or the 今天 count.

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
- The next round waits out of sight and reappears about a fifth of the interval before it is due, between 1 and 7 days (每周 1 day, 每月 6 days, 每1.5个月 7 days; daily on the day). Waiting rounds sit behind one folded row, "安排好了 N 件", where they can be edited or finished early. Setting a new date shows the task at once. One-off tasks due later stay in 以后.
- No daily streaks, because one missed day resets them. The weekly count only goes up. Overdue wording stays calm.
- In-app speech recognition is left out because it is unreliable in Home Screen apps.
- Ideas share the Todo sheet and token rather than being a separate project: one app, one Shortcut, no extra setup.
- Ideas are never sent to AI; they are kept in your own words.
- Left out of v1: quick re-add of past purchases, location reminders, learning from group corrections.
