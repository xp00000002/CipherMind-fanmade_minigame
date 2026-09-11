/* spider.js - 蜘蛛纸牌（Spider Solitaire）单机+观战逻辑 */
(function () {
  'use strict';

  var SUITS = ['s', 'h', 'c', 'd'];
  var SUIT_IMG = { s: 'texture-card/Card-Spade.png', h: 'texture-card/Card-Heart.png', c: 'texture-card/Card-Club.png', d: 'texture-card/Card-Diamond.png' };
  var SUIT_IMG_TC = { s: 'texture-card/Card-Spade-Black.png', h: 'texture-card/Card-Heart-Red.png', c: 'texture-card/Card-Club-Black.png', d: 'texture-card/Card-Diamond-Red.png' };
  var RANK_IMG = {
    1: 'texture-card/Card-A.png', 2: 'texture-card/Card-2.png', 3: 'texture-card/Card-3.png',
    4: 'texture-card/Card-4.png', 5: 'texture-card/Card-5.png', 6: 'texture-card/Card-6.png',
    7: 'texture-card/Card-7.png', 8: 'texture-card/Card-8.png', 9: 'texture-card/Card-9.png',
    10: 'texture-card/Card-10.png', 11: 'texture-card/Card-J.png', 12: 'texture-card/Card-Q.png',
    13: 'texture-card/Card-K.png'
  };

  var cols = [];        // 10 个列（数组末尾为顶）
  var stock = [];       // 5 组背面牌堆（每组 10 张），最左为下一次发放
  var done = [];        // 已收起的完整同色组（K 的牌面）
  var sel = null;       // { c, i }

  var tableEl = document.getElementById('sp-table');
  var stockEl = document.getElementById('sp-stock');
  var doneEl = document.getElementById('sp-done');
  var toastEl = document.getElementById('toast');
  var timerEl = document.getElementById('fc-timer');

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
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function isRed(c) { return c.suit === 'h' || c.suit === 'd'; }

  /* ---------- 设置 ---------- */
  var spSettings = {
    difficulty: 'single',   // single 单色 / two 双色 / four 四色
    allowSpec: false,       // 允许观战
    open: false,            // 设为开放（仅允许观战开启时可修改）
    timer: true,            // 计时
    winScale: 1,            // 窗口缩放
    transparent: true,      // 牌面透明
    suitBorder: false,      // 边框提示花色
    twoColor: false,        // 双色模式
    undo: { single: false, two: true, four: true }   // 各难度是否允许撤销
  };
  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem('spSettings'));
      if (saved) {
        for (var k in spSettings) {
          if (saved[k] !== undefined) spSettings[k] = saved[k];
        }
      }
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('spSettings', JSON.stringify(spSettings)); } catch (e) {}
  }

  /* ---------- 联机/观战 ---------- */
  var spParams = new URLSearchParams(location.search);
  var spMode = spParams.get('mode');        // 'host' | 'join' | null
  var spJoinId = spParams.get('id');
  var isSpec = false;
  var myPeerId = null;

  function currentState() {
    return {
      cols: cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); }),
      stock: stock.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); }),
      done: done.map(function (x) { return { suit: x.suit, rank: x.rank }; }),
      elapsed: Date.now() - gameStartTime,
      timerOn: spSettings.timer
    };
  }
  function broadcastState() {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'sp-state', state: currentState() });
  }
  function broadcastMove(fromC, i, toC) {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'sp-move', m: { s: { c: fromC, i: i }, d: { c: toC } } });
  }
  function broadcastDeal() {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'sp-deal' });
  }
  function applyRemoteState(st) {
    if (!st) return;
    cols = st.cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    stock = st.stock.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    done = st.done.map(function (x) { return { suit: x.suit, rank: x.rank }; });
    sel = null;
    gameStartTime = Date.now() - (st.elapsed || 0);
    if (timerEl) timerEl.classList.toggle('hidden', !st.timerOn);
    if (timerTick) { clearInterval(timerTick); timerTick = null; }
    if (st.timerOn) {
      updateTimer();
      timerTick = setInterval(updateTimer, 1000);
    }
    render();
  }
  function applyRemoteMove(m) {
    var s = m.s, d = m.d;
    cols[d.c].push.apply(cols[d.c], cols[s.c].splice(s.i));
    if (cols[s.c].length) cols[s.c][cols[s.c].length - 1].up = true;
    while (collectComplete()) {}
    render();
  }
  function applyRemoteDeal() {
    if (!stock.length) return;
    var srcEl = stockEl.querySelector('.sp-stock-pile.front .fc-card');
    var srcRect = srcEl ? srcEl.getBoundingClientRect() : null;
    var pile = stock.shift();
    for (var c = 0; c < 10; c++) {
      pile[c].up = true;
      cols[c].push(pile[c]);
    }
    while (collectComplete()) {}
    render();
    if (srcRect) {
      for (var c2 = 0; c2 < 10; c2++) {
        var cardEls = tableEl.children[c2].querySelectorAll('.fc-card');
        var target = cardEls[cardEls.length - 1];
        if (target) {
          target.classList.add('sp-anim-target');
          flyCard(pile[c2], srcRect, target.getBoundingClientRect(), c2 * 25, null, (function (el) {
            return function () { if (el) el.classList.remove('sp-anim-target'); };
          })(target));
        }
      }
    }
  }

  function openRoomSummary() {
    var diffNames = { single: '单色', two: '双色', four: '四色' };
    return '蜘蛛纸牌 | ' + (diffNames[spSettings.difficulty] || '单色');
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
    list.push({ id: id, hostName: hostName, rules: openRoomSummary(), gameStarted: !!started, allowSpec: !!spSettings.allowSpec, noChat: false, ts: now, game: 'spider' });
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
    if (spMode !== 'host' || !myPeerId) return;
    if (spSettings.open && spSettings.allowSpec) registerOpenRoom(myPeerId, !!cols.length);
    else unregisterOpenRoom(myPeerId);
    Net.setAllowSpec(spSettings.allowSpec);
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
    ['opt-allow-spec', 'opt-open', 'opt-timer', 'opt-undo'].forEach(function (id) {
      var el = $(id);
      if (el) { el.disabled = true; el.classList.add('disabled'); }
    });
    document.querySelectorAll('#sp-difficulty .switch-arrow').forEach(function (b) {
      b.disabled = true;
      b.classList.add('disabled');
    });
    var newBtn = $('btn-fc-new');
    if (newBtn) newBtn.disabled = true;
    var winNew = $('btn-fc-win-new');
    if (winNew) winNew.disabled = true;
    var undoBtn = $('btn-fc-undo');
    if (undoBtn) undoBtn.disabled = true;
    var viewCode = $('btn-fc-view-code');
    if (viewCode) viewCode.classList.add('hidden');
  }
  function updateSpecCountDisplay(n) {
    var el = $('fc-spec-count');
    if (el) el.textContent = n || 0;
  }
  function initNet() {
    if (spMode === 'host') {
      Net.connect({
        mode: 'host',
        soloSpec: true,
        name: (Profile.get() || {}).name || '',
        onId: function (id) {
          myPeerId = id;
          syncOpenRoom();
        },
        onSpecJoin: function (c) {
          c.send({ type: 'sp-state', state: currentState() });
        },
        onSpecCount: updateSpecCountDisplay
      });
      return;
    }
    if (spMode === 'join' && spJoinId) {
      Net.connect({
        mode: 'join',
        hostId: spJoinId,
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
          if (data.type === 'sp-state') applyRemoteState(data.state);
          else if (data.type === 'sp-move') applyRemoteMove(data.m);
          else if (data.type === 'sp-deal') applyRemoteDeal();
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
  var specExited = false;
  function specExit(reason) {
    if (specExited) return;
    specExited = true;
    var text = $('fc-exit-text');
    if (text) text.textContent = reason;
    hideModal($('fc-win-modal'));
    showModal($('fc-exit-modal'));
  }

  /* ---------- 发牌 ---------- */
  function pickSuits() {
    if (spSettings.difficulty === 'single') {
      var s0 = SUITS[Math.floor(Math.random() * 4)];
      return [s0, s0, s0, s0, s0, s0, s0, s0];
    }
    if (spSettings.difficulty === 'two') {
      var blacks = ['s', 'c'], reds = ['h', 'd'];
      var b = blacks[Math.floor(Math.random() * 2)];
      var r = reds[Math.floor(Math.random() * 2)];
      return [b, b, b, b, r, r, r, r];
    }
    return ['s', 's', 'h', 'h', 'c', 'c', 'd', 'd'];
  }
  var initCols = null;
  var initStock = null;
  function snapshotDeal() {
    initCols = cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    initStock = stock.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
  }
  function dealGame() {
    if (spSettings.difficulty === 'single') {
      if (dealCredibleSingle()) return;   /* 单色：实时搜索可解局 */
      dealRandom();
      return;
    }
    if (spSettings.difficulty === 'two' && dealFromBankTwo()) return;   /* 双色：发牌库 */
    dealRandom();   /* 四色/兜底：随机 */
  }
  // 按牌组（104 张，求解器列序）布置牌局
  function applyDeck(deck) {
    cols = [];
    for (var i = 0; i < 4; i++) cols.push(deck.slice(i * 6, i * 6 + 6).map(function (c) { return { suit: c.suit, rank: c.rank, up: false }; }));
    for (var i = 0; i < 6; i++) cols.push(deck.slice(24 + i * 5, 24 + i * 5 + 5).map(function (c) { return { suit: c.suit, rank: c.rank, up: false }; }));
    for (var i = 0; i < 10; i++) if (cols[i].length) cols[i][cols[i].length - 1].up = true;
    stock = [];
    for (var i = 0; i < 5; i++) stock.push(deck.slice(54 + i * 10, 54 + i * 10 + 10).map(function (c) { return { suit: c.suit, rank: c.rank, up: false }; }));
    done = [];
    sel = null;
    snapshotDeal();
  }
  // 求解器状态（从牌组构建）
  function solverStateFromDeck(deck) {
    var p = { desk: [], corner: [], finished: 0 };
    for (var i = 0; i < 4; i++) p.desk.push(deck.slice(i * 6, i * 6 + 6).map(function (c) { return { suit: c.suit, point: c.rank, show: false }; }));
    for (var i = 0; i < 6; i++) p.desk.push(deck.slice(24 + i * 5, 24 + i * 5 + 5).map(function (c) { return { suit: c.suit, point: c.rank, show: false }; }));
    for (var i = 0; i < 5; i++) p.corner.push(deck.slice(54 + i * 10, 54 + i * 10 + 10).map(function (c) { return { suit: c.suit, point: c.rank, show: false }; }));
    for (var i = 0; i < 10; i++) if (p.desk[i].length) p.desk[i][p.desk[i].length - 1].show = true;
    return p;
  }
  // 单色：随机洗牌 + 求解器试解，可解才开局（90%+ 可解，通常 1 次尝试）
  function dealCredibleSingle() {
    if (!window.SpiderSolver) return false;
    var s0 = SUITS[Math.floor(Math.random() * 4)];
    for (var attempt = 0; attempt < 300; attempt++) {
      var deck = [];
      for (var g = 0; g < 8; g++) for (var r = 1; r <= 13; r++) deck.push({ suit: s0, rank: r });
      shuffle(deck);
      var r2 = window.SpiderSolver.autoSolve(solverStateFromDeck(deck), 2000);
      if (r2.success) { applyDeck(deck); return true; }
    }
    return false;
  }
  // 双色：从发牌库取一副（保证可解），求解器花色 3/4 映射到随机黑/红
  function dealFromBankTwo() {
    if (!window.SpiderSolver || !window.SPIDER_BANK_TWO || !window.SPIDER_BANK_TWO.length) return false;
    var entry = window.SPIDER_BANK_TWO[Math.floor(Math.random() * window.SPIDER_BANK_TWO.length)];
    var deck = window.SpiderSolver.decodeDeck(entry);
    var blacks = ['s', 'c'], reds = ['h', 'd'];
    var b = blacks[Math.floor(Math.random() * 2)];
    var r = reds[Math.floor(Math.random() * 2)];
    var suitMap = { 3: b, 4: r };
    deck = deck.map(function (c) { return { suit: suitMap[c.suit], rank: c.point }; });
    applyDeck(deck);
    return true;
  }
  function dealRandom() {
    var suits = pickSuits();
    var deck = [];
    for (var g = 0; g < 8; g++) {
      for (var r = 1; r <= 13; r++) deck.push({ suit: suits[g], rank: r });
    }
    shuffle(deck);
    var k = 0;
    cols = [];
    for (var c = 0; c < 10; c++) cols.push([]);
    for (var row = 0; row < 6; row++) {
      for (var c2 = 0; c2 < 10; c2++) {
        if (row === 5 && c2 >= 4) continue;
        cols[c2].push({ suit: deck[k].suit, rank: deck[k].rank, up: false });
        k++;
      }
    }
    for (var c3 = 0; c3 < 10; c3++) if (cols[c3].length) cols[c3][cols[c3].length - 1].up = true;
    stock = [];
    for (var p = 0; p < 5; p++) {
      var pile = [];
      for (var i = 0; i < 10; i++) {
        pile.push({ suit: deck[k].suit, rank: deck[k].rank, up: false });
        k++;
      }
      stock.push(pile);
    }
    done = [];
    sel = null;
    snapshotDeal();
  }

  /* ---------- 规则 ---------- */
  /* 可移动连序：必须同花色且点数连续递减 */
  function runFrom(c, i) {
    var col = cols[c];
    if (i < 0 || i >= col.length || !col[i].up) return null;
    var run = [];
    for (var k = i; k < col.length; k++) {
      if (run.length) {
        var prev = run[run.length - 1];
        if (col[k].suit !== prev.suit || col[k].rank !== prev.rank - 1) return null;
      }
      run.push(col[k]);
    }
    return run;
  }
  function canMoveTo(c, run) {
    var top = cols[c][cols[c].length - 1];
    if (!top) return true;
    return top.suit === run[0].suit && top.rank === run[0].rank + 1;
  }
  function collectComplete() {
    var anims = [];
    for (var c = 0; c < 10; c++) {
      var col = cols[c];
      var n = col.length;
      if (n < 13) continue;
      var ok = col[n - 13].rank === 13;
      for (var k = n - 13 + 1; ok && k < n; k++) {
        if (col[k].suit !== col[k - 1].suit || col[k].rank !== col[k - 1].rank - 1) ok = false;
      }
      if (ok && col[n - 1].rank === 1) {
        var colEl = tableEl.children[c];
        var els = colEl ? colEl.querySelectorAll('.fc-card') : [];
        var startEl = Math.max(0, els.length - 13);
        var rects = [];
        for (var q = startEl; q < els.length; q++) rects.push(els[q] ? els[q].getBoundingClientRect() : null);
        var stepBefore = colEl ? getComputedStyle(colEl).getPropertyValue('--fc-step') : '';
        var belowUp = n - 13 > 0 ? col[n - 14].up : false;   /* 被收组下方的牌是否原本已翻开 */
        done.push(col[n - 13]);
        anims.push({ cards: col.slice(n - 13, n), rects: rects, col: c, step: stepBefore, belowUp: belowUp });
        col.splice(n - 13, 13);
        if (col.length) col[col.length - 1].up = true;
      }
    }
    if (anims.length) setTimeout(function () { animateCollects(anims); }, 0);
    return anims.length > 0;
  }
  // 收牌动画：从 A 到 K 依次飞到左下角已收牌区；源列保留原牌逐张起飞，目标 K 到达后才显示
  function animateCollects(anims) {
    var page = document.querySelector('.fc-page');
    if (!page) return;
    var doneRect = doneEl.getBoundingClientRect();
    var baseCard = doneEl.querySelector('.fc-card');
    var slotW = baseCard ? baseCard.getBoundingClientRect().width : 40;
    for (var g = 0; g < anims.length; g++) {
      var grp = anims[g];
      var slotIdx = done.length - anims.length + g;
      var slotLeft = doneRect.left + slotIdx * (slotW * 0.35);   // 已收牌堆叠放
      var toRect = { left: slotLeft, top: doneRect.top, width: grp.rects[0] ? grp.rects[0].width : slotW, height: grp.rects[0] ? grp.rects[0].height : 62 };
      var colEl = tableEl.children[grp.col];
      // 动画期间冻结列布局为收牌前（防瞬间弹回短列），结束后重新 fitColumns
      if (colEl && grp.step) colEl.style.setProperty('--fc-step', grp.step);
      // 源列重建原牌组（保持牌面直到逐张起飞）
      var holders = [];
      for (var k = 0; k < 13; k++) {
        var holder = cardEl(grp.cards[k], '', '');
        holder.className += ' sp-anim-src';
        holder.style.pointerEvents = 'none';
        colEl.appendChild(holder);
        holders.push(holder);
      }
      // 目标 K 先隐藏，最后一张（K）到达时才显示；源列新顶牌也隐藏到动画结束
      var doneElNew = doneEl.querySelectorAll('.sp-done-card');
      var targetK = doneElNew[doneElNew.length - 1];
      if (targetK) targetK.classList.add('sp-anim-target');
      var realCards = colEl.querySelectorAll('.fc-card:not(.sp-anim-src)');
      var newTop = realCards[realCards.length - 1];
      if (newTop && !grp.belowUp) newTop.classList.add('sp-anim-target');   /* 原本翻开的牌始终显示 */
      for (var k2 = 0; k2 < 13; k2++) {
        var flyIdx = 12 - k2;   // 从 A（数组尾）开始
        var holder = holders[flyIdx];
        if (!holder) continue;
        var fromR = holder.getBoundingClientRect();
        flyCard(grp.cards[flyIdx], fromR, toRect, k2 * 28, (function (h) {
          return function () { if (h && h.parentNode) h.parentNode.removeChild(h); };
        })(holder), k2 === 12 ? (function (kEl, nt, col) {
          return function () {
            if (kEl) kEl.classList.remove('sp-anim-target');
            if (nt) nt.classList.remove('sp-anim-target');
            if (col) fitColumns();   /* 动画结束恢复列布局 */
          };
        })(targetK, newTop, colEl) : null);
      }
    }
  }
  /* ---------- 撤销 ---------- */
  var undoHistory = [];
  var gameUndo = true;   // 当前局是否允许撤销（新局生效快照）
  function snapshotState() {
    return {
      cols: cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); }),
      stock: stock.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); }),
      done: done.map(function (x) { return { suit: x.suit, rank: x.rank }; })
    };
  }
  function pushHistory() {
    undoHistory.push(snapshotState());
    if (undoHistory.length > 1000) undoHistory.shift();
    updateUndoBtn();
  }
  function canUndo() { return undoHistory.length > 0; }
  function undoAllowed() { return !!spSettings.undo[spSettings.difficulty]; }
  function doUndo() {
    if (isSpec || !canUndo() || !gameUndo) return;
    var s = undoHistory.pop();
    cols = s.cols;
    stock = s.stock;
    done = s.done;
    sel = null;
    render();
    broadcastState();
    updateUndoBtn();
  }
  function clearHistory() {
    undoHistory = [];
    updateUndoBtn();
  }
  function updateUndoBtn() {
    var btn = $('btn-fc-undo');
    if (!btn) return;
    btn.classList.toggle('hidden', !gameUndo);
    btn.disabled = !canUndo();
  }

  function doMove(t) {
    pushHistory();
    var run = sel.run;
    var fromC = sel.c, fromI = sel.i;
    cols[t].push.apply(cols[t], run);
    cols[fromC].splice(fromI, run.length);
    if (cols[fromC].length) cols[fromC][cols[fromC].length - 1].up = true;   /* 移走后自动翻开 */
    sel = null;
    while (collectComplete()) {}
    broadcastMove(fromC, fromI, t);
    render();
    checkWin();
  }
  function dealStock() {
    if (!stock.length || isSpec) return;
    pushHistory();
    var srcEl = stockEl.querySelector('.sp-stock-pile.front .fc-card');
    var srcRect = srcEl ? srcEl.getBoundingClientRect() : null;
    var pile = stock.shift();
    for (var c = 0; c < 10; c++) {
      pile[c].up = true;
      cols[c].push(pile[c]);
    }
    while (collectComplete()) {}
    broadcastDeal();
    render();
    if (srcRect) {
      for (var c2 = 0; c2 < 10; c2++) {
        var cardEls = tableEl.children[c2].querySelectorAll('.fc-card');
        var target = cardEls[cardEls.length - 1];
        if (target) {
          target.classList.add('sp-anim-target');   /* 到达前先隐藏 */
          flyCard(pile[c2], srcRect, target.getBoundingClientRect(), c2 * 25, null, (function (el) {
            return function () { if (el) el.classList.remove('sp-anim-target'); };
          })(target));
        }
      }
    }
    checkWin();
  }

  /* ---------- 渲染 ---------- */
  function cardEl(card, extraClass, src) {
    var div = document.createElement('div');
    div.className = 'fc-card' + (extraClass ? ' ' + extraClass : '') + (card.up ? '' : ' face-down');
    div.dataset.suit = card.suit;
    div.dataset.rank = card.rank;
    if (src) div.dataset.src = src;
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
    s.src = (spSettings.twoColor ? SUIT_IMG_TC : SUIT_IMG)[card.suit];
    s.alt = '';
    s.draggable = false;
    div.appendChild(r1);
    div.appendChild(r2);
    div.appendChild(s);
    return div;
  }
  // 飞牌动画：延迟 delay 后从 fromRect 飞到 toRect；起飞时回调 onDepart，到达时回调 onArrive
  function flyCard(card, fromRect, toRect, delay, onDepart, onArrive) {
    setTimeout(function () {
      if (onDepart) onDepart();
      var page = document.querySelector('.fc-page');
      if (!page || !fromRect || !toRect) { if (onArrive) onArrive(); return; }
      var pageRect = page.getBoundingClientRect();
      var flyer = cardEl(card, '', '');
      flyer.style.position = 'absolute';
      flyer.style.zIndex = '200';
      flyer.style.pointerEvents = 'none';
      flyer.style.width = fromRect.width + 'px';
      flyer.style.height = fromRect.height + 'px';
      flyer.style.left = (fromRect.left - pageRect.left) + 'px';
      flyer.style.top = (fromRect.top - pageRect.top) + 'px';
      flyer.style.transition = 'left 0.28s ease-out, top 0.28s ease-out';
      page.appendChild(flyer);
      void flyer.offsetWidth;
      flyer.style.left = (toRect.left - pageRect.left) + 'px';
      flyer.style.top = (toRect.top - pageRect.top) + 'px';
      setTimeout(function () {
        if (flyer.parentNode) flyer.parentNode.removeChild(flyer);
        if (onArrive) onArrive();
      }, 300);
    }, delay || 0);
  }
  function emptySlotEl() {
    var div = document.createElement('div');
    div.className = 'fc-cell fc-empty sp-slot';
    return div;
  }
  function render() {
    renderCols();
    renderStock();
    renderDone();
    fitColumns();
  }
  function renderCols() {
    tableEl.innerHTML = '';
    for (var c = 0; c < 10; c++) {
      var colEl = document.createElement('div');
      colEl.className = 'fc-col sp-col';
      colEl.dataset.col = c;
      var col = cols[c];
      for (var i = 0; i < col.length; i++) {
        var isSel = sel && sel.c === c && i >= sel.i;
        var el = cardEl(col[i], isSel ? 'sel' : '', 'col:' + c + ':' + i);
        el.dataset.idx = i;
        colEl.appendChild(el);
      }
      tableEl.appendChild(colEl);
    }
  }
  function renderStock() {
    stockEl.innerHTML = '';
    var consumed = 5 - stock.length;   // 已发放的组数：剩余牌堆保持在原槽位，消耗的槽留空（从左往右减少）
    for (var p = 0; p < stock.length; p++) {
      var pileEl = document.createElement('div');
      pileEl.className = 'sp-stock-pile' + (p === 0 ? ' front' : '');
      pileEl.style.left = 'calc(var(--fc-c) * ' + ((consumed + p) * 0.35).toFixed(2) + ')';
      pileEl.style.zIndex = stock.length - p;
      var fake = { suit: 's', rank: 0, up: false };
      pileEl.appendChild(cardEl(fake, '', 'stock:' + p));
      stockEl.appendChild(pileEl);
    }
  }
  function renderDone() {
    doneEl.innerHTML = '';
    for (var i = 0; i < done.length; i++) {
      var el = cardEl(done[i], '', 'done:' + i);
      el.classList.add('sp-done-card');
      doneEl.appendChild(el);
    }
  }
  function fitColumns() {
    var avail = tableEl.clientHeight;
    if (!avail) return;
    for (var c = 0; c < 10; c++) {
      var col = tableEl.children[c];
      if (!col) continue;
      var len = cols[c].length;
      if (len <= 1) { col.style.setProperty('--fc-step', 'calc(var(--fc-c) * 0.3)'); continue; }
      var card = col.querySelector('.fc-card');
      if (!card) continue;
      var cardH = card.getBoundingClientRect().height;
      if (!cardH) continue;
      var fitStep = (avail - cardH) / (len - 1);
      col.style.setProperty('--fc-step', Math.max(cardH * 0.06, Math.min(cardH * 0.22, fitStep)) + 'px');
    }
  }

  /* ---------- 选中与移动 ---------- */
  function clearSel() {
    if (!sel) return;
    sel = null;
    render();
  }
  function tryMoveSelToCol(colIdx) {
    if (!sel) return false;
    if (sel.c === colIdx) { clearSel(); return false; }
    var run = sel.run;
    if (!run || !run.length) return false;
    if (!canMoveTo(colIdx, run)) return false;
    doMove(colIdx);
    return true;
  }

  /* ---------- 交互 ---------- */
  // 点击牌：可挪动则选中；已有选中时点击列顶牌 = 先尝试把选中项放到它上面，放不下再切换选中项
  function onColClick(colIdx, ev) {
    var cardElHit = ev.target.closest ? ev.target.closest('.fc-card') : null;
    if (cardElHit) {
      var idx = parseInt(cardElHit.dataset.idx, 10);
      if (sel && sel.c === colIdx && sel.i === idx) { clearSel(); return; }
      if (sel && idx === cols[colIdx].length - 1 && sel.c !== colIdx && tryMoveSelToCol(colIdx)) return;
      var run = runFrom(colIdx, idx);
      if (!run) { clearSel(); return; }
      sel = { c: colIdx, i: idx, run: run };
      render();
      return;
    }
    if (sel) {
      if (colIdx === sel.c) { clearSel(); return; }
      if (tryMoveSelToCol(colIdx)) return;
      toast('无法放到这里：目标顶牌需比它大 1 点且同花色');
    }
  }

  /* ---------- 拖动（指针事件，鼠标/触摸通用） ---------- */
  var dragInfo = null;
  var dragSuppressClick = false;
  function parseSrc(s) {
    var parts = String(s || '').split(':');
    if (parts.length < 2) return null;
    return { type: parts[0], a: parseInt(parts[1], 10), b: parts.length > 2 ? parseInt(parts[2], 10) : 0 };
  }
  function setSelFromSrc(src) {
    if (src.type === 'col') {
      var run = runFrom(src.a, src.b);
      if (run) sel = { c: src.a, i: src.b, run: run };
    }
  }
  function srcCards(src) {
    if (src.type === 'col') return cols[src.a].slice(src.b);
    return [];
  }
  function markSrcSel(src) {
    var colEl = tableEl.children[src.a];
    if (!colEl) return;
    var els = colEl.querySelectorAll('.fc-card');
    for (var i = src.b; i < els.length; i++) {
      els[i].classList.add('sel');
      els[i].classList.add('fc-drag-hidden');
    }
  }
  function sourceRunRect(src) {
    var colEl = tableEl.children[src.a];
    if (!colEl) return null;
    var els = colEl.querySelectorAll('.fc-card');
    if (!els[src.b]) return null;
    return els[src.b].getBoundingClientRect();
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
    var colEl = tableEl.children[src.a];
    if (colEl) {
      var s = getComputedStyle(colEl).getPropertyValue('--fc-step');
      if (s) wrap.style.setProperty('--fc-step', s);
    }
    cards.forEach(function (card) {
      wrap.appendChild(cardEl(card, '', ''));
    });
    page.appendChild(wrap);
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
  function srcMovable(src) {
    if (src.type === 'col') {
      var run = runFrom(src.a, src.b);
      return !!run;
    }
    return false;
  }
  function nearestTarget(x, y) {
    var card = tableEl.querySelector('.fc-card');
    var snap = card ? card.getBoundingClientRect().width * 0.7 : 60;
    var best = null, bestD = Infinity;
    for (var c = 0; c < 10; c++) {
      var r = tableEl.children[c].getBoundingClientRect();
      var dx = Math.max(r.left - x, 0, x - r.right);
      var dy = Math.max(r.top - y, 0, y - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= snap ? best : null;
  }
  function dropAt(src, clientX, clientY, ghost) {
    setSelFromSrc(src);
    if (!sel) { removeGhost(ghost); clearSel(); return; }
    var target = document.elementFromPoint(clientX, clientY);
    var colEl = target && target.closest ? target.closest('.fc-col') : null;
    if (!colEl) {
      var near = nearestTarget(clientX, clientY);
      if (near !== null) colEl = tableEl.children[near];
    }
    var moved = false;
    if (colEl) {
      var colIdx = parseInt(colEl.dataset.col, 10);
      if (sel.c === colIdx) sel = null;
      else moved = tryMoveSelToCol(colIdx);
    } else {
      sel = null;
    }
    if (moved) {
      removeGhost(ghost);
    } else {
      bounceBack(src, ghost);
    }
  }
  function bounceBack(src, ghost) {
    if (ghost) {
      var rect = sourceRunRect(src);
      if (rect) {
        ghost.wrap.style.transition = 'left 0.16s ease-out, top 0.16s ease-out';
        void ghost.wrap.offsetWidth;
        ghost.wrap.style.left = (rect.left - ghost.pageRect.left) + 'px';
        ghost.wrap.style.top = (rect.top - ghost.pageRect.top) + 'px';
        setTimeout(function () {
          removeGhost(ghost);
          render();
        }, 180);
        return;
      }
      removeGhost(ghost);
    }
    render();
  }

  document.addEventListener('pointerdown', function (ev) {
    if (isSpec) return;
    var cardElHit = ev.target.closest ? ev.target.closest('.fc-card') : null;
    if (!cardElHit || !cardElHit.dataset.src) return;
    var src = parseSrc(cardElHit.dataset.src);
    if (!src) return;
    if (src.type !== 'col') return;
    if (!srcMovable(src)) return;
    dragInfo = { cardEl: cardElHit, src: src, startX: ev.clientX, startY: ev.clientY, offX: 0, offY: 0, active: false, ghost: null };
    try { cardElHit.setPointerCapture(ev.pointerId); } catch (e) {}
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
    if (isSpec) return;
    if (dragInfo && dragInfo.active) {
      var di = dragInfo;
      dragInfo = null;
      dragSuppressClick = true;
      setTimeout(function () { dragSuppressClick = false; }, 50);
      dropAt(di.src, ev.clientX, ev.clientY, di.ghost);
      return;
    }
    dragInfo = null;
  });
  document.addEventListener('pointercancel', function () {
    if (!dragInfo) return;
    removeGhost(dragInfo.ghost);
    dragInfo = null;
    render();
  });

  /* ---------- 点击（选中后点目标移动） ---------- */
  tableEl.addEventListener('click', function (ev) {
    if (isSpec) return;
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var colEl = ev.target.closest ? ev.target.closest('.fc-col') : null;
    if (!colEl) { clearSel(); return; }
    onColClick(parseInt(colEl.dataset.col, 10), ev);
  });
  stockEl.addEventListener('click', function (ev) {
    if (isSpec) return;
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var pile = ev.target.closest ? ev.target.closest('.sp-stock-pile') : null;
    if (pile && pile.classList.contains('front')) dealStock();
    else if (stock.length) toast('只能点击最左面的牌堆');
  });

  /* ---------- 通关 ---------- */
  function checkWin() {
    if (done.length >= 8) showModal($('fc-win-modal'));
  }

  /* ---------- 计时 ---------- */
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
    if (timerEl) timerEl.classList.toggle('hidden', !spSettings.timer);
    if (!spSettings.timer) return;
    updateTimer();
    timerTick = setInterval(updateTimer, 1000);
  }

  /* ---------- 新局 / 重玩 / 胜利 ---------- */
  function newGame() {
    resetTimer();
    gameUndo = undoAllowed();   /* 新局生效快照 */
    dealGame();
    sel = null;
    clearHistory();
    hideModal($('fc-win-modal'));
    hideModal($('fc-restart-modal'));
    if (spMode === 'host' && !spSettings.allowSpec) Net.kickSpecs('房主已禁止观战');
    render();
    broadcastState();
  }
  function replayGame() {
    if (!initCols) return;
    resetTimer();
    gameUndo = undoAllowed();
    cols = initCols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    stock = initStock.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    done = [];
    sel = null;
    clearHistory();
    hideModal($('fc-win-modal'));
    hideModal($('fc-restart-modal'));
    render();
    broadcastState();
  }
  function showRestartModal() {
    hideModal($('fc-win-modal'));
    showModal($('fc-restart-modal'));
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
  var diffOrder = ['single', 'two', 'four'];
  var diffNames = { single: '单色', two: '双色', four: '四色' };
  function syncDifficulty() {
    var idx = diffOrder.indexOf(spSettings.difficulty);
    if (idx < 0) { idx = 0; spSettings.difficulty = diffOrder[0]; }
    var lbl = $('sp-diff-label');
    if (lbl) lbl.textContent = diffNames[spSettings.difficulty];
    var hint = $('sp-four-hint');
    if (hint) hint.classList.toggle('hidden', spSettings.difficulty !== 'four');
    setToggle($('opt-undo'), undoAllowed());
  }
  function cycleDifficulty(dir) {
    if (isSpec) return;
    var idx = diffOrder.indexOf(spSettings.difficulty);
    idx = (idx + dir + diffOrder.length) % diffOrder.length;
    spSettings.difficulty = diffOrder[idx];
    syncDifficulty();
  }
  function applyUiSettings() {
    var page = document.querySelector('.fc-page');
    if (!page) return;
    page.classList.toggle('fc-solid-cards', !spSettings.transparent);
    page.classList.toggle('fc-suit-border', spSettings.suitBorder && !spSettings.twoColor);
    page.classList.toggle('fc-two-color-border', spSettings.suitBorder && spSettings.twoColor);
    document.documentElement.style.setProperty('--fc-win-scale', spSettings.winScale);
    if (timerEl) timerEl.classList.toggle('hidden', !spSettings.timer);
    render();
  }
  var winScaleSlider = $('fc-win-scale');
  var winScaleLabel = $('fc-win-scale-label');
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
      ['opt-allow-spec', 'allowSpec'], ['opt-open', 'open'], ['opt-timer', 'timer'],
      ['opt-transparent', 'transparent'], ['opt-suit-border', 'suitBorder'], ['opt-two-color', 'twoColor']
    ];
    map.forEach(function (pair) { setToggle($(pair[0]), spSettings[pair[1]]); });
    if (winScaleSlider) winScaleSlider.value = Math.round(spSettings.winScale * 100);
    if (winScaleLabel) winScaleLabel.textContent = Math.round(spSettings.winScale * 100) + '%';
    syncDifficulty();
    syncOpenLock();
  }
  function syncOpenLock() {
    var openEl = $('opt-open');
    if (!openEl) return;
    var locked = !spSettings.allowSpec || isSpec;
    openEl.disabled = locked;
    openEl.classList.toggle('disabled', locked);
  }
  var settingsBackup = null;
  function openSettings() {
    settingsBackup = JSON.parse(JSON.stringify(spSettings));
    syncSettingsUI();
    showModal($('fc-settings-modal'));
    styleFcSlider();
    requestAnimationFrame(styleFcSlider);
    updateFcSettingsScrollbar();
  }
  function applySettings() {
    if (!spSettings.allowSpec) spSettings.open = false;
    saveSettings();
    settingsBackup = null;
    hideModal($('fc-settings-modal'));
    syncOpenRoom();
  }
  function cancelSettings() {
    if (settingsBackup) {
      for (var k in spSettings) spSettings[k] = settingsBackup[k];
      settingsBackup = null;
    }
    applyUiSettings();
    syncSettingsUI();
    hideModal($('fc-settings-modal'));
  }
  function resetSettings() {
    var defaults = { difficulty: 'single', allowSpec: false, open: false, timer: true, winScale: 1, transparent: true, suitBorder: false, twoColor: false, undo: { single: false, two: true, four: true } };
    for (var k in spSettings) spSettings[k] = defaults[k];
    applyUiSettings();
    syncSettingsUI();
    toast('已恢复默认设置');
  }
  [
    ['opt-allow-spec', 'allowSpec', false], ['opt-open', 'open', false], ['opt-timer', 'timer', false],
    ['opt-transparent', 'transparent', true], ['opt-suit-border', 'suitBorder', true], ['opt-two-color', 'twoColor', true]
  ].forEach(function (pair) {
    var el = $(pair[0]);
    if (!el) return;
    el.addEventListener('click', function () {
      if (pair[0] === 'opt-open' && (!spSettings.allowSpec || isSpec)) return;
      spSettings[pair[1]] = !toggleIsOn(el);
      setToggle(el, spSettings[pair[1]]);
      if (pair[0] === 'opt-allow-spec') syncOpenLock();
      if (pair[2]) applyUiSettings();
    });
  });
  document.querySelectorAll('#sp-difficulty .switch-arrow').forEach(function (b) {
    b.addEventListener('click', function () {
      cycleDifficulty(b.id === 'sp-diff-next' ? 1 : -1);
    });
  });
  var optUndo = $('opt-undo');
  if (optUndo) optUndo.addEventListener('click', function () {
    if (isSpec) return;
    spSettings.undo[spSettings.difficulty] = !toggleIsOn(optUndo);
    setToggle(optUndo, spSettings.undo[spSettings.difficulty]);
  });
  if (winScaleSlider) winScaleSlider.addEventListener('input', function () {
    spSettings.winScale = parseFloat(winScaleSlider.value) / 100;
    if (winScaleLabel) winScaleLabel.textContent = winScaleSlider.value + '%';
    styleFcSlider();
    applyUiSettings();
  });

  /* ---------- 控件 ---------- */
  $('btn-fc-new').addEventListener('click', showRestartModal);
  $('btn-fc-undo').addEventListener('click', doUndo);
  document.addEventListener('keydown', function (ev) {
    if (isSpec) return;
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      doUndo();
    }
  });
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
    if (spMode !== 'host') viewCodeBtn.classList.add('hidden');
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
    var link = new URL('spider.html', location.href);
    link.search = '?mode=join&id=' + encodeURIComponent(id) + '&spec=1';
    copyText(link.href, '已复制加入链接');
  });

  var updateFcSettingsScrollbar = Profile.wireScrollbar(
    document.getElementById('fc-settings-body'),
    document.getElementById('fc-settings-scrollbar'),
    document.getElementById('fc-settings-scrollbar-thumb')
  );
  window.addEventListener('resize', function () { updateFcSettingsScrollbar(); });

  /* ---------- 启动 ---------- */
  loadSettings();
  syncSettingsUI();
  Profile.applyBackground();
  window.addEventListener('resize', function () { Profile.adjustBtnHitAreas(); fitColumns(); styleFcSlider(); });

  initNet();
  if (!isSpec) newGame();
  applyUiSettings();
  syncOpenRoom();

  window.addEventListener('pagehide', function () {
    unregisterOpenRoom(myPeerId);
  });
})();


