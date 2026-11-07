/**
 * Todo backend, bound to its own "Life Todos" sheet. Deployed as a web app (Execute as: me, Access: Anyone).
 * Every request is a POST with a JSON body: { token, action, ...fields }. The secret token is the real protection.
 * Actions: todoList, todoAdd, todoUpdate. The app and the iPhone Shortcut both use todoAdd.
 */

var TZ = 'Asia/Singapore';
var TODO_HEAD = ['id', 'text', 'due', 'group', 'repeat', 'status', 'raw', 'createdAt', 'doneAt', 'showFrom'];
var DONE_KEEP_DAYS = 30;
var MAX_BAD_TOKENS_PER_HOUR = 20;

/** Run once from the editor. Creates the Todos tab. Safe to run again. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Todos') || ss.insertSheet('Todos');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, TODO_HEAD.length).setValues([TODO_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // Plain text, so Sheets does not turn dates into Date cells.
  sh.getRange(2, 1, sh.getMaxRows() - 1, TODO_HEAD.length).setNumberFormat('@');
  SpreadsheetApp.getUi().alert('Setup done. Now run makeToken.');
}

/** Run once from the editor. Creates (or replaces) the secret token and shows it. */
function makeToken() {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_TOKEN', token);
  SpreadsheetApp.getUi().alert('Your todo token (copy it now, keep it secret):\n\n' + token +
    '\n\nRunning makeToken again creates a new token. The app and the Shortcut then need the new one.');
}

function doGet() {
  return ContentService.createTextOutput('Life Todos API').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var auth = checkToken_(req.token);
    if (auth === 'ok') out = { ok: true, data: handle_(req) };
    else out = { ok: false, error: auth === 'locked' ? 'too many attempts, try again later' : 'unauthorized' };
  } catch (err) {
    console.error(err && err.message);
    out = { ok: false, error: String(err && err.message || 'bad request').slice(0, 120) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(given) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('badTokens') || 0);
  if (fails >= MAX_BAD_TOKENS_PER_HOUR) return 'locked';
  var want = PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';
  given = String(given || '');
  var same = want.length > 0 && given.length === want.length;
  if (same) {
    var diff = 0;
    for (var i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
    same = diff === 0;
  }
  if (same) return 'ok';
  cache.put('badTokens', String(fails + 1), 3600);
  return 'bad';
}

function handle_(req) {
  if (req.action === 'todoList') return todoList_();
  if (req.action === 'todoAdd') return todoAdd_(req);
  if (req.action === 'todoUpdate') return withLock_(function () { return todoUpdate_(req); });
  throw new Error('unknown action');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- sheet ---------- */

var headerChecked_ = false;
function sheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Todos');
  if (!headerChecked_) {
    headerChecked_ = true;
    ensureHeader_(sh);
  }
  return sh;
}
/** A sheet made before a column was added gets its title, so a deploy needs no manual step. */
function ensureHeader_(sh) {
  if (!sh.getRange(1, TODO_HEAD.length).getValue()) sh.getRange(1, 1, 1, TODO_HEAD.length).setValues([TODO_HEAD]);
}
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function cellStr_(v, format) { return v instanceof Date ? Utilities.formatDate(v, TZ, format) : String(v || ''); }
function text_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max); }
function newId_() { return 't-' + Date.now() + '-' + Math.floor(Math.random() * 1000); }

function loadTodos_() {
  var sh = sheet_(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, TODO_HEAD.length).getValues().map(function (r) {
    var o = {};
    TODO_HEAD.forEach(function (h, i) { o[h] = r[i]; });
    o.id = String(o.id);
    o.due = cellStr_(o.due, 'yyyy-MM-dd');
    o.createdAt = cellStr_(o.createdAt, "yyyy-MM-dd'T'HH:mm:ss");
    o.doneAt = cellStr_(o.doneAt, "yyyy-MM-dd'T'HH:mm:ss");
    o.showFrom = cellStr_(o.showFrom, 'yyyy-MM-dd');
    return o;
  });
}

function rowOf_(id) {
  var sh = sheet_(), n = sh.getLastRow();
  if (n < 2) return 0;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function readRow_(row) {
  var vals = sheet_().getRange(row, 1, 1, TODO_HEAD.length).getValues()[0], rec = {};
  TODO_HEAD.forEach(function (h, i) { rec[h] = vals[i]; });
  rec.due = cellStr_(rec.due, 'yyyy-MM-dd');
  rec.showFrom = cellStr_(rec.showFrom, 'yyyy-MM-dd');
  return rec;
}

function writeRow_(row, rec) {
  sheet_().getRange(row, 1, 1, TODO_HEAD.length).setValues([TODO_HEAD.map(function (h) { return rec[h] === undefined ? '' : rec[h]; })]);
}

function appendRow_(rec) { sheet_().appendRow(TODO_HEAD.map(function (h) { return rec[h] === undefined ? '' : rec[h]; })); }

/* ---------- actions ---------- */

/** Open tasks, plus what was finished in the last 30 days for the trophy wall. */
function todoList_() {
  var since = addDays_(todayStr_(), -DONE_KEEP_DAYS);
  return {
    todos: loadTodos_().filter(function (t) { return t.status === 'open' || t.doneAt.slice(0, 10) >= since; })
  };
}

function shortDate_(due, today) {
  if (due === today) return '今天';
  if (due === addDays_(today, 1)) return '明天';
  return Number(due.slice(5, 7)) + '月' + Number(due.slice(8)) + '日';
}

function savedMessage_(tasks, today) {
  if (tasks.length === 1) return '已记下：' + tasks[0].text + ' · ' + shortDate_(tasks[0].due, today);
  return '已记下 ' + tasks.length + ' 件：' + tasks.map(function (t) { return t.text; }).join('、');
}

/**
 * Saves first, using the rules, so a slow or failed AI call can never lose a task.
 * The AI call happens outside the lock so it does not hold up other requests.
 * A repeated id (a retry from the app) changes nothing.
 */
function todoAdd_(req) {
  var raw = text_(req.text, 1000);
  if (!raw) throw new Error('empty text');
  var id = text_(req.id, 60) || newId_(), today = todayStr_();
  var parsed = parseTodo(raw, today);
  var rec = { id: id, text: parsed.text, due: parsed.due, group: parsed.group, repeat: parsed.repeat, status: 'open', raw: raw, createdAt: nowStr_(), doneAt: '' };
  var isNew = withLock_(function () {
    if (rowOf_(id)) return false;
    appendRow_(rec);
    return true;
  });
  var tasks = [rec];
  if (isNew && needsAi_(raw, parsed)) {
    var better = aiTasks_(raw, parsed, today);
    if (better.length) tasks = withLock_(function () { return applyAi_(rec, better); });
  }
  return { tasks: tasks, message: savedMessage_(tasks, today) };
}

function applyAi_(rec, better) {
  return better.map(function (t, i) {
    var row = i === 0 ? rowOf_(rec.id) : 0;
    var next = { id: i === 0 ? rec.id : rec.id + '-' + (i + 1), text: t.text, due: t.due, group: t.group, repeat: t.repeat, status: 'open', raw: rec.raw, createdAt: rec.createdAt, doneAt: '' };
    if (row) writeRow_(row, next);
    else appendRow_(next);
    return next;
  });
}

/**
 * Edits a task, or with these fields:
 * remove: true deletes it.
 * status 'done' finishes it. A repeating task also gets its next copy, under nextId.
 * status 'open' reopens it, and removeId deletes the copy that finishing it made.
 */
function todoUpdate_(req) {
  var row = rowOf_(req.id);
  if (!row) throw new Error('not found');
  if (req.remove) {
    sheet_().deleteRow(row);
    return { id: req.id };
  }
  var rec = readRow_(row);
  if (req.text !== undefined) rec.text = text_(req.text, 200);
  if (req.due !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.due)) throw new Error('bad date');
    // A date you set yourself shows the task now, even a round that was waiting.
    if (req.due !== rec.due) rec.showFrom = '';
    rec.due = req.due;
  }
  if (req.group !== undefined) {
    if (TODO_GROUPS.indexOf(req.group) < 0 && req.group !== TODO_NO_GROUP) throw new Error('bad group');
    rec.group = req.group;
  }
  if (req.repeat !== undefined) {
    if (req.repeat && !isRepeat(req.repeat)) throw new Error('bad repeat');
    rec.repeat = req.repeat;
  }
  if (req.status === 'done' && rec.status !== 'done') {
    rec.status = 'done';
    rec.doneAt = /^\d{4}-\d{2}-\d{2}T[\d:]{8}$/.test(req.doneAt || '') ? req.doneAt : nowStr_();
    if (rec.repeat && req.nextId && !rowOf_(req.nextId)) {
      var nextDue = nextRepeat(rec.repeat, rec.doneAt.slice(0, 10));
      appendRow_({ id: text_(req.nextId, 60), text: rec.text, due: nextDue, group: rec.group, repeat: rec.repeat, status: 'open', raw: rec.raw, createdAt: nowStr_(), doneAt: '', showFrom: addDays_(nextDue, -repeatLead(rec.repeat)) });
    }
  } else if (req.status === 'open') {
    rec.status = 'open';
    rec.doneAt = '';
    var copy = req.removeId ? rowOf_(req.removeId) : 0;
    if (copy) sheet_().deleteRow(copy);
    row = rowOf_(req.id);
  }
  writeRow_(row, rec);
  return { id: req.id };
}
