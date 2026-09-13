/* turnleft-play.js - Turn Left 游玩界面（以制作器代码为基） */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var DIRS = [
    { dx: 1, dy: 0, name: '右', key: 'd', arrow: 'r' },
    { dx: 0, dy: -1, name: '上', key: 'w', arrow: 'u' },
    { dx: -1, dy: 0, name: '左', key: 'a', arrow: 'l' },
    { dx: 0, dy: 1, name: '下', key: 's', arrow: 'd' }
  ];
  var TASK_NAMES = ['限制步数', '限制通关时玩家朝向', '限制左转次数', '限制走过的红线数量', '限制传送门使用次数', '限制开局朝向'];
  var FACE_BITS = { 1: '上', 2: '右', 4: '下', 8: '左' };

  var TEX = {
    n: 'turnleft-texture/normalline.png', a: 'turnleft-texture/arrowline.png',
    t: 'turnleft-texture/taskline.png', ta: 'turnleft-texture/taskarrowline.png',
    rn: 'turnleft-texture/redline.png', ra: 'turnleft-texture/redarrowline.png',
    rt: 'turnleft-texture/redtaskline.png', rta: 'turnleft-texture/redtaskarrowline.png',
    p1: 'turnleft-texture/portal1.png', p2: 'turnleft-texture/portal2.png', p3: 'turnleft-texture/portal3.png', p4: 'turnleft-texture/portal4.png',
    rp1: 'turnleft-texture/redportal1.png', rp2: 'turnleft-texture/redportal2.png', rp3: 'turnleft-texture/redportal3.png', rp4: 'turnleft-texture/redportal4.png',
    start: 'turnleft-texture/startpoint.png', end: 'turnleft-texture/endpoint.png', startEnd: 'turnleft-texture/startendpoint.png',
    rstart: 'turnleft-texture/redstartpoint.png', rend: 'turnleft-texture/redendpoint.png', rstartEnd: 'turnleft-texture/redstartendpoint.png',
    dot: 'turnleft-texture/connectpoint.png', rdot: 'turnleft-texture/redconnectpoint.png',
    ddot: 'turnleft-texture/darkredconnectpoint.png',
    step: 'turnleft-texture/step.png',
    playerDir: 'turnleft-texture/player-directed.png',
    gtask: 'turnleft-texture/greentaskline.png', gtaskA: 'turnleft-texture/greentaskarrowline.png',
    dtask: 'turnleft-texture/darktaskline.png', dtaskA: 'turnleft-texture/darktaskarrowline.png',
    rdn: 'turnleft-texture/darkredline.png', dra: 'turnleft-texture/darkredarrowline.png',
    drt: 'turnleft-texture/darkredtaskline.png', drta: 'turnleft-texture/darkredtaskarrowline.png',
    player: 'turnleft-texture/player.png'
  };

  var segs = {}, verts = {}, stage = null;
  var levels = [], curIdx = 0;
  var state = null, winDone = false;
  var settings = { panelScale: 100, benchScale: 100, dirMode: 'absolute', animHint: true, playerOpacity: 100, showFacing: true, passLine: 'fill', passRedLine: 'gone', showAnim: true, animSpeed: 100 };
  function wireListScroll(bodyEl, sbEl, thEl) {
    if (!bodyEl || !sbEl || !thEl) return function () {};
    function update() {
      var ov = bodyEl.scrollHeight - bodyEl.clientHeight;
      bodyEl.classList.toggle('has-scrollbar', ov > 0);
      if (ov <= 0) { sbEl.style.display = 'none'; return; }
      sbEl.style.display = 'block';
      var ratio = bodyEl.clientHeight / bodyEl.scrollHeight;
      thEl.style.height = (ratio * 100) + '%';
      thEl.style.top = ((bodyEl.scrollTop / ov) * (100 - ratio * 100)) + '%';
    }
    bodyEl.addEventListener('scroll', update);
    thEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startY = e.clientY, startTop = bodyEl.scrollTop;
      var trackH = sbEl.clientHeight - thEl.offsetHeight;
      var ov = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (trackH <= 0) return;
      function move(ev) { bodyEl.scrollTop = startTop + (ev.clientY - startY) * (ov / trackH); update(); }
      function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    sbEl.addEventListener('mousedown', function (ev) {
      if (ev.target === thEl) return;
      var rect = sbEl.getBoundingClientRect();
      bodyEl.scrollTop = ((ev.clientY - rect.top) / rect.height) * (bodyEl.scrollHeight - bodyEl.clientHeight);
      update();
    });
    return update;
  }
  var updateLevelsScroll = null;
  var animUnit = 2;   /* step 与玩家间距：2/11 或 3/11 玩家边长 */
  var drawOpacity = 100;  /* 当前生效的玩家/箭头不透明度（0-100） */

  var workbench = $('workbench');
  var gridView = $('grid-view');
  var gridCanvas = $('grid-canvas');
  var boardWrap = $('board-wrap');
  var gameLayoutEl = document.querySelector('.game-layout');
  var boardAreaEl = document.querySelector('.board-area');

  function segKey(dir, x, y) { return dir + '/' + x + '/' + y; }
  function vk(x, y) { return x + ',' + y; }
  function lineShape(id) { return (id || 'n').replace(/^r/, ''); }
  function lineCol(id) { return (id || 'n').charAt(0) === 'r' ? 'r' : 'w'; }
  function lineMeta(st) {
    if (!st) return null;
    var shape = lineShape(st.id);
    return { id: st.id, arrow: shape === 'a' || shape === 'ta', task: shape === 't' || shape === 'ta', red: lineCol(st.id) === 'r' };
  }
  function segFromCode(code, vertical) {
    var id, dir;
    if (code >= 0 && code <= 3) { id = ['n', 't', 'rn', 'rt'][code]; }
    else {
      var idx = code - 4;
      if (idx < 0 || idx > 7) return null;
      var shape = idx < 4 ? 'a' : 'ta';
      var col = idx % 2 === 1 ? 'r' : 'w';
      id = (col === 'r' ? 'r' : '') + shape;
      var isLU = idx % 4 < 2;
      dir = vertical ? (isLU ? 'u' : 'd') : (isLU ? 'l' : 'r');
    }
    return { id: id, dir: dir };
  }
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('tlPlaySettings'));
      if (s) for (var k in settings) if (s[k] !== undefined) settings[k] = s[k];
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('tlPlaySettings', JSON.stringify(settings)); } catch (e) {}
  }
  function applyLayout() {
    var ps = settings.panelScale / 100, bs = settings.benchScale / 100;
    document.documentElement.style.setProperty('--panel-scale', ps.toFixed(2));
    /* 面板缩放：直接写入字号，保证按钮/文字随缩放变化 */
    var panels = document.querySelectorAll('.tl-play-page .panel');
    for (var pi = 0; pi < panels.length; pi++) {
      panels[pi].style.fontSize = (15 * ps) + 'px';
    }
    var pw = Math.round(230 * ps);
    /* 移动端：按面板宽度与缩放动态决定每行按钮数量 */
    var leftBtns = document.querySelectorAll('.tl-play-page .panel.left .controls .btn');
    if (window.innerWidth <= 900) {
      var panelW = Math.max(120, window.innerWidth - 24 - 20);   /* 页面边距 + 面板内边距 */
      var minW = Math.max(96, 150 * ps);
      var cols = Math.max(1, Math.min(4, Math.floor(panelW / minW)));
      var basis = (100 / cols - 1.5).toFixed(2) + '%';
      for (var bi = 0; bi < leftBtns.length; bi++) leftBtns[bi].style.flexBasis = basis;
    } else {
      for (var bj = 0; bj < leftBtns.length; bj++) leftBtns[bj].style.flexBasis = '';
    }
    var side;
    if (window.innerWidth <= 900) {
      /* 平板/手机：单列，棋盘按宽度取最大 1:1，高度不足时页面上下滚动 */
      gameLayoutEl.style.gridTemplateColumns = '1fr';
      side = Math.max(160, Math.round((window.innerWidth - 24) * bs));
    } else {
      var avail = Math.max(240, window.innerWidth - 2 * pw - 28 - 36);
      side = Math.max(200, Math.round(Math.min(avail, window.innerHeight - 40) * bs));
      gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + side + 'px ' + pw + 'px';
    }
    boardWrap.style.width = side + 'px';
    boardWrap.style.height = side + 'px';
    boardAreaEl.style.height = side + 'px';
    updateShortcutHints();
    refreshLevelLabel();
  }
  function updateShortcutHints() {
    var narrow = window.innerWidth <= 900;
    var defs = [
      { id: 'btn-prev-lv', full: '上一关(Shift+A)', short: '上一关' },
      { id: 'btn-next-lv', full: '下一关(Shift+D)', short: '下一关' },
      { id: 'btn-restart', full: '重新开始(O)', short: '重新开始' }
    ];
    defs.forEach(function (d) {
      var b = $(d.id);
      if (b) b.textContent = narrow ? d.short : d.full;
    });
  }
  function benchSize() { return workbench.getBoundingClientRect().width; }

  /* ---------- 数据 ---------- */
  function loadLevelSet(setData) {
    var arr = Array.isArray(setData) ? setData : [setData];
    levels = arr.filter(function (it) {
      if (!it || typeof it !== 'object') return false;
      var w = parseInt(it.width, 10), h = parseInt(it.height, 10);
      if (isNaN(w) || isNaN(h) || w < 0 || h < 0 || (w === 0 && h === 0)) return false;
      if (!Array.isArray(it.lines)) it.lines = [];
      if (!Array.isArray(it.points)) it.points = [];
      if (!Array.isArray(it.tasks)) it.tasks = [];
      else {
        /* 剔除无意义的空任务条件（type0 且无上下限），空任务一并丢弃 */
        it.tasks = it.tasks.map(function (t) {
          var conds = Array.isArray(t) ? t : [t];
          return conds.filter(function (c) {
            if (!c) return false;
            if (c.type === 0) {
              var mn = c.minstep, mx = c.maxstep;
              var mnE = mn === '' || mn === null || mn === undefined;
              var mxE = mx === '' || mx === null || mx === undefined;
              if (mnE && mxE) return false;
            }
            return true;
          });
        }).filter(function (t) { return Array.isArray(t) && t.length; });
      }
      return true;
    });
  }
  function decodeLevel(lvl) {
    segs = {}; verts = {}; stage = { w: lvl.width, h: lvl.height };
    (lvl.lines || []).forEach(function (it) {
      if (!Array.isArray(it) || it.length < 4) return;
      var x = parseInt(it[0], 10), y = parseInt(it[1], 10), vertical = it[2] === 1;
      if (vertical ? (y >= stage.h) : (x >= stage.w)) return;
      if (x < 0 || y < 0 || x > stage.w || y > stage.h) return;
      var s = segFromCode(parseInt(it[3], 10), vertical);
      if (s) segs[segKey(vertical ? 'v' : 'h', x, y)] = s;
    });
    (lvl.points || []).forEach(function (it) {
      if (!Array.isArray(it) || it.length < 3) return;
      var x = parseInt(it[0], 10), y = parseInt(it[1], 10), tp = parseInt(it[2], 10);
      if (x < 0 || y < 0 || x > stage.w || y > stage.h) return;
      var v = verts[vk(x, y)] || (verts[vk(x, y)] = {});
      if (tp === 0) v.start = true;
      else if (tp === 1) v.end = true;
      else if (tp === -1) v.portal = 1;
      else if (tp === -2) v.portal = 2;
      else if (tp === -3) v.portal = 3;
      else if (tp === -4 || tp === -5) v.portal = 4;
    });
  }
  function redAdjacent(x, y) {
    return cornerState(x, y) === 'red';
  }
  /* 角点状态（“变暗”模式下，已走过的红线视为不存在）：
     'none' 无已放置线 | 'dark' 仅剩已走过的红线 | 'red' | 'normal' */
  function cornerState(x, y) {
    var walkedRed = 0, red = 0, yellow = 0;
    var cand = [];
    if (x < stage.w) cand.push(segKey('h', x, y));
    if (x > 0) cand.push(segKey('h', x - 1, y));
    if (y < stage.h) cand.push(segKey('v', x, y));
    if (y > 0) cand.push(segKey('v', x, y - 1));
    cand.forEach(function (k) {
      var seg = segs[k];
      if (!seg) return;
      var m = lineMeta(seg);
      if (m.red) {
        if (settings.passRedLine === 'dark' && state && state.passedRedKeys && state.passedRedKeys[k]) walkedRed++;
        else red++;
      } else yellow++;
    });
    var total = walkedRed + red + yellow;
    if (!total) return 'none';
    if (red === 0 && yellow === 0) return 'dark';
    if (!red) return 'normal';
    if (!yellow || red >= 3) return 'red';
    return 'normal';
  }
  function refreshLevelLabel() {
    var lb = $('tl-level-name');
    if (!lb) return;
    var lvl = levels[curIdx];
    if (!lvl || !stage) { lb.classList.add('hidden'); return; }
    lb.classList.remove('hidden');
    lb.textContent = lvl.name || ('关卡 ' + (curIdx + 1));
    var w = boardWrap.getBoundingClientRect().width;
    var fs = Math.max(10, Math.round(w / 13));
    lb.style.fontSize = fs + 'px';
    lb.style.top = Math.max(2, Math.round(w * 0.015)) + 'px';
  }
  function playableMaxIdx() {
    return playUnordered ? levels.length - 1 : unlockedIdx;
  }
  function updateNavBtns() {
    var p = $('btn-prev-lv'), n = $('btn-next-lv');
    if (p) p.disabled = curIdx <= 0;
    if (n) n.disabled = curIdx >= playableMaxIdx();
  }
  function goLevel(delta) {
    var idx = curIdx + delta;
    if (idx < 0 || idx > playableMaxIdx()) return;
    startLevel(idx);
  }
  $('btn-prev-lv').addEventListener('click', function () { goLevel(-1); });
  $('btn-next-lv').addEventListener('click', function () { goLevel(1); });

  function startLevel(i) {
    if (!levels.length) return;
    curIdx = Math.max(0, Math.min(levels.length - 1, i));
    decodeLevel(levels[curIdx]);
    var sx = null, sy = null;
    Object.keys(verts).forEach(function (k) {
      var v = verts[k];
      if (v.start) { var p = k.split(','); sx = parseInt(p[0], 10); sy = parseInt(p[1], 10); }
    });
    state = { x: sx, y: sy, face: -1, steps: 0, lefts: 0, reds: 0, portals: 0, doneLines: {}, redsUsed: {}, taskLineKeys: {}, faceDirBits: 0, teleporting: false, pendingTp: null, animBusy: false, firstDirBit: 0 };
    winDone = false;
    $('tl-status').textContent = '第 ' + (curIdx + 1) + ' 关 / 共 ' + levels.length + ' 关';
    renderGrid();
    renderTasks();
    renderStats();
    updateHints();
    refreshLevelLabel();
    updateNavBtns();
    if (!canMoveAny()) showDialog('你已经无法移动', true, false);
  }

  /* 工坊自定义关卡：仅本会话记录游玩成绩（刷新即消失） */
  var wsRecords = {};
  function levelRecord(i) {
    if (mode === 'campaign') {
      var o = readCampSave();
      return (o.levels && o.levels[i]) || null;
    }
    return wsRecords[setNameParam + '|' + i] || null;
  }
  function saveWorkshopRecord(i, results, steps) {
    var k = setNameParam + '|' + i;
    var rec = wsRecords[k] || { done: true, best: steps, doneTasks: [] };
    rec.done = true;
    if (typeof rec.best !== 'number' || steps < rec.best) rec.best = steps;
    results.forEach(function (ok, idx) { if (ok && rec.doneTasks.indexOf(idx) < 0) rec.doneTasks.push(idx); });
    wsRecords[k] = rec;
  }

  /* ---------- 渲染（同制作器坐标/贴图规则） ---------- */
  function img(key) {
    var im = document.createElement('img');
    im.src = TEX[key];
    im.draggable = false;
    return im;
  }
  var OUTLINE = 0.1;        /* 玩家描边：相对自身 10%（四周各 5%） */
  var OUTLINE_STEP = 0.24;  /* step 箭头描边：相对自身 24%（四周各 12%） */
  function outlineImg(key) {
    var im = img(key);
    im.style.filter = 'brightness(0)';
    return im;
  }
  var lastE = 0;
  var fxHiddenKey = null;   /* 线条特效期间隐藏的线 */
  var lineFxUntil = 0;      /* 线动画期间禁止整幅重绘的时间戳 */
  var pendingGridTimer = null;
  function scheduleGridRender() {
    var delay = lineFxUntil - Date.now();
    if (pendingGridTimer) { clearTimeout(pendingGridTimer); pendingGridTimer = null; }
    if (delay > 0) {
      pendingGridTimer = setTimeout(function () { pendingGridTimer = null; renderGrid(); }, delay + animMs(20));
    } else {
      renderGrid();
    }
  }
  function renderGrid() {
    gridCanvas.innerHTML = '';
    if (!stage) return;
    var L = benchSize();
    var maxD = Math.max(stage.w, stage.h);
    var e = maxD > 0 ? Math.min((0.7 * L) / maxD, 0.3 * L) : 0.3 * L;
    var k = e / 51;
    var dotW = 3 * k;

    function drawSeg(d, x, y) {
      var gridKey = segKey(d, x, y);
      if (fxHiddenKey === gridKey) return;
      var st = segs[gridKey];
      var m = lineMeta(st);
      if (!m) return;
      var vertical = d === 'v';
      var shape = lineShape(st.id);
      var col = lineCol(st.id);
      var key;
      if (state.taskLineKeys && state.taskLineKeys[gridKey] && !m.red) {
        /* 已走过的黄色任务线：按“经过任务线后”设置选择表现 */
        if (settings.passLine === 'green') key = m.arrow ? 'gtaskA' : 'gtask';
        else if (settings.passLine === 'dark') key = m.arrow ? 'dtaskA' : 'dtask';
        else key = m.arrow ? 'a' : 'n';
      } else if (m.red && state.passedRedKeys && state.passedRedKeys[gridKey] && settings.passRedLine === 'dark') {
        /* 已走过的红线（变暗模式）：显示 darkred 前缀版本 */
        var darkMap = { rn: 'rdn', ra: 'dra', rt: 'drt', rta: 'drta' };
        key = darkMap[st.id] || st.id;
      } else {
        key = (col === 'r' ? 'r' : '') + { n: 'n', t: 't', a: 'a', ta: 'ta' }[shape];
      }
      var W = lineW;
      var flip = m.arrow && ((vertical && st.dir === 'u') || (!vertical && st.dir === 'l'));
      var centerL = vertical ? (x * e) : (x * e + dotW / 2 + W / 2);
      var centerT = vertical ? (y * e + dotW / 2 + W / 2) : (y * e);
      var transform = vertical
        ? 'translate(-50%,-50%) rotate(90deg)' + (flip ? ' scaleX(-1)' : '')
        : 'translate(-50%,-50%)' + (flip ? ' scaleX(-1)' : '');
      var im = img(key);
      im.style.width = W + 'px';
      im.style.height = 'auto';
      im.style.left = centerL + 'px';
      im.style.top = centerT + 'px';
      im.style.transform = transform;
      im.dataset.fxkey = gridKey;
      gridCanvas.appendChild(im);
    }
    var lineW = 48 * k;
    var lineH = 3 * k;
    for (var y = 0; y <= stage.h; y++) {
      for (var x = 0; x <= stage.w; x++) {
        if (x < stage.w && segs[segKey('h', x, y)]) drawSeg('h', x, y);
        if (y < stage.h && segs[segKey('v', x, y)]) drawSeg('v', x, y);
      }
    }
    function ovPx(nat) { return dotW * nat / 3 * 1.5 * 0.9; }
    function drawOv(key, x, y, nat, extra, pid) {
      var im = img(key);
      im.dataset.pt = '1';
      if (pid) im.dataset.ptid = pid;
      var s = ovPx(nat) * (extra || 1);
      im.style.width = s + 'px';
      im.style.height = s + 'px';
      im.style.left = x * e + 'px';
      im.style.top = y * e + 'px';
      im.style.transform = 'translate(-50%,-50%)';
      gridCanvas.appendChild(im);
    }
    /* 角点：仅显示旁边有已放置线的（connectpoint/redconnectpoint），无线角点不显示 */
    function hasIncident(x, y) {
      if (x < stage.w && segs[segKey('h', x, y)]) return true;
      if (x > 0 && segs[segKey('h', x - 1, y)]) return true;
      if (y < stage.h && segs[segKey('v', x, y)]) return true;
      if (y > 0 && segs[segKey('v', x, y - 1)]) return true;
      return false;
    }
    var dotBig = (dotW + 1) * 1.5;
    for (var gy = 0; gy <= stage.h; gy++) {
      for (var gx = 0; gx <= stage.w; gx++) {
        var cs = cornerState(gx, gy);
        if (cs === 'none') continue;
        var d = img(cs === 'dark' ? 'ddot' : cs === 'red' ? 'rdot' : 'dot');
        d.dataset.pt = '1';
        d.dataset.ptid = 'd:' + gx + ',' + gy;
        d.style.width = dotBig + 'px';
        d.style.height = dotBig + 'px';
        d.style.left = gx * e + 'px';
        d.style.top = gy * e + 'px';
        d.style.transform = 'translate(-50%,-50%)';
        gridCanvas.appendChild(d);
      }
    }
    Object.keys(verts).forEach(function (k) {
      var p = k.split(',');
      var x = parseInt(p[0], 10), y = parseInt(p[1], 10);
      var v = verts[k];
      var red = cornerState(x, y) === 'red';
      if (v.portal) drawOv((red ? 'rp' : 'p') + v.portal, x, y, 11, 1, 'p:' + k);
      var ov = (v.start && v.end) ? 'startEnd' : v.start ? 'start' : v.end ? 'end' : null;
      if (ov) drawOv((red ? 'r' : '') + ov, x, y, 7, ov === 'end' ? 1.1 : 1, 'o:' + k);
    });
    gridCanvas.style.width = (stage.w * e) + 'px';
    gridCanvas.style.height = (stage.h * e) + 'px';
    lastE = e;
    drawPlayer(xFor(state.x), yFor(state.y), e);
    function xFor(gx) { return gx * e; }
    function yFor(gy) { return gy * e; }
  }
  function drawPlayer(px, py, e) {
    var old = document.getElementById('tl-player');
    if (old) old.remove();
    var P = (3 * (e / 51)) * 11 / 3 * 1.5 * 0.9;
    var facing = settings.showFacing && state.face >= 0;
    var pKey = facing ? 'playerDir' : 'player';
    var rotDeg = facing ? [0, -90, 180, 90][state.face] : 0;   /* 右箭头默认朝右 */
    var rotT = rotDeg ? ' rotate(' + rotDeg + 'deg)' : '';
    /* 黑色描边层 */
    var dark = outlineImg(pKey);
    dark.style.width = (P * (1 + OUTLINE)) + 'px';
    dark.style.height = (P * (1 + OUTLINE)) + 'px';
    dark.style.left = px + 'px';
    dark.style.top = py + 'px';
    dark.style.transform = 'translate(-50%,-50%)' + rotT;
    dark.style.opacity = String(drawOpacity / 100);
    gridCanvas.appendChild(dark);
    var im = img(pKey);
    im.id = 'tl-player';
    im.style.width = P + 'px';
    im.style.height = P + 'px';
    im.style.left = px + 'px';
    im.style.top = py + 'px';
    im.style.transform = 'translate(-50%,-50%)' + rotT;
    im.style.opacity = String(drawOpacity / 100);
    gridCanvas.appendChild(im);
    /* step.png 指示可走方向（step 4x5，按比例映射） */
    var sw = P * 4 / 11, sh = P * 5 / 11;
    var gap = P * animUnit / 11;
    var dirs = state.face < 0 ? [0, 1, 2, 3] : [state.face, (state.face + 1) % 4];
    dirs.forEach(function (d) {
      if (!edgeUsable(state.x, state.y, d)) return;
      var st = img('step');
      st.style.width = sw + 'px';
      st.style.height = sh + 'px';
      var left, top, rot = 0;
      if (d === 0) {          /* 右 */
        left = px + P / 2 + gap;
        top = py - sh / 2;
      } else if (d === 2) {   /* 左（旋转 180） */
        left = px - P / 2 - gap - sw;
        top = py - sh / 2;
        rot = 180;
      } else if (d === 3) {   /* 下（顺时针 90） */
        left = px - sw / 2;
        top = py + P / 2 + gap;
        rot = 90;
      } else {                /* 上（逆时针 90） */
        left = px - sw / 2;
        top = py - P / 2 - gap - sh;
        rot = -90;
      }
      var rotT = rot ? 'rotate(' + rot + 'deg)' : '';
      /* 黑色描边层（step 箭头）先垫底 */
      var dk = outlineImg('step');
      var dkW = sw * (1 + OUTLINE_STEP), dkH = sh * (1 + OUTLINE_STEP);
      dk.style.width = dkW + 'px';
      dk.style.height = dkH + 'px';
      dk.style.left = (left - (dkW - sw) / 2) + 'px';
      dk.style.top = (top - (dkH - sh) / 2) + 'px';
      if (rotT) dk.style.transform = rotT;
      dk.style.opacity = String(drawOpacity / 100);
      gridCanvas.appendChild(dk);
      st.style.left = left + 'px';
      st.style.top = top + 'px';
      if (rotT) st.style.transform = rotT;
      st.style.opacity = String(drawOpacity / 100);
      gridCanvas.appendChild(st);
    });
  }

  /* ---------- 移动规则 ---------- */
  function edgeUsable(x, y, d) {
    var D = DIRS[d];
    var nx = x + D.dx, ny = y + D.dy;
    if (nx < 0 || ny < 0 || nx > stage.w || ny > stage.h) return false;
    var key = D.dx !== 0 ? segKey('h', Math.min(x, nx), y) : segKey('v', x, Math.min(y, ny));
    var st = segs[key];
    var m = lineMeta(st);
    if (!m) return false;
    if (m.arrow && st.dir !== D.arrow) return false;
    if (m.red && state.redsUsed[key]) return false;
    return true;
  }
  function canMoveAny() {
    var dirs = state.face < 0 ? [0, 1, 2, 3] : [state.face, (state.face + 1) % 4];
    for (var i = 0; i < dirs.length; i++) if (edgeUsable(state.x, state.y, dirs[i])) return true;
    return false;
  }
  function allTaskLinesDone() {
    var done = true;
    Object.keys(segs).forEach(function (k) {
      if (lineMeta(segs[k]).task && !state.doneLines[k]) done = false;
    });
    return done;
  }
  function portalPartner(x, y) {
    var lv = verts[vk(x, y)].portal;
    var list = [];
    Object.keys(verts).forEach(function (k) {
      if (verts[k].portal === lv) { var p = k.split(','); list.push([parseInt(p[0], 10), parseInt(p[1], 10)]); }
    });
    if (list.length !== 2) return null;
    return (list[0][0] === x && list[0][1] === y) ? list[1] : list[0];
  }
    /* ---------- 动画 ---------- */
  /* 速度 25% => 时长 ×4；速度 200% => 时长 ×0.5 */
  function animMs(v) { return Math.max(0, (v * 100) / (settings.animSpeed || 100)); }
  function playerPxSize() {
    return (3 * (lastE / 51)) * 11 / 3 * 1.5 * 0.9;
  }
  function playMovePlayer(ox, oy, nx, ny) {
    if (!lastE) return;
    if (state) state.animBusy = true;
    var main = document.getElementById('tl-player');
    if (!main) return;
    var dark = main.previousElementSibling;   /* 玩家描边层紧邻主图之前 */
    var fromX = ox * lastE, fromY = oy * lastE, toX = nx * lastE, toY = ny * lastE;
    var apply = function (el) {
      if (!el) return;
      el.style.transition = 'left ' + (animMs(100) / 1000) + 's linear, top ' + (animMs(100) / 1000) + 's linear';
      el.style.left = toX + 'px';
      el.style.top = toY + 'px';
    };
    /* 移动期间隐藏旧格上的 step 指示箭头，最终渲染时按新位置重绘 */
    var steps = gridCanvas.querySelectorAll('img');
    for (var i = 0; i < steps.length; i++) {
      if (/step\.png$/.test(steps[i].src || '')) steps[i].style.opacity = '0';
    }
    /* 强制先记录起点再过渡 */
    main.style.left = fromX + 'px';
    main.style.top = fromY + 'px';
    if (dark) { dark.style.left = fromX + 'px'; dark.style.top = fromY + 'px'; }
    void main.offsetWidth;
    apply(main);
    if (dark) apply(dark);
  }
  function fadeOldLine(key) {
    var im = gridCanvas.querySelector('img[data-fxkey="' + key + '"]');
    if (!im) return;
    im.style.transition = 'opacity 0.1s linear';
    im.style.opacity = '0';
  }
  function linePair(el) {
    var dk = null;
    if (el && el.previousElementSibling && /brightness/.test(el.previousElementSibling.style.filter || '')) dk = el.previousElementSibling;
    return dk ? [el, dk] : el ? [el] : [];
  }
  function setOpacityPair(el, v) {
    linePair(el).forEach(function (x) { x.style.opacity = String(v); });
  }
  function fadeOutPair(el, sec) {
    var arr = linePair(el);
    arr.forEach(function (x) { x.style.transition = 'none'; x.style.opacity = String(drawOpacity / 100); });
    void (arr[0] && arr[0].offsetWidth);
    arr.forEach(function (x) { x.style.transition = 'opacity ' + sec + 's linear'; });
    requestAnimationFrame(function () { arr.forEach(function (x) { x.style.opacity = '0'; }); });
  }
  function fadeInPair(el, sec) {
    var arr = linePair(el);
    arr.forEach(function (x) { x.style.transition = 'none'; x.style.opacity = '0'; });
    void (arr[0] && arr[0].offsetWidth);
    arr.forEach(function (x) { x.style.transition = 'opacity ' + sec + 's linear'; });
    requestAnimationFrame(function () { arr.forEach(function (x) { x.style.opacity = String(drawOpacity / 100); }); });
  }
  function upperAnchorEl() {
    var kids = gridCanvas.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.id === 'tl-player' || el.dataset.pt || /step\.png$/.test(el.src || '')) return el;
    }
    return null;
  }
  function refreshDots() {
    if (!stage || !lastE) return;
    var e = lastE, k = e / 51, dotW = 3 * k;
    var dotBig = (dotW + 1) * 1.5;
    function ovPx(nat) { return dotW * nat / 3 * 1.5 * 0.9; }
    /* 生成目标角点/特殊点列表 */
    var want = [];
    for (var gy = 0; gy <= stage.h; gy++) {
      for (var gx = 0; gx <= stage.w; gx++) {
        var cs = cornerState(gx, gy);
        if (cs === 'none') continue;
        want.push({ id: 'd:' + gx + ',' + gy, key: cs === 'dark' ? 'ddot' : cs === 'red' ? 'rdot' : 'dot', x: gx, y: gy, size: dotBig });
      }
    }
    Object.keys(verts).forEach(function (kk) {
      var p = kk.split(',');
      var x = parseInt(p[0], 10), y = parseInt(p[1], 10);
      var v = verts[kk];
      var red = cornerState(x, y) === 'red';
      if (v.portal) want.push({ id: 'p:' + kk, key: (red ? 'rp' : 'p') + v.portal, x: x, y: y, size: ovPx(11) });
      var ov = (v.start && v.end) ? 'startEnd' : v.start ? 'start' : v.end ? 'end' : null;
      if (ov) want.push({ id: 'o:' + kk, key: (red ? 'r' : '') + ov, x: x, y: y, size: ovPx(7) * (ov === 'end' ? 1.1 : 1) });
    });
    var wantMap = {};
    want.forEach(function (w) { wantMap[w.id] = w; });
    var exist = gridCanvas.querySelectorAll('img[data-pt]');
    for (var i = 0; i < exist.length; i++) {
      var el = exist[i];
      var pid = el.dataset.ptid;
      if (!wantMap[pid]) { el.parentNode.removeChild(el); continue; }
      var w = wantMap[pid];
      var wantSrc = TEX[w.key];
      if ((el.getAttribute('src') || '').indexOf(w.key) < 0) el.src = wantSrc;
      el.style.width = w.size + 'px';
      el.style.height = w.size + 'px';
      el.style.left = (w.x * e) + 'px';
      el.style.top = (w.y * e) + 'px';
      delete wantMap[pid];
    }
    var keys = Object.keys(wantMap);
    if (!keys.length) return;
    var anchor = upperAnchorEl();
    keys.forEach(function (pid) {
      var w = wantMap[pid];
      var im = img(w.key);
      im.dataset.pt = '1';
      im.dataset.ptid = pid;
      im.style.width = w.size + 'px';
      im.style.height = w.size + 'px';
      im.style.left = (w.x * e) + 'px';
      im.style.top = (w.y * e) + 'px';
      im.style.transform = 'translate(-50%,-50%)';
      if (anchor) gridCanvas.insertBefore(im, anchor);
      else gridCanvas.appendChild(im);
    });
  }
  function overlayLineAt(gridKey, segObj, texKey, out) {
    if (!lastE || !segObj) return;
    var parts = gridKey.split('/');
    var vertical = parts[0] === 'v';
    var x = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
    var e = lastE, k = e / 51, dotW = 3 * k, lineW = 48 * k;
    var shape = lineShape(segObj.id);
    var flip = (shape === 'a' || shape === 'ta') && ((vertical && segObj.dir === 'u') || (!vertical && segObj.dir === 'l'));
    var im = img(texKey);
    var centerL = vertical ? (x * e) : (x * e + dotW / 2 + lineW / 2);
    var centerT = vertical ? (y * e + dotW / 2 + lineW / 2) : (y * e);
    im.style.width = lineW + 'px';
    im.style.height = 'auto';
    im.style.left = centerL + 'px';
    im.style.top = centerT + 'px';
    im.style.transform = vertical
      ? 'translate(-50%,-50%) rotate(90deg)' + (flip ? ' scaleX(-1)' : '')
      : 'translate(-50%,-50%)' + (flip ? ' scaleX(-1)' : '');
    /* 让叠加线位于角点/特殊点/玩家之下 */
    var kids = gridCanvas.children;
    var anchor = null;
    for (var i2 = 0; i2 < kids.length; i2++) {
      var el2 = kids[i2];
      if (el2.id === 'tl-player' || el2.dataset.pt || /step\.png$/.test(el2.src || '')) { anchor = el2; break; }
    }
    if (anchor) gridCanvas.insertBefore(im, anchor);
    else gridCanvas.appendChild(im);
    /* 内联基值保持目标不透明度，动画结束后不会回落为 0 */
    im.style.opacity = out ? '0' : '1';
    im.animate(
      out ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: animMs(100), easing: 'linear', fill: out ? 'forwards' : 'none' }
    );
    return im;
  }
  function fadeInNewLine(key) {
    var im = gridCanvas.querySelector('img[data-fxkey="' + key + '"]');
    if (!im) return;
    im.classList.add('tl-line-in');
    im.style.opacity = '1';
  }
  function finishStep(won, withGrid) {
    if (withGrid) renderGrid();
    renderTasks();
    renderStats();
    updateHints();
    if (state) state.animBusy = false;
    if (won) { showWinDialog(); return; }
    if (!canMoveAny()) showDialog('你已经无法移动', true, false);
  }
  function startPortalAnim() {
    var pt = state.pendingTp;
    if (!pt) return;
    /* 基准 0.2s：0.1s 淡出 + 0.1s 淡入 */
    var fadeSec = animMs(100) / 1000;
    var half = animMs(100);
    var p = document.getElementById('tl-player');
    if (p) fadeOutPair(p, fadeSec);
    setTimeout(function () {
      state.x = pt.tx;
      state.y = pt.ty;
      renderGrid();
      var p2 = document.getElementById('tl-player');
      if (p2) fadeInPair(p2, fadeSec);
      setTimeout(function () { finalizeTeleport(); }, half);
    }, half);
  }

  function doMove(d) {
    if (winDone) return;
    if (state.teleporting) return;   /* 传送动画期间不可输入 */
    if (state.animBusy) return;      /* 线/点动画未结束前不可移动 */
    if (!edgeUsable(state.x, state.y, d)) return;
    var D = DIRS[d];
    var nx = state.x + D.dx, ny = state.y + D.dy;
    var key = D.dx !== 0 ? segKey('h', Math.min(state.x, nx), state.y) : segKey('v', state.x, Math.min(state.y, ny));
    var m = lineMeta(segs[key]);
    if (!m) return;
    var ox = state.x, oy = state.y;
    var fx = m.task && !m.red
      ? { kind: 'task', key: key, oldSeg: { id: segs[key].id, dir: segs[key].dir } }
      : m.red ? { kind: 'red', key: key, gone: settings.passRedLine !== 'dark', oldSeg: { id: segs[key].id, dir: segs[key].dir } } : null;
    state.steps++;
    if (state.steps === 1) state.firstDirBit = [2, 1, 8, 4][d];
    if (state.face >= 0 && d !== state.face) state.lefts++;
    if (m.task) state.doneLines[key] = true;
    if (m.red) {
      state.reds++;
      state.redsUsed[key] = true;
      state.passedRedKeys = state.passedRedKeys || {};
      state.passedRedKeys[key] = true;
      state.removedReds = state.removedReds || {};
      if (settings.passRedLine === 'dark') {
        delete state.removedReds[key];
      } else {
        state.removedReds[key] = { id: segs[key].id, dir: segs[key].dir };
        delete segs[key];
      }
    } else if (m.task) {
      state.taskLineKeys[key] = true;
      var dir0 = segs[key].dir;
      segs[key] = m.arrow ? { id: 'a', dir: dir0 } : { id: 'n' };
    }
    state.face = d;
    state.x = nx; state.y = ny;
    var won = false;
    var v = verts[vk(nx, ny)];
    if (v && v.end && allTaskLinesDone()) won = true;
    else if (v && v.portal) {
      var partner = portalPartner(nx, ny);
      if (partner) {
        state.portals++;
        state.teleporting = true;
        state.pendingTp = { tx: partner[0], ty: partner[1] };
        if (settings.showAnim) {
          playMovePlayer(ox, oy, nx, ny);
          setTimeout(function () { renderGrid(); startPortalAnim(); }, animMs(130));
        } else {
          /* 无动画：在原传送门停留 0.2s 后直接传送 */
          renderGrid();
          setTimeout(finalizeTeleport, animMs(200));
        }
        return;
      }
    }
    if (won) {
      winDone = true;
      state.faceDirBits = [2, 1, 8, 4][state.face];
      recordLevelResult();
    }
    if (!settings.showAnim) {
      finishStep(won, true);
      return;
    }
    playMovePlayer(ox, oy, nx, ny);
    setTimeout(function () {
      /* 小球动画已完成：立即允许下一步；线动画独立进行，不再整幅重绘 */
      if (fx) {
        lineFxUntil = Date.now() + animMs(130);
        if (fx.kind === 'red' && fx.gone) {
          /* 旧红线自身淡出后移除该元素 */
          var el = gridCanvas.querySelector('img[data-fxkey="' + fx.key + '"]');
          if (el) {
            el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: animMs(100), easing: 'linear', fill: 'forwards' });
            (function (node) {
              setTimeout(function () {
                if (node && node.parentNode) node.parentNode.removeChild(node);
                refreshDots();
              }, animMs(110));
            })(el);
          }
        } else {
          /* 变暗/任务线：新线叠在旧线上淡入；旧线稍后直接移除，新线保留 */
          var oldSeg = fx.oldSeg;
          var tex;
          if (fx.kind === 'task') {
            var arr = lineShape(oldSeg.id) === 'a' || lineShape(oldSeg.id) === 'ta';
            if (settings.passLine === 'green') tex = arr ? 'gtaskA' : 'gtask';
            else if (settings.passLine === 'dark') tex = arr ? 'dtaskA' : 'dtask';
            else tex = arr ? 'a' : 'n';
          } else {
            var darkMap2 = { rn: 'rdn', ra: 'dra', rt: 'drt', rta: 'drta' };
            tex = darkMap2[oldSeg.id] || oldSeg.id;
          }
          overlayLineAt(fx.key, oldSeg, tex, false);
          var oldNode = gridCanvas.querySelector('img[data-fxkey="' + fx.key + '"]');
          if (oldNode) {
            (function (node) {
              setTimeout(function () {
                if (node && node.parentNode) node.parentNode.removeChild(node);
                refreshDots();
              }, animMs(110));
            })(oldNode);
          } else {
            refreshDots();
          }
        }
      } else {
        refreshDots();          /* 角点独立即时结算 */
        scheduleGridRender();   /* 无线条变化：延迟/立即渲染到新位置 */
      }
      finishStep(won, false);
    }, animMs(120));
  }
  function finalizeTeleport() {
    if (!state || !state.pendingTp) return;
    var pt = state.pendingTp;
    state.pendingTp = null;
    state.teleporting = false;
    state.x = pt.tx;
    state.y = pt.ty;
    var won = false;
    var pv = verts[vk(state.x, state.y)];
    if (pv && pv.end && allTaskLinesDone()) won = true;
    if (won) {
      winDone = true;
      state.faceDirBits = [2, 1, 8, 4][state.face];
      recordLevelResult();
    }
    finishStep(won, true);
  }

/* ---------- 提示（可走方向独立按钮） ---------- */
  function updateHints() {
    var box = $('tl-dir-btns');
    box.innerHTML = '';
    if (!stage || !state) return;
    var list = [];
    var keyOf = ['(D)', '(W)', '(A)', '(S)'];
    if (settings.dirMode === 'absolute') {
      var cands = state.face < 0 ? [0, 1, 2, 3] : [state.face, (state.face + 1) % 4];
      cands.forEach(function (d) {
        if (edgeUsable(state.x, state.y, d)) list.push({ d: d, label: DIRS[d].name + keyOf[d] });
      });
    } else if (state.face < 0) {
      if (edgeUsable(state.x, state.y, 1)) list.push({ d: 1, label: '向上(W)' });
      if (edgeUsable(state.x, state.y, 2)) list.push({ d: 2, label: '向左(A)' });
      if (edgeUsable(state.x, state.y, 3)) list.push({ d: 3, label: '向下(S)' });
      if (edgeUsable(state.x, state.y, 0)) list.push({ d: 0, label: '向右(D)' });
    } else {
      if (edgeUsable(state.x, state.y, state.face)) list.push({ d: state.face, label: '向前(W)' });
      if (edgeUsable(state.x, state.y, (state.face + 1) % 4)) list.push({ d: (state.face + 1) % 4, label: '向左(A)' });
    }
    list.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn dir-btn';
      b.textContent = it.label;
      b.addEventListener('click', function () {
        if (state && !winDone) doMove(it.d);
      });
      box.appendChild(b);
    });
    /* 隐藏/显示小球：长按有效 */
    var tg = document.createElement('button');
    tg.type = 'button';
    tg.className = 'btn dir-btn toggle-player';
    tg.textContent = playerHideLabel();
    tg.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      startPress(playerHideIsHide());
    });
    box.insertBefore(tg, box.firstChild);
  }

  /* ---------- 任务面板 ---------- */
  function condState(c) {
    var t = c.type;
    if (t === 5) {
      /* 限制开局朝向：第一步方向命中允许集合 */
      if (!state || state.steps < 1) return 'pending';
      return (((c.facing | 0) & (state.firstDirBit || 0)) !== 0) ? 'pass' : 'fail';
    }
    var metric = { 0: state.steps, 2: state.lefts, 3: state.reds, 4: state.portals }[t];
    var mx = c.maxstep, mn = c.minstep;
    var hasMax = mx !== '' && mx !== null && mx !== undefined;
    var hasMin = mn !== '' && mn !== null && mn !== undefined;
    if (t === 1) {
      if (!winDone) return 'pending';
      /* facing 为允许朝向位集合：实际朝向命中任一即通过 */
      var ok = ((c.facing | 0) & state.faceDirBits) !== 0;
      return ok ? 'pass' : 'fail';
    }
    if (metric === undefined) return 'pending';
    if (hasMax && metric > parseInt(mx, 10)) return 'fail';
    if (!winDone) {
      return (hasMin && metric >= parseInt(mn, 10)) ? 'pass' : 'pending';
    }
    if (hasMin && metric < parseInt(mn, 10)) return 'fail';
    return 'pass';
  }
  function num(c) {
    if (c === '' || c === null || c === undefined) return null;
    var n = parseInt(c, 10);
    return isNaN(n) ? null : n;
  }
  function condText(c) {
    var t = c.type;
    if (t === 1 || t === 5) {
      var names = [];
      [1, 2, 4, 8].forEach(function (b) { if ((c.facing | 0) & b) names.push(FACE_BITS[b]); });
      return (t === 5 ? '开局朝向：' : '通关朝向：') + (names.length ? names.join('/') : '无');
    }
    var mn = num(c.minstep), mx = num(c.maxstep);
    var nm = TASK_NAMES[t];
    if (mn === null && mx === null) return nm + '：不限';
    if (mn !== null && mx !== null && mn === mx) return nm + '：' + mn;
    if (mn !== null && mn === 0) return nm + '：不大于 ' + mx;
    if (mx !== null && mn === null) return nm + '：不大于 ' + mx;
    if (mn !== null && mx === null) return nm + '：不小于 ' + mn;
    return nm + '：' + mn + ' - ' + mx;
  }
  function renderStats() {
    var box = $('tl-stats');
    if (!box) return;
    var items = [];
    var lvl = levels[curIdx];
    items.push(['理论最短步数', lvl && lvl.minstep !== undefined && lvl.minstep !== null ? lvl.minstep : '-']);
    items.push(['步数', state ? state.steps : 0]);
    items.push(['左转次数', state ? state.lefts : 0]);
    /* 闯关模式的机制：4-1 前不显示传送门/红线统计；6-1 前不显示红线统计 */
    var showPortal = true, showRed = true;
    if (isMainCampaign) {
      var i41 = levels.findIndex(function (l) { return (l.name || '') === '4-1'; });
      var i61 = levels.findIndex(function (l) { return (l.name || '') === '6-1'; });
      if (i41 >= 0 && curIdx < i41) showPortal = false;
      if (i61 >= 0 && curIdx < i61) showRed = false;
    }
    if (showPortal) items.push(['通过传送门次数', state ? state.portals : 0]);
    if (showRed) items.push(['使用红线次数', state ? state.reds : 0]);
    box.innerHTML = '';
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'tl-stat-row';
      var l = document.createElement('span');
      l.textContent = it[0];
      var v = document.createElement('span');
      v.textContent = it[1];
      row.appendChild(l);
      row.appendChild(v);
      box.appendChild(row);
    });
  }
  function renderTasks() {
    var panel = $('task-panel');
    panel.innerHTML = '';
    var lvl = levels[curIdx];
    var taskN = lvl && Array.isArray(lvl.tasks) ? lvl.tasks.length : 0;
    var ct = $('challenge-title');
    if (ct) {
      ct.textContent = taskN === 0 ? '' : '任务挑战';
      ct.classList.toggle('hidden', taskN === 0);
    }
    if (!lvl || !lvl.tasks.length) {
      panel.innerHTML = '';
      return;
    }
    if (winDone) state.faceDirBits = [2, 1, 8, 4][state.face];
    var doneList = [];
    var recNow = levelRecord(curIdx);
    if (recNow && Array.isArray(recNow.doneTasks)) doneList = recNow.doneTasks;
    lvl.tasks.forEach(function (task, ti) {
      var conds = Array.isArray(task) ? task : [task];
      var block = document.createElement('div');
      block.className = 'task-block';
      var blockDone = doneList.indexOf(ti) >= 0;
      conds.forEach(function (c) {
        if (!c) return;
        var row = document.createElement('div');
        row.className = 'task-cond';
        if (blockDone) {
          row.classList.add('pass');   /* 已记录完成的任务直接显示为通过（绿） */
        } else {
          var st = condState(c);
          if (st === 'pass') row.classList.add('pass');
          else if (st === 'fail') row.classList.add('fail');
        }
        var text = document.createElement('span');
        text.textContent = condText(c);
        row.appendChild(text);
        block.appendChild(row);
      });
      if (blockDone) {
        var gr = document.createElement('img');
        gr.className = 'green-ready';
        gr.src = 'texture/greenready.png';
        gr.alt = '';
        block.appendChild(gr);
      }
      panel.appendChild(block);
    });
  }

  /* ---------- 弹窗 / 输入 ---------- */
  var dialogVictory = false;
  function showDialog(msg, allowCancel, victory) {
    dialogVictory = false;
    clearWinTimer();
    $('tl-dialog-title').textContent = victory ? '通关' : '提示';
    $('tl-dialog-msg').textContent = msg;
    $('tl-dialog-cancel').classList.toggle('hidden', !allowCancel && !victory);
    $('tl-dialog-cancel').textContent = '取消';
    $('tl-dialog-restart').classList.remove('hidden');
    $('tl-dialog-restart').textContent = '重新开始';
    $('tl-dialog-modal').classList.remove('hidden');
  }
  function showWinDialog() {
    dialogVictory = true;
    clearWinTimer();
    $('tl-dialog-title').textContent = '通关';
    $('tl-dialog-msg').textContent = '您已通关，共花费 ' + (state ? state.steps : 0) + ' 步';
    $('tl-dialog-cancel').classList.remove('hidden');
    $('tl-dialog-cancel').textContent = '返回';
    var hasNext = curIdx + 1 < levels.length;
    var rt = $('tl-dialog-restart');
    rt.classList.toggle('hidden', !hasNext);
    if (!hasNext) {
      $('tl-dialog-modal').classList.remove('hidden');
      return;
    }
    rt.textContent = '下一关';
    rt.disabled = false;
    var remain = 5;
    rt.textContent = '下一关(' + remain + ')';
    var tick = function () {
      remain--;
      if (remain <= 0) {
        winGoNext();
        return;
      }
      rt.textContent = '下一关(' + remain + ')';
      winTimer = setTimeout(tick, 1000);
    };
    $('tl-dialog-modal').classList.remove('hidden');
    winTimer = setTimeout(tick, 1000);
  }
  function closeDialog() {
    clearWinTimer();
    dialogVictory = false;
    $('tl-dialog-modal').classList.add('hidden');
  }
  function nextLevel() {
    if (curIdx + 1 >= levels.length) return;
    clearWinTimer();
    $('tl-dialog-modal').classList.add('hidden');
    saveUnlocked(curIdx + 1);
    startLevel(curIdx + 1);
  }
  $('tl-dialog-cancel').addEventListener('click', function () {
    if (dialogVictory) { closeDialog(); return; }
    $('tl-dialog-modal').classList.add('hidden');
  });
  $('tl-dialog-restart').addEventListener('click', function () {
    if (dialogVictory) {
      if (curIdx + 1 < levels.length) winGoNext();
      else { closeDialog(); startLevel(curIdx); }
      return;
    }
    $('tl-dialog-modal').classList.add('hidden');
    startLevel(curIdx);
  });

  var KEY_DIR = { w: 1, a: 2, s: 3, d: 0, up: 1, left: 2, down: 3, right: 0, arrowup: 1, arrowleft: 2, arrowdown: 3, arrowright: 0 };
  var KEY_LOGICAL = { w: 'f', a: 'l', up: 'f', left: 'l', arrowup: 'f', arrowleft: 'l' };
  function setDirModeLabel() {
    var on = settings.dirMode === 'absolute';
    $('ps-dir-label').textContent = on ? '绝对' : '相对';
  }
  var PASS_OPTS = ['fill', 'green', 'dark'];
  var PASS_NAMES = { fill: '填充', green: '变绿', dark: '变暗' };
  function setPassLabel() {
    $('ps-pass-label').textContent = PASS_NAMES[settings.passLine] || '填充';
  }
  function cyclePassMode(delta) {
    var i = PASS_OPTS.indexOf(settings.passLine);
    if (i < 0) i = 0;
    i = (i + delta + PASS_OPTS.length) % PASS_OPTS.length;
    settings.passLine = PASS_OPTS[i];
    saveSettings();
    setPassLabel();
    if (stage && state) renderGrid();
  }
  $('ps-pass-prev').addEventListener('click', function () { cyclePassMode(-1); });
  $('ps-pass-next').addEventListener('click', function () { cyclePassMode(1); });
  var RED_OPTS = ['gone', 'dark'];
  var RED_NAMES = { gone: '消失', dark: '变暗' };
  function setRedLabel() {
    $('ps-red-label').textContent = RED_NAMES[settings.passRedLine] || '消失';
  }
  function cycleRedMode(delta) {
    var i = RED_OPTS.indexOf(settings.passRedLine);
    if (i < 0) i = 0;
    i = (i + delta + RED_OPTS.length) % RED_OPTS.length;
    settings.passRedLine = RED_OPTS[i];
    saveSettings();
    setRedLabel();
    if (stage && state) {
      if (settings.passRedLine === 'gone' && state.passedRedKeys) {
        /* 由“变暗”切回“消失”：已变暗的红线一并移除（记录以便恢复） */
        Object.keys(state.passedRedKeys).forEach(function (k) {
          if (segs[k] && lineMeta(segs[k]).red) {
            state.removedReds = state.removedReds || {};
            state.removedReds[k] = { id: segs[k].id, dir: segs[k].dir };
            delete segs[k];
          }
        });
      } else if (settings.passRedLine === 'dark' && state.removedReds) {
        /* 由“消失”切回“变暗”：重新显现为暗色 */
        Object.keys(state.removedReds).forEach(function (k) {
          if (!segs[k]) segs[k] = { id: state.removedReds[k].id, dir: state.removedReds[k].dir };
        });
        state.removedReds = {};
      }
      renderGrid();
    }
  }
  $('ps-red-prev').addEventListener('click', function () { cycleRedMode(-1); });
  $('ps-red-next').addEventListener('click', function () { cycleRedMode(1); });
  function setAnimToggleUi() {
    var on = !!settings.animHint;
    var b = $('ps-anim-toggle');
    if (!b) return;
    b.setAttribute('data-on', on ? '1' : '0');
    var im = b.querySelector('img');
    if (im) im.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function setShowAnimToggleUi() {
    var on = !!settings.showAnim;
    var b = $('ps-showanim-toggle');
    if (!b) return;
    b.setAttribute('data-on', on ? '1' : '0');
    var im = b.querySelector('img');
    if (im) im.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  $('ps-showanim-toggle').addEventListener('click', function () {
    settings.showAnim = !settings.showAnim;
    saveSettings();
    setShowAnimToggleUi();
  });
  function setFacingToggleUi() {
    var on = !!settings.showFacing;
    var b = $('ps-facing-toggle');
    if (!b) return;
    b.setAttribute('data-on', on ? '1' : '0');
    var im = b.querySelector('img');
    if (im) im.src = 'texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  $('ps-facing-toggle').addEventListener('click', function () {
    settings.showFacing = !settings.showFacing;
    saveSettings();
    setFacingToggleUi();
    if (stage && state) renderGrid();
  });
  setInterval(function () {
    if (!settings.animHint || !stage || !state || winDone) {
      animUnit = 2;
      return;
    }
    if (state.animBusy) return;   /* 移动/传送动画期间不重绘，避免瞬移 */
    if (Date.now() < lineFxUntil) return;  /* 线动画期间也不整幅重绘 */
    animUnit = animUnit === 2 ? 3 : 2;
    renderGrid();
  }, 500);
  function resolveMove(keyLow) {
    if (settings.dirMode === 'absolute') {
      /* 绝对：W/A/S/D = 上/左/下/右（仅当该方向属于可走方向时生效） */
      var g = KEY_DIR[keyLow];
      if (g === undefined) return -1;
      if (state.face < 0) return g;
      if (g === state.face || g === (state.face + 1) % 4) return g;
      return -1;
    }
    if (state.face < 0) return KEY_DIR[keyLow] === undefined ? -1 : KEY_DIR[keyLow];
    if (KEY_LOGICAL[keyLow] === 'f') return state.face;
    if (KEY_LOGICAL[keyLow] === 'l') return (state.face + 1) % 4;
    return -1;
  }
  document.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    /* 结算弹窗打开时：Enter = 下一关 / 重新开始 */
    if (!$('tl-dialog-modal').classList.contains('hidden')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (dialogVictory && curIdx + 1 < levels.length) winGoNext();
        else { closeDialog(); startLevel(curIdx); }
      } else if ((e.key || '').toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        closeDialog();
        startLevel(curIdx);
      }
      return;
    }
    if (e.code === 'KeyE') {
      if (!e.repeat) startPress(playerHideIsHide());
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyO' && !e.shiftKey) {
      e.preventDefault();
      startLevel(curIdx);
      return;
    }
    /* Shift+A / Shift+D：上一关 / 下一关 */
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var kk = (e.key || '').toLowerCase();
      if (kk === 'a') { e.preventDefault(); goLevel(-1); return; }
      if (kk === 'd') { e.preventDefault(); goLevel(1); return; }
    }
    var k = (e.key || '').toLowerCase();
    var codeMap = {
      KeyW: 1, KeyA: 2, KeyS: 3, KeyD: 0,
      ArrowUp: 1, ArrowLeft: 2, ArrowDown: 3, ArrowRight: 0
    };
    var cmdMap = { KeyW: 'f', KeyA: 'l', ArrowUp: 'f', ArrowLeft: 'l' };
    var g = codeMap[e.code];
    var d = -1;
    if (g !== undefined) d = resolveMoveCode(g, cmdMap[e.code]);
    if (stage && state && !winDone && d >= 0) doMove(d);
    if (g !== undefined) e.preventDefault();
  }, true);
  document.addEventListener('keyup', function (e) {
    if (e.code === 'KeyE') { releaseTemp(); e.preventDefault(); }
  }, true);
  function resolveMoveCode(g, cmd) {
    if (settings.dirMode === 'absolute') {
      if (state.face < 0) return g;
      if (g === state.face || g === (state.face + 1) % 4) return g;
      return -1;
    }
    if (state.face < 0) return g;
    /* 相对：仅 W/上=向前、A/左=左转；其余按键无效 */
    if (cmd === 'f') return state.face;
    if (cmd === 'l') return (state.face + 1) % 4;
    return -1;
  }

  var touchStart = null;
  var suppressClickUntil = 0;
  boardAreaEl.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    touchStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  boardAreaEl.addEventListener('click', function (e) {
    if (Date.now() < suppressClickUntil) return;
    if (!stage || !state || winDone || !lastE) return;
    var r = gridCanvas.getBoundingClientRect();
    if (!r.width) return;
    var gx = Math.round((e.clientX - r.left) / lastE);
    var gy = Math.round((e.clientY - r.top) / lastE);
    if (gx === state.x && gy === state.y) return;
    var dirs = state.face < 0 ? [0, 1, 2, 3] : [state.face, (state.face + 1) % 4];
    for (var i = 0; i < dirs.length; i++) {
      var D = DIRS[dirs[i]];
      if (state.x + D.dx === gx && state.y + D.dy === gy && edgeUsable(state.x, state.y, dirs[i])) {
        doMove(dirs[i]);
        return;
      }
    }
  });
  window.addEventListener('pointerup', function (e) {
    if (!touchStart) return;
    var dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < window.innerWidth * 0.3 || Date.now() - touchStart.t > 800) { touchStart = null; return; }
    var g = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 3 : 1);
    suppressClickUntil = Date.now() + 400;
    if (settings.dirMode === 'absolute') {
      if (state.face < 0) { doMove(g); touchStart = null; return; }
      if (g === state.face || g === (state.face + 1) % 4) doMove(g);
    } else {
      if (state.face < 0) doMove(g);
      else if (g === 1) doMove(state.face);
      else if (g === 2) doMove((state.face + 1) % 4);
    }
    touchStart = null;
  });

  /* ---------- 隐藏/显示小球（长按 E 或长按按钮） ---------- */
  var pressTemp = null;
  function releaseTemp() {
    if (pressTemp) { pressTemp(); pressTemp = null; }
  }
  function tempOpacity(v) {
    if (stage && state) { drawOpacity = v; renderGrid(); }
  }
  function startPress(hide) {
    releaseTemp();
    var base = settings.playerOpacity;
    function doTemp() { tempOpacity(hide ? 0 : 100); }
    function restore() { tempOpacity(base); }
    doTemp();
    pressTemp = restore;
    function up(ev) {
      if (ev.type === 'blur' && ev.target !== window) return;
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      releaseTemp();
    }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }
  function playerHideLabel() {
    return settings.playerOpacity >= 50 ? '隐藏小球(E)' : '显示小球(E)';
  }
  function playerHideIsHide() { return settings.playerOpacity >= 50; }

  /* ---------- 按钮 / 弹窗 ---------- */
  var mode = 'workshop';
  var setNameParam = '';
  var playUnordered = false;
  var unlockedIdx = 0;   /* 已解锁关卡的最大下标（含） */
  function campSaveKey() { return 'tlCampaignSave:' + setNameParam; }
  function readCampSave() {
    try { return JSON.parse(localStorage.getItem(campSaveKey()) || 'null') || { unlocked: 0, levels: {} }; }
    catch (e) { return { unlocked: 0, levels: {} }; }
  }
  function writeCampSave(o) {
    try { localStorage.setItem(campSaveKey(), JSON.stringify(o)); } catch (e) {}
  }
  function loadUnlocked() {
    if (mode !== 'campaign') {
      try {
        var v = parseInt(localStorage.getItem('tlPlayProg:' + mode + ':' + setNameParam), 10);
        if (!isNaN(v)) unlockedIdx = Math.max(0, Math.min(v, levels.length - 1));
      } catch (e) {}
      return;
    }
    var o = readCampSave();
    unlockedIdx = Math.max(0, Math.min(o.unlocked || 0, levels.length - 1));
  }
  function saveUnlocked(i) {
    unlockedIdx = Math.max(unlockedIdx, i);
    updateNavBtns();
    if (mode !== 'campaign') {
      try { localStorage.setItem('tlPlayProg:' + mode + ':' + setNameParam, String(unlockedIdx)); } catch (e) {}
      return;
    }
    var o = readCampSave();
    o.unlocked = unlockedIdx;
    writeCampSave(o);
  }
  /* 闯关模式：记录本关完成与各任务完成情况 */
  function recordLevelResult() {
    if (!winDone) return;                 /* 仅在胜利时记录 */
    if (!levels[curIdx]) return;
    var lvl = levels[curIdx];
    var results = [];
    (Array.isArray(lvl.tasks) ? lvl.tasks : []).forEach(function (task) {
      var conds = Array.isArray(task) ? task : [task];
      /* 任务的全部条件在胜利时均满足才算完成 */
      var ok = conds.length > 0 && conds.every(function (c) { return condState(c) === 'pass'; });
      results.push(!!ok);
    });
    if (mode !== 'campaign') {
      /* 工坊：仅内存记录，刷新即消失 */
      saveWorkshopRecord(curIdx, results, state ? state.steps : 0);
      return;
    }
    var o = readCampSave();
    o.levels = o.levels || {};
    var prev = o.levels[curIdx] || {};
    var best = (typeof prev.best === 'number') ? Math.min(prev.best, state ? state.steps : 0) : (state ? state.steps : 0);
    /* 累计已完成任务（多次游玩完成的不同任务都记录） */
    var prevDone = Array.isArray(prev.doneTasks) ? prev.doneTasks.slice() : [];
    if (!prevDone.length && Array.isArray(prev.tasks)) {
      prev.tasks.forEach(function (ok, i) { if (ok) prevDone.push(i); });
    }
    results.forEach(function (ok, i) { if (ok && prevDone.indexOf(i) < 0) prevDone.push(i); });
    o.levels[curIdx] = { done: true, best: best, steps: state ? state.steps : 0, tasks: results, doneTasks: prevDone };
    o.unlocked = Math.max(o.unlocked || 0, unlockedIdx);
    writeCampSave(o);
  }
  var winTimer = null;
  var winMoving = false;
  function clearWinTimer() {
    if (winTimer) { clearInterval(winTimer); winTimer = null; }
  }
  function winGoNext() {
    if (winMoving) return;
    if (curIdx + 1 >= levels.length) return;
    winMoving = true;
    clearWinTimer();
    $('tl-dialog-modal').classList.add('hidden');
    saveUnlocked(curIdx + 1);
    startLevel(curIdx + 1);
    winMoving = false;
  }
  $('btn-play-back').addEventListener('click', function () {
    if (mode === 'campaign') {
      location.href = 'index.html?open=campaign';
      return;
    }
    /* 工坊：退出将清空本会话成绩，先确认 */
    $('quit-modal').classList.remove('hidden');
  });
  $('quit-cancel').addEventListener('click', function () { $('quit-modal').classList.add('hidden'); });
  var bypassUnload = false;
  window.addEventListener('beforeunload', function (e) {
    if (mode !== 'workshop' || bypassUnload) return;
    /* 仅在本会话已有成绩或当前局有进度时提示 */
    var hasProgress = (state && state.steps > 0) || Object.keys(wsRecords).length > 0;
    if (!hasProgress) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
  $('quit-ok').addEventListener('click', function () {
    bypassUnload = true;
    try {
      localStorage.setItem('tlOpenWorkshop', '1');
      localStorage.setItem('tlOpenWorkshopFromPlay', '1');
    } catch (e) {}
    location.href = 'index.html';
  });
  $('btn-restart').addEventListener('click', function () { startLevel(curIdx); });
  $('btn-levels').addEventListener('click', openLevels);
  $('btn-levels-close').addEventListener('click', function () { $('levels-modal').classList.add('hidden'); });
  $('btn-levels-stats').addEventListener('click', function () { openPlayStats(); });
  $('btn-play-stats-close').addEventListener('click', function () { $('play-stats-modal').classList.add('hidden'); });
  $('btn-tl-dex').addEventListener('click', openDex);
  function thresholdIdx(name) {
    for (var i = 0; i < levels.length; i++) if ((levels[i].name || '') === name) return i;
    return -1;
  }
  function openDex() {
    var body = $('tl-dex-body');
    body.innerHTML = '';
    var fullDex = !isMainCampaign;
    var reach = function (idx) { return fullDex || idx < 0 || unlockedIdx >= idx; };
    var i31 = thresholdIdx('3-1'), i41 = thresholdIdx('4-1'), i51 = thresholdIdx('5-1'), i61 = thresholdIdx('6-1');
    var lateEnd = fullDex || (i51 >= 0 && unlockedIdx >= i51);
    /* 过了 6-1（或特殊关卡集）后，传送门图鉴展示 portal2-4 的贴图 */
    var campSaveDex = isMainCampaign ? readCampSave() : null;
    var showP234 = fullDex || (i61 >= 0 && (unlockedIdx > i61 || !!(campSaveDex && campSaveDex.levels && campSaveDex.levels[i61] && campSaveDex.levels[i61].done)));
    var unit = 3;
    function entry(imgs, natH, title, desc) {
      if (!Array.isArray(imgs)) imgs = [imgs];
      var row = document.createElement('div');
      row.className = 'tl-dex-row';
      var head = document.createElement('div');
      head.className = 'tl-dex-head';
      imgs.forEach(function (src) {
        var im = document.createElement('img');
        im.src = src;
        im.style.height = (natH * unit) + 'px';
        im.alt = title;
        head.appendChild(im);
      });
      var nm = document.createElement('span');
      nm.textContent = title;
      head.appendChild(nm);
      row.appendChild(head);
      var hr = document.createElement('hr');
      hr.className = 'tl-dex-divider';
      row.appendChild(hr);
      var d = document.createElement('div');
      d.className = 'tl-dex-desc';
      String(desc).split('\n').forEach(function (seg, si) {
        var p = document.createElement('span');
        p.className = 'tl-dex-para';
        p.textContent = seg;
        if (si > 0) p.classList.add('break');
        d.appendChild(p);
      });
      row.appendChild(d);
      body.appendChild(row);
    }
    entry('turnleft-texture/player.png', 11, '玩家', '玩家是你操控的对象。从第二步开始，你只能前进或左转(Turn Left)。');
    entry('turnleft-texture/normalline.png', 3, '线', '线是玩家的"道路"。玩家只能在线上行走以到达终点。');
    entry('turnleft-texture/startpoint.png', 7, '生成点', '玩家将在这里生成。');
    entry('turnleft-texture/endpoint.png', 7, '终点', lateEnd
      ? '终点是玩家的目标。玩家需要在经过所有任务线后到达终点以获得胜利。'
      : '终点是玩家的目标。玩家需要到达终点才可获得胜利。当然，在此之前，你可能需要先完成些什么...');
    if (reach(i31)) entry('turnleft-texture/arrowline.png', 7, '箭头线', '箭头线是一种特殊的线。玩家只能沿箭头指向的方向经过，而不能反向经过。');
    if (reach(i41)) entry(showP234
      ? ['turnleft-texture/portal1.png', 'turnleft-texture/portal2.png', 'turnleft-texture/portal3.png', 'turnleft-texture/portal4.png']
      : 'turnleft-texture/portal1.png', 11, '传送门', '传送门是一种特殊的角点。玩家进入传送门时，会被传送至另一个传送门，且保持玩家当前的朝向。\n传送门可以和除它本身外的所有角点重合。对于重合点的判定，你可以记住：起点的优先级最高，而传送门的最低。');
    if (reach(i51)) entry('turnleft-texture/taskline.png', 3, '任务线', '任务线是一种特殊的线。玩家需要经过所有的任务线，才可在到达终点时胜利。\n任务线可以和其它的特殊线叠加。当一条线叠加了多种特殊线时，它会继承这些线的全部功能。');
    if (reach(i61)) entry('turnleft-texture/redline.png', 3, '红线', '红线是一种特殊的线。玩家只能经过它们一次，经过后它们会消失。');
    $('dex-modal').classList.remove('hidden');
  }
  $('btn-dex-back').addEventListener('click', function () { $('dex-modal').classList.add('hidden'); });
  $('btn-dex-close').addEventListener('click', function () { $('dex-modal').classList.add('hidden'); });
  $('btn-play-settings').addEventListener('click', openSettings);
  $('btn-play-settings-close').addEventListener('click', function () { $('play-settings-modal').classList.add('hidden'); });
  function openLevels() {
    var list = $('levels-list');
    list.innerHTML = '';
    levels.forEach(function (lvl, i) {
      if (i > unlockedIdx) return;   /* 只显示已玩过（已解锁）的关卡 */
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'room-btn';
      var bar = document.createElement('span');
      bar.className = 'room-bar';
      var nm = document.createElement('span');
      nm.className = 'room-host';
      nm.textContent = lvl.name || ('关卡 ' + (i + 1));
      var desc = document.createElement('span');
      desc.className = 'room-rules';
      var dText = lvl.width + 'x' + lvl.height;
      var rec = levelRecord(i);
      if (rec && typeof rec.best === 'number') {
        dText += ' | 最佳步数' + rec.best + '步' + (lvl.minstep === rec.best ? '(理论值)' : '');
      }
      if (rec && Array.isArray(rec.doneTasks) && rec.doneTasks.length) {
        var totTasks = taskCountOf(lvl);
        if (totTasks > 0 && rec.doneTasks.length >= totTasks) dText += ' | 已完成全部' + totTasks + '个任务';
        else dText += ' | 已完成' + rec.doneTasks.length + '个任务';
      }
      desc.textContent = dText;
      b.appendChild(bar);
      b.appendChild(nm);
      b.appendChild(desc);
      b.addEventListener('click', function () {
        startLevel(i);
        $('levels-modal').classList.add('hidden');
      });
      list.appendChild(b);
    });
    $('btn-levels-stats').classList.toggle('hidden', mode === 'campaign');
    $('levels-modal').classList.remove('hidden');
    setTimeout(function () { if (updateLevelsScroll) updateLevelsScroll(); }, 30);
  }
  function emptyCond(c) {
    if (!c) return true;
    if (c.type === 0) {
      var mn = c.minstep, mx = c.maxstep;
      var e1 = mn === '' || mn === null || mn === undefined;
      var e2 = mx === '' || mx === null || mx === undefined;
      if (e1 && e2) return true;
    }
    return false;
  }
  function taskCountOf(lvl) {
    var n = 0;
    (Array.isArray(lvl.tasks) ? lvl.tasks : []).forEach(function (t) {
      var conds = Array.isArray(t) ? t : [t];
      if (conds.some(function (c) { return !emptyCond(c); })) n++;
    });
    return n;
  }
  function openPlayStats() {
    if (mode === 'campaign') return;
    var body = $('play-stats-body');
    body.innerHTML = '';
    var doneN = 0, bestN = 0, tasksDone = 0, tasksTotal = 0;
    levels.forEach(function (lvl, i) {
      tasksTotal += taskCountOf(lvl);
      var rec = levelRecord(i);
      if (!rec || !rec.done) return;
      doneN++;
      if (typeof lvl.minstep === 'number' && typeof rec.best === 'number' && lvl.minstep === rec.best) bestN++;
      if (Array.isArray(rec.doneTasks)) tasksDone += rec.doneTasks.length;
    });
    var title = document.createElement('div');
    title.className = 'tl-record-title';
    title.textContent = setNameParam || '关卡集';
    body.appendChild(title);
    var hr = document.createElement('hr');
    hr.className = 'tl-record-divider';
    body.appendChild(hr);
    function row(a, b) {
      var r = document.createElement('div');
      r.className = 'tl-record-row';
      var l = document.createElement('span');
      l.textContent = a;
      var v = document.createElement('span');
      v.textContent = b;
      r.appendChild(l);
      r.appendChild(v);
      body.appendChild(r);
    }
    row('完成的关卡数', doneN + '/' + levels.length);
    row('以最少步数完成的关卡', bestN + '/' + levels.length);
    row('完成的任务数', tasksDone + '/' + tasksTotal);
    $('play-stats-modal').classList.remove('hidden');
  }
  function openSettings() {
    $('ps-panel-scale').value = settings.panelScale;
    $('ps-bench-scale').value = settings.benchScale;
    $('ps-panel-label').textContent = settings.panelScale + '%';
    $('ps-bench-label').textContent = settings.benchScale + '%';
    $('ps-opacity-scale').value = settings.playerOpacity;
    $('ps-opacity-label').textContent = settings.playerOpacity + '%';
    $('ps-speed-scale').value = settings.animSpeed;
    $('ps-speed-label').textContent = settings.animSpeed + '%';
    setDirModeLabel();
    setPassLabel();
    setRedLabel();
    setAnimToggleUi();
    setShowAnimToggleUi();
    $('play-settings-modal').classList.remove('hidden');
    styleSlider();
    requestAnimationFrame(styleSlider);   /* 弹窗显示后按实际宽度重算 */
    requestAnimationFrame(function () { psUpdateBar(); });
    setTimeout(function () { psUpdateBar(); }, 120);
  }
  $('ps-opacity-scale').addEventListener('input', function () {
    settings.playerOpacity = parseInt(this.value, 10);
    $('ps-opacity-label').textContent = this.value + '%';
    saveSettings();
    drawOpacity = settings.playerOpacity;
    if (stage) renderGrid();
    updateHints();
    styleSlider();
  });
  $('ps-speed-scale').addEventListener('input', function () {
    settings.animSpeed = parseInt(this.value, 10);
    $('ps-speed-label').textContent = this.value + '%';
    saveSettings();
    styleSlider();
  });
  $('ps-anim-toggle').addEventListener('click', function () {
    settings.animHint = !settings.animHint;
    saveSettings();
    setAnimToggleUi();
    if (!settings.animHint) animUnit = 2;
    renderGrid();
  });
  function cycleDirMode(delta) {
    var modes = ['absolute', 'relative'];
    var i = modes.indexOf(settings.dirMode);
    if (i < 0) i = 0;
    i = (i + delta + 2) % 2;
    settings.dirMode = modes[i];
    saveSettings();
    setDirModeLabel();
    updateHints();   /* 左侧方向按键随模式刷新 */
  }
  $('ps-dir-prev').addEventListener('click', function () { cycleDirMode(-1); });
  $('ps-dir-next').addEventListener('click', function () { cycleDirMode(1); });
  function styleSlider() {
    var sliders = [$('ps-panel-scale'), $('ps-bench-scale'), $('ps-opacity-scale'), $('ps-speed-scale')].filter(Boolean);
    for (var i = 0; i < sliders.length; i++) {
      var s = sliders[i];
      var w = s.clientWidth || 300;
      var fs = parseFloat(window.getComputedStyle(s).fontSize) || 16;
      var trackHpx = Math.max(2, w / 62);
      var trackH = trackHpx / fs;
      var thumbH = trackH * 7;
      var thumbW = trackH * 2.5;
      var thumbWpx = trackHpx * 2.5;
      var min = parseFloat(s.min) || 0;
      var max = parseFloat(s.max) || 100;
      var val = parseFloat(s.value) || 100;
      var f = Math.max(0, Math.min(1, (val - min) / (max - min)));
      var fill = (f * (1 - thumbWpx / w) + thumbWpx / (2 * w)) * 100;
      s.style.setProperty('--track-h', trackH.toFixed(4) + 'em');
      s.style.setProperty('--thumb-w', thumbW.toFixed(4) + 'em');
      s.style.setProperty('--thumb-h', thumbH.toFixed(4) + 'em');
      s.style.setProperty('--fill', fill.toFixed(2) + '%');
    }
  }
  $('ps-panel-scale').addEventListener('input', function () {
    settings.panelScale = parseInt(this.value, 10);
    $('ps-panel-label').textContent = this.value + '%';
    saveSettings(); applyLayout(); renderGrid(); refreshLevelLabel(); styleSlider();
  });
  $('ps-bench-scale').addEventListener('input', function () {
    settings.benchScale = parseInt(this.value, 10);
    $('ps-bench-label').textContent = this.value + '%';
    saveSettings(); applyLayout(); renderGrid(); refreshLevelLabel(); styleSlider();
  });

  /* ---------- 启动 ---------- */
  loadSettings();
  if (window.Profile && Profile.applyBackground) Profile.applyBackground();
  updateLevelsScroll = wireListScroll($('levels-lobby'), $('levels-scrollbar'), $('levels-scrollbar-thumb'));
  drawOpacity = settings.playerOpacity;
  setAnimToggleUi();
  setFacingToggleUi();
  setShowAnimToggleUi();
  applyLayout();
  function psUpdateBar() {
    var b = $('ps-settings-body'), sb = $('ps-scrollbar'), th = $('ps-scrollbar-thumb');
    if (!b || !sb || !th) return;
    var ov = b.scrollHeight - b.clientHeight;
    if (ov <= 0) { sb.style.display = 'none'; return; }
    sb.style.display = 'block';
    var ratio = b.clientHeight / b.scrollHeight;
    th.style.height = (ratio * 100) + '%';
    th.style.top = ((b.scrollTop / ov) * (100 - ratio * 100)) + '%';
  }
  var bEl2 = $('ps-settings-body'), sEl2 = $('ps-scrollbar'), tEl2 = $('ps-scrollbar-thumb');
  if (bEl2 && sEl2 && tEl2) {
    bEl2.addEventListener('scroll', psUpdateBar);
    sEl2.addEventListener('mousedown', function (ev) {
      if (ev.target === tEl2) return;
      var rect = sEl2.getBoundingClientRect();
      var ratio = (ev.clientY - rect.top) / rect.height;
      bEl2.scrollTop = ratio * (bEl2.scrollHeight - bEl2.clientHeight);
      psUpdateBar();
    });
    (function wireDrag() {
      tEl2.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var startY = e.clientY, startTop = bEl2.scrollTop;
        var trackH = sEl2.clientHeight - tEl2.offsetHeight;   /* 滑块可移动的像素范围 */
        var ov2 = bEl2.scrollHeight - bEl2.clientHeight;
        if (trackH <= 0) return;
        function move(ev) {
          /* 鼠标移动 dy 像素，滑块也移动 dy 像素 */
          bEl2.scrollTop = startTop + (ev.clientY - startY) * (ov2 / trackH);
          psUpdateBar();
        }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    })();
  }
  setAnimToggleUi();
  window.addEventListener('resize', function () { applyLayout(); if (stage) renderGrid(); psUpdateBar(); if (updateLevelsScroll) updateLevelsScroll(); });

  var qs = new URLSearchParams(location.search);
  var setName = qs.get('set');
  mode = qs.get('mode') || 'workshop';
  setNameParam = setName || '';
  var dexBtn = $('btn-tl-dex');
  if (dexBtn) dexBtn.classList.toggle('hidden', mode !== 'campaign');
  var setData = null;
  var isMainCampaign = false;
  if (mode === 'campaign') {
    setNameParam = setNameParam || 'TurnLeft';
    isMainCampaign = setNameParam === 'TurnLeft';
    var SPECIAL_G = {
      Oneshot: 'TURNLEFT_ONESHOT_JSON',
      Endportal: 'TURNLEFT_ENDPORTAL_JSON',
      Island: 'TURNLEFT_ISLAND_JSON',
      Symmetrical: 'TURNLEFT_SYMMETRICAL_JSON',
      'Multiportal': 'TURNLEFT_MULTIPORTAL_JSON',
      Giant: 'TURNLEFT_GIANT_JSON'
    };
    var pick = SPECIAL_G[setNameParam] ? window[SPECIAL_G[setNameParam]] : window.TURNLEFT_CAMPAIGN_JSON;
    try { setData = JSON.parse(pick || 'null'); } catch (e) {}
    if (setNameParam !== 'TurnLeft') playUnordered = true;
  } else {
    try {
      var arr = JSON.parse(localStorage.getItem('tlWorkshopFolder') || '[]');
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].name === setName) { setData = JSON.parse(arr[i].raw || 'null'); break; }
      }
    } catch (e) {}
  }
  if (Array.isArray(setData) && setData.length && typeof setData[0] === 'string') {
    playUnordered = setData[0] === 'unordered';
    setData = setData.filter(function (x) { return x && typeof x === 'object'; });
  }
  if (!setData || !Array.isArray(setData) || !setData.length) {
    $('tl-status').textContent = '未找到关卡集数据';
    return;
  }
  loadLevelSet(setData);
  loadUnlocked();
  if (playUnordered) unlockedIdx = levels.length - 1;
  var startIdx = 0;
  if (mode === 'campaign') {
    var o = readCampSave();
    var found = null;
    for (var li = 0; li <= unlockedIdx; li++) {
      var done = o.levels && o.levels[li] && o.levels[li].done;
      if (!done) { found = li; break; }
    }
    startIdx = found === null ? Math.min(unlockedIdx, levels.length - 1) : found;
  }
  startLevel(startIdx);
})();
