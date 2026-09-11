/* spider-gen-worker.js - 求解并回报可解牌局（编码后） */
var S = require('./spider-solver.js');
var suitNum = parseInt(process.argv[2] || '2', 10);
var budget = parseInt(process.argv[3] || '8000', 10);
var seedBase = parseInt(process.argv[4] || '1', 10);
var rng = mulberry32(seedBase);
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
process.on('message', function (msg) {
  if (msg.type !== 'work') return;
  var target = msg.target;
  var accepted = 0;
  var attempts = 0;
  while (accepted < target) {
    attempts++;
    var deck = S.makeDeck(suitNum);
    for (var k = deck.length - 1; k > 0; k--) {
      var j = Math.floor(rng() * (k + 1));
      var t = deck[k]; deck[k] = deck[j]; deck[j] = t;
    }
    var p = S.newPoker(suitNum);
    S.deal(suitNum, deck, p);
    var r = S.autoSolve(p, budget);
    if (r.success) {
      accepted++;
      process.send({ type: 'accepted', deck: S.encodeDeck(deck), calc: r.calc });
    }
    if (attempts % 50 === 0) {
      process.send({ type: 'progress', accepted: accepted, attempts: attempts });
    }
  }
  process.send({ type: 'done' });
});
