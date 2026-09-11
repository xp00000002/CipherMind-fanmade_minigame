/* battle.js - 斗地主（Battle）多人联机版（PeerJS，房主权威）
   房主同时服务 2 名玩家，对局状态由房主裁决并广播；
   出牌/叫分操作由各端发起，房主校验后更新状态。 */
(function () {
  'use strict';

  /* 刷新页面：回到主界面，不保留对局状态 */
  if (window.performance && performance.getEntriesByType) {
    var nav = performance.getEntriesByType('navigation');
    if (nav.length && nav[0].type === 'reload') {
      location.replace('index.html');
      return;
    }
  }

  var SUITS = ['s', 'h', 'c', 'd'];
  var SUIT_IMG = { s: 'texture-card/Card-Spade.png', h: 'texture-card/Card-Heart.png', c: 'texture-card/Card-Club.png', d: 'texture-card/Card-Diamond.png' };
  var SUIT_IMG_TC = { s: 'texture-card/Card-Spade-Black.png', h: 'texture-card/Card-Heart-Red.png', c: 'texture-card/Card-Club-Black.png', d: 'texture-card/Card-Diamond-Red.png' };
  var RANK_IMG = {
    3: 'texture-card/Card-3.png', 4: 'texture-card/Card-4.png', 5: 'texture-card/Card-5.png',
    6: 'texture-card/Card-6.png', 7: 'texture-card/Card-7.png', 8: 'texture-card/Card-8.png',
    9: 'texture-card/Card-9.png', 10: 'texture-card/Card-10.png', 11: 'texture-card/Card-J.png',
    12: 'texture-card/Card-Q.png', 13: 'texture-card/Card-K.png', 14: 'texture-card/Card-A.png',
    15: 'texture-card/Card-2.png'
  };
  var JOKER_IMG = { 16: 'texture-card/Card-BlackJoker.png', 17: 'texture-card/Card-RedJoker.png' };
  var TYPE_LABEL = { single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二', straight: '顺子', dstraight: '连对', airplane: '飞机', four2: '四带二', four2pairs: '四带两对', bomb: '炸弹', rocket: '王炸' };
  var TYPE_ORDER = { single: 1, pair: 2, triple: 3, triple1: 4, triple2: 5, straight: 6, dstraight: 7, airplane: 8, four2: 9, four2pairs: 10, bomb: 11, rocket: 12 };
  var GLYPHS = ['♠', '♥', '♣'];
  /* 记牌器：各点数总张数（3-2 各 4 张，小王 1 张、大王 1 张） */
  var RANK_LABEL = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小', 17: '大' };
  var DECK_CNT = {};
  (function () {
    for (var r = 3; r <= 15; r++) DECK_CNT[r] = 4;
    DECK_CNT[16] = 1; DECK_CNT[17] = 1;
  })();
  var PIECE_IMG = {
    w: { p: 'texture/pawn2.png', n: 'texture/knight2.png', b: 'texture/bishop2.png', r: 'texture/rook2.png', q: 'texture/queen2.png', k: 'texture/king2.png' },
    b: { p: 'texture/pawn.png', n: 'texture/knight.png', b: 'texture/bishop.png', r: 'texture/rook.png', q: 'texture/queen.png', k: 'texture/king.png' }
  };

  var params = new URLSearchParams(location.search);
  var mode = params.get('mode');          // 'host' | 'join'
  var joinId = params.get('id');
  var joinStarted = params.get('started') === '1';   /* 从主界面点击已开局房间直接进入（斗地主开局后不接受加入） */
  var specWanted = params.get('spec') === '1';       /* 请求以观战者身份加入 */
  var isHost = mode === 'host';
  var myName = (Profile.get() || {}).name || 'Player';
  /* 自己的对局身份：房主在 game.order / game.hands 中固定为 'host'，加入方为自己的 peer id；观战者无身份 */
  function mySelfId() { return isHost ? 'host' : (isSpec ? '' : myId); }
  /* 多点 STUN/TURN：减少同机/局域网 ICE 协商失败的可能 */
  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }
  ];

  var peer = null;
  var conns = [];        // 房主：玩家连接
  var specConns = [];    // 房主：观战者连接
  var specNames = {};    // 房主：观战者名称（peer → name）
  var myConn = null;     // 加入方：连接
  var myId = null;
  var selfPeerId = null; // 加入方自己的 peer id（与房主侧 conn.peer 兜底匹配）
  var isSpec = false;    // 本端为观战者（房主判定）
  var specViewed = false;  // 观战者：本轮已开启看牌（不可撤销，下一局自动恢复）
  var specIdx = 0;         // 观战者看牌条：当前显示的玩家下标（按内部玩家顺序）
  var specViewedRound = -1;
  var players = [];      // 大厅：{id, name, ready, host}
  var game = null;
  var myIndex = -1;      // 我在 game.order 中的下标
  var readyState = false;
  var openState = false;
  var aborted = false;   // 收到对局中止消息后忽略连接断开提示
  var rejected = false;  // 加入被拒绝（满房/对局已开始）后忽略连接断开提示
  var avatars = {};      // 玩家 id → {avatar, avatarData}（联机交换的自定义头像）
  var sel = {};          // 我的手牌选中集合（手牌下标 -> true）
  var dealTimer = null;  // 无人叫地主重发牌定时器
  var settings = { counter: true, baseScore: 1, mode: 'single', roundLimit: false, roundCount: 3, startScore: 1000, noChat: false, allowPrivateChat: false, allowSpec: true };  // 房主开局选项（创建房间时设置，随 lobby/state 广播）
  var settingsBackup = null;   // 创建房间设置备份（返回时恢复）
  /* 多局/积分模式会话（房主权威，随 state 广播）：
     mode=multi 起始 0 分、mode=points 起始 startScore 分；
     round=已完成局数；wins/losses=全局倍率的胜负记录；over=会话结束 */
  var session = null;
  var counterOn = false;   // 本地：记牌器条是否显示
  var playedCards = {};    // 记牌器：已打出的牌（rank:suit → true，换局重置）
  var counterRound = -1;   // 记牌器：当前累积对应的局号
  var dollSeat = null;     // 娃娃信息框当前显示的座位（null=不显示）
  var dollLocked = false;  // 娃娃信息框是否被点击锁定（锁定后悬停/移出无反应）
  var autoNextTimer = null;  // 多局/积分模式：局间自动开局倒计时
  var autoNextLeft = 0;      // 剩余秒数
  var hintCands = [];        // 提示（Tab/按钮）候选出牌
  var hintSig = '';          // 提示候选对应的局面签名
  var hintIdx = -1;          // 当前提示到第几个候选

  var tableEl = document.getElementById('battle-table');
  var tipEl = document.getElementById('bt-tip');
  var bottomEl = document.getElementById('bt-bottom');
  var centerEl = document.getElementById('bt-center');
  var handEl = document.getElementById('bt-hand');
  var playerPanelEl = document.getElementById('bt-player-panel');
  var statusEl = document.getElementById('bt-status');
  var statusMultEl = document.getElementById('bt-status-mult');

  function $(id) { return document.getElementById(id); }
  function showModal(el) { el.classList.remove('hidden'); Profile.adjustBtnHitAreas(); }
  function hideModal(el) { el.classList.add('hidden'); }

  var toastTimer = null;
  function toast(msg) {
    /* 聊天消息样式：追加到右上角消息层，多条堆叠（与各游戏一致） */
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
  $('confirm-yes').addEventListener('click', function () {
    hideModal($('confirm-modal'));
    if (confirmAction && confirmAction.yes) confirmAction.yes();
  });
  $('confirm-no').addEventListener('click', function () {
    hideModal($('confirm-modal'));
    if (confirmAction && confirmAction.no) confirmAction.no();
  });

  function nameOf(id) {
    if (id === mySelfId()) return '你';
    return game && game.names ? (game.names[id] || '玩家') : '玩家';
  }
  function displayName(id) {
    if (id !== mySelfId()) return game && game.names ? (game.names[id] || '玩家') : '玩家';
    return myName || '我';
  }
  function isJoker(r) { return r === 16 || r === 17; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function sortHand(h) {
    h.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    });
  }
  function newDeck() {
    var deck = [];
    SUITS.forEach(function (s) {
      for (var r = 3; r <= 15; r++) deck.push({ rank: r, suit: s });
    });
    deck.push({ rank: 16, suit: 'sj' });
    deck.push({ rank: 17, suit: 'bj' });
    return deck;
  }

  /* ---------- 牌型分析 ---------- */
  /* 返回 { type, key, len }；非法牌型返回 null。
     key：同类型比较的关键点数（顺子/连对/飞机取最高点）；len：顺子/连对/飞机的长度 */
  function combOf(cards) {
    var n = cards.length;
    if (n === 0) return null;
    var cnt = {};
    var jokers = 0;
    cards.forEach(function (c) {
      cnt[c.rank] = (cnt[c.rank] || 0) + 1;
      if (isJoker(c.rank)) jokers++;
    });
    var rks = Object.keys(cnt).map(Number).sort(function (a, b) { return a - b; });
    /* 王炸 */
    if (n === 2 && jokers === 2) return { type: 'rocket', key: 17, len: 2 };
    if (rks.length === 1) {
      var c0 = cnt[rks[0]];
      if (c0 === 1) return { type: 'single', key: rks[0], len: 1 };
      if (c0 === 2) return { type: 'pair', key: rks[0], len: 2 };
      if (c0 === 3) return { type: 'triple', key: rks[0], len: 3 };
      if (c0 === 4) return { type: 'bomb', key: rks[0], len: 4 };
      return null;
    }
    /* 三带一 / 三带二 */
    if (rks.length === 2) {
      var ra = rks[0], rb = rks[1];
      if (cnt[ra] === 3 && cnt[rb] === 1) return { type: 'triple1', key: ra, len: 4 };
      if (cnt[rb] === 3 && cnt[ra] === 1) return { type: 'triple1', key: rb, len: 4 };
      if (cnt[ra] === 3 && cnt[rb] === 2) return { type: 'triple2', key: ra, len: 5 };
      if (cnt[rb] === 3 && cnt[ra] === 2) return { type: 'triple2', key: rb, len: 5 };
    }
    /* 四带二（单）/（对） */
    var four = null;
    for (var r in cnt) if (cnt[r] === 4) { four = Number(r); break; }
    if (four !== null) {
      var rest = rks.filter(function (r2) { return r2 !== four; });
      if (n === 6 && rest.length === 2 && cnt[rest[0]] === 1 && cnt[rest[1]] === 1) {
        /* 两张王不能同时作为带的单牌 */
        if (!(isJoker(rest[0]) && isJoker(rest[1]))) return { type: 'four2', key: four, len: 6 };
      }
      if (n === 8 && rest.length === 2 && cnt[rest[0]] === 2 && cnt[rest[1]] === 2) {
        return { type: 'four2pairs', key: four, len: 8 };
      }
    }
    /* 顺子（5 张起，3-A，不含 2 和王） */
    if (n >= 5 && rks.length === n && rks[n - 1] <= 14) {
      var st = true;
      for (var i = 1; i < n; i++) if (rks[i] !== rks[i - 1] + 1) { st = false; break; }
      if (st) return { type: 'straight', key: rks[n - 1], len: n };
    }
    /* 连对（3 对起，3-A） */
    if (n >= 6 && n % 2 === 0 && rks.length === n / 2 && rks[n / 2 - 1] <= 14) {
      var dt = true;
      for (var j = 1; j < rks.length; j++) if (rks[j] !== rks[j - 1] + 1) { dt = false; break; }
      var allPairs = true;
      rks.forEach(function (r3) { if (cnt[r3] !== 2) allPairs = false; });
      if (dt && allPairs) return { type: 'dstraight', key: rks[rks.length - 1], len: rks.length };
    }
    /* 飞机（连续三张 ≥2 组，3-A；可带同样组数的单牌或对子） */
    var tripRanks = rks.filter(function (r4) { return r4 <= 14 && cnt[r4] === 3; });
    if (tripRanks.length >= 2) {
      var runs = [];
      var cur = [tripRanks[0]];
      for (var t = 1; t < tripRanks.length; t++) {
        if (tripRanks[t] === tripRanks[t - 1] + 1) cur.push(tripRanks[t]);
        else { if (cur.length >= 2) runs.push(cur); cur = [tripRanks[t]]; }
      }
      if (cur.length >= 2) runs.push(cur);
      for (var ri = 0; ri < runs.length; ri++) {
        var run = runs[ri];
        var k = run.length;
        if (n === 3 * k) return { type: 'airplane', key: run[k - 1], len: k };
        if (n === 4 * k) {
          var wRanks = rks.filter(function (r5) { return run.indexOf(r5) === -1 && cnt[r5] === 1; });
          if (wRanks.length === k) {
            var jk = 0;
            wRanks.forEach(function (r6) { if (isJoker(r6)) jk++; });
            if (jk !== 2) return { type: 'airplane', key: run[k - 1], len: k };
          }
        }
        if (n === 5 * k) {
          var pRanks = rks.filter(function (r7) { return run.indexOf(r7) === -1 && cnt[r7] === 2; });
          if (pRanks.length === k) return { type: 'airplane', key: run[k - 1], len: k };
        }
      }
    }
    return null;
  }
  function beats(prev, cur) {
    if (prev.type === 'rocket') return false;   /* 王炸最大，无人能压 */
    if (cur.type === 'rocket') return true;
    if (cur.type === 'bomb') {
      if (prev.type !== 'bomb') return true;
      return Number(cur.key) > Number(prev.key);
    }
    if (prev.type === 'bomb') return false;
    if (cur.type !== prev.type) return false;
    if (cur.len !== prev.len) return false;
    /* 数值比较：避免字符串点数（如 "10" < "8"）导致 10 压不过 8 */
    return Number(cur.key) > Number(prev.key);
  }

  /* ---------- 出牌组合生成（提示按钮用） ---------- */
  /* 从 arr 中枚举全部 k 个元素的组合（按下标），逐个回调 */
  function eachKSub(arr, k, cb) {
    if (k < 0 || k > arr.length) return;
    var idx = [];
    (function rec(start) {
      if (idx.length === k) { cb(idx.slice()); return; }
      for (var i = start; i <= arr.length - (k - idx.length); i++) {
        idx.push(arr[i]);
        rec(i + 1);
        idx.pop();
      }
    })(0);
  }
  function genPlays(hand) {
    var n = hand.length;
    var byRank = {};
    var rankList = [];
    hand.forEach(function (c, i) {
      if (!byRank[c.rank]) { byRank[c.rank] = []; rankList.push(c.rank); }
      byRank[c.rank].push(i);
    });
    rankList.sort(function (a, b) { return a - b; });
    var plays = [];
    function addPlay(idxs) {
      var comb = combOf(idxs.map(function (i) { return hand[i]; }));
      if (comb) plays.push({ cards: idxs, comb: comb });
    }
    /* 单张 / 对子 / 三张 / 炸弹 */
    rankList.forEach(function (r) {
      addPlay(byRank[r].slice(0, 1));
      if (byRank[r].length >= 2) addPlay(byRank[r].slice(0, 2));
      if (byRank[r].length >= 3) addPlay(byRank[r].slice(0, 3));
      if (byRank[r].length >= 4) addPlay(byRank[r].slice(0, 4));
    });
    /* 三带一 / 三带二 */
    rankList.forEach(function (r) {
      if (byRank[r].length < 3) return;
      var t3 = byRank[r].slice(0, 3);
      rankList.forEach(function (s) {
        if (s === r) return;
        if (byRank[s].length >= 1) addPlay(t3.concat(byRank[s].slice(0, 1)));
        if (byRank[s].length >= 2) addPlay(t3.concat(byRank[s].slice(0, 2)));
      });
    });
    /* 四带二（单）/（对） */
    var fours = rankList.filter(function (r) { return byRank[r].length === 4; });
    fours.forEach(function (r) {
      var f4 = byRank[r].slice(0, 4);
      var singles = rankList.filter(function (s) { return s !== r; });
      for (var i = 0; i < singles.length; i++) {
        for (var j = i + 1; j < singles.length; j++) {
          if (isJoker(singles[i]) && isJoker(singles[j])) continue;
          addPlay(f4.concat(byRank[singles[i]][0], byRank[singles[j]][0]));
        }
      }
      var pairs = singles.filter(function (s) { return byRank[s].length >= 2; });
      for (var a = 0; a < pairs.length; a++) {
        for (var b = a + 1; b < pairs.length; b++) {
          addPlay(f4.concat(byRank[pairs[a]].slice(0, 2), byRank[pairs[b]].slice(0, 2)));
        }
      }
    });
    /* 顺子（不含 2 和王） */
    var playRanks = rankList.filter(function (r) { return r <= 14; });
    for (var i2 = 0; i2 < playRanks.length; i2++) {
      for (var j2 = i2 + 4; j2 < playRanks.length; j2++) {
        if (playRanks[j2] !== playRanks[i2] + (j2 - i2)) break;
        var idxs = [];
        for (var k = i2; k <= j2; k++) idxs.push(byRank[playRanks[k]][0]);
        addPlay(idxs);
      }
    }
    /* 连对 */
    var pairRanks = rankList.filter(function (r) { return r <= 14 && byRank[r].length >= 2; });
    for (var i3 = 0; i3 < pairRanks.length; i3++) {
      for (var j3 = i3 + 2; j3 < pairRanks.length; j3++) {
        if (pairRanks[j3] !== pairRanks[i3] + (j3 - i3)) break;
        var idxs2 = [];
        for (var k2 = i3; k2 <= j3; k2++) idxs2.push.apply(idxs2, byRank[pairRanks[k2]].slice(0, 2));
        addPlay(idxs2);
      }
    }
    /* 飞机（连续三张 ≥2 组，3-A；可带同样组数的单牌或对子） */
    var tripRanks = rankList.filter(function (r) { return r <= 14 && byRank[r].length >= 3; });
    for (var i4 = 0; i4 < tripRanks.length - 1; i4++) {
      var run = [tripRanks[i4]];
      for (var j4 = i4 + 1; j4 < tripRanks.length && tripRanks[j4] === tripRanks[j4 - 1] + 1; j4++) run.push(tripRanks[j4]);
      if (run.length < 2) continue;
      var k3 = run.length;
      var triIdxs = [];
      run.forEach(function (r) { triIdxs.push.apply(triIdxs, byRank[r].slice(0, 3)); });
      addPlay(triIdxs);
      /* 带单/带对：枚举所有不同点数的组合（同点数只用最左的牌，避免重复） */
      if (k3 > 1) {
        var runSet = {};
        run.forEach(function (r) { runSet[r] = true; });
        var wingPool = rankList.filter(function (r) { return !runSet[r]; });
        eachKSub(wingPool, k3, function (comb) {
          var jk = 0;
          comb.forEach(function (r) { if (isJoker(r)) jk++; });
          if (jk === 2) return;   /* 两张王不能同时作为带的单牌 */
          var idxs = triIdxs.slice();
          comb.forEach(function (r) { idxs.push(byRank[r][0]); });
          addPlay(idxs);
        });
        var pairPool = wingPool.filter(function (r) { return !isJoker(r) && byRank[r].length >= 2; });
        eachKSub(pairPool, k3, function (comb) {
          var idxs = triIdxs.slice();
          comb.forEach(function (r) { idxs.push(byRank[r][0], byRank[r][1]); });
          addPlay(idxs);
        });
      }
    }
    /* 王炸 */
    if (byRank[16] && byRank[17]) addPlay([byRank[16][0], byRank[17][0]]);
    return plays;
  }
  /* 选一手牌（提示按钮用）：prev 为 null 表示自由出牌；返回 { cards: 手牌下标[], comb } 或 null */
  function choosePlay(hand, prev) {
    var cands = genPlays(hand).filter(function (p) { return !prev || beats(prev, p.comb); });
    if (!cands.length) return null;
    cands.sort(function (a, b) {
      var ta = TYPE_ORDER[a.comb.type], tb = TYPE_ORDER[b.comb.type];
      if (ta !== tb) return ta - tb;
      if (a.comb.key !== b.comb.key) return a.comb.key - b.comb.key;
      return a.cards.length - b.cards.length;
    });
    return cands[0];
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
  function connId(c) { return c ? c.peer : ''; }
  function findPlayer(id) {
    for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i];
    return null;
  }
  function handleHostMessage(c, data) {
    if (!data || !data.t) return;
    if (data.t === 'join') {
      var nm = String(data.name || '').trim() || 'Player';
      var used = {};
      players.forEach(function (p) { used[p.name] = true; });
      if (used[nm]) { var n = 2; while (used[nm + ' #' + n]) n++; nm = nm + ' #' + n; }
      /* 请求观战：仅在对局已开始或房间已满时接受为观战者（观战需有对局可看）；
         否则即使在开放房间列表点击（带 spec 参数）也按玩家加入 */
      if (data.spec && settings.allowSpec && (game || players.length >= 3)) {
        acceptSpec(c, nm);
        return;
      }
      if (game) {
        if (data.spec && !settings.allowSpec) {
          c.send({ t: 'no-spec', reason: '对局已开始且未开放观战' });
        } else {
          c.send({ t: 'full', reason: '对局已开始' });
        }
        try { c.close(); } catch (e) {}
        return;
      }
      if (players.length >= 3) {
        if (data.spec && settings.allowSpec) {
          acceptSpec(c, nm);
          return;
        }
        c.send({ t: 'full', reason: '房间已满' });
        try { c.close(); } catch (e) {}
        return;
      }
      players.push({ id: connId(c), name: nm, ready: false, host: false });
      c.send({ t: 'profiles', avatars: avatars });   /* 新成员同步所有自定义头像 */
      hostBroadcastLobby();
      return;
    }
    if (data.t === 'profile') {
      /* 加入方上报自己的头像：存储并转发给其他玩家 */
      avatars[connId(c)] = { avatar: data.avatar, avatarData: data.avatarData };
      sendAll({ t: 'profile', id: connId(c), avatar: data.avatar, avatarData: data.avatarData });
      renderGame();
      return;
    }
    if (data.t === 'chat') {
      btHostRouteChat(c, data);
      return;
    }
    if (data.t === 'ready') {
      var p = findPlayer(connId(c));
      if (p && !p.host) { p.ready = !!data.v; hostBroadcastLobby(); }
      return;
    }
    if (data.t === 'action') {
      handleGameAction(connId(c), data.a);
      return;
    }
    if (data.t === 'leave') {
      removePlayer(connId(c));
      return;
    }
  }
  /* ---------- 观战者（房主侧） ---------- */
  function acceptSpec(c, nm) {
    var ci = conns.indexOf(c);
    if (ci !== -1) conns.splice(ci, 1);
    specNames[c.peer] = nm;
    specConns.push({ conn: c, peer: c.peer, name: nm });
    c.send({ t: 'role-spec', name: nm });
    if (game) c.send({ t: 'state', game: gameForSpec(), settings: settings, session: session, spec: true });
    else c.send({ t: 'lobby', players: players, settings: settings, open: openState, spec: true });
  }
  function handleSpecData(sp, data) {
    if (!data || !data.t) return;
    if (data.t === 'chat') {
      if (settings.noChat) return;
      btHostRouteChat(sp.conn, data);   /* 观战者发言按目标转发给玩家 */
      return;
    }
    if (data.t === 'spec-leave') {
      removeSpec(sp);
      try { sp.conn.close(); } catch (e) {}
      return;
    }
  }
  function removeSpec(sp) {
    var i = specConns.indexOf(sp);
    if (i !== -1) specConns.splice(i, 1);
    delete specNames[sp.peer];
  }
  function removePlayer(id) {
    players = players.filter(function (p) { return p.id !== id; });
    if (game && game.order.indexOf(id) !== -1) {
      /* 对局中离开：中止对局 */
      abortGame(id);
      return;
    }
    hostBroadcastLobby();
  }
  function abortGame(id) {
    var reason = (game.names && game.names[id] ? game.names[id] : '玩家') + ' 已离开，对局中止';
    sendAll({ t: 'abort', reason: reason });
    clearAutoNext();
    game = null;
    try { peer.destroy(); } catch (e) {}
    showPrompt('对局中止', reason, function () { location.href = 'index.html'; }, null, '返回主界面', null);
  }
  function hostBroadcastLobby() {
    sendAll({ t: 'lobby', players: players, settings: settings, open: openState });
    for (var si = 0; si < specConns.length; si++) {
      if (specConns[si].conn.open) specConns[si].conn.send({ t: 'lobby', players: players, settings: settings, open: openState, spec: true });
    }
    renderLobby();
  }
  function initHost() {
    peer = new Peer({ config: { iceServers: ICE_SERVERS } });
    peer.on('open', function (id) {
      myId = id;
      console.log('[battle] 房主 peer 就绪', id);
      players = [{ id: 'host', name: myName, ready: false, host: true }];
      var p0 = Profile.get() || {};
      avatars['host'] = { avatar: p0.avatar, avatarData: p0.avatarData };
      renderLobby();
      /* 加载完成前已点击"开放"：peer 就绪后补注册，保证实际状态与显示一致 */
      if (openState) registerOpenRoom(myId, true);
    });
    peer.on('connection', function (c) {
      console.log('[battle] 收到新连接', c.peer);
      c.on('data', function (data) {
        /* 观战者连接的消息走观战分支（聊天/改名/离开） */
        var sp = null;
        for (var i = 0; i < specConns.length; i++) if (specConns[i].conn === c) { sp = specConns[i]; break; }
        if (sp) handleSpecData(sp, data);
        else handleHostMessage(c, data);
      });
      c.on('close', function () {
        var sp2 = null;
        for (var j = 0; j < specConns.length; j++) if (specConns[j].conn === c) { sp2 = specConns[j]; break; }
        if (sp2) removeSpec(sp2);
        else removePlayer(connId(c));
      });
      conns.push(c);   /* 观战者接受后会从 conns 移入 specConns */
      c.on('open', function () {
        console.log('[battle] 房主侧通道已打开', c.peer);
        c.send({ t: 'hello', id: connId(c) });
      });
      c.on('error', function (err) {
        console.error('[battle] 房主侧通道错误', err && err.type, err && err.message);
      });
    });
    /* 信令空闲掉线/网络错误后自动重连，避免等待大厅中他人无法加入 */
    peer.on('disconnected', function () {
      console.warn('[battle] 房主信令断开，重连中');
      if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
    peer.on('error', function (err) {
      console.error('[battle] 房主 peer 错误', err && err.type, err && err.message);
      if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed')) {
        if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
      }
    });
    /* 信令保活：PeerJS 公网云对无流量的连接约 2 分钟闲置即断开；
       等待大厅没有任何流量，故周期性检查并在掉线后立即重连 */
    setInterval(function () {
      if (!peer || peer.destroyed) return;
      if (peer.disconnected) {
        console.warn('[battle] 房主信令已断开，保活重连');
        try { peer.reconnect(); } catch (e) {}
      }
    }, 20000);
  }
  function initJoin() {
    peer = new Peer({ config: { iceServers: ICE_SERVERS } });
    peer.on('open', function (id) {
      myId = id;
      selfPeerId = id;
      console.log('[battle] 加入方 peer 就绪', id, '→ 房主', joinId);
      /* 连接房主：8 秒内通道未建立则换新通道重试（房主信令可能在重连窗口内），最多 3 次 */
      var tries = 0;
      var done = false;
      function fail() {
        if (done) return;
        done = true;
        console.error('[battle] 连接房主失败（已重试 ' + tries + ' 次）');
        showPrompt('连接失败', '无法连接到房主，房间可能已关闭或信令连接中断',
          function () { location.href = 'index.html'; },
          function () { location.reload(); }, '返回主界面', '重试');
      }
      function attempt() {
        tries++;
        var conn = peer.connect(joinId, { reliable: true });
        myConn = conn;
        var dead = false;     /* 该通道被放弃（进入重试） */
        var opened = false;
        var timer = setTimeout(function () {
          if (dead || opened || done) return;
          dead = true;
          console.warn('[battle] 第 ' + tries + ' 次连接 8 秒未建立，重试');
          try { conn.close(); } catch (e) {}
          if (tries < 3) attempt();
          else fail();
        }, 8000);
        conn.on('open', function () {
          if (dead || done) return;
          opened = true;
          clearTimeout(timer);
          console.log('[battle] 加入方通道已打开，发送 join');
          conn.send({ t: 'join', name: myName, spec: !!specWanted });
        });
        conn.on('data', function (data) { if (!dead) handleJoinMessage(data); });
        conn.on('error', function (err) {
          clearTimeout(timer);
          console.error('[battle] 加入方通道错误', err && err.type, err && err.message);
          if (dead || done || aborted || rejected) return;
          if (!game) {
            if (tries < 3) attempt();
            else fail();
          }
        });
        conn.on('close', function () {
          clearTimeout(timer);
          if (dead || done) return;
          if (aborted || rejected) return;   /* 被拒绝/对局中止：提示弹窗处理，不自动跳转 */
          if (game) showPrompt('连接已断开', '房主已离开或连接中断，对局无法继续');
          else location.href = 'index.html';
        });
      }
      attempt();
    });
    /* 信号空闲掉线：重连即可（已建立的数据通道不受影响），不直接退回主界面 */
    peer.on('disconnected', function () {
      if (aborted || rejected) return;
      console.warn('[battle] 加入方信令断开，重连中');
      if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} return; }
      if (game) showPrompt('连接已断开', '与房主的连接中断，对局无法继续');
      else location.href = 'index.html';
    });
    peer.on('error', function (err) {
      console.error('[battle] 加入方 peer 错误', err && err.type, err && err.message);
      if (rejected) return;
      if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed')) {
        if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} return; }
      }
      showPrompt('连接失败', (err && err.message) || '无法连接到房主');
    });
  }
  function handleJoinMessage(data) {
    if (!data || !data.t) return;
    if (data.t === 'hello') {
      myId = data.id;
      /* 上报自己的自定义头像 */
      var p0 = Profile.get() || {};
      sendMy({ t: 'profile', avatar: p0.avatar, avatarData: p0.avatarData });
      return;
    }
    if (data.t === 'role-spec') {
      /* 房主判定为观战者 */
      isSpec = true;
      specViewed = false;
      specIdx = 0;
      updateSpecSeeUI();
      if (data.name) myName = data.name;
      return;
    }
    if (data.t === 'profiles') {
      if (data.avatars) for (var k in data.avatars) avatars[k] = data.avatars[k];
      renderGame();
      return;
    }
    if (data.t === 'profile') {
      avatars[data.id] = { avatar: data.avatar, avatarData: data.avatarData };
      renderGame();
      return;
    }
    if (data.t === 'lobby') {
      players = data.players;
      if (data.settings) settings = data.settings;   /* 同步房主开局选项（记牌器/底分） */
      if (data.spec) isSpec = true;   /* 观战者身份以房主判定为准 */
      var me = null;
      for (var i = 0; i < players.length; i++) if (!isSpec && (players[i].id === myId || players[i].id === selfPeerId)) me = players[i];
      if (me) myName = me.name;
      openState = !!data.open;
      renderLobby();
      return;
    }
    if (data.t === 'chat') {
      btShowChatMsg(data.from || 'Player', data.text || '');
      return;
    }
    if (data.t === 'state') {
      var wasOver = game && game.phase === 'over';
      game = data.game;
      if (data.settings) settings = data.settings;
      if (data.session) session = data.session;
      if (data.spec) isSpec = true;   /* 观战状态以房主判定为准 */
      /* 观战者：新一轮开始时自动恢复“看牌”状态 */
      if (isSpec && specViewed && game.roundNo !== specViewedRound) {
        specViewed = false;
        updateSpecSeeUI();
      }
      myIndex = -1;
      for (var i2 = 0; i2 < game.order.length; i2++) if (!isSpec && (game.order[i2] === myId || game.order[i2] === selfPeerId)) { myIndex = i2; break; }
      hideModal($('bt-wait-modal'));
      renderGame();
      if (isSpec) updateSpecSeeUI();
      if (game.phase === 'over' && !wasOver) showResult();
      else if (game.phase !== 'over') {
        hideModal($('bt-result-modal'));
        clearAutoNext();
        hideModal($('bt-records-modal'));   /* 新一局开始：关闭查看记录 */
        recordsFromResult = false;
      }
      return;
    }
    if (data.t === 'full') {
      rejected = true;
      showPrompt('无法加入', data.reason || '房间已满', function () { location.href = 'index.html'; }, null, '返回主界面', null);
      return;
    }
    if (data.t === 'no-spec') {
      rejected = true;
      showPrompt('无法观战', data.reason || '该房间未开放观战', function () { location.href = 'index.html'; }, null, '返回主界面', null);
      return;
    }
    if (data.t === 'abort') {
      aborted = true;
      showPrompt('对局中止', data.reason || '对局已中止', function () { location.href = 'index.html'; }, null, '返回主界面', null);
      return;
    }
  }

  /* ---------- 大厅 ---------- */
  function renderLobby() {
    var body = $('bt-wait-body');
    body.innerHTML = '';
    var openBtn = $('bt-open-btn');
    openBtn.disabled = !isHost;
    openBtn.textContent = openState ? '已开放' : '开放';
    players.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'zjh-pcard' + ((p.id === myId || p.id === selfPeerId || (p.host && isHost)) ? ' me' : '');
      var name = document.createElement('div');
      name.className = 'zjh-pname';
      name.textContent = p.name;
      card.appendChild(name);
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
      var start = $('btn-bt-start');
      start.classList.remove('hidden');
      start.disabled = players.length < 3 || players.some(function (p) { return !p.host && !p.ready; });
      $('btn-bt-ready').classList.add('hidden');
    } else if (isSpec) {
      /* 观战者：大厅只读（等待对局开始），不提供开始/准备按钮 */
      $('btn-bt-start').classList.add('hidden');
      $('btn-bt-ready').classList.add('hidden');
    } else {
      $('btn-bt-start').classList.add('hidden');
      var rd = $('btn-bt-ready');
      rd.classList.remove('hidden');
      rd.textContent = readyState ? '取消准备' : '准备';
    }
  }
  function showWait() {
    renderLobby();
    showModal($('bt-wait-modal'));
  }
  $('btn-bt-wait-back').addEventListener('click', function () {
    unregisterOpenRoom(myId);
    try { peer.destroy(); } catch (e) {}
    location.href = 'index.html';
  });
  $('btn-bt-start').addEventListener('click', function () {
    if (!isHost) return;
    if (players.length < 3) { toast('需要 3 名玩家'); return; }
    for (var i = 0; i < players.length; i++) {
      if (!players[i].host && !players[i].ready) { toast('有玩家未准备'); return; }
    }
    deal();
  });
  $('btn-bt-ready').addEventListener('click', function () {
    readyState = !readyState;
    sendMy({ t: 'ready', v: readyState });
    renderLobby();
  });

  /* ---------- 创建设置（房主进入等待界面前设置开局选项，参考炸金花） ---------- */
  var updateBtCreateScrollbar = Profile.wireScrollbar(
    $('bt-create-settings-body'),
    $('bt-create-scrollbar'),
    $('bt-create-scrollbar-thumb')
  );
  function showCreate() {
    settingsBackup = JSON.parse(JSON.stringify(settings));
    hideModal($('bt-wait-modal'));
    setToggle($('bt-opt-counter'), settings.counter);
    setToggle($('bt-opt-limit'), settings.roundLimit);
    setToggle($('bt-opt-nochat'), settings.noChat);
    setToggle($('bt-opt-private'), settings.allowPrivateChat);
    setToggle($('bt-opt-allow-spec'), settings.allowSpec);
    $('bt-score-input').value = settings.baseScore;
    $('bt-round-input').value = settings.roundCount;
    $('bt-startscore-input').value = settings.startScore;
    syncModeUI();
    showModal($('bt-create-modal'));
    updateBtCreateScrollbar();
  }
  /* 游戏模式相关选项行的显示切换（模式切换控件样式同 spider 难度选择） */
  var BT_MODES = ['single', 'multi', 'points'];
  var BT_MODE_NAMES = { single: '单局', multi: '多局', points: '积分' };
  function syncModeUI() {
    var mode = settings.mode;
    var lbl = $('bt-mode-label');
    if (lbl) lbl.textContent = BT_MODE_NAMES[mode] || mode;
    var baseRow = $('bt-mode-base-row');      /* 底分：多局/积分 */
    if (baseRow) baseRow.classList.toggle('hidden', mode === 'single');
    var limRow = $('bt-mode-limit-row');      /* 限制局数：多局 */
    if (limRow) limRow.classList.toggle('hidden', mode !== 'multi');
    var cntRow = $('bt-mode-count-row');      /* 局数：多局且开启限制 */
    if (cntRow) cntRow.classList.toggle('hidden', mode !== 'multi' || !settings.roundLimit);
    var startRow = $('bt-mode-start-row');    /* 初始积分：积分模式 */
    if (startRow) startRow.classList.toggle('hidden', mode !== 'points');
  }
  function cycleMode(dir) {
    var idx = BT_MODES.indexOf(settings.mode);
    if (idx < 0) idx = 0;
    idx = (idx + dir + BT_MODES.length) % BT_MODES.length;
    settings.mode = BT_MODES[idx];
    syncModeUI();
  }
  $('btn-bt-create-back').addEventListener('click', function () {
    settings = JSON.parse(JSON.stringify(settingsBackup));
    hideModal($('bt-create-modal'));
    showWait();
  });
  $('btn-bt-create').addEventListener('click', function () {
    hideModal($('bt-create-modal'));
    hostBroadcastLobby();
    showWait();
  });
  $('bt-opt-counter').addEventListener('click', function () {
    settings.counter = !toggleIsOn(this);
    setToggle(this, settings.counter);
  });
  $('bt-score-input').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    if (isNaN(v)) return;
    settings.baseScore = Math.max(1, Math.min(100, v));
  });
  $('bt-mode-prev').addEventListener('click', function () { cycleMode(-1); });
  $('bt-mode-next').addEventListener('click', function () { cycleMode(1); });
  $('bt-opt-limit').addEventListener('click', function () {
    settings.roundLimit = !toggleIsOn(this);
    setToggle(this, settings.roundLimit);
    syncModeUI();
  });
  $('bt-round-input').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    if (isNaN(v)) return;
    settings.roundCount = Math.max(1, Math.min(99, v));
  });
  $('bt-startscore-input').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    if (isNaN(v)) return;
    settings.startScore = Math.max(1, Math.min(1000000, v));
  });
  $('bt-opt-nochat').addEventListener('click', function () {
    settings.noChat = !toggleIsOn(this);
    setToggle(this, settings.noChat);
  });
  $('bt-opt-private').addEventListener('click', function () {
    settings.allowPrivateChat = !toggleIsOn(this);
    setToggle(this, settings.allowPrivateChat);
  });
  $('bt-opt-allow-spec').addEventListener('click', function () {
    settings.allowSpec = !toggleIsOn(this);
    setToggle(this, settings.allowSpec);
  });

  /* ---------- 对局（房主权威） ---------- */
  /* 多局/积分模式：开始新会话（首个对局/结束后的再来一局），重发牌不重置 */
  function startSession() {
    var st = settings.mode === 'points' ? Math.max(1, settings.startScore || 1000) : 0;
    session = { scores: {}, round: 0, wins: {}, losses: {}, over: false, records: [] };
    players.forEach(function (p) {
      if (!p.spec) session.scores[p.id] = st;
    });
  }
  function deal() {
    if (!isHost) return;
    clearTimeout(dealTimer);
    clearAutoNext();   /* 新一局开始，停止局间倒计时 */
    hideModal($('bt-records-modal'));   /* 局间查看记录：开局时自动关闭 */
    recordsFromResult = false;
    if (session && session.over) return;   /* 会话已结束（满局数/有人≤0）不再开局 */
    var ids = players.filter(function (p) { return !p.spec; }).map(function (p) { return p.id; });
    if (ids.length !== 3) return;
    if (settings.mode !== 'single' && !session) startSession();
    var order = shuffle(ids.slice());
    var deck = shuffle(newDeck());
    var bottom = deck.splice(0, 3);
    var hands = {};
    var counts = {};
    ids.forEach(function (id) {
      hands[id] = [];
      for (var r = 0; r < 17; r++) hands[id].push(deck.pop());
      sortHand(hands[id]);
      counts[id] = 17;
    });
    var names = {};
    ids.forEach(function (id) {
      var p = findPlayer(id);
      names[id] = p ? p.name : id;
    });
    game = {
      phase: 'bid',
      roundNo: (game ? game.roundNo : 0) + 1,
      order: order,
      names: names,
      turn: -1,
      bidIdx: Math.floor(Math.random() * 3),
      acted: 0,
      bidder: -1,
      mult: 1,
      landlord: -1,
      lead: -1,
      current: null,
      passers: [],
      playCounts: {},   // 每人实际出牌次数（春天/反春天判定；pass 不计）
      hands: hands,
      counts: counts,
      bottom: bottom,
      result: null
    };
    myIndex = order.indexOf('host');
    sel = {};
    hideModal($('bt-result-modal'));
    if (openState && myId) registerOpenRoom(myId, true);   /* 开放过的房间开局后保留在列表（标记已开局，可经列表加入/观战） */
    broadcastGame();
  }
  function doBid(pi, take) {
    if (!game || game.phase !== 'bid' || game.bidIdx !== pi) return;
    if (take) {
      if (game.bidder !== -1) game.mult++;
      game.bidder = pi;
    }
    game.acted++;
    game.bidIdx = (pi + 1) % game.order.length;
    if (game.acted >= game.order.length) {
      if (game.bidder === -1) {
        /* 无人叫地主：重新发牌 */
        toast('没有人叫地主，重新发牌');
        dealTimer = setTimeout(deal, 700);
        return;
      }
      game.landlord = game.bidder;
      var lid = game.order[game.landlord];
      game.hands[lid] = game.hands[lid].concat(game.bottom);
      sortHand(game.hands[lid]);
      game.counts[lid] = game.hands[lid].length;
      game.phase = 'playing';
      game.turn = game.landlord;
      game.lead = game.landlord;
      game.current = null;
      game.passers = [];
      broadcastGame();
      return;
    }
    broadcastGame();
  }
  function doPlay(pi, cards) {
    if (!game || game.phase !== 'playing' || !cards) return;
    var id = game.order[pi];
    var hand = game.hands[id] || [];
    var keySet = {};
    cards.forEach(function (c) { keySet[c.rank + ':' + c.suit] = true; });
    /* 校验：所有牌都在自己手里 */
    for (var i = 0; i < hand.length; i++) {
      var k = hand[i].rank + ':' + hand[i].suit;
      if (keySet[k]) keySet[k] = 'used';
    }
    var missing = cards.some(function (c) { return keySet[c.rank + ':' + c.suit] !== 'used'; });
    if (missing) return;
    var played = [];
    hand.forEach(function (hc) {
      if (keySet[hc.rank + ':' + hc.suit] === 'used') played.push(hc);
    });
    var comb = combOf(played);
    if (!comb) return;
    if (game.current && game.current.p !== pi && !beats(game.current.comb, comb)) return;
    game.hands[id] = hand.filter(function (hc) { return keySet[hc.rank + ':' + hc.suit] !== 'used'; });
    sortHand(game.hands[id]);
    game.counts[id] = game.hands[id].length;
    game.current = { p: pi, cards: played, comb: comb };
    game.passers = [];
    game.lead = pi;
    game.playCounts[id] = (game.playCounts[id] || 0) + 1;   /* 出牌次数（春天/反春天判定） */
    if (comb.type === 'bomb' || comb.type === 'rocket') game.mult *= 2;   /* 炸弹/王炸：本局倍率翻倍 */
    if (!game.hands[id].length) { win(pi); return; }
    game.turn = (pi + 1) % game.order.length;
    broadcastGame();
  }
  function doPass(pi) {
    if (!game || game.phase !== 'playing') return;
    game.passers.push(pi);
    if (game.passers.length >= 2) {
      /* 其余两家都不要：上一出牌者重新自由出牌 */
      game.current = null;
      game.passers = [];
      game.turn = game.lead;
    } else {
      game.turn = (pi + 1) % game.order.length;
    }
    broadcastGame();
  }
  function win(pi) {
    game.phase = 'over';
    var landlordWon = pi === game.landlord;
    game.result = { winner: pi, landlordWon: landlordWon, over: false, ranking: [], losers: [], spring: false, antiSpring: false };
    /* 春天/反春天：地主胜且农民一局未出牌 → 春天；农民胜且地主只开局出过一次牌 → 反春天。
       两者本局倍率 ×2，胜利方按胜利两次计入全局倍率记录 */
    var pc = game.playCounts || {};
    var landlordId = game.order[game.landlord];
    var spring = landlordWon;
    if (spring) {
      game.order.forEach(function (id) { if (id !== landlordId && (pc[id] || 0) > 0) spring = false; });
    }
    var antiSpring = !landlordWon && (pc[landlordId] || 0) <= 1;
    var doubled = spring || antiSpring;
    if (doubled) game.mult *= 2;
    game.result.spring = spring;
    game.result.antiSpring = antiSpring;
    /* 单局模式：不计倍率与积分，只定本局胜负 */
    if (settings.mode === 'single' || !session) {
      broadcastGame();
      return;
    }
    var b = settings.baseScore || 1;
    var m = game.mult;
    var before = {};
    game.order.forEach(function (id) { before[id] = session.scores[id] || 0; });
    /* 全局倍率按“本局开始前的”胜负差额计算：d=max(总胜-总负,0)，倍率=2-2/(d+2) */
    var rate = {};
    game.order.forEach(function (id) {
      var d = Math.max(0, (session.wins[id] || 0) - (session.losses[id] || 0));
      rate[id] = 2 - 2 / (d + 2);
    });
    /* 基本分：地主胜→地主+2底分、农民各-底分；农民胜反之 */
    var deltas = {};
    game.order.forEach(function (id, i) {
      var base = i === game.landlord ? (landlordWon ? 2 : -2) : (landlordWon ? -1 : 1);
      deltas[id] = Math.round(base * b * m * rate[id]);
    });
    /* 记录胜负与已完成局数（春天/反春天按两胜/两负计） */
    var rec = doubled ? 2 : 1;
    game.order.forEach(function (id, i) {
      var won = landlordWon ? (i === game.landlord) : (i !== game.landlord);
      if (won) session.wins[id] = (session.wins[id] || 0) + rec;
      else session.losses[id] = (session.losses[id] || 0) + rec;
    });
    session.round++;
    /* 应用积分（全局倍率只影响各人自己的得失，总和不必守恒） */
    game.order.forEach(function (id) { session.scores[id] = before[id] + deltas[id]; });
    /* 多局模式：结算后若出现负分，全体加分使最低分回到 0 */
    if (settings.mode === 'multi') {
      var mn = Infinity;
      game.order.forEach(function (id) { mn = Math.min(mn, session.scores[id]); });
      if (mn < 0) {
        var add = -mn;
        game.order.forEach(function (id) { session.scores[id] += add; });
      }
      session.over = !!(settings.roundLimit && session.round >= Math.max(1, settings.roundCount));
    } else {
      /* 积分模式：先扣至 0 分（含以下）者失败，游戏随即结束 */
      var mn2 = Infinity;
      game.order.forEach(function (id) { mn2 = Math.min(mn2, session.scores[id]); });
      if (mn2 <= 0) {
        session.over = true;
        game.order.forEach(function (id) { if (session.scores[id] === mn2) game.result.losers.push(id); });
      }
    }
    /* 展示用得失分 = 结算后总分 - 结算前总分（含反负分补偿） */
    var eff = {};
    game.order.forEach(function (id) { eff[id] = session.scores[id] - before[id]; });
    game.result.deltas = eff;
    /* 记录本局：名称、身份、胜负、总倍率（本局×全局）、积分得失 */
    var rec = { n: session.round, rows: [] };
    game.order.forEach(function (id, i) {
      var won = landlordWon ? (i === game.landlord) : (i !== game.landlord);
      rec.rows.push({
        name: (game.names && game.names[id]) || id,
        role: i === game.landlord ? '地主' : '农民',
        win: won,
        mult: Math.round(m * rate[id] * 100) / 100,
        delta: eff[id],
        total: session.scores[id]
      });
    });
    (session.records = session.records || []).push(rec);
    /* 最终排名（按总积分从高到低） */
    game.order.slice().sort(function (a, b) { return session.scores[b] - session.scores[a]; })
      .forEach(function (id) {
        game.result.ranking.push({ id: id, score: session.scores[id] });
      });
    game.result.over = session.over;
    broadcastGame();
  }
  function handleGameAction(id, a) {
    if (!game || !a) return;
    var pi = game.order.indexOf(id);
    if (pi === -1) return;
    if (game.phase === 'bid') {
      if (game.bidIdx !== pi) return;
      if (typeof a.take !== 'boolean') return;   /* 叫分阶段只接受 take 真值 */
      doBid(pi, a.take);
    } else if (game.phase === 'playing') {
      if (game.turn !== pi) return;
      if (a.a === 'play') doPlay(pi, a.cards || []);
      else if (a.a === 'pass') doPass(pi);
    }
  }
  /* 下发状态：每位玩家只看到自己的手牌（其余为空数组），牌数单独同步；观战者看到全部手牌 */
  function gameFor(id) {
    var g = JSON.parse(JSON.stringify(game));
    for (var pid in g.hands) {
      if (pid !== id) delete g.hands[pid];
    }
    return g;
  }
  function gameForSpec() {
    return JSON.parse(JSON.stringify(game));
  }
  function broadcastGame() {
    hideModal($('bt-wait-modal'));
    for (var i = 0; i < conns.length; i++) {
      if (conns[i].open) conns[i].send({ t: 'state', game: gameFor(conns[i].peer), settings: settings, session: session });
    }
    for (var j = 0; j < specConns.length; j++) {
      if (specConns[j].conn.open) specConns[j].conn.send({ t: 'state', game: gameForSpec(), settings: settings, session: session, spec: true });
    }
    if (isHost) {
      renderGame();
      if (game && game.phase === 'over') showResult();   /* 房主本端也弹结算（新一轮 deal 时会关闭） */
    }
  }

  /* ---------- 座位（仿炸金花轮换：自己 1 号位，其余按顺序 3、7 号位） ---------- */
  function seatOf(id) {
    var seatList = [1, 3, 7];
    if (isSpec) {
      /* 观战者无自己座位：三名牌手按内部顺序固定对应 1 / 3 / 7 号位 */
      var k = game.order.indexOf(id);
      return k >= 0 ? seatList[k % 3] : null;
    }
    var order = game.order.slice();
    var mi = order.indexOf(mySelfId());
    if (mi > 0) order = order.slice(mi).concat(order.slice(0, mi));
    for (var i = 0; i < order.length; i++) if (order[i] === id) return seatList[i];
    return null;
  }
  function handLen(id) {
    if (!game) return 0;
    if (game.counts && game.counts[id] !== undefined) return game.counts[id];
    return (game.hands[id] || []).length;
  }
  /* 玩家的全局倍率：d=max(总胜-总负,0)，倍率 = 2-2/(d+2) */
  function globalRateOf(id) {
    if (!session) return 1;
    var w = (session.wins && session.wins[id]) || 0;
    var l = (session.losses && session.losses[id]) || 0;
    var d = Math.max(0, w - l);
    return 2 - 2 / (d + 2);
  }
  /* 倍率展示：保留两位小数并去掉末尾 0（1 / 1.33 / 1.5 / 1.67） */
  function fmtRate(r) {
    return String(Math.round(r * 100) / 100);
  }

  /* ---------- 渲染 ---------- */
  function renderGame() {
    if (!game) return;
    renderTip();
    renderSeats();
    renderBottom();
    renderCenter();
    renderHand();
    renderPanel();
    renderControls();
    updateCounter();
    updateSpecSeeUI();
    if (specViewMode() && counterOn) renderSpecPanelContent();   /* 看牌条内容随对局刷新 */
  }
  function renderTip() {
    /* 牌桌顶部提示：仅结束时显示，其余留空 */
    tipEl.textContent = game ? (game.phase === 'over' ? '本局结束' : '') : '准备中…';
    /* 左侧状态栏：上行 = 正在行动的玩家，下行 = 局数/本局倍率（仅多局与积分模式显示） */
    var statusTop = '准备中…';
    var statusMult = '';
    if (game) {
      if (session && settings.mode !== 'single') {
        var rd = (session.round || 0) + (game.phase === 'over' ? 0 : 1);
        statusMult = '第 ' + rd + ' 局' + (settings.mode === 'multi' && settings.roundLimit ? '/' + settings.roundCount : '') + ' · 本局倍率 ×' + game.mult;
      }
      if (game.phase === 'bid') {
        statusTop = game.bidIdx === myIndex
          ? (game.bidder === -1 ? '你 叫地主中' : '你 抢地主中')
          : nameOf(game.order[game.bidIdx]) + (game.bidder === -1 ? ' 叫地主中' : ' 抢地主中');
      } else if (game.phase === 'playing') {
        statusTop = game.turn === myIndex ? '你 出牌中' : nameOf(game.order[game.turn]) + ' 出牌中';
      } else if (game.phase === 'over') {
        statusTop = '本局结束';
      }
    }
    statusEl.textContent = statusTop;
    statusMultEl.textContent = statusMult;
  }
  /* 当前行动玩家下标：叫/抢地主阶段看 bidIdx，出牌阶段看 turn，否则 -1 */
  function actingIndex() {
    if (!game) return -1;
    if (game.phase === 'bid') return game.bidIdx;
    if (game.phase === 'playing') return game.turn;
    return -1;
  }
  function renderSeats() {
    if (!game) return;
    var actIdx = actingIndex();
    var actId = actIdx >= 0 ? game.order[actIdx] : null;
    /* 观战者展示全部三名玩家（1/3/7 号位）；玩家只展示对手 */
    var dispIds = isSpec ? game.order.slice() : game.order.filter(function (id) { return id !== mySelfId(); });
    /* 座位：背面牌 + 剩余牌数 */
    dispIds.forEach(function (id) {
      var seat = seatOf(id);
      var el = document.getElementById('bt-seat-' + seat);
      if (!el) return;
      el.innerHTML = '';
      var card = document.createElement('div');
      card.className = 'fc-card bt-opp-card face-down';
      var cnt = document.createElement('span');
      cnt.className = 'bt-opp-count';
      cnt.textContent = handLen(id);
      card.appendChild(cnt);
      el.appendChild(card);
      el.classList.toggle('turn', actId === id);
    });
    /* 娃娃：轮到（叫/抢地主或出牌）时亮色，否则暗色；地主用皇后 */
    tableEl.querySelectorAll('.bt-doll').forEach(function (d) { d.remove(); });
    dispIds.forEach(function (id2) {
      var seat2 = seatOf(id2);
      var isAct = actId === id2;
      var isLandlord = game.landlord !== -1 && game.order[game.landlord] === id2;
      var img = document.createElement('img');
      img.className = 'bt-doll' + (isLandlord ? ' bt-queen' : '');
      img.dataset.seat = String(seat2);
      if (isLandlord) {
        img.src = isAct ? 'texture/queen.png' : 'texture/darkqueen.png';
      } else {
        var base = seat2 === 3 ? 'leftdoll' : (seat2 === 7 ? 'rightdoll' : 'middledoll');
        img.src = isAct ? 'texture/' + base + '.png' : 'texture/' + base + '-dark.png';
      }
      img.alt = '';
      /* 娃娃阴影：亮度 0 的复制图，向右下偏移 5% 娃娃宽（51px），垫在原娃娃下方 */
      var sh = img.cloneNode(false);
      sh.className = img.className + ' bt-doll-shadow';
      sh.removeAttribute('id');
      tableEl.appendChild(sh);
      /* 娃娃信息框：悬停显示、移出隐藏、点击锁定/解锁（锁定后悬停移出无反应） */
      img.addEventListener('mouseenter', function () {
        if (!dollLocked) showDollInfo(seat2);
      });
      img.addEventListener('mouseleave', function () {
        if (!dollLocked && dollSeat === seat2) hideDollInfo();
      });
      img.addEventListener('click', function () {
        if (dollLocked && dollSeat === seat2) {
          dollLocked = false;
          hideDollInfo();
        } else {
          dollLocked = true;
          showDollInfo(seat2);
        }
      });
      tableEl.appendChild(img);
    });
    if (dollSeat !== null) showDollInfo(dollSeat);   /* 信息框显示期间随渲染刷新内容 */
  }

  /* ---------- 娃娃信息框 ---------- */
  function oppIdBySeat(seat) {
    if (!game) return null;
    var opps = game.order.filter(function (id) { return id !== mySelfId(); });
    for (var i = 0; i < opps.length; i++) if (seatOf(opps[i]) === seat) return opps[i];
    return null;
  }
  function fillDollInfo(seat) {
    if (!game) return;
    var box = $('bt-doll-info');
    if (!box) return;
    var id = oppIdBySeat(seat);
    if (!id) return;
    box.dataset.seat = String(seat);
    var idx = game.order.indexOf(id);
    box.querySelector('.bt-doll-info-avatar').innerHTML = avatarInner(id);
    box.querySelector('.bt-doll-info-name').textContent = displayName(id);
    box.querySelector('.bt-doll-info-role').textContent = game.landlord === -1 ? '未选定' : (game.landlord === idx ? '地主' : '农民');
    var turnText;
    if (game.phase === 'playing') turnText = game.turn === idx ? '正在出牌' : '等待中';
    else if (game.phase === 'bid') turnText = game.bidIdx === idx ? (game.bidder === -1 ? '正在叫地主' : '正在抢地主') : '等待中';
    else turnText = '对局结束';
    var turnB = box.querySelector('.bt-doll-info-turn');
    turnB.textContent = turnText;
    turnB.classList.toggle('acting', actingIndex() === idx);
    box.querySelector('.bt-doll-info-cards').textContent = handLen(id);
    /* Score 与全局倍率：仅多局/积分模式显示 */
    var scoreRow = document.getElementById('bt-doll-info-score-row');
    if (scoreRow) {
      if (session && settings.mode !== 'single') {
        scoreRow.classList.remove('hidden');
        box.querySelector('.bt-doll-info-score').textContent =
          ((session.scores && session.scores[id]) || 0) + '(x' + fmtRate(globalRateOf(id)) + ')';
      } else {
        scoreRow.classList.add('hidden');
      }
    }
  }
  function showDollInfo(seat) {
    dollSeat = seat;
    fillDollInfo(seat);
    $('bt-doll-info').classList.remove('hidden');
  }
  function hideDollInfo() {
    dollSeat = null;
    $('bt-doll-info').classList.add('hidden');
  }
  $('bt-doll-info').addEventListener('click', function () {
    if (dollLocked) {
      dollLocked = false;
      hideDollInfo();
    }
  });
  function renderBottom() {
    bottomEl.innerHTML = '';
    if (!game) return;
    game.bottom.forEach(function (c) {
      bottomEl.appendChild(cardEl(c, game.phase !== 'bid'));
    });
  }
  /* 出牌示意排序：带附加牌的牌型按“基础牌 → 附加牌”展示（如 3555 → 5553、5JJJJK → JJJJ5K）；
     基础/附加各自按点数升序（同点数保持原有次序） */
  function orderPlayedCards(cards, comb) {
    if (!comb || cards.length <= 1) return cards;
    var cnt = {};
    cards.forEach(function (c) { cnt[c.rank] = (cnt[c.rank] || 0) + 1; });
    var ranks = Object.keys(cnt).map(Number).sort(function (a, b) { return a - b; });
    var isBase = {};
    if (comb.type === 'triple1' || comb.type === 'triple2') {
      /* 三带一/三带二：基础 = 3 张的那个点数 */
      ranks.forEach(function (r) { isBase[r] = cnt[r] === 3; });
    } else if (comb.type === 'four2' || comb.type === 'four2pairs') {
      /* 四带二/四带两对：基础 = 4 张的那个点数 */
      ranks.forEach(function (r) { isBase[r] = cnt[r] === 4; });
    } else if (comb.type === 'airplane') {
      /* 飞机（含带牌）：基础 = 连续且各 3 张、长度 = comb.len 的那段 */
      var c3 = ranks.filter(function (r) { return cnt[r] === 3; });
      for (var i = 0; i + comb.len <= c3.length; i++) {
        var ok = true;
        for (var j = 1; j < comb.len; j++) if (c3[i + j] !== c3[i] + j) { ok = false; break; }
        if (ok) {
          for (var j2 = 0; j2 < comb.len; j2++) isBase[c3[i + j2]] = true;
          break;
        }
      }
    } else {
      ranks.forEach(function (r) { isBase[r] = true; });
    }
    return cards.slice().sort(function (a, b) {
      var ba = isBase[a.rank] ? 0 : 1;
      var bb = isBase[b.rank] ? 0 : 1;
      if (ba !== bb) return ba - bb;
      return a.rank - b.rank;
    });
  }
  function renderCenter() {
    centerEl.innerHTML = '';
    if (!game) return;
    if (game.current) {
      var cur = game.current;
      var isMe = cur.p === myIndex;
      var seat = isMe ? 1 : seatOf(game.order[cur.p]);
      var tableW = tableEl.clientWidth || 600;
      var tableH = tableEl.clientHeight || 450;
      var cw = cardWidth();
      var n = cur.cards.length;
      var step = cw * 0.6;
      if (isMe) {
        /* 自己的出牌：单行，宽度不超出牌桌 */
        if (n > 1) {
          var fit = (tableW - cw * 2 - 16) / (n - 1);
          if (step > fit) step = fit;
        }
        centerEl.style.flexWrap = 'nowrap';
        centerEl.style.maxWidth = '';
        centerEl.style.justifyContent = 'center';
      } else {
        /* 对手的出牌：最多两行，每行不超过牌桌宽 45% */
        var maxRowW = Math.round(tableW * 0.45);
        var perRow = 1;
        if (n > 1) {
          perRow = Math.floor((maxRowW - cw) / step) + 1;
          if (perRow < 1) perRow = 1;
          if (Math.ceil(n / perRow) > 2) perRow = Math.ceil(n / 2);
          var fit2 = (maxRowW - cw) / (perRow - 1);
          if (step > fit2) step = fit2;
        }
        centerEl.style.flexWrap = 'wrap';
        centerEl.style.maxWidth = maxRowW + 'px';
        centerEl.style.justifyContent = seat === 7 ? 'flex-start' : (seat === 1 ? 'center' : 'flex-end');
      }
      centerEl.style.flexDirection = 'row';
      centerEl.style.rowGap = '4px';
      var showCards = orderPlayedCards(cur.cards, cur.comb);
      /* 对手出牌超过一行（换行展示）时：上下两行重叠 50% 牌高，后一行（第二行）图层在上 */
      var secondRow = !isMe && n > 1 ? perRow : n;
      showCards.forEach(function (c, i) {
        var el = cardEl(c, true);
        if (i > 0) el.style.marginLeft = (-(cw - step)) + 'px';
        if (i >= secondRow) el.style.marginTop = (-(cw * 1.54385 * 0.5)) + 'px';
        centerEl.appendChild(el);
      });
      /* 定位 */
      var tr = tableEl.getBoundingClientRect();
      var scale = tableW / (tr.right - tr.left);
      if (isMe) {
        /* 靠底边界居中，距底边界 4.5%；手牌遮挡或下方选项条出现时再上移 */
        var optBar = $('bt-opt-bar');
        var barOn = optBar && btSettings.actionPos === 'bottom' && !optBar.classList.contains('hidden');
        var base = tableH * (barOn ? 0.21 : 0.045);
        var hr = handEl.getBoundingClientRect();
        var overlap = tr.bottom - hr.top;
        if (overlap > 0) base += overlap * scale;
        centerEl.style.left = '50%';
        centerEl.style.top = 'auto';
        centerEl.style.right = 'auto';
        centerEl.style.bottom = base + 'px';
        centerEl.style.transform = 'translateX(-50%)';
      } else {
        /* 贴住对应计数组的右缘（左玩家）/左缘（右玩家），竖直与计数组居中；
           1 号位（观战视角，牌桌下方计数组）：在计数组上方水平居中 */
        var seatEl = document.getElementById('bt-seat-' + seat);
        var countCard = seatEl ? seatEl.querySelector('.bt-opp-card') : null;
        if (countCard) {
          var cr = countCard.getBoundingClientRect();
          if (seat === 1) {
            centerEl.style.left = '50%';
            centerEl.style.right = 'auto';
            centerEl.style.top = 'auto';
            centerEl.style.bottom = ((tr.bottom - cr.top) * scale + 8 * scale) + 'px';
            centerEl.style.transform = 'translateX(-50%)';
          } else if (seat === 7) {
            centerEl.style.left = ((cr.right - tr.left) * scale + 6 * scale) + 'px';
            centerEl.style.right = 'auto';
            centerEl.style.top = ((cr.top - tr.top + cr.height / 2) * scale) + 'px';
            centerEl.style.bottom = 'auto';
            centerEl.style.transform = 'translateY(-50%)';
          } else {
            centerEl.style.right = ((tr.right - cr.left) * scale + 6 * scale) + 'px';
            centerEl.style.left = 'auto';
            centerEl.style.top = ((cr.top - tr.top + cr.height / 2) * scale) + 'px';
            centerEl.style.bottom = 'auto';
            centerEl.style.transform = 'translateY(-50%)';
          }
        }
      }
    }
  }
  function cardWidth() {
    var v = parseFloat(getComputedStyle(tableEl).getPropertyValue('--bt-c'));
    return isNaN(v) || v <= 0 ? 45 : v;
  }
  function handCardWidth() {
    /* 手牌大小由设置控制：高度 = 页面高度 / 5 × 缩放（50%–150%），不随牌桌变化 */
    var h = window.innerHeight / 5 * (btSettings.handScale || 1);
    return Math.round(h / 1.54385);
  }
  /* 手牌宽度解析：相邻牌最多重叠 70% 牌宽（最少显示 30%），
     若 70% 重叠仍放不下整行则缩小牌面宽度 */
  function resolveHandCw(target) {
    var n = 0;
    if (game && game.hands && mySelfId()) n = (game.hands[mySelfId()] || []).length;
    if (n <= 1) return target;
    var avail = window.innerWidth - 16;
    var need = target + (n - 1) * target * 0.3;   /* 70% 重叠时的整行宽 */
    if (need <= avail) return target;
    return Math.max(48, Math.floor(avail / (1 + 0.3 * (n - 1))));
  }
  function dollSpacePx() { return Math.round(80 * (btSettings.tableScale || 1)); }
  function cardEl(c, faceUp) {
    var div = document.createElement('div');
    div.className = 'fc-card' + (faceUp ? '' : ' face-down');
    if (faceUp) {
      /* 仅翻开的牌设置花色，供边框着色模式使用（面朝下的牌保持默认金色） */
      div.dataset.suit = c.suit;
      div.dataset.rank = c.rank;
      if (isJoker(c.rank)) {
        var jk = document.createElement('img');
        jk.className = 'bt-joker-face';
        jk.src = JOKER_IMG[c.rank];
        jk.alt = '';
        jk.draggable = false;
        div.appendChild(jk);
      } else {
        var r1 = document.createElement('img');
        r1.className = 'fc-rank';
        r1.src = RANK_IMG[c.rank];
        r1.alt = '';
        r1.draggable = false;
        var r2 = document.createElement('img');
        r2.className = 'fc-rank-br';
        r2.src = RANK_IMG[c.rank];
        r2.alt = '';
        r2.draggable = false;
        var s = document.createElement('img');
        s.className = 'fc-suit';
        s.src = (btSettings.twoColor ? SUIT_IMG_TC : SUIT_IMG)[c.suit];
        s.alt = '';
        s.draggable = false;
        div.appendChild(r1);
        div.appendChild(r2);
        div.appendChild(s);
      }
    }
    return div;
  }
  function renderHand() {
    handEl.innerHTML = '';
    if (!game) return;
    if (isSpec) { handEl.classList.add('hidden'); return; }   /* 观战者无手牌 */
    if (btHandHidden) return;   /* 已用手势/按钮隐藏 */
    handEl.classList.remove('hidden');
    var cards = game.hands[mySelfId()] || [];
    if (!cards.length) return;
    var cw = resolveHandCw(handCardWidth());
    var n = cards.length;
    /* 相邻牌默认重叠 50%（最少显示 30%＝重叠上限 70%）；整行放不下时只允许缩牌，不继续加大重叠 */
    var avail = window.innerWidth - 16;
    var step = cw * 0.5;
    if (n > 1) {
      var minStep = cw * 0.3;
      var fit = (avail - cw) / (n - 1);
      if (fit < minStep) fit = minStep;
      if (step > fit) step = fit;
    }
    cards.forEach(function (c, i) {
      var el = cardEl(c, true);
      el.dataset.idx = i;
      if (sel[i]) el.classList.add('sel');
      if (i > 0) el.style.marginLeft = (-(cw - step)) + 'px';
      handEl.appendChild(el);
    });
  }
  function markSel(idx, on) {
    var el = handEl.children[idx];
    if (el) el.classList.toggle('sel', on);
  }
  function renderPanel() {
    playerPanelEl.innerHTML = '';
    if (!game) return;
    var actIdx = actingIndex();
    game.order.forEach(function (id, idx) {
      var isMe = id === mySelfId();
      var card = document.createElement('div');
      card.className = 'player-card';
      if (actIdx === idx) card.classList.add('turn');   /* 叫/抢地主与出牌中的玩家均高亮 */
      if (game.landlord === idx) card.classList.add('bt-landlord');
      var av = document.createElement('div');
      av.className = 'avatar';
      av.innerHTML = avatarInner(id) + '<img class="avatar-border" src="texture/avatarboarder.png" alt="">';
      card.appendChild(av);
      var info = document.createElement('div');
      info.className = 'pinfo';
      var nm = document.createElement('div');
      nm.className = 'pname';
      nm.textContent = displayName(id) + (isMe ? '（我）' : '');
      var role = document.createElement('div');
      role.className = 'bt-role-text';
      role.textContent = game.landlord === -1 ? '未选定' : (game.landlord === idx ? '地主' : '农民');
      var cnt = document.createElement('div');
      cnt.className = 'bt-count-text';
      cnt.textContent = '手牌 ' + handLen(id) + ' 张';
      info.appendChild(nm);
      info.appendChild(role);
      info.appendChild(cnt);
      /* 单局模式不计积分；多局/积分模式显示会话积分与各自的全局倍率 */
      if (session && settings.mode !== 'single') {
        var sc = document.createElement('div');
        var scv = session.scores[id] || 0;
        sc.className = 'bt-score' + (scv < 0 ? ' neg' : '');
        sc.textContent = 'Score ' + scv + '(x' + fmtRate(globalRateOf(id)) + ')';
        info.appendChild(sc);
      }
      card.appendChild(info);
      playerPanelEl.appendChild(card);
    });
  }
  /* 玩家头像 HTML：自己用 Profile，其余用联机交换的头像；未设置时按各自座位用不同符号（非固定同一符号） */
  function avatarInner(id) {
    var prof = id === mySelfId() ? Profile.get() : (avatars[id] || null);
    if (prof && prof.avatar === 'custom' && prof.avatarData) {
      var smooth = prof.avatarSmooth !== false;   /* 线性插值开关 */
      return '<img class="avatar-img' + (smooth ? ' smooth' : '') + '" src="' + prof.avatarData + '">';
    }
    if (prof && prof.avatar && prof.avatar.indexOf('piece:') === 0) {
      var parts = prof.avatar.slice(6).split(':');
      var color = parts[0] === 'auto' ? 'w' : parts[0];
      return '<img class="avatar-img piece" src="' + PIECE_IMG[color][parts[1]] + '">';
    }
    var idx = game ? game.order.indexOf(id) : -1;
    return '<span class="avatar-glyph">' + GLYPHS[idx >= 0 ? idx % GLYPHS.length : 0] + '</span>';
  }
  /* 出牌选项摆放：设置=左侧面板→放 .controls；牌桌下方→移入牌桌内底部选项条 */
  function applyActionPos() {
    var bar = $('bt-opt-bar');
    var controls = document.getElementById('bt-controls');
    if (!bar || !controls) return;
    var toBar = btSettings.actionPos === 'bottom';
    ['btn-bid', 'btn-nobid', 'btn-play', 'btn-pass'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var target = toBar ? bar : controls;
      if (el.parentNode !== target) target.appendChild(el);
    });
    /* 未轮到自己的等待占位按钮（仅选项条内使用） */
    var wait = $('bt-wait-tip');
    if (!wait) {
      wait = document.createElement('button');
      wait.id = 'bt-wait-tip';
      wait.type = 'button';
      wait.className = 'btn';
      wait.disabled = true;
      wait.textContent = '请等待其他玩家出牌';
      bar.appendChild(wait);
    } else if (wait.parentNode !== bar) {
      bar.appendChild(wait);
    }
  }
  function renderControls() {
    var myBidTurn = game && game.phase === 'bid' && game.bidIdx === myIndex;
    var myPlayTurn = game && game.phase === 'playing' && game.turn === myIndex;
    /* 观战者：无任何出牌/叫地主操作，左侧仅 设置/记牌器/看牌/发送消息 */
    if (isSpec) {
      var barS = $('bt-opt-bar');
      if (barS) barS.classList.add('hidden');
      ['btn-bid', 'btn-nobid', 'btn-play', 'btn-pass', 'btn-hint'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      $('btn-bt-records').classList.add('hidden');
      $('btn-bt-counter').classList.toggle('hidden', !settings.counter);
      $('btn-bt-chat').classList.toggle('hidden', !!settings.noChat);
      var homeS = !!(game && game.phase === 'over');
      $('btn-bt-home').classList.toggle('hidden', !homeS);
      updateSpecSeeUI();
      updateHandBtn();
      stripShortcutLabels();
      return;
    }
    applyActionPos();
    /* 牌桌下方选项条：仅在“牌桌下方”模式且对局进行中显示；未轮到时仅显示禁用的等待按钮 */
    var bar = $('bt-opt-bar');
    var inRound = !!(game && (game.phase === 'bid' || game.phase === 'playing'));
    var barOn = btSettings.actionPos === 'bottom' && inRound;
    if (bar) bar.classList.toggle('hidden', !barOn);
    var waitBtn = $('bt-wait-tip');
    if (waitBtn) waitBtn.classList.toggle('hidden', !barOn || !!(myBidTurn || myPlayTurn));
    /* 记录按钮：多局/积分模式显示 */
    $('btn-bt-records').classList.toggle('hidden', !(session && settings.mode !== 'single'));
    /* 发送消息按钮：房主禁用消息时隐藏 */
    $('btn-bt-chat').classList.toggle('hidden', !!settings.noChat);
    /* 返回主界面：对局结束前不显示；多局/积分模式的局间结算也不显示（限制局数/积分模式不可中途退出） */
    var showHome = !!(game && game.phase === 'over' && (settings.mode === 'single' || !session || session.over));
    $('btn-bt-home').classList.toggle('hidden', !showHome);
    /* 记牌器按钮：房主未启用则不显示 */
    $('btn-bt-counter').classList.toggle('hidden', !settings.counter);
    /* 手牌牌框：轮到自己变亮，否则变暗 */
    handEl.classList.toggle('bt-myturn', !!(myBidTurn || myPlayTurn));
    updateHandBtn();
    stripShortcutLabels();
    $('btn-bid').classList.toggle('hidden', !myBidTurn);
    $('btn-nobid').classList.toggle('hidden', !myBidTurn);
    if (myBidTurn) {
      $('btn-bid').textContent = game.bidder === -1 ? '叫地主(enter)' : '抢地主(enter)';
      $('btn-nobid').textContent = game.bidder === -1 ? '不叫(space)' : '不抢(space)';
      stripShortcutLabels();
    }
    /* 出牌/提示/不要：非自己回合（含操作后）一律隐藏，避免“不要/要不起”按钮残留 */
    $('btn-play').classList.toggle('hidden', !myPlayTurn);
    $('btn-hint').classList.toggle('hidden', !myPlayTurn);
    $('btn-pass').classList.toggle('hidden', !myPlayTurn);
    if (myPlayTurn) {
      var canPass = !!(game.current && game.current.p !== myIndex);
      /* 对方出的牌要不起：只显示"要不起(space)" */
      var cannotBeat = canPass &&
        choosePlay(game.hands[mySelfId()] || [], game.current.comb) === null;
      if (cannotBeat) {
        $('btn-play').classList.add('hidden');
        $('btn-hint').classList.add('hidden');
        $('btn-pass').classList.remove('hidden');
        $('btn-pass').textContent = '要不起(space)';
        stripShortcutLabels();
      } else {
        $('btn-play').classList.remove('hidden');
        $('btn-hint').classList.remove('hidden');
        $('btn-pass').classList.toggle('hidden', !canPass);
        $('btn-pass').textContent = '不要(space)';
        stripShortcutLabels();
      }
    }
    updateHandBtn();
    stripShortcutLabels();
  }

  /* ---------- 记牌器 ---------- */
  /* 只记录已经打出的牌：每个点数显示已出张数（全部打出即 4 张/大小王 1 张） */
  function initCounter() {
    var el = document.getElementById('bt-counter-ranks');
    if (!el || el.children.length) return;
    for (var r = 3; r <= 17; r++) {
      var s = document.createElement('span');
      s.className = 'bt-cr';
      s.dataset.rank = String(r);
      var top = document.createElement('div');
      top.className = 'bt-cr-top';
      var lab = document.createElement('img');
      lab.className = 'bt-cr-r';
      lab.src = RANK_IMG[r] || JOKER_IMG[r];
      lab.alt = RANK_LABEL[r];
      /* 各牌型贴图宽高比：Card-10.png 为 10:7，其余为 1:1（含大小王 11:11） */
      lab.style.setProperty('--r-w', (r === 10 ? (10 / 7) : 1).toFixed(6));
      top.appendChild(lab);
      var cnt = document.createElement('i');
      cnt.className = 'bt-cr-c';
      cnt.textContent = '0';
      s.appendChild(top);
      s.appendChild(cnt);
      el.appendChild(s);
    }
  }
  function updateCounter() {
    if (!settings.counter) return;
    /* 观战者已看牌：顶部区域用于看牌条（玩家手牌），不再更新记牌器网格 */
    if (specViewMode()) {
      if (counterOn) renderSpecPanelContent();
      return;
    }
    var counts = {};
    if (game) {
      /* 换局重置已出牌记录 */
      if (game.roundNo !== counterRound) { playedCards = {}; counterRound = game.roundNo; }
      if (game.current && game.current.cards) {
        game.current.cards.forEach(function (c) { playedCards[c.rank + ':' + c.suit] = true; });
      }
      for (var k in playedCards) {
        var r0 = Number(k.split(':')[0]);
        counts[r0] = (counts[r0] || 0) + 1;
      }
    }
    var el = document.getElementById('bt-counter-ranks');
    if (!el) return;
    for (var i = 0; i < el.children.length; i++) {
      var s = el.children[i];
      var rk = parseInt(s.dataset.rank, 10);
      var v = counts[rk] || 0;
      var cntEl = s.querySelector('.bt-cr-c');
      if (cntEl) cntEl.textContent = String(v);
      s.classList.toggle('out', v >= DECK_CNT[rk]);   /* 该点数已全部打出 */
    }
  }
  /* 观战者看牌条：面板内容随开关切换；记牌器与看牌条共用同一位置 */
  function specViewMode() { return !!(isSpec && specViewed && game); }
  function refreshCounterContent() {
    var viewing = specViewMode();
    var frame = $('bt-counter-frame');
    var panel = $('bt-spec-panel');
    if (frame) frame.classList.toggle('hidden', viewing);
    if (panel) panel.classList.toggle('hidden', !viewing);
    if (viewing) renderSpecPanelContent();
  }
  function renderSpecPanelContent() {
    if (!game) return;
    if (specIdx >= game.order.length) specIdx = 0;
    if (specIdx < 0) specIdx = game.order.length - 1;
    var id = game.order[specIdx];
    var nameEl = $('bt-spec-name');
    var cntEl = $('bt-spec-cnt');
    if (nameEl) {
      var role = btChatRoleLabel(id);
      nameEl.textContent = (game.names && game.names[id]) || id + (role ? '(' + role + ')' : '');
    }
    if (cntEl) cntEl.textContent = '剩余 ' + handLen(id) + ' 张';
    var box = $('bt-spec-cards');
    if (!box) return;
    box.innerHTML = '';
    var cards = (game.hands && game.hands[id]) || [];
    var cw = 32.5;
    var sc = parseFloat(getComputedStyle($('bt-counter')).getPropertyValue('--cscale'));
    if (isNaN(sc) || sc <= 0) sc = 1;
    cw *= sc;
    var els = [];
    cards.forEach(function (c) {
      var el = cardEl(c, true);
      box.appendChild(el);
      els.push(el);
    });
    /* 相邻小牌重叠 50%（同对局者下方手牌），仅当超出可视宽度时收紧 */
    var n2 = els.length;
    if (n2 > 1) {
      var step = cw * 0.5;
      var fit = (window.innerWidth - 16 - cw) / (n2 - 1);
      if (step > fit) step = Math.max(0, fit);
      for (var i = 1; i < n2; i++) els[i].style.marginLeft = (-(cw - step)) + 'px';
    }
  }
  function showCounter() {
    if (!settings.counter) return;
    counterOn = true;
    $('bt-counter').classList.remove('hidden');
    refreshCounterContent();
    updateCounterBtn();
  }
  function hideCounter() {
    counterOn = false;
    $('bt-counter').classList.add('hidden');
    updateCounterBtn();
  }
  function updateCounterBtn() {
    var b = $('btn-bt-counter');
    if (!b) return;
    var viewing = specViewMode();
    if (viewing) b.textContent = counterOn ? '隐藏玩家手牌(X)' : '显示玩家手牌(Z)';
    else b.textContent = counterOn ? '隐藏记牌器(X)' : '显示记牌器(Z)';
  }
  /* 看牌：本轮内开启后不可撤销，直到下一局自动恢复（按钮变暗、文案"已看牌"） */
  function updateSpecSeeUI() {
    var b = $('btn-bt-see');
    if (!b) return;
    if (!isSpec || !game) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.textContent = specViewed ? '已看牌' : '看牌';
    b.classList.toggle('dim', specViewed);
  }
  $('btn-bt-see').addEventListener('click', function () {
    if (!isSpec || !game) return;
    if (specViewed) { toast('本轮已看牌，下一局自动恢复'); return; }
    specViewed = true;
    specViewedRound = game.roundNo;
    if (counterOn) refreshCounterContent();   /* 若顶部条已开，立即切换为看牌内容 */
    updateSpecSeeUI();
    updateCounterBtn();
    toast('已开启看牌：点击"显示玩家手牌(Z)"查看玩家手牌');
  });
  $('bt-spec-prev').addEventListener('click', function () { specIdx--; renderSpecPanelContent(); });
  $('bt-spec-next').addEventListener('click', function () { specIdx++; renderSpecPanelContent(); });

  /* 手牌显隐（手机/平板）：下滑下半屏隐藏、上滑下半屏显示；按钮与手势同步 */
  var btHandHidden = false;
  function setHandShown(v) {
    btHandHidden = !v;
    handEl.classList.toggle('hidden', btHandHidden);
    /* 显示时立即重排手牌，避免空手牌条一直显示（仅依赖下一局渲染导致的“再显示不了”） */
    if (!isSpec && game) {
      if (!btHandHidden) {
        handEl.style.setProperty('--bt-hand-c', resolveHandCw(handCardWidth()) + 'px');
        renderHand();
      } else {
        handEl.innerHTML = '';
      }
    }
    updateHandBtn();
  }
  function toggleHandShown() { setHandShown(btHandHidden); }
  function updateHandBtn() {
    var b = $('btn-bt-hand');
    if (!b) return;
    var vis = btNarrow() && !!game && !isSpec;
    b.classList.toggle('hidden', !vis);
    b.textContent = btHandHidden ? '显示手牌' : '隐藏手牌';
  }
  $('btn-bt-hand').addEventListener('click', toggleHandShown);
  /* 手机/平板手势：上半屏快速上滑隐藏记牌器/手牌条、下滑显示；下半屏下滑隐藏手牌、上滑显示 */
  var btGesture = null;
  document.addEventListener('pointerdown', function (e) {
    if (!btNarrow() || !game) { btGesture = null; return; }
    if (e.target && e.target.closest && e.target.closest('.bt-hand, .bt-opt-bar, .controls, .chat-option, button, input')) { btGesture = null; return; }
    btGesture = { y: e.clientY, t: Date.now(), id: e.pointerId };
  });
  document.addEventListener('pointerup', function (e) {
    if (!btGesture || e.pointerId !== btGesture.id) return;
    var y0 = btGesture.y;
    var dy = e.clientY - y0;
    var dt = Date.now() - btGesture.t;
    var h = window.innerHeight;
    btGesture = null;
    if (dt > 600) return;
    if (Math.abs(dy) < h * 0.2) return;
    if (y0 < h / 2) {
      /* 上半屏 */
      if (dy < 0) hideCounter();
      else showCounter();
    } else {
      /* 下半屏 */
      if (dy > 0) setHandShown(false);
      else setHandShown(true);
    }
  });
  document.addEventListener('pointercancel', function () { btGesture = null; });

  /* 手机/平板按键文案去掉快捷键提示（enter/space/tab/Z/X 等） */
  function stripShortcutLabels() {
    if (!btNarrow()) return;
    var ids = ['btn-bid', 'btn-nobid', 'btn-play', 'btn-pass', 'btn-hint', 'btn-bt-counter', 'btn-bt-see', 'btn-bt-chat'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.textContent = el.textContent.replace(/\([^()]*\)$/g, '');
    }
  }

  /* ---------- 查看记录（多局/积分模式，仿炸金花） ---------- */
  var recordsFromResult = false;
  var updateBtRecordsScrollbar = Profile.wireScrollbar(
    $('bt-records-body'),
    $('bt-records-scrollbar'),
    $('bt-records-scrollbar-thumb')
  );
  function renderRecords() {
    var body = $('bt-records-body');
    body.innerHTML = '';
    var recs = (session && session.records) || [];
    if (!recs.length) {
      var empty = document.createElement('div');
      empty.className = 'zjh-records-empty';
      empty.textContent = '暂无记录';
      body.appendChild(empty);
      return;
    }
    recs.forEach(function (rec) {
      var title = document.createElement('p');
      title.className = 'fc-set-label';
      title.textContent = '第 ' + rec.n + ' 局';
      body.appendChild(title);
      var hr = document.createElement('hr');
      hr.className = 'setting-divider';
      body.appendChild(hr);
      rec.rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'bt-record-row' + (r.win ? ' win' : '');
        var name = document.createElement('span');
        name.className = 'bt-record-name';
        name.textContent = r.name;
        var info = document.createElement('span');
        info.className = 'bt-record-info';
        info.textContent = r.role + ' ' + (r.win ? '胜利' : '失败');
        var mult = document.createElement('span');
        mult.className = 'bt-record-mult';
        mult.textContent = 'x' + r.mult;
        var score = document.createElement('span');
        score.className = 'bt-record-delta' + (r.delta > 0 ? ' pos' : (r.delta < 0 ? ' neg' : ''));
        score.textContent = r.total + '(' + (r.delta > 0 ? '+' : '') + r.delta + ')';
        row.appendChild(name);
        row.appendChild(info);
        row.appendChild(mult);
        row.appendChild(score);
        body.appendChild(row);
      });
    });
  }
  function openRecords(fromResult) {
    renderRecords();
    recordsFromResult = !!fromResult;
    showModal($('bt-records-modal'));
    updateBtRecordsScrollbar();
  }
  $('btn-bt-records').addEventListener('click', function () { openRecords(false); });
  $('btn-bt-result-records').addEventListener('click', function () { openRecords(true); });
  $('btn-bt-records-close').addEventListener('click', function () {
    hideModal($('bt-records-modal'));
    if (recordsFromResult) {
      recordsFromResult = false;
      showModal($('bt-result-modal'));
    }
  });

  /* ---------- 发送消息（仿 chess / zjh 聊天） ---------- */
  /* 预设消息树：
     主题（我/地主/农民/队友/观战者）→ 说法 → 可选牌型；
     观战者为叶子（battle 暂无观战者，预留） */
  var BT_CHAT_TYPE3 = ['好牌', '烂牌', '大牌', '小牌', '大王', '小王', '单张', '对子', '三张', '顺子', '双顺', '三带一', '三带二', '飞机', '四带二', '炸弹', '王炸'];
  var BT_CHAT_OTHER2 = ['有', '没有', '有没有', '可以出', '不要出牌', '我等的花都谢了', '给阿姨倒一杯卡布奇诺', '帮帮我', '不要帮我', '会玩', '不会玩', '要赢了', '要输了', '看我操作'];
  var BT_CHAT_ME2 = ['有', '没有', '要赢了', '要输了', '会玩', '不会玩', '在思考', '牌好', '牌烂'];
  var BT_CHAT_SPEC2 = ['帮帮我', '不要帮我', '不要提醒'];
  var btChatPath = [];    /* 当前预设选择路径（文字） */
  var btChatSel = {};     /* 私聊目标玩家 id → true（空 = 全体广播） */

  function btChatRoleLabel(id) {
    if (!game || game.landlord === -1 || game.order[game.landlord] === undefined) return '';
    return game.order[game.landlord] === id ? '地主' : '农民';
  }
  /* 聊天收件人（他人）：对局中为另外两名玩家，大厅为房间其他成员 */
  function btChatOthers() {
    var list = [];
    if (game && game.order) {
      game.order.forEach(function (id) {
        if (id === mySelfId()) return;
        list.push({ id: id, name: (game.names && game.names[id]) || id, role: btChatRoleLabel(id) });
      });
    } else {
      players.forEach(function (p) {
        if (p.id === mySelfId()) return;
        list.push({ id: p.id, name: p.name, role: '' });
      });
    }
    return list;
  }
  /* 主题列表：随我的身份变化（地主/农民/队友） */
  function btChatSubjects() {
    var me = mySelfId();
    var isLandlord = !!(game && game.landlord !== -1 && game.order[game.landlord] === me);
    var isFarmer = !!(game && game.landlord !== -1 && !isLandlord);
    var subs = ['我'];
    if (!isLandlord) subs.push('地主');
    if (!isFarmer) subs.push('农民');
    if (isFarmer) subs.push('队友');
    subs.push('观战者');
    return subs;
  }
  function btChatLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 255 ? 2 : 1;
    return n;
  }
  function btMakeChatOpt(label, sel, cb) {
    var b = document.createElement('button');
    b.className = 'chat-option' + (sel ? ' sel' : '');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', cb);
    return b;
  }
  function btRenderPreset() {
    /* 保持滚动位置：重绘后内容高度变化可能导致列表回到顶部（同 chess 的修复方式） */
    var presetEl = document.querySelector('.chat-preset');
    var prevScroll = presetEl ? presetEl.scrollTop : 0;
    try {
      var opEls = [1, 2, 3].map(function (n) { return $('bt-chat-op-' + n); });
      opEls.forEach(function (el) { if (el) el.innerHTML = ''; });
      var l1 = btChatPath[0] || '';
      btChatSubjects().forEach(function (label) {
        opEls[0].appendChild(btMakeChatOpt(label, l1 === label, function () {
          btChatPath = l1 === label ? [] : [label];
          btRenderPreset();
        }));
      });
      if (!btChatPath.length) return;
      var l2 = btChatPath[1] || '';
      var opts2 = l1 === '我' ? BT_CHAT_ME2 : (l1 === '观战者' ? BT_CHAT_SPEC2 : BT_CHAT_OTHER2);
      opts2.forEach(function (label) {
        opEls[1].appendChild(btMakeChatOpt(label, l2 === label, function () {
          btChatPath = l2 === label ? btChatPath.slice(0, 1) : [l1, label];
          btRenderPreset();
        }));
      });
      if (l1 === '观战者' || !l2) return;
      /* 三级牌型：说“有/没有/有没有/可以出”（观战者与部分“我”选项无下级） */
      var need3 = (l1 === '我') ? (l2 === '有' || l2 === '没有')
        : (l2 === '有' || l2 === '没有' || l2 === '有没有' || l2 === '可以出');
      if (!need3) return;
      var l3 = btChatPath[2] || '';
      BT_CHAT_TYPE3.forEach(function (label) {
        opEls[2].appendChild(btMakeChatOpt(label, l3 === label, function () {
          btChatPath = l3 === label ? btChatPath.slice(0, 2) : btChatPath.slice(0, 2).concat(label);
          btRenderPreset();
        }));
      });
    } finally {
      if (presetEl) presetEl.scrollTop = prevScroll;
    }
  }
  function btRenderTargets() {
    /* 私聊关闭：自动全选且不可取消；开启后逐个勾选（可多选，全不选 = 发全体）；观战者只能发全体 */
    var locked = !settings.allowPrivateChat || isSpec;
    var el = $('bt-chat-players');
    el.innerHTML = '';
    var list = btChatOthers();
    if (!list.length) {
      var none = document.createElement('div');
      none.className = 'chat-player';
      none.textContent = '暂无其他玩家';
      el.appendChild(none);
      return;
    }
    if (locked) {
      btChatSel = {};
      list.forEach(function (m) { btChatSel[m.id] = true; });
    }
    list.forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'chat-player' + (btChatSel[m.id] ? ' sel' : '');
      b.type = 'button';
      b.textContent = m.name + (m.role ? '(' + m.role + ')' : '');
      b.addEventListener('click', function () {
        if (locked) return;
        btChatSel[m.id] = !btChatSel[m.id];
        if (!btChatSel[m.id]) delete btChatSel[m.id];
        b.classList.toggle('sel', !!btChatSel[m.id]);
      });
      el.appendChild(b);
    });
  }
  function btOpenChat() {
    if (settings.noChat) { toast('本局已禁用发送消息'); return; }
    if (isSpec && specViewed) { toast('看牌后本轮内不能发送消息'); return; }
    if (!mySelfId() && !isSpec) { toast('连接未就绪'); return; }
    btChatPath = [];
    btChatSel = {};
    $('bt-chat-input').value = '';
    btRenderTargets();
    btRenderPreset();
    showModal($('bt-chat-modal'));
  }
  function btShowChatMsg(fromPrefix, text) {
    if (btSettings.hideChat) return;
    var layer = document.getElementById('chat-layer');
    if (!layer) return;
    var msg = document.createElement('div');
    msg.className = 'chat-msg';
    var t = document.createElement('span');
    t.className = 'chat-text';
    t.textContent = fromPrefix + ' 说: ' + text;
    var bar = document.createElement('div');
    bar.className = 'chat-bar';
    msg.appendChild(t);
    msg.appendChild(bar);
    layer.insertBefore(msg, layer.firstChild);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { msg.classList.add('show'); });
    });
    setTimeout(function () {
      msg.classList.add('fade');
      setTimeout(function () { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 220);
    }, 8000);
  }
  /* 房主：收到他人消息时按目标显示与转发（禁言忽略；to 为空数组 = 全体） */
  function btHostRouteChat(fromConn, data) {
    if (settings.noChat) return;
    var to = data.to || [];
    if (fromConn && (!to.length || to.indexOf('host') !== -1)) btShowChatMsg(data.from, data.text);
    for (var i = 0; i < conns.length; i++) {
      if (conns[i] === fromConn) continue;
      if (to.length && to.indexOf(conns[i].peer) === -1) continue;
      if (conns[i].open) conns[i].send({ t: 'chat', from: data.from, text: data.text });
    }
  }
  function btSendChat() {
    if (settings.noChat) { toast('本局已禁用发送消息'); return; }
    var input = $('bt-chat-input');
    var text = '';
    if (input.value.trim()) {
      text = input.value.trim();
      var len = btChatLen(text);
      if (len < 1 || len > 60) { toast('消息长度需为 1-60 字（中文算2字）'); return; }
    } else {
      text = btChatPath.join(' ');   /* 预设分段以空格连接（同 chess/zjh） */
      if (!text) { toast('请选择消息内容'); return; }
    }
    var roleLabel = btChatRoleLabel(mySelfId());
    var from = (isSpec ? (myName || '观战者') : displayName(mySelfId())) + (roleLabel ? '(' + roleLabel + ')' : '');
    if (isSpec) from = (myName || '观战者') + '（观战者）';
    /* 目标列表：私聊关闭时为自动全选；开启后可自由选择，全不选 = 发全体 */
    var targets = Object.keys(btChatSel).filter(function (id) { return btChatSel[id]; });
    var payload = { t: 'chat', to: targets, from: from, text: text };
    btShowChatMsg(from, text);   /* 发送方本地回显（房主与加入方一致） */
    if (isHost) btHostRouteChat(null, payload);
    else sendMy(payload);
    hideModal($('bt-chat-modal'));
  }
  $('bt-chat-send').addEventListener('click', btSendChat);
  $('bt-chat-cancel').addEventListener('click', function () { hideModal($('bt-chat-modal')); });
  var btChatModalEl = $('bt-chat-modal');
  if (btChatModalEl) Profile.wireModalOutsideClick(btChatModalEl, function () { hideModal(btChatModalEl); });
  $('bt-chat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btSendChat();
    e.stopPropagation();
  });
  var btChatBtn = $('btn-bt-chat');
  if (btChatBtn) btChatBtn.addEventListener('click', function () { btOpenChat(); });

  /* ---------- 结算 ---------- */
  /* 多局/积分模式：局间 5 秒倒计时后自动开启下一局（房主在倒计时结束时开局） */
  function clearAutoNext() {
    if (autoNextTimer) { clearInterval(autoNextTimer); autoNextTimer = null; }
    autoNextLeft = 0;
  }
  function startAutoNext() {
    clearAutoNext();
    var btn = $('btn-bt-result-new');
    autoNextLeft = 5;
    function tick() {
      autoNextLeft--;
      if (btn) btn.textContent = '继续(' + Math.max(0, autoNextLeft) + ')';
      if (autoNextLeft <= 0) {
        clearAutoNext();
        /* 倒计时结束且无人退出（3 人仍在、会话未结束）则自动开局 */
        if (isHost && game && game.phase === 'over' && players.length === 3 && (!session || !session.over)) deal();
      }
    }
    if (btn) btn.textContent = '继续(' + autoNextLeft + ')';
    autoNextTimer = setInterval(tick, 1000);
  }
  function showResult() {
    var r = game.result || {};
    var winnerIdx = r.winner;
    var landlordIdx = game.landlord;
    /* 我所在阵营是否获胜：我是地主→地主赢才赢；我是农民→地主输（任一农民先出完）即赢 */
    var meWon = landlordIdx === myIndex
      ? winnerIdx === landlordIdx
      : winnerIdx !== landlordIdx;
    var detail = $('bt-result-detail');
    detail.innerHTML = '';
    var newBtn = $('btn-bt-result-new');
    var homeBtn = $('btn-bt-result-home');
    /* 查看记录入口：多局/积分模式显示 */
    $('btn-bt-result-records').classList.toggle('hidden', !(session && settings.mode !== 'single'));
    /* 会话结束（多局到达局数 / 积分有人扣至0）：显示最终排名，可返回主界面，不再开局 */
    if (r.over) {
      clearAutoNext();
      $('bt-result-title').textContent = '游戏结束';
      var reason;
      if (settings.mode === 'points') {
        var loseNames = (r.losers || []).map(function (id) { return displayName(id); }).join('、');
        reason = loseNames + ' 积分扣至0分，游戏结束';
      } else {
        reason = '已完成 ' + (session ? session.round : 0) + ' 局，按总积分排名';
      }
      $('bt-result-text').textContent = reason;
      (r.ranking || []).forEach(function (item, i) {
        var row = document.createElement('div');
        row.className = 'bt-result-row' + (item.id === mySelfId() ? ' me' : '');
        var nm = document.createElement('span');
        nm.textContent = '第' + (i + 1) + '名 ' + displayName(item.id) + (game.order[landlordIdx] === item.id ? '（地主）' : '') + ((r.losers || []).indexOf(item.id) !== -1 ? '（失败）' : '');
        var dv = document.createElement('span');
        dv.className = (r.losers || []).indexOf(item.id) !== -1 ? 'neg' : 'pos';
        dv.textContent = item.score;
        row.appendChild(nm);
        row.appendChild(dv);
        detail.appendChild(row);
      });
      newBtn.classList.add('hidden');   /* 会话结束不再开局 */
      homeBtn.classList.remove('hidden');
      showModal($('bt-result-modal'));
      return;
    }
    $('bt-result-title').textContent = meWon ? '你赢了！' : '你输了';
    var text = landlordIdx === winnerIdx
      ? '地主（' + nameOf(game.order[winnerIdx]) + '）率先出完手牌'
      : '农民阵营率先出完手牌';
    var mark = r.spring ? '　春天！' : (r.antiSpring ? '　反春天！' : '');
    /* 单局模式不计倍率与积分：房主可选"再来一局"，可返回主界面 */
    if (settings.mode === 'single' || !session) {
      clearAutoNext();
      $('bt-result-text').textContent = text + mark;
      newBtn.textContent = '再来一局';
      newBtn.classList.toggle('hidden', !isHost);
      homeBtn.classList.remove('hidden');
    } else {
      $('bt-result-text').textContent = text + mark + '　本局倍率 ×' + game.mult;
      var wonSide = landlordIdx === winnerIdx;
      game.order.forEach(function (id, idx) {
        var won = wonSide ? (idx === landlordIdx) : (idx !== landlordIdx);
        var row = document.createElement('div');
        row.className = 'bt-result-row' + (won ? ' win' : ' lose') + (idx === myIndex ? ' me' : '');
        var nm = document.createElement('span');
        nm.className = 'bt-result-name';
        nm.textContent = displayName(id) + (game.landlord === idx ? '（地主）' : '');
        var dv = document.createElement('span');
        var d = (r.deltas && r.deltas[id]) || 0;
        dv.className = d > 0 ? 'pos' : (d < 0 ? 'neg' : '');
        dv.textContent = (d > 0 ? '+' : '') + d + '（总分 ' + ((session.scores && session.scores[id]) || 0) + '）';
        row.appendChild(nm);
        row.appendChild(dv);
        detail.appendChild(row);
      });
      /* 多局不限局数：可退出，5 秒后自动进入下一局；
         限制局数/积分模式：去掉"返回主界面"不可中途退出，仅"继续"倒计时自动开局 */
      newBtn.classList.remove('hidden');
      newBtn.textContent = '继续';
      homeBtn.classList.toggle('hidden', !(settings.mode === 'multi' && !settings.roundLimit));
      startAutoNext();
    }
    showModal($('bt-result-modal'));
  }

  /* ---------- 选牌交互（点击切换 / 滑动切换 / 双击取消全部 / 按住选中牌上滑出牌） ---------- */
  var down = null;          /* 当前手势：{ idx, wasSel, startX, startY, startTime, moved, sweepActive, touched, played } */
  var lastTap = 0;
  var lastTapIdx = -1;      /* 上次单击的牌下标（双击判定：300ms 内再点同一张牌） */
  handEl.addEventListener('pointerdown', function (e) {
    if (!game || game.phase !== 'playing') return;
    var cardEl2 = e.target.closest ? e.target.closest('.fc-card') : null;
    if (!cardEl2 || !handEl.contains(cardEl2)) return;
    var idx = parseInt(cardEl2.dataset.idx, 10);
    if (isNaN(idx)) return;
    e.preventDefault();
    down = {
      idx: idx,
      wasSel: !!sel[idx],
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
    if (!down || down.played) return;
    var dx = e.clientX - down.startX;
    var dy = e.clientY - down.startY;
    if (!down.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 8) return;
      down.moved = true;
    }
    /* 上滑出牌：按住已选中的牌，0.5s 内向上拖动超过 1/5 屏高 */
    if (down.wasSel) {
      if (Date.now() - down.startTime <= 500 && dy <= -(window.innerHeight / 5)) {
        down.played = true;
        tryPlaySelected();
        return;
      }
      /* 触发窗口内向上拖动未达阈值：继续等待触发或超时，不进入滑动选牌（防误触） */
      if (Date.now() - down.startTime <= 500 && dy < 0 && Math.abs(dy) >= Math.abs(dx)) {
        return;
      }
    }
    /* 滑动选牌：切换经过的每张牌（含起始牌，每张一次） */
    if (!down.sweepActive) {
      down.sweepActive = true;
      down.touched[down.idx] = true;
      toggleSel(down.idx);
    }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    var cardEl3 = el && el.closest ? el.closest('.bt-hand .fc-card') : null;
    if (!cardEl3) return;
    var idx2 = parseInt(cardEl3.dataset.idx, 10);
    if (!isNaN(idx2) && !down.touched[idx2]) {
      down.touched[idx2] = true;
      toggleSel(idx2);
    }
  });
  /* 切换选牌：选中存 true，取消时删除键（避免 false 残留被当成已选） */
  function toggleSel(idx) {
    if (sel[idx]) {
      delete sel[idx];
      markSel(idx, false);
    } else {
      sel[idx] = true;
      markSel(idx, true);
    }
  }
  function endGesture() {
    if (!down) return;
    var d = down;
    down = null;
    if (d.played || d.moved) return;
    /* 单击：切换该牌 */
    var now = Date.now();
    if (now - lastTap < 300 && lastTapIdx === d.idx) {
      /* 双击同一张牌：取消选中所有牌 */
      sel = {};
      renderHand();
      lastTap = 0;
      lastTapIdx = -1;
      return;
    }
    lastTap = now;
    lastTapIdx = d.idx;
    toggleSel(d.idx);
  }
  document.addEventListener('pointerup', endGesture);
  document.addEventListener('pointercancel', function () { down = null; });

  /* ---------- 操作按钮 ---------- */
  /* 操作后移除焦点：防止后续 Enter/Space 触发残留焦点按钮产生误操作 */
  function blurActive() {
    var a = document.activeElement;
    if (a && a !== document.body && a.blur) { try { a.blur(); } catch (e) {} }
  }
  function myAction(a) {
    if (isHost) handleGameAction('host', a);
    else if (myConn && myConn.open) sendMy({ t: 'action', a: a });
    blurActive();
  }
  $('btn-bid').addEventListener('click', function () { myAction({ a: 'bid', take: true }); });
  $('btn-nobid').addEventListener('click', function () { myAction({ a: 'bid', take: false }); });
  /* 出牌（按钮 / Enter / 上滑共用）：校验并发送当前选中牌 */
  function tryPlaySelected() {
    if (!game || game.phase !== 'playing' || game.turn !== myIndex) return false;
    var idxs = Object.keys(sel).map(Number).sort(function (a, b) { return a - b; });
    if (!idxs.length) { toast('请先选择要出的牌'); return false; }
    var cards = idxs.map(function (i) { return game.hands[mySelfId()][i]; });
    var comb = combOf(cards);
    if (!comb) { toast('不是有效的牌型'); return false; }
    if (game.current && game.current.p !== myIndex && !beats(game.current.comb, comb)) {
      toast('管不上对方的牌');
      return false;
    }
    /* 先清空选中再发送：房主同步渲染时不会把旧选中索引画到剩余牌上 */
    sel = {};
    myAction({
      a: 'play',
      cards: cards.map(function (c) { return { rank: c.rank, suit: c.suit }; })
    });
    return true;
  }
  $('btn-play').addEventListener('click', function () { tryPlaySelected(); });
  /* 局面签名：局面变化（轮次/手牌/当前牌）后重新生成提示候选 */
  function hintSigOf() {
    if (!game) return '';
    return game.roundNo + '|' + game.phase + '|' + game.turn + '|' +
      (game.current ? game.current.p + ',' + game.current.comb.type + ',' + game.current.comb.key + ',' + game.current.comb.len + ',' + game.current.cards.length : '-') + '|' +
      ((game.hands[mySelfId()] || []).length);
  }
  /* 提示/按 Tab：从当前局面第一个可出牌型开始，再次按下依次循环列出所有可出牌型。
     同点数不同花色只使用最左一张（genPlays 按 rank 取最左），避免重复提示。 */
  function cycleHint() {
    if (!game || game.phase !== 'playing' || game.turn !== myIndex) return;
    var hand = game.hands[mySelfId()] || [];
    var sig = hintSigOf();
    if (sig !== hintSig) {
      hintSig = sig;
      hintIdx = -1;
      var prev = (game.current && game.current.p !== myIndex) ? game.current.comb : null;
      hintCands = genPlays(hand).filter(function (p) { return !prev || beats(prev, p.comb); });
      hintCands.sort(function (a, b) {
        var ta = TYPE_ORDER[a.comb.type], tb = TYPE_ORDER[b.comb.type];
        if (ta !== tb) return ta - tb;
        if (a.comb.key !== b.comb.key) return a.comb.key - b.comb.key;
        return a.cards.length - b.cards.length;
      });
    }
    if (!hintCands.length) {
      hintSig = '';
      toast('没有能出的牌');
      return;
    }
    hintIdx = (hintIdx + 1) % hintCands.length;
    var play = hintCands[hintIdx];
    sel = {};
    play.cards.forEach(function (i) { sel[i] = true; });
    renderHand();
    blurActive();
  }
  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;   /* 输入框内不触发 */
    if (e.key === 'Tab') {
      e.preventDefault();   /* 阻止焦点切换 */
      cycleHint();
      return;
    }
    var isEnter = e.key === 'Enter';
    var isSpace = e.key === ' ';
    if (!isEnter && !isSpace) return;
    if (!game) return;
    if (isEnter) {
      /* Enter：叫地主/抢地主；出牌阶段为出牌 */
      if (game.phase === 'bid' && game.bidIdx === myIndex) {
        e.preventDefault();
        myAction({ a: 'bid', take: true });
      } else {
        tryPlaySelected();
      }
      return;
    }
    /* Space：不叫/不抢；出牌阶段为不要（含要不起） */
    if (game.phase === 'bid' && game.bidIdx === myIndex) {
      e.preventDefault();
      myAction({ a: 'bid', take: false });
      return;
    }
    if (game.phase === 'playing' && game.turn === myIndex && game.current && game.current.p !== myIndex) {
      e.preventDefault();
      sel = {};
      myAction({ a: 'pass' });
    }
  });
  $('btn-pass').addEventListener('click', function () {
    if (!game || game.phase !== 'playing' || game.turn !== myIndex) return;
    if (!game.current || game.current.p === myIndex) return;
    sel = {};
    myAction({ a: 'pass' });
  });
  $('btn-hint').addEventListener('click', function () { cycleHint(); });
  $('btn-bt-home').addEventListener('click', function () { location.href = 'index.html'; });
  $('btn-bt-counter').addEventListener('click', function () { if (counterOn) hideCounter(); else showCounter(); });
  /* Z 显示记牌器 / X 隐藏记牌器 */
  document.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'z') showCounter();
    else if (k === 'x') hideCounter();
  });
  $('btn-bt-result-new').addEventListener('click', function () {
    if (isHost) deal();   /* 再来一局 / 继续（提前开局） */
  });
  $('btn-bt-result-home').addEventListener('click', function () {
    clearAutoNext();
    location.href = 'index.html';
  });

  /* ---------- 设置 ---------- */
  var btSettings = { tableScale: 1, panelScale: 1, handScale: 1, transparent: true, suitBorder: false, twoColor: false, counterScale: 100, actionPos: 'left', hideChat: false };
  function loadBtSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('btSettings'));
      if (s) for (var k in btSettings) if (s[k] !== undefined) btSettings[k] = s[k];
    } catch (e) {}
  }
  function saveBtSettings() {
    try { localStorage.setItem('btSettings', JSON.stringify(btSettings)); } catch (e) {}
  }
  function applyCardSettings() {
    /* 类同时挂到 .game-layout、#bt-counter（看牌条在布局外）与 body，
       使“牌面透明/边框着色”对手牌行与观战看牌条都生效 */
    var targets = [document.querySelector('.game-layout'), $('bt-counter'), document.body];
    for (var i = 0; i < targets.length; i++) {
      if (!targets[i]) continue;
      targets[i].classList.toggle('fc-solid-cards', !btSettings.transparent);
      targets[i].classList.toggle('fc-suit-border', btSettings.suitBorder && !btSettings.twoColor);
      targets[i].classList.toggle('fc-two-color-border', btSettings.suitBorder && btSettings.twoColor);
    }
  }
  function setToggle(el, on) {
    var img = el.querySelector('img');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (img) img.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function toggleIsOn(el) { return el.getAttribute('aria-pressed') === 'true'; }
  var updateBtSettingsScrollbar = Profile.wireScrollbar(
    $('bt-settings-body'),
    $('bt-settings-scrollbar'),
    $('bt-settings-scrollbar-thumb')
  );
  function styleSlider() {
    var sliders = [$('bt-scale'), $('bt-hand-scale'), $('bt-panel-scale'), $('bt-counter-scale')].filter(Boolean);
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
  $('btn-bt-settings').addEventListener('click', function () {
    $('bt-scale').value = Math.round((btSettings.tableScale || 1) * 100);
    $('bt-scale-label').textContent = Math.round((btSettings.tableScale || 1) * 100) + '%';
    $('bt-hand-scale').value = Math.round((btSettings.handScale || 1) * 100);
    $('bt-hand-scale-label').textContent = Math.round((btSettings.handScale || 1) * 100) + '%';
    $('bt-panel-scale').value = Math.round((btSettings.panelScale || 1) * 100);
    $('bt-panel-scale-label').textContent = Math.round((btSettings.panelScale || 1) * 100) + '%';
    setToggle($('bt-opt-transparent'), btSettings.transparent);
    setToggle($('bt-opt-suitborder'), btSettings.suitBorder);
    setToggle($('bt-opt-twocolor'), btSettings.twoColor);
    setToggle($('bt-opt-hidechat'), btSettings.hideChat);
    $('bt-counter-scale').value = btSettings.counterScale;
    $('bt-counter-scale-label').textContent = btSettings.counterScale + '%';
    actionPosLabel();
    showModal($('settings-modal'));
    styleSlider();
    updateBtSettingsScrollbar();
  });
  $('bt-opt-transparent').addEventListener('click', function () { btSettings.transparent = !toggleIsOn(this); setToggle(this, btSettings.transparent); applyCardSettings(); saveBtSettings(); });
  $('bt-opt-suitborder').addEventListener('click', function () { btSettings.suitBorder = !toggleIsOn(this); setToggle(this, btSettings.suitBorder); applyCardSettings(); saveBtSettings(); });
  $('bt-opt-twocolor').addEventListener('click', function () { btSettings.twoColor = !toggleIsOn(this); setToggle(this, btSettings.twoColor); applyCardSettings(); renderGame(); saveBtSettings(); });
  $('bt-opt-hidechat').addEventListener('click', function () { btSettings.hideChat = !toggleIsOn(this); setToggle(this, btSettings.hideChat); saveBtSettings(); });
  /* 记牌器大小：50% = 原始大小（1 倍）不变，区间 50%-150%；玩家默认值 100% */
  function applyCounterScale() {
    var c = $('bt-counter');
    if (c) c.style.setProperty('--cscale', (btSettings.counterScale / 50).toFixed(2));
  }
  $('bt-counter-scale').addEventListener('input', function () {
    btSettings.counterScale = parseInt(this.value, 10);
    $('bt-counter-scale-label').textContent = this.value + '%';
    applyCounterScale();
    saveBtSettings();
    styleSlider();
  });
  $('bt-scale').addEventListener('input', function () {
    btSettings.tableScale = parseInt(this.value, 10) / 100;
    $('bt-scale-label').textContent = this.value + '%';
    tableEl.style.transform = 'scale(' + btSettings.tableScale + ')';
    applyBattleLayout();
    renderHand();
    saveBtSettings();
    styleSlider();
  });
  /* 出牌选项位置：左侧面板 / 牌桌下方 */
  var BT_APOS = ['left', 'bottom'];
  var BT_APOS_NAMES = { left: '左侧面板', bottom: '牌桌下方' };
  function actionPosLabel() {
    var l = $('bt-actionpos-label');
    if (l) l.textContent = BT_APOS_NAMES[btSettings.actionPos] || '左侧面板';
  }
  function cycleActionPos(dir) {
    var idx = BT_APOS.indexOf(btSettings.actionPos);
    if (idx < 0) idx = 0;
    btSettings.actionPos = BT_APOS[(idx + dir + BT_APOS.length) % BT_APOS.length];
    actionPosLabel();
    applyActionPos();
    saveBtSettings();
    if (game) renderGame();
  }
  $('bt-actionpos-prev').addEventListener('click', function () { cycleActionPos(-1); });
  $('bt-actionpos-next').addEventListener('click', function () { cycleActionPos(1); });
  $('bt-hand-scale').addEventListener('input', function () {
    btSettings.handScale = parseInt(this.value, 10) / 100;
    $('bt-hand-scale-label').textContent = this.value + '%';
    applyBattleLayout();   /* 内含按新尺寸重排手牌 */
    saveBtSettings();
    styleSlider();
  });
  $('bt-panel-scale').addEventListener('input', function () {
    btSettings.panelScale = parseInt(this.value, 10) / 100;
    $('bt-panel-scale-label').textContent = this.value + '%';
    document.documentElement.style.setProperty('--panel-scale', btSettings.panelScale.toFixed(2));
    applyBattleLayout();
    saveBtSettings();
    styleSlider();
  });
  $('btn-bt-settings-close').addEventListener('click', function () { hideModal($('settings-modal')); });

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

  /* ---------- 布局（4:3 牌桌，长度以牌桌高度为基准） ---------- */
  var gameLayoutEl = document.querySelector('.game-layout');
  function applyBattleLayout() {
    var areaEl = document.querySelector('.board-area');
    /* 平板/手机端（≤900px）：内容已由 arrangePanelsBt 移入上下容器，整体改为纵向弹性布局 */
    if (btNarrow()) {
      gameLayoutEl.style.display = 'flex';
      gameLayoutEl.style.flexDirection = 'column';
      gameLayoutEl.style.alignItems = 'center';
      gameLayoutEl.style.gap = '12px';
      gameLayoutEl.style.padding = '12px';
      gameLayoutEl.style.height = '';
      gameLayoutEl.style.alignContent = '';
      gameLayoutEl.style.gridTemplateColumns = '';
      gameLayoutEl.style.gridTemplateRows = '';
      if (areaEl) {
        areaEl.style.width = '100%';
        areaEl.style.flex = '0 1 auto';
        areaEl.style.height = '';
      }
      /* 手牌固定贴窗口底部；牌宽按“重叠最多 80%”解析后写入 CSS 变量 */
      handEl.classList.toggle('bt-hand-fixed', !!game && !isSpec && !btHandHidden);
      if (game && !isSpec) {
        var handCwN = resolveHandCw(handCardWidth());
        handEl.style.setProperty('--bt-hand-c', handCwN + 'px');
        renderHand();
      }
      if (game) renderCenter();
      return;
    }
    gameLayoutEl.style.display = '';
    gameLayoutEl.style.flexDirection = '';
    gameLayoutEl.style.alignItems = '';
    gameLayoutEl.style.gap = '';
    gameLayoutEl.style.padding = '';
    /* 牌桌高度：宽限制 88vw（4:3 → 高 66vw）、高限制 72vh、上限 520，再乘缩放 */
    var th = Math.round(Math.min(window.innerWidth * 0.66, window.innerHeight * 0.72, 520) * (btSettings.tableScale || 1));
    var tw = Math.round(th * 4 / 3);
    var pw = Math.round(230 * (btSettings.panelScale || 1));
    var dollSpace = dollSpacePx();   /* 外侧娃娃留白，面板让位 */
    gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + (tw + dollSpace * 2) + 'px ' + pw + 'px';
    /* 行 1 = 牌桌高度与面板内容高度的较大者（面板对齐牌桌底部） */
    var rowH = th;
    document.querySelectorAll('.game-layout > .panel').forEach(function (p) {
      if (!p.classList.contains('hidden')) rowH = Math.max(rowH, panelContentHeight(p) + 14);
    });
    /* 观战者无手牌：无手牌行，牌桌与面板整体垂直居中（避免下方大片留白） */
    if (isSpec) {
      gameLayoutEl.style.gridTemplateRows = rowH + 'px 0px';
      gameLayoutEl.style.height = '100vh';
      gameLayoutEl.style.alignContent = 'center';
      if (areaEl) areaEl.style.height = '';
      if (game) renderCenter();
      return;
    }
    gameLayoutEl.style.height = '';
    gameLayoutEl.style.alignContent = '';
    /* 手牌大小：目标 = 设置值（默认页面高 1/5），按重叠 80% 上限解析；
       若手牌底部超出视口则逐步缩小，仍超出则贴底悬浮（可叠在牌桌上） */
    var targetHandCw = resolveHandCw(handCardWidth());
    var minHandCw = Math.min(Math.round(targetHandCw / 1.2), targetHandCw);
    var handCw = targetHandCw;
    var handSpace = Math.round(handCw * 1.54385 + 14);
    handEl.classList.remove('bt-hand-fixed');   /* 先恢复网格布局再测量 */
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
      /* 最小尺寸仍超出视口：贴底悬浮，允许与牌桌重叠 */
      gameLayoutEl.style.gridTemplateRows = rowH + 'px 0px';
      handEl.classList.add('bt-hand-fixed');
    } else {
      handEl.classList.remove('bt-hand-fixed');
    }
    if (game) { renderHand(); renderCenter(); }   /* 按最终尺寸重排手牌，并同步出牌位置 */
    if (areaEl) areaEl.style.height = '';
  }

  /* ---------- 开放 / 房间号 / 邀请链接 ---------- */
  $('bt-open-btn').addEventListener('click', function () {
    if (!isHost) return;
    openState = !openState;
    this.textContent = openState ? '已开放' : '开放';
    if (isHost && myId) registerOpenRoom(myId, openState);
    hostBroadcastLobby();
  });
  /* 开放房间心跳：开放期间（含对局中）每 10s 刷新登记（ts），列表不消失 */
  setInterval(function () {
    if (isHost && openState && myId) registerOpenRoom(myId, true);
  }, 10000);
  /* 离开页面：注销开放房间、停止倒计时，避免残留死房间 */
  window.addEventListener('pagehide', function () {
    unregisterOpenRoom(myId);
    clearAutoNext();
  });
  var linkTimer = null;
  $('bt-copylink-btn').addEventListener('click', function () {
    var link = new URL('battle.html', location.href);
    link.search = '?mode=join&id=' + encodeURIComponent(myId || '');
    copyText(link.href, '已复制');
    this.textContent = '已复制';
    clearTimeout(linkTimer);
    linkTimer = setTimeout(function () { $('bt-copylink-btn').textContent = '复制邀请链接'; }, 5000);
  });
  $('bt-roomcode-btn').addEventListener('click', function () {
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
  /* 开放房间摘要：显示开局选项 */
  function openRoomSummary() {
    var parts = [];
    if (settings.mode === 'single') parts.push('单局');
    else if (settings.mode === 'multi') {
      parts.push('多局' + (settings.roundLimit ? ' ' + settings.roundCount + '局' : ''));
    } else {
      parts.push('积分 ' + (settings.startScore || 1000));
    }
    if (settings.counter) parts.push('记牌器');
    if (settings.mode !== 'single' && settings.baseScore !== 1) parts.push('底分 ' + settings.baseScore);
    if (settings.noChat) parts.push('禁言');
    if (settings.allowPrivateChat) parts.push('私聊');
    if (settings.allowSpec) parts.push('可观战');
    return '斗地主 | ' + parts.join(' | ');
  }
  /* 开放房间注册：开局后不接受加入（斗地主固定 3 人，无观战） */
  function registerOpenRoom(id, open) {
    var list = [];
    try {
      var raw = JSON.parse(localStorage.getItem('cmchessOpenRooms'));
      if (raw && Array.isArray(raw)) list = raw;
    } catch (e) {}
    var now = Date.now();
    list = list.filter(function (r) { return r && r.id !== id && now - (r.ts || 0) < 180000; });
    if (open) list.push({ id: id, hostName: myName, rules: openRoomSummary(), gameStarted: false, allowSpec: false, noChat: false, ts: now, game: 'battle' });
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

  /* ---------- 平板/手机端布局（仿 chess/zjh：内容移入上下容器） ---------- */
  function btNarrow() {
    return !!window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  }
  function arrangePanelsBt() {
    var tablet = !!window.matchMedia && window.matchMedia('(min-width: 561px) and (max-width: 900px)').matches;
    var mobile = !!window.matchMedia && window.matchMedia('(max-width: 560px)').matches;
    var left = document.querySelector('.panel.left');
    var right = document.querySelector('.panel.right');
    var top = document.querySelector('.top-panel');
    var bottom = document.querySelector('.bottom-panel');
    var statusBox = document.querySelector('.status-box');
    var controls = $('bt-controls');
    var plist = $('bt-player-panel');
    if (!left || !right || !top || !bottom || !statusBox || !controls || !plist) return;
    if (tablet) {
      /* 平板：玩家名片 → 上方面板；操作/状态 → 下方面板 */
      top.appendChild(plist);
      bottom.appendChild(controls);
      bottom.appendChild(statusBox);
    } else if (mobile) {
      /* 手机：操作/状态 → 上方面板；玩家名片 → 下方面板 */
      top.appendChild(controls);
      top.appendChild(statusBox);
      bottom.appendChild(plist);
    } else {
      left.appendChild(statusBox);
      left.appendChild(controls);
      right.appendChild(plist);
    }
    handEl.classList.remove('bt-hand-fixed');
    updateHandBtn();
    stripShortcutLabels();
    applyBattleLayout();
  }
  arrangePanelsBt();
  window.addEventListener('resize', function () { arrangePanelsBt(); applyBattleLayout(); Profile.adjustBtnHitAreas(); });

  /* ---------- 启动 ---------- */
  initCounter();
  applyCounterScale();
  Profile.applyBackground();
  loadBtSettings();
  applyCardSettings();
  tableEl.style.transform = 'scale(' + (btSettings.tableScale || 1) + ')';
  document.documentElement.style.setProperty('--panel-scale', (btSettings.panelScale || 1).toFixed(2));
  arrangePanelsBt();   /* 首次按视口布局（内部调用 applyBattleLayout） */
  /* 未开局时隐藏两侧面板与牌桌区域（同炸金花，等待界面不露出对局内容） */
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
    /* 等待大厅中仅交换头像/成员信息时也会调用 renderGame（game 为 null），
       此时不得显示对局面板，否则等待界面背景（透明弹窗+页面背景）被牌桌覆盖 */
    if (game) showGamePanels();
    origRenderGame();
    applyBattleLayout();   /* 面板内容渲染后按内容重新计算行高 */
  };
  if (isHost) {
    initHost();
    showCreate();   /* 创建房间：先设置开局选项再进大厅 */
  } else if (mode === 'join' && joinId) {
    initJoin();
    if (!joinStarted) showWait();
  } else {
    location.href = 'index.html';
  }
})();
