/* spider-gen.js - 批量生成可解蜘蛛牌局发牌库
   用法: node spider-gen.js --two <count> <outFile> [workers] [budget] [seed]
   例:   node spider-gen.js --two 10000 ../../cmchess-modify/banks/spider_bank_two.js 20 8000 20260823
*/
var cp = require('child_process');
var path = require('path');
var fs = require('fs');

var args = process.argv.slice(2);
var mode = args[0] || '--two';
var count = parseInt(args[1] || '10000', 10);
var outFile = args[2] || 'spider_bank_two.js';
var workers = parseInt(args[3] || '20', 10);
var budget = parseInt(args[4] || '8000', 10);
var seed = parseInt(args[5] || '1', 10);

var suitNum = mode === '--two' ? 2 : 1;
var perWorker = Math.ceil(count / workers);
var accepted = [];
var attempts = { total: 0 };
var doneCount = 0;
var t0 = Date.now();

function tryWrite() {
  if (accepted.length < count && doneCount < workers) return;
  var lines = accepted.slice(0, count);
  var content = 'window.SPIDER_BANK_TWO = ["' + lines.join('","') + '"];';
  fs.writeFileSync(outFile, content, 'utf8');
  var el = ((Date.now() - t0) / 1000).toFixed(0) + 's';
  console.log('WROTE ' + outFile + ' (' + lines.length + ' deals) attempts=' + attempts.total + ' elapsed=' + el);
}

for (var w = 0; w < workers; w++) {
  var child = cp.fork(path.join(__dirname, 'spider-gen-worker.js'), [String(suitNum), String(budget), String(seed + w * 7919)], { silent: true });
  child.on('message', function (m) {
    if (m.type === 'accepted') {
      accepted.push(m.deck);
      if (accepted.length % 500 === 0 || accepted.length >= count) {
        console.log('progress: accepted=' + Math.min(accepted.length, count) + '/' + count + ' elapsed=' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
      }
      tryWrite();
      if (accepted.length >= count) {
        process.exit(0);
      }
    } else if (m.type === 'progress') {
      attempts.total += m.attempts;
    } else if (m.type === 'done') {
      doneCount++;
      tryWrite();
    }
  });
  child.send({ type: 'work', target: perWorker });
}
