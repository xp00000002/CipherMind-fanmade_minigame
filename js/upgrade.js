/* upgrade.js - 联机游戏「升级/拖拉机」（房主权威，4/6/8 人，队伍按座位 1/5、2/6、3/7、4/8） */
(function () {
  'use strict';

  /* ---------- 参数 / 个人资料 ---------- */
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode');                 // host | join
  var joinId = params.get('id');
  var isHost = mode === 'host';
  var myName = (Profile.get() || {}).name || 'Player';
  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
    { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' }
  ];

  /* ---------- 牌面资源 ---------- */
  var SUIT_IMG = { s: 'texture-card/Card-Spade.png', h: 'texture-card/Card-Heart.png', c: 'texture-card/Card-Club.png', d: 'texture-card/Card-Diamond.png' };
  var SUIT_IMG_TC = { s: 'texture-card/Card-Spade-Black.png', h: 'texture-card/Card-Heart-Red.png', c: 'texture-card/Card-Club-Black.png', d: 'texture-card/Card-Diamond-Red.png' };
  var RANK_IMG = {
    2: 'texture-card/Card-2.png', 3: 'texture-card/Card-3.png', 4: 'texture-card/Card-4.png', 5: 'texture-card/Card-5.png',
    6: 'texture-card/Card-6.png', 7: 'texture-card/Card-7.png', 8: 'texture-card/Card-8.png', 9: 'texture-card/Card-9.png',
    10: 'texture-card/Card-10.png', 11: 'texture-card/Card-J.png', 12: 'texture-card/Card-Q.png',
    13: 'texture-card/Card-K.png', 14: 'texture-card/Card-A.png'
  };
  var JOKER_IMG = { 16: 'texture-card/Card-BlackJoker.png', 17: 'texture-card/Card-RedJoker.png' };
  var SUIT_ZH = { s: '黑桃', h: '红桃', c: '梅花', d: '方块', j: '王' };
  var PIECE_IMG = {
    w: { p: 'texture/pawn2.png', n: 'texture/knight2.png', b: 'texture/bishop2.png', r: 'texture/rook2.png', q: 'texture/queen2.png', k: 'texture/king2.png' },
    b: { p: 'texture/pawn.png', n: 'texture/knight.png', b: 'texture/bishop.png', r: 'texture/rook.png', q: 'texture/queen.png', k: 'texture/king.png' }
  };
  var RANK_ZH = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function rankText(r) { return r <= 10 ? String(r) : (RANK_ZH[r] || String(r)); }

  /* ---------- 座位 / 队伍 ---------- */
  var SEAT_LAYOUT = { 4: [1, 3, 5, 7], 6: [1, 2, 4, 5, 6, 8], 8: [1, 2, 3, 4, 5, 6, 7, 8] };
  function teamOf(seat) { return (seat - 1) % 4; }
  function seatList(n) { return SEAT_LAYOUT[n] || SEAT_LAYOUT[8]; }
  function nextSeat(seat, seats) {
    var i = seats.indexOf(seat);
    if (i < 0) return seats[0];
    return seats[(i + 1) % seats.length];
  }

  /* ---------- 界面元素 ---------- */
  function $(id) { return document.getElementById(id); }
  var tableEl = $('up-table');
  var tipEl = $('up-tip');
  var bottomEl = $('up-bottom');
  var centerEl = $('up-center');
  var handEl = $('up-hand');
  var playerPanelEl = $('up-player-panel');
  var statusEl = $('up-status');
  var statusSubEl = $('up-status-sub');
  var trumpEl = $('up-trump');
  var declareBar = $('up-declare-bar');

  function showModal(el) { el.classList.remove('hidden'); Profile.adjustBtnHitAreas(); }
  function hideModal(el) { el.classList.add('hidden'); }

  var toastTimer = null;
  function toast(msg) {
    var layer = $('chat-layer');
    if (!layer) return;
    var el = document.createElement('div');
    el.className = 'chat-msg show';
    var t = document.createElement('span');
    t.className = 'chat-text';
    t.textContent = msg;
    var bar = document.createElement('div');
    bar.className = 'chat-bar';
    el.appendChild(t);
    el.appendChild(bar);
    layer.appendChild(el);
    setTimeout(function () {
      el.classList.add('fade');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, 8000);
  }
  function showPrompt(title, text, withHome) {
    $('up-prompt-title').textContent = title || '提示';
    $('up-prompt-text').textContent = text || '';
    $('btn-up-prompt-home').classList.toggle('hidden', !withHome);
    showModal($('up-prompt-modal'));
  }
  $('btn-up-prompt-ok').addEventListener('click', function () { hideModal($('up-prompt-modal')); });
  $('btn-up-prompt-home').addEventListener('click', function () { location.href = 'index.html'; });

  /* ---------- 本地界面设置 ---------- */
  var uiSettings = { tableScale: 1, handScale: 1, panelScale: 1, transparent: true, suitBorder: false, twoColor: false };
  try {
    var su = JSON.parse(localStorage.getItem('upSettings'));
    if (su) for (var sk in uiSettings) if (su[sk] !== undefined) uiSettings[sk] = su[sk];
  } catch (e) {}
  function saveUiSettings() { try { localStorage.setItem('upSettings', JSON.stringify(uiSettings)); } catch (e) {} }
  function applyUiSettings() {
    var layout = document.querySelector('.game-layout');
    if (!layout) return;
    layout.classList.toggle('fc-solid-cards', !uiSettings.transparent);
    layout.classList.toggle('fc-suit-border', uiSettings.suitBorder && !uiSettings.twoColor);
    layout.classList.toggle('fc-two-color-border', uiSettings.suitBorder && uiSettings.twoColor);
    applyTableLayout();
    renderGame();
  }
  function suitImg(suit) { return (uiSettings.twoColor ? SUIT_IMG_TC : SUIT_IMG)[suit]; }

  /* ---------- 规则工具 ---------- */
  var jokerCnt = 0;
  function newDeck(decks) {
    var out = [];
    for (var d = 0; d < decks; d++) {
      ['s', 'h', 'c', 'd'].forEach(function (s) {
        for (var r = 2; r <= 14; r++) out.push({ s: s, r: r, id: s + '-' + r + '-' + d + '-' + (out.length) });
      });
      out.push({ s: 'j', r: 16, id: 'j-16-' + d });   /* 小王 */
      out.push({ s: 'j', r: 17, id: 'j-17-' + d });   /* 大王 */
    }
    return out;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function isTrump(c) {
    if (!game) return false;
    if (c.s === 'j') return true;
    if (c.r === game.levelRank) return true;
    return c.s === game.trumpSuit;
  }
  function orderVal(c) {
    if (!game) return c.r;
    if (c.s === 'j') return c.r === 17 ? 100 : 99;
    if (c.r === game.levelRank) return c.s === game.trumpSuit ? 98 : 97;
    return c.r;
  }
  function cardPoints(c) {
    if (c.r === 5) return 5;
    if (c.r === 10 || c.r === 13) return 10;
    return 0;
  }
  function cardsPoints(cards) { var n = 0; (cards || []).forEach(function (c) { n += cardPoints(c); }); return n; }
  function sameCard(a, b) { return a.s === b.s && a.r === b.r; }
  function groupByRank(cards) {
    var map = {};
    cards.forEach(function (c) {
      var k = c.s + '-' + c.r;
      (map[k] = map[k] || []).push(c);
    });
    return map;
  }
  function sortHand(cards) {
    cards.sort(function (a, b) {
      var ta = isTrump(a) ? 0 : 1, tb = isTrump(b) ? 0 : 1;
      if (ta !== tb) return ta - tb;                 /* 主牌在前 */
      if (ta === 0) {
        var d = orderVal(b) - orderVal(a);           /* 主牌按牌力降序：大王>小王>主级牌>副级牌>主花色A… */
        if (d) return d;
      }
      if (a.s !== b.s) {
        var ia = 'shcd'.indexOf(a.s), ib = 'shcd'.indexOf(b.s);
        if (ia !== ib) return ia - ib;               /* 同牌力按花色分组 */
      }
      return b.r - a.r;
    });
    return cards;
  }
  /* 分析一手牌的牌型（必须同花色或全主牌） */
  function analyzePlay(lead, cards) {
    lead = lead || '';
    if (!cards || !cards.length) return null;
    var allTrump = cards.every(isTrump);
    var suits = {};
    cards.forEach(function (c) { suits[c.s] = true; });
    if (!allTrump && Object.keys(suits).length > 1) return null;
    var suit = allTrump ? 'T' : cards[0].s;
    var byRank = {};
    cards.forEach(function (c) { var k = c.s + '-' + c.r; (byRank[k] = byRank[k] || []).push(c); });
    var pairs = [], singles = [];
    Object.keys(byRank).forEach(function (k) {
      var arr = byRank[k];
      if (arr.length >= 2) {
        pairs.push({ r: arr[0].r, s: arr[0].s, val: orderVal(arr[0]) });
        for (var i = 2; i < arr.length; i++) singles.push(arr[i]);
      } else {
        arr.forEach(function (c) { singles.push(c); });
      }
    });
    if (cards.length === 1) return { kind: 'single', suit: suit, comps: [{ type: 'single', len: 1, val: orderVal(cards[0]) }], key: [orderVal(cards[0])] };
    if (cards.length === 2 && pairs.length === 1) return { kind: 'pair', suit: suit, comps: [{ type: 'pair', len: 2, val: orderVal(cards[0]) }], key: [orderVal(cards[0])] };
    /* 拖拉机：连续对子（不含级牌/王） */
    if (pairs.length >= 2 && singles.length === 0) {
      var noLevel = pairs.every(function (p) { return p.r !== game.levelRank && p.s !== 'j'; });
      pairs.sort(function (a, b) { return a.r - b.r; });
      var ok = noLevel;
      for (var i = 1; i < pairs.length; i++) if (pairs[i].r !== pairs[i - 1].r + 1) { ok = false; break; }
      if (ok && pairs[0].s === pairs[pairs.length - 1].s) {
        var top = orderVal(pairs[pairs.length - 1]);
        return { kind: 'tractor', suit: suit, comps: [{ type: 'tractor', len: pairs.length * 2, val: top }], key: [top], pairCount: pairs.length };
      }
    }
    /* 甩牌：其余组合（同花色/全主牌），按“对子+单张”拆分为多个组件 */
    var comps = [];
    pairs.sort(function (a, b) { return orderVal({ s: a.s, r: a.r }) - orderVal({ s: b.s, r: b.r }); });
    pairs.forEach(function (p) { comps.push({ type: 'pair', len: 2, val: orderVal({ s: p.s, r: p.r }) }); });
    singles.forEach(function (c) { comps.push({ type: 'single', len: 1, val: orderVal(c) }); });
    if (!comps.length) return null;
    comps.sort(function (a, b) { return b.val - a.val; });
    return { kind: 'throw', suit: suit, comps: comps, key: comps.map(function (x) { return x.val; }), pairCount: pairs.length, singleCount: singles.length };
  }
  function cmpKey(a, b) {   /* a 大返回 >0 */
    for (var i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  }

  /* ---------- 网络 ---------- */
  var peer = null, conns = [], myConn = null, myId = null, rejected = false, aborted = false;
  var avatars = {};   /* player id -> {name, avatar, avatarData}（联机交换的头像） */
  var players = [];   /* {id,name,ready,host,seat} */
  var settings = { count: 4 };
  var settingsBackup = null;
  var openState = false;
  var lobbyState = null;   /* 非房主：最新 lobby 数据 */
  var game = null;
  var session = null;
  var mySeat = 0;
  var sel = {};            /* 手牌选中：card id -> true */
  var lastResult = null;

  function connId(c) { return c ? c.peer : ''; }
  function sendAll(data) { conns.forEach(function (c) { try { if (c.open) c.send(data); } catch (e) {} }); }
  function sendMy(data) { if (!isHost && myConn && myConn.open) myConn.send(data); }
  function findPlayer(id) { for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i]; return null; }
  function gameFor(id) {
    var g = JSON.parse(JSON.stringify(game));
    var seat = 0;
    for (var s in g.seatIds) if (g.seatIds[s] === id) seat = parseInt(s, 10);
    g.mySeat = seat;
    g.hands = {};
    g.hands[seat] = game.hands[seat] ? JSON.parse(JSON.stringify(game.hands[seat])) : [];
    g.bottom = [];
    g.discards = {};
    return g;
  }
  function sendAllState() {
    if (!isHost || !game) return;
    conns.forEach(function (c) { try { if (c.open) c.send({ t: 'state', game: gameFor(connId(c)), settings: settings, session: session }); } catch (e) {} });
    renderGame();
  }

  function handleHostMessage(c, data) {
    if (!data || !data.t) return;
    if (data.t === 'join') {
      if (game) { c.send({ t: 'reject', reason: '游戏已开始' }); try { c.close(); } catch (e) {} return; }
      if (players.length >= settings.count) { c.send({ t: 'reject', reason: '房间已满' }); try { c.close(); } catch (e) {} return; }
      var nm = String(data.name || '').trim() || 'Player';
      var used = {}; players.forEach(function (p) { used[p.name] = true; });
      if (used[nm]) { var n = 2; while (used[nm + ' #' + n]) n++; nm = nm + ' #' + n; }
      players.push({ id: connId(c), name: nm, ready: false, host: false, seat: 0 });
      c.send({ t: 'profiles', avatars: avatars });
      hostBroadcastLobby();
      return;
    }
    if (data.t === 'ready') {
      var p = findPlayer(connId(c));
      if (p) { p.ready = !!data.v; hostBroadcastLobby(); }
      return;
    }
    if (data.t === 'profile') {
      avatars[connId(c)] = { name: data.name || '', avatar: data.avatar, avatarData: data.avatarData };
      sendAll({ t: 'profile', id: connId(c), name: data.name || '', avatar: data.avatar, avatarData: data.avatarData });
      renderGame();
      return;
    }
    if (data.t === 'action') { handleGameAction(connId(c), data.a); return; }
    if (data.t === 'leave') { removePlayer(connId(c)); return; }
  }

  function removePlayer(id) {
    var p = findPlayer(id);
    if (!p) return;
    if (game && !session.over) {
      abortGame('有玩家离开，本局已结束');
      return;
    }
    players = players.filter(function (x) { return x.id !== id; });
    hostBroadcastLobby();
  }
  function abortGame(reason) {
    aborted = true;
    sendAll({ t: 'abort', reason: reason });
    try { peer.destroy(); } catch (e) {}
    showPrompt('连接已断开', reason || '对局无法继续');
  }

  function hostBroadcastLobby() {
    lobbyState = { players: players.slice(), settings: settings, open: openState };
    sendAll({ t: 'lobby', players: players, settings: settings, open: openState });
    renderLobby();
  }

  function initHost() {
    peer = new Peer({ config: { iceServers: ICE_SERVERS } });
    peer.on('open', function (id) {
      myId = id;
      players = [{ id: 'host', name: myName, ready: false, host: true, seat: 0 }];
      var p0 = Profile.get() || {};
      avatars['host'] = { name: myName, avatar: p0.avatar, avatarData: p0.avatarData };
      if (openState && myId) registerOpenRoom(myId, false);
      hostBroadcastLobby();
    });
    peer.on('connection', function (c) {
      c.on('data', function (data) { handleHostMessage(c, data); });
      c.on('close', function () {
        players = players.filter(function (p) { return p.id !== connId(c); });
        conns = conns.filter(function (x) { return x !== c; });
        if (game && !session.over && !aborted) { abortGame('有玩家离开，本局已结束'); return; }
        hostBroadcastLobby();
      });
      conns.push(c);
      c.on('open', function () { c.send({ t: 'hello', id: connId(c) }); });
    });
    peer.on('disconnected', function () { if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} } });
    peer.on('error', function () {});
  }

  function initJoin() {
    var attempt = 0;
    function tryConnect() {
      attempt++;
      peer = new Peer({ config: { iceServers: ICE_SERVERS } });
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; try { peer.destroy(); } catch (e) {} retry(); }
      }, 8000);
      function retry() {
        if (attempt < 3) tryConnect();
        else showPrompt('连接失败', '无法连接到房主');
      }
      peer.on('open', function () {
        myId = peer.id;
        myConn = peer.connect(joinId, { reliable: true });
        myConn.on('open', function () {
          settled = true;
          clearTimeout(timer);
          myConn.send({ t: 'join', name: myName });
        });
        myConn.on('data', function (data) { handleJoinMessage(data); });
        myConn.on('close', function () {
          if (rejected) return;
          if (game && !session.over) showPrompt('连接已断开', '房主已离开或连接中断', true);
          else location.href = 'index.html';
        });
      });
      peer.on('error', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { peer.destroy(); } catch (e) {}
        retry();
      });
    }
    tryConnect();
  }

  function handleJoinMessage(data) {
    if (!data) return;
    if (data.t === 'hello') {
      myId = data.id;
      if (myConn && myConn.open) {
        var p = Profile.get() || {};
        myConn.send({ t: 'profile', name: myName, avatar: p.avatar, avatarData: p.avatarData });
      }
      return;
    }
    if (data.t === 'profiles') {
      var map = data.avatars || {};
      Object.keys(map).forEach(function (k) { avatars[k] = map[k]; });
      renderGame();
      renderLobby();
      return;
    }
    if (data.t === 'profile') {
      avatars[data.id] = { name: data.name || '', avatar: data.avatar, avatarData: data.avatarData };
      renderGame();
      renderLobby();
      return;
    }
    if (data.t === 'lobby') {
      players = data.players || [];
      if (data.settings) { settings = data.settings; }
      openState = !!data.open;
      var me = findPlayer(myConn && myConn.peer ? myConn.peer : myId);
      if (!me) me = findPlayer(myId);
      if (me) myName = me.name;
      hideModal($('up-create-modal'));
      if (!game) { renderLobby(); showModal($('up-wait-modal')); }
      return;
    }
    if (data.t === 'state') {
      game = data.game;
      if (data.settings) settings = data.settings;
      session = data.session;
      mySeat = (game && game.mySeat) || 0;
      document.body.classList.remove('up-pre-game');
      hideModal($('up-wait-modal'));
      hideModal($('up-create-modal'));
      if (game && game.phase === 'over') showResult();
      else hideModal($('up-result-modal'));
      renderGame();
      return;
    }
    if (data.t === 'abort') {
      rejected = true;
      showPrompt('连接已断开', data.reason || '对局无法继续', true);
      return;
    }
    if (data.t === 'reject') {
      rejected = true;
      showPrompt('加入失败', data.reason || '无法加入房间');
      return;
    }
  }

  /* ---------- 房间码 / 开放房间 ---------- */
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
  function openRoomSummary() {
    return '升级 | ' + settings.count + ' 人 | 主牌2';
  }
  function registerOpenRoom(id, started) {
    if (!id) return;
    var list = [];
    try {
      var raw = JSON.parse(localStorage.getItem('cmchessOpenRooms'));
      if (raw && Array.isArray(raw)) list = raw;
    } catch (e) {}
    var now = Date.now();
    list = list.filter(function (r) { return r && r.id !== id && now - (r.ts || 0) < 180000; });
    list.push({ id: id, hostName: myName, rules: openRoomSummary(), gameStarted: !!started, allowSpec: false, noChat: true, ts: now, game: 'upgrade' });
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
  $('up-open-btn').addEventListener('click', function () {
    if (!isHost) return;
    openState = !openState;
    this.textContent = openState ? '已开放' : '开放';
    if (openState && myId) registerOpenRoom(myId, !!(game && !session.over));
    else unregisterOpenRoom(myId);
    hostBroadcastLobby();
  });
  $('up-roomcode-btn').addEventListener('click', function () {
    var rid = isHost ? (myId || '') : (joinId || '');
    if (this.dataset.shown) { delete this.dataset.shown; this.textContent = '房间号码'; return; }
    copyText(rid, '已复制房间号码');
    this.textContent = rid;
    this.dataset.shown = '1';
  });
  $('up-copylink-btn').addEventListener('click', function () {
    var rid = isHost ? (myId || '') : (joinId || '');
    var link = new URL('upgrade.html', location.href);
    link.search = '?mode=join&id=' + encodeURIComponent(rid);
    copyText(link.href, '已复制邀请链接');
    var self = this;
    self.textContent = '已复制';
    setTimeout(function () { self.textContent = '复制邀请链接'; }, 5000);
  });

  /* ---------- 创建设置 ---------- */
  function syncCountUI() {
    $('up-count-label').textContent = settings.count + ' 人';
  }
  $('up-count-prev').addEventListener('click', function () { settings.count = settings.count === 4 ? 8 : (settings.count === 8 ? 6 : 4); syncCountUI(); });
  $('up-count-next').addEventListener('click', function () { settings.count = settings.count === 4 ? 6 : (settings.count === 6 ? 8 : 4); syncCountUI(); });
  function showCreate() {
    settingsBackup = JSON.parse(JSON.stringify(settings));
    hideModal($('up-wait-modal'));
    syncCountUI();
    showModal($('up-create-modal'));
  }
  $('btn-up-create-back').addEventListener('click', function () {
    if (settingsBackup) settings = JSON.parse(JSON.stringify(settingsBackup));
    hideModal($('up-create-modal'));
    showWait();
  });
  $('btn-up-create').addEventListener('click', function () {
    try { localStorage.setItem('upCreateSettings', JSON.stringify(settings)); } catch (e) {}
    hideModal($('up-create-modal'));
    renderLobby();
    showModal($('up-wait-modal'));
  });

  /* ---------- 等待界面 ---------- */
  function showWait() { renderLobby(); showModal($('up-wait-modal')); }
  function renderLobby() {
    var body = $('up-wait-body');
    body.innerHTML = '';
    $('up-open-btn').disabled = !isHost;
    $('up-open-btn').textContent = openState ? '已开放' : '开放';
    players.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'zjh-pcard' + ((p.host && isHost) || p.id === (isHost ? 'host' : myId) ? ' me' : '');
      var name = document.createElement('div');
      name.className = 'zjh-pname';
      name.textContent = p.name;
      card.appendChild(name);
      var icon = null;
      if (p.host) icon = 'texture/host.png';
      else if (p.ready) icon = 'texture/ready.png';
      if (icon) {
        var im = document.createElement('img');
        im.className = 'zjh-picon';
        im.src = icon;
        card.appendChild(im);
      }
      body.appendChild(card);
    });
    if (isHost) {
      $('btn-up-start').classList.remove('hidden');
      $('btn-up-ready').classList.add('hidden');
      $('btn-up-start').disabled = players.length < settings.count || !players.every(function (p) { return p.host || p.ready; });
    } else {
      $('btn-up-start').classList.add('hidden');
      var rd = $('btn-up-ready');
      rd.classList.remove('hidden');
      var me = findPlayer(myId);
      rd.textContent = (me && me.ready) ? '取消准备' : '准备';
    }
  }
  $('btn-up-wait-back').addEventListener('click', function () {
    unregisterOpenRoom(myId);
    try { if (peer) peer.destroy(); } catch (e) {}
    location.href = 'index.html';
  });
  $('btn-up-ready').addEventListener('click', function () {
    var me = findPlayer(myId);
    if (!me) return;
    me.ready = !me.ready;
    sendMy({ t: 'ready', v: me.ready });
    renderLobby();
  });
  $('btn-up-start').addEventListener('click', function () {
    if (!isHost) return;
    if (players.length !== settings.count) { toast('人数不足'); return; }
    if (!players.every(function (p) { return p.host || p.ready; })) { toast('有玩家未准备'); return; }
    startMatch();
  });

  /* ---------- 开始对局（房主） ---------- */
  function startMatch() {
    var seats = seatList(settings.count);
    players.forEach(function (p, i) { p.seat = seats[i] || 0; });
    session = { levels: [2, 2, 2, 2], round: 0, over: false, trumpSuit: null, nextDealerTeam: null };
    if (openState && myId) registerOpenRoom(myId, true);
    hideModal($('up-wait-modal'));
    dealRound(true);
  }
  function seatPlayer(seat) {
    if (game && game.seatIds && game.seatIds[seat]) {
      var known = playerOfId(game.seatIds[seat]);
      if (known) return known;
      return { id: game.seatIds[seat], name: (game.seatNames && game.seatNames[seat]) || 'Player', seat: seat };
    }
    for (var i = 0; i < players.length; i++) if (players[i].seat === seat) return players[i];
    return null;
  }
  function seatName(seat) {
    if (game && game.seatNames && game.seatNames[seat]) return game.seatNames[seat];
    var p = seatPlayer(seat);
    return p ? p.name : ('座位' + seat);
  }
  function playerOfId(id) { for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i]; return null; }

  function dealRound(first) {
    document.body.classList.remove('up-pre-game');
    hideModal($('up-create-modal'));
    var N = settings.count;
    var seats = seatList(N);
    var decks = N / 2;
    var deck = shuffle(newDeck(decks));
    var handSize = 25;
    var bottomSize = 54 * decks - N * handSize;   /* 4/6/8 人 -> 8/12/16 张底牌 */
    var hands = {}, counts = {};
    var idx = 0;
    seats.forEach(function (s) {
      hands[s] = sortHand(deck.slice(idx, idx + handSize));
      counts[s] = handSize;
      idx += handSize;
    });
    var bottom = deck.slice(idx, idx + bottomSize);
    var dealerSeat = (game && game.nextDealerSeat) ? game.nextDealerSeat : 0;
    var dealerTeam = dealerSeat ? teamOf(dealerSeat) : session.nextDealerTeam;
    var levelRank = dealerTeam !== null && dealerTeam !== undefined ? session.levels[dealerTeam] : 2;
    var seatIds = {}, seatNames = {};
    players.forEach(function (p) { if (p.seat) { seatIds[p.seat] = p.id; seatNames[p.seat] = p.name; } });
    game = {
      phase: first ? 'declare' : 'discard',
      round: session.round + 1,
      seatCount: N,
      seats: seats,
      seatIds: seatIds,
      seatNames: seatNames,
      dealerSeat: dealerSeat || 0,
      dealerTeam: (dealerTeam === null || dealerTeam === undefined) ? -1 : dealerTeam,
      levelRank: first ? 2 : levelRank,
      trumpSuit: first ? null : session.trumpSuit,
      hands: hands,
      counts: counts,
      bottom: bottom,
      bottomCount: bottom.length,
      bottomDealer: Math.min(8, bottomSize),
      bottomMate: Math.max(0, bottomSize - 8),
      discards: {},
      pendingDiscards: {},
      roundPoints: [0, 0, 0, 0],
      declare: first ? { deadline: Date.now() + 10000, declarerSeat: 0, suit: null, cards: [], counterDeadline: 0, counterAllowed: false } : null,
      trick: null,
      finished: {},
      lastTrick: null,
      result: null
    };
    mySeat = 0;
    players.forEach(function (p) { if (p.seat && ((isHost && p.host) || p.id === myId)) mySeat = p.seat; });
    if (isHost && !mySeat) { var hp = players.filter(function (p) { return p.host; })[0]; if (hp) mySeat = hp.seat; }
    if (!first) {
      assignBottom();
    } else {
      sel = {};
      hostBroadcastLobby();
      sendAllState();
      if (declareTimer) clearTimeout(declareTimer);
      declareTimer = setTimeout(function () { concludeDeclare(); }, 10000);
    }
  }

  var declareTimer = null, counterTimer = null, trickTimer = null;
  function clearDeclareTimers() {
    if (declareTimer) { clearTimeout(declareTimer); declareTimer = null; }
    if (counterTimer) { clearTimeout(counterTimer); counterTimer = null; }
  }
  function concludeDeclare() {
    if (!game || game.phase !== 'declare') return;
    clearDeclareTimers();
    if (!game.declare.declarerSeat) {
      toast('无人亮主，重新发牌');
      dealRound(true);
      return;
    }
    game.dealerSeat = game.declare.declarerSeat;
    game.dealerTeam = teamOf(game.dealerSeat);
    game.levelRank = 2;
    game.trumpSuit = game.declare.suit;
    session.trumpSuit = game.declare.suit;
    session.levels[game.dealerTeam] = 2;
    assignBottom();
  }
  function assignBottom() {
    var d = game.dealerSeat;
    var mate = mateSeat(d);
    var bottom = game.bottom.slice();
    var dealerCards = bottom.slice(0, game.bottomDealer);
    var mateCards = bottom.slice(game.bottomDealer);
    game.hands[d] = sortHand(game.hands[d].concat(dealerCards));
    game.counts[d] = game.hands[d].length;
    game.pendingDiscards = {};
    game.pendingDiscards[d] = 8;
    if (game.bottomMate > 0 && mate) {
      game.hands[mate] = sortHand(game.hands[mate].concat(mateCards));
      game.counts[mate] = game.hands[mate].length;
      game.pendingDiscards[mate] = game.bottomMate;
    }
    game.phase = 'discard';
    sel = {};
    sendAllState();
  }
  function mateSeat(seat) {
    var t = teamOf(seat);
    var seats = game.seats;
    for (var i = 0; i < seats.length; i++) if (seats[i] !== seat && teamOf(seats[i]) === t) return seats[i];
    return 0;
  }

  /* ---------- 出牌动作 ---------- */
  function handleGameAction(id, a) {
    if (!isHost || !game || !a) return;
    var p = playerOfId(id);
    if (!p || !p.seat) return;
    var seat = p.seat;
    if (game.phase === 'declare') {
      if (a.a === 'declare') doDeclare(seat, a);
      return;
    }
    if (game.phase === 'discard') {
      if (a.a === 'discard') doDiscard(seat, a.cards || []);
      return;
    }
    if (game.phase === 'playing') {
      if (game.trick && game.trick.plays && game.trick.plays[seat]) return;
      var turn = currentTurn();
      if (seat !== turn) return;
      if (a.a === 'play') doPlay(seat, a.cards || []);
      return;
    }
  }
  function handHas(seat, cards) {
    var hand = game.hands[seat] || [];
    var pool = hand.slice();
    for (var i = 0; i < cards.length; i++) {
      var found = -1;
      for (var j = 0; j < pool.length; j++) if (sameCard(pool[j], cards[i])) { found = j; break; }
      if (found < 0) return false;
      pool.splice(found, 1);
    }
    return true;
  }
  function removeCards(seat, cards) {
    var hand = game.hands[seat] || [];
    cards.forEach(function (c) {
      for (var i = 0; i < hand.length; i++) if (sameCard(hand[i], c)) { hand.splice(i, 1); break; }
    });
    game.counts[seat] = hand.length;
    if (!hand.length) game.finished[seat] = true;
  }

  function doDeclare(seat, a) {
    var d = game.declare;
    if (!d || Date.now() > d.deadline) return;
    if (!handHas(seat, a.cards || [])) return;
    var cards = a.cards || [];
    if (!(cards.length === 1 || cards.length === 2)) return;
    if (cards[0].s === 'j' || cards[0].r !== 2) return;
    if (cards.length === 2 && !(cards[0].r === cards[1].r && cards[0].s === cards[1].s)) return;
    var msgTime = typeof a.time === 'number' ? a.time : Date.now();
    if (!d.declarerSeat) {
      d.declarerSeat = seat;
      d.suit = cards[0].s;
      d.cards = cards;
      d.declareTime = msgTime;
      d.counterDeadline = Date.now() + 5000;
      d.counterAllowed = cards.length === 1;
      clearDeclareTimers();
      if (d.counterAllowed) counterTimer = setTimeout(function () { concludeDeclare(); }, 5000);
      else concludeDeclare();
      sendAllState();
      return;
    }
    /* 同一窗口内的单张冲突：以点击时间较早者为准 */
    if (d.counterAllowed && cards.length === 1) {
      if (d.declareTime && msgTime < d.declareTime - 100) {
        d.declarerSeat = seat;
        d.suit = cards[0].s;
        d.cards = cards;
        d.declareTime = msgTime;
        d.counterDeadline = Date.now() + 5000;
        clearDeclareTimers();
        counterTimer = setTimeout(function () { concludeDeclare(); }, 5000);
        sendAllState();
      }
      return;
    }
    /* 反主：同花对管住单张（不能反自己） */
    if (d.counterAllowed && cards.length === 2 && cards[0].s !== d.suit && seat !== d.declarerSeat) {
      d.declarerSeat = seat;
      d.suit = cards[0].s;
      d.cards = cards;
      d.counterAllowed = false;
      d.counterDeadline = 0;
      clearDeclareTimers();
      sendAllState();
      concludeDeclare();
    }
  }

  function doDiscard(seat, cards) {
    if (game.phase !== 'discard') return;
    var need = game.pendingDiscards[seat];
    if (!need || cards.length !== need) return;
    if (!handHas(seat, cards)) return;
    removeCards(seat, cards);
    game.discards[seat] = (game.discards[seat] || []).concat(cards);
    delete game.pendingDiscards[seat];
    if (!Object.keys(game.pendingDiscards).length) {
      game.phase = 'playing';
      game.trick = null;
      sel = {};
    }
    sendAllState();
  }

  function currentTurn() {
    if (!game) return 0;
    if (!game.trick) return game.dealerSeat;
    var order = trickOrder();
    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      if (!game.trick.plays[s] && !game.finished[s]) return s;
    }
    return 0;
  }
  function trickOrder() {
    var seats = game.seats;
    var start = game.trick ? game.trick.leadSeat : game.dealerSeat;
    var idx = seats.indexOf(start);
    var out = [];
    for (var i = 0; i < seats.length; i++) out.push(seats[(idx + i) % seats.length]);
    return out;
  }

  function doPlay(seat, cards) {
    if (!handHas(seat, cards) || !cards.length) return;
    var lead = game.trick;
    var info;
    if (!lead) {
      info = analyzePlay('', cards);
      if (!info) { toast('牌型不合法'); sendAllState(); return; }
    } else {
      var res = validateFollow(seat, lead, cards);
      if (!res || res.error) { if (res && res.error) toast(res.error); sendAllState(); return; }
      info = res.info;
    }
    removeCards(seat, cards);
    if (!lead) {
      game.lastTrick = null;   /* 新一轮开始：清掉上一轮展示的牌 */
      game.trick = { leadSeat: seat, leadCards: cards, leadInfo: info, plays: {}, order: [] };
      game.trick.plays[seat] = { cards: cards, info: info, kind: 'lead' };
    } else {
      game.trick.plays[seat] = { cards: cards, info: info, kind: info.kind || 'follow' };
    }
    game.trick.order.push(seat);
    if (trickFinished()) resolveTrick();
    else sendAllState();
  }
  function trickFinished() {
    var order = trickOrder();
    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      if (game.finished[s]) continue;
      if (!game.trick.plays[s]) return false;
    }
    return true;
  }

  /* 跟牌校验（按用户规则实现，允许合理近似） */
  function validateFollow(seat, lead, cards) {
    var hand = game.hands[seat] || [];
    var leadSuit = lead.leadInfo.suit;
    var total = lead.leadCards.length;
    if (cards.length !== total) return { error: '需要出 ' + total + ' 张牌' };
    var sameSuit = hand.filter(function (c) { return leadSuit === 'T' ? isTrump(c) : (c.s === leadSuit && !isTrump(c)); });
    var allTrump = cards.every(isTrump);
    var chosenSuitCards = cards.filter(function (c) { return leadSuit === 'T' ? isTrump(c) : (c.s === leadSuit && !isTrump(c)); });
    var info = analyzePlay(leadSuit, cards);
    if (!info) {
      /* 允许“同花色 + 其它牌凑数”的垫牌：所有同花色牌必须全部用上 */
      if (!isAllSuitIncluded(cards, sameSuit)) return { error: '未包含全部同花色牌' };
      return { info: { kind: 'discard', suit: 'M', comps: [], key: [-1], discard: true } };
    }
    if (!sameSuit.length) {
      if (allTrump) {
        /* 毙牌：牌型需与首出牌一致 */
        if (!sameShape(lead.leadInfo, info)) return { error: '毙牌牌型不符' };
        info.kind = 'kill';
        return { info: info };
      }
      return { info: { kind: 'discard', suit: 'M', comps: info.comps, key: [-1], discard: true } };
    }
    /* 有同花色牌：必须优先使用同花色牌，且对子数量尽量满足 */
    if (sameSuit.length >= total) {
      if (chosenSuitCards.length !== total) return { error: '必须出同花色牌' };
      var needPairs = lead.leadInfo.pairCount || 0;
      var havePairs = countPairs(sameSuit);
      var chosenPairs = countPairs(cards);
      if (chosenPairs < Math.min(needPairs, havePairs)) return { error: '需要优先出对子' };
      if (lead.leadInfo.kind === 'tractor') {
        if (chosenPairs < 2) return { error: '需要出连对' };
      }
      info.kind = 'follow';
      return { info: info };
    }
    /* 同花色不够：全部同花色牌 + 其它牌凑数 */
    if (!isAllSuitIncluded(cards, sameSuit)) return { error: '需要带上全部同花色牌' };
    return { info: { kind: 'discard', suit: 'M', comps: info.comps, key: [-1], discard: true } };
  }
  function isAllSuitIncluded(cards, sameSuit) {
    for (var i = 0; i < sameSuit.length; i++) {
      if (cards.indexOf(sameSuit[i]) < 0) return false;
    }
    return true;
  }
  function countPairs(cards) {
    var map = {};
    cards.forEach(function (c) { var k = c.s + '-' + c.r; map[k] = (map[k] || 0) + 1; });
    var n = 0;
    Object.keys(map).forEach(function (k) { n += Math.floor(map[k] / 2); });
    return n;
  }
  function sameShape(a, b) {
    if (!a || !b) return false;
    var pa = a.pairCount || 0, pb = b.pairCount || 0;
    if (pa !== pb) return false;
    if ((a.singleCount || 0) !== (b.singleCount || 0)) {
      if (a.kind !== 'throw' || b.kind !== 'throw') return false;
    }
    return true;
  }

  /* ---------- 一轮结算 ---------- */
  function resolveTrick() {
    var records = trickOrder().map(function (s, i) {
      return { seat: s, order: i, play: game.trick.plays[s] };
    }).filter(function (r) { return !!r.play; });
    function cat(r) {
      if (r.seat === game.trick.leadSeat) return 1;
      if (r.play.kind === 'kill') return 2;
      if (r.play.kind === 'discard') return 0;
      return 1;
    }
    var best = null;
    records.forEach(function (r) {
      if (!best) { best = r; return; }
      var ca = cat(r), cb = cat(best);
      if (ca > cb) { best = r; return; }
      if (ca < cb) return;
      if (cmpKey(r.play.info.key, best.play.info.key) > 0) best = r;
    });
    var winner = best.seat;
    var pts = 0;
    records.forEach(function (r) { pts += cardsPoints(r.play.cards); });
    game.roundPoints[teamOf(winner)] += pts;
    /* 甩牌失败：被毙或更大的跟牌压过 */
    var leadRec = records.filter(function (r) { return r.seat === game.trick.leadSeat; })[0];
    var throwFail = false;
    if (leadRec && leadRec.play.info.kind === 'throw') {
      records.forEach(function (r) {
        if (r.seat === game.trick.leadSeat) return;
        var c = cat(r);
        if (c > 1) throwFail = true;
        else if (c === 1 && r.play.kind !== 'discard' && cmpKey(r.play.info.key, leadRec.play.info.key) > 0) throwFail = true;
      });
    }
    if (throwFail) {
      var tt = teamOf(game.trick.leadSeat);
      game.roundPoints[tt] = Math.max(0, game.roundPoints[tt] - 10);
      toast(seatName(game.trick.leadSeat) + ' 甩牌失败，扣 10 分');
    }
    game.lastTrick = { winner: winner, records: records, points: pts, throwFail: throwFail };
    game.trick = null;
    sendAllState();
    if (trickTimer) clearTimeout(trickTimer);
    trickTimer = setTimeout(function () {
      if (!game || game.phase !== 'playing') return;
      if (roundShouldEnd()) { finishRound(); return; }
      /* 下一轮首出 */
      var next = nextLeadSeat(records, winner);
      game.dealerSeat = next;
      sendAllState();
    }, 2600);
  }
  function nextLeadSeat(records, winner) {
    var mate = mateSeat(winner);
    if (mate && !game.finished[mate]) return mate;
    var sorted = records.slice().sort(function (a, b) {
      var ca = a.seat === winner ? 3 : (a.play.kind === 'kill' ? 2 : (a.play.kind === 'discard' ? 0 : 1));
      var cb = b.seat === winner ? 3 : (b.play.kind === 'kill' ? 2 : (b.play.kind === 'discard' ? 0 : 1));
      if (ca !== cb) return cb - ca;
      return cmpKey(b.play.info.key, a.play.info.key);
    });
    for (var i = 0; i < sorted.length; i++) {
      if (!game.finished[sorted[i].seat]) return sorted[i].seat;
    }
    return winner;
  }
  function roundShouldEnd() {
    var teams = {};
    game.seats.forEach(function (s) {
      if ((game.hands[s] || []).length) teams[teamOf(s)] = true;
    });
    return Object.keys(teams).length <= 1;
  }

  /* ---------- 结算 / 升级 ---------- */
  function finishRound() {
    game.phase = 'over';
    var N = settings.count, S = 50 * N;
    var D = game.roundPoints[game.dealerTeam] || 0;
    var dt = game.dealerTeam;
    var result = applySettlement(D, S, dt);
    game.result = result;
    session.round++;
    session.over = !!result.matchOver;
    session.levels = result.levels;
    if (result.matchOver) {
      if (openState && myId) unregisterOpenRoom(myId);
    } else {
      session.trumpSuit = game.trumpSuit;
      session.nextDealerTeam = result.nextDealerTeam;
      game.nextDealerSeat = result.nextDealerSeat;
    }
    sendAllState();
    showResult();
  }
  /* 返回 { levels, nextDealerTeam, nextDealerSeat, matchOver, lines } */
  function applySettlement(D, S, dealerTeam) {
    var teams = [];
    game.seats.forEach(function (s) { if (teams.indexOf(teamOf(s)) < 0) teams.push(teamOf(s)); });
    var levels = session.levels.slice();
    var lines = [];
    var deckTeam = dealerTeam;
    var nextTeam = dealerTeam, nextSeat = game.dealerSeat;
    var levelUp = {};   /* team -> +n */
    function addLevel(t, n) { levelUp[t] = (levelUp[t] || 0) + n; }
    function members(t) { return game.seats.filter(function (s) { return teamOf(s) === t; }); }
    function teammateSeat(t) { var m = members(t); return m.length ? m[0] : 0; }
    var others = teams.filter(function (t) { return t !== dealerTeam; });
    others.sort(function (a, b) { return (game.roundPoints[b] || 0) - (game.roundPoints[a] || 0); });
    var hi = others[0] || -1;
    var hiTie = others.filter(function (t) { return (game.roundPoints[t] || 0) === (game.roundPoints[hi] || 0); });
    function resolvePrimary(tie) {
      if (tie.length === 1) return { team: tie[0], same: false };
      var minLv = Math.min.apply(null, tie.map(function (t) { return levels[t]; }));
      var minTeams = tie.filter(function (t) { return levels[t] === minLv; });
      if (minTeams.length === 1) return { team: minTeams[0], same: false };
      return { team: -1, same: true, tie: minTeams };
    }
    var f975 = Math.floor(0.975 * S), f80 = Math.floor(0.8 * S), f60 = Math.floor(0.6 * S), f40 = Math.floor(0.4 * S), f20 = Math.floor(0.2 * S);
    if (D > f975) {
      addLevel(dealerTeam, 3);
      lines.push('庄家得 ' + D + ' 分，升 3 级');
    } else if (D > f80) {
      addLevel(dealerTeam, 2);
      lines.push('庄家得 ' + D + ' 分，升 2 级');
    } else if (D > f60) {
      addLevel(dealerTeam, 1);
      lines.push('庄家得 ' + D + ' 分，升 1 级');
    } else if (D > f40) {
      var r = resolvePrimary(hiTie);
      if (r.same) {
        r.tie.forEach(function (t) { addLevel(t, 1); });
        lines.push('庄家得 ' + D + ' 分，同分闲家共同升 1 级，庄家连庄');
      } else {
        nextTeam = r.team;
        nextSeat = teammateSeat(r.team);
        lines.push('庄家得 ' + D + ' 分，无人升级，' + teamName(r.team) + ' 上台');
      }
    } else if (D > f20) {
      var r2 = resolvePrimary(hiTie);
      if (r2.same) {
        r2.tie.forEach(function (t) { addLevel(t, 1); });
        lines.push('庄家得 ' + D + ' 分，同分闲家共同升 1 级，庄家连庄');
      } else {
        addLevel(r2.team, 1);
        nextTeam = r2.team;
        nextSeat = teammateSeat(r2.team);
        lines.push('庄家得 ' + D + ' 分，' + teamName(r2.team) + ' 升 1 级并上台');
      }
    } else {
      /* 庄家 ≤ 20%S */
      var r3 = resolvePrimary(hiTie);
      var primaryTie = r3.same ? r3.tie : [r3.team];
      var rest = others.filter(function (t) { return primaryTie.indexOf(t) < 0; });
      var secondPts = rest.length ? (game.roundPoints[rest[0]] || 0) : -1;
      var secondTie = rest.filter(function (t) { return (game.roundPoints[t] || 0) === secondPts; });
      var rest2 = rest.filter(function (t) { return secondTie.indexOf(t) < 0; });
      var lowestPts = rest2.length ? (game.roundPoints[rest2[rest2.length - 1]] || 0) : -1;
      var lowestTie = rest2.filter(function (t) { return (game.roundPoints[t] || 0) === lowestPts; });
      if (r3.same) {
        r3.tie.forEach(function (t) { addLevel(t, 2); });
        secondTie.forEach(function (t) { addLevel(t, 1); });
        lines.push('庄家得 ' + D + ' 分，同分闲家共同升 2 级，庄家连庄');
      } else {
        addLevel(r3.team, D === 0 ? 3 : 2);
        nextTeam = r3.team;
        nextSeat = teammateSeat(r3.team);
        lines.push('庄家得 ' + D + ' 分，' + teamName(r3.team) + ' 升 ' + (D === 0 ? 3 : 2) + ' 级并上台');
        secondTie.forEach(function (t) { addLevel(t, D === 0 ? 2 : 1); });
        if (secondTie.length) lines.push(secondTie.map(teamName).join('、') + ' 升 ' + (D === 0 ? 2 : 1) + ' 级');
        if (D === 0) {
          lowestTie.forEach(function (t) { addLevel(t, 1); });
          if (lowestTie.length) lines.push(lowestTie.map(teamName).join('、') + ' 升 1 级');
        }
      }
    }
    var matchOver = false, winners = [];
    teams.forEach(function (t) {
      if (levelUp[t]) levels[t] += levelUp[t];
      if (levels[t] > 14) winners.push(t);
    });
    if (winners.length) {
      matchOver = true;
      var primaryWin = (r3 && r3.team >= 0) ? r3.team : (r2 && r2.team >= 0 ? r2.team : (typeof r !== 'undefined' && r && r.team >= 0 ? r.team : nextTeam));
      if (winners.length > 1 && winners.indexOf(primaryWin) >= 0) winners = [primaryWin];
      lines.push('🎉 ' + winners.map(teamName).join('、') + ' 过 A，获得整场胜利！');
    }
    return { levels: levels, nextDealerTeam: nextTeam, nextDealerSeat: nextSeat || teammateSeat(nextTeam), matchOver: matchOver, winners: winners, lines: lines, dealerPoints: D };
  }
  function teamName(t) {
    var m = membersOfTeam(t);
    return m.length ? (seatName(m[0]) + '/' + seatName(m[1])) : ('队伍' + (t + 1));
  }
  function membersOfTeam(t) {
    return game.seats.filter(function (s) { return teamOf(s) === t; });
  }

  function showResult() {
    if (!game || !game.result) return;
    var lines = game.result.lines || [];
    var head = game.result.matchOver ? '整场结束' : '第 ' + (session.round) + ' 局结束';
    $('up-result-title').textContent = head;
    $('up-result-text').innerHTML = lines.join('<br>');
    $('btn-up-next-round').classList.toggle('hidden', !!game.result.matchOver);
    showModal($('up-result-modal'));
  }
  $('btn-up-result-home').addEventListener('click', function () { location.href = 'index.html'; });
  $('btn-up-next-round').addEventListener('click', function () {
    if (!isHost || !session || session.over) return;
    hideModal($('up-result-modal'));
    dealRound(false);
  });

  /* ---------- 渲染 ---------- */
  function cardEl(c, faceUp) {
    var d = document.createElement('div');
    d.className = 'fc-card' + (faceUp ? '' : ' face-down');
    d.dataset.suit = c.s;
    d.dataset.rank = c.r;
    if (faceUp && c.s === 'j') {
      /* 王：整张显示大小王（同 battle） */
      var jf = document.createElement('img');
      jf.className = 'bt-joker-face';
      jf.src = JOKER_IMG[c.r];
      jf.alt = '';
      jf.draggable = false;
      d.appendChild(jf);
      return d;
    }
    var r1 = document.createElement('img');
    r1.className = 'fc-rank';
    r1.src = RANK_IMG[c.r];
    r1.alt = '';
    r1.draggable = false;
    var r2 = document.createElement('img');
    r2.className = 'fc-rank-br';
    r2.src = r1.src;
    r2.alt = '';
    r2.draggable = false;
    var s = document.createElement('img');
    s.className = 'fc-suit';
    s.src = suitImg(c.s);
    s.alt = '';
    s.draggable = false;
    d.appendChild(r1);
    d.appendChild(r2);
    d.appendChild(s);
    return d;
  }
  function seatOf(id) {
    var p = playerOfId(id);
    return p ? p.seat : 0;
  }
  /* 显示座位：以自己为底部（1 号位）旋转，队伍与出牌顺序仍按实际座位 */
  var RING = { 4: [1, 3, 5, 7], 6: [1, 2, 4, 5, 6, 8], 8: [1, 2, 3, 4, 5, 6, 7, 8] };
  function displaySeatOf(seat) {
    if (!game) return seat;
    var ring = RING[game.seatCount] || RING[8];
    var i = game.seats.indexOf(seat);
    if (i < 0) return seat;
    var off = game.seats.indexOf(mySeat);
    if (off < 0) off = 0;
    return ring[(i - off + ring.length) % ring.length];
  }
  function dollSrc(seat) {
    if (seat === 1 || seat === 5) return 'middledoll';
    if (seat === 2 || seat === 3 || seat === 4) return 'leftdoll';   /* 右侧座位：朝左看牌桌 */
    return 'rightdoll';                                             /* 左侧座位：朝右看牌桌 */
  }
  function renderGame() {
    if (!game) { renderLobby(); return; }
    var showDeclare = game.phase === 'declare';
    declareBar.classList.toggle('hidden', !showDeclare);
    if (showDeclare) declareBar.textContent = declareBarText();
    renderStatus();
    renderSeats();
    renderTrump();
    renderBottom();
    renderCenter();
    renderHand();
    renderPanel();
    renderControls();
    applyUpgradeLayout();
  }
  function renderStatus() {
    if (!game) return;
    var phaseText = '';
    var sub = [];
    if (game.phase === 'declare') {
      var d = game.declare;
      if (!d.declarerSeat) {
        phaseText = '亮主阶段';
        sub.push(Math.max(0, Math.ceil((d.deadline - Date.now()) / 1000)) + 's');
      } else if (d.counterAllowed) {
        phaseText = '反主阶段';
        sub.push(Math.max(0, Math.ceil((d.counterDeadline - Date.now()) / 1000)) + 's');
      } else {
        phaseText = '亮主阶段';
      }
    } else if (game.phase === 'discard') {
      phaseText = '弃牌阶段';
    } else if (game.phase === 'playing') {
      phaseText = seatName(currentTurn()) + ' 出牌中';
    } else {
      phaseText = '本局结束';
    }
    statusEl.textContent = phaseText;
    if (game.phase !== 'declare') {
      sub.push('主牌：' + (game.trumpSuit ? SUIT_ZH[game.trumpSuit] : '未定'));
      sub.push('级牌：' + rankText(game.levelRank || 2));
    }
    statusSubEl.innerHTML = sub.join('<br>');
    tipEl.textContent = game.phase === 'over' ? '本局结束' : '';
  }
  function renderTrump() {
    if (!game) return;
    if (game.trumpSuit) {
      trumpEl.textContent = '主牌：' + SUIT_ZH[game.trumpSuit] + '（级牌 ' + rankText(game.levelRank) + '）';
    } else {
      trumpEl.textContent = '亮主中…';
    }
  }
  function renderSeats() {
    tableEl.querySelectorAll('.bt-doll').forEach(function (d) { d.remove(); });
    for (var i = 1; i <= 8; i++) { var e0 = $('up-seat-' + i); if (e0) e0.innerHTML = ''; }
    game.seats.forEach(function (seat) {
      if (seat === mySeat) return;   /* 自己不显示娃娃与剩余牌数（出牌仍显示） */
      var ds = displaySeatOf(seat);
      var el = $('up-seat-' + ds);
      if (!el) return;
      var p = seatPlayer(seat);
      if (!p) return;
      var cnt = document.createElement('div');
      cnt.className = 'fc-card bt-opp-card face-down';
      var num = document.createElement('span');
      num.className = 'bt-opp-count';
      num.textContent = game.counts[seat] || 0;
      cnt.appendChild(num);
      el.appendChild(cnt);
      var isTurn = game.phase === 'playing' && currentTurn() === seat;
      el.classList.toggle('turn', isTurn);
      var isDealer = game.dealerSeat === seat;
      var img = document.createElement('img');
      img.className = 'bt-doll' + (isDealer ? ' bt-queen' : '');
      img.dataset.seat = ds;        /* 位置（决定 CSS 定位/朝向） */
      img.dataset.actual = seat;    /* 实际座位（决定信息内容） */
      if (isDealer) img.src = isTurn ? 'texture/queen.png' : 'texture/darkqueen.png';
      else img.src = 'texture/' + dollSrc(ds) + (isTurn ? '' : '-dark') + '.png';
      var shadow = document.createElement('img');
      shadow.className = img.className + ' bt-doll-shadow';
      shadow.dataset.seat = ds;
      shadow.src = img.src;
      el.appendChild(shadow);
      el.appendChild(img);
      img.addEventListener('click', function () { showDollInfo(parseInt(this.dataset.actual, 10)); });
      img.addEventListener('mouseenter', function () { showDollInfo(parseInt(this.dataset.actual, 10)); });
      img.addEventListener('mouseleave', function () { hideDollInfo(); });
    });
  }
  function showDollInfo(seat) {
    var box = $('up-doll-info');
    var p = seatPlayer(seat);
    if (!p) return;
    box.dataset.seat = displaySeatOf(seat);
    box.classList.remove('hidden');
    box.querySelector('.bt-doll-info-name').textContent = p.name;
    box.querySelector('.bt-doll-info-role').textContent = teamName(teamOf(seat)) + (game.dealerSeat === seat ? ' · 庄家' : ' · 闲家');
    box.querySelector('.bt-doll-info-turn').textContent = (game.phase === 'playing' && currentTurn() === seat) ? '轮到出牌' : '等待';
    box.querySelector('.bt-doll-info-cards').textContent = game.counts[seat] || 0;
    box.querySelector('.bt-doll-info-level').textContent = session ? rankText(session.levels[teamOf(seat)]) : '-';
    box.querySelector('.bt-doll-info-score').textContent = (game.roundPoints[teamOf(seat)] || 0) + ' 分';
  }
  function hideDollInfo() { $('up-doll-info').classList.add('hidden'); }
  function renderBottom() {
    bottomEl.innerHTML = '';
    if (!game) return;
    var n = (game.bottom && game.bottom.length) || game.bottomCount || 0;
    for (var i = 0; i < n; i++) bottomEl.appendChild(cardEl({ s: 's', r: 2, id: 'back-' + i }, false));
  }
  function renderCenter() {
    centerEl.innerHTML = '';
    if (!game) return;
    var plays = null;
    if (game.trick && game.trick.plays) plays = game.trick.plays;
    else if (game.lastTrick) {
      plays = {};
      game.lastTrick.records.forEach(function (r) { plays[r.seat] = r.play; });
    }
    if (!plays) return;
    Object.keys(plays).forEach(function (k) {
      var seat = parseInt(k, 10);
      var ds = displaySeatOf(seat);
      var el = $('up-seat-' + ds);
      if (!el || !plays[k]) return;
      var box = document.createElement('div');
      box.className = 'up-play';
      box.dataset.seat = ds;
      plays[k].cards.forEach(function (c) { box.appendChild(cardEl(c, true)); });
      el.appendChild(box);
    });
  }
  function renderHand() {
    handEl.innerHTML = '';
    if (!game || !mySeat) return;
    handEl.classList.toggle('bt-myturn', game.phase === 'playing' && currentTurn() === mySeat && !(game.trick && game.trick.plays[mySeat]));
    var hand = game.hands[mySeat] || [];
    sortHand(hand);
    if (!hand.length) return;
    var cw = resolveHandCw(handCardWidth());
    handEl.style.setProperty('--bt-hand-c', cw + 'px');
    var n = hand.length;
    var avail = window.innerWidth - 16;
    var step = cw * 0.5;
    if (n > 1) {
      var minStep = cw * 0.3;
      var fit = (avail - cw) / (n - 1);
      if (fit < minStep) fit = minStep;
      if (step > fit) step = fit;
    }
    hand.forEach(function (c, i) {
      var el = cardEl(c, true);
      el.dataset.cid = c.id;
      if (sel[c.id]) el.classList.add('sel');
      if (i > 0) el.style.marginLeft = (-(cw - step)) + 'px';
      handEl.appendChild(el);
    });
  }
  /* 选牌交互（参照 battle：单击切换 / 滑动切换 / 双击取消全部 / 已选牌上滑出牌） */
  function markSel(cid, on) {
    var el = handEl.querySelector('[data-cid="' + cid + '"]');
    if (el) el.classList.toggle('sel', on);
  }
  function toggleSel(cid) {
    if (sel[cid]) {
      delete sel[cid];
      markSel(cid, false);
    } else {
      sel[cid] = true;
      markSel(cid, true);
    }
  }
  var handDown = null, lastTapTime = 0, lastTapCid = '';
  handEl.addEventListener('pointerdown', function (e) {
    if (!game) return;
    if (game.phase !== 'declare' && game.phase !== 'discard' && game.phase !== 'playing') return;
    var cardDom = e.target.closest ? e.target.closest('.fc-card') : null;
    if (!cardDom || !handEl.contains(cardDom)) return;
    var cid = cardDom.dataset.cid;
    if (!cid) return;
    e.preventDefault();
    handDown = {
      cid: cid,
      wasSel: !!sel[cid],
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      moved: false,
      sweepActive: false,
      touched: {},
      played: false
    };
  });
  document.addEventListener('pointermove', function (e) {
    if (!handDown || handDown.played) return;
    var dx = e.clientX - handDown.startX;
    var dy = e.clientY - handDown.startY;
    if (!handDown.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 8) return;
      handDown.moved = true;
    }
    /* 上滑出牌：仅出牌阶段、按住已选中的牌、0.5s 内上拖超过 1/5 屏高 */
    if (handDown.wasSel && game.phase === 'playing') {
      if (Date.now() - handDown.startTime <= 500 && dy <= -(window.innerHeight / 5)) {
        handDown.played = true;
        tryPlaySelected();
        return;
      }
      if (Date.now() - handDown.startTime <= 500 && dy < 0 && Math.abs(dy) >= Math.abs(dx)) return;
    }
    /* 滑动选牌：经过的每张牌切换一次 */
    if (!handDown.sweepActive) {
      handDown.sweepActive = true;
      handDown.touched[handDown.cid] = true;
      toggleSel(handDown.cid);
    }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var cardDom2 = el && el.closest ? el.closest('#up-hand .fc-card') : null;
    if (!cardDom2) return;
    var cid2 = cardDom2.dataset.cid;
    if (cid2 && !handDown.touched[cid2]) {
      handDown.touched[cid2] = true;
      toggleSel(cid2);
    }
  });
  function endHandGesture() {
    if (!handDown) return;
    var d = handDown;
    handDown = null;
    if (d.played || d.moved) return;
    var now = Date.now();
    if (now - lastTapTime < 300 && lastTapCid === d.cid) {
      /* 双击同一张牌：取消全部选中 */
      sel = {};
      renderHand();
      lastTapTime = 0;
      lastTapCid = '';
      return;
    }
    lastTapTime = now;
    lastTapCid = d.cid;
    toggleSel(d.cid);
  }
  document.addEventListener('pointerup', endHandGesture);
  document.addEventListener('pointercancel', function () { handDown = null; });
  /* 出牌/弃牌/亮主动作的公共入口（上滑与按钮共用） */
  function tryPlaySelected() {
    if (!game || game.phase !== 'playing') return;
    var cards = selectedCards();
    if (!cards.length) { toast('请先选择要出的牌'); return; }
    if (isHost) doPlay(mySeat, cards);
    else sendMy({ t: 'action', a: { a: 'play', cards: cards, time: Date.now() } });
    sel = {};
    renderHand();
  }
  function selectedCards() {
    var hand = game ? (game.hands[mySeat] || []) : [];
    return hand.filter(function (c) { return sel[c.id]; });
  }
  /* 玩家头像：自己用 Profile，其余用联机交换的头像；未设置时按座位用不同花色符号 */
  function avatarInner(seat) {
    var id = game && game.seatIds ? game.seatIds[seat] : '';
    var prof = (id === myId) ? (Profile.get() || {}) : (avatars[id] || null);
    if (prof && prof.avatar === 'custom' && prof.avatarData) {
      var smooth = prof.avatarSmooth !== false;
      return '<img class="avatar-img' + (smooth ? ' smooth' : '') + '" src="' + prof.avatarData + '">';
    }
    if (prof && prof.avatar && prof.avatar.indexOf('piece:') === 0) {
      var parts = prof.avatar.slice(6).split(':');
      var color = parts[0] === 'auto' ? 'w' : parts[0];
      return '<img class="avatar-img piece" src="' + PIECE_IMG[color][parts[1]] + '">';
    }
    var glyphs = ['\u2660', '\u2665', '\u2663'];
    return '<span class="avatar-glyph">' + glyphs[seat % glyphs.length] + '</span>';
  }
  function playerCardEl(seat) {
    var p = seatPlayer(seat);
    if (!p) return null;
    var card = document.createElement('div');
    card.className = 'player-card' + (game.phase === 'playing' && currentTurn() === seat ? ' turn' : '');
    var av = document.createElement('div');
    av.className = 'avatar';
    av.innerHTML = avatarInner(seat) + '<img class="avatar-border" src="texture/avatarboarder.png" alt="">';
    card.appendChild(av);
    var info = document.createElement('div');
    info.className = 'pinfo';
    var nm = document.createElement('div');
    nm.className = 'pname';
    var ni = document.createElement('span');
    ni.className = 'pname-in';
    ni.textContent = p.name + (seat === mySeat ? '（我）' : '');
    nm.appendChild(ni);
    var cnt = document.createElement('div');
    cnt.className = 'bt-count-text';
    cnt.textContent = '剩余 ' + (game.counts[seat] || 0) + ' 张';
    info.appendChild(nm);
    info.appendChild(cnt);
    card.appendChild(info);
    return card;
  }
  /* 右侧面板：同队两名玩家名片框在一起，下方分割线 + 队伍信息（参照 Turn Left 面板样式） */
  function renderPanel() {
    if (!game) return;
    playerPanelEl.innerHTML = '';
    var teams = [];
    game.seats.forEach(function (s) {
      var t = teamOf(s);
      if (teams.indexOf(t) < 0) teams.push(t);
    });
    teams.sort(function (a, b) { return a - b; });
    teams.forEach(function (t) {
      var block = document.createElement('div');
      block.className = 'up-team-block';
      game.seats.forEach(function (seat) {
        if (teamOf(seat) !== t) return;
        var card = playerCardEl(seat);
        if (card) block.appendChild(card);
      });
      var hr = document.createElement('div');
      hr.className = 'tl-stats-divider';
      block.appendChild(hr);
      var stats = document.createElement('div');
      stats.className = 'tl-stats';
      function row(label, value) {
        var r = document.createElement('div');
        r.className = 'tl-stat-row';
        var l = document.createElement('span');
        l.textContent = label;
        var v = document.createElement('span');
        v.textContent = value;
        r.appendChild(l);
        r.appendChild(v);
        stats.appendChild(r);
      }
      row('当前身份', game.dealerTeam === t ? '庄家' : '闲家');
      row('当前级牌', rankText(session ? session.levels[t] : 2));
      row('当前得分', (game.roundPoints[t] || 0) + ' 分');
      block.appendChild(stats);
      playerPanelEl.appendChild(block);
    });
    fitPlayerNames();
  }
  /* 玩家名称：过长先缩小字号（最小原字号 50%），仍放不下则省略号 + 悬停滚动 */
  function fitPlayerNames() {
    var names = playerPanelEl.querySelectorAll('.pname');
    for (var i = 0; i < names.length; i++) {
      var el = names[i];
      var inner = el.querySelector('.pname-in');
      if (!inner) continue;
      var base = parseFloat(getComputedStyle(el).fontSize) || 15;
      var size = base;
      el.style.fontSize = '';
      while (el.scrollWidth > el.clientWidth && size > base * 0.5) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
      }
      if (el.scrollWidth > el.clientWidth) {
        el.classList.add('clipped');
        var shift = Math.max(el.scrollWidth - el.clientWidth, inner.scrollWidth - inner.clientWidth);
        if (shift <= 0) continue;
        el.style.setProperty('--up-name-shift', (-shift) + 'px');
        el.style.setProperty('--up-name-dur', Math.max(1.2, shift / 25).toFixed(2) + 's');
        el.addEventListener('mouseenter', function () { this.classList.add('rolling'); });
        el.addEventListener('mouseleave', function () { this.classList.remove('rolling'); });
      }
    }
  }
  function renderControls() {
    var show = function (id, v) { var el = $(id); if (el) el.classList.toggle('hidden', !v); };
    if (!game) {
      show('btn-up-play', false); show('btn-up-declare', false); show('btn-up-counter', false); show('btn-up-discard', false);
      return;
    }
    var myTurn = game.phase === 'playing' && currentTurn() === mySeat && !(game.trick && game.trick.plays[mySeat]);
    show('btn-up-play', myTurn);
    show('btn-up-declare', game.phase === 'declare' && !game.declare.declarerSeat && canDeclare());
    show('btn-up-counter', game.phase === 'declare' && game.declare.counterAllowed && game.declare.declarerSeat !== mySeat && canCounter());
    show('btn-up-discard', game.phase === 'discard' && !!game.pendingDiscards[mySeat]);
    show('btn-up-home', game.phase === 'over');
  }
  function canDeclare() {
    var hand = game.hands[mySeat] || [];
    return hand.some(function (c) { return c.r === 2 && c.s !== 'j'; });
  }
  function canCounter() {
    var hand = game.hands[mySeat] || [];
    var cnt = {};
    hand.forEach(function (c) { if (c.r === game.levelRank && c.s !== 'j' && c.s !== game.declare.suit) cnt[c.s] = (cnt[c.s] || 0) + 1; });
    return Object.keys(cnt).some(function (s) { return cnt[s] >= 2; });
  }
  function declareBarText() {
    if (!game || game.phase !== 'declare') return '';
    var d = game.declare;
    if (!d.declarerSeat) {
      var left = Math.max(0, Math.ceil((d.deadline - Date.now()) / 1000));
      return '亮主倒计时 ' + left + 's（点击亮主/反主按钮前先选择级牌）';
    }
    if (d.counterAllowed) {
      var l2 = Math.max(0, Math.ceil((d.counterDeadline - Date.now()) / 1000));
      return seatName(d.declarerSeat) + ' 亮主 ' + SUIT_ZH[d.suit] + '，反主倒计时 ' + l2 + 's';
    }
    return seatName(d.declarerSeat) + ' 亮主 ' + SUIT_ZH[d.suit];
  }

  /* ---------- 客户端按钮 ---------- */
  $('btn-up-declare').addEventListener('click', function () {
    var cards = selectedCards();
    if (!cards.length) { toast('请先选择级牌'); return; }
    if (isHost) doDeclare(mySeat, { cards: cards });
    else sendMy({ t: 'action', a: { a: 'declare', cards: cards, time: Date.now() } });
    sel = {};
    renderHand();
  });
  $('btn-up-counter').addEventListener('click', function () {
    var cards = selectedCards();
    if (!cards.length) { toast('请先选择级牌'); return; }
    if (isHost) doDeclare(mySeat, { cards: cards });
    else sendMy({ t: 'action', a: { a: 'declare', cards: cards, time: Date.now() } });
    sel = {};
    renderHand();
  });
  $('btn-up-play').addEventListener('click', function () { tryPlaySelected(); });
  $('btn-up-discard').addEventListener('click', function () {
    var cards = selectedCards();
    var need = game && game.pendingDiscards[mySeat];
    if (!need || cards.length !== need) { toast('需要选择 ' + (need || 0) + ' 张牌'); return; }
    if (isHost) doDiscard(mySeat, cards);
    else sendMy({ t: 'action', a: { a: 'discard', cards: cards, time: Date.now() } });
    sel = {};
    renderHand();
  });
  $('btn-up-home').addEventListener('click', function () { location.href = 'index.html'; });

  /* ---------- 设置弹窗 ---------- */
  function styleSlider(s) {
    if (!s) return;
    var w = s.clientWidth || 300;
    var fs = parseFloat(window.getComputedStyle(s).fontSize) || 43.6;
    var trackHpx = Math.max(2, w / 62);
    var trackH = trackHpx / fs;
    var val = parseFloat(s.value) || 100;
    var min = parseFloat(s.min) || 40, max = parseFloat(s.max) || 200;
    var f = Math.max(0, Math.min(1, (val - min) / (max - min)));
    var thumbWpx = trackHpx * 2.5;
    var fill = (f * (1 - thumbWpx / w) + thumbWpx / (2 * w)) * 100;
    s.style.setProperty('--track-h', trackH.toFixed(4) + 'em');
    s.style.setProperty('--thumb-w', (trackH * 2.5).toFixed(4) + 'em');
    s.style.setProperty('--thumb-h', (trackH * 7).toFixed(4) + 'em');
    s.style.setProperty('--fill', fill.toFixed(2) + '%');
  }
  function setToggle(el, on) {
    if (!el) return;
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    var img = el.querySelector('img');
    if (img) img.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function syncSettingsUI() {
    $('up-scale').value = Math.round(uiSettings.tableScale * 100);
    $('up-scale-label').textContent = Math.round(uiSettings.tableScale * 100) + '%';
    $('up-hand-scale').value = Math.round(uiSettings.handScale * 100);
    $('up-hand-scale-label').textContent = Math.round(uiSettings.handScale * 100) + '%';
    $('up-panel-scale').value = Math.round(uiSettings.panelScale * 100);
    $('up-panel-scale-label').textContent = Math.round(uiSettings.panelScale * 100) + '%';
    setToggle($('up-opt-transparent'), uiSettings.transparent);
    setToggle($('up-opt-suitborder'), uiSettings.suitBorder);
    setToggle($('up-opt-twocolor'), uiSettings.twoColor);
  }
  function styleAllSliders() {
    styleSlider($('up-scale'));
    styleSlider($('up-hand-scale'));
    styleSlider($('up-panel-scale'));
  }
  $('btn-up-settings').addEventListener('click', function () {
    syncSettingsUI();
    showModal($('up-settings-modal'));
    styleAllSliders();
    requestAnimationFrame(styleAllSliders);
  });
  $('btn-up-settings-back').addEventListener('click', function () { hideModal($('up-settings-modal')); });
  $('btn-up-settings-close').addEventListener('click', function () { hideModal($('up-settings-modal')); });
  Profile.wireModalOutsideClick($('up-settings-modal'), function () { hideModal($('up-settings-modal')); });
  $('up-scale').addEventListener('input', function () {
    uiSettings.tableScale = parseInt(this.value, 10) / 100;
    $('up-scale-label').textContent = this.value + '%';
    saveUiSettings(); applyUiSettings(); styleSlider(this);
  });
  $('up-hand-scale').addEventListener('input', function () {
    uiSettings.handScale = parseInt(this.value, 10) / 100;
    $('up-hand-scale-label').textContent = this.value + '%';
    saveUiSettings(); applyUiSettings(); styleSlider(this);
  });
  $('up-panel-scale').addEventListener('input', function () {
    uiSettings.panelScale = parseInt(this.value, 10) / 100;
    $('up-panel-scale-label').textContent = this.value + '%';
    saveUiSettings(); applyUiSettings(); styleSlider(this);
  });
  $('up-opt-transparent').addEventListener('click', function () { uiSettings.transparent = !uiSettings.transparent; setToggle(this, uiSettings.transparent); saveUiSettings(); applyUiSettings(); });
  $('up-opt-suitborder').addEventListener('click', function () { uiSettings.suitBorder = !uiSettings.suitBorder; setToggle(this, uiSettings.suitBorder); saveUiSettings(); applyUiSettings(); });
  $('up-opt-twocolor').addEventListener('click', function () { uiSettings.twoColor = !uiSettings.twoColor; setToggle(this, uiSettings.twoColor); saveUiSettings(); applyUiSettings(); });

  /* ---------- 布局（4:3 牌桌，参照 battle） ---------- */
  function upNarrow() { return !!window.matchMedia && window.matchMedia('(max-width: 900px)').matches; }
  function handCardWidth() {
    var h = window.innerHeight / 5 * (uiSettings.handScale || 1);
    return Math.round(h / 1.54385);
  }
  function resolveHandCw(target) {
    var n = (game && game.hands && mySeat) ? (game.hands[mySeat] || []).length : 0;
    if (n <= 1) return target;
    var avail = window.innerWidth - 16;
    var need = target + (n - 1) * target * 0.3;
    if (need <= avail) return target;
    return Math.max(48, Math.floor(avail / (1 + 0.3 * (n - 1))));
  }
  function panelContentHeight(p) {
    var total = 0, visible = 0;
    for (var i = 0; i < p.children.length; i++) {
      var c = p.children[i];
      if (c.classList.contains('hidden')) continue;
      total += c.scrollHeight;
      visible++;
    }
    if (visible > 0) total += (visible - 1) * 14;
    return total + 32;
  }
  var gameLayoutEl = document.querySelector('.game-layout');
  function applyUpgradeLayout() {
    var areaEl = document.querySelector('.board-area');
    if (!gameLayoutEl) return;
    if (upNarrow()) {
      gameLayoutEl.style.display = 'flex';
      gameLayoutEl.style.flexDirection = 'column';
      gameLayoutEl.style.alignItems = 'center';
      gameLayoutEl.style.gap = '12px';
      gameLayoutEl.style.padding = '12px';
      gameLayoutEl.style.height = '';
      gameLayoutEl.style.alignContent = '';
      gameLayoutEl.style.gridTemplateColumns = '';
      gameLayoutEl.style.gridTemplateRows = '';
      if (areaEl) { areaEl.style.width = '100%'; areaEl.style.flex = '0 1 auto'; areaEl.style.height = ''; areaEl.style.marginTop = ''; areaEl.style.paddingTop = ''; }
      handEl.classList.toggle('bt-hand-fixed', !!game && !!mySeat);
      if (game && mySeat) {
        handEl.style.setProperty('--bt-hand-c', resolveHandCw(handCardWidth()) + 'px');
        renderHand();
      }
      /* 窄屏：面板底部同样按手牌位置限制，避免重叠 */
      var nPanels = document.querySelectorAll('.game-layout > .panel');
      if (handEl.classList.contains('bt-hand-fixed')) {
        var nHandTop = handEl.getBoundingClientRect().top;
        Array.prototype.forEach.call(nPanels, function (p) {
          var pr = p.getBoundingClientRect();
          p.style.maxHeight = Math.max(120, Math.round(nHandTop - pr.top - 10)) + 'px';
        });
      } else {
        Array.prototype.forEach.call(nPanels, function (p) { p.style.maxHeight = ''; });
      }
      return;
    }
    gameLayoutEl.style.display = '';
    gameLayoutEl.style.flexDirection = '';
    gameLayoutEl.style.alignItems = '';
    gameLayoutEl.style.gap = '';
    gameLayoutEl.style.padding = '';
    var baseTh = Math.min(window.innerWidth * 0.66, window.innerHeight * 0.72, 520) * (uiSettings.tableScale || 1);
    var pw = Math.round(230 * (uiSettings.panelScale || 1));
    var reserveVTop = 140;    /* 顶部娃娃预留 */
    var reserveVBottom = 40;  /* 底部是自己，无娃娃 */
    var maxThH = window.innerHeight - (reserveVTop + reserveVBottom) - 30;
    var th = Math.round(baseTh);
    var extra = 40;
    /* 迭代：按娃娃实际外缘测量中列留白，使面板内边缘距娃娃外缘 10px；
       并在“面板+牌桌总宽超页面宽 / 牌桌高超页面高”时锁定牌桌大小 */
    for (var it = 0; it < 3; it++) {
      var maxThW = Math.floor((window.innerWidth - (pw * 2 + extra * 2 + 72)) * 3 / 4);
      var cand = Math.min(Math.round(baseTh), maxThW, maxThH);
      if (cand < 200) cand = 200;
      th = cand;
      document.body.style.setProperty('--bt-h', th + 'px');
      var twTry = Math.round(th * 4 / 3);
      gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + (twTry + extra * 2) + 'px ' + pw + 'px';
      var tRect = tableEl.getBoundingClientRect();
      var maxExtent = 0;
      [2, 3, 4].forEach(function (s) {
        var d = document.querySelector('.bt-doll[data-seat="' + s + '"]');
        if (d) maxExtent = Math.max(maxExtent, d.getBoundingClientRect().right - tRect.right);
      });
      [6, 7, 8].forEach(function (s) {
        var d = document.querySelector('.bt-doll[data-seat="' + s + '"]');
        if (d) maxExtent = Math.max(maxExtent, tRect.left - d.getBoundingClientRect().left);
      });
      if (maxExtent <= 0) break;
      var newExtra = Math.round(maxExtent + 10 - 18);
      if (Math.abs(newExtra - extra) <= 1) { extra = newExtra; break; }
      extra = newExtra;
    }
    document.body.style.setProperty('--bt-h', th + 'px');
    var tw = Math.round(th * 4 / 3);
    gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + (tw + extra * 2) + 'px ' + pw + 'px';
    var rowH = th + reserveVTop + reserveVBottom;   /* 上下预留娃娃空间（顶/底娃娃在牌桌外） */
    document.querySelectorAll('.game-layout > .panel').forEach(function (p) {
      if (!p.classList.contains('hidden')) rowH = Math.max(rowH, panelContentHeight(p) + 14);
    });
    gameLayoutEl.style.height = '';
    gameLayoutEl.style.alignContent = '';
    var targetHandCw = resolveHandCw(handCardWidth());
    var minHandCw = Math.min(Math.round(targetHandCw / 1.2), targetHandCw);
    var handCw = targetHandCw;
    var handSpace = Math.round(handCw * 1.54385 + 14);
    handEl.classList.remove('bt-hand-fixed');
    gameLayoutEl.style.gridTemplateRows = rowH + 'px ' + handSpace + 'px';
    handEl.style.setProperty('--bt-hand-c', handCw + 'px');
    var guard = 0;
    while (guard < 40) {
      var r = handEl.getBoundingClientRect();
      if (r.bottom <= window.innerHeight - 8 || handCw <= minHandCw) break;
      handCw = Math.max(minHandCw, Math.round(handCw * 0.95));
      handSpace = Math.round(handCw * 1.54385 + 14);
      gameLayoutEl.style.gridTemplateRows = rowH + 'px ' + handSpace + 'px';
      handEl.style.setProperty('--bt-hand-c', handCw + 'px');
      guard++;
    }
    if (handEl.getBoundingClientRect().bottom > window.innerHeight - 8) {
      gameLayoutEl.style.gridTemplateRows = rowH + 'px 0px';
      handEl.classList.add('bt-hand-fixed');
    } else {
      handEl.classList.remove('bt-hand-fixed');
    }
    /* 牌桌始终靠上放置（顶部留出娃娃空间），不随缩放忽上忽下 */
    if (areaEl) { areaEl.style.paddingTop = Math.round(th * 0.15) + 'px'; areaEl.style.marginTop = ''; }
    if (game) { renderHand(); renderCenter(); }
    /* 左右面板统一高度：上边界=牌桌顶部（且不低于页面顶部），下边界=手牌上方 10px */
    var panels = document.querySelectorAll('.game-layout > .panel');
    var handTop = handEl.getBoundingClientRect().top;
    var targetBottom = handTop - 10;
    var layoutTop = gameLayoutEl.getBoundingClientRect().top + (parseFloat(getComputedStyle(gameLayoutEl).paddingTop) || 0);
    var tableTop = tableEl ? tableEl.getBoundingClientRect().top : layoutTop;
    var minTop = Math.max(0, layoutTop, tableTop);   /* 不允许超过页面顶部 */
    var uniH = Math.max(120, Math.round(targetBottom - minTop));
    var z = uiSettings.panelScale || 1;   /* 面板 zoom 会放大盒子，写入尺寸需除以缩放 */
    Array.prototype.forEach.call(panels, function (p) {
      p.style.maxHeight = '';
      p.style.height = '';
      p.style.marginBottom = '0px';
      var rb = p.getBoundingClientRect().bottom;
      p.style.marginBottom = Math.max(0, Math.round((rb - targetBottom) / z)) + 'px';
      p.style.height = Math.max(120, Math.round(uniH / z)) + 'px';
    });
    if (areaEl) areaEl.style.height = '';
  }
  function applyTableLayout() {
    document.documentElement.style.setProperty('--panel-scale', uiSettings.panelScale);
    if (tableEl) tableEl.style.transform = 'none';   /* 尺寸已按缩放写入 --bt-h */
    applyUpgradeLayout();
  }
  window.addEventListener('resize', function () {
    applyTableLayout();
    renderGame();
    if (!$('up-settings-modal').classList.contains('hidden')) styleAllSliders();
  });
  setInterval(function () {
    if (game && game.phase === 'declare') {
      declareBar.textContent = declareBarText();
      renderStatus();
    }
  }, 500);

  /* ---------- 启动 ---------- */
  try {
    var saved = JSON.parse(localStorage.getItem('upCreateSettings'));
    if (saved && (saved.count === 4 || saved.count === 6 || saved.count === 8)) settings.count = saved.count;
  } catch (e) {}
  if (window.Profile && Profile.applyBackground) Profile.applyBackground();
  document.body.classList.add('up-pre-game');
  applyUiSettings();
  syncSettingsUI();
  styleSlider($('up-scale'));
  styleSlider($('up-hand-scale'));
  styleSlider($('up-panel-scale'));
  if (isHost) {
    initHost();
    showCreate();
  } else if (mode === 'join' && joinId) {
    initJoin();
    showModal($('up-wait-modal'));
  } else {
    location.href = 'index.html';
  }

  /* 调试钩子（仅 ?debug=1 时可用，便于无头自测） */
  if (params.get('debug') === '1') {
    window.__up = {
      setPlayers: function (list) { players = list; },
      setCount: function (n) { settings.count = n; },
      startMatch: startMatch,
      doDeclare: doDeclare,
      doDiscard: doDiscard,
      doPlay: doPlay,
      finishRound: finishRound,
      cardEl: cardEl,
      sortHand: sortHand,
      forceTrickEnd: function () { if (game) { game.phase = 'playing'; } },
      state: function () { return { game: game, session: session, players: players, mySeat: mySeat }; }
    };
  }

  /* 房主：渲染循环（状态变更后调用）已由 sendAllState 触发 */
})();
