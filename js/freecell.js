/* freecell.js - 空当接龙（Freecell）单机逻辑 */
(function () {
  'use strict';

  var SUITS = ['s', 'h', 'c', 'd'];
  var SUIT_IMG = { s: 'texture-card/Card-Spade.png', h: 'texture-card/Card-Heart.png', c: 'texture-card/Card-Club.png', d: 'texture-card/Card-Diamond.png' };
  var SUIT_IMG_TC = { s: 'texture-card/Card-Spade-Black.png', h: 'texture-card/Card-Heart-Red.png', c: 'texture-card/Card-Club-Black.png', d: 'texture-card/Card-Diamond-Red.png' };   // 双色模式
  var RANK_IMG = {
    1: 'texture-card/Card-A.png', 2: 'texture-card/Card-2.png', 3: 'texture-card/Card-3.png',
    4: 'texture-card/Card-4.png', 5: 'texture-card/Card-5.png', 6: 'texture-card/Card-6.png',
    7: 'texture-card/Card-7.png', 8: 'texture-card/Card-8.png', 9: 'texture-card/Card-9.png',
    10: 'texture-card/Card-10.png', 11: 'texture-card/Card-J.png', 12: 'texture-card/Card-Q.png',
    13: 'texture-card/Card-K.png'
  };

  var cols = [];       // 8 个列（数组末尾为顶）
  var freecells = [];  // 4 个空当（单张或 null）
  var fnds = [];       // 4 个置牌位（数组末尾为顶）
  var sel = null;      // { type: 'col'|'free'|'fnd', a, b }

  var tableEl = document.getElementById('fc-table');
  var freeEl = document.getElementById('fc-freecells');
  var fndEl = document.getElementById('fc-foundations');
  var dollEl = document.getElementById('fc-doll');
  var dollImg = document.getElementById('fc-doll-img');
  var toastEl = document.getElementById('toast');

  function $(id) { return document.getElementById(id); }

  /* ---------- 工具 ---------- */
  var toastTimer = null;
  function toast(msg) {
    /* 聊天消息样式：追加到右上角消息层，多条堆叠，与聊天消息并存 */
    var layer = document.getElementById('chat-layer');
    if (!layer) return;
    var msgEl = document.createElement('div');
    msgEl.className = 'chat-msg show';
    var t = document.createElement('span');
    t.className = 'chat-text';
    t.textContent = msg;
    var bar = document.createElement('div');
    bar.className = 'chat-bar';
    msgEl.appendChild(t);
    msgEl.appendChild(bar);
    layer.appendChild(msgEl);
    setTimeout(function () {
      msgEl.classList.add('fade');
      setTimeout(function () { if (msgEl.parentNode) msgEl.parentNode.removeChild(msgEl); }, 300);
    }, 8000);
  }

  function showModal(el) { el.classList.remove('hidden'); Profile.adjustBtnHitAreas(); }
  function hideModal(el) { el.classList.add('hidden'); }

  /* ---------- 设置 ---------- */
  var fcSettings = {
    emptyColK: false,   // 空列仅允许K或最下方为K的牌组（新局生效）
    allowSpec: false,   // 允许观战
    open: false,        // 设为开放（仅允许观战开启时可修改）
    timer: true,        // 计时
    winScale: 1,        // 窗口缩放
    dblCascade: true,   // 双击自动置入置牌位
    transparent: true,  // 牌面透明
    suitBorder: false,  // 边框提示花色
    twoColor: false     // 双色模式
  };
  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem('fcSettings'));
      if (saved) {
        for (var k in fcSettings) {
          if (saved[k] !== undefined) fcSettings[k] = saved[k];
        }
      }
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('fcSettings', JSON.stringify(fcSettings)); } catch (e) {}
  }
  var gameSettings = { emptyColK: false };   // 新局生效的规则快照
  function isRed(card) { return card.suit === 'h' || card.suit === 'd'; }

  // 一叠牌是否为合法序列（从大到小、花色间隔）
  function validRun(cards) {
    for (var i = 1; i < cards.length; i++) {
      if (cards[i].rank !== cards[i - 1].rank - 1) return false;
      if (isRed(cards[i]) === isRed(cards[i - 1])) return false;
    }
    return true;
  }

  function canPlaceOnCol(run, colIdx) {
    var top = cols[colIdx][cols[colIdx].length - 1];
    if (!top) {
      if (gameSettings.emptyColK) {
        return !!(run[0] && run[0].rank === 13);   /* 仅允许K 或顶牌为 K 的牌组 */
      }
      return true;
    }
    return top.rank === run[0].rank + 1 && isRed(top) !== isRed(run[0]);
  }

  function canPlaceOnFnd(card, p) {
    var pile = fnds[p];
    if (!pile.length) return card.rank === 1;
    var top = pile[pile.length - 1];
    return top.suit === card.suit && card.rank === top.rank + 1;
  }

  function emptyColCount() {
    var n = 0;
    for (var i = 0; i < cols.length; i++) if (!cols[i].length) n++;
    return n;
  }
  function emptyFreeCount() {
    var n = 0;
    for (var i = 0; i < freecells.length; i++) if (!freecells[i]) n++;
    return n;
  }
  function maxMoveCount() {
    return (emptyColCount() + 1) * Math.pow(2, emptyFreeCount());
  }

  /* ---------- 联机/观战 ---------- */
  var fcParams = new URLSearchParams(location.search);
  var fcMode = fcParams.get('mode');        // 'host' | 'join' | null
  var fcJoinId = fcParams.get('id');
  var isSpec = false;                       // 观战模式（只读）
  var myPeerId = null;

  function currentState() {
    return {
      cols: cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank }; }); }),
      freecells: freecells.map(function (x) { return x ? { suit: x.suit, rank: x.rank } : null; }),
      fnds: fnds.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank }; }); }),
      elapsed: Date.now() - gameStartTime,   /* 观战者同步计时 */
      timerOn: fcSettings.timer
    };
  }
  function broadcastState() {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'fc-state', state: currentState() });
  }
  function broadcastMove(src, dst) {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'fc-move', m: { s: { t: src.type, a: src.a, b: src.b }, d: { t: dst.type, a: dst.a } } });
  }
  function applyRemoteState(st) {
    if (!st) return;
    cols = st.cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank }; }); });
    freecells = st.freecells.map(function (x) { return x ? { suit: x.suit, rank: x.rank } : null; });
    fnds = st.fnds.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank }; }); });
    sel = null;
    /* 观战者同步计时：以房主的已进行时间为基准 */
    gameStartTime = Date.now() - (st.elapsed || 0);
    if (timerEl) timerEl.classList.toggle('hidden', !st.timerOn);
    if (timerTick) { clearInterval(timerTick); timerTick = null; }
    if (st.timerOn) {
      updateTimer();
      timerTick = setInterval(updateTimer, 1000);
    }
    render();
    /* 观战者不提示通关（仅房主提示） */
  }
  function applyRemoteMove(m) {
    var s = m.s, d = m.d;
    if (s.t === 'col') {
      if (d.t === 'col') cols[d.a].push.apply(cols[d.a], cols[s.a].splice(s.b));
      else if (d.t === 'free') freecells[d.a] = cols[s.a].pop();
      else fnds[d.a].push(cols[s.a].pop());
    } else if (s.t === 'free') {
      if (d.t === 'col') { cols[d.a].push(freecells[s.a]); freecells[s.a] = null; }
      else if (d.t === 'free') { freecells[d.a] = freecells[s.a]; freecells[s.a] = null; }
      else { fnds[d.a].push(freecells[s.a]); freecells[s.a] = null; }
    } else {
      if (d.t === 'col') cols[d.a].push(fnds[s.a].pop());
      else if (d.t === 'free') freecells[d.a] = fnds[s.a].pop();
      else fnds[d.a].push(fnds[s.a].pop());
    }
    render();
    /* 观战者不提示通关（仅房主提示） */
  }

  // 开放房间注册（与 chess 共用注册表，以 game 字段区分）
  function openRoomSummary() {
    return '空当接龙' + (fcSettings.emptyColK ? ' | 仅K空列' : '');
  }
  function registerOpenRoom(id, started) {
    var hostName = (Profile.get() || {}).name || 'Player';
    var list = [];
    try {
      var raw = JSON.parse(localStorage.getItem('cmchessOpenRooms'));
      if (raw && Array.isArray(raw)) list = raw;
    } catch (e) {}
    var now = Date.now();
    list = list.filter(function (r) { return r && r.id !== id && now - (r.ts || 0) < 180000; });
    list.push({ id: id, hostName: hostName, rules: openRoomSummary(), gameStarted: !!started, allowSpec: !!fcSettings.allowSpec, noChat: false, ts: now, game: 'freecell' });
    try { localStorage.setItem('cmchessOpenRooms', JSON.stringify(list)); } catch (e) {}
  }
  function unregisterOpenRoom(id) {
    if (!id) return;
    try {
      var list = JSON.parse(localStorage.getItem('cmchessOpenRooms'));
      if (Array.isArray(list)) {
        list = list.filter(function (r) { return r && r.id !== id; });
        localStorage.setItem('cmchessOpenRooms', JSON.stringify(list));
      }
    } catch (e) {}
  }
  function syncOpenRoom() {
    if (fcMode !== 'host' || !myPeerId) return;
    if (fcSettings.open && fcSettings.allowSpec) registerOpenRoom(myPeerId, !!cols.length);
    else unregisterOpenRoom(myPeerId);
    Net.setAllowSpec(fcSettings.allowSpec);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast('复制失败，请手动复制'); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    else fallback();
  }

  function applySpecRestrictions() {
    ['opt-empty-col-k', 'opt-allow-spec', 'opt-open', 'opt-timer'].forEach(function (id) {
      var el = $(id);
      if (el) { el.disabled = true; el.classList.add('disabled'); }
    });
    var newBtn = $('btn-fc-new');
    if (newBtn) newBtn.disabled = true;
    var winNew = $('btn-fc-win-new');
    if (winNew) winNew.disabled = true;
    var viewCode = $('btn-fc-view-code');
    if (viewCode) viewCode.classList.add('hidden');
  }

  // 观战人数显示（设置页"计时"下方）
  function updateSpecCountDisplay(n) {
    var el = $('fc-spec-count');
    if (el) el.textContent = n || 0;
  }

  function initNet() {
    if (fcMode === 'host') {
      Net.connect({
        mode: 'host',
        soloSpec: true,   /* 单人游戏：观战者无需对局者即可加入 */
        name: (Profile.get() || {}).name || '',
        onId: function (id) {
          myPeerId = id;
          syncOpenRoom();
        },
        onSpecJoin: function (c) {
          c.send({ type: 'fc-state', state: currentState() });   /* 中途加入：发送当前局面 */
        },
        onSpecCount: updateSpecCountDisplay
      });
      return;
    }
    if (fcMode === 'join' && fcJoinId) {
      Net.connect({
        mode: 'join',
        hostId: fcJoinId,
        want: 'spec',
        name: (Profile.get() || {}).name || '',
        onOpen: function (role) {
          if (role === 'spec') {
            isSpec = true;
            applySpecRestrictions();
            toast('你正在观战');
          }
        },
        onMessage: function (data) {
          if (data.type === 'fc-state') applyRemoteState(data.state);
          else if (data.type === 'fc-move') applyRemoteMove(data.m);
          else if (data.type === 'spec-count') updateSpecCountDisplay(data.count);
          else if (data.type === 'kicked') specExit(data.reason || '房主已禁止观战');
        },
        onState: function (state) {
          if (state === 'closed' && isSpec) specExit('房主已退出或连接中断');
        },
        onError: function (err) {
          var msg = (err && err.message) || '连接失败';
          toast(msg === '此对局被设置为不可被观战' ? '此房间不允许观战' : msg);
          setTimeout(function () { location.href = 'index.html'; }, 1600);
        }
      });
      return;
    }
  }

  // 观战者被踢出/房主掉线：提示并返回主界面（仅一次）
  var specExited = false;
  function specExit(reason) {
    if (specExited) return;
    specExited = true;
    var text = $('fc-exit-text');
    if (text) text.textContent = reason;
    hideModal($('fc-win-modal'));
    showModal($('fc-exit-modal'));
  }

  /* ---------- 游戏状态 ---------- */
  // 随机发牌：洗牌后按列数 7/7/7/7/6/6/6/6 发到 8 列，空当留空
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  var initCols = null;
  var initFreecells = null;
  function snapshotDeal() {
    initCols = cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank }; }); });
    initFreecells = freecells.slice();
  }
  function dealPiles() {
    var deck = [];
    SUITS.forEach(function (s) {
      for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r });
    });
    shuffle(deck);
    var target = [7, 7, 7, 7, 6, 6, 6, 6];
    cols = [];
    var k = 0;
    for (var c = 0; c < 8; c++) {
      cols.push([]);
      for (var i = 0; i < target[c]; i++) cols[c].push(deck[k++]);
    }
    freecells = [null, null, null, null];
    fnds = [[], [], [], []];
    snapshotDeal();
  }

  function newGame() {
    gameSettings.emptyColK = fcSettings.emptyColK;   /* 游戏设置：新局生效 */
    resetTimer();
    dealPiles();
    sel = null;
    hideModal($('fc-win-modal'));
    hideModal($('fc-restart-modal'));
    if (fcMode === 'host' && !fcSettings.allowSpec) Net.kickSpecs('房主已禁止观战');   /* 重开时禁止观战：观战者退出 */
    render();
    broadcastState();   /* 房主：通知观战者新局局面 */
  }
  function replayGame() {
    if (!initCols) return;
    gameSettings.emptyColK = fcSettings.emptyColK;
    resetTimer();
    cols = initCols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank }; }); });
    freecells = initFreecells.slice();
    fnds = [[], [], [], []];
    sel = null;
    hideModal($('fc-win-modal'));
    hideModal($('fc-restart-modal'));
    render();
    broadcastState();
  }
  function showRestartModal() {
    hideModal($('fc-win-modal'));
    showModal($('fc-restart-modal'));
  }

  /* ---------- 渲染 ---------- */
  function cardEl(card, extraClass, src) {
    var div = document.createElement('div');
    div.className = 'fc-card' + (extraClass ? ' ' + extraClass : '');
    div.dataset.suit = card.suit;
    div.dataset.rank = card.rank;
    if (src) div.dataset.src = src;   // 源标识：col:c:i / free:c / fnd:p
    var r1 = document.createElement('img');
    r1.className = 'fc-rank';
    r1.src = RANK_IMG[card.rank];
    r1.alt = '';
    r1.draggable = false;
    var r2 = document.createElement('img');
    r2.className = 'fc-rank-br';
    r2.src = RANK_IMG[card.rank];
    r2.alt = '';
    r2.draggable = false;
    var s = document.createElement('img');
    s.className = 'fc-suit';
    s.src = (fcSettings.twoColor ? SUIT_IMG_TC : SUIT_IMG)[card.suit];
    s.alt = '';
    s.draggable = false;
    div.appendChild(r1);
    div.appendChild(r2);
    div.appendChild(s);
    return div;
  }

  function emptyCellEl() {
    var div = document.createElement('div');
    div.className = 'fc-cell fc-empty';
    return div;
  }

  function isSelCard(type, a, b) {
    return sel && sel.type === type && sel.a === a && sel.b === b;
  }

  function render() {
    renderTop();
    renderCols();
  }

  function renderTop() {
    freeEl.innerHTML = '';
    for (var i = 0; i < 4; i++) {
      var cell = document.createElement('div');
      cell.className = 'fc-cell fc-freecell';
      cell.dataset.cell = i;
      if (freecells[i]) {
        cell.appendChild(cardEl(freecells[i], isSelCard('free', i, 0) ? 'sel' : '', 'free:' + i));
      } else {
        cell.appendChild(emptyCellEl());
      }
      freeEl.appendChild(cell);
    }
    fndEl.innerHTML = '';
    for (var p = 0; p < 4; p++) {
      var pile = document.createElement('div');
      pile.className = 'fc-cell fc-foundation';
      pile.dataset.pile = p;
      if (fnds[p].length) {
        var top = fnds[p][fnds[p].length - 1];
        pile.appendChild(cardEl(top, isSelCard('fnd', p, 0) ? 'sel' : '', 'fnd:' + p));
      } else {
        pile.appendChild(emptyCellEl());
      }
      fndEl.appendChild(pile);
    }
  }

  function renderCols() {
    tableEl.innerHTML = '';
    for (var c = 0; c < 8; c++) {
      var col = document.createElement('div');
      col.className = 'fc-col';
      col.dataset.col = c;
      cols[c].forEach(function (card, idx) {
        var isSel = sel && sel.type === 'col' && sel.a === c && idx >= sel.b;   /* 序列内全部高亮 */
        var el = cardEl(card, isSel ? 'sel' : '', 'col:' + c + ':' + idx);
        el.dataset.idx = idx;
        col.appendChild(el);
      });
      tableEl.appendChild(col);
    }
    fitColumns();
  }

  // 列太长时按列增大牌的重叠面积（只压缩放不下的列，不牵连其他列）
  function fitColumns() {
    var avail = tableEl.clientHeight;
    if (!avail) return;
    for (var c = 0; c < 8; c++) {
      var col = tableEl.children[c];
      if (!col) continue;
      var len = cols[c].length;
      if (len <= 1) { col.style.removeProperty('--fc-step'); continue; }
      var card = col.querySelector('.fc-card');
      if (!card) { col.style.removeProperty('--fc-step'); continue; }
      var cardH = card.getBoundingClientRect().height;
      if (!cardH) continue;
      var defStep = cardH * 0.3 / 1.54385;   /* 按 CSS 默认步距（0.3×牌宽）一致 */
      var fitStep = (avail - cardH) / (len - 1);
      if (fitStep >= defStep) {
        col.style.removeProperty('--fc-step');
      } else {
        col.style.setProperty('--fc-step', Math.max(cardH * 0.12, fitStep) + 'px');
      }
    }
  }

  /* ---------- 选中与移动 ---------- */
  function selCards() {
    if (!sel) return null;
    if (sel.type === 'col') return cols[sel.a].slice(sel.b);
    if (sel.type === 'free') return freecells[sel.a] ? [freecells[sel.a]] : null;
    var pile = fnds[sel.a];
    return pile.length ? [pile[pile.length - 1]] : null;
  }

  function clearSel() {
    if (!sel) return;
    sel = null;
    render();
  }

  function tryMoveSelToCol(colIdx) {
    if (!sel) return false;
    var cards = selCards();
    if (!cards) return false;
    if (sel.type === 'col' && sel.a === colIdx) { clearSel(); return false; }
    if (sel.type === 'col' && cards.length > maxMoveCount()) {
      toast('一次最多可移动 ' + maxMoveCount() + ' 张牌');
      return false;
    }
    if (!canPlaceOnCol(cards, colIdx)) return false;
    var srcDesc = { type: sel.type, a: sel.a, b: sel.b };
    var dstDesc = { type: 'col', a: colIdx };
    if (sel.type === 'col') {
      cols[colIdx].push.apply(cols[colIdx], cols[sel.a].splice(sel.b));
    } else if (sel.type === 'free') {
      cols[colIdx].push(freecells[sel.a]);
      freecells[sel.a] = null;
    } else {
      cols[colIdx].push(fnds[sel.a].pop());
    }
    broadcastMove(srcDesc, dstDesc);
    sel = null;
    render();
    checkWin();
    return true;
  }

  function tryMoveSelToFree(cellIdx) {
    if (!sel) return false;
    if (freecells[cellIdx]) return false;
    var cards = selCards();
    if (!cards || cards.length > 1) return false;
    if (sel.type === 'free' && sel.a === cellIdx) { clearSel(); return false; }
    var card = cards[0];
    var srcDesc = { type: sel.type, a: sel.a, b: sel.b };
    var dstDesc = { type: 'free', a: cellIdx };
    if (sel.type === 'col') {
      cols[sel.a].pop();
    } else if (sel.type === 'fnd') {
      fnds[sel.a].pop();
    } else if (sel.type === 'free') {
      freecells[sel.a] = null;   /* 空当之间可挪动 */
    } else {
      clearSel();
      return false;
    }
    freecells[cellIdx] = card;
    broadcastMove(srcDesc, dstDesc);
    sel = null;
    render();
    checkWin();
    return true;
  }

  function tryMoveSelToFnd(pileIdx) {
    if (!sel) return false;
    var cards = selCards();
    if (!cards || cards.length > 1) return false;
    if (!canPlaceOnFnd(cards[0], pileIdx)) return false;
    var srcDesc = { type: sel.type, a: sel.a, b: sel.b };
    var dstDesc = { type: 'fnd', a: pileIdx };
    if (sel.type === 'col') {
      cols[sel.a].pop();
    } else if (sel.type === 'free') {
      freecells[sel.a] = null;
    } else if (sel.type === 'fnd') {
      fnds[sel.a].pop();   /* 置牌位之间可挪动（目标须可接收：空位+A 等） */
    } else {
      clearSel();
      return false;
    }
    fnds[pileIdx].push(cards[0]);
    broadcastMove(srcDesc, dstDesc);
    sel = null;
    render();
    checkWin();
    return true;
  }

  /* ---------- 交互 ---------- */
  // 点击牌：可挪动则选中；已有选中时点击列顶牌 = 先尝试把选中项放到它上面，放不下再切换选中项
  function onColClick(colIdx, ev) {
    var cardEl = ev.target.closest ? ev.target.closest('.fc-card') : null;
    if (cardEl) {
      var idx = parseInt(cardEl.dataset.idx, 10);
      if (sel && sel.type === 'col' && sel.a === colIdx && sel.b === idx) { clearSel(); return; }
      if (sel && idx === cols[colIdx].length - 1 && !(sel.type === 'col' && sel.a === colIdx) && tryMoveSelToCol(colIdx)) return;
      var run = cols[colIdx].slice(idx);
      if (!validRun(run)) { clearSel(); return; }   /* 被压着且不成序：不高亮 */
      if (run.length > maxMoveCount()) { clearSel(); return; }   /* 超过可移动上限：不高亮 */
      sel = { type: 'col', a: colIdx, b: idx };
      render();
      return;
    }
    if (sel && !tryMoveSelToCol(colIdx)) clearSel();   /* 点击列空白：尝试移动 */
  }

  function onFreeClick(cellIdx) {
    if (sel) {
      if (sel.type === 'free' && sel.a === cellIdx) { clearSel(); return; }
      if (!freecells[cellIdx]) {
        if (tryMoveSelToFree(cellIdx)) return;
        clearSel();
        return;
      }
      sel = { type: 'free', a: cellIdx, b: 0 };   /* 有牌：选中它，替换原选择 */
      render();
      return;
    }
    if (freecells[cellIdx]) {
      sel = { type: 'free', a: cellIdx, b: 0 };
      render();
    }
  }

  function onFndClick(pileIdx) {
    if (sel) {
      if (sel.type === 'fnd' && sel.a === pileIdx) { clearSel(); return; }
      if (tryMoveSelToFnd(pileIdx)) return;
      if (fnds[pileIdx].length) {
        sel = { type: 'fnd', a: pileIdx, b: 0 };   /* 有牌且放不下：选中它，替换原选择 */
        render();
      } else {
        clearSel();
      }
      return;
    }
    var pile = fnds[pileIdx];
    if (pile.length) {
      sel = { type: 'fnd', a: pileIdx, b: 0 };
      render();
    }
  }

  /* ---------- 拖动（指针事件，鼠标/触摸通用） ---------- */
  var dragInfo = null;          // { cardEl, src, startX, startY, offX, offY, active, ghost }
  var dragSuppressClick = false;

  function parseSrc(s) {
    var parts = String(s || '').split(':');
    if (parts.length < 2) return null;
    return { type: parts[0], a: parseInt(parts[1], 10), b: parts.length > 2 ? parseInt(parts[2], 10) : 0 };
  }

  function setSelFromSrc(src) {
    if (src.type === 'col') {
      var run = cols[src.a].slice(src.b);
      if (run.length && validRun(run)) sel = { type: 'col', a: src.a, b: src.b };
    } else if (src.type === 'free') {
      if (freecells[src.a]) sel = { type: 'free', a: src.a, b: 0 };
    } else if (src.type === 'fnd') {
      if (fnds[src.a].length) sel = { type: 'fnd', a: src.a, b: 0 };
    }
  }

  function srcCards(src) {
    if (src.type === 'col') return cols[src.a].slice(src.b);
    if (src.type === 'free') return freecells[src.a] ? [freecells[src.a]] : [];
    var pile = fnds[src.a];
    return pile.length ? [pile[pile.length - 1]] : [];
  }

  function markSrcSel(src) {
    // 拖动中不重建 DOM，直接给源牌加选中高亮并隐藏（弹回时恢复）
    if (src.type === 'col') {
      var colEl = tableEl.children[src.a];
      if (colEl) {
        var els = colEl.querySelectorAll('.fc-card');
        for (var i = src.b; i < els.length; i++) {
          els[i].classList.add('sel');
          els[i].classList.add('fc-drag-hidden');
        }
      }
      return;
    }
    var cell = src.type === 'free' ? freeEl.children[src.a] : fndEl.children[src.a];
    if (!cell) return;
    var c = cell.querySelector('.fc-card');
    if (!c) return;
    c.classList.add('sel');
    c.classList.add('fc-drag-hidden');
    /* 原位置补位：空当显示空框；置牌位显示下方一张牌（无则空框） */
    if (cell.querySelector('.fc-cell.fc-empty') || cell.children.length > 1) return;
    var below = null;
    if (src.type === 'fnd') {
      var pile = fnds[src.a];
      below = pile.length > 1 ? pile[pile.length - 2] : null;
    }
    var placeholder = below ? cardEl(below, '', 'fnd:' + src.a) : emptyCellEl();
    cell.insertBefore(placeholder, c);
  }

  function sourceRunRect(src) {
    // 源牌堆（run 顶牌）在页面中的位置
    if (src.type === 'col') {
      var colEl = tableEl.children[src.a];
      if (!colEl) return null;
      var els = colEl.querySelectorAll('.fc-card');
      if (!els[src.b]) return null;
      return els[src.b].getBoundingClientRect();
    }
    // 空当/置牌位：单元格即牌的原始位置（拖动期间牌被占位符挤到下方，不能取牌自身的矩形）
    var cell = src.type === 'free' ? freeEl.children[src.a] : fndEl.children[src.a];
    if (!cell) return null;
    return cell.getBoundingClientRect();
  }

  function createGhost(src, clientX, clientY) {
    var page = document.querySelector('.fc-page');
    if (!page) return null;
    var pageRect = page.getBoundingClientRect();
    var cards = srcCards(src);
    if (!cards.length) return null;
    var srcRect = sourceRunRect(src);
    if (!srcRect) return null;
    var wrap = document.createElement('div');
    wrap.className = 'fc-drag-ghost';
    if (src.type !== 'col') wrap.style.setProperty('--fc-c', 'var(--fc-top-c)');   // 上方牌更亮
    else {
      var colEl = tableEl.children[src.a];   // 幻影步距与源列一致（列可能被压缩）
      if (colEl) {
        var s = getComputedStyle(colEl).getPropertyValue('--fc-step');
        if (s) wrap.style.setProperty('--fc-step', s);
      }
    }
    cards.forEach(function (card) {
      wrap.appendChild(cardEl(card, '', ''));
    });
    page.appendChild(wrap);
    // 先让幻影覆盖在源牌位置，再按源牌位置计算指针偏移
    wrap.style.left = (srcRect.left - pageRect.left) + 'px';
    wrap.style.top = (srcRect.top - pageRect.top) + 'px';
    var offX = clientX - srcRect.left;
    var offY = clientY - srcRect.top;
    return { wrap: wrap, pageRect: pageRect, offX: offX, offY: offY };
  }

  function positionGhost(ev, ghost) {
    ghost.wrap.style.left = (ev.clientX - ghost.pageRect.left - ghost.offX) + 'px';
    ghost.wrap.style.top = (ev.clientY - ghost.pageRect.top - ghost.offY) + 'px';
  }

  function removeGhost(ghost) {
    if (ghost && ghost.wrap && ghost.wrap.parentNode) {
      ghost.wrap.parentNode.removeChild(ghost.wrap);
    }
  }

  // 该位置是否可移动：有效序列且长度不超过一次可移动上限
  function srcMovable(src) {
    if (src.type === 'col') {
      var run = cols[src.a].slice(src.b);
      if (!run.length || !validRun(run)) return false;
      if (run.length > maxMoveCount()) return false;
      return true;
    }
    if (src.type === 'free') return !!freecells[src.a];
    return fnds[src.a].length > 0;
  }

  // 吸附：指针未命中目标时，找吸附半径内最近的可落点（列/空当/置牌位）
  function nearestTarget(x, y) {
    var card = tableEl.querySelector('.fc-card');
    var snap = card ? card.getBoundingClientRect().width * 0.7 : 60;
    var candidates = [];
    for (var c = 0; c < 8; c++) candidates.push({ type: 'col', el: tableEl.children[c] });
    for (var f = 0; f < 4; f++) candidates.push({ type: 'free', el: freeEl.children[f] });
    for (var p = 0; p < 4; p++) candidates.push({ type: 'fnd', el: fndEl.children[p] });
    var best = null, bestD = Infinity;
    candidates.forEach(function (t) {
      var r = t.el.getBoundingClientRect();
      var dx = Math.max(r.left - x, 0, x - r.right);
      var dy = Math.max(r.top - y, 0, y - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = t; }
    });
    return bestD <= snap ? best : null;
  }

  function dropAt(src, clientX, clientY, ghost) {
    setSelFromSrc(src);
    if (!sel) { removeGhost(ghost); clearSel(); return; }
    var target = document.elementFromPoint(clientX, clientY);
    var colEl = target && target.closest ? target.closest('.fc-col') : null;
    var freeTarget = target && target.closest ? target.closest('.fc-freecell') : null;
    var fndTarget = target && target.closest ? target.closest('.fc-foundation') : null;
    if (!colEl && !freeTarget && !fndTarget) {
      var near = nearestTarget(clientX, clientY);   /* 扩大吸附范围 */
      if (near) {
        if (near.type === 'col') colEl = near.el;
        else if (near.type === 'free') freeTarget = near.el;
        else fndTarget = near.el;
      }
    }
    var moved = false;
    if (colEl) {
      var colIdx = parseInt(colEl.dataset.col, 10);
      if (sel.type === 'col' && sel.a === colIdx) sel = null;   /* 放回原列：走弹回动画，不提前重建 */
      else moved = tryMoveSelToCol(colIdx);
    } else if (freeTarget) {
      var cellIdx = parseInt(freeTarget.dataset.cell, 10);
      if (sel.type === 'free' && sel.a === cellIdx) sel = null;   /* 放回原空当 */
      else moved = tryMoveSelToFree(cellIdx);
    } else if (fndTarget) {
      var pileIdx = parseInt(fndTarget.dataset.pile, 10);
      if (sel.type === 'fnd' && sel.a === pileIdx) sel = null;   /* 放回原置牌位 */
      else moved = tryMoveSelToFnd(pileIdx);
    } else {
      sel = null;
    }
    if (moved) {
      removeGhost(ghost);   /* 移动成功：源牌已被重建移除，幻影直接消失 */
    } else {
      bounceBack(src, ghost);   /* 落点无效/放回原处：幻影弹回，弹完才恢复源牌 */
    }
  }

  // 幻影弹回源位置后消失，再恢复被隐藏的源牌（等待弹回完成才替换显示）
  function bounceBack(src, ghost) {
    if (ghost) {
      var rect = sourceRunRect(src);
      if (rect) {
        ghost.wrap.style.transition = 'left 0.16s ease-out, top 0.16s ease-out';
        void ghost.wrap.offsetWidth;   /* 强制回流，使过渡生效 */
        ghost.wrap.style.left = (rect.left - ghost.pageRect.left) + 'px';
        ghost.wrap.style.top = (rect.top - ghost.pageRect.top) + 'px';
        setTimeout(function () {
          removeGhost(ghost);
          render();   /* 弹回完成后才恢复原牌 */
        }, 180);
        return;
      }
      removeGhost(ghost);
    }
    render();
  }

  /* 双击/双点：先把场上所有能放入置牌位的牌（含空当、含连锁露出的牌）全部置入；
     若双击的那张牌放不进置牌位且有空当，则从左至右放入第一个空闲空当*/
  var lastTapTime = 0;
  var lastTapSrc = '';

  function findCard(suit, rank) {
    rank = parseInt(rank, 10);   /* dataset.rank 为字符串 */
    for (var c = 0; c < 8; c++) {
      for (var i = 0; i < cols[c].length; i++) {
        if (cols[c][i].suit === suit && cols[c][i].rank === rank) return { type: 'col', a: c, b: i };
      }
    }
    for (var f = 0; f < 4; f++) {
      if (freecells[f] && freecells[f].suit === suit && freecells[f].rank === rank) return { type: 'free', a: f, b: 0 };
    }
    for (var p = 0; p < 4; p++) {
      for (var j = 0; j < fnds[p].length; j++) {
        if (fnds[p][j].suit === suit && fnds[p][j].rank === rank) return { type: 'fnd', a: p, b: j };
      }
    }
    return null;
  }

  function handleDoubleTap(cardEl) {
    if (!fcSettings.dblCascade) return false;   /* 界面设置：关闭双击自动置牌 */
    var changed = autoPlaceAll();
    if (!cardEl || !cardEl.dataset.suit) return changed;
    var loc = findCard(cardEl.dataset.suit, cardEl.dataset.rank);
    if (loc && loc.type === 'col' && loc.b === cols[loc.a].length - 1) {
      var card = cols[loc.a][loc.b];
      var placeable = false;
      for (var p = 0; p < 4; p++) {
        if (canPlaceOnFnd(card, p)) { placeable = true; break; }
      }
      if (!placeable) {
        for (var f = 0; f < 4; f++) {
          if (!freecells[f]) {
            cols[loc.a].pop();
            freecells[f] = card;
            broadcastMove({ type: 'col', a: loc.a, b: loc.b }, { type: 'free', a: f });
            render();
            return true;
          }
        }
      }
    }
    return changed;
  }
  function autoPlaceAll() {
    var changed = false;
    var again = true;
    while (again) {
      again = false;
      for (var f = 0; f < 4; f++) {
        var card = freecells[f];
        if (!card) continue;
        var p = -1;
        for (var i = 0; i < 4; i++) { if (canPlaceOnFnd(card, i)) { p = i; break; } }
        if (p >= 0) {
          freecells[f] = null;
          fnds[p].push(card);
          broadcastMove({ type: 'free', a: f, b: 0 }, { type: 'fnd', a: p });
          changed = true;
          again = true;
        }
      }
      for (var c = 0; c < 8; c++) {
        var col = cols[c];
        if (!col.length) continue;
        var top = col[col.length - 1];
        var p2 = -1;
        for (var j = 0; j < 4; j++) { if (canPlaceOnFnd(top, j)) { p2 = j; break; } }
        if (p2 >= 0) {
          col.pop();
          fnds[p2].push(top);
          broadcastMove({ type: 'col', a: c, b: col.length }, { type: 'fnd', a: p2 });   /* b=弹出后的长度，即原顶牌下方 */
          changed = true;
          again = true;   /* 上方的牌进入置牌位后，下方露出的牌需再检查 */
        }
      }
    }
    if (changed) {
      render();
      checkWin();
    }
    return changed;
  }

  document.addEventListener('pointerdown', function (ev) {
    if (isSpec) return;   /* 观战者只读 */
    var cardEl = ev.target.closest ? ev.target.closest('.fc-card') : null;
    if (!cardEl || !cardEl.dataset.src) return;
    var src = parseSrc(cardEl.dataset.src);
    if (!src) return;
    if (!srcMovable(src)) return;   /* 不可挪动的牌：不高亮、不可拖动 */
    dragInfo = { cardEl: cardEl, src: src, startX: ev.clientX, startY: ev.clientY, offX: 0, offY: 0, active: false, ghost: null };
    try { cardEl.setPointerCapture(ev.pointerId); } catch (e) {}
  });

  document.addEventListener('pointermove', function (ev) {
    if (!dragInfo) return;
    if (!dragInfo.active) {
      if (Math.abs(ev.clientX - dragInfo.startX) + Math.abs(ev.clientY - dragInfo.startY) < 10) return;
      ev.preventDefault();
      dragInfo.active = true;
      dragInfo.ghost = createGhost(dragInfo.src, dragInfo.startX, dragInfo.startY);
      if (dragInfo.ghost) {
        dragInfo.offX = dragInfo.ghost.offX;
        dragInfo.offY = dragInfo.ghost.offY;
        positionGhost(ev, dragInfo.ghost);
      }
      markSrcSel(dragInfo.src);
      return;
    }
    if (dragInfo.ghost) positionGhost(ev, dragInfo.ghost);
  });

  document.addEventListener('pointerup', function (ev) {
    if (isSpec) return;   /* 观战者只读 */
    if (dragInfo && dragInfo.active) {
      var di = dragInfo;
      dragInfo = null;
      dragSuppressClick = true;
      setTimeout(function () { dragSuppressClick = false; }, 50);   /* 只抑制拖放后紧接着的浏览器生成的 click */
      dropAt(di.src, ev.clientX, ev.clientY, di.ghost);
      return;
    }
    dragInfo = null;
    /* 非拖动：双击/双点检测自动放牌（鼠标与触摸通用） */
    var cardEl = ev.target.closest ? ev.target.closest('.fc-card') : null;
    var now = Date.now();
    var src = cardEl && cardEl.dataset.src ? cardEl.dataset.src : '';
    if (cardEl && src && now - lastTapTime < 300 && lastTapSrc === src) {
      lastTapTime = 0;
      lastTapSrc = '';
      if (handleDoubleTap(cardEl)) {
        dragSuppressClick = true;
        setTimeout(function () { dragSuppressClick = false; }, 50);
      }
      return;
    }
    lastTapTime = now;
    lastTapSrc = src;
  });

  document.addEventListener('pointercancel', function () {
    if (!dragInfo) return;
    removeGhost(dragInfo.ghost);
    dragInfo = null;
    render();   /* 恢复被隐藏的源牌 */
  });

  /* ---------- 点击（选中后点目标移动） ---------- */
  tableEl.addEventListener('click', function (ev) {
    if (isSpec) return;   /* 观战者只读 */
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var colEl = ev.target.closest ? ev.target.closest('.fc-col') : null;
    if (!colEl) { clearSel(); return; }
    onColClick(parseInt(colEl.dataset.col, 10), ev);
  });
  freeEl.addEventListener('click', function (ev) {
    if (isSpec) return;   /* 观战者只读 */
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var cell = ev.target.closest ? ev.target.closest('.fc-freecell') : null;
    if (!cell) return;
    onFreeClick(parseInt(cell.dataset.cell, 10));
  });
  fndEl.addEventListener('click', function (ev) {
    if (isSpec) return;   /* 观战者只读 */
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var cell = ev.target.closest ? ev.target.closest('.fc-foundation') : null;
    if (!cell) return;
    onFndClick(parseInt(cell.dataset.pile, 10));
  });

  /* 双击：自动把所有可放入置牌位的牌全部置入（鼠标；触摸双点走 pointerup 检测） */
  function onDblClickCard(ev) {
    if (isSpec) return;   /* 观战者只读 */
    if (dragSuppressClick) { dragSuppressClick = false; return; }
    var cardEl = ev.target.closest ? ev.target.closest('.fc-card') : null;
    if (handleDoubleTap(cardEl)) {
      dragSuppressClick = true;
      setTimeout(function () { dragSuppressClick = false; }, 50);
    }
  }
  tableEl.addEventListener('dblclick', onDblClickCard);
  freeEl.addEventListener('dblclick', onDblClickCard);
  fndEl.addEventListener('dblclick', onDblClickCard);

  /* ---------- 通关 ---------- */
  function checkWin() {
    var done = 0;
    for (var i = 0; i < 4; i++) if (fnds[i].length === 13) done++;
    if (done === 4) showModal($('fc-win-modal'));
  }

  /* ---------- 顶部小人：随鼠标/触摸位置朝向 ---------- */
  function updateDoll(clientX) {
    if (!dollEl || !dollImg) return;
    var rect = dollEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var th = rect.width;
    if (clientX < cx - th) dollImg.src = 'texture/leftdoll.png';
    else if (clientX > cx + th) dollImg.src = 'texture/rightdoll.png';
    else dollImg.src = 'texture/middledoll.png';
  }
  window.addEventListener('mousemove', function (e) { updateDoll(e.clientX); });
  window.addEventListener('touchstart', function (e) {
    if (e.touches && e.touches.length) updateDoll(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length) updateDoll(e.touches[0].clientX);
  }, { passive: true });

  /* ---------- 计时（新局生效开关，左下角显示秒数） ---------- */
  var timerEl = document.getElementById('fc-timer');
  var gameStartTime = 0;
  var timerTick = null;
  function updateTimer() {
    if (!timerEl) return;
    var s = Math.max(0, Math.round((Date.now() - gameStartTime) / 1000));
    timerEl.textContent = s + 's';
  }
  function resetTimer() {
    gameStartTime = Date.now();
    if (timerTick) { clearInterval(timerTick); timerTick = null; }
    if (timerEl) timerEl.classList.toggle('hidden', !fcSettings.timer);
    if (!fcSettings.timer) return;
    updateTimer();
    timerTick = setInterval(updateTimer, 1000);
  }

  /* ---------- 设置弹窗 ---------- */
  function setToggle(el, on) {
    if (!el) return;
    var img = el.querySelector('img');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (img) img.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function toggleIsOn(el) {
    return el && el.getAttribute('aria-pressed') === 'true';
  }

  // 界面设置即时生效
  function applyUiSettings() {
    var page = document.querySelector('.fc-page');
    if (!page) return;
    page.classList.toggle('fc-solid-cards', !fcSettings.transparent);
    /* 边框提示花色：双色模式开启时用双色配色，否则用四色配色；关闭则默认金色 */
    page.classList.toggle('fc-suit-border', fcSettings.suitBorder && !fcSettings.twoColor);
    page.classList.toggle('fc-two-color-border', fcSettings.suitBorder && fcSettings.twoColor);
    document.documentElement.style.setProperty('--fc-win-scale', fcSettings.winScale);
    if (timerEl) timerEl.classList.toggle('hidden', !fcSettings.timer);
    render();
  }

  var winScaleSlider = $('fc-win-scale');
  var winScaleLabel = $('fc-win-scale-label');
  // 与 chess 一致的滑条样式：轨道 1:62、滑块 = 轨道 2.5 倍宽/7 倍高、金色填充跟随取值
  function styleFcSlider() {
    var s = winScaleSlider;
    if (!s) return;
    var w = s.clientWidth || 300;
    var fs = parseFloat(window.getComputedStyle(s).fontSize) || 43.6;
    var trackHpx = Math.max(2, w / 62);
    var trackH = trackHpx / fs;
    var thumbH = trackH * 7;
    var thumbW = trackH * 2.5;
    var thumbWpx = trackHpx * 2.5;
    var min = parseFloat(s.min) || 40;
    var max = parseFloat(s.max) || 200;
    var val = parseFloat(s.value) || 100;
    var f = Math.max(0, Math.min(1, (val - min) / (max - min)));
    var fill = (f * (1 - thumbWpx / w) + thumbWpx / (2 * w)) * 100;
    s.style.setProperty('--track-h', trackH.toFixed(4) + 'em');
    s.style.setProperty('--thumb-w', thumbW.toFixed(4) + 'em');
    s.style.setProperty('--thumb-h', thumbH.toFixed(4) + 'em');
    s.style.setProperty('--fill', fill.toFixed(2) + '%');
  }
  function syncSettingsUI() {
    var map = [
      ['opt-empty-col-k', 'emptyColK'], ['opt-allow-spec', 'allowSpec'], ['opt-open', 'open'],
      ['opt-timer', 'timer'], ['opt-dbl-cascade', 'dblCascade'],
      ['opt-transparent', 'transparent'], ['opt-suit-border', 'suitBorder'], ['opt-two-color', 'twoColor']
    ];
    map.forEach(function (pair) { setToggle($(pair[0]), fcSettings[pair[1]]); });
    if (winScaleSlider) winScaleSlider.value = Math.round(fcSettings.winScale * 100);
    if (winScaleLabel) winScaleLabel.textContent = Math.round(fcSettings.winScale * 100) + '%';
    syncOpenLock();   /* 设为开放：仅允许观战开启时可修改 */
  }
  function syncOpenLock() {
    var openEl = $('opt-open');
    if (!openEl) return;
    var locked = !fcSettings.allowSpec || isSpec;
    openEl.disabled = locked;
    openEl.classList.toggle('disabled', locked);
  }

  var settingsBackup = null;
  function openSettings() {
    settingsBackup = JSON.parse(JSON.stringify(fcSettings));   /* 取消时恢复的基准 */
    syncSettingsUI();
    showModal($('fc-settings-modal'));
    styleFcSlider();   /* 弹窗可见后再计算滑条尺寸（display:none 时 clientWidth 为 0） */
    requestAnimationFrame(styleFcSlider);   /* 布局稳定后再次校准 */
    updateFcSettingsScrollbar();
  }
  function applySettings() {
    if (!fcSettings.allowSpec) fcSettings.open = false;   /* 不允许观战时强制关闭开放 */
    saveSettings();
    settingsBackup = null;
    hideModal($('fc-settings-modal'));
    syncOpenRoom();   /* 开放状态变化即时同步注册 */
  }
  function cancelSettings() {
    if (settingsBackup) {
      for (var k in fcSettings) fcSettings[k] = settingsBackup[k];
      settingsBackup = null;
    }
    applyUiSettings();
    syncSettingsUI();
    hideModal($('fc-settings-modal'));
  }
  function resetSettings() {
    var defaults = { emptyColK: false, allowSpec: false, open: false, timer: true, winScale: 1, dblCascade: true, transparent: true, suitBorder: false, twoColor: false };
    for (var k in fcSettings) fcSettings[k] = defaults[k];
    applyUiSettings();
    syncSettingsUI();
    toast('已恢复默认设置');
  }

  [
    ['opt-empty-col-k', 'emptyColK', false], ['opt-allow-spec', 'allowSpec', false], ['opt-open', 'open', false],
    ['opt-timer', 'timer', false],
    ['opt-dbl-cascade', 'dblCascade', true], ['opt-transparent', 'transparent', true],
    ['opt-suit-border', 'suitBorder', true], ['opt-two-color', 'twoColor', true]
  ].forEach(function (pair) {
    var el = $(pair[0]);
    if (!el) return;
    el.addEventListener('click', function () {
      if (pair[0] === 'opt-open' && (!fcSettings.allowSpec || isSpec)) return;   /* 仅允许观战开启时可修改 */
      fcSettings[pair[1]] = !toggleIsOn(el);
      setToggle(el, fcSettings[pair[1]]);
      if (pair[0] === 'opt-allow-spec') syncOpenLock();   /* 允许观战变化时同步设为开放/锁定 */
      if (pair[2]) applyUiSettings();   /* 界面设置即时生效 */
    });
  });
  if (winScaleSlider) winScaleSlider.addEventListener('input', function () {
    fcSettings.winScale = parseFloat(winScaleSlider.value) / 100;
    if (winScaleLabel) winScaleLabel.textContent = winScaleSlider.value + '%';
    styleFcSlider();
    applyUiSettings();
  });

  /* ---------- 控件 ---------- */
  $('btn-fc-new').addEventListener('click', showRestartModal);
  $('btn-fc-restart-new').addEventListener('click', newGame);
  $('btn-fc-restart-replay').addEventListener('click', replayGame);
  $('btn-fc-restart-cancel').addEventListener('click', function () { hideModal($('fc-restart-modal')); });
  $('btn-fc-settings').addEventListener('click', openSettings);
  $('btn-fc-settings-apply').addEventListener('click', applySettings);
  $('btn-fc-settings-back').addEventListener('click', cancelSettings);
  $('btn-fc-settings-default').addEventListener('click', resetSettings);
  Profile.wireModalOutsideClick($('fc-settings-modal'), cancelSettings);
  $('btn-fc-home').addEventListener('click', function () { location.href = 'index.html'; });
  $('btn-fc-win-new').addEventListener('click', showRestartModal);
  $('btn-fc-win-home').addEventListener('click', function () { location.href = 'index.html'; });
  $('btn-fc-exit-ok').addEventListener('click', function () { location.href = 'index.html'; });

  /* ---------- 房间码（邀请码界面） ---------- */
  var viewCodeBtn = $('btn-fc-view-code');
  if (viewCodeBtn) {
    if (fcMode !== 'host') viewCodeBtn.classList.add('hidden');   /* 仅房主可见 */
    viewCodeBtn.addEventListener('click', function () {
      var input = $('fc-code-input');
      if (input) input.value = myPeerId || '暂无房间码';
      hideModal($('fc-settings-modal'));
      showModal($('fc-code-modal'));
    });
  }
  $('btn-fc-code-back').addEventListener('click', function () { hideModal($('fc-code-modal')); });
  Profile.wireModalOutsideClick($('fc-code-modal'), function () { hideModal($('fc-code-modal')); });
  $('btn-fc-copy-id').addEventListener('click', function () {
    copyText($('fc-code-input').value || '', '已复制房间码');
  });
  $('btn-fc-copy-link').addEventListener('click', function () {
    var id = $('fc-code-input').value || '';
    var link = new URL('freecell.html', location.href);
    link.search = '?mode=join&id=' + encodeURIComponent(id) + '&spec=1';
    copyText(link.href, '已复制加入链接');
  });

  var updateFcSettingsScrollbar = Profile.wireScrollbar(
    document.getElementById('fc-settings-body'),
    document.getElementById('fc-settings-scrollbar'),
    document.getElementById('fc-settings-scrollbar-thumb')
  );
  window.addEventListener('resize', function () { updateFcSettingsScrollbar(); });

  loadSettings();
  syncSettingsUI();   /* 初始同步开关/滑条状态 */
  Profile.applyBackground();
  window.addEventListener('resize', function () { Profile.adjustBtnHitAreas(); fitColumns(); styleFcSlider(); });

  initNet();   /* host / 观战加入；单人模式不联网 */
  if (!isSpec) newGame();
  applyUiSettings();   /* 按已加载的设置重渲染（两色模式/牌面等） */
  syncOpenRoom();

  /* 离开页面时注销开放房间，避免残留 */
  window.addEventListener('pagehide', function () {
    unregisterOpenRoom(myPeerId);
  });
})();


