/*
 * Runs a project's HTML test pages without a browser: node run-html-tests.js page.html [page.html ...]
 * It loads each page's scripts in order, so the pages stay the one list of tests.
 * A page passes by setting document.title to PASS. Any other result stops the deploy.
 */
var fs = require('fs'), path = require('path'), vm = require('vm');

var failed = false;
process.argv.slice(2).forEach(function (page) {
  var dir = path.dirname(page), html = fs.readFileSync(page, 'utf8');
  var out = { textContent: '' }, doc = { title: '', getElementById: function () { return out; } };
  var context = vm.createContext({ document: doc, console: console });
  context.window = context;
  var tag = /<script(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g, match;
  while ((match = tag.exec(html))) {
    var file = match[1] ? path.join(dir, match[1]) : page;
    vm.runInContext(match[1] ? fs.readFileSync(file, 'utf8') : match[2], context, { filename: file });
  }
  console.log(page + ': ' + out.textContent.trim());
  if (doc.title !== 'PASS') failed = true;
});
if (failed) process.exit(1);
