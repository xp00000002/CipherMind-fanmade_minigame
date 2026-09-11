/* zjh.js - 炸金花（多人联机版） */
(function () {
  'use strict';

  /* 刷新页面：回到主界面，不保留对局/等待状态 */
  if (window.performance && performance.getEntriesByType) {
    var nav = performance.getEntriesByType('navigation');
    if (nav.length && nav[0].type === 'reload') {
      location.replace('index.html');
      return;
    }
  }


  var SEATS = { 2: [1, 5], 3: [1, 4, 6], 4: [1, 3, 5, 7], 5: [1, 3, 4, 6, 7], 6: [1, 2, 4, 5, 6, 8], 7: [1, 2, 3, 4, 6, 7, 8], 8: [1, 2, 3, 4, 5, 6, 7, 8] };
  var RANK_CHAR = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };
  var SUIT_CHAR = { s: '♠', h: '♥', c: '♣', d: '♦' };
  var SUIT_COLOR = { s: '#FFF', h: '#E53D3D', c: '#FFF', d: '#E53D3D' };
  var SUITS = ['s', 'h', 'c', 'd'];
  var RANK_IMG = {
    1: 'texture-card/Card-A.png', 2: 'texture-card/Card-2.png', 3: 'texture-card/Card-3.png',
    4: 'texture-card/Card-4.png', 5: 'texture-card/Card-5.png', 6: 'texture-card/Card-6.png',
    7: 'texture-card/Card-7.png', 8: 'texture-card/Card-8.png', 9: 'texture-card/Card-9.png',
    10: 'texture-card/Card-10.png', 11: 'texture-card/Card-J.png', 12: 'texture-card/Card-Q.png',
    13: 'texture-card/Card-K.png'
  };
  var SUIT_IMG = { s: 'texture-card/Card-Spade.png', h: 'texture-card/Card-Heart.png', c: 'texture-card/Card-Club.png', d: 'texture-card/Card-Diamond.png' };
  var SUIT_IMG_TC = { s: 'texture-card/Card-Spade-Black.png', h: 'texture-card/Card-Heart-Red.png', c: 'texture-card/Card-Club-Black.png', d: 'texture-card/Card-Diamond-Red.png' };
  var PIECE_IMG = {
    w: { p: 'texture/pawn2.png', n: 'texture/knight2.png', b: 'texture/bishop2.png', r: 'texture/rook2.png', q: 'texture/queen2.png', k: 'texture/king2.png' },
    b: { p: 'texture/pawn.png', n: 'texture/knight.png', b: 'texture/bishop.png', r: 'texture/rook.png', q: 'texture/queen.png', k: 'texture/king.png' }
  };

  var params = new URLSearchParams(location.search);
  var mode = params.get('mode');          // 'host' | 'join'
  var joinId = params.get('id');
  var joinStarted = params.get('started') === '1';   /* 从主界面点击已开局房间直接进入 */
  var isHost = mode === 'host';
  var isSpec = params.get('spec') === '1';   /* 观战者 */
  var specViewing = false;                  /* 观战者是否已看牌（本轮内锁定聊天） */
  var specRound = 0;

  var peer = null;
  var conns = [];        // 房主：玩家连接
  var myConn = null;     // 加入方：连接
  var myId = null;
  var selfPeerId = null; // 加入方自己的 peer id（与房主侧 conn.peer 兜底匹配）
  var myName = (Profile.get() || {}).name || 'Player';

  var settings = { allow235: false, timeLimit: false, timeSec: 30, startScore: 1000, dealer: false, showScores: true };
  var players = [];      // 大厅：{id, name, ready, host}
  var game = null;       // 对局：{order:[id], turn, bet, pot, phase, players:[{id,name,score,cards,seen,folded,bet,allin,hasSeen}], timerEnd}
  var myIndex = -1;      // 我在 game.players 中的下标
  var readyState = false;
  var potShown = 0;      // 底池显示值（开局底注动画期间冻结）
  var potFreeze = false;
  var recordsFromResult = false;   /* 从结算弹窗进入查看记录，返回时回到弹窗 */

  var tableEl = document.getElementById('zjh-table');
  var potDisplayEl = document.getElementById('zjh-pot-display');
  var timerDisplayEl = document.getElementById('zjh-timer-display');
  var playerPanelEl = document.getElementById('zjh-player-panel');
  var toastEl = document.getElementById('toast');
  var chatLayerEl = document.getElementById('chat-layer');

  function $(id) { return document.getElementById(id); }
  function showModal(el) { el.classList.remove('hidden'); Profile.adjustBtnHitAreas(); }
  function hideModal(el) { el.classList.add('hidden'); }
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
  /* 必要提示：统一弹窗（confirm-page 样式，参考 chess showPrompt） */
  var confirmAction = null;
  function showPrompt(title, text, yesCb, noCb, yesLabel, noLabel) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yesLabel || '返回主界面';
    $('confirm-no').textContent = noLabel || '继续等待';
    confirmAction = {
      yes: yesCb || function () { location.href = 'index.html'; },
      no: noCb || function () { hideModal($('confirm-modal')); }
    };
    showModal($('confirm-modal'));
  }
  $('confirm-yes').addEventListener('click', function () { if (confirmAction && confirmAction.yes) confirmAction.yes(); });
  $('confirm-no').addEventListener('click', function () { if (confirmAction && confirmAction.no) confirmAction.no(); });
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 联机 ---------- */
  function sendAll(data) {
    for (var i = 0; i < conns.length; i++) {
      if (conns[i].open) conns[i].send(data);
    }
  }
  function sendMy(data) {
    if (myConn && myConn.open) myConn.send(data);
  }
  function hostBroadcast(data) {
    sendAll(data);
    handleHostMessage(null, data);
  }
  function connId(c) { return c ? c.peer : ''; }
  function handleHostMessage(c, data) {
    if (!data || !data.t) return;
    if (data.t === 'join') {
      var nm = String(data.name || '').trim() || 'Player';
      var used = {};
      players.forEach(function (p) { used[p.name] = true; });
      if (used[nm]) { var n = 2; while (used[nm + ' #' + n]) n++; nm = nm + ' #' + n; }
      /* 游戏未开始时加入 = 正常玩家；对局已开始 = 观战者 */
      players.push({ id: connId(c), name: nm, ready: false, host: false, spec: !!game });
      c.send({ t: 'profiles', avatars: avatars });   /* 新成员同步所有自定义头像 */
      hostBroadcastLobby();
      if (game) c.send({ t: 'state', game: game, settings: settings });   /* 对局中：立即下发当前状态 */
      return;
    }
    if (data.t === 'profile') {
      /* 加入方上报自己的头像：存储并转发给其他玩家 */
      avatars[connId(c)] = { avatar: data.avatar, avatarData: data.avatarData };
      sendAll({ t: 'profile', id: connId(c), avatar: data.avatar, avatarData: data.avatarData });
      renderPlayerPanel();
      return;
    }
    if (data.t === 'ready') {
      var p = findPlayer(connId(c));
      if (p) { p.ready = !!data.v; hostBroadcastLobby(); }
      return;
    }
    if (data.t === 'chat') {
      sendAll({ t: 'chat', from: data.from, text: data.text });
      showChatMsg(data);
      return;
    }
    if (data.t === 'action') {
      handleGameAction(connId(c), data.a);
      return;
    }
    if (data.t === 'leave') {
      removePlayer(connId(c), data);
      return;
    }
  }
  var handlersChat = null;
  function findPlayer(id) {
    for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i];
    return null;
  }
  function removePlayer(id, data) {
    players = players.filter(function (p) { return p.id !== id; });
    if (game && game.phase === 'bet') {
      var gp = null;
      for (var i = 0; i < game.players.length; i++) if (game.players[i].id === id) { gp = game.players[i]; break; }
      if (gp && !gp.folded) {
        gp.folded = true;
        if (gp.score > 0) {
          if (data && data.chips) {
            addChips(id, gp.score);
            game.leaverSplit = { id: id, amount: gp.score };
          }
          gp.score = 0;   /* 离开者出局：分数清零，后续轮次不再参与 */
        }
        if (aliveCount() <= 1) {
          /* 玩家离开导致的对局结束：先确认是离开/掉线，而非正常胜负，不算胜利 */
          game.phase = 'over';
          game.result = { winner: null, pot: game.pot, reason: 'leave' };
          game.animating = false;
          game.collect = null;
          broadcastGame();
          showResult({ game: game });
          return;
        }
        if (game.order[game.turnIdx] === id) nextTurn();
        broadcastGame();
        return;
      }
    }
    hostBroadcastLobby();
  }
  function hostBroadcastLobby() {
    sendAll({ t: 'lobby', players: players, settings: settings, me: null, open: openState });
    renderLobby();
  }

  function initHost() {
    peer = new Peer();
    peer.on('open', function (id) {
      myId = id;
      players = [{ id: 'host', name: myName, ready: false, host: true }];
      var p0 = Profile.get() || {};
      avatars['host'] = { avatar: p0.avatar, avatarData: p0.avatarData };
      renderLobby();
      /* 加载完成前已点击"开放"：peer 就绪后补注册，保证实际状态与显示一致 */
      if (openState) registerOpenRoom(myId, true);
    });
    peer.on('connection', function (c) {
      c.on('data', function (data) { handleHostMessage(c, data); });
      c.on('close', function () { removePlayer(connId(c)); });
      conns.push(c);
      c.on('open', function () {
        c.send({ t: 'hello', id: connId(c), spec: !!game });   /* 房主权威下发身份与观战状态 */
      });
    });
    peer.on('error', function () {});
  }
  function initJoin() {
    peer = new Peer();
    peer.on('open', function (id) {
      myId = id;
      selfPeerId = id;
      myConn = peer.connect(joinId, { reliable: true });
      myConn.on('open', function () {
        myConn.send({ t: 'join', name: myName, spec: isSpec });
      });
      myConn.on('data', function (data) { handleJoinMessage(data); });
      myConn.on('close', function () {
        if (game) showPrompt('连接已断开', '房主已离开或连接中断，对局无法继续');
        else location.href = 'index.html';   /* 等待界面房主退出：自动返回主界面 */
      });
    });
    peer.on('disconnected', function () {
      if (game) showPrompt('连接已断开', '与房主的连接中断，对局无法继续');
      else location.href = 'index.html';
    });
    peer.on('error', function (err) {
      showPrompt('连接失败', (err && err.message) || '无法连接到房主');
    });
  }
  function handleJoinMessage(data) {
    if (!data || !data.t) return;
    if (data.t === 'hello') {
      myId = data.id;
      if (data.name) myName = data.name;
      if (data.spec !== undefined) isSpec = !!data.spec;   /* 观战状态以房主判定为准 */
      /* 上报自己的自定义头像 */
      var p0 = Profile.get() || {};
      sendMy({ t: 'profile', avatar: p0.avatar, avatarData: p0.avatarData });
      return;
    }
    if (data.t === 'profiles') {
      if (data.avatars) for (var k in data.avatars) avatars[k] = data.avatars[k];
      renderPlayerPanel();
      return;
    }
    if (data.t === 'profile') {
      avatars[data.id] = { avatar: data.avatar, avatarData: data.avatarData };
      renderPlayerPanel();
      return;
    }
    if (data.t === 'lobby') {
      players = data.players;
      if (data.settings) settings = data.settings;   /* 同步房主开局设置（含坐庄） */
      var me = null;
      for (var i = 0; i < players.length; i++) if (players[i].id === myId || players[i].id === selfPeerId) me = players[i];
      if (me) myName = me.name;
      openState = !!data.open;   /* 同步房主开放状态 */
      renderLobby();
      return;
    }
    if (data.t === 'state') {
      game = data.game;
      if (data.settings) settings = data.settings;
      myIndex = -1;
      for (var i = 0; i < game.players.length; i++) if (game.players[i].id === myId || game.players[i].id === selfPeerId) { myIndex = i; break; }
      hideModal($('zjh-wait-modal'));
      renderGame();
      return;
    }
    if (data.t === 'result') {
      game = data.game;
      for (var i2 = 0; i2 < game.players.length; i2++) if (game.players[i2].id === myId || game.players[i2].id === selfPeerId) { myIndex = i2; break; }
      renderGame();
      showResult(data);
      return;
    }
    if (data.t === 'chat') { showChatMsg(data); return; }
    if (data.t === 'kick') {
      showPrompt('已被移出房间', data.reason || '已被房主移出', function () { location.href = 'index.html'; }, null, '返回主界面', null);
    }
  }

  /* ---------- 大厅 ---------- */
  function renderLobby() {
    var body = $('zjh-wait-body');
    body.innerHTML = '';
    /* 开放按钮：非房主禁用，文字同步房主状态 */
    var openBtn = $('zjh-open-btn');
    openBtn.disabled = !isHost;
    openBtn.textContent = openState ? '已开放' : '开放';
    players.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'zjh-pcard' + ((p.id === myId || p.id === selfPeerId || (p.host && isHost)) ? ' me' : '');
      var name = document.createElement('div');
      name.className = 'zjh-pname';
      name.textContent = p.name;
      card.appendChild(name);
      /* 名字过长时动态缩小字号以装下；可用宽度需避开右侧图标（host/ready）区域 */
      var hasIcon = !!(p.host || p.ready);
      var avail = card.clientWidth * (hasIcon ? (1 - 0.048 - 0.07 - 0.065) : 0.87);
      var fs = parseFloat(getComputedStyle(name).fontSize) || 14;
      var shrinkGuard = 0;
      while (name.scrollWidth > avail && fs > 6 && shrinkGuard < 60) {
        fs -= 0.5;
        name.style.fontSize = fs + 'px';
        shrinkGuard++;
      }
      if (p.host) {
        var img = document.createElement('img');
        img.className = 'zjh-picon';
        img.src = 'texture/host.png';
        card.appendChild(img);
      } else if (p.ready) {
        var img2 = document.createElement('img');
        img2.className = 'zjh-picon';
        img2.src = 'texture/ready.png';
        card.appendChild(img2);
      }
      body.appendChild(card);
    });
    if (isHost) {
      var start = $('btn-zjh-start');
      start.classList.remove('hidden');
      start.disabled = players.filter(function (p) { return !p.spec; }).length < 2;
      $('btn-zjh-ready').classList.add('hidden');
    } else {
      $('btn-zjh-start').classList.add('hidden');
      if (isSpec) {
        $('btn-zjh-ready').classList.add('hidden');   /* 观战者无需准备 */
      } else {
        var rd = $('btn-zjh-ready');
        rd.classList.remove('hidden');
        rd.textContent = readyState ? '取消准备' : '准备';
      }
    }
  }

  /* ---------- 创建设置 ---------- */
  var settingsBackup = null;
  function showCreate() {
    settingsBackup = JSON.parse(JSON.stringify(settings));
    hideModal($('zjh-wait-modal'));
    setToggle($('zjh-opt-235'), settings.allow235);
    setToggle($('zjh-opt-timelimit'), settings.timeLimit);
    setToggle($('zjh-opt-dealer'), settings.dealer);
    setToggle($('zjh-opt-scores'), settings.showScores);
    $('zjh-time-input').value = settings.timeSec;
    $('zjh-score-input').value = settings.startScore;
    syncTimeDisabled();
    showModal($('zjh-create-modal'));
  }
  function syncTimeDisabled() {
    var input = $('zjh-time-input');
    var disabled = !settings.timeLimit;
    input.disabled = disabled;
    input.classList.toggle('disabled', disabled);
  }
  function setToggle(el, on) {
    var img = el.querySelector('img');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (img) img.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function toggleIsOn(el) { return el.getAttribute('aria-pressed') === 'true'; }
  $('zjh-opt-235').addEventListener('click', function () { settings.allow235 = !toggleIsOn(this); setToggle(this, settings.allow235); });
  $('zjh-opt-timelimit').addEventListener('click', function () { settings.timeLimit = !toggleIsOn(this); setToggle(this, settings.timeLimit); syncTimeDisabled(); });
  $('zjh-opt-dealer').addEventListener('click', function () { settings.dealer = !toggleIsOn(this); setToggle(this, settings.dealer); });
  $('zjh-opt-scores').addEventListener('click', function () { settings.showScores = !toggleIsOn(this); setToggle(this, settings.showScores); });
  $('zjh-time-input').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    if (isNaN(v)) return;
    settings.timeSec = Math.max(3, Math.min(300, v));
  });
  $('zjh-score-input').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    if (isNaN(v)) return;
    settings.startScore = Math.max(10, Math.min(10000, v));
  });
  $('btn-zjh-create-back').addEventListener('click', function () {
    settings = JSON.parse(JSON.stringify(settingsBackup));
    hideModal($('zjh-create-modal'));
    showWait();
  });
  $('btn-zjh-create').addEventListener('click', function () {
    hideModal($('zjh-create-modal'));
    if (isHost) {
      if (settings.dealer) {
        players.forEach(function (p) { p.score = settings.startScore * (players.length - 1); });
        /* 庄家分数在开局时按人数结算 */
      }
      if (openState && myId) registerOpenRoom(myId, true);   /* 设置变更后刷新开放房间摘要 */
      hostBroadcastLobby();
    }
    showWait();
  });

  /* ---------- 等待界面 ---------- */
  function showWait() {
    renderLobby();
    showModal($('zjh-wait-modal'));
  }
  $('btn-zjh-wait-back').addEventListener('click', function () {
    if (isHost) {
      if (game) return;   /* 对局中不允许退出大厅 */
      try { peer.destroy(); } catch (e) {}
      location.href = 'index.html';
    } else {
      try { peer.destroy(); } catch (e) {}
      location.href = 'index.html';
    }
  });
  $('btn-zjh-start').addEventListener('click', function () {
    if (!isHost) return;
    var ps = players.filter(function (p) { return !p.spec; });
    if (ps.length < 2) { toast('至少需要两名玩家'); return; }
    for (var i = 0; i < ps.length; i++) if (!ps[i].host && !ps[i].ready) { toast('有玩家未准备'); return; }
    startRound();
  });
  $('btn-zjh-ready').addEventListener('click', function () {
    readyState = !readyState;
    sendMy({ t: 'ready', v: readyState });
    renderLobby();
  });

  /* 房主兜底：定期检查是否只剩房主一人（连接断开事件可能丢失） */
  setInterval(function () {
    if (!isHost || !game || game.phase !== 'bet' || game.animating) return;
    if (players.length <= 1) {
      var anyAlive = false;
      game.players.forEach(function (p) { if (!p.host && !p.folded) anyAlive = true; });
      if (anyAlive) {
        game.players.forEach(function (p) { if (!p.host) { p.folded = true; p.score = 0; } });
        /* 玩家离开导致的结束：不算胜利 */
        game.phase = 'over';
        game.result = { winner: null, pot: game.pot, reason: 'leave' };
        game.animating = false;
        game.collect = null;
        broadcastGame();
        showResult({ game: game });
      }
    }
  }, 1500);
  /* 倒计时刷新（500ms）：牌桌上底池上方显示剩余秒数 */
  setInterval(function () {
    if (!game || !settings.timeLimit || game.phase !== 'bet' || !game.timerDeadline) {
      timerDisplayEl.textContent = '';
      return;
    }
    var rem = Math.max(0, Math.ceil((game.timerDeadline - Date.now()) / 1000));
    timerDisplayEl.textContent = rem;
  }, 500);
  /* ---------- 查看记录 ---------- */
  var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function renderRecords() {
    var body = $('zjh-records-body');
    body.innerHTML = '';
    if (!game || !game.records || !game.records.length) {
      var empty = document.createElement('div');
      empty.className = 'zjh-records-empty';
      empty.textContent = '暂无记录';
      body.appendChild(empty);
      return;
    }
    game.records.forEach(function (rec) {
      var title = document.createElement('p');
      title.className = 'fc-set-label';   /* 同 freecell 设置分区标题：紧贴分割线上方，文字内缩 */
      title.textContent = '第' + (CN_NUM[rec.n - 1] || rec.n) + '轮';
      body.appendChild(title);
      var hr = document.createElement('hr');
      hr.className = 'setting-divider';
      body.appendChild(hr);
      rec.rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'zjh-record-row' + (r.win ? ' win' : '');
        var name = document.createElement('span');
        name.className = 'zjh-record-name';
        name.textContent = r.name + (r.dealer ? '（庄家）' : '') + (r.win ? '（胜）' : '');
        var delta = document.createElement('span');
        delta.className = 'zjh-record-delta' + (r.delta > 0 ? ' pos' : (r.delta < 0 ? ' neg' : ''));
        delta.textContent = (r.delta > 0 ? '+' : '') + r.delta;
        row.appendChild(name);
        row.appendChild(delta);
        var cards = document.createElement('span');
        cards.className = 'zjh-record-cards';
        r.cards.forEach(function (c) {
          var el = zjhCardEl(c, true);
          el.classList.add('sm');
          cards.appendChild(el);
        });
        row.appendChild(cards);
        body.appendChild(row);
      });
    });
  }
  $('btn-records').addEventListener('click', function () {
    renderRecords();
    showModal($('zjh-records-modal'));
  });

  /* ---------- 对局逻辑（房主权威） ---------- */
  function startRound() {
    var pList = players.filter(function (p) { return !p.spec; }).map(function (p) { return { id: p.id, name: p.name, host: p.host }; });
    var order = shuffle(pList.map(function (p) { return p.id; }));
    if (settings.dealer) {
      order = order.filter(function (id) { return id !== 'host'; });
      order.push('host');   /* 庄家（房主）最后 */
    }
    var gamePlayers = pList.map(function (p) {
      return {
        id: p.id, name: p.name, host: p.host,
        score: p.host && settings.dealer ? settings.startScore * (players.length - 1) : settings.startScore,
        cards: [], seen: false, folded: false, bet: 0, allin: false
      };
    });
    var deck = [];
    SUITS.forEach(function (s) { for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r }); });
    shuffle(deck);
    gamePlayers.forEach(function (p) { p.cards = deck.splice(0, 3); });
    game = {
      order: order,
      turnIdx: 0,
      bet: 1,
      pot: 0,
      players: gamePlayers,
      phase: 'bet',
      timerEnd: null,
      records: [],
      _roundStart: {},
      openTarget: null,
      openSelecting: false,
      roundNo: (game && game.roundNo || 0) + 1
    };
    gamePlayers.forEach(function (p) { game._roundStart[p.id] = p.score; });
    potShown = 0;     /* 新一轮：底池先显示 0，动画完成后更新为基础底注 */
    potFreeze = true;
    gamePlayers.forEach(function (p) {
      var pay = Math.min(p.score, 1);
      p.score -= pay;
      p.bet += pay;
      game.pot += pay;
    });
    game.chips = [];
    game.animating = true;   /* 动画期间禁止操作：2s 后执行底注抛出动画 */
    game.leaverSplit = null;
    if (openState && myId) registerOpenRoom(myId, true);   /* 开局后房间标记为已开局 */
    broadcastGame();
    setTimeout(function () {
      game.players.forEach(function (p) { if (!p.folded) addChips(p.id, p.bet); });
      setTimeout(function () {
        game.animating = false;
        potFreeze = false;   /* 动画完成：底池数字更新 */
        potShown = game.pot;
        if (settings.timeLimit) setTurnTimer();
        broadcastGame();
      }, 1400);
      broadcastGame();
    }, 2000);
  }
  function setTurnTimer() {
    if (game.timerEnd) clearTimeout(game.timerEnd);
    var cur = playerById(game.order[game.turnIdx]);
    if (!cur || cur.folded) return;
    if (!settings.timeLimit) { game.timerDeadline = null; return; }
    game.timerDeadline = Date.now() + settings.timeSec * 1000;
    game.timerEnd = setTimeout(function () {
      if (game.animating) { setTurnTimer(); return; }   /* 动画期间顺延 */
      /* 超时：第一次跟注，第二次弃牌 */
      var misses = cur.timeouts || 0;
      if (misses >= 1) {
        cur.timeouts = 0;
        handleGameAction(cur.id, { a: 'fold' });
      } else {
        handleGameAction(cur.id, { a: 'call' });
        cur.timeouts = 1;   /* 保留计数，下次超时弃牌 */
      }
    }, settings.timeSec * 1000);
  }
  function playerById(id) {
    if (!game) return null;
    for (var i = 0; i < game.players.length; i++) if (game.players[i].id === id) return game.players[i];
    return null;
  }
  function currentPlayer() {
    return playerById(game.order[game.turnIdx]);
  }
  function aliveCount() {
    var n = 0;
    game.players.forEach(function (p) { if (!p.folded) n++; });
    return n;
  }
  /* ---------- 筹码系统 ---------- */
  function decomposeChips(amount, max) {
    max = max || 20;
    var chips = [];
    while (amount >= 5 && chips.length < max - 1) { chips.push('w'); amount -= 5; }
    while (amount >= 1 && chips.length < max) { chips.push('b'); amount -= 1; }
    return chips;
  }
  function addChips(playerId, amount) {
    if (!game.chips) game.chips = [];
    if (!game.chipSeq) game.chipSeq = 0;
    var chips = decomposeChips(amount, 20);
    var bx = 0.35 + Math.random() * 0.3;   /* 抛出中心点：牌桌中心 30% 范围 */
    var by = 0.35 + Math.random() * 0.3;
    chips.forEach(function (k) {
      /* 围绕中心点散布；抖动不超过 [0.3, 0.7] 边界，避免中心点靠近边界时贴边堆积 */
      var maxX = Math.min(bx - 0.3, 0.7 - bx);
      var maxY = Math.min(by - 0.3, 0.7 - by);
      game.chips.push({
        id: ++game.chipSeq,
        k: k,
        x: bx + (Math.random() - 0.5) * 2 * Math.min(0.12, maxX),
        y: by + (Math.random() - 0.5) * 2 * Math.min(0.12, maxY),
        p: playerId
      });
    });
    while (game.chips.length > 200) game.chips.shift();   /* 上限200，删除最旧 */
  }
  function seatNumOfPlayer(id) {
    if (!game) return null;
    var n = game.players.length;
    var seatList = SEATS[n];
    var order = game.order.slice();
    var meP = myGamePlayer();
    var selfIdx = order.indexOf(meP ? meP.id : null);
    if (selfIdx >= 0) {
      var rotated = [];
      for (var k = 0; k < n; k++) rotated.push(order[(selfIdx + k) % n]);
      order = rotated;
    }
    var seatByPlayer = {};
    for (var s = 0; s < n; s++) seatByPlayer[order[s]] = seatList[s];
    return seatByPlayer[id] || null;
  }
  function dollCenterOf(id) {
    var seatNum = seatNumOfPlayer(id);
    if (!seatNum) return null;
    var doll = tableEl.querySelector('.zjh-seat-doll[data-seat="' + seatNum + '"]');
    if (!doll) return null;
    var dr = doll.getBoundingClientRect();
    var tr = tableEl.getBoundingClientRect();
    /* 牌桌有 transform scale：getBoundingClientRect 是视觉坐标，换算回本地坐标 */
    var scale = tableEl.clientWidth / (tr.right - tr.left);
    return {
      x: (dr.left - tr.left + dr.width / 2) * scale,
      y: (dr.top - tr.top + dr.height / 2) * scale
    };
  }
  /* JS 驱动动画：严格等速（dur = 距离/速度），快起慢停；fadeAt>0 时筹码与目标距离进入阈值即开始减淡 */
  function animateChip(el, tx, ty, onDone, fadeAt) {
    var sx = parseFloat(el.dataset.sx), sy = parseFloat(el.dataset.sy);
    var dist = Math.sqrt(Math.pow(tx - sx, 2) + Math.pow(ty - sy, 2));
    var dur = Math.max(0.05, dist / 400);
    el.style.transition = 'none';
    var start = performance.now();
    var finished = false;
    var faded = false;
    var frameGuard = 0;
    function step(now) {
      var p = Math.min(1, (now - start) / (dur * 1000));
      var e = 1 - Math.pow(1 - p, 3);   /* easeOutCubic：模拟桌面滑动 */
      var cx = sx + (tx - sx) * e, cy = sy + (ty - sy) * e;
      el.style.transform = 'translate(' + (cx - sx) + 'px,' + (cy - sy) + 'px)';   /* 位移量 = 目标 - 起点 */
      if (!faded && fadeAt) {
        var rem = Math.sqrt(Math.pow(tx - cx, 2) + Math.pow(ty - cy, 2));
        if (rem <= fadeAt) {
          faded = true;
          el.style.transition = 'opacity 0.05s linear';
          el.style.opacity = '0';
        }
      }
      if (p < 1 && frameGuard < 2000) {   /* 帧数兜底，防止异常时无限动画 */
        frameGuard++;
        requestAnimationFrame(step);
      } else if (!finished) {
        finished = true;
        if (onDone) onDone();
      }
    }
    requestAnimationFrame(step);
    setTimeout(function () {
      if (!finished) {
        finished = true;
        el.style.transform = 'translate(' + (tx - sx) + 'px,' + (ty - sy) + 'px)';
        if (onDone) onDone();
      }
    }, dur * 1000 + 100);
  }
  function renderChips() {
    if (!game || !game.chips) return;
    if (game.collect) {
      /* 收集阶段：只飞向目标并按各自到达时间移除，不重建已移除的筹码 */
      var elsC = tableEl.querySelectorAll('.zjh-chip');
      var maxDur = 0;
      elsC.forEach(function (el, idx) {
        if (el.dataset.collectAnim) return;   /* 已开始收集动画：避免重复渲染重启 */
        el.dataset.collectAnim = '1';
        var chip = null;
        for (var ci = 0; ci < game.chips.length; ci++) if (game.chips[ci].id == el.dataset.cid) { chip = game.chips[ci]; break; }
        var t = null;
        if (chip && game.collect.split && chip.p === game.collect.split.id) {
          var ri = idx % game.collect.split.recips.length;
          t = dollCenterOf(game.collect.split.recips[ri]);
        }
        if (!t) t = dollCenterOf(game.collect.winner);
        if (!t) return;
        /* 从筹码当前停留位置（投掷目标）出发，而非原始起点 */
        var sx = parseFloat(el.dataset.x) * tableEl.clientWidth;
        var sy = parseFloat(el.dataset.y) * tableEl.clientHeight;
        el.style.left = sx + 'px';
        el.style.top = sy + 'px';
        el.style.transform = 'none';
        el.dataset.sx = sx;
        el.dataset.sy = sy;
        var dist = Math.sqrt(Math.pow(t.x - sx, 2) + Math.pow(t.y - sy, 2));
        var dur = dist / 400;
        maxDur = Math.max(maxDur, dur);
        animateChip(el, t.x, t.y, function () {
          /* 减淡已随飞行触发，到达后透明清除 */
          setTimeout(function () { el.remove(); }, 60);
        }, 36);   /* 与娃娃重合（约 36px 内）即开始减淡 */
      });
      game.collectMax = maxDur || 1.2;
      return;
    }
    var els = tableEl.querySelectorAll('.zjh-chip');
    /* 按唯一 id 对齐 DOM 与数组：删除已被数组 shift 的最旧筹码，补齐新增筹码 */
    var ids = {};
    game.chips.forEach(function (c) { ids[c.id] = true; });
    var domCount = 0;
    els.forEach(function (el) {
      if (!ids[el.dataset.cid]) el.remove();
      else domCount++;
    });
    var created = 0;
    for (var j = 0; j < game.chips.length && created < game.chips.length - domCount; j++) {
      var c = game.chips[j];
      if (!tableEl.querySelector('.zjh-chip[data-cid="' + c.id + '"]')) {
        var img = document.createElement('img');
        img.className = 'zjh-chip' + (c.k === 'w' ? ' white' : '');
        img.src = c.k === 'w' ? 'texture/whitedot.png' : 'texture/blackdot.png';
        img.dataset.cid = c.id;
        var start = dollCenterOf(c.p) || { x: tableEl.clientWidth / 2, y: tableEl.clientHeight / 2 };
        img.dataset.sx = start.x;
        img.dataset.sy = start.y;
        img.dataset.x = c.x;
        img.dataset.y = c.y;
        img.style.left = start.x + 'px';
        img.style.top = start.y + 'px';
        tableEl.appendChild(img);
        (function (el, c2) {
          setTimeout(function () {
            var tx = c2.x * tableEl.clientWidth, ty = c2.y * tableEl.clientHeight;
            animateChip(el, tx, ty);
          }, 60);
        })(img, c);
        created++;
      }
    }
  }
  function handleGameAction(id, a) {
    if (!game || game.phase !== 'bet') return;
    if (game.animating) { toast('请等待动画完成'); return; }
    var p = null, pi = -1;
    for (var i = 0; i < game.players.length; i++) if (game.players[i].id === id) { p = game.players[i]; pi = i; }
    if (!p || p.folded) return;
    if (game.order[game.turnIdx] !== id) { toast('还没轮到你'); return; }
    p.timeouts = 0;   /* 有效行动后重置超时计数 */
    var act = a && a.a;
    var betChips = function (amt) {
      if (amt <= 0) return;
      addChips(id, amt);
      game.animating = true;
      broadcastGame();
      setTimeout(function () { game.animating = false; if (settings.timeLimit) setTurnTimer(); broadcastGame(); }, 1400);
    };
    if (act === 'see') {
      if (p.seen) { toast('已经看过牌了'); return; }
      p.seen = true;
      var callAmt = Math.min(p.score, game.bet);
      p.score -= callAmt;
      p.bet += callAmt;
      game.pot += callAmt;
      if (p.score <= 0) p.allin = true;
      betChips(callAmt);
      nextTurn();
    } else if (act === 'fold') {
      p.folded = true;
      if (settings.dealer && p.host) {
        /* 庄家弃牌：底池平分给其他未淘汰未弃牌者，余数给牌面最大者 */
        var cands = game.players.filter(function (pp) { return pp.id !== p.id && !pp.folded && pp.score > 0; });
        if (cands.length && game.pot > 0) {
          var each = Math.floor(game.pot / cands.length);
          var rem = game.pot % cands.length;
          if (rem > 0) {
            var bIdx = 0;
            for (var bi = 1; bi < cands.length; bi++) {
              if (compare(handValue(cands[bi].cards), handValue(cands[bIdx].cards)) > 0) bIdx = bi;
            }
            cands[bIdx].score += each + rem;
            cands.forEach(function (pp, ii) { if (ii !== bIdx) pp.score += each; });
          } else {
            cands.forEach(function (pp) { pp.score += each; });
          }
          game.pot = 0;
        }
        endRound('last');
        return;
      }
      if (aliveCount() <= 1) { endRound('last'); return; }
      nextTurn();
    } else if (act === 'call') {
      var amt = Math.min(p.score, game.bet);
      p.score -= amt;
      p.bet += amt;
      game.pot += amt;
      if (p.score <= 0) p.allin = true;
      betChips(amt);
      nextTurn();
    } else if (act === 'raise') {
      var mult = p.seen ? 2 : 1.5;
      var newBet = Math.max(game.bet * mult, game.bet + 1);
      newBet = Math.floor(newBet);
      if (p.score < newBet) { toast('分数不足以加注'); return; }
      var oldBet = p.bet;
      p.score -= newBet;
      p.bet += newBet;
      game.pot += newBet;
      game.bet = Math.max(game.bet, newBet);
      betChips(newBet);
      nextTurn();
    } else if (act === 'open') {
      if (settings.dealer) {
        if (id === 'host') {
          /* 庄家（房主）：进入/退出开牌对象选择模式（选中即开牌） */
          game.openSelecting = !game.openSelecting;
          broadcastGame();
        } else {
          /* 非庄家：只能与庄家开牌——对象是开牌的玩家自己 */
          endRound('open', id);
        }
        return;
      }
      if (aliveCount() !== 2) { toast('仅剩两人时才能开牌'); return; }
      endRound('open');
      return;
    }
    broadcastGame();
  }
  function nextTurn() {
    var alive = [];
    game.order.forEach(function (id) {
      var p = playerById(id);
      if (p && !p.folded) alive.push(id);
    });
    if (alive.length <= 1) { endRound('last'); return; }
    var done = false;
    for (var step = 1; step <= game.order.length && !done; step++) {
      var idx = (game.turnIdx + step) % game.order.length;
      var pp = playerById(game.order[idx]);
      if (pp && !pp.folded) { game.turnIdx = idx; done = true; }
    }
    if (settings.timeLimit) setTurnTimer();
  }
  /* 一轮结束（开牌）后：除非整桌只剩一人有分，否则按原顺序（跳过分数清零者）继续下一轮 */
  function startNextRound() {
    var remaining = game.players.filter(function (p) { return p.score > 0; });
    if (settings.dealer) {
      /* 庄家耗尽分数：其余未被淘汰的玩家获胜 */
      var dealerAlive = false;
      game.players.forEach(function (p) { if (p.host && p.score > 0) dealerAlive = true; });
      if (!dealerAlive) {
        game.phase = 'over';
        game.result = { winner: null, pot: 0, reason: 'dealer-bust' };
        game.animating = false;
        game.collect = null;
        sendAll({ t: 'result', game: game });
        broadcastGame();
        showResult({ game: game });
        return;
      }
    }
    if (remaining.length <= 1) {
      game.phase = 'over';
      game.result = { winner: remaining.length === 1 ? remaining[0].id : null, pot: 0 };
      game.animating = false;
      game.collect = null;
      sendAll({ t: 'result', game: game });
      broadcastGame();
      showResult({ game: game });
      return;
    }
    game.players.forEach(function (p) {
      p.cards = [];
      p.seen = false;
      p.bet = 0;
      p.allin = false;
      p.folded = p.score <= 0;   /* 分数清零者淘汰，回合跳过 */
    });
    game.openTarget = null;
    game.openSelecting = false;
    game.hoverTarget = null;
    var deck = [];
    SUITS.forEach(function (s) { for (var r = 1; r <= 13; r++) deck.push({ suit: s, rank: r }); });
    shuffle(deck);
    game.players.forEach(function (p) {
      if (!p.folded) p.cards = deck.splice(0, 3);
    });
    game.turnIdx = 0;
    game.roundNo = (game.roundNo || 0) + 1;
    /* 新一轮回合从第一个未被淘汰的玩家开始 */
    for (var ti = 0; ti < game.order.length; ti++) {
      var pp = playerById(game.order[ti]);
      if (pp && !pp.folded) { game.turnIdx = ti; break; }
    }
    game.bet = 1;
    game._roundStart = {};
    game.players.forEach(function (p) { game._roundStart[p.id] = p.score; });
    potShown = 0;     /* 新一轮：底池先显示 0，动画完成后更新为基础底注 */
    potFreeze = true;
    game.pot = 0;
    game.phase = 'bet';
    game.result = null;
    game.leaverSplit = null;
    game.players.forEach(function (p) {
      if (!p.folded) {
        var pay = Math.min(p.score, 1);
        p.score -= pay;
        p.bet += pay;
        game.pot += pay;
      }
    });
    game.chips = [];
    game.animating = true;
    broadcastGame();
    setTimeout(function () {
      game.players.forEach(function (p) { if (!p.folded) addChips(p.id, p.bet); });
      setTimeout(function () {
        game.animating = false;
        potFreeze = false;   /* 动画完成：底池数字更新 */
        potShown = game.pot;
        if (settings.timeLimit) setTurnTimer();
        broadcastGame();
      }, 1400);
      broadcastGame();
    }, 700);
  }
  function endRound(type, targetId) {
    if (game.timerEnd) clearTimeout(game.timerEnd);
    var alive = [];
    game.players.forEach(function (p) { if (!p.folded) alive.push(p); });
    var winner = null;
    if (settings.dealer && type === 'open' && targetId) {
      /* 庄家模式开牌：庄家 vs 开牌对象，平局庄家赢 */
      var dealer = null, target = null;
      game.players.forEach(function (p) {
        if (p.host) dealer = p;
        if (p.id === targetId) target = p;
      });
      if (dealer && target && !dealer.folded && !target.folded) {
        var dv = handValue(dealer.cards), tv = handValue(target.cards);
        winner = compare(dv, tv) >= 0 ? dealer : target;
      }
    }
    if (!winner) {
      if (alive.length === 1) winner = alive[0];
      else {
        var best = null;
        alive.forEach(function (p) {
          var v = handValue(p.cards);
          if (!best || compare(v, best.v) > 0 || (settings.allow235 && is235(p.cards) && best.type === 6)) best = { p: p, v: v, c: p.cards };
        });
        winner = best.p;
      }
    }
    /* 认输者剩余筹码平分给其余有分玩家 */
    var split = null;
    if (game.leaverSplit) {
      var ls = game.leaverSplit;
      var recips = game.players.filter(function (p) { return p.id !== ls.id && p.score > 0 && !p.folded; });
      if (recips.length) {
        var each = Math.floor(ls.amount / recips.length);
        var rem = ls.amount % recips.length;
        split = { id: ls.id, recips: [], each: each, rem: rem };
        recips.forEach(function (p, i) {
          var amt = each + (i < rem ? 1 : 0);
          if (amt > 0) { p.score += amt; split.recips.push(p.id); }
        });
        if (!split.recips.length) split = null;
      }
      game.leaverSplit = null;
    }
    winner.score += game.pot;
    /* 记录本轮：每人分数变化 + 手牌 + 胜负 */
    if (!game.records) game.records = [];
    var rec = { n: game.records.length + 1, rows: [] };
    game.players.forEach(function (p) {
      var start = game._roundStart ? (game._roundStart[p.id] || 0) : 0;
      rec.rows.push({ name: p.name, dealer: settings.dealer && p.host, delta: p.score - start, cards: p.cards.slice(), win: p.id === winner.id });
    });
    game.records.push(rec);
    game.phase = 'over';
    game.result = { winner: winner.id, pot: game.pot };
    game.animating = true;
    game.collect = { winner: winner.id, split: split };
    broadcastGame();
    /* 判定对局是否结束 */
    var remain = game.players.filter(function (p) { return p.score > 0; });
    var gameOver = false;
    if (settings.dealer) {
      var dAlive = false;
      game.players.forEach(function (p) { if (p.host && p.score > 0) dAlive = true; });
      if (!dAlive) {
        gameOver = true;
        game.result = { winner: null, pot: 0, reason: 'dealer-bust' };
      } else if (remain.length <= 1) gameOver = true;
    } else if (remain.length <= 1) gameOver = true;
    var maxDur = game.collectMax || 1.2;
    if (gameOver) {
      /* 收钱动画后直接结算弹窗 */
      setTimeout(function () {
        game.chips = [];
        game.collect = null;
        game.collectMax = null;
        game.animating = false;
        sendAll({ t: 'result', game: game });
        broadcastGame();
        showResult({ game: game });
      }, maxDur * 1000 + 250);
      return;
    }
    /* 每枚筹码到达玩家时即清除（renderChips 内按各自飞行时长移除）；
       全部到达 1s 后执行底注抛出动画 → 下一轮 */
    setTimeout(function () {
      game.chips = [];
      game.collect = null;
      game.collectMax = null;
      broadcastGame();
      setTimeout(function () {
        if (game && game.phase === 'over') startNextRound();
      }, 1000);
    }, maxDur * 1000 + 250);
  }
  function is235(cards) {
    var r = cards.map(function (c) { return c.rank; }).sort(function (a, b) { return a - b; });
    var sameSuit = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
    return r[0] === 2 && r[1] === 3 && r[2] === 5 && !sameSuit;
  }
  function rankVal(r) { return r === 1 ? 14 : r; }   /* A 最大（比 K 大） */
  function handValue(cards) {
    var r = cards.map(function (c) { return rankVal(c.rank); }).sort(function (a, b) { return a - b; });
    var sameSuit = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
    var straight = r[1] === r[0] + 1 && r[2] === r[1] + 1;
    var triple = r[0] === r[1] && r[1] === r[2];
    var pair = r[0] === r[1] || r[1] === r[2];
    if (triple) return { type: 6, val: r[0] };
    if (straight && sameSuit) return { type: 5, val: r[2] };
    if (sameSuit) return { type: 4, val: r[2] * 100 + r[1] * 10 + r[0] };
    if (straight) return { type: 3, val: r[2] };
    if (pair) {
      var pv = r[0] === r[1] ? r[0] : r[1];
      var k = r[0] === r[1] ? r[2] : r[0];
      return { type: 2, val: pv * 100 + k };
    }
    return { type: 1, val: r[2] * 100 + r[1] * 10 + r[0] };
  }
  function compare(a, b) {
    if (a.type !== b.type) return a.type - b.type;
    return a.val - b.val;
  }
  function broadcastGame() {
    hideModal($('zjh-wait-modal'));
    sendAll({ t: 'state', game: game, settings: settings });
    if (isHost) {
      myIndex = -1;
      for (var i = 0; i < game.players.length; i++) if (game.players[i].id === 'host') { myIndex = i; break; }
      renderGame();
    }
  }

  /* ---------- 渲染 ---------- */
  function renderGame() {
    if (!game) return;
    /* 观战者：新一轮开始时自动取消看牌 */
    if (isSpec && game.roundNo !== specRound) {
      specRound = game.roundNo;
      specViewing = false;
    }
    tableEl.classList.toggle('zjh-selecting', !!game.openSelecting);
    renderSeats();
    renderPlayerPanel();
    renderControls();
    renderInfo();
    renderChips();
  }
  function myGamePlayer() {
    if (!game) return null;
    for (var i = 0; i < game.players.length; i++) {
      if (game.players[i].id === myId || game.players[i].id === selfPeerId || (game.players[i].host && isHost)) return game.players[i];
    }
    return null;
  }
  /* ---------- 设置 ---------- */
  var zjhSettings = { twoColor: false, transparent: true, suitBorder: false, tableScale: 1, panelScale: 1 };
  function loadZjhSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('zjhSettings'));
      if (s) for (var k in zjhSettings) if (s[k] !== undefined) zjhSettings[k] = s[k];
    } catch (e) {}
  }
  function saveZjhSettings() {
    try { localStorage.setItem('zjhSettings', JSON.stringify(zjhSettings)); } catch (e) {}
  }
  function applyCardSettings() {
    var page = document.querySelector('.game-layout');
    if (!page) return;
    page.classList.toggle('fc-solid-cards', !zjhSettings.transparent);
    page.classList.toggle('fc-suit-border', zjhSettings.suitBorder && !zjhSettings.twoColor);
    page.classList.toggle('fc-two-color-border', zjhSettings.suitBorder && zjhSettings.twoColor);
  }
  function zjhCardEl(c, faceUp) {
    var cd = document.createElement('div');
    cd.className = 'zjh-card' + (faceUp ? '' : ' back');
    if (faceUp) {
      cd.dataset.suit = c.suit;
      var r = document.createElement('img');
      r.className = 'zjh-r';
      r.src = RANK_IMG[c.rank];
      r.alt = '';
      r.draggable = false;
      var rb = document.createElement('img');
      rb.className = 'zjh-rb';
      rb.src = RANK_IMG[c.rank];
      rb.alt = '';
      rb.draggable = false;
      var s = document.createElement('img');
      s.className = 'zjh-s';
      s.src = (zjhSettings.twoColor ? SUIT_IMG_TC : SUIT_IMG)[c.suit];
      s.alt = '';
      s.draggable = false;
      cd.appendChild(r);
      cd.appendChild(rb);
      cd.appendChild(s);
    }
    return cd;
  }

  function renderSeats() {
    var n = game.players.length;
    var seatList = SEATS[n];
    var order = game.order.slice();
    var meP = myGamePlayer();
    var selfIdx = order.indexOf(meP ? meP.id : null);
    if (selfIdx >= 0) {
      var rotated = [];
      for (var k = 0; k < n; k++) rotated.push(order[(selfIdx + k) % n]);
      order = rotated;
    }
    var seatByPlayer = {};
    for (var s = 0; s < n; s++) seatByPlayer[order[s]] = seatList[s];
    tableEl.querySelectorAll('.zjh-seat').forEach(function (seat) {
      seat.innerHTML = '';
      seat.classList.remove('active', 'folded', 'allin');
      var seatNum = parseInt(seat.dataset.seat, 10);
      var pid = null;
      for (var id in seatByPlayer) if (seatByPlayer[id] === seatNum) { pid = id; break; }
      if (!pid) return;
      var gp = null;
      for (var i = 0; i < game.players.length; i++) if (game.players[i].id === pid) gp = game.players[i];
      if (gp.folded) seat.classList.add('folded');
      if (gp.allin) seat.classList.add('allin');
      var me = pid === myId || pid === selfPeerId || (gp.host && isHost);
      if (me) seat.classList.add('me');
      var cardsEl = document.createElement('div');
      cardsEl.className = 'zjh-seat-cards';
      /* 看牌后只有自己能看到自己的牌；开牌（phase=over）后全部翻开；观战者看牌后可见全部 */
      var specView = isSpec && specViewing;
      var showCards = game.phase === 'over' || specView || (me && gp.seen);
      if (showCards && gp.cards && gp.cards.length) {
        gp.cards.forEach(function (c) {
          cardsEl.appendChild(zjhCardEl(c, true));
        });
      } else {
        for (var j = 0; j < 3; j++) cardsEl.appendChild(zjhCardEl(null, false));
      }
      seat.appendChild(cardsEl);
    });
    /* 座位外侧装饰娃娃：图片中心点落在牌桌对角线或中轴线上；未轮到行动的玩家用 -dark 版本 */
    tableEl.querySelectorAll('.zjh-seat-doll').forEach(function (el) { el.remove(); });
    var curTurn = game.order[game.turnIdx];
    for (var pid2 in seatByPlayer) {
      var doll = null;
      if (seatByPlayer[pid2] === 2 || seatByPlayer[pid2] === 3 || seatByPlayer[pid2] === 4) doll = 'texture/leftdoll.png';
      else if (seatByPlayer[pid2] === 6 || seatByPlayer[pid2] === 7 || seatByPlayer[pid2] === 8) doll = 'texture/rightdoll.png';
      else doll = 'texture/middledoll.png';
      if (game.openTarget === pid2) doll = doll.replace('-dark.png', '.png');   /* 开牌对象娃娃高亮（非 dark） */
      else if (game.phase !== 'bet' || pid2 !== curTurn) doll = doll.replace('.png', '-dark.png');
      if (settings.dealer && pid2 === 'host') {
        /* 庄家：不使用娃娃，原位置改用皇后（轮到时亮色 / 未轮到暗色） */
        var qimg = document.createElement('img');
        qimg.className = 'zjh-seat-doll zjh-queen';
        qimg.dataset.seat = String(seatByPlayer[pid2]);
        if (game.openTarget === pid2) qimg.src = 'texture/queen.png';
        else if (game.phase !== 'bet' || pid2 !== curTurn) qimg.src = 'texture/darkqueen.png';
        else qimg.src = 'texture/queen.png';
        qimg.alt = '';
        tableEl.appendChild(qimg);
      } else {
        var dimg = document.createElement('img');
        dimg.className = 'zjh-seat-doll';
        dimg.dataset.seat = String(seatByPlayer[pid2]);
        dimg.src = doll;
        dimg.alt = '';
        tableEl.appendChild(dimg);
      }
      /* 娃娃阴影：亮度 0 的复制图，向右下偏移 12.5% 娃娃宽（51px），垫在原娃娃下方 */
      var dollReal = qimg || dimg;
      var dollShadow = dollReal.cloneNode(false);
      dollShadow.className = dollReal.className + ' shadow';
      dollShadow.removeAttribute('id');
      tableEl.appendChild(dollShadow);
      tableEl.appendChild(dollReal);
      if (isHost && settings.dealer && game.openSelecting) {
        var gp2 = null;
        for (var gi = 0; gi < game.players.length; gi++) if (game.players[gi].id === pid2) { gp2 = game.players[gi]; break; }
        if (gp2 && !gp2.folded && pid2 !== 'host' && gp2.score > 0) {
          dimg.style.cursor = 'pointer';
          (function (dollId) {
            dimg.addEventListener('click', function () {
              game.openTarget = dollId;
              game.openSelecting = false;
              endRound('open', dollId);   /* 选中即开牌 */
            });
            dimg.addEventListener('mouseenter', function () { hoverTarget(dollId); });
            dimg.addEventListener('mouseleave', function () { hoverTarget(null); });
          })(pid2);
        }
      }
    }
  }
  /* 开牌对象选择：悬停时娃娃与右侧面板同步高亮提示 */
  function hoverTarget(id) {
    game.hoverTarget = id;
    playerPanelEl.querySelectorAll('.player-card').forEach(function (el) {
      el.classList.toggle('hover-target', !!id && el.dataset.pid === id);
    });
    tableEl.querySelectorAll('.zjh-seat-doll').forEach(function (el) {
      el.classList.toggle('hover-target', false);
    });
    if (id) {
      var sn = seatNumOfPlayer(id);
      if (sn) {
        var d = tableEl.querySelector('.zjh-seat-doll[data-seat="' + sn + '"]');
        if (d) d.classList.add('hover-target');
      }
    }
  }
  /* 玩家头像 HTML：自己用 Profile，其余用联机交换的头像，都没有则显示符号 */
  function zjhAvatarHtml(p, glyph) {
    var prof = null;
    if (p.host && isHost) prof = Profile.get();
    else if (p.id === myId || p.id === selfPeerId) prof = Profile.get();
    else prof = avatars[p.id] || null;
    if (prof && prof.avatar === 'custom' && prof.avatarData) {
      var smooth = prof.avatarSmooth !== false;   /* 线性插值开关 */
      return '<img class="avatar-img' + (smooth ? ' smooth' : '') + '" src="' + prof.avatarData + '">';
    }
    if (prof && prof.avatar && prof.avatar.indexOf('piece:') === 0) {
      var parts = prof.avatar.slice(6).split(':');
      var color = parts[0] === 'auto' ? 'w' : parts[0];
      return '<img class="avatar-img piece" src="' + PIECE_IMG[color][parts[1]] + '">';
    }
    return '<span class="avatar-glyph">' + (glyph || '') + '</span>';
  }
  function renderPlayerPanel() {
    playerPanelEl.innerHTML = '';
    if (!game) return;
    var me = myGamePlayer();
    var glyphs = ['♠', '♥', '♣', '♦', '★', '▲', '●', '◆'];
    game.players.forEach(function (p, idx) {
      var isMe = p.id === (me ? me.id : '');
      var isOpenTarget = game.openTarget === p.id;
      var selectable = isHost && settings.dealer && game.openSelecting && !p.folded && p.id !== 'host' && p.score > 0;
      var card = document.createElement('div');
      card.className = 'player-card' + (p.id === game.order[game.turnIdx] && game.phase === 'bet' ? ' turn' : '') + (p.folded ? ' zjh-folded' : '') + (isOpenTarget ? ' open-target' : '') + (selectable ? ' selectable' : '');
      if (selectable) {
        card.dataset.pid = p.id;
        card.addEventListener('click', function () {
          game.openTarget = p.id;
          game.openSelecting = false;
          endRound('open', p.id);   /* 选中即开牌 */
        });
        card.addEventListener('mouseenter', function () { hoverTarget(p.id); });
        card.addEventListener('mouseleave', function () { hoverTarget(null); });
      }
      var av = document.createElement('div');
      av.className = 'avatar';
      av.innerHTML = zjhAvatarHtml(p, glyphs[idx % glyphs.length]) + '<img class="avatar-border" src="texture/avatarboarder.png" alt="">';
      card.appendChild(av);
      var info = document.createElement('div');
      info.className = 'pinfo';
      var nm = document.createElement('div');
      nm.className = 'pname';
      nm.textContent = p.name + (settings.dealer && p.host ? '（庄家）' : '') + (isMe ? '（我）' : '');
      var sc = document.createElement('div');
      sc.className = 'prole';
      if (settings.showScores || isMe) {
        var dot = document.createElement('img');
        dot.className = 'zjh-score-dot';
        dot.src = 'texture/blackdot.png';
        dot.alt = '';
        sc.appendChild(dot);
        sc.appendChild(document.createTextNode(' ' + p.score));
      } else {
        sc.textContent = '分数 ?';
      }
      info.appendChild(nm);
      info.appendChild(sc);
      card.appendChild(info);
      playerPanelEl.appendChild(card);
    });
  }
  function renderControls() {
    var me = myGamePlayer();
    var myTurn = game && game.phase === 'bet' && !game.animating && game.order[game.turnIdx] === (me ? me.id : null);
    $('btn-see').classList.toggle('hidden', !myTurn || (me && me.seen));
    $('btn-fold').classList.toggle('hidden', !myTurn);
    $('btn-call').classList.toggle('hidden', !myTurn);
    $('btn-raise').classList.toggle('hidden', !myTurn || (me && me.score < game.bet));
    /* 庄家模式：开牌不受"仅剩两人"限制，但需轮到自己 */
    var canOpen = settings.dealer ? true : aliveCount() === 2;
    $('btn-open').classList.toggle('hidden', !myTurn || !canOpen);
    if (myTurn && me) {
      $('btn-call').textContent = me.score <= game.bet ? '跟注（全押）' : '跟注';
      $('btn-raise').textContent = '加注';
    }
    $('btn-exit').textContent = game.phase === 'over' ? '退出房间' : '认输并退出';
    /* 观战者：看牌按钮（点击后变暗、文案"已看牌"；看牌后锁定聊天，本轮内不可关闭） */
    $('btn-spec-see').classList.toggle('hidden', !isSpec || !game);
    $('btn-spec-see').textContent = specViewing ? '已看牌' : '看牌';
    $('btn-spec-see').classList.toggle('dim', specViewing);
    $('btn-spec-see').classList.toggle('sel', false);
  }
  function renderInfo() {
    if (!game) return;
    /* 开局底注动画期间冻结旧底池数字，动画完成后再更新 */
    var val = potFreeze ? potShown : game.pot;
    potDisplayEl.textContent = val + ' | ' + game.bet;
  }
  function showResult(data) {
    var text = $('zjh-result-text');
    var g = data.game;
    var winner = null;
    for (var i = 0; i < g.players.length; i++) if (g.players[i].id === data.game.result.winner) winner = g.players[i];
    var me = null;
    for (var j = 0; j < g.players.length; j++) if (g.players[j].id === myId || g.players[j].id === selfPeerId || (g.players[j].host && isHost)) me = g.players[j];
    var textContent = '对局结束';
    if (winner) textContent = (me && winner.id === me.id) ? '你赢了' : '你输了';
    else if (g.result && g.result.reason === 'leave') textContent = '其他玩家已离开，对局结束';
    else if (g.result && g.result.reason === 'dealer-bust') textContent = '庄家分数耗尽，其余未淘汰玩家获胜';
    text.textContent = textContent;
    showModal($('zjh-result-modal'));
    renderGame();
  }
  $('btn-zjh-result-home').addEventListener('click', function () { location.href = 'index.html'; });
  /* 查看记录：从结算弹窗进入，返回时回到弹窗 */
  $('btn-zjh-result-records').addEventListener('click', function () {
    hideModal($('zjh-result-modal'));
    renderRecords();
    showModal($('zjh-records-modal'));
    recordsFromResult = true;
  });
  $('btn-zjh-records-close').addEventListener('click', function () {
    hideModal($('zjh-records-modal'));
    if (recordsFromResult) {
      /* 游戏结束时从结算弹窗进入：返回弹窗 */
      recordsFromResult = false;
      showModal($('zjh-result-modal'));
    }
  });

  /* ---------- 操作按钮 ---------- */
  function myAction(a) {
    if (isHost) handleGameAction('host', { a: a });
    else sendMy({ t: 'action', a: { a: a } });
  }
  $('btn-see').addEventListener('click', function () { myAction('see'); });
  $('btn-fold').addEventListener('click', function () { myAction('fold'); });
  $('btn-call').addEventListener('click', function () { myAction('call'); });
  $('btn-raise').addEventListener('click', function () { myAction('raise'); });
  $('btn-open').addEventListener('click', function () { myAction('open'); });
  $('btn-exit').addEventListener('click', function () {
    if (isHost && game && game.phase !== 'over') { toast('对局进行中不能退出'); return; }
    if (!isHost && game && game.phase === 'bet' && !isSpec) {
      /* 认输并退出：通知房主抛筹码并平分剩余 */
      try { myConn.send({ t: 'leave', chips: true }); } catch (e) {}
    }
    try { peer.destroy(); } catch (e) {}
    location.href = 'index.html';
  });

  /* ---------- 聊天（预设消息） ---------- */
  function showChatMsg(data) {
    var msg = document.createElement('div');
    msg.className = 'chat-msg show';
    var t = document.createElement('span');
    t.className = 'chat-text';
    t.textContent = data.from + ' 说：' + data.text;
    var bar = document.createElement('div');
    bar.className = 'chat-bar';
    msg.appendChild(t);
    msg.appendChild(bar);
    chatLayerEl.appendChild(msg);
    setTimeout(function () {
      msg.classList.add('fade');
      setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 300);
    }, 7000);
  }
  var chatPath = [];         /* 预设消息路径：['me'|'other:<id>'|'dealer'|'spec', 二级, 三级] */
  var chatSel = {};          /* 接收人（左侧多选）：id -> true */
  var CHAT_ME = ['有', '有好牌', '没好牌', '要加注', '要跟注', '要弃牌', '要开牌', '筹码还有很多', '筹码快没了'];
  var CHAT_ME_HAS = ['对子', '同花', '顺子', '同花顺', '豹子'];
  var CHAT_OTHER = ['快行动', '快加注', '快跟注', '快弃牌', '快开牌'];
  var CHAT_SPEC = ['不要说话', '看我操作'];
  var chatOpEls = [0, 1, 2, 3, 4].map(function (i) { return $('zjh-chat-op-' + i); });
  function makeChatOpt(label, selected, cb) {
    var b = document.createElement('button');
    b.className = 'chat-option' + (selected ? ' sel' : '');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', cb);
    return b;
  }
  /* 左侧：接收人（除我之外的所有玩家名称，多选） */
  function renderChatTargets() {
    var el = $('chat-players');
    el.innerHTML = '';
    var me = myGamePlayer();
    var list = [];
    game.players.forEach(function (p) { if (p.id !== (me ? me.id : null)) list.push(p); });
    list.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'chat-player' + (chatSel[p.id] ? ' sel' : '');
      b.type = 'button';
      b.textContent = p.name + (p.host ? '（庄家）' : '');
      b.addEventListener('click', function () {
        chatSel[p.id] = !chatSel[p.id];
        b.classList.toggle('sel', chatSel[p.id]);
      });
      el.appendChild(b);
    });
  }
  /* 右上角：预设回复（一级：我/玩家/庄家/观战者） */
  function renderChatPreset() {
    for (var i = 0; i < 5; i++) chatOpEls[i].innerHTML = '';
    var sel1 = chatPath[0] || '';
    var level1 = [{ key: 'me', label: '我' }];
    var me = myGamePlayer();
    game.players.forEach(function (p) { if (p.id !== (me ? me.id : null)) level1.push({ key: 'other:' + p.id, label: p.name + (p.host ? '（庄家）' : '') }); });
    if (settings.dealer) level1.push({ key: 'dealer', label: '庄家' });
    level1.push({ key: 'spec', label: '观战者' });
    level1.forEach(function (t) {
      chatOpEls[0].appendChild(makeChatOpt(t.label, sel1 === t.key, function () {
        chatPath = sel1 === t.key ? [] : [t.key];
        renderChatPreset();
      }));
    });
    if (!chatPath.length) return;
    /* 二级 */
    var sel2 = chatPath[1] || '';
    /* 观战者预设："不要说话"人人可选，"看我操作"仅玩家可选 */
    var opts2 = chatPath[0] === 'me' ? CHAT_ME : (chatPath[0] === 'spec' ? (isSpec ? CHAT_SPEC.slice(0, 1) : CHAT_SPEC) : CHAT_OTHER);
    opts2.forEach(function (label) {
      chatOpEls[1].appendChild(makeChatOpt(label, sel2 === label, function () {
        chatPath = sel2 === label ? chatPath.slice(0, 1) : [chatPath[0], label];
        renderChatPreset();
      }));
    });
    if (chatPath[0] === 'spec') return;
    if (chatPath.length < 2) return;
    /* 三级：我 → 有 → 牌型 */
    if (chatPath[0] === 'me' && chatPath[1] === '有') {
      var sel3 = chatPath[2] || '';
      CHAT_ME_HAS.forEach(function (label) {
        chatOpEls[2].appendChild(makeChatOpt(label, sel3 === label, function () {
          chatPath = sel3 === label ? chatPath.slice(0, 2) : chatPath.slice(0, 2).concat(label);
          renderChatPreset();
        }));
      });
    }
  }
  function chatLevel1Label(key) {
    if (key === 'me') return '我';
    if (key === 'dealer') return '庄家';
    if (key === 'spec') return '观战者';
    var tp = null;
    game.players.forEach(function (p) { if (p.id === key.slice(6)) tp = p; });
    return tp ? tp.name : '玩家';
  }
  function openChat() {
    if (!game) return;
    chatPath = [];
    chatSel = {};
    $('chat-input').value = '';
    renderChatTargets();
    renderChatPreset();
    showModal($('chat-modal'));
    $('chat-input').focus();
  }
  $('btn-spec-see').addEventListener('click', function () {
    if (!isSpec || specViewing) return;   /* 看牌后不可关闭 */
    specViewing = true;
    renderGame();
    toast('本轮内已锁定聊天');
  });
  $('btn-chat').addEventListener('click', function () {
    if (isSpec && specViewing) { toast('看牌后本轮内不能发送消息'); return; }
    openChat();
  });
  $('chat-cancel').addEventListener('click', function () { hideModal($('chat-modal')); });
  $('chat-send').addEventListener('click', function () {
    var text = $('chat-input').value.trim();
    if (!text && chatPath.length) text = chatLevel1Label(chatPath[0]) + ' ' + chatPath.slice(1).join(' ');
    if (!text) return;
    var from = myName;
    if (isHost) {
      sendAll({ t: 'chat', from: from, text: text });
      showChatMsg({ from: from, text: text });
    } else {
      sendMy({ t: 'chat', from: from, text: text });
      /* 房主广播会回显，不再本地显示，避免重复 */
    }
    hideModal($('chat-modal'));
  });

  /* ---------- 平板/手机端布局重组（参考 chess arrangePanels） ---------- */
  function arrangePanels() {
    var tablet = !!window.matchMedia && window.matchMedia('(min-width: 561px) and (max-width: 900px)').matches;
    var mobile = !!window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
    var left = document.querySelector('.panel.left');
    var right = document.querySelector('.panel.right');
    var top = document.querySelector('.top-panel');
    var bottom = document.querySelector('.bottom-panel');
    var controls = document.getElementById('zjh-controls');
    var plist = document.getElementById('zjh-player-panel');
    if (!left || !right || !top || !bottom || !controls || !plist) return;
    if (tablet) {
      /* 平板：玩家卡片 → 上方面板（一行两个）；选项 → 下方面板（一行两个） */
      top.appendChild(plist);
      bottom.appendChild(controls);
    } else if (mobile) {
      /* 手机：选项 → 上方面板（堆叠）；玩家卡片 → 下方面板（一行一个） */
      top.appendChild(controls);
      bottom.appendChild(plist);
    } else {
      left.appendChild(controls);
      right.appendChild(plist);
    }
    if (typeof applyZjhLayout === 'function') applyZjhLayout();
  }
  /* ---------- 设置 ---------- */
  var gameLayoutEl = document.querySelector('.game-layout');
  $('btn-settings').addEventListener('click', function () {
    $('zjh-scale').value = Math.round((zjhSettings.tableScale || 1) * 100);
    $('zjh-scale-label').textContent = Math.round((zjhSettings.tableScale || 1) * 100) + '%';
    $('zjh-panel-scale').value = Math.round((zjhSettings.panelScale || 1) * 100);
    $('zjh-panel-scale-label').textContent = Math.round((zjhSettings.panelScale || 1) * 100) + '%';
    setToggle($('zjh-opt-transparent'), zjhSettings.transparent);
    setToggle($('zjh-opt-suitborder'), zjhSettings.suitBorder);
    setToggle($('zjh-opt-twocolor'), zjhSettings.twoColor);
    showModal($('settings-modal'));
    styleSlider();
  });
  $('zjh-opt-transparent').addEventListener('click', function () { zjhSettings.transparent = !toggleIsOn(this); setToggle(this, zjhSettings.transparent); applyCardSettings(); saveZjhSettings(); });
  $('zjh-opt-suitborder').addEventListener('click', function () { zjhSettings.suitBorder = !toggleIsOn(this); setToggle(this, zjhSettings.suitBorder); applyCardSettings(); saveZjhSettings(); });
  $('zjh-opt-twocolor').addEventListener('click', function () { zjhSettings.twoColor = !toggleIsOn(this); setToggle(this, zjhSettings.twoColor); applyCardSettings(); renderGame(); saveZjhSettings(); });
  /* 滑动条样式（同 chess）：轨道 62:1（宽:高），滑块宽=轨道 2.5 倍、高=7 倍，金色填充截止于滑块 */
  function styleSlider() {
    var sliders = [$('zjh-scale'), $('zjh-panel-scale')].filter(Boolean);
    for (var i = 0; i < sliders.length; i++) {
      var s = sliders[i];
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
  }
  /* 面板内容高度：逐子元素测量（面板本身会被网格拉伸，scrollHeight 含拉伸盒高，会反馈放大） */
  function panelContentHeight(p) {
    var total = 0;
    var visible = 0;
    for (var i = 0; i < p.children.length; i++) {
      var c = p.children[i];
      if (c.classList.contains('hidden')) continue;
      total += c.scrollHeight;
      visible++;
    }
    if (visible > 0) total += (visible - 1) * 14;   /* 面板 gap */
    return total + 32;   /* 面板上下内边距 16px */
  }
  /* 牌桌/面板缩放（同 chess）：牌桌尺寸由缩放与视口决定，网格列/行随之调整，面板贴住牌桌 */
  function applyZjhLayout() {
    var narrow = !!window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    var areaEl = document.querySelector('.board-area');
    var tw = Math.round(Math.min(window.innerWidth * 0.88, window.innerHeight * 0.72, 520) * (zjhSettings.tableScale || 1));
    if (narrow) {
      gameLayoutEl.style.gridTemplateColumns = '1fr';
      gameLayoutEl.style.gridTemplateRows = '';
      /* 牌桌 + 上下娃娃/皇冠留白（娃娃随牌桌缩放） */
      var dollClear = Math.round(130 * (zjhSettings.tableScale || 1));
      if (areaEl) areaEl.style.height = (tw + dollClear * 2) + 'px';
      return;
    }
    var pw = Math.round(230 * (zjhSettings.panelScale || 1));
    var dollSpace = Math.round(75 * (zjhSettings.tableScale || 1));   /* 外侧娃娃留白，面板让位 */
    gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + (tw + dollSpace * 2) + 'px ' + pw + 'px';
    /* 行高 = 牌桌尺寸与面板内容高度的较大者：内容过长时面板自动加高（参考 chess） */
    var rowH = tw;
    document.querySelectorAll('.game-layout > .panel').forEach(function (p) {
      if (!p.classList.contains('hidden')) rowH = Math.max(rowH, panelContentHeight(p) + 14);   /* 底部留空，避免与最后一个按钮边框重合 */
    });
    gameLayoutEl.style.gridTemplateRows = rowH + 'px';
    if (areaEl) areaEl.style.height = '';
  }
  $('zjh-scale').addEventListener('input', function () {
    zjhSettings.tableScale = parseInt(this.value, 10) / 100;
    $('zjh-scale-label').textContent = this.value + '%';
    tableEl.style.transform = 'scale(' + zjhSettings.tableScale + ')';
    applyZjhLayout();
    saveZjhSettings();
    styleSlider();
  });
  $('zjh-panel-scale').addEventListener('input', function () {
    zjhSettings.panelScale = parseInt(this.value, 10) / 100;
    $('zjh-panel-scale-label').textContent = this.value + '%';
    document.documentElement.style.setProperty('--panel-scale', zjhSettings.panelScale.toFixed(2));
    applyZjhLayout();
    saveZjhSettings();
    styleSlider();
  });
  $('btn-settings-close').addEventListener('click', function () { hideModal($('settings-modal')); });

  /* ---------- 开放 / 房间号 / 邀请链接 ---------- */
  var openState = false;
  var avatars = {};      // 玩家 id → {avatar, avatarData}（联机交换的自定义头像）
  $('zjh-open-btn').addEventListener('click', function () {
    if (!isHost) return;   /* 非房主不可操作 */
    openState = !openState;
    this.textContent = openState ? '已开放' : '开放';
    if (isHost && myId) registerOpenRoom(myId, openState);
    hostBroadcastLobby();
  });
  var linkTimer = null;
  $('zjh-copylink-btn').addEventListener('click', function () {
    var link = new URL('zjh.html', location.href);
    link.search = '?mode=join&id=' + encodeURIComponent(myId || '');
    copyText(link.href, '已复制');
    this.textContent = '已复制';
    clearTimeout(linkTimer);
    linkTimer = setTimeout(function () { $('zjh-copylink-btn').textContent = '复制邀请链接'; }, 5000);
  });
  $('zjh-roomcode-btn').addEventListener('click', function () {
    if (this.dataset.shown) {
      delete this.dataset.shown;
      this.textContent = '房间号码';
      return;
    }
    copyText(myId || '', '已复制房间号码');
    this.textContent = myId || '';
    this.dataset.shown = '1';
  });
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
  /* 开放房间摘要（参考 chess openRoomSummary：显示开局选项） */
  function openRoomSummary() {
    var parts = [];
    if (settings.dealer) parts.push('庄家模式');
    if (settings.timeLimit) parts.push('限时 ' + settings.timeSec + ' 秒');
    if (settings.allow235) parts.push('235压AAA');
    if (settings.startScore !== 1000) parts.push('开局 ' + settings.startScore + ' 分');
    return parts.length ? parts.join(' | ') : 'Default';
  }
  function registerOpenRoom(id, open) {
    var list = [];
    try {
      var raw = JSON.parse(localStorage.getItem('cmchessOpenRooms'));
      if (raw && Array.isArray(raw)) list = raw;
    } catch (e) {}
    var now = Date.now();
    list = list.filter(function (r) { return r && r.id !== id && now - (r.ts || 0) < 180000; });
    if (open) list.push({ id: id, hostName: myName, rules: openRoomSummary(), gameStarted: !!game, allowSpec: false, noChat: false, ts: now, game: 'zjh' });
    try { localStorage.setItem('cmchessOpenRooms', JSON.stringify(list)); } catch (e) {}
  }

  /* ---------- 启动 ---------- */
  Profile.applyBackground();
  loadZjhSettings();
  applyCardSettings();
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  


  tableEl.style.transform = 'scale(' + (zjhSettings.tableScale || 1) + ')';
  document.documentElement.style.setProperty('--panel-scale', (zjhSettings.panelScale || 1).toFixed(2));
  applyZjhLayout();
  arrangePanels();
  window.addEventListener('resize', function () { arrangePanels(); applyZjhLayout(); });
  /* 未开局时隐藏两侧面板与牌桌区域 */
  function setPanelsVisible(v) {
    document.querySelectorAll('.game-layout > .panel, .board-area, .top-panel, .bottom-panel').forEach(function (el) {
      el.classList.toggle('hidden', !v);
    });
  }
  setPanelsVisible(false);
  var gameStarted = false;
  function showGamePanels() {
    if (!gameStarted) { gameStarted = true; setPanelsVisible(true); }
  }
  var origRenderGame = renderGame;
  renderGame = function () {
    showGamePanels();
    origRenderGame();
    if (typeof applyZjhLayout === 'function') applyZjhLayout();   /* 面板内容渲染后按内容重新计算行高 */
  };
  if (isHost) {
    initHost();
    showCreate();   /* 创建房间：先设置再进大厅 */
  } else if (mode === 'join' && joinId) {
    initJoin();
    if (!joinStarted) showWait();   /* 已开局房间直接进入对局界面，不显示等待大厅 */
  } else {
    location.href = 'index.html';
  }
})();























































