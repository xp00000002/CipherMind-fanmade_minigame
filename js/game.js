/* game.js - 对局页逻辑 */
(function () {
  'use strict';

  var FILES = 'abcdefgh';
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') === 'host' ? 'host' : 'join';   /* 未指定模式时按加入处理 */
  var joinId = params.get('id');
  var specMode = params.get('spec') === '1';   // 观战模式加入

  if (mode === 'host') {
    var launchedFromLobby = false;
    var hostSession = false;
    try {
      launchedFromLobby = sessionStorage.getItem('cmchess-host-launch') === '1';
      hostSession = sessionStorage.getItem('cmchess-host-session') === '1';
      sessionStorage.setItem('cmchess-host-session', '1');
    } catch (e) {}
    if (!launchedFromLobby && !hostSession) {
      location.replace('index.html');
      return;
    }
    try { sessionStorage.removeItem('cmchess-host-launch'); } catch (e) {}
  }

  var chess = new Chess();
  var movesList = [];

  /* 开局前隐藏棋盘与面板（等待/创建设置页期间） */
  document.body.classList.add('chess-pre-game');

  var PIECE_IMAGES = {
    w: { p: 'texture/pawn2.png', n: 'texture/knight2.png', b: 'texture/bishop2.png', r: 'texture/rook2.png', q: 'texture/queen2.png', k: 'texture/king2.png' },
    b: { p: 'texture/pawn.png', n: 'texture/knight.png', b: 'texture/bishop.png', r: 'texture/rook.png', q: 'texture/queen.png', k: 'texture/king.png' }
  };
  var PIECE_SYMBOLS = {
    w: { p: '\u2659', n: '\u2658', b: '\u2657', r: '\u2656', q: '\u2655', k: '\u2654' },
    b: { p: '\u265F', n: '\u265E', b: '\u265D', r: '\u265C', q: '\u265B', k: '\u265A' }
  };

  var myRole = null;
  var connectionEstablished = false;
  var isSpec = false;                       // 观战模式（只能看，不能走）
  var specProfiles = { w: null, b: null };  // 观战时双方资料（白=房主，黑=对局者）
  var selected = null;
  var legalTargets = [];
  var lastMove = null;
  var gameOver = false;
  var pendingPromo = null;
  var awaiting = { undo: false, draw: false, rematch: false };
  var oppSelected = null;   // 对方选中的棋子 {from, moves, color}

  // 开局规则（房主设定，发给对方）
  var rules = { timeLimit: 0, noCastling: false, noPromotion: false, noUndo: false, open: true, allowSpec: true, noChat: false, allowPrivateChat: false };
  var myPeerId = null;                    // 房主房间号（用于开放房间注册/注销）

  // 等待界面（大厅）：开局前双方停留在房间成员界面
  var inLobby = true;                     // 是否处于开局前大厅
  var oppConnected = false;               // 房主：对手对局者已连接
  var oppReady = false;                   // 房主：对手已准备
  var myReady = false;                    // 己方（对局者）已准备
  var guestLobbyList = null;              // 非房主：房主广播的房间成员列表

  var strikes = { w: 0, b: 0 };          // 各自累计超时次数
  var timerMs = { w: 0, b: 0 };          // 剩余毫秒
  var timerTick = null;

  // 界面设置（个人偏好，本地保存）
  var ui = { flipBoard: false, showMoves: true, showLastMove: true, showCoords: true, showOpponentMoves: true, showMaterial: true, hideChat: false };

  // 对局回放（结束后点击棋谱查看历史局面）
  var moveLog = [];          // 全部走子 {from,to,promotion}
  var reviewChess = null;    // 回放棋盘实例（null=查看当前局面）
  var reviewing = false;
  var reviewIdx = 0;
  var reviewLastMove = null;

  function getChess() { return reviewChess || chess; }

  var boardEl = document.getElementById('board');
  var statusEl = document.getElementById('status');
  var movesEl = document.getElementById('moves');
  var playerTop = document.getElementById('player-top');
  var playerBottom = document.getElementById('player-bottom');
  var connStateEl = document.getElementById('conn-state');
  var waitModal = document.getElementById('wait-modal');
  var waitBody = document.getElementById('wait-body');
  var createModal = document.getElementById('create-modal');
  var btnStartGame = document.getElementById('btn-start-game');
  var btnReady = document.getElementById('btn-ready');
  var btnOpenRoom = document.getElementById('btn-open-room');
  var promoModal = document.getElementById('promo-modal');
  var promoOptions = document.getElementById('promo-options');
  var confirmModal = document.getElementById('confirm-modal');
  var confirmText = document.getElementById('confirm-text');
  var confirmTitle = document.getElementById('confirm-title');
  var confirmYesBtn = document.getElementById('confirm-yes');
  var confirmNoBtn = document.getElementById('confirm-no');
  var toastEl = document.getElementById('toast');

  function $(id) { return document.getElementById(id); }

  /* ---------- 模态框 ---------- */
  function showModal(el) {
    el.classList.remove('hidden');
    Profile.adjustBtnHitAreas();   /* 弹窗按钮出现后重算热区 */
  }
  function hideModal(el) { el.classList.add('hidden'); }

  var confirmAction = null;
  function askConfirm(text, yesCb, noCb, title) {
    confirmText.textContent = text;
    if (confirmTitle) confirmTitle.textContent = title || '提示';
    if (confirmYesBtn) confirmYesBtn.textContent = '确定';
    if (confirmNoBtn) confirmNoBtn.textContent = '取消';
    confirmAction = { yes: yesCb, no: noCb || null };
    showModal(confirmModal);
  }
  $('confirm-yes').addEventListener('click', function () {
    hideModal(confirmModal);
    var a = confirmAction; confirmAction = null;
    if (a && a.yes) a.yes();
  });
  $('confirm-no').addEventListener('click', function () {
    hideModal(confirmModal);
    var a = confirmAction; confirmAction = null;
    if (a && a.no) a.no();
  });

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

  /* ---------- 渲染 ---------- */
  // 在目标格上渲染可走点/吃子/易位标记
  function renderTargets(cell, sq, moves, pieceColor) {
    cell.classList.add('targetable');
    var isCastle = moves.some(function (m) {
      return m.flags.indexOf('kingside') !== -1 || m.flags.indexOf('queenside') !== -1;
    });
    var isCapture = moves.some(function (m) { return m.captured; });
    if (isCapture) cell.classList.add('target-capture');
    if (isCastle) {
      cell.classList.add('target-castle');
      var castImg = document.createElement('img');
      castImg.className = 'castle-dot';
      castImg.src = 'texture/' + (pieceColor === 'w' ? 'whitecastling' : 'blackcastling') + '.png';
      castImg.alt = '';
      cell.appendChild(castImg);
    } else if (!isCapture) {
      var dot = document.createElement('img');
      dot.className = 'marker-dot';
      dot.src = 'texture/' + (pieceColor === 'w' ? 'whitepoint' : 'blackpoint') + '.png';
      dot.alt = '';
      cell.appendChild(dot);
    }
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    var cur = getChess();
    var board = cur.getBoard();
    var lm = reviewChess ? reviewLastMove : lastMove;
    var flip;
    if (isSpec) flip = !!ui.flipBoard;   /* 观战默认白方在下 */
    else flip = ui.flipBoard ? (myRole !== 'w') : (myRole !== 'b');
    // 本地选子的可走目标
    var movesByTo = {};
    if (selected && ui.showMoves) {
      legalTargets.forEach(function (m) {
        if (!movesByTo[m.to]) movesByTo[m.to] = [];
        movesByTo[m.to].push(m);
      });
    }
    // 对方选子的可走目标
    var oppMovesByTo = {};
    if (oppSelected && ui.showOpponentMoves) {
      oppSelected.moves.forEach(function (m) {
        if (!oppMovesByTo[m.to]) oppMovesByTo[m.to] = [];
        oppMovesByTo[m.to].push(m);
      });
    }
    var grid = [[], [], [], [], [], [], [], []];
    for (var dr = 0; dr < 8; dr++) {
      for (var dc = 0; dc < 8; dc++) {
        var br = flip ? 7 - dr : dr;
        var bc = dc;
        var sq = Chess.rcToSquare(br, bc);
        var cell = document.createElement('div');
        cell.className = 'cell ' + ((br + bc) % 2 === 0 ? 'light' : 'dark');
        cell.dataset.square = sq;
        var p = board[br][bc];
        if (p) {
          var img = document.createElement('img');
          img.src = PIECE_IMAGES[p.color][p.type];
          img.className = 'piece';
          img.draggable = false;
          cell.appendChild(img);
        }
        if (selected === sq) cell.classList.add('selected');
        if (oppSelected && ui.showOpponentMoves && oppSelected.from === sq) cell.classList.add('opp-selected');
        if (ui.showLastMove && lm && (sq === lm.from || sq === lm.to)) cell.classList.add('last-move');
        if (movesByTo[sq]) {
          renderTargets(cell, sq, movesByTo[sq], myRole);
        } else if (oppMovesByTo[sq]) {
          renderTargets(cell, sq, oppMovesByTo[sq], oppSelected.color);
        }
        if (ui.showCoords && dc === 0) {
          var rankLabel = document.createElement('span');
          rankLabel.className = 'coord rank-coord';
          rankLabel.textContent = br + 1;
          cell.appendChild(rankLabel);
        }
        if (ui.showCoords && dr === 7) {
          var fileLabel = document.createElement('span');
          fileLabel.className = 'coord file-coord';
          fileLabel.textContent = FILES[bc];
          cell.appendChild(fileLabel);
        }
        cell.addEventListener('click', (function (sq) { return function () { onCellClick(sq); }; })(sq));
        grid[dr][dc] = cell;
      }
    }
    for (var rri = 0; rri < 8; rri++) {
      var row = document.createElement('div');
      row.className = 'board-row';
      for (var rci = 0; rci < 8; rci++) row.appendChild(grid[rri][rci]);
      boardEl.appendChild(row);
    }
  }

  function fmtTime(ms) {
    if (ms < 0) ms = 0;
    var s = Math.ceil(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // 个人设置（名称/头像），由 profile.js 提供；通过连接与对方共享
  var myProfileName = '';
  var mySpecName = '';
  var myAvatarRaw = { avatar: 'default', avatarData: '' };
  var oppProfileName = '';
  var oppAvatarRaw = { avatar: 'default', avatarData: '' };

  // 头像 HTML：auto 颜色按所在面板的身份（黑方黑棋、白方白棋）解析
  function profileToHtml(avatar, avatarData, roleColor) {
    if (avatar === 'custom' && avatarData) {
      var smooth = (Profile.get() || {}).avatarSmooth !== false;   /* 线性插值开关 */
      return '<img class="avatar-img' + (smooth ? ' smooth' : '') + '" src="' + avatarData + '">';
    }
    if (avatar && avatar.indexOf('piece:') === 0) {
      var parts = avatar.slice(6).split(':');
      var color = parts[0] === 'auto' ? (roleColor === 'b' ? 'b' : 'w') : parts[0];
      return '<img class="avatar-img piece" src="' + PIECE_IMAGES[color][parts[1]] + '">';
    }
    return '';
  }

  function loadProfile() {
    var p = Profile.get();
    myProfileName = p.name || '';
    myAvatarRaw = { avatar: p.avatar, avatarData: p.avatarData };
    Profile.applyBackground();
  }

  function currentDisplayName() {
    if (isSpec) return mySpecName || 'Player #1';
    return myProfileName || 'Player';
  }

  function sendProfile() {
    var p = Profile.get();
    Net.send({ type: 'profile', profile: { name: myProfileName || p.name || '', avatar: p.avatar, avatarData: p.avatarData } });
  }

  function saveGameNickname() {
    var input = document.getElementById('game-nickname');
    if (!input) return;
    var name = input.value.trim();
    var p = Profile.get();
    p.name = name;
    Profile.save();
    myProfileName = name;
    if (isSpec) Net.renameSpec(name);
    else sendProfile();
    updateUI();
    broadcastRoster();
    toast('昵称已保存');
  }

  function buildCard(color, captured, isTurn, lead) {
    var isMe = color === myRole;
    var colorName = (color === 'w' ? '白方' : '黑方') + (isMe ? '(你)' : '');
    var role, prof;
    if (isSpec) {
      // 观战视角：白方=房主，黑方=对局者
      prof = color === 'w' ? specProfiles.w : specProfiles.b;
      role = (prof && prof.name) || (color === 'w' ? '房主' : '对局者');
    } else {
      prof = isMe ? myAvatarRaw : oppAvatarRaw;
      role = isMe ? (myProfileName || (Net.isHost() ? 'Player #1' : 'Player #2')) : (oppProfileName || 'Player');
    }
    var capHtml = captured.map(function (t) { return PIECE_SYMBOLS[color][t]; }).join('') || '';
    // 头像：个人头像图片（我方/对方），无则用字形，统一叠加头像框
    var avatarImg = profileToHtml((prof || {}).avatar, (prof || {}).avatarData, color);
    var avatarHtml;
    if (avatarImg) {
      avatarHtml = avatarImg + '<img class="avatar-border" src="texture/avatarboarder.png">';
    } else {
      avatarHtml = '<span class="avatar-glyph">' + (color === 'w' ? PIECE_SYMBOLS.b.k : PIECE_SYMBOLS.w.k) + '</span>' +
        '<img class="avatar-border" src="texture/avatarboarder.png">';
    }
    var timeHtml = (rules.timeLimit > 0 && !isSpec) ? '<div class="p-time">' + fmtTime(timerMs[color]) + '</div>' : '';
    var leadHtml = (ui.showMaterial && lead > 0) ? '<div class="p-material">+' + lead + '</div>' : '';
    return '<div class="avatar">' + avatarHtml + '</div>' +
      '<div class="pinfo">' +
      '<div class="pname">' + colorName + '</div>' +
      '<div class="prole">' + role + '</div>' +
      '<div class="captured">' + capHtml + '</div>' +
      timeHtml +
      leadHtml +
      '</div>';
  }

  function renderPlayers() {
    if (!myRole) return;
    var cur = getChess();
    var opp, me;
    if (isSpec) { opp = 'w'; me = 'b'; }   /* 观战：上白下黑 */
    else { opp = myRole === 'w' ? 'b' : 'w'; me = myRole; }
    var diff = cur.materialDiff();
    var leadW = diff > 0 ? diff : 0;
    var leadB = diff < 0 ? -diff : 0;
    playerTop.innerHTML = buildCard(opp, cur.capturedBy(opp), opp === cur.getTurn() && !gameOver, opp === 'w' ? leadW : leadB);
    playerBottom.innerHTML = buildCard(me, cur.capturedBy(me), me === cur.getTurn() && !gameOver, me === 'w' ? leadW : leadB);
    // 当前行棋方：玩家面板边框高亮（金），另一方为暗金
    playerTop.classList.toggle('turn', !gameOver && opp === cur.getTurn());
    playerBottom.classList.toggle('turn', !gameOver && me === cur.getTurn());
  }

  function renderStatus() {
    if (!myRole) { statusEl.textContent = '等待连接…'; return; }
    if (gameOver && reviewing) {
      statusEl.textContent = '查看历史：第 ' + reviewIdx + ' 步（' + (movesList[reviewIdx - 1] || '开局') + '）';
      return;
    }
    if (gameOver) { statusEl.textContent = '对局结束'; return; }
    if (isSpec) {
      var t0 = chess.getTurn();
      statusEl.textContent = '观战中 · ' + (t0 === 'w' ? '白方' : '黑方') + '行棋' + (chess.inCheck(t0) ? ' · 将军！' : '');
      return;
    }
    var t = chess.getTurn();
    var s = t === myRole ? '轮到你了' : '等待对方走棋';
    if (chess.inCheck(t)) s += ' · 将军！';
    statusEl.textContent = s;
  }

  function renderMoves() {
    var prevCount = parseInt(movesEl.dataset.count || '0', 10);
    var prevScroll = movesEl.scrollTop;
    movesEl.innerHTML = '';
    var activeEl = null;
    for (var i = 0; i < movesList.length; i += 2) {
      var div = document.createElement('div');
      div.className = 'move-row';
      var num = (i / 2 + 1) + '.';
      var numSpan = document.createElement('span');
      numSpan.className = 'num';
      numSpan.textContent = num;
      div.appendChild(numSpan);
      for (var j = 0; j < 2; j++) {
        var mi = i + j;
        if (mi >= movesList.length) break;
        var sp = document.createElement('span');
        sp.className = 'move-cell' + (reviewing && reviewIdx === mi + 1 ? ' active' : '');
        sp.textContent = movesList[mi];
        if (reviewing && reviewIdx === mi + 1) activeEl = sp;
        sp.addEventListener('click', (function (idx) {
          return function () { reviewTo(idx); };
        })(mi + 1));
        div.appendChild(sp);
      }
      movesEl.appendChild(div);
    }
    movesEl.dataset.count = movesList.length;
    // 新增走子时滚到底；复盘/查看时保持当前位置
    if (movesList.length > prevCount) {
      movesEl.scrollTop = movesEl.scrollHeight;
    } else {
      movesEl.scrollTop = prevScroll;
      if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  // 回放：查看第 idx 步（0..moveLog.length）时的棋盘；idx=moveLog.length 回到当前
  function reviewTo(idx) {
    if (!gameOver && !isSpec) return;   // 观战者可在对局中随时查看历史
    idx = Math.max(0, Math.min(idx, moveLog.length));
    if (idx === moveLog.length) {
      reviewChess = null;
      reviewing = false;
      reviewIdx = moveLog.length;
      reviewLastMove = null;
    } else {
      var c = new Chess();
      c.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
      var applied = 0;
      for (var i = 0; i < idx; i++) {
        if (!c.makeMove(moveLog[i])) break;
        applied++;
      }
      reviewChess = c;
      reviewing = true;
      reviewIdx = applied;
      var last = moveLog[applied - 1];
      reviewLastMove = last ? { from: last.from, to: last.to } : null;
    }
    var backBtn = document.getElementById('btn-back-current');
    if (backBtn) backBtn.classList.toggle('hidden', !reviewing);
    updateUI();
  }

  function updateUI() {
    renderBoard();
    renderPlayers();
    renderStatus();
    renderMoves();
    var homeBtn = document.getElementById('btn-home');
    if (homeBtn) homeBtn.classList.toggle('hidden', !gameOver && !isSpec);   /* 观战者未结束也可返回 */
    var copyMovesBtn = document.getElementById('btn-copy-moves');
    if (copyMovesBtn) copyMovesBtn.classList.toggle('hidden', !gameOver && !isSpec);   /* 结束后可复制棋谱 */
    updateChatButton();
  }

  /* 观战模式：禁用操作按钮，仅保留设置 */
  function setSpecMode(on) {
    ['btn-undo', 'btn-draw', 'btn-rematch', 'btn-resign'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = on;
    });
  }

  /* ---------- 棋盘交互 ---------- */
  function onCellClick(sq) {
    if (isSpec) return;   /* 观战者不可走棋 */
    if (gameOver) return;
    if (!myRole || myRole !== chess.getTurn()) return;
    var piece = chess.pieceAt(sq);
    if (selected) {
      if (piece && piece.color === myRole) {
        if (tryCastleClick(sq)) return;
        select(sq);
        return;
      }
      var movesTo = legalTargets.filter(function (m) { return m.to === sq; });
      if (movesTo.length) {
        if (movesTo[0].promotion) {
          pendingPromo = { from: selected, to: sq };
          showPromo();
          return;
        }
        tryMove(selected, sq);
        return;
      }
      clearSelection();
      return;
    }
    if (piece && piece.color === myRole) select(sq);
  }

  // 选中王后点击自己的车（h列王翼 / a列后翼）触发王车易位
  function tryCastleClick(sq) {
    var castle = [];
    for (var i = 0; i < legalTargets.length; i++) {
      if (legalTargets[i].flags.indexOf('kingside') !== -1 || legalTargets[i].flags.indexOf('queenside') !== -1) {
        castle.push(legalTargets[i]);
      }
    }
    if (!castle.length) return false;
    var file = sq[0];
    var mv = null;
    for (var j = 0; j < castle.length; j++) {
      if (castle[j].flags.indexOf('kingside') !== -1 && file === 'h') mv = castle[j];
      if (castle[j].flags.indexOf('queenside') !== -1 && file === 'a') mv = castle[j];
    }
    if (!mv) return false;
    tryMove(selected, mv.to);
    return true;
  }

  function select(sq) {
    selected = sq;
    legalTargets = chess.getMoves().filter(function (m) { return m.from === sq; });
    var castleDests = legalTargets.filter(function (m) {
      return m.flags.indexOf('kingside') !== -1 || m.flags.indexOf('queenside') !== -1;
    });
    if (castleDests.length) {
      var dests = castleDests.map(function (m) { return m.to; }).join('/');
      toast('可以王车易位：点击 ' + dests + ' 或点击对应的车');
    }
    Net.send({ type: 'select', from: sq });
    renderBoard();
  }

  function clearSelection() {
    selected = null;
    legalTargets = [];
    Net.send({ type: 'deselect' });
    renderBoard();
  }

  function clearOppSelection() {
    if (oppSelected) { oppSelected = null; renderBoard(); }
  }

  function tryMove(from, to, promotion) {
    var move = { from: from, to: to, promotion: promotion || undefined };
    var match = chess.findMove(move);
    if (!match) return false;
    var san = chess._moveToSAN(match);
    chess.makeMove(match);
    lastMove = { from: from, to: to };
    selected = null; legalTargets = [];
    oppSelected = null;
    movesList.push(san);
    moveLog.push({ from: from, to: to, promotion: match.promotion || undefined });
    Net.send({ type: 'move', move: { from: from, to: to, promotion: match.promotion || undefined } });
    Net.send({ type: 'deselect' });
    resetMoverTimer(myRole);
    updateUI();
    checkGameOver();
    return true;
  }

  function showPromo() {
    promoOptions.innerHTML = '';
    var color = myRole;
    ['q', 'r', 'b', 'n'].forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'promo-btn';
      var img = document.createElement('img');
      img.src = PIECE_IMAGES[color][t];
      img.alt = t;
      b.appendChild(img);
      b.addEventListener('click', function () {
        hideModal(promoModal);
        var p = pendingPromo; pendingPromo = null;
        if (p) tryMove(p.from, p.to, t);
      });
      promoOptions.appendChild(b);
    });
    showModal(promoModal);
  }

  /* ---------- 远端消息 ---------- */
  function handleRemoteMove(data) {
    if (isSpec) {
      // 观战者：只应用走子，不做玩家逻辑
      var sm = chess.findMove(data.move);
      if (!sm) return;
      var ssan = chess._moveToSAN(sm);
      chess.makeMove(sm);
      lastMove = { from: data.move.from, to: data.move.to };
      movesList.push(ssan);
      moveLog.push({ from: data.move.from, to: data.move.to, promotion: sm.promotion || undefined });
      reviewChess = null;
      reviewing = false;
      reviewIdx = moveLog.length;
      updateUI();
      checkGameOver();
      return;
    }
    var match = chess.findMove(data.move);
    if (!match) { console.warn('收到非法走法', data.move); return; }
    var san = chess._moveToSAN(match);
    chess.makeMove(match);
    lastMove = { from: data.move.from, to: data.move.to };
    selected = null; legalTargets = [];
    oppSelected = null;
    movesList.push(san);
    moveLog.push({ from: data.move.from, to: data.move.to, promotion: match.promotion || undefined });
    // 对方走子，重置对方计时
    if (rules.timeLimit > 0) timerMs[chess.getTurn() === 'w' ? 'b' : 'w'] = rules.timeLimit * 1000;
    updateUI();
    checkGameOver();
  }

  function applyRules(r) {
    if (!r) return;
    rules.timeLimit = r.timeLimit ? Math.max(0, r.timeLimit) : 0;
    rules.noCastling = !!r.noCastling;
    rules.noPromotion = !!r.noPromotion;
    rules.noUndo = !!r.noUndo;
    rules.allowSpec = r.allowSpec !== false;
    rules.noChat = !!r.noChat;
    rules.allowPrivateChat = !!r.allowPrivateChat;
    chess.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
    updateUndoBtn();
    if (rules.timeLimit > 0) {
      timerMs.w = rules.timeLimit * 1000;
      timerMs.b = rules.timeLimit * 1000;
      startTimer();
    } else {
      stopTimer();
    }
    updateUI();
  }

  // 根据规则禁用/启用悔棋按钮
  function updateUndoBtn() {
    var btn = document.getElementById('btn-undo');
    if (btn) btn.disabled = !!rules.noUndo;
  }

  function updateChatButton() {
    var btn = document.getElementById('btn-chat');
    if (btn) btn.classList.toggle('hidden', !!rules.noChat);
  }

  function ruleSummary() {
    var parts = [];
    if (rules.timeLimit > 0) parts.push('每步 ' + rules.timeLimit + ' 秒');
    if (rules.noCastling) parts.push('禁易位');
    if (rules.noPromotion) parts.push('禁升变');
    if (rules.noUndo) parts.push('禁悔棋');
    if (!rules.allowSpec) parts.push('禁止观战');
    if (rules.noChat) parts.push('禁止发送消息');
    if (rules.allowPrivateChat) parts.push('允许私聊');
    return parts.length ? '规则：' + parts.join('、') : '规则：默认';
  }

  // 观战快照：按走棋历史重建棋盘，并显示双方资料
  function applySnapshot(snap) {
    if (!snap) return;
    chess.reset();
    chess.setRules({ noCastling: !!(snap.rules && snap.rules.noCastling), noPromotion: !!(snap.rules && snap.rules.noPromotion) });
    movesList = [];
    moveLog = [];
    lastMove = null;
    (snap.moveLog || []).forEach(function (m) {
      var match = chess.findMove(m);
      if (!match) return;
      chess.makeMove(match);
      movesList.push(chess._moveToSAN(match));
      moveLog.push({ from: m.from, to: m.to, promotion: match.promotion || undefined });
      lastMove = { from: m.from, to: m.to };
    });
    if (snap.rules) {
      rules.timeLimit = snap.rules.timeLimit ? Math.max(0, snap.rules.timeLimit) : 0;
      rules.noCastling = !!snap.rules.noCastling;
      rules.noPromotion = !!snap.rules.noPromotion;
      rules.noUndo = !!snap.rules.noUndo;
      rules.allowSpec = snap.rules.allowSpec !== false;
      rules.noChat = !!snap.rules.noChat;
      rules.allowPrivateChat = !!snap.rules.allowPrivateChat;
    }
    specProfiles.w = snap.w || null;
    specProfiles.b = snap.b || null;
    updateUI();
  }

  // 房主：生成观战快照
  function buildSnapshot() {
    var my = Profile.get();
    return {
      type: 'snapshot',
      moveLog: moveLog.slice(),
      rules: {
        timeLimit: rules.timeLimit,
        noCastling: rules.noCastling,
        noPromotion: rules.noPromotion,
        noUndo: rules.noUndo,
        allowSpec: rules.allowSpec,
        noChat: rules.noChat,
        allowPrivateChat: rules.allowPrivateChat
      },
      w: { name: my.name || '', avatar: my.avatar, avatarData: my.avatarData },
      b: { name: oppProfileName, avatar: oppAvatarRaw.avatar, avatarData: oppAvatarRaw.avatarData }
    };
  }

  function handleRemote(data) {
    // 观战者只处理走子/快照/选子显示与结束类消息，忽略玩家交互类消息
    if (isSpec && data.type !== 'move' && data.type !== 'snapshot' && data.type !== 'select' && data.type !== 'deselect' &&
        data.type !== 'resign' && data.type !== 'accept-draw' && data.type !== 'spec-count' && data.type !== 'chat' && data.type !== 'roster' &&
        data.type !== 'lobby' && data.type !== 'start') return;
    switch (data.type) {
      case 'lobby':
        guestLobbyList = (data && data.list) || [];
        if (typeof data.open === 'boolean') {
          rules.open = data.open;
          if (!Net.isHost()) updateLobbyOpenBtn();
        }
        renderLobby();
        break;
      case 'lobby-ready':
        if (Net.isHost()) {
          oppReady = !!data.v;
          broadcastLobby();
        }
        break;
      case 'start':
        if (inLobby && !Net.isHost()) {
          if (data.rules) {
            if (isSpec) {
              /* 观战者只同步规则显示，不启动自己的计时 */
              rules.timeLimit = data.rules.timeLimit || 0;
              rules.noCastling = !!data.rules.noCastling;
              rules.noPromotion = !!data.rules.noPromotion;
              rules.noUndo = !!data.rules.noUndo;
              rules.allowSpec = data.rules.allowSpec !== false;
              rules.noChat = !!data.rules.noChat;
              rules.allowPrivateChat = !!data.rules.allowPrivateChat;
              chess.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
            } else {
              applyRules(data.rules);
            }
          }
          startGame();
        }
        break;
      case 'chat':
        showChatMessage((data.from && (data.from.name || 'Player')) + '(' + chatRoleText(data.from && data.from.role) + ')', data.text);
        break;
      case 'roster':
        roster = (data && data.list) || [];
        break;
      case 'spec-count':
        updateSpecCount(data.count);
        break;
      case 'snapshot':
        applySnapshot(data);
        break;
      case 'move':
        handleRemoteMove(data);
        break;
      case 'profile':
        if (data.profile) {
          oppProfileName = data.profile.name || '';
          oppAvatarRaw = { avatar: data.profile.avatar, avatarData: data.profile.avatarData };
          broadcastRoster();   /* 成员名称更新 */
          updateUI();
          if (inLobby) { if (Net.isHost()) broadcastLobby(); else renderLobby(); }
        }
        break;
      case 'config':
        applyRules(data.rules);
        toast(ruleSummary());
        break;
      case 'select':
        if (ui.showOpponentMoves) {
          var mvs = chess.getMoves().filter(function (m) { return m.from === data.from; });
          var pc = chess.pieceAt(data.from);
          oppSelected = { from: data.from, moves: mvs, color: pc ? pc.color : chess.getTurn() };
          renderBoard();
        }
        break;
      case 'deselect':
        clearOppSelection();
        break;
      case 'resign':
        gameOver = true;
        stopTimer();
        if (isSpec) {
          showGameOver('游戏结束', '对局结束');
        } else {
          showGameOver('游戏结束', data.reason === 'timeout' ? '对方超时判负，你获胜！' : '对方认输，你获胜！');
        }
        updateUI();
        break;
      case 'offer-draw':
        askConfirm('对方请求和棋，是否同意？', function () {
          Net.send({ type: 'accept-draw' });
          finishDraw('双方同意和棋');
        }, function () {
          Net.send({ type: 'decline-draw' });
        });
        break;
      case 'accept-draw':
        if (isSpec) {
          gameOver = true;
          stopTimer();
          showGameOver('游戏结束', '双方同意和棋');
          updateUI();
        } else {
          finishDraw('双方同意和棋');
        }
        break;
      case 'decline-draw':
        awaiting.draw = false;
        toast('对方拒绝了和棋请求');
        break;
      case 'undo-request':
        if (rules.noUndo) { Net.send({ type: 'undo-decline' }); break; }
        askConfirm('对方请求悔棋，是否同意？', function () {
          Net.send({ type: 'undo-accept' });
          applyUndo(2);
        });
        break;
      case 'undo-accept':
        applyUndo(2);
        awaiting.undo = false;
        toast('对方同意悔棋');
        break;
      case 'undo-decline':
        awaiting.undo = false;
        toast('对方拒绝了悔棋请求');
        break;
      case 'rematch-request':
        askConfirm('对方请求再来一局，是否同意？', function () {
          Net.send({ type: 'rematch-accept' });
          resetGame();
          if (Net.isHost() && myPeerId && rules.open) registerOpenRoom(myPeerId, true);
        });
        break;
      case 'rematch-accept':
        resetGame();
        if (Net.isHost() && myPeerId && rules.open) registerOpenRoom(myPeerId, true);
        break;
    }
  }

  function resetMoverTimer(color) {
    if (rules.timeLimit > 0) timerMs[color] = rules.timeLimit * 1000;
  }

  function startTimer() {
    stopTimer();
    if (rules.timeLimit <= 0) return;
    timerTick = setInterval(function () {
      if (gameOver || !myRole || !rules.timeLimit) return;
      var t = chess.getTurn();
      timerMs[t] -= 250;
      if (timerMs[t] <= 0) {
        timerMs[t] = 0;
        if (t === myRole) {
          // 只有行棋方自己的客户端处理自己的超时
          handleTimeout();
          return;
        }
      }
      renderPlayers();
    }, 250);
  }

  function stopTimer() {
    if (timerTick) { clearInterval(timerTick); timerTick = null; }
  }

  function handleTimeout() {
    var me = myRole;
    if (chess.inCheck(me) || strikes[me] >= 2) {
      // 被将军 或 第三次超时 → 投降
      gameOver = true;
      stopTimer();
      Net.send({ type: 'resign', reason: 'timeout' });
      showGameOver('游戏结束', chess.inCheck(me) ? '你超时且被将军，判负' : '你第三次超时，判负');
      updateUI();
      return;
    }
    strikes[me]++;
    // 随机走一步合法棋（不会导致自己被将军）
    var moves = chess.getMoves();
    if (!moves.length) { checkGameOver(); return; }
    var mv = moves[Math.floor(Math.random() * moves.length)];
    var san = chess._moveToSAN(mv);
    chess.makeMove(mv);
    lastMove = { from: mv.from, to: mv.to };
    selected = null; legalTargets = [];
    oppSelected = null;
    movesList.push(san);
    moveLog.push({ from: mv.from, to: mv.to, promotion: mv.promotion || undefined });
    Net.send({ type: 'move', move: { from: mv.from, to: mv.to, promotion: mv.promotion || undefined } });
    Net.send({ type: 'deselect' });
    resetMoverTimer(me);
    updateUI();
    checkGameOver();
    toast('超时，随机走子（' + san + '）');
  }

  function applyUndo(plies) {
    for (var i = 0; i < plies; i++) {
      if (!chess.history.length) break;
      chess.undo();
      movesList.pop();
      moveLog.pop();
    }
    reviewChess = null;
    reviewing = false;
    reviewIdx = moveLog.length;
    var backBtn = document.getElementById('btn-back-current');
    if (backBtn) backBtn.classList.add('hidden');
    lastMove = null;
    if (chess.history.length) {
      var last = chess.history[chess.history.length - 1].move;
      lastMove = { from: last.from, to: last.to };
    }
    gameOver = false;
    selected = null; legalTargets = [];
    updateUI();
  }

  function resetGame() {
    chess.reset();
    chess.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
    updateUndoBtn();
    movesList = [];
    moveLog = [];
    selected = null; legalTargets = [];
    lastMove = null;
    gameOver = false;
    pendingPromo = null;
    oppSelected = null;
    reviewChess = null;
    reviewing = false;
    reviewIdx = 0;
    reviewLastMove = null;
    strikes.w = 0; strikes.b = 0;
    if (rules.timeLimit > 0) {
      timerMs.w = rules.timeLimit * 1000;
      timerMs.b = rules.timeLimit * 1000;
    }
    var backBtn = document.getElementById('btn-back-current');
    if (backBtn) backBtn.classList.add('hidden');
    hideModal(confirmModal);
    startTimer();
    updateUI();
  }

  /* ---------- 对局结束 / 横幅 ---------- */
  function checkGameOver() {
    var st = chess.getStatus();
    if (!st.over) return;
    gameOver = true;
    stopTimer();
    var msg;
    if (st.result === 'draw') {
      msg = st.reason === 'stalemate' ? '和棋 · 无子可动' : (st.reason === 'checkmate' ? '和棋' : '和棋');
    } else {
      msg = (st.result === myRole ? '你获胜' : '你输了') + (st.reason === 'checkmate' ? ' · 将杀' : '');
    }
    showGameOver('游戏结束', msg);
    updateUI();
  }

  function finishDraw(msg) {
    gameOver = true;
    stopTimer();
    showGameOver('游戏结束', msg);
    updateUI();
  }

  // 对局结束提示（复用提示弹窗布局）
  // 注意：对局结束后不注销开放房间，保留连接供双方"再来一局"/复盘；
  // 待任一方退出游戏页时（pagehide）再注销房间并断开。
  function showGameOver(title, msg) {
    showPrompt(title || '游戏结束', msg);
  }

  // 连接断开提示（提示类弹窗）
  function showDisconnected() {
    showPrompt('连接已断开', '对方已离开或连接中断，对局无法继续');
  }

  // 提示类弹窗（confirm-page 样式）：返回主界面 / 继续查看棋盘
  function showPrompt(title, text, yesCb, noCb, yesLabel, noLabel) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmYesBtn.textContent = yesLabel || '返回主界面';
    confirmNoBtn.textContent = noLabel || '继续查看棋盘';
    confirmAction = {
      yes: yesCb || function () { location.href = 'index.html'; },
      no: noCb || function () { hideModal(confirmModal); }
    };
    showModal(confirmModal);
  }

  function setConnState(s) {
    connStateEl.textContent = s;
    var color = '#FFD038';
    if (s === '已连接') color = '#00FF15';
    else if (s.indexOf('断开') !== -1 || s.indexOf('错误') !== -1 || s.indexOf('失败') !== -1) color = '#FF0000';
    connStateEl.style.color = color;
  }

  /* 观战人数显示（房主/对局者/观战者通用） */
  function updateSpecCount(n) {
    var el = document.getElementById('spec-count');
    if (!el) return;
    el.textContent = '当前有 ' + n + ' 人观战';
    el.classList.toggle('hidden', n <= 0);
  }

  /* ---------- 控制按钮 ---------- */
  $('btn-undo').addEventListener('click', function () {
    if (gameOver) return;
    if (rules.noUndo) { toast('本局已禁用悔棋'); return; }
    if (awaiting.undo) return;
    awaiting.undo = true;
    Net.send({ type: 'undo-request' });
    toast('已发送悔棋请求');
  });
  $('btn-draw').addEventListener('click', function () {
    if (gameOver) return;
    if (awaiting.draw) return;
    awaiting.draw = true;
    Net.send({ type: 'offer-draw' });
    toast('已发送和棋请求');
  });
  $('btn-resign').addEventListener('click', function () {
    if (gameOver) return;
    askConfirm('确定认输吗？', function () {
      gameOver = true;
      stopTimer();
      Net.send({ type: 'resign' });
      showGameOver('游戏结束', '你认输了');
      updateUI();
    }, null, '确认认输');
  });
  $('btn-rematch').addEventListener('click', function () {
    if (!gameOver) { toast('对局结束后才能再来一局'); return; }
    if (awaiting.rematch) return;
    awaiting.rematch = true;
    Net.send({ type: 'rematch-request' });
    toast('已发送再来一局请求');
  });
  $('btn-wait-back').addEventListener('click', function () {
    unregisterOpenRoom(myPeerId);
    location.href = 'index.html';
  });

  /* ---------- 初始化 ---------- */
  // 棋盘比例：格子 : 边框 = 16 : 1。将棋盘宽度吸附到 121 的整数倍（121k），
  // 则格子 = 16k px、边框 = k px，比例精确、整数像素、恰好铺满。
  var scaleSlider = document.getElementById('board-scale');
  var scaleLabel = document.getElementById('board-scale-label');
  var panelSlider = document.getElementById('panel-scale');
  var panelLabel = document.getElementById('panel-scale-label');
  var settingsModal = document.getElementById('settings-modal');

  var boardScale = 1;
  try {
    var saved = parseFloat(localStorage.getItem('chessBoardScale'));
    if (saved > 0 && saved <= 3) boardScale = saved;
  } catch (e) {}
  scaleSlider.value = Math.round(boardScale * 100);
  scaleLabel.textContent = Math.round(boardScale * 100) + '%';

  // 面板缩放（独立于棋盘）
  var panelScale = 1;
  try {
    var savedPanel = parseFloat(localStorage.getItem('chessPanelScale'));
    if (savedPanel > 0 && savedPanel <= 3) panelScale = savedPanel;
  } catch (e) {}
  panelSlider.value = Math.round(panelScale * 100);
  panelLabel.textContent = Math.round(panelScale * 100) + '%';
  document.documentElement.style.setProperty('--panel-scale', panelScale.toFixed(2));

  var boardWrapEl = document.querySelector('.board-wrap');
  var gameLayoutEl = document.querySelector('.game-layout');
  var currentBoardW = 0;

  // 根据面板缩放与棋盘宽度动态设置网格列宽，使面板贴住棋盘、避免空隙过大
  function isNarrow() {
    return !!window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  }

  function applyLayout() {
    if (!gameLayoutEl) return;
    if (isNarrow()) {
      gameLayoutEl.style.gridTemplateColumns = '1fr';
      return;
    }
    var pw = Math.round(230 * panelScale);
    gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + currentBoardW + 'px ' + pw + 'px';
  }

  // 滑动条样式：轨道 62:1（宽:高），滑块宽=滑动条粗细的 2.5 倍、高=7 倍（宽:高=2.5:7）
  // 尺寸以 em 输出（相对当前字号），使滑块随设置页字号等比缩放
  function styleSlider() {
    var sliders = [scaleSlider, panelSlider].filter(Boolean);
    for (var i = 0; i < sliders.length; i++) {
      var s = sliders[i];
      var w = s.clientWidth || 300;
      var fs = parseFloat(window.getComputedStyle(s).fontSize) || 43.6;
      var trackHpx = Math.max(2, w / 62);
      var trackH = trackHpx / fs;   // em
      var thumbH = trackH * 7;
      var thumbW = trackH * 2.5;
      var thumbWpx = trackHpx * 2.5;   // 用于填充计算（px）
      var min = parseFloat(s.min) || 40;
      var max = parseFloat(s.max) || 200;
      var val = parseFloat(s.value) || 100;
      var f = Math.max(0, Math.min(1, (val - min) / (max - min)));
      // 浏览器将滑块中心置于 f*(轨道宽-滑块宽)+滑块宽/2 处，
      // 填充边界按滑块中心换算，使金色区域正好截止于滑块。
      var fill = (f * (1 - thumbWpx / w) + thumbWpx / (2 * w)) * 100;
      s.style.setProperty('--track-h', trackH.toFixed(4) + 'em');
      s.style.setProperty('--thumb-w', thumbW.toFixed(4) + 'em');
      s.style.setProperty('--thumb-h', thumbH.toFixed(4) + 'em');
      s.style.setProperty('--fill', fill.toFixed(2) + '%');
    }
  }

  function syncBoardSize() {
    if (!boardWrapEl) return;
    // 棋盘尺寸仅由棋盘缩放与视口决定，不受面板大小影响
    var avail;
    if (isNarrow()) {
      avail = Math.min(window.innerWidth * 0.94, window.innerHeight * 0.6, 520) * boardScale;
    } else {
      avail = Math.min(window.innerWidth * 0.88, window.innerHeight * 0.72, 520) * boardScale;
    }
    avail = Math.max(121, avail);
    // 格子尺寸独立取整（1px 粒度），棋盘宽度随格子连续变化（约 1.5% 步进），
    // 替代旧的 121px 整数倍（约 25% 才变一次）
    var cell = Math.round((avail + 7) / 8);
    var borderPx = Math.max(1, Math.round(cell / 16));
    var W = Math.max(121, cell * 8 - 7 * borderPx);
    currentBoardW = W;
    boardWrapEl.style.width = W + 'px';
    boardWrapEl.style.height = W + 'px';
    boardWrapEl.style.setProperty('--cell', cell + 'px');
    boardWrapEl.style.setProperty('--cell-border', borderPx + 'px');
    var areaEl = document.querySelector('.board-area');
    if (areaEl) areaEl.style.height = W + 'px';   /* 棋盘区高度=棋盘尺寸，防止棋盘溢出面板 */
    applyLayout();
  }
  syncBoardSize();
  styleSlider();

  // 平板端布局重组：玩家卡移入上方面板，操作/提示/连接/棋谱移入下方面板
  function arrangePanels() {
    var tablet = !!window.matchMedia && window.matchMedia('(min-width: 561px) and (max-width: 900px)').matches;
    var leftPanel = document.querySelector('.panel.left');
    var rightPanel = document.querySelector('.panel.right');
    var topPanel = document.querySelector('.top-panel');
    var bottomPanel = document.querySelector('.bottom-panel');
    var bottomRight = document.querySelector('.bottom-right');
    var playerTop = document.getElementById('player-top');
    var playerBottom = document.getElementById('player-bottom');
    var statusBox = document.querySelector('.status-box');
    var controls = document.querySelector('.controls');
    var connLine = document.querySelector('.conn-line');
    var movesBox = document.querySelector('.moves-box');
    var btnHome = document.getElementById('btn-home');
    var btnChat = document.getElementById('btn-chat');
    var btnCopyMoves = document.getElementById('btn-copy-moves');
    if (!leftPanel || !rightPanel || !playerTop || !playerBottom || !statusBox || !controls || !connLine || !movesBox || !btnHome) return;
    if (tablet) {
      topPanel.appendChild(playerTop);
      topPanel.appendChild(playerBottom);
      bottomPanel.appendChild(controls);
      if (btnCopyMoves) bottomPanel.appendChild(btnCopyMoves);
      bottomPanel.appendChild(btnHome);
      bottomRight.appendChild(statusBox);
      bottomRight.appendChild(connLine);
      bottomRight.appendChild(movesBox);
      if (btnChat) controls.appendChild(btnChat);   /* 发送消息：设置按钮下方，与上方按钮同宽 */
    } else {
      leftPanel.appendChild(playerTop);
      leftPanel.appendChild(statusBox);
      leftPanel.appendChild(controls);
      leftPanel.appendChild(connLine);
      rightPanel.appendChild(playerBottom);
      rightPanel.appendChild(movesBox);
      if (btnCopyMoves) rightPanel.appendChild(btnCopyMoves);   /* 复制棋谱：棋谱下方 */
      if (btnChat) rightPanel.appendChild(btnChat);   /* 发送消息：棋谱下方 */
      rightPanel.appendChild(btnHome);
    }
    if (typeof syncBoardSize === 'function') syncBoardSize();
    Profile.adjustBtnHitAreas();
  }
  arrangePanels();
  Profile.adjustBtnHitAreas();

  window.addEventListener('resize', function () { arrangePanels(); syncBoardSize(); styleSlider(); Profile.adjustBtnHitAreas(); });

  $('btn-settings').addEventListener('click', function () { showModal(settingsModal); styleSlider(); updateSettingsScrollbar(); });
  var nicknameSaveButton = $('btn-nickname-save');
  if (nicknameSaveButton) nicknameSaveButton.addEventListener('click', saveGameNickname);
  Profile.wireModalOutsideClick(settingsModal, function () { hideModal(settingsModal); });
  $('btn-settings-close').addEventListener('click', function () { hideModal(settingsModal); });

  // 设置页/规则页自定义滚动条（公共实现见 profile.js 的 Profile.wireScrollbar）
  var updateSettingsScrollbar = Profile.wireScrollbar(
    document.getElementById('settings-body'),
    document.getElementById('settings-scrollbar'),
    document.getElementById('settings-scrollbar-thumb')
  );
  var updateCreateScrollbar = Profile.wireScrollbar(
    document.getElementById('create-body'),
    document.getElementById('create-scrollbar'),
    document.getElementById('create-scrollbar-thumb')
  );
  window.addEventListener('resize', function () { updateSettingsScrollbar(); updateCreateScrollbar(); });
  $('btn-back-current').addEventListener('click', function () { reviewTo(moveLog.length); });
  $('btn-home').addEventListener('click', function () {
    try { sessionStorage.removeItem('cmchess-host-session'); } catch (e) {}
    location.href = 'index.html';
  });
  /* 复制棋谱：按 PGN 行格式（1. e4 e5 2. Nf3 Nc6）复制全部走子 */
  $('btn-copy-moves').addEventListener('click', function () {
    var parts = [];
    for (var mi = 0; mi < movesList.length; mi += 2) {
      var num = (mi / 2 + 1) + '.';
      var w = movesList[mi];
      var b = movesList[mi + 1];
      parts.push(num + ' ' + w + (b ? ' ' + b : ''));
    }
    var text = parts.join(' ') || '（无棋谱）';
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); toast('已复制棋谱'); } catch (e) { toast('复制失败，请手动复制'); }
      document.body.removeChild(t);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('已复制棋谱'); }, fallback);
    else fallback();
  });

  /* ---------- 对局内消息 ---------- */
  var roster = [];              // 房间成员（含自己），host 广播
  var chatSel = {};             // 已选目标（id → true）
  var chatPath = [];            // 预设消息路径（文字）
  var chatModal = document.getElementById('chat-modal');
  var chatPlayersEl = document.getElementById('chat-players');
  var chatInput = document.getElementById('chat-input');
  var CHAT_THEMES = ['白方', '黑方', '观战者'];
  var CHAT_COMMON = ['的', '要赢了', '要输了', '打的好', '打的烂', '会玩', '不会玩', '走了一步好棋', '走了一步烂棋'];
  var CHAT_SPEC_TURN = ['不要提示', '需要提示', '帮帮我', '帮帮对手', '不要帮我', '不要帮对手', '看我操作'];
  var CHAT_SPEC_VIEW = ['看白方操作', '看黑方操作', '不要提示', '帮一下白方', '帮一下黑方', '白方赢了', '黑方赢了'];
  var CHAT_PIECES = ['兵', '车', '马', '象', '王后', '王'];
  var CHAT_ACTIONS = ['要吃子', '可以吃子', '要被吃', '可以兑子', '要逃', '要保护王'];
  var CHAT_EXTRA_PAWN = ['可以升变', '不要升变'];
  var CHAT_EXTRA_RK = ['可以易位', '不要易位'];

  function chatRoleText(role) {
    if (role === 'w') return '白方';
    if (role === 'b') return '黑方';
    return '观战者';
  }
  function myChatId() {
    if (Net.isHost()) return 'w';
    if (isSpec) return 's:' + (Net.getMyId() || '');
    return 'b';
  }
  function myChatName() {
    return isSpec ? (mySpecName || 'Player #1') : (myProfileName || (Net.isHost() ? 'Player #1' : 'Player #2'));
  }
  function chatLen(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 255 ? 2 : 1;
    return n;
  }
  // 房主构建成员列表并广播；非房主使用收到的 roster
  function buildRosterList() {
    if (!Net.isHost()) return roster.slice();
    var list = [];
    if (myRole) list.push({ id: 'w', role: 'w', name: myProfileName || 'Player #1' });
    if (oppProfileName || myRole === 'w') list.push({ id: 'b', role: 'b', name: oppProfileName || 'Player #2' });
    Net.getSpecs().forEach(function (s) { list.push({ id: s.id, role: 'spec', name: s.name }); });
    return list;
  }
  function broadcastRoster() {
    if (!Net.isHost()) return;
    roster = buildRosterList();
    Net.send({ type: 'roster', list: roster });
  }
  // 右上角消息显示（淡入 → 8s 倒计时 → 淡出）
  function showChatMessage(fromText, text) {
    if (ui.hideChat) return;
    var layer = document.getElementById('chat-layer');
    if (!layer) return;
    var msg = document.createElement('div');
    msg.className = 'chat-msg';
    var t = document.createElement('span');
    t.className = 'chat-text';
    t.textContent = fromText + ' 说: ' + text;
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
  // 预设消息选项渲染
  function makeChatOpt(label, sel, cb) {
    var b = document.createElement('button');
    b.className = 'chat-option' + (sel ? ' sel' : '');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', cb);
    return b;
  }
  function renderChatPreset() {
    var presetEl = document.querySelector('.chat-preset');
    var prevScroll = presetEl ? presetEl.scrollTop : 0;
    try {
      var opEls = ['chat-op-theme', 'chat-op-2', 'chat-op-3', 'chat-op-4', 'chat-op-5'].map(function (id) {
        return document.getElementById(id);
      });
      opEls.forEach(function (el) { if (el) el.innerHTML = ''; });
      var theme = chatPath[0] || '';
      /* 没有观战者时，预设消息不提供"观战者"选项 */
      var themes = CHAT_THEMES.slice();
      var hasSpec = buildRosterList().some(function (m) { return m.role === 'spec'; });
      if (!hasSpec) themes = themes.filter(function (t) { return t !== '观战者'; });
      if (theme === '观战者' && !hasSpec) chatPath = [];
      themes.forEach(function (label) {
        opEls[0].appendChild(makeChatOpt(label, theme === label, function () {
          chatPath = theme === label ? [] : [label];
          renderChatPreset();
        }));
      });
      if (!chatPath.length) return;
      // 二级选项
      var sel2 = chatPath[1] || '';
      var opts2 = chatPath[0] === '观战者'
        ? (chess.getTurn() === myRole ? CHAT_SPEC_TURN : CHAT_SPEC_VIEW)
        : CHAT_COMMON;
      opts2.forEach(function (label) {
        opEls[1].appendChild(makeChatOpt(label, sel2 === label, function () {
          chatPath = sel2 === label ? chatPath.slice(0, 1) : [chatPath[0], label];
          renderChatPreset();
        }));
      });
      if (chatPath[0] === '观战者') return;   // 观战者主题无下级
      if (chatPath.length < 2) return;
      // 三级：选"的"后选棋子
      if (sel2 === '的') {
        var sel3 = chatPath[2] || '';
        CHAT_PIECES.forEach(function (label) {
          opEls[2].appendChild(makeChatOpt(label, sel3 === label, function () {
            chatPath = sel3 === label ? chatPath.slice(0, 2) : [chatPath[0], '的', label];
            renderChatPreset();
          }));
        });
        if (chatPath.length < 3) return;
        // 四级：动作（含兵/车/王的特殊选项，与动作同层级）
        var sel4 = chatPath[3] || '';
        var actOpts = CHAT_ACTIONS.slice();
        if (sel3 === '王') {
          actOpts = actOpts.filter(function (a) { return a !== '可以兑子' && a !== '要保护王'; });
        }
        if (sel3 === '兵') actOpts = actOpts.concat(CHAT_EXTRA_PAWN);
        else if (sel3 === '车' || sel3 === '王') actOpts = actOpts.concat(CHAT_EXTRA_RK);
        actOpts.forEach(function (label) {
          opEls[3].appendChild(makeChatOpt(label, sel4 === label, function () {
            chatPath = sel4 === label ? chatPath.slice(0, 3) : chatPath.slice(0, 3).concat(label);
            renderChatPreset();
          }));
        });
      }
    } finally {
      if (presetEl) presetEl.scrollTop = prevScroll;   /* 保持翻页位置 */
    }
  }
  // 玩家列表（多选）
  function renderChatTargets(selectAll) {
    var me = myChatId();
    var list = buildRosterList().filter(function (m) { return m.id !== me; });
    var specs = list.filter(function (m) { return m.role === 'spec'; });
    var others = list.filter(function (m) { return m.role !== 'spec'; });
    for (var i = specs.length - 1; i > 0; i--) {   // 观战者随机顺序
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = specs[i]; specs[i] = specs[j]; specs[j] = tmp;
    }
    list = others.concat(specs);
    var locked = !rules.allowPrivateChat;   /* 私聊关闭：默认全选且不可更改 */
    var prevPlayersScroll = chatPlayersEl.scrollTop;
    chatSel = {};
    if (selectAll || locked) list.forEach(function (m) { chatSel[m.id] = true; });
    chatPlayersEl.innerHTML = '';
    list.forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'chat-player' + (chatSel[m.id] ? ' sel' : '');
      b.type = 'button';
      b.textContent = (m.name || 'Player') + '(' + chatRoleText(m.role) + ')';
      b.addEventListener('click', function (e) {
        if (locked) return;
        if (e.altKey) { list.forEach(function (x) { chatSel[x.id] = true; }); }
        else if (e.ctrlKey) { list.forEach(function (x) { chatSel[x.id] = false; }); }
        else if (e.shiftKey) { list.forEach(function (x) { chatSel[x.id] = !chatSel[x.id]; }); }
        else { chatSel[m.id] = !chatSel[m.id]; }
        renderChatTargetsSel();
      });
      chatPlayersEl.appendChild(b);
    });
    chatPlayersEl.scrollTop = prevPlayersScroll;   /* 保持翻页位置 */
  }
  function renderChatTargetsSel() {
    var btns = chatPlayersEl.querySelectorAll('.chat-player');
    var me = myChatId();
    var list = buildRosterList().filter(function (m) { return m.id !== me; });
    for (var i = 0; i < btns.length && i < list.length; i++) {
      btns[i].classList.toggle('sel', !!chatSel[list[i].id]);
    }
  }
  function openChat(selectAll) {
    if (rules.noChat) { toast('本局已禁用发送消息'); return; }
    if (!myRole) { toast('连接未就绪'); return; }
    var locked = !rules.allowPrivateChat;   /* 私聊关闭：默认全选且不可更改 */
    if (!chatModal.classList.contains('hidden')) {
      /* 已打开：alt+T 直接全选，普通 T 忽略 */
      if (selectAll || locked) renderChatTargets(true);
      return;
    }
    chatPath = [];
    chatInput.value = '';
    renderChatTargets(selectAll || locked);
    renderChatPreset();
    showModal(chatModal);
  }
  function sendChatMessage() {
    var targets = Object.keys(chatSel).filter(function (id) { return chatSel[id]; });
    /* 不选收件人时按全局广播发送 */
    var text = '';
    if (chatInput.value.trim()) {
      text = chatInput.value.trim();
      var len = chatLen(text);
      if (len < 1 || len > 60) { toast('消息长度需为 1-60 字（中文算2字）'); return; }
    } else {
      text = chatPath.join(' ');
      if (!text) { toast('请选择消息内容'); return; }
    }
    var from = { role: myRole === 'spec' ? 'spec' : (myRole || 'spec'), name: myChatName() };
    showChatMessage(from.name + '(' + chatRoleText(from.role) + ')', text);
    Net.sendChat({ to: targets, from: from, text: text });
    hideModal(chatModal);
  }
  $('chat-send').addEventListener('click', sendChatMessage);
  $('chat-cancel').addEventListener('click', function () { hideModal(chatModal); });
  var chatButton = $('btn-chat');
  if (chatButton) chatButton.addEventListener('click', function () { openChat(false); });   /* 棋谱下方/设置下方的发送消息按钮 */
  Profile.wireModalOutsideClick(chatModal, function () { hideModal(chatModal); });
  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChatMessage();
    e.stopPropagation();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 't' || e.key === 'T') {
      var tag = e.target && e.target.tagName;
      /* 输入框中按 alt+T 同样执行全选，普通 T 不触发 */
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !e.altKey) return;
      e.preventDefault();
      openChat(!!e.altKey);   /* alt+T 打开时全选 */
    }
  });

  $('btn-scale-reset').addEventListener('click', function () {
    boardScale = 1;
    scaleSlider.value = 100;
    scaleLabel.textContent = '100%';
    try { localStorage.removeItem('chessBoardScale'); } catch (e) {}

    panelScale = 1;
    panelSlider.value = 100;
    panelLabel.textContent = '100%';
    try { localStorage.removeItem('chessPanelScale'); } catch (e) {}
    document.documentElement.style.setProperty('--panel-scale', '1');

    syncBoardSize();
    styleSlider();
    toast('已恢复默认大小');
  });
  scaleSlider.addEventListener('input', function () {
    boardScale = parseFloat(scaleSlider.value) / 100;
    scaleLabel.textContent = scaleSlider.value + '%';
    try { localStorage.setItem('chessBoardScale', boardScale); } catch (e) {}
    syncBoardSize();
    styleSlider();
  });
  panelSlider.addEventListener('input', function () {
    panelScale = parseFloat(panelSlider.value) / 100;
    panelLabel.textContent = panelSlider.value + '%';
    try { localStorage.setItem('chessPanelScale', panelScale); } catch (e) {}
    document.documentElement.style.setProperty('--panel-scale', panelScale.toFixed(2));
    syncBoardSize();
    styleSlider();
  });

  /* 界面选项（个人偏好） */
  function setToggle(el, on) {
    var img = el.querySelector('img');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    img.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function toggleIsOn(el) {
    return el.getAttribute('aria-pressed') === 'true';
  }
  function initToggle(id, key, def, prop) {
    var el = document.getElementById(id);
    var on = def;
    try { var s = localStorage.getItem(key); if (s !== null) on = s === '1'; } catch (e) {}
    setToggle(el, on);
    el.addEventListener('click', function () {
      on = !on;
      setToggle(el, on);
      if (prop) ui[prop] = on;
      try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {}
      updateUI();
    });
    if (prop) ui[prop] = on;
  }
  initToggle('opt-flip', 'chessOptFlip', false, 'flipBoard');
  initToggle('opt-moves', 'chessOptMoves', true, 'showMoves');
  initToggle('opt-lastmove', 'chessOptLastMove', true, 'showLastMove');
  initToggle('opt-coords', 'chessOptCoords', true, 'showCoords');
  initToggle('opt-oppmoves', 'chessOptOppMoves', true, 'showOpponentMoves');
  initToggle('opt-material', 'chessOptMaterial', true, 'showMaterial');
  initToggle('opt-hide-chat', 'chessOptHideChat', false, 'hideChat');

  /* 规则设置（房主，创建房间前设定） */
  var ruleTimeLimit = document.getElementById('rule-time-limit');
  var ruleTimeSec = document.getElementById('rule-time-sec');
  var ruleNoCastle = document.getElementById('rule-no-castle');
  var ruleNoPromo = document.getElementById('rule-no-promo');
  var ruleNoUndo = document.getElementById('rule-no-undo');
  var ruleAllowSpec = document.getElementById('rule-allow-spec');
  var ruleNoChat = document.getElementById('rule-no-chat');
  var rulePrivateChat = document.getElementById('rule-private-chat');
  try {
    var savedRules = JSON.parse(localStorage.getItem('chessRules'));
    if (savedRules) {
      rules.timeLimit = savedRules.timeLimit || 0;
      rules.noCastling = !!savedRules.noCastling;
      rules.noPromotion = !!savedRules.noPromotion;
      rules.noUndo = !!savedRules.noUndo;
      rules.open = Object.prototype.hasOwnProperty.call(savedRules, 'open') ? !!savedRules.open : true;
      rules.allowSpec = savedRules.allowSpec !== false;   /* 默认允许观战 */
      rules.noChat = !!savedRules.noChat;                 /* 默认允许发送消息 */
      rules.allowPrivateChat = !!savedRules.allowPrivateChat;   /* 默认禁止私聊 */
    }
  } catch (e) {}
  // 将当前生效的规则同步到设置页 UI
  function syncRulesUI() {
    setToggle(ruleTimeLimit, rules.timeLimit > 0);
    ruleTimeSec.value = rules.timeLimit > 0 ? rules.timeLimit : 30;
    setToggle(ruleNoCastle, rules.noCastling);
    setToggle(ruleNoPromo, rules.noPromotion);
    setToggle(ruleNoUndo, rules.noUndo);
    setToggle(ruleAllowSpec, rules.allowSpec);
    setToggle(ruleNoChat, rules.noChat);
    setToggle(rulePrivateChat, rules.allowPrivateChat);
    syncRulesDisabled();
  }
  /* 开启"禁止发送消息"时，"允许私聊"不可更改 */
  function syncRulesDisabled() {
    if (!rulePrivateChat) return;
    var noChat = toggleIsOn(ruleNoChat);
    rulePrivateChat.disabled = noChat;
    rulePrivateChat.classList.toggle('disabled', noChat);
  }
  syncRulesUI();
  [ruleTimeLimit, ruleNoCastle, ruleNoPromo, ruleNoUndo, ruleAllowSpec, ruleNoChat, rulePrivateChat].forEach(function (el) {
    el.addEventListener('click', function () {
      if (el === rulePrivateChat && toggleIsOn(ruleNoChat)) return;   /* 禁止发送消息时不可更改 */
      setToggle(el, !toggleIsOn(el));
      syncRulesDisabled();
    });
  });
  /* 读取设置页 UI 到 rules 并保存 */
  function applyRulesFromUI() {
    rules.timeLimit = toggleIsOn(ruleTimeLimit) ? Math.max(3, parseInt(ruleTimeSec.value, 10) || 30) : 0;
    rules.noCastling = toggleIsOn(ruleNoCastle);
    rules.noPromotion = toggleIsOn(ruleNoPromo);
    rules.noUndo = toggleIsOn(ruleNoUndo);
    rules.allowSpec = toggleIsOn(ruleAllowSpec);
    rules.noChat = toggleIsOn(ruleNoChat);
    rules.allowPrivateChat = toggleIsOn(rulePrivateChat);
    rules.open = false;   /* 进入等待界面默认不开放，由等待界面“开放”按钮手动开启 */
    try { localStorage.setItem('chessRules', JSON.stringify(rules)); } catch (e) {}
    chess.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
    updateUndoBtn();
  }
  chess.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
  updateUndoBtn();

  /* ---------- 等待界面（大厅） ---------- */
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
  /* 房主：当前房间成员（含观战者），用于名片展示与广播 */
  function lobbyListForHost() {
    var list = [{ role: 'w', name: myProfileName || 'Player #1', host: true, ready: true }];
    if (oppConnected) list.push({ role: 'b', name: oppProfileName || 'Player #2', host: false, ready: oppReady });
    Net.getSpecs().forEach(function (s) { list.push({ role: 'spec', name: s.name, host: false, ready: false }); });
    return list;
  }
  function broadcastLobby() {
    if (!Net.isHost()) return;
    guestLobbyList = lobbyListForHost();
    Net.send({ type: 'lobby', open: !!rules.open, list: guestLobbyList });
    renderLobby();
  }
  function updateLobbyOpenBtn() {
    if (!btnOpenRoom) return;
    btnOpenRoom.disabled = !Net.isHost();
    btnOpenRoom.textContent = rules.open ? '已开放' : '开放';
  }
  /* 渲染房间成员名片（参考炸金花等待界面） */
  function renderLobby() {
    if (!waitBody) return;
    var list = Net.isHost() ? lobbyListForHost() : (guestLobbyList || []);
    waitBody.innerHTML = '';
    list.forEach(function (p) {
      var card = document.createElement('div');
      var meRole = myRole || (Net.isHost() ? 'w' : 'b');
      card.className = 'zjh-pcard' + (!isSpec && p.role === meRole ? ' me' : '');
      var name = document.createElement('div');
      name.className = 'zjh-pname';
      name.textContent = p.name || 'Player';
      card.appendChild(name);
      var hasIcon = false;
      if (p.host) {
        var ic = document.createElement('img');
        ic.className = 'zjh-picon';
        ic.src = 'texture/host.png';
        card.appendChild(ic);
        hasIcon = true;
      } else if (p.ready && p.role !== 'spec') {
        var ic2 = document.createElement('img');
        ic2.className = 'zjh-picon';
        ic2.src = 'texture/ready.png';
        card.appendChild(ic2);
        hasIcon = true;
      }
      /* 名字过长时动态缩小字号以装下 */
      waitBody.appendChild(card);
      var avail = card.clientWidth * (hasIcon ? (1 - 0.048 - 0.07 - 0.065) : 0.87);
      var fs = parseFloat(getComputedStyle(name).fontSize) || 14;
      var guard = 0;
      while (name.scrollWidth > avail && fs > 6 && guard < 60) {
        fs -= 0.5;
        name.style.fontSize = fs + 'px';
        guard++;
      }
    });
    if (inLobby) {
      if (Net.isHost()) {
        btnStartGame.classList.remove('hidden');
        btnReady.classList.add('hidden');
        btnStartGame.disabled = !(oppConnected && oppReady);
      } else if (isSpec) {
        btnStartGame.classList.add('hidden');
        btnReady.classList.add('hidden');
      } else {
        btnStartGame.classList.add('hidden');
        btnReady.classList.remove('hidden');
        btnReady.textContent = myReady ? '取消准备' : '准备';
      }
    }
    updateLobbyOpenBtn();
  }
  /* 开局：房主点击开始游戏或收到房主开始消息后调用 */
  function startGame() {
    if (!inLobby) return;
    inLobby = false;
    document.body.classList.remove('chess-pre-game');
    hideModal(waitModal);
    hideModal(createModal);
    hideModal(confirmModal);
    hideModal(promoModal);
    connectionEstablished = true;
    setConnState('已连接');
    if (isSpec) {
      setSpecMode(true);
      var oppLabel = document.getElementById('opt-oppmoves-label');
      if (oppLabel) oppLabel.textContent = '显示双方选子';
      updateUI();
      toast('你正在观战');
      return;
    }
    chess.setRules({ noCastling: rules.noCastling, noPromotion: rules.noPromotion });
    updateUndoBtn();
    if (Net.isHost() && myPeerId && rules.open && rules.allowSpec) registerOpenRoom(myPeerId, true);
    if (rules.timeLimit > 0) {
      timerMs.w = rules.timeLimit * 1000;
      timerMs.b = rules.timeLimit * 1000;
      startTimer();
    }
    updateUI();
    toast(myRole === 'w' ? '你执白棋，先手' : '你执黑棋，后手');
  }
  if (btnOpenRoom) btnOpenRoom.addEventListener('click', function () {
    if (!Net.isHost()) return;
    rules.open = !rules.open;
    try { localStorage.setItem('chessRules', JSON.stringify(rules)); } catch (e) {}
    syncOpenRoom();
    updateLobbyOpenBtn();
    broadcastLobby();
  });
  var roomCodeBtn = document.getElementById('btn-room-code');
  if (roomCodeBtn) roomCodeBtn.addEventListener('click', function () {
    if (this.dataset.shown) {
      delete this.dataset.shown;
      this.textContent = '房间号码';
      return;
    }
    var rid = Net.isHost() ? (myPeerId || '') : (joinId || '');
    copyText(rid, '已复制房间号码');
    this.textContent = rid;
    this.dataset.shown = '1';
  });
  var inviteLinkBtn = document.getElementById('btn-copy-link');
  var inviteLinkTimer = null;
  if (inviteLinkBtn) inviteLinkBtn.addEventListener('click', function () {
    var rid = Net.isHost() ? (myPeerId || '') : (joinId || '');
    var link = new URL('game.html', location.href);
    link.search = '?mode=join&id=' + encodeURIComponent(rid);
    copyText(link.href, '已复制邀请链接');
    this.textContent = '已复制';
    clearTimeout(inviteLinkTimer);
    var self = this;
    inviteLinkTimer = setTimeout(function () { self.textContent = '复制邀请链接'; }, 5000);
  });
  btnStartGame.addEventListener('click', function () {
    if (!Net.isHost()) return;
    if (!oppConnected) { toast('等待对手加入'); return; }
    if (!oppReady) { toast('对手尚未准备'); return; }
    Net.send({ type: 'start', rules: rules });
    startGame();
  });
  btnReady.addEventListener('click', function () {
    if (Net.isHost() || isSpec) return;
    myReady = !myReady;
    Net.send({ type: 'lobby-ready', v: myReady });
    if (guestLobbyList) {
      guestLobbyList.forEach(function (p) { if (p.role === 'b') p.ready = myReady; });
    }
    renderLobby();
  });
  $('btn-create-back').addEventListener('click', function () { location.href = 'index.html'; });
  $('btn-create-room').addEventListener('click', function () {
    applyRulesFromUI();
    hideModal(createModal);
    connectNet();
  });

  // 开放房间注册（本地模拟，供测试）：房主创建开放房间时写入列表，3 分钟过期
  function openRoomSummary() {
    var parts = [];
    if (rules.timeLimit > 0) parts.push('每步 ' + rules.timeLimit + ' 秒');
    if (rules.noCastling) parts.push('禁易位');
    if (rules.noPromotion) parts.push('禁升变');
    if (rules.noUndo) parts.push('禁悔棋');
    if (!rules.allowSpec) parts.push('禁止观战');
    if (rules.noChat) parts.push('禁止发送消息');
    if (rules.allowPrivateChat) parts.push('允许私聊');
    return parts.length ? parts.join(' | ') : 'Default';
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
    list.push({ id: id, hostName: hostName, rules: openRoomSummary(), gameStarted: !!started, allowSpec: !!rules.allowSpec, noChat: !!rules.noChat, ts: now, game: 'chess' });
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
  /* 规则变化后同步开放房间注册（host 等待中即时生效，无需重新开房） */
  function syncOpenRoom() {
    if (!Net.isHost() || !myPeerId) return;
    if (rules.open) {
      if (rules.allowSpec) registerOpenRoom(myPeerId, !inLobby);   /* 仅开局后才标记为已开局 */
      else unregisterOpenRoom(myPeerId);   /* 不允许观战：房间不再公开 */
    } else {
      unregisterOpenRoom(myPeerId);
    }
    Net.setAllowSpec(rules.allowSpec);
  }
  /* 对局者是否已连接（用于已开局标记） */
  function playerConnActive() {
    var role = Net.getRole();
    return Net.isHost() && !!role;   /* host 拿到角色即已配对 */
  }

  loadProfile();
  var nicknameInput = document.getElementById('game-nickname');
  if (nicknameInput) nicknameInput.value = Profile.get().name || '';
  updateUI();
  Net.setAllowSpec(rules.allowSpec);   /* 同步允许观战状态 */

  /* 离开游戏页（回主界面/关闭）时注销开放房间，避免残留 */
  window.addEventListener('pagehide', function () {
    unregisterOpenRoom(myPeerId);
  });

  function connectNet() {
    Net.connect({
    mode: mode,
    hostId: mode === 'join' ? joinId : undefined,
    want: specMode ? 'spec' : 'play',   /* 观战模式加入 */
    name: (Profile.get() || {}).name || '',   /* 用于房间成员列表 */
    playerName: (Profile.get() || {}).name || '',
    onSpecName: function (name) {
      mySpecName = name;
      if (nicknameInput) nicknameInput.value = name === 'Player #1' ? '' : name;
      updateUI();
    },
    onPlayerName: function (name) {
      myProfileName = name;
      if (nicknameInput && !Profile.get().name) nicknameInput.value = '';
      updateUI();
    },
    onId: function (id) {
      myPeerId = id;
      if (Net.isHost() && !myProfileName) myProfileName = 'Player #1';
      if (Net.isHost()) syncOpenRoom();   /* 开放房间登记（等待中标记为未开局） */
      showModal(waitModal);
      renderLobby();
    },
    onSpecJoin: function (c) {
      /* 观战者加入：发送对局快照（随后走子消息自动转发） */
      c.send(buildSnapshot());
      if (!inLobby) c.send({ type: 'start', rules: rules });   /* 对局中：让新观战者直接进入观战 */
      broadcastRoster();   /* 成员列表更新 */
      if (inLobby) broadcastLobby();
    },
    onSpecCount: function (n) {
      /* 观战人数变化：连接状态旁显示，并更新成员列表 */
      updateSpecCount(n);
      broadcastRoster();
      if (inLobby) broadcastLobby();
    },
    onSpecRename: function () {
      broadcastRoster();
      if (inLobby) broadcastLobby();
    },
    onOpen: function (role) {
      myRole = role;
      /* 观战者：直接进入等待界面（观战视角） */
      if (role === 'spec') {
        isSpec = true;
        setSpecMode(true);
        var oppLabel0 = document.getElementById('opt-oppmoves-label');
        if (oppLabel0) oppLabel0.textContent = '显示双方选子';   /* 观战视角显示双方选子 */
        showModal(waitModal);
        renderLobby();
        return;
      }
      connectionEstablished = true;
      setConnState('已连接');
      if (Net.isHost()) {
        oppConnected = true;
        oppReady = false;
        broadcastRoster();   /* 成员列表更新 */
        sendProfile();       /* 双方共享名称/头像 */
        broadcastLobby();    /* 广播等待界面成员状态 */
      } else {
        sendProfile();
      }
      showModal(waitModal);
      renderLobby();
      updateUI();
    },
    onMessage: handleRemote,
    onState: function (state) {
      if (state === 'connecting') setConnState('连接中…');
      else if (state === 'waiting') setConnState('等待对手…');
      else if (state === 'open') setConnState('已连接');
      else if (state === 'closed') {
        setConnState('连接已断开');
        if (inLobby) {
          if (Net.isHost()) {
            oppConnected = false;
            oppReady = false;
            oppProfileName = '';
            broadcastLobby();
            toast('对手已离开房间');
          } else {
            showPrompt('连接已断开', isSpec ? '与房主的连接中断，无法继续观战' : '房主已离开或连接中断',
              function () { location.href = 'index.html'; },
              function () { hideModal(confirmModal); },
              '返回主界面', '留在此页');
          }
        } else if (connectionEstablished && !gameOver) {
          // 对局中连接断开：提示类弹窗；对局已结束则不再叠加提示（游戏结束弹窗已在显示）
          showDisconnected();
        }
      }
      else if (state === 'disconnected') setConnState('连接中断，正在重连…');
    },
    onError: function (err) {
      console.error('Peer 错误:', err);
      setConnState('连接错误');
      if (mode === 'join') {
        // 连接失败/满员/未开始/禁止观战提示（提示类弹窗）
        var msg = (err && err.message) || '连接失败';
        var known = msg === '房间已满' || msg === '对局未开始' || msg === '此对局被设置为不可被观战';
        if (msg === '房间已满') {
          showPrompt('加入失败', msg,
            function () { location.href = 'index.html'; },
            function () { location.href = 'game.html?mode=join&id=' + encodeURIComponent(joinId) + '&spec=1'; },
            '返回大厅', '进入观战');
        } else {
          showPrompt('加入失败', known ? msg : '请检查房间号或网络后重试');
        }
      }
    }
    });
  }

  /* 房主：先显示创建房间设置页；加入方：直接连接进入等待界面 */
  if (mode === 'join') {
    connectNet();
  } else {
    syncRulesUI();
    showModal(createModal);
    updateCreateScrollbar();
  }
})();

