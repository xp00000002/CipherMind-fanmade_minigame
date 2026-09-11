/* spider-solver.js - 蜘蛛纸牌求解器（移植自 Credible-Spider 的 DFS+估值函数） */
(function (global) {
  'use strict';

  function makeDeck(suitNum) {
    var result = [];
    if (suitNum === 1) {
      for (var i = 0; i < 8; i++) for (var j = 1; j <= 13; j++) result.push({ suit: 4, point: j, show: false });
    } else if (suitNum === 2) {
      for (var i = 0; i < 8; i++) for (var j = 1; j <= 13; j++) result.push({ suit: (i > 3) ? 3 : 4, point: j, show: false });
    } else {
      for (var i = 0; i < 8; i++) for (var j = 1; j <= 13; j++) result.push({ suit: (i % 4) + 1, point: j, show: false });
    }
    return result;
  }
  function newPoker(suitNum, deck) {
    return {
      suitNum: suitNum,
      desk: [],
      corner: [],
      finished: 0
    };
  }
  function deal(suitNum, deck, p) {
    p.suitNum = suitNum;
    p.desk = [];
    p.corner = [];
    p.finished = 0;
    var cards = deck.slice();
    for (var i = 0; i < 4; i++) p.desk.push(cards.slice(i * 6, i * 6 + 6));
    for (var i = 0; i < 6; i++) p.desk.push(cards.slice(24 + i * 5, 24 + i * 5 + 5));
    for (var i = 0; i < 5; i++) p.corner.push(cards.slice(54 + i * 10, 54 + i * 10 + 10));
    for (var i = 0; i < 10; i++) if (p.desk[i].length) p.desk[i][p.desk[i].length - 1].show = true;
  }
  function canPick(p, orig, num) {
    if (num < 1 || num > p.desk[orig].length) return false;
    var col = p.desk[orig];
    var suit = col[col.length - 1].suit;
    var point = col[col.length - 1].point;
    for (var i = 0; i < num - 1; i++) {
      var index = col.length - i - 2;
      var card = col[index];
      if (card.suit !== suit) return false;
      if (card.show === false) return false;
      if (point + 1 === card.point) point++;
      else return false;
    }
    return true;
  }
  function canMove(p, orig, dest, num) {
    if (!canPick(p, orig, num)) return false;
    var destCards = p.desk[dest];
    if (!destCards.length) return true;
    return p.desk[orig][p.desk[orig].length - num].point + 1 === destCards[destCards.length - 1].point;
  }
  function restore(p) {
    for (var i = 0; i < 10; i++) {
      var col = p.desk[i];
      var n = col.length;
      if (n < 13) continue;
      if (col[n - 1].point !== 1) continue;
      var suit = col[n - 1].suit;
      var ok = true;
      for (var j = 1; j < 13; j++) {
        var card = col[n - 1 - j];
        if (card.suit !== suit || card.point !== j + 1) { ok = false; break; }
      }
      if (ok) {
        col.splice(n - 13, 13);
        p.finished++;
        if (col.length && col[col.length - 1].show === false) col[col.length - 1].show = true;
      }
    }
  }
  function doMove(p, orig, dest, num) {
    if (!canMove(p, orig, dest, num)) return false;
    var run = p.desk[orig].splice(p.desk[orig].length - num, num);
    p.desk[dest].push.apply(p.desk[dest], run);
    if (p.desk[orig].length && p.desk[orig][p.desk[orig].length - 1].show === false) p.desk[orig][p.desk[orig].length - 1].show = true;
    restore(p);
    return true;
  }
  function releaseCorner(p) {
    if (!p.corner.length) return false;
    var sum = 0, hasEmpty = false;
    for (var i = 0; i < 10; i++) {
      sum += p.desk[i].length;
      if (!p.desk[i].length) hasEmpty = true;
    }
    if (hasEmpty && sum >= 10) return false;
    var pile = p.corner[p.corner.length - 1];
    for (var i = 0; i < 10; i++) {
      pile[i].show = true;
      p.desk[i].push(pile[i]);
    }
    p.corner.pop();
    restore(p);
    return true;
  }
  function getValue(p) {
    var value = p.finished * 200;
    for (var i = 0; i < 10; i++) {
      var cards = p.desk[i];
      if (!cards.length) continue;
      var add = function (num, topPoint) { if (num) value += topPoint * num; };
      var num = 0;
      var pTop = cards[cards.length - 1];
      var pDown = cards[cards.length - 1];
      for (var j = cards.length - 2; j >= 0; j--) {
        if (cards[j].show === false) break;
        pTop = cards[j];
        pDown = cards[j + 1];
        if (pTop.point === pDown.point + 1) {
          if (pTop.suit === pDown.suit) num++;
          else {
            add(num, pDown.point);
            add(1, 1);
            num = 0;
          }
        } else {
          add(num, pDown.point);
          num = 0;
          var dv = -Math.max(pTop.point, pDown.point);
          if (pTop.point < pDown.point) dv *= 2;
          add(1, dv);
        }
      }
      add(num, pTop.point);
      var h = 10;
      for (var k = 0; k < cards.length; k++) {
        if (cards[k].show === false) { value -= h; h--; }
        else break;
      }
    }
    return value;
  }
  function stateKey(p) {
    var parts = [];
    for (var i = 0; i < 10; i++) {
      var col = p.desk[i];
      var s = '';
      for (var j = 0; j < col.length; j++) s += col[j].suit + ':' + col[j].point + (col[j].show ? '' : 'd') + ',';
      parts.push(s);
    }
    parts.push('corner=' + p.corner.length + ' f=' + p.finished);
    return parts.join('|');
  }
  function cloneState(p) {
    var q = { suitNum: p.suitNum, desk: [], corner: [], finished: p.finished };
    for (var i = 0; i < 10; i++) {
      var col = [];
      for (var j = 0; j < p.desk[i].length; j++) {
        var c = p.desk[i][j];
        col.push({ suit: c.suit, point: c.point, show: c.show });
      }
      q.desk.push(col);
    }
    for (var k = 0; k < p.corner.length; k++) {
      var pile = [];
      for (var m = 0; m < p.corner[k].length; m++) {
        var c2 = p.corner[k][m];
        pile.push({ suit: c2.suit, point: c2.point, show: c2.show });
      }
      q.corner.push(pile);
    }
    return q;
  }
  // 生成全部动作（含状态去重与估值）
  function getAllOperator(p, states) {
    var actions = [];
    var emptyIndex = [];
    for (var i = 0; i < 10; i++) if (!p.desk[i].length) emptyIndex.push(i);
    for (var d = 0; d < emptyIndex.length; d++) {
      var dest = emptyIndex[d];
      for (var orig = 0; orig < 10; orig++) {
        var col = p.desk[orig];
        if (!col.length) continue;
        var num = 1;
        while (num <= col.length && canPick(p, orig, num)) num++;
        num--;
        if (num === col.length) continue;   /* 整列移动无意义 */
        var np = cloneState(p);
        doMove(np, orig, dest, num);
        if (!states.has(stateKey(np))) actions.push({ type: 'move', orig: orig, dest: dest, num: num, value: getValue(np), state: np });
      }
    }
    for (var d2 = 0; d2 < 10; d2++) {
      var destCol = p.desk[d2];
      if (!destCol.length) continue;
      var destTop = destCol[destCol.length - 1];
      for (var orig2 = 0; orig2 < 10; orig2++) {
        if (orig2 === d2) continue;
        var col2 = p.desk[orig2];
        if (!col2.length) continue;
        if (col2[col2.length - 1].point >= destTop.point) continue;
        var num2 = 0;
        for (var it = col2.length - 1; it >= 0; it--) {
          num2++;
          if (col2[it].point >= destTop.point) break;
          if (col2[it].show === false) break;
          if (num2 > 1) {
            var itDown = it + 1;
            if (col2[itDown].point + 1 !== col2[it].point) break;
          }
          if (col2[it].point + 1 === destTop.point) {
            if (canPick(p, orig2, num2)) {
              var np2 = cloneState(p);
              doMove(np2, orig2, d2, num2);
              if (!states.has(stateKey(np2))) actions.push({ type: 'move', orig: orig2, dest: d2, num: num2, value: getValue(np2), state: np2 });
            }
            break;
          }
        }
      }
    }
    if (emptyIndex.length === 0 && p.corner.length) {
      var np3 = cloneState(p);
      releaseCorner(np3);
      actions.push({ type: 'deal', value: getValue(p) - 100, state: np3 });
    }
    return { actions: actions, emptyIndex: emptyIndex };
  }
  function autoSolve(initial, calcLimited) {
    calcLimited = calcLimited || 2000;
    var stackLimited = 400;
    var states = new Set();
    var calc = 0;
    var success = false;
    function dfs(p, depth) {
      if (p.finished === 8) { success = true; return true; }
      if (calc >= calcLimited || depth >= stackLimited) return true;
      calc++;
      var g = getAllOperator(p, states);
      var actions = g.actions;
      if (g.emptyIndex.length === 0) {
        var cur = getValue(p);
        actions = actions.filter(function (a) { return a.type !== 'move' || a.value > cur; });
      }
      actions.sort(function (a, b) { return b.value - a.value; });
      for (var i = 0; i < actions.length; i++) {
        var a = actions[i];
        var key = stateKey(a.state);
        if (states.has(key)) continue;
        states.add(key);
        if (dfs(a.state, depth + 1)) return true;
      }
      return false;
    }
    dfs(initial, 0);
    return { success: success, calc: calc };
  }
  global.SpiderSolver = {
    makeDeck: makeDeck,
    newPoker: newPoker,
    deal: deal,
    canPick: canPick,
    canMove: canMove,
    doMove: doMove,
    releaseCorner: releaseCorner,
    restore: restore,
    autoSolve: autoSolve,
    getValue: getValue,
    stateKey: stateKey,
    cloneState: cloneState,
    encodeDeck: encodeDeck,
    decodeDeck: decodeDeck
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SpiderSolver;
  // 发牌库编解码：104 张 × 6 位（LSB 先行）= 624 位 = 78 字节 → base64 104 字符
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function encodeDeck(deck) {
    var packed = new Array(78);
    for (var i = 0; i < 78; i++) packed[i] = 0;
    for (var i = 0; i < 104; i++) {
      var idx = (deck[i].point - 1) + (deck[i].suit - 1) * 13;
      var bit = i * 6;
      packed[bit >> 3] |= (idx << (bit & 7)) & 255;
      if ((bit & 7) > 2) packed[(bit >> 3) + 1] |= idx >> (8 - (bit & 7));
    }
    var s = '';
    for (var j = 0; j < 78; j += 3) {
      var v = (packed[j] << 16) | (packed[j + 1] << 8) | packed[j + 2];
      s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    }
    return s;
  }
  function decodeDeck(s) {
    var bytes = [];
    for (var i = 0; i < 78; i += 3) {
      var ci = (i / 3) * 4;
      var v = (B64.indexOf(s[ci]) << 18) | (B64.indexOf(s[ci + 1]) << 12) | (B64.indexOf(s[ci + 2]) << 6) | B64.indexOf(s[ci + 3]);
      bytes.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
    }
    var deck = [];
    for (var i = 0; i < 104; i++) {
      var bit = i * 6, b0 = bit & 7;
      var idx = (bytes[bit >> 3] >> b0) & 63;
      if (b0 > 2) idx |= ((bytes[(bit >> 3) + 1] & ((1 << (b0 - 2)) - 1)) << (8 - b0));
      deck.push({ suit: Math.floor(idx / 13) + 1, point: (idx % 13) + 1, show: false });
    }
    return deck;
  }
})(typeof window !== 'undefined' ? window : globalThis);
