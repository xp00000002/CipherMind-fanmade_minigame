/* klondike.js - Klondike Solitaire（经典纸牌）单机 + 观战逻辑 */
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

  var cols = [];       // 7 列（数组末尾为底；col[c][0] 为顶）
  var fnds = [];       // 4 个置牌位（数组末尾为顶）
  var stock = [];      // 牌堆（未翻开，stock[0] 为下次要翻的）
  var waste = [];      // 翻牌区（数组末尾为最右可取的）
  var sel = null;      // { type: 'col'|'waste'|'fnd', a, b }

  var tableEl = document.getElementById('fc-table');
  var fndEl = document.getElementById('fc-foundations');
  var stockEl = document.getElementById('kd-stock');
  var wasteEl = document.getElementById('kd-waste');
  var stockIcon = document.getElementById('kd-stock-icon');
  var toastEl = document.getElementById('toast');

  function $(id) { return document.getElementById(id); }

  /* ---------- 设置 ---------- */
  var fcSettings = {
    emptyColK: true,    // 空列仅允许K或最下方为K的牌组（新局生效，默认开启）
    allowSpec: false,   // 允许观战
    open: false,        // 设为开放（仅允许观战开启时可修改）
    timer: true,        // 计时
    winScale: 1,        // 窗口缩放
    dblCascade: true,   // 双击自动置入置牌位
    transparent: true,  // 牌面透明
    suitBorder: false,  // 边框提示花色
    twoColor: false,    // 双色模式
    showMinMoves: true  // 显示最短步数
  };
  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem('kdSettings'));
      if (saved) {
        for (var k in fcSettings) {
          if (saved[k] !== undefined) fcSettings[k] = saved[k];
        }
      }
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('kdSettings', JSON.stringify(fcSettings)); } catch (e) {}
  }
  var gameSettings = { emptyColK: true };   // 新局生效的规则快照
  function isRed(card) { return card.suit === 'h' || card.suit === 'd'; }
  function isUp(card) { return !!(card && card.up); }

  // 一叠牌是否为合法序列（从大到小、花色间隔）且全部翻开
  function validRun(cards) {
    if (!cards.length) return false;
    for (var i = 0; i < cards.length; i++) if (!isUp(cards[i])) return false;
    for (var j = 1; j < cards.length; j++) {
      if (cards[j].rank !== cards[j - 1].rank - 1) return false;
      if (isRed(cards[j]) === isRed(cards[j - 1])) return false;
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

  function canPlaceOnAnyFnd(card) {
    for (var p = 0; p < 4; p++) if (canPlaceOnFnd(card, p)) return true;
    return false;
  }

  /* ---------- 联机/观战 ---------- */
  var kdParams = new URLSearchParams(location.search);
  var kdMode = kdParams.get('mode');        // 'host' | 'join' | null
  var kdJoinId = kdParams.get('id');
  var isSpec = false;
  var myPeerId = null;

  function currentState() {
    return {
      cols: cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); }),
      fnds: fnds.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank }; }); }),
      stock: stock.map(function (x) { return { suit: x.suit, rank: x.rank }; }),
      waste: waste.map(function (x) { return { suit: x.suit, rank: x.rank }; }),
      minMoves: bankMinMoves,
      elapsed: Date.now() - gameStartTime,
      timerOn: fcSettings.timer
    };
  }
  function broadcastState() {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'kd-state', state: currentState() });
  }
  function broadcastMove(src, dst) {
    if (isSpec || !Net.isHost()) return;
    Net.sendToSpecs({ type: 'kd-move', m: { s: { t: src.type, a: src.a, b: src.b }, d: { t: dst.type, a: dst.a } } });
  }
  function flipTop(c) {
    var col = cols[c];
    var top = col[col.length - 1];
    if (top && !top.up) top.up = true;   /* 移走后自动翻开 */
  }
  function applyRemoteState(st) {
    if (!st) return;
    cols = st.cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    fnds = st.fnds.map(function (p) { return p.map(function (x) { return { suit: x.suit, rank: x.rank }; }); });
    stock = st.stock.map(function (x) { return { suit: x.suit, rank: x.rank, up: false }; });
    waste = st.waste.map(function (x) { return { suit: x.suit, rank: x.rank, up: true }; });
    bankMinMoves = st.minMoves || 0;
    updateMinMoves();
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
    if (s.t === 'col') {
      if (d.t === 'col') { cols[d.a].push.apply(cols[d.a], cols[s.a].splice(s.b)); flipTop(s.a); }
      else { fnds[d.a].push(cols[s.a].pop()); flipTop(s.a); }
    } else if (s.t === 'waste') {
      if (d.t === 'col') cols[d.a].push(waste.pop());
      else fnds[d.a].push(waste.pop());
    } else if (s.t === 'fnd') {
      if (d.t === 'col') cols[d.a].push(fnds[s.a].pop());
      else fnds[d.a].push(fnds[s.a].pop());
    } else if (s.t === 'stock') {
      var n = Math.min(3, stock.length);
      for (var i = 0; i < n; i++) {
        var sc = stock.shift();
        sc.up = true;
        waste.push(sc);
      }
    } else if (s.t === 'waste' && d.t === 'stock') {
      while (waste.length) {
        var wc0 = waste.pop();
        wc0.up = false;   /* 收回时翻回背面 */
        stock.unshift(wc0);
      }
    }
    render();
  }

  // 开放房间注册（与 chess/freecell 共用注册表）
  function openRoomSummary() {
    return '纸牌(Klondike)' + (fcSettings.emptyColK ? ' | 仅K空列' : '');
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
    list.push({ id: id, hostName: hostName, rules: openRoomSummary(), gameStarted: !!started, allowSpec: !!fcSettings.allowSpec, noChat: false, ts: now, game: 'klondike' });
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
    if (kdMode !== 'host' || !myPeerId) return;
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

  function updateSpecCountDisplay(n) {
    var el = $('fc-spec-count');
    if (el) el.textContent = n || 0;
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

  function initNet() {
    if (kdMode === 'host') {
      Net.connect({
        mode: 'host',
        soloSpec: true,
        name: (Profile.get() || {}).name || '',
        onId: function (id) {
          myPeerId = id;
          syncOpenRoom();
        },
        onSpecJoin: function (c) {
          c.send({ type: 'kd-state', state: currentState() });
        },
        onSpecCount: updateSpecCountDisplay
      });
      return;
    }
    if (kdMode === 'join' && kdJoinId) {
      Net.connect({
        mode: 'join',
        hostId: kdJoinId,
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
          if (data.type === 'kd-state') applyRemoteState(data.state);
          else if (data.type === 'kd-move') applyRemoteMove(data.m);
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

  /* ---------- 游戏状态 ---------- */
  // 反向构造发牌：随机游走合法逆步（含列间转移、翻牌区往返），记录逆步并正向自校验，必有解
  var dealMoves = [];
  function buildDealWalk() {
    var piles = SUITS.map(function (s) {
      var p = [];
      for (var r = 1; r <= 13; r++) p.push({ suit: s, rank: r, up: false });   // K 在顶（先弹出）
      return p;
    });
    function randNonEmptyPile() {
      var p = Math.floor(Math.random() * 4);
      while (!piles[p].length) p = (p + 1) % 4;
      return p;
    }
    function randColWithSpace() {
      var ci = Math.floor(Math.random() * 7);
      while (counts[ci] >= curTgt[ci]) ci = (ci + 1) % 7;
      return ci;
    }
    // 偏好把牌放到能合法叠放其上的列（制造长序列，增加列间转移机会）
    function randColForCard(card) {
      var fits = [];
      for (var i = 0; i < 7; i++) {
        if (counts[i] >= curTgt[i]) continue;
        var top = cols[i][cols[i].length - 1];
        if (!top || (top.rank === card.rank + 1 && isRed(top) !== isRed(card))) fits.push(i);
      }
      if (fits.length) return fits[Math.floor(Math.random() * fits.length)];
      return randColWithSpace();
    }
    function colEndRun(ci) {
      var col = cols[ci];
      var run = [];
      for (var i = col.length - 1; i >= 0; i--) {
        var c = col[i];
        if (run.length && !(c.rank === run[run.length - 1].rank - 1 && isRed(c) !== isRed(run[run.length - 1]))) break;
        run.push(c);
      }
      run.reverse();
      return run;
    }
    function topReturnable(ci, len) {
      var col = cols[ci];
      if (len > col.length) return false;
      var r0 = col[col.length - len];
      var below = col[col.length - len - 1];
      if (below === undefined) return !gameSettings.emptyColK || r0.rank === 13;
      return below.rank === r0.rank + 1 && isRed(below) !== isRed(r0);
    }
    function anyColMoveable() {
      for (var i = 0; i < 7; i++) {
        if (!cols[i].length) continue;
        var run = colEndRun(i);
        if (!run.length) continue;
        for (var L = 1; L <= run.length; L++) {
          if (!topReturnable(i, L)) continue;
          for (var j = 0; j < 7; j++) if (j !== i && counts[j] + L <= curTgt[j]) return true;
        }
      }
      return false;
    }
    function randColMove() {
      var opts = [];
      for (var i = 0; i < 7; i++) {
        if (!cols[i].length) continue;
        var run = colEndRun(i);
        if (!run.length) continue;
        for (var L = 1; L <= run.length; L++) {
          if (!topReturnable(i, L)) continue;
          for (var j = 0; j < 7; j++) if (j !== i && counts[j] + L <= curTgt[j]) opts.push({ from: i, len: L, to: j });
        }
      }
      return opts[Math.floor(Math.random() * opts.length)];
    }
    function hasReturnableTop() {
      for (var i = 0; i < 7; i++) if (cols[i].length && topReturnable(i, 1)) return true;
      return false;
    }
    function randReturnableCol() {
      var ci = Math.floor(Math.random() * 7);
      while (!cols[ci].length || !topReturnable(ci, 1)) ci = (ci + 1) % 7;
      return ci;
    }
    function hasColSpace() {
      for (var i = 0; i < 7; i++) if (counts[i] < curTgt[i]) return true;
      return false;
    }
    var colTarget = [1, 2, 3, 4, 5, 6, 7];
    var curTgt = colTarget;
    // 中段限制列容量（预留空位给最后的低牌：A/2 进列而非全进牌堆）
    function capTarget() {
      return remaining > 12 ? [1, 2, 3, 4, 1, 1, 1] : colTarget;
    }
    cols = [];
    for (var c = 0; c < 7; c++) cols.push([]);
    var counts = [0, 0, 0, 0, 0, 0, 0];
    stock = [];
    waste = [];
    dealMoves = [];
    var remaining = 52;
    var steps = 0;
    while ((remaining > 0 || waste.length || stock.length < 24) && steps < 8000) {
      steps++;
      curTgt = capTarget();
      if (remaining <= 12 && remaining > 0 && hasColSpace()) {
        var cardZ = piles[randNonEmptyPile()].pop();
        var ciZ = randColForCard(cardZ);
        cols[ciZ].push(cardZ);   // fnd→col（最后 12 张低牌优先进列：A 不再全进牌堆）
        counts[ciZ]++;
        dealMoves.push({ t: 'nc', ci: ciZ });
        remaining--;
        continue;
      }
      var wantMove = Math.random() < 0.97 && anyColMoveable();
      if (wantMove) {
        var tr = randColMove();
        cols[tr.to].push.apply(cols[tr.to], cols[tr.from].splice(cols[tr.from].length - tr.len));   // col→col
        counts[tr.from] -= tr.len;
        counts[tr.to] += tr.len;
        dealMoves.push({ t: 'cc', from: tr.from, len: tr.len, to: tr.to });
        continue;
      }
      var q = Math.random();
      if (remaining > 0 && q < 0.5 && hasColSpace()) {
        var cardA = piles[randNonEmptyPile()].pop();
        var ciA = randColForCard(cardA);
        cols[ciA].push(cardA);   // fnd→col
        counts[ciA]++;
        dealMoves.push({ t: 'nc', ci: ciA });
        remaining--;
      } else if (remaining > 0 && q < 0.62) {
        waste.push(piles[randNonEmptyPile()].pop());                      // fnd→waste
        dealMoves.push({ t: 'nw' });
        remaining--;
      } else if (stock.length < 24 && waste.length) {
        var n = Math.min(3, waste.length, 24 - stock.length);
        for (var k = 0; k < n; k++) stock.unshift(waste.pop());           // waste→stock（3 张一组）
        dealMoves.push({ t: 'ws', n: n });
      } else if (waste.length && hasColSpace()) {
        var ciB = randColWithSpace();
        cols[ciB].push(waste.pop());                                     // waste→col
        counts[ciB]++;
        dealMoves.push({ t: 'wc', ci: ciB });
      } else if (waste.length && hasReturnableTop()) {
        var cw = randReturnableCol();
        waste.push(cols[cw].pop());                                       // col→waste
        counts[cw]--;
        dealMoves.push({ t: 'cw', ci: cw });
      } else if (remaining > 0 && hasColSpace()) {
        var cardC = piles[randNonEmptyPile()].pop();
        var ciC = randColForCard(cardC);
        cols[ciC].push(cardC);   // fnd→col
        counts[ciC]++;
        dealMoves.push({ t: 'nc', ci: ciC });
        remaining--;
      } else if (remaining > 0) {
        waste.push(piles[randNonEmptyPile()].pop());                      // fnd→waste（列满时走翻牌区）
        dealMoves.push({ t: 'nw' });
        remaining--;
      } else {
        break;
      }
    }
    // 完成条件：无剩余、翻牌区清空、牌堆 24 张
    if (remaining !== 0 || waste.length !== 0 || stock.length !== 24) return false;
    for (var c2 = 0; c2 < 7; c2++) {
      for (var k2 = 0; k2 < cols[c2].length - 1; k2++) cols[c2][k2].up = false;
      if (cols[c2].length) cols[c2][cols[c2].length - 1].up = true;
    }
    return true;
  }
  // 正向自校验：重放逆步，全部合法才算通过
  function verifyDealReplay() {
    var fnds = [[], [], [], []];
    var foundPile = { s: 0, h: 1, c: 2, d: 3 };
    var tcols = cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    var tstock = stock.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; });
    var twaste = [];
    var moves = dealMoves.slice().reverse();
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var card, p, run, r0, below;
      if (m.t === 'nc') {
        card = tcols[m.ci][tcols[m.ci].length - 1];
        if (!card || !card.up) return false;
        p = foundPile[card.suit];
        if (!canPlaceFndLocal(fnds, card, p)) return false;
        tcols[m.ci].pop();
        fnds[p].push(card);
        if (tcols[m.ci].length) tcols[m.ci][tcols[m.ci].length - 1].up = true;
      } else if (m.t === 'nw') {
        if (!twaste.length) return false;
        card = twaste[twaste.length - 1];
        p = foundPile[card.suit];
        if (!canPlaceFndLocal(fnds, card, p)) return false;
        twaste.pop();
        fnds[p].push(card);
      } else if (m.t === 'ws') {
        var n = m.n || 3;
        for (var k = 0; k < n && tstock.length; k++) {
          var c = tstock.shift();
          c.up = true;
          twaste.push(c);
        }
      } else if (m.t === 'wc') {
        card = tcols[m.ci][tcols[m.ci].length - 1];
        if (!card || !card.up) return false;
        tcols[m.ci].pop();
        twaste.push(card);
        if (tcols[m.ci].length) tcols[m.ci][tcols[m.ci].length - 1].up = true;
      } else if (m.t === 'cw') {
        if (!twaste.length) return false;
        card = twaste[twaste.length - 1];
        if (!canPlaceColLocal(tcols, card, m.ci)) return false;
        twaste.pop();
        tcols[m.ci].push(card);
      } else {
        run = tcols[m.to].slice(tcols[m.to].length - m.len);
        if (!run.length || !run[run.length - 1].up) return false;
        r0 = run[0];
        below = tcols[m.from][tcols[m.from].length - 1];
        var ok = !below ? (!gameSettings.emptyColK || r0.rank === 13) : (below.rank === r0.rank + 1 && isRed(below) !== isRed(r0));
        if (!ok) return false;
        tcols[m.from].push.apply(tcols[m.from], tcols[m.to].splice(tcols[m.to].length - m.len));
        if (tcols[m.to].length) tcols[m.to][tcols[m.to].length - 1].up = true;
      }
    }
    return fnds[0].length === 13 && fnds[1].length === 13 && fnds[2].length === 13 && fnds[3].length === 13;
  }
  function canPlaceFndLocal(fnds, card, p) {
    var pile = fnds[p];
    if (!pile.length) return card.rank === 1;
    var top = pile[pile.length - 1];
    return top.suit === card.suit && card.rank === top.rank + 1;
  }
  function canPlaceColLocal(tcols, card, ci) {
    var top = tcols[ci][tcols[ci].length - 1];
    if (!top) return true;
    return top.rank === card.rank + 1 && isRed(top) !== isRed(card);
  }
  var KD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // 解码发牌库：52 张牌 × 6 位（LSB 先行）打包成 39 字节 → base64 52 字符
  function decodeDeckB64(s) {
    var bytes = [];
    for (var i = 0; i < 39; i++) {
      var v = (KD_B64.indexOf(s[i * 4]) << 18) | (KD_B64.indexOf(s[i * 4 + 1]) << 12) | (KD_B64.indexOf(s[i * 4 + 2]) << 6) | KD_B64.indexOf(s[i * 4 + 3]);
      bytes.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
    }
    var deck = [];
    for (var i = 0; i < 52; i++) {
      var bit = i * 6, b0 = bit & 7;
      var idx = (bytes[bit >> 3] >> b0) & 63;
      if (b0 > 2) idx |= ((bytes[(bit >> 3) + 1] & ((1 << (b0 - 2)) - 1)) << (8 - b0));
      deck.push({ suit: ['c', 'd', 'h', 's'][Math.floor(idx / 13)], rank: (idx % 13) + 1 });
    }
    return deck;
  }
  function bankEntries() {
    var all = [];
    for (var k = 1; k < 100; k++) {
      var b = window['KD_BANK_' + k];
      if (b) all = all.concat(String(b).split('|'));
    }
    return all;
  }
  var bankMinMoves = 0;
  function updateMinMoves() {
    var el = $('kd-min-moves');
    if (el) el.textContent = bankMinMoves ? '最短解 ' + bankMinMoves + ' 步' : '';
  }
  var initCols = null;
  var initStock = null;
  function snapshotDeal() {
    initCols = cols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    initStock = stock.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; });
  }
  function dealPiles() {
    var entries = bankEntries();
    if (entries.length) {
      var e = entries[Math.floor(Math.random() * entries.length)];
      var sep = e.indexOf(':');
      bankMinMoves = parseInt(e.slice(0, sep), 10) || 0;
      var deck = decodeDeckB64(e.slice(sep + 1));
      var colPos = [[0], [1, 7], [2, 8, 13], [3, 9, 14, 18], [4, 10, 15, 19, 22], [5, 11, 16, 20, 23, 25], [6, 12, 17, 21, 24, 26, 27]];
      cols = [];
      for (var c = 0; c < 7; c++) {
        var col = [];
        for (var k = 0; k < colPos[c].length; k++) {
          var cd = deck[colPos[c][k]];
          col.push({ suit: cd.suit, rank: cd.rank, up: false });
        }
        col[col.length - 1].up = true;
        cols.push(col);
      }
      stock = [];
      for (var i = 28; i < 52; i++) {
        var cd2 = deck[i];
        stock.push({ suit: cd2.suit, rank: cd2.rank, up: false });
      }
      waste = [];
      fnds = [[], [], [], []];
      updateMinMoves();
      snapshotDeal();
      return;
    }
    /* 无发牌库时：构造发牌兜底 */
    var attempts = 0;
    while (attempts < 80) {
      attempts++;
      if (!buildDealWalk()) continue;
      if (verifyDealReplay() && dealMoves.length >= 60 && dealMoves.length <= 320) { fnds = [[], [], [], []]; window.__dealLen = dealMoves.length; bankMinMoves = 0; updateMinMoves(); snapshotDeal(); return; }
    }
    /* 极端兜底：最后一次直接使用（概率极低） */
    buildDealWalk();
    if (!verifyDealReplay()) buildDealWalk();
    fnds = [[], [], [], []];
    bankMinMoves = 0;
    updateMinMoves();
    snapshotDeal();
  }
  function newGame() {
    gameSettings.emptyColK = fcSettings.emptyColK;
    resetTimer();
    dealPiles();
    sel = null;
    hideModal($('fc-win-modal'));
    hideModal($('fc-restart-modal'));
    if (kdMode === 'host' && !fcSettings.allowSpec) Net.kickSpecs('房主已禁止观战');
    render();
    broadcastState();
  }
  function replayGame() {
    if (!initCols) return;
    gameSettings.emptyColK = fcSettings.emptyColK;
    resetTimer();
    cols = initCols.map(function (c) { return c.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; }); });
    stock = initStock.map(function (x) { return { suit: x.suit, rank: x.rank, up: x.up }; });
    waste = [];
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
    div.className = 'fc-card kd-card' + (extraClass ? ' ' + extraClass : '') + (card.up ? '' : ' face-down');
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
    /* 牌堆：显示为一张未翻开的牌；空时显示无背景边框 + 居中图标 */
    stockEl.innerHTML = '';
    var icon = document.createElement('img');
    icon.id = 'kd-stock-icon';
    icon.className = 'kd-stock-icon';
    icon.src = 'texture/blackcastling.png';
    icon.alt = '';
    stockEl.appendChild(icon);
    if (stock.length) stockEl.appendChild(cardEl(stock[0], '', 'stock:0'));
    stockEl.classList.toggle('empty', !stock.length);
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
    /* 翻牌区：显示最近一次翻出的（最多三张，错开；最右可点） */
    wasteEl.innerHTML = '';
    var wStart = Math.max(0, waste.length - 3);
    for (var wi = wStart; wi < waste.length; wi++) {
      wasteEl.appendChild(cardEl(waste[wi], isSelCard('waste', 0, wi) ? 'sel' : '', 'waste:0:' + wi));
    }
  }

  function renderCols() {
    tableEl.innerHTML = '';
    for (var c = 0; c < 7; c++) {
      var col = document.createElement('div');
      col.className = 'fc-col';
      col.dataset.col = c;
      cols[c].forEach(function (card, idx) {
        var isSel = sel && sel.type === 'col' && sel.a === c && idx >= sel.b;
        var el = cardEl(card, isSel ? 'sel' : '', 'col:' + c + ':' + idx);
        el.dataset.idx = idx;
        col.appendChild(el);
      });
      tableEl.appendChild(col);
    }
    fitColumns();
  }

  function fitColumns() {
    var avail = tableEl.clientHeight;
    if (!avail) return;
    for (var c = 0; c < 7; c++) {
      var col = tableEl.children[c];
      if (!col) continue;
      var len = cols[c].length;
      if (len <= 1) { col.style.removeProperty('--fc-step'); continue; }
      var card = col.querySelector('.fc-card');
      if (!card) { col.style.removeProperty('--fc-step'); continue; }
      var cardH = card.getBoundingClientRect().height;
      if (!cardH) continue;
      var defStep = cardH * 0.3 / 1.54385;
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
    if (sel.type === 'waste') return waste.length ? [waste[waste.length - 1]] : null;
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
    if (!canPlaceOnCol(cards, colIdx)) return false;
    var srcDesc = { type: sel.type, a: sel.a, b: sel.b };
    var dstDesc = { type: 'col', a: colIdx };
    if (sel.type === 'col') {
      cols[colIdx].push.apply(cols[colIdx], cols[sel.a].splice(sel.b));
      flipTop(sel.a);
    } else if (sel.type === 'waste') {
      cols[colIdx].push(waste.pop());
    } else {
      cols[colIdx].push(fnds[sel.a].pop());
    }
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
      flipTop(sel.a);
    } else if (sel.type === 'waste') {
      waste.pop();
    } else {
      fnds[sel.a].pop();
    }
    fnds[pileIdx].push(cards[0]);
    broadcastMove(srcDesc, dstDesc);
    sel = null;
    render();
    checkWin();
    return true;
  }

  /* 牌堆：一次翻三张 / 收回（收回时翻回背面） */
  function drawStock() {
    if (stock.length) {
      var n = Math.min(3, stock.length);
      for (var i = 0; i < n; i++) {
        var card = stock.shift();
        card.up = true;
        waste.push(card);
      }
      broadcastMove({ type: 'stock', a: 0, b: 0 }, { type: 'waste', a: 0, b: 0 });
      render();
      return;
    }
    if (waste.length) {
      while (waste.length) {
        var wc = waste.pop();
        wc.up = false;
        stock.unshift(wc);
      }
      broadcastMove({ type: 'waste', a: 0, b: 0 }, { type: 'stock', a: 0, b: 0 });
      render();
    }
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
      if (!validRun(run)) { clearSel(); return; }   /* 未翻开/不成序：不高亮 */
      sel = { type: 'col', a: colIdx, b: idx };
      render();
      return;
    }
    if (sel && !tryMoveSelToCol(colIdx)) clearSel();
  }

  function onWasteClick() {
    if (!waste.length) return;
    if (sel && sel.type === 'waste') { clearSel(); return; }
    sel = { type: 'waste', a: 0, b: waste.length - 1 };
    render();
  }
  function onFndClick(pileIdx) {
    if (sel) {
      if (sel.type === 'fnd' && sel.a === pileIdx) { clearSel(); return; }
      if (tryMoveSelToFnd(pileIdx)) return;
      if (fnds[pileIdx].length) {
        sel = { type: 'fnd', a: pileIdx, b: 0 };
        render();
      } else {
        clearSel();
      }
      return;
    }
    if (fnds[pileIdx].length) {
      sel = { type: 'fnd', a: pileIdx, b: 0 };
      render();
    }
  }

  /* 拖动（指针事件，鼠标/触摸通用） */
  var dragInfo = null;
  var dragSuppressClick = false;
  var lastTapTime = 0;
  var lastTapSrc = '';

  function parseSrc(s) {
    var parts = String(s || '').split(':');
    if (parts.length < 2) return null;
    return { type: parts[0], a: parseInt(parts[1], 10), b: parts.length > 2 ? parseInt(parts[2], 10) : 0 };
  }
  function srcCards(src) {
    if (src.type === 'col') return cols[src.a].slice(src.b);
    if (src.type === 'waste') return waste.length ? [waste[waste.length - 1]] : [];
    var pile = fnds[src.a];
    return pile.length ? [pile[pile.length - 1]] : [];
  }
  function srcMovable(src) {
    if (src.type === 'col') {
      var run = cols[src.a].slice(src.b);
      return run.length > 0 && validRun(run);
    }
    if (src.type === 'waste') return waste.length > 0 && src.b === waste.length - 1;   /* 只有最右可取 */
    if (src.type === 'stock') return false;   /* 牌堆本身不可拖，点击翻牌 */
    return fnds[src.a].length > 0;
  }

  function sourceRunRect(src) {
    if (src.type === 'col') {
      var colEl = tableEl.children[src.a];
      if (!colEl) return null;
      var els = colEl.querySelectorAll('.fc-card');
      if (!els[src.b]) return null;
      return els[src.b].getBoundingClientRect();
    }
    if (src.type === 'waste') {
      var wc = wasteEl.children[wasteEl.children.length - 1];   /* 渲染的为最右 3 张，取最后一张 */
      return wc ? wc.getBoundingClientRect() : null;
    }
    var el = fndEl.children[src.a];
    if (!el) return null;
    var c = el.querySelector('.fc-card');
    return c ? c.getBoundingClientRect() : null;
  }

  function markSrcSel(src) {
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
    if (src.type === 'waste') {
      var wc = wasteEl.children[wasteEl.children.length - 1];
      if (wc) {
        wc.classList.add('sel');
        wc.classList.add('fc-drag-hidden');
      }
      return;
    }
    var el = fndEl.children[src.a];
    if (!el) return;
    var c = el.querySelector('.fc-card');
    if (c) {
      c.classList.add('sel');
      c.classList.add('fc-drag-hidden');
      if (el.children.length <= 1) {
        var ph = (fnds[src.a].length > 1) ? cardEl(fnds[src.a][fnds[src.a].length - 2], '', 'fnd:' + src.a) : emptyCellEl();
        el.insertBefore(ph, c);
      }
    }
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
    if (src.type !== 'col') wrap.style.setProperty('--fc-c', 'var(--fc-top-c)');
    else {
      var colEl = tableEl.children[src.a];
      if (colEl) {
        var s = getComputedStyle(colEl).getPropertyValue('--fc-step');
        if (s) wrap.style.setProperty('--fc-step', s);
      }
    }
    cards.forEach(function (card) {
      wrap.appendChild(cardEl(card, '', ''));
    });
    page.appendChild(wrap);
    wrap.style.left = (srcRect.left - pageRect.left) + 'px';
    wrap.style.top = (srcRect.top - pageRect.top) + 'px';
    return { wrap: wrap, pageRect: pageRect, offX: clientX - srcRect.left, offY: clientY - srcRect.top };
  }
  function positionGhost(ev, ghost) {
    ghost.wrap.style.left = (ev.clientX - ghost.pageRect.left - ghost.offX) + 'px';
    ghost.wrap.style.top = (ev.clientY - ghost.pageRect.top - ghost.offY) + 'px';
  }
  function removeGhost(ghost) {
    if (ghost && ghost.wrap && ghost.wrap.parentNode) ghost.wrap.parentNode.removeChild(ghost.wrap);
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
  function nearestTarget(x, y) {
    var card = tableEl.querySelector('.fc-card');
    var snap = card ? card.getBoundingClientRect().width * 0.7 : 60;
    var candidates = [];
    for (var c = 0; c < 7; c++) candidates.push({ type: 'col', el: tableEl.children[c] });
    for (var p = 0; p < 4; p++) candidates.push({ type: 'fnd', el: fndEl.children[p] });
    candidates.push({ type: 'waste', el: wasteEl });
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

  function setSelFromSrc(src) {
    if (src.type === 'col') {
      var run = cols[src.a].slice(src.b);
      if (run.length && validRun(run)) sel = { type: 'col', a: src.a, b: src.b };
    } else if (src.type === 'waste') {
      if (waste.length) sel = { type: 'waste', a: 0, b: waste.length - 1 };
    } else {
      if (fnds[src.a].length) sel = { type: 'fnd', a: src.a, b: 0 };
    }
  }

  function dropAt(src, clientX, clientY, ghost) {
    setSelFromSrc(src);
    if (!sel) { removeGhost(ghost); clearSel(); return; }
    var target = document.elementFromPoint(clientX, clientY);
    var colEl = target && target.closest ? target.closest('.fc-col') : null;
    var fndTarget = target && target.closest ? target.closest('.fc-foundation') : null;
    if (!colEl && !fndTarget) {
      var near = nearestTarget(clientX, clientY);
      if (near) {
        if (near.type === 'col') colEl = near.el;
        else if (near.type === 'fnd') fndTarget = near.el;
      }
    }
    var moved = false;
    if (colEl) {
      var colIdx = parseInt(colEl.dataset.col, 10);
      if (sel.type === 'col' && sel.a === colIdx) sel = null;
      else moved = tryMoveSelToCol(colIdx);
    } else if (fndTarget) {
      var pileIdx = parseInt(fndTarget.dataset.pile, 10);
      if (sel.type === 'fnd' && sel.a === pileIdx) sel = null;
      else moved = tryMoveSelToFnd(pileIdx);
    } else {
      sel = null;
    }
    if (moved) removeGhost(ghost);
    else bounceBack(src, ghost);
  }

  document.addEventListener('pointerdown', function (ev) {
    if (isSpec) return;
    var cardEl = ev.target.closest ? ev.target.closest('.fc-card') : null;
    if (!cardEl || !cardEl.dataset.src) return;
    var src = parseSrc(cardEl.dataset.src);
    if (!src) return;
    if (!srcMovable(src)) return;
    dragInfo = { cardEl: cardEl, src: src, startX: ev.clientX, startY: ev.clientY, active: false, ghost: null };
    try { cardEl.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  document.addEventListener('pointermove', function (ev) {
    if (!dragInfo) return;
    if (!dragInfo.active) {
      if (Math.abs(ev.clientX - dragInfo.startX) + Math.abs(ev.clientY - dragInfo.startY) < 10) return;
      ev.preventDefault();
      dragInfo.active = true;
      dragInfo.ghost = createGhost(dragInfo.src, dragInfo.startX, dragInfo.startY);
      if (dragInfo.ghost) positionGhost(ev, dragInfo.ghost);
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
    render();
  });

  tableEl.addEventListener('click', function (ev) {
    if (isSpec) return;
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var colEl = ev.target.closest ? ev.target.closest('.fc-col') : null;
    if (!colEl) { clearSel(); return; }
    onColClick(parseInt(colEl.dataset.col, 10), ev);
  });
  wasteEl.addEventListener('click', function (ev) {
    if (isSpec) return;
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    if (!ev.target.closest('.fc-card')) return;
    onWasteClick();
  });
  fndEl.addEventListener('click', function (ev) {
    if (isSpec) return;
    if (dragSuppressClick) { dragSuppressClick = false; setTimeout(function () { dragSuppressClick = false; }, 0); return; }
    var cell = ev.target.closest ? ev.target.closest('.fc-foundation') : null;
    if (!cell) return;
    onFndClick(parseInt(cell.dataset.pile, 10));
  });
  stockEl.addEventListener('click', function (ev) {
    if (isSpec) return;
    drawStock();
  });

  /* 双击/双点：自动把所有可放入置牌位的牌全部置入（列顶翻开 + 翻牌区最右） */
  function autoPlaceAll() {
    if (!fcSettings.dblCascade) return false;
    var changed = false;
    var again = true;
    while (again) {
      again = false;
      if (waste.length) {
        var wcard = waste[waste.length - 1];
        var p = -1;
        for (var i = 0; i < 4; i++) { if (canPlaceOnFnd(wcard, i)) { p = i; break; } }
        if (p >= 0) {
          waste.pop();
          fnds[p].push(wcard);
          broadcastMove({ type: 'waste', a: 0, b: 0 }, { type: 'fnd', a: p });
          changed = true;
          again = true;
        }
      }
      for (var c = 0; c < 7; c++) {
        var col = cols[c];
        var top = col[col.length - 1];
        if (!top || !top.up) continue;
        var p2 = -1;
        for (var j = 0; j < 4; j++) { if (canPlaceOnFnd(top, j)) { p2 = j; break; } }
        if (p2 >= 0) {
          col.pop();
          fnds[p2].push(top);
          flipTop(c);
          broadcastMove({ type: 'col', a: c, b: col.length }, { type: 'fnd', a: p2 });
          changed = true;
          again = true;
        }
      }
    }
    if (changed) {
      render();
      checkWin();
    }
    return changed;
  }

  function handleDoubleTap(cardEl) {
    return autoPlaceAll();
  }
  function onDblClickCard(ev) {
    if (isSpec) return;
    if (dragSuppressClick) { dragSuppressClick = false; return; }
    if (handleDoubleTap(null)) {
      dragSuppressClick = true;
      setTimeout(function () { dragSuppressClick = false; }, 50);
    }
  }
  tableEl.addEventListener('dblclick', onDblClickCard);
  fndEl.addEventListener('dblclick', onDblClickCard);

  /* ---------- 通关 ---------- */
  function checkWin() {
    var done = 0;
    for (var i = 0; i < 4; i++) if (fnds[i].length === 13) done++;
    if (done === 4) showModal($('fc-win-modal'));
  }

  /* ---------- 计时 ---------- */
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

  function applyUiSettings() {
    var page = document.querySelector('.fc-page');
    if (!page) return;
    page.classList.toggle('fc-solid-cards', !fcSettings.transparent);
    page.classList.toggle('fc-suit-border', fcSettings.suitBorder && !fcSettings.twoColor);
    page.classList.toggle('fc-two-color-border', fcSettings.suitBorder && fcSettings.twoColor);
    document.documentElement.style.setProperty('--fc-win-scale', fcSettings.winScale);
    /* 计时不在设置面板即时生效，统一由新局/重玩时应用 */
    var mmEl = $('kd-min-moves');
    if (mmEl) mmEl.classList.toggle('hidden', !fcSettings.showMinMoves);
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
      ['opt-empty-col-k', 'emptyColK'], ['opt-allow-spec', 'allowSpec'], ['opt-open', 'open'],
      ['opt-timer', 'timer'], ['opt-show-min-moves', 'showMinMoves'], ['opt-dbl-cascade', 'dblCascade'], ['opt-transparent', 'transparent'],
      ['opt-suit-border', 'suitBorder'], ['opt-two-color', 'twoColor']
    ];
    map.forEach(function (pair) { setToggle($(pair[0]), fcSettings[pair[1]]); });
    if (winScaleSlider) winScaleSlider.value = Math.round(fcSettings.winScale * 100);
    if (winScaleLabel) winScaleLabel.textContent = Math.round(fcSettings.winScale * 100) + '%';
    syncOpenLock();
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
    settingsBackup = JSON.parse(JSON.stringify(fcSettings));
    syncSettingsUI();
    showModal($('fc-settings-modal'));
    styleFcSlider();
    requestAnimationFrame(styleFcSlider);
    updateFcSettingsScrollbar();
  }
  function applySettings() {
    if (!fcSettings.allowSpec) fcSettings.open = false;
    saveSettings();
    settingsBackup = null;
    hideModal($('fc-settings-modal'));
    syncOpenRoom();
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
    var defaults = { emptyColK: true, allowSpec: false, open: false, timer: true, winScale: 1, dblCascade: true, transparent: true, suitBorder: false, twoColor: false, showMinMoves: true };
    for (var k in fcSettings) fcSettings[k] = defaults[k];
    applyUiSettings();
    syncSettingsUI();
    toast('已恢复默认设置');
  }

  [
    ['opt-empty-col-k', 'emptyColK', false], ['opt-allow-spec', 'allowSpec', false], ['opt-open', 'open', false],
    ['opt-timer', 'timer', false], ['opt-show-min-moves', 'showMinMoves', true], ['opt-dbl-cascade', 'dblCascade', true], ['opt-transparent', 'transparent', true],
    ['opt-suit-border', 'suitBorder', true], ['opt-two-color', 'twoColor', true]
  ].forEach(function (pair) {
    var el = $(pair[0]);
    if (!el) return;
    el.addEventListener('click', function () {
      if (pair[0] === 'opt-open' && (!fcSettings.allowSpec || isSpec)) return;
      fcSettings[pair[1]] = !toggleIsOn(el);
      setToggle(el, fcSettings[pair[1]]);
      if (pair[0] === 'opt-allow-spec') syncOpenLock();
      if (pair[2]) applyUiSettings();
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

  var viewCodeBtn = $('btn-fc-view-code');
  if (viewCodeBtn) {
    if (kdMode !== 'host') viewCodeBtn.classList.add('hidden');
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
    var link = new URL('klondike.html', location.href);
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


