/**
 * Morning push through ntfy. Set NTFY_TOPIC in script properties to a long random name, subscribe to it
 * in the ntfy app, then run turnOnPush once. Without a topic nothing is sent.
 */

var PUSH_HOUR = 8;
var PUSH_MAX_TASKS = 5;

/** Run once from the editor. */
function turnOnPush() {
  turnOffPush();
  ScriptApp.newTrigger('morningPush').timeBased().atHour(PUSH_HOUR).everyDays(1).inTimezone('Asia/Singapore').create();
  SpreadsheetApp.getUi().alert('Morning push is on. It sends around ' + PUSH_HOUR + 'am on days with something due. Run sendPushNow to test it.');
}

function turnOffPush() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'morningPush') ScriptApp.deleteTrigger(t);
  });
}

/**
 * The message for one morning, or null on a day with nothing due today or overdue.
 * Overdue first. No guilt wording: a task simply shows how long it has waited.
 */
function pushMessage_(todos, today) {
  var yesterday = addDays_(today, -1), sunday = weekOf_(today, 0, 7);
  var open = todos.filter(function (t) { return t.status === 'open'; });
  var overdue = open.filter(function (t) { return t.due < today; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
  var dueToday = open.filter(function (t) { return t.due === today; });
  if (!overdue.length && !dueToday.length) return null;
  var doneYesterday = todos.filter(function (t) { return t.status === 'done' && String(t.doneAt).slice(0, 10) === yesterday; }).length;
  // A repeating task waiting to reappear does not count; it is out of sight on purpose.
  var later = open.filter(function (t) { return t.due > today && t.due <= sunday && !(t.showFrom > today); }).length;

  var title = '今天 ' + dueToday.length + ' 件' + (overdue.length ? ' · 过期 ' + overdue.length + ' 件' : '');
  var list = overdue.concat(dueToday), lines = [];
  if (doneYesterday) lines.push('昨天完成 ' + doneYesterday + ' 件 👏');
  list.slice(0, PUSH_MAX_TASKS).forEach(function (t) {
    lines.push(t.due < today ? '⚠️ ' + t.text + '（过期' + daysBetween_(t.due, today) + '天）' : t.text);
  });
  if (list.length > PUSH_MAX_TASKS) lines.push('还有 ' + (list.length - PUSH_MAX_TASKS) + ' 件');
  if (later) lines.push('这周还有 ' + later + ' 件');
  return { title: title, body: lines.join('\n') };
}

function sendPush_(message) {
  var props = PropertiesService.getScriptProperties();
  var topic = props.getProperty('NTFY_TOPIC');
  if (!topic) return false;
  var payload = { topic: topic, title: message.title, message: message.body };
  var appUrl = props.getProperty('APP_URL');
  if (appUrl) payload.click = appUrl;
  // The JSON form is used because ntfy's plain headers cannot carry Chinese titles.
  UrlFetchApp.fetch('https://ntfy.sh/', { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload) });
  return true;
}

/** Runs from the daily trigger. */
function morningPush() {
  var message = pushMessage_(loadTodos_(), todayStr_());
  if (message) sendPush_(message);
}

/** Run from the editor to test. Sends even on a day with nothing due. */
function sendPushNow() {
  var message = pushMessage_(loadTodos_(), todayStr_()) || { title: '今天没有到期的事', body: '这是一条测试推送' };
  if (!sendPush_(message)) SpreadsheetApp.getUi().alert('Set NTFY_TOPIC in Project Settings > Script properties first.');
}
