/*
 * Turns one spoken sentence into a task, an idea or a note on an idea, with no AI and no API key.
 * Pure functions only. The phone app loads this file, and the same file is pasted into
 * Apps Script as TodoParser, so there is one copy. Dates are 'yyyy-mm-dd' strings.
 */

var TODO_GROUPS = ['买东西', '出门办', '手机办', '在家做'];
var TODO_NO_GROUP = '未分组';
var TODO_DEFAULT_DAYS = 7;
var TODO_LATER_DAYS = 30;

/* ---------- dates ---------- */

function dateMs_(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function dateStr_(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addDays_(s, n) { return dateStr_(dateMs_(s) + n * 86400000); }
function daysBetween_(from, to) { return Math.round((dateMs_(to) - dateMs_(from)) / 86400000); }
/** Monday 1 to Sunday 7. */
function weekday_(s) { return new Date(dateMs_(s)).getUTCDay() || 7; }
function monthEnd_(s, plus) {
  var p = s.split('-').map(Number);
  return dateStr_(Date.UTC(p[0], p[1] - 1 + (plus || 0) + 1, 0));
}
function dayOfMonth_(s, plus, day) {
  var p = s.split('-').map(Number), last = Number(monthEnd_(s, plus).slice(8));
  return dateStr_(Date.UTC(p[0], p[1] - 1 + plus, Math.min(day, last)));
}
function addMonths_(s, n) { return dayOfMonth_(s, n, Number(s.slice(8))); }
function weekOf_(today, weeksAhead, day) { return addDays_(today, 7 * weeksAhead + day - weekday_(today)); }
/** The next time this weekday comes round. today counts when orToday is set. */
function nextWeekday_(today, day, orToday) {
  var gap = (day - weekday_(today) + 7) % 7;
  return addDays_(today, gap === 0 && !orToday ? 7 : gap);
}
function nextDayOfMonth_(today, day, orToday) {
  var d = dayOfMonth_(today, 0, day);
  return d > today || (orToday && d === today) ? d : dayOfMonth_(today, 1, day);
}
function weekend_(today) { return weekday_(today) === 7 ? today : weekOf_(today, 0, 6); }

/* ---------- numbers ---------- */

var NUM_ = '[0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十]+';
var CN_DIGITS_ = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function toNum_(s) {
  if (/^[0-9.]+$/.test(s)) return Number(s);
  var at = s.indexOf('十');
  if (at < 0) return CN_DIGITS_[s];
  return (at === 0 ? 1 : CN_DIGITS_[s.slice(0, at)]) * 10 + (s.slice(at + 1) ? CN_DIGITS_[s.slice(at + 1)] : 0);
}
var EN_NUMS_ = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function enNum_(s) { return /^[0-9.]+$/.test(s) ? Number(s) : EN_NUMS_[s]; }
function cnDay_(s) { return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[s] || Number(s); }

var EN_DAYS_ = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7 };
var EN_DAY_ = '(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?';
function enDay_(s) { return EN_DAYS_[s.slice(0, 3)] || EN_DAYS_[s]; }

/* ---------- repeats ---------- */

var WEEK_ = '(?:周|星期|礼拜)';
var REPEAT_RULES_ = [
  [new RegExp('每(?:个)?' + WEEK_ + '([一二三四五六日天1-7])'), function (m) { return 'w' + cnDay_(m[1]); }],
  [new RegExp('每(?:个)?月(' + NUM_ + ')[号日]'), function (m) { return 'm' + toNum_(m[1]); }],
  [/每隔?半个?月/, function () { return '2w'; }],
  [/每隔?半年/, function () { return '6m'; }],
  [/每隔?一?年/, function () { return '12m'; }],
  [new RegExp('每隔?(' + NUM_ + ')(?:个)?' + WEEK_), function (m) { return toNum_(m[1]) + 'w'; }],
  [new RegExp('每隔?(' + NUM_ + ')个半月'), function (m) { return (toNum_(m[1]) + 0.5) + 'm'; }],
  [new RegExp('每隔?(' + NUM_ + ')个月'), function (m) { return toNum_(m[1]) + 'm'; }],
  [new RegExp('每隔?(' + NUM_ + ')[天日]'), function (m) { return toNum_(m[1]) + 'd'; }],
  [new RegExp('每(?:个)?' + WEEK_), function () { return '1w'; }],
  [/每(?:个)?月/, function () { return '1m'; }],
  [/每[天日]/, function () { return '1d'; }],
  [/\b(?:every day|daily)\b/i, function () { return '1d'; }],
  [new RegExp('\\bevery ' + EN_DAY_ + '\\b', 'i'), function (m) { return 'w' + enDay_(m[1].toLowerCase()); }],
  [/\bevery ([0-9]+(?:\.[0-9]+)?|two|three|four|five|six|seven|eight|nine|ten) days\b/i, function (m) { return enNum_(m[1].toLowerCase()) + 'd'; }],
  [/\bevery ([0-9]+(?:\.[0-9]+)?|two|three|four|five|six|seven|eight|nine|ten) weeks?\b/i, function (m) { return enNum_(m[1].toLowerCase()) + 'w'; }],
  [/\bevery ([0-9]+(?:\.[0-9]+)?|two|three|four|five|six|seven|eight|nine|ten) months?\b/i, function (m) { return enNum_(m[1].toLowerCase()) + 'm'; }],
  [/\b(?:every week|weekly)\b/i, function () { return '1w'; }],
  [/\b(?:every month|monthly)\b/i, function () { return '1m'; }]
];

var REPEAT_COUNT_ = /^(\d+(?:\.\d+)?)([dwm])$/;
var REPEAT_MAX_DAYS_ = 366;

/** Roughly how many days apart the rounds are. */
function repeatDays_(repeat) {
  var m = REPEAT_COUNT_.exec(repeat);
  if (m) return Number(m[1]) * { d: 1, w: 7, m: 30 }[m[2]];
  return repeat.charAt(0) === 'w' ? 7 : 30;
}

/** When a repeating task comes back after it is done. 1.5m is one calendar month and then 15 days. */
function nextRepeat(repeat, from) {
  var m = REPEAT_COUNT_.exec(repeat);
  if (m) {
    var n = Number(m[1]);
    if (m[2] !== 'm') return addDays_(from, Math.max(1, Math.round(n * (m[2] === 'w' ? 7 : 1))));
    var whole = Math.floor(n);
    return addDays_(addMonths_(from, whole), Math.round((n - whole) * 30));
  }
  if (repeat.charAt(0) === 'w') return nextWeekday_(from, Number(repeat.slice(1)));
  return nextDayOfMonth_(from, Number(repeat.slice(1)));
}

/**
 * The next round after finishing a repeating task: on the plan, counted from its due date,
 * not from the day it was finished. Rounds already gone by are skipped, so it is after today.
 */
function nextRound(repeat, due, today) {
  var next = nextRepeat(repeat, due || today);
  for (var i = 0; next <= today && i < 5000; i++) next = nextRepeat(repeat, next);
  return next;
}

/**
 * How many days before it is due the next round shows again: about a fifth of the interval,
 * from 1 to 7 days, so a monthly task waits out of sight until the week it matters. Daily: on the day.
 */
function repeatLead(repeat) {
  var days = repeatDays_(repeat);
  return days <= 1 ? 0 : Math.min(7, Math.max(1, Math.round(days / 5)));
}

function repeatLabel(repeat) {
  if (!repeat) return '';
  var m = REPEAT_COUNT_.exec(repeat);
  if (m) {
    var unit = { d: '天', w: '周', m: '月' }[m[2]];
    return m[1] === '1' ? '每' + unit : '每' + m[1] + (m[2] === 'm' ? '个' : '') + unit;
  }
  if (repeat.charAt(0) === 'w') return '每周' + '一二三四五六日'.charAt(Number(repeat.slice(1)) - 1);
  return '每月' + repeat.slice(1) + '号';
}

function isRepeat(s) {
  s = String(s || '');
  var m = REPEAT_COUNT_.exec(s);
  if (m) return Number(m[1]) > 0 && repeatDays_(s) <= REPEAT_MAX_DAYS_;
  return /^(w[1-7]|m([1-9]|[12]\d|3[01]))$/.test(s);
}

/* ---------- date phrases ---------- */

var LEAD_ = '(?:必须在|最好在|要在|得在|截止到?|大概|大约|差不多|最晚|最迟|在|到)?';
var CLOCK_ = '(?:早上|上午|中午|下午|傍晚|晚上)?';
var TAIL_ = '(?:之内|以内|之前|以前|之后|以后|内|前|后)?(?:吧|啊)?(?:要|得|需要)?(?:完成|做完|搞定|弄好|办好|处理好|处理掉)?';
var ZH_END_ = '(?:之内|以内|之前|之后|以后|内|前|后|完成|做完|搞定|弄好|办好|左右|$|(?=[,,。.!!??;; ]))';
function zh_(body) { return new RegExp(LEAD_ + '(?:' + body + ')' + CLOCK_ + TAIL_); }

var DATE_RULES_ = [
  [zh_('不太?(?:着)?急|不赶|有空|有时间|抽空|以后再说|慢慢来|什么时候都行'), function (m, t) { return addDays_(t, TODO_LATER_DAYS); }],
  [zh_('今天|今日|今晚|今早|今儿|当天|现在|马上|立刻|立即|赶紧|赶快|尽快|尽早|越快越好|很急|着急|紧急'), function (m, t) { return t; }],
  [zh_('明天|明日|明早|明晚|明儿'), function (m, t) { return addDays_(t, 1); }],
  [zh_('大后天'), function (m, t) { return addDays_(t, 3); }],
  [zh_('后天'), function (m, t) { return addDays_(t, 2); }],
  [zh_('这两天|过两天'), function (m, t) { return addDays_(t, 2); }],
  [zh_('这几天|过几天'), function (m, t) { return addDays_(t, 3); }],

  [new RegExp(LEAD_ + '(' + NUM_ + ')个?[天日]' + ZH_END_ + TAIL_), function (m, t) { return addDays_(t, toNum_(m[1])); }],
  [new RegExp(LEAD_ + '(' + NUM_ + ')个?' + WEEK_ + ZH_END_ + TAIL_), function (m, t) { return addDays_(t, 7 * toNum_(m[1])); }],
  [new RegExp(LEAD_ + '(' + NUM_ + ')个月' + ZH_END_ + TAIL_), function (m, t) { return addMonths_(t, toNum_(m[1])); }],
  [zh_('半个?月'), function (m, t) { return addDays_(t, 14); }],
  [zh_('半年'), function (m, t) { return addMonths_(t, 6); }],

  [zh_('下下' + WEEK_ + '([一二三四五六日天1-7])'), function (m, t) { return weekOf_(t, 2, cnDay_(m[1])); }],
  [zh_('下下' + WEEK_), function (m, t) { return weekOf_(t, 2, 7); }],
  [zh_('下个?' + WEEK_ + '([一二三四五六日天1-7])'), function (m, t) { return weekOf_(t, 1, cnDay_(m[1])); }],
  [zh_('下个?周末'), function (m, t) { return weekOf_(t, 1, 6); }],
  [zh_('下个?' + WEEK_), function (m, t) { return weekOf_(t, 1, 7); }],
  [zh_('[这本]?个?周末'), function (m, t) { return weekend_(t); }],
  [zh_('[这本]个?' + WEEK_ + '([一二三四五六日天1-7])'), function (m, t) { return nextWeekday_(t, cnDay_(m[1]), true); }],
  [zh_(WEEK_ + '([一二三四五六日天1-7])'), function (m, t) { return nextWeekday_(t, cnDay_(m[1]), true); }],
  [zh_('[这本]个?' + WEEK_), function (m, t) { return weekOf_(t, 0, 7); }],

  [zh_('下个?月底'), function (m, t) { return monthEnd_(t, 1); }],
  [new RegExp(LEAD_ + '下个?月(' + NUM_ + ')[号日]' + CLOCK_ + TAIL_), function (m, t) { return dayOfMonth_(t, 1, toNum_(m[1])); }],
  [zh_('下个?月'), function (m, t) { return monthEnd_(t, 1); }],
  [zh_('[这本]?个?月底|[这本]个?月'), function (m, t) { return monthEnd_(t, 0); }],
  [new RegExp(LEAD_ + '(' + NUM_ + ')月(' + NUM_ + ')[号日]' + CLOCK_ + TAIL_), function (m, t) {
    var mon = toNum_(m[1]), day = toNum_(m[2]);
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    var d = t.slice(0, 4) + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return d >= t ? d : (Number(t.slice(0, 4)) + 1) + d.slice(4);
  }],
  [new RegExp(LEAD_ + '(' + NUM_ + ')[号日](?!楼|电池|线|门|店|机|车|床|房|码)' + CLOCK_ + TAIL_), function (m, t) {
    var day = toNum_(m[1]);
    return day >= 1 && day <= 31 ? nextDayOfMonth_(t, day, true) : null;
  }],
  [/(?:^|[^0-9/])((?:1[0-2]|0?[1-9])\/(?:[12][0-9]|3[01]|0?[1-9]))(?![0-9/])/, function (m, t) {
    var p = m[1].split('/').map(Number);
    var d = t.slice(0, 4) + '-' + String(p[0]).padStart(2, '0') + '-' + String(p[1]).padStart(2, '0');
    return d >= t ? d : (Number(t.slice(0, 4)) + 1) + d.slice(4);
  }],

  [/\b(?:no rush|whenever|someday)\b/i, function (m, t) { return addDays_(t, TODO_LATER_DAYS); }],
  [/\b(?:by |before )?(?:today|tonight|asap|right now)\b/i, function (m, t) { return t; }],
  [/\b(?:by |before |on )?(?:the )?day after tomorrow\b/i, function (m, t) { return addDays_(t, 2); }],
  [/\b(?:by |before |on )?tomorrow\b/i, function (m, t) { return addDays_(t, 1); }],
  [/\b(?:within|in) (?:the next )?([0-9]+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) days?\b/i, function (m, t) { return addDays_(t, enNum_(m[1].toLowerCase())); }],
  [/\b(?:within|in) (?:the next )?([0-9]+|a|one|two|three|four|five|six) weeks?\b/i, function (m, t) { return addDays_(t, 7 * enNum_(m[1].toLowerCase())); }],
  [/\b(?:within|in) (?:the next )?([0-9]+|a|one|two|three|four|five|six) months?\b/i, function (m, t) { return addMonths_(t, enNum_(m[1].toLowerCase())); }],
  [/\b(?:by |before )?(?:the )?end of (?:the |this )?month\b/i, function (m, t) { return monthEnd_(t, 0); }],
  [/\b(?:by |before )?next month\b/i, function (m, t) { return monthEnd_(t, 1); }],
  [new RegExp('\\b(?:by |before |on )?next ' + EN_DAY_ + '\\b', 'i'), function (m, t) { return weekOf_(t, 1, enDay_(m[1].toLowerCase())); }],
  [/\b(?:by |before )?next week\b/i, function (m, t) { return weekOf_(t, 1, 7); }],
  [/\b(?:by |before )?(?:this |the )?weekend\b/i, function (m, t) { return weekend_(t); }],
  [/\b(?:by |before )?(?:the end of )?this week\b/i, function (m, t) { return weekOf_(t, 0, 7); }],
  [new RegExp('\\b(?:by |before |on |this )' + EN_DAY_ + '\\b', 'i'), function (m, t) { return nextWeekday_(t, enDay_(m[1].toLowerCase()), true); }]
];

/** The earliest phrase in the sentence wins; at the same spot, the longest. */
function findDate_(text, today) {
  var best = null;
  DATE_RULES_.forEach(function (rule) {
    var m = rule[0].exec(text);
    if (!m || !m[0]) return;
    var due = rule[1](m, today);
    if (!due) return;
    if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length)) {
      best = { index: m.index, length: m[0].length, due: due };
    }
  });
  return best;
}

/* ---------- groups ---------- */

var GROUP_RULES_ = [
  ['买东西', /买|购|下单|补货|囤|尿布|尿不湿|纸尿裤|奶粉|奶瓶|维生素|勺子|牙膏|纸巾|湿巾|\b(?:buy|order|get some)\b|diaper/i],
  ['手机办', /转账|转钱|打钱|汇款|付款|缴费|交费|交钱|还款|还钱|报销|理赔|续费|退款|预约|挂号|订票|订酒店|订位|申请|claim|transfer|renew|\bpay\b|\bbook\b/i],
  ['出门办', /车|保养|打气|轮胎|加油|年检|银行|医院|诊所|打针|疫苗|取快递|取件|寄|邮局|理发|剪头发|\b(?:car|tyres?|tires?|clinic|hospital|bank)\b/i],
  ['在家做', /打扫|收拾|整理|扔垃圾|倒垃圾|做饭|换床单|清理|拖地|洗衣|洗碗|\b(?:clean|tidy|laundry)\b/i]
];

function guessGroup(text) {
  for (var i = 0; i < GROUP_RULES_.length; i++) if (GROUP_RULES_[i][1].test(text)) return GROUP_RULES_[i][0];
  return TODO_NO_GROUP;
}

/* ---------- the sentence ---------- */

var FRONT_FILLER_ = /^(?:嗯+|呃+|啊+|哦+|唉+|那个|这个|对了|哦对了|还有|然后|就是|提醒我?一下|提醒我|帮我记一下|帮我记|记一下|记得|别忘了|别忘记|不要忘了|我要|我得|我需要|要|得|需要|remember to|remind me to)[\s,,。.、::]*/i;
var BACK_FILLER_ = /[\s,,。.、::]*(?:完成|做完|搞定|弄好|办好|要|吧|啊|呀|哦|了吧)$/;

function tidy_(s) {
  s = s.replace(/\s+/g, ' ').replace(/ ?([,,。、!!??;;]) ?/g, '$1').replace(/([,,。、!!??;;]){2,}/g, '$1');
  s = s.replace(/^[\s,,。.、!!??;;::]+|[\s,,。.、!!??;;::]+$/g, '');
  var before;
  do {
    before = s;
    s = s.replace(FRONT_FILLER_, '').replace(BACK_FILLER_, '');
    s = s.replace(/^[\s,,。.、!!??;;::]+|[\s,,。.、!!??;;::]+$/g, '');
  } while (s !== before);
  return s;
}

function cut_(s, index, length) { return s.slice(0, index) + ' ' + s.slice(index + length); }

/** iPhone dictation types full-width punctuation, and sometimes digits. The rules above work on the plain forms. */
function halfWidth_(s) {
  return s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/　/g, ' ');
}
/** A comma left between Chinese clauses goes back to the full-width one for display. */
function fullComma_(s) { return s.replace(/([一-鿿]),(?=[一-鿿])/g, '$1，'); }

/** Returns { text, due, dated, group, repeat }. dated is false when no date was said. */
function parseTodo(raw, today) {
  var text = halfWidth_(String(raw || '')).trim(), repeat = '', firstDue = null;
  for (var i = 0; i < REPEAT_RULES_.length; i++) {
    var m = REPEAT_RULES_[i][0].exec(text);
    if (m) {
      repeat = REPEAT_RULES_[i][1](m);
      text = cut_(text, m.index, m[0].length);
      break;
    }
  }
  var found = findDate_(text, today);
  if (found) text = cut_(text, found.index, found.length);
  if (repeat) {
    var fixedDay = /^[wm]/.test(repeat);
    firstDue = fixedDay ? (repeat.charAt(0) === 'w' ? nextWeekday_(today, Number(repeat.slice(1)), true) : nextDayOfMonth_(today, Number(repeat.slice(1)), true)) : nextRepeat(repeat, today);
    var byDefault = addDays_(today, TODO_DEFAULT_DAYS);
    if (!fixedDay && firstDue > byDefault) firstDue = byDefault;
  }
  var clean = fullComma_(tidy_(text)) || String(raw || '').trim();
  return {
    text: clean.slice(0, 200),
    due: found ? found.due : firstDue || addDays_(today, TODO_DEFAULT_DAYS),
    dated: !!(found || repeat),
    group: guessGroup(clean),
    repeat: repeat
  };
}

/* ---------- shopping ---------- */

/** What to search a shop for: "买维生素D" gives "维生素D". */
function buyWord(text) {
  text = String(text || '');
  return text.replace(/^.*?(?:购买|买)/, '').replace(/^\s*buy\s+/i, '').trim() || text.trim();
}

/* ---------- ideas ---------- */

var IDEA_KINDS = ['改进', '新东西', '赚钱'];
var IDEA_DEFAULT_KIND = '新东西';
/** new: just logged. doing: being built. usable: works, still being improved. shelved: put aside. */
var IDEA_STAGES = ['new', 'doing', 'usable', 'shelved'];
/** An idea left in 'doing' this long without an update gets a gentle nudge to ship a usable version. */
var IDEA_STALE_DAYS = 21;
// 想法子 means "find a way", so it stays a todo.
var IDEA_KEY_ = /^(?:想法(?!子)|灵感|点子|ideas?\b)[\s:,.;!、。…-]*/i;
// 补充剂 is a supplement, and 补充维生素 has no separator after a name, so both stay todos.
var NOTE_KEY_ = /^补充(?!剂)\s*/;
var NOTE_SEP_ = /\s*[:;,.!?、。]\s*/;
var IDEA_KIND_RULES_ = [
  ['赚钱', /赚钱|挣钱|收入|副业|变现|收费|付费|卖|客户|生意|money|income|sell|paid|revenue/i],
  ['改进', /改进|优化|改一下|改成|加个|加一个|增加|新增|功能|app|应用|待办|记账|todo|improve/i]
];

/** The idea text when the sentence starts with 想法, 灵感, 点子 or idea; otherwise null. */
function isIdea(raw) {
  var s = halfWidth_(String(raw || '')).trim(), m = IDEA_KEY_.exec(s);
  if (!m) return null;
  var rest = fullComma_(s.slice(m[0].length).trim());
  return rest ? rest.slice(0, 500) : null;
}

function ideaKind(text) {
  for (var i = 0; i < IDEA_KIND_RULES_.length; i++) if (IDEA_KIND_RULES_[i][1].test(text)) return IDEA_KIND_RULES_[i][0];
  return IDEA_DEFAULT_KIND;
}

function ideaStale(idea, today) {
  if (idea.stage !== 'doing') return false;
  var since = String(idea.updatedAt || idea.createdAt || today).slice(0, 10);
  return daysBetween_(since, today) >= IDEA_STALE_DAYS;
}

/**
 * "补充 发票流程：先用 Gmail 标签" gives { name: '发票流程', note: '先用 Gmail 标签' }.
 * "补充：先用 Gmail 标签" gives an empty name, meaning the idea updated last. Otherwise null.
 */
function parseNote_(raw) {
  var s = halfWidth_(String(raw || '')).trim(), m = NOTE_KEY_.exec(s);
  if (!m) return null;
  var rest = s.slice(m[0].length), lead = /^[:;,.!?、。]\s*/.exec(rest);
  if (lead) return { name: '', note: rest.slice(lead[0].length).trim() };
  var sep = NOTE_SEP_.exec(rest) || /\s+/.exec(rest);
  if (!sep) return null;
  return { name: rest.slice(0, sep.index).trim(), note: rest.slice(sep.index + sep[0].length).trim() };
}

function bigrams_(s) {
  s = halfWidth_(String(s || '')).toLowerCase().replace(/[\s.,:;!?'"()\[\]、。，：；！？“”‘’（）…\-]/g, '');
  var out = {};
  if (s.length === 1) out[s] = true;
  for (var i = 0; i + 1 < s.length; i++) out[s.substr(i, 2)] = true;
  return out;
}
function byRecent_(a, b) { return String(a.updatedAt || a.createdAt) < String(b.updatedAt || b.createdAt) ? 1 : -1; }

/**
 * The idea a note is meant for. With a name: the idea sharing at least half of its two-character
 * pieces, best first. Without one: the idea updated most recently, leaving out shelved ones.
 */
function matchIdea(name, ideas) {
  ideas = (ideas || []).slice().sort(byRecent_);
  if (!name) return ideas.filter(function (i) { return i.stage !== 'shelved'; })[0] || null;
  var want = Object.keys(bigrams_(name)), best = null, bestScore = 0.5;
  if (!want.length) return null;
  ideas.forEach(function (idea) {
    var have = bigrams_(idea.text), shared = want.filter(function (g) { return have[g]; }).length;
    var score = shared / want.length;
    if (score > bestScore || (score === bestScore && !best)) { best = idea; bestScore = score; }
  });
  return best;
}

/**
 * What one sentence is: { type: 'note', id, note }, { type: 'idea', text, kind } or { type: 'todo' }.
 * A 补充 that names no known idea stays a todo, so "补充维生素D，两周内" is still a chore.
 */
function readCapture(raw, ideas) {
  var n = parseNote_(raw);
  if (n && n.note) {
    var note = fullComma_(n.note).slice(0, 500);
    var target = matchIdea(n.name, ideas);
    if (target) return { type: 'note', id: target.id, note: note };
    if (!n.name) return { type: 'idea', text: note, kind: ideaKind(note) };
  }
  var idea = isIdea(raw);
  if (idea) return { type: 'idea', text: idea, kind: ideaKind(idea) };
  return { type: 'todo' };
}

/** Notes are dated lines, newest first, so the sheet stays readable. */
function noteLine(day, text) { return day + ' ' + String(text || '').replace(/\s*\n+\s*/g, ' ').trim(); }
function addNote(notes, line) {
  var lines = notes ? String(notes).split('\n') : [];
  if (lines.indexOf(line) >= 0) return lines.join('\n');
  return [line].concat(lines).join('\n');
}
/** A finished note starts with ✓, so it reads plainly in the sheet: "✓ 2026-11-12 先用 Gmail 标签". */
var NOTE_DONE_ = '✓ ';
function noteDone(line) { return String(line).indexOf(NOTE_DONE_) === 0; }
/** { done, day, text } for showing one note line. */
function readNote(line) {
  var done = noteDone(line), rest = done ? line.slice(NOTE_DONE_.length) : line;
  return { done: done, day: rest.slice(0, 10), text: rest.slice(11) };
}
/** Ticks an open note or unticks a finished one. The line may be given in either form. */
function toggleNote(notes, line) {
  var lines = notes ? String(notes).split('\n') : [];
  var plain = noteDone(line) ? line.slice(NOTE_DONE_.length) : line;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === plain) { lines[i] = NOTE_DONE_ + plain; break; }
    if (lines[i] === NOTE_DONE_ + plain) { lines[i] = plain; break; }
  }
  return lines.join('\n');
}
function removeNote(notes, line) {
  var lines = notes ? String(notes).split('\n') : [], at = lines.indexOf(line);
  if (at >= 0) lines.splice(at, 1);
  return lines.join('\n');
}
