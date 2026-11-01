/*
 * Runs tests/run.html without a browser, for the deploy job.
 * It loads the same scripts in the same order, so the page stays the one list of tests.
 * Exits with an error when any test fails, which stops the deploy.
 */
var fs = require('fs'), path = require('path'), vm = require('vm');

var dir = __dirname;
var html = fs.readFileSync(path.join(dir, 'run.html'), 'utf8');
var out = { textContent: '' };
var context = vm.createContext({ document: { getElementById: function () { return out; }, title: '' } });

var tag = /<script(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g, match, count = 0;
while ((match = tag.exec(html))) {
  var file = match[1] ? path.join(dir, match[1]) : 'run.html';
  vm.runInContext(match[1] ? fs.readFileSync(file, 'utf8') : match[2], context, { filename: file });
  count++;
}

console.log(out.textContent.trim());
var result = /^(\d+) passed, (\d+) failed/.exec(out.textContent);
if (!count || !result || Number(result[1]) === 0 || Number(result[2]) !== 0) process.exit(1);
