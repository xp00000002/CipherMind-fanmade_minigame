/* editor.js - 关卡制作器 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 素材 ---------- */
  var TEX = {
    dotDark: 'turnleft-texture/darkconnectpoint.png',
    dotConnect: 'turnleft-texture/connectpoint.png',
    dotRed: 'turnleft-texture/redconnectpoint.png',
    lineDark: 'turnleft-texture/darkline.png',
    n: 'turnleft-texture/normalline.png',
    a: 'turnleft-texture/arrowline.png',
    t: 'turnleft-texture/taskline.png',
    ta: 'turnleft-texture/taskarrowline.png',
    rn: 'turnleft-texture/redline.png',
    ra: 'turnleft-texture/redarrowline.png',
    rt: 'turnleft-texture/redtaskline.png',
    rta: 'turnleft-texture/redtaskarrowline.png',
    start: 'turnleft-texture/startpoint.png',
    end: 'turnleft-texture/endpoint.png',
    startEnd: 'turnleft-texture/startendpoint.png',
    redstart: 'turnleft-texture/redstartpoint.png',
    redend: 'turnleft-texture/redendpoint.png',
    redstartEnd: 'turnleft-texture/redstartendpoint.png',
    redp1: 'turnleft-texture/redportal1.png',
    redp2: 'turnleft-texture/redportal2.png',
    redp3: 'turnleft-texture/redportal3.png',
    redp4: 'turnleft-texture/redportal4.png',
    p1: 'turnleft-texture/portal1.png',
    p2: 'turnleft-texture/portal2.png',
    p3: 'turnleft-texture/portal3.png',
    p4: 'turnleft-texture/portal4.png'
  };
  /* 线工具定义（col: w=白/普通, r=red 变体；shape: n 普通 / a 箭头 / t 任务线 / ta 任务箭头） */
  var LINE_TOOLS = [
    { id: 'n',   tex: 'n',   col: 'w' },
    { id: 'a',   tex: 'a',   col: 'w' },
    { id: 't',   tex: 't',   col: 'w' },
    { id: 'ta',  tex: 'ta',  col: 'w' },
    { id: 'rn',  tex: 'rn',  col: 'r' },
    { id: 'ra',  tex: 'ra',  col: 'r' },
    { id: 'rt',  tex: 'rt',  col: 'r' },
    { id: 'rta', tex: 'rta', col: 'r' }
  ];
  var LINE_TYPES = {};
  LINE_TOOLS.forEach(function (t) { LINE_TYPES[t.id] = t; });
  function lineShape(id) { return (id || 'n').replace(/^r/, ''); }
  function lineCol(id) { return (id || 'n').charAt(0) === 'r' ? 'r' : 'w'; }
  function isArrowShape(s) { return s === 'a' || s === 'ta'; }

  var POINT_TOOLS = [
    { id: 'portal', key: function () { return 'p' + currentPortalStage(); }, scale: 0.5 },
    { id: 'start', key: function () { return 'start'; }, scale: 0.5 },
    { id: 'end', key: function () { return 'end'; }, scale: 0.5 }
  ];

  var dotSize = 3, lineLen = 48, lineThick = 3;
  var images = {};           // TEX key -> Image
  var imageReady = false;
  /* 各贴图原始像素尺寸（加载后以实际为准；48x7 系贴图宽度同为 48） */
  var NATW = { n: 48, a: 48, t: 48, ta: 48, rn: 48, ra: 48, rt: 48, rta: 48, lineDark: 48, dotDark: 3, dotConnect: 3, dotRed: 3, start: 7, end: 7, startEnd: 7, redstart: 7, redend: 7, redstartEnd: 7, p1: 11, p2: 11, p3: 11, p4: 11, redp1: 11, redp2: 11, redp3: 11, redp4: 11 };
  var NATH = { n: 3, a: 7, t: 3, ta: 7, rn: 3, ra: 7, rt: 3, rta: 7, lineDark: 3, dotDark: 3, dotConnect: 3, dotRed: 3, start: 7, end: 7, startEnd: 7, redstart: 7, redend: 7, redstartEnd: 7, p1: 11, p2: 11, p3: 11, p4: 11, redp1: 11, redp2: 11, redp3: 11, redp4: 11 };
  function natW(key) { return images[key] && images[key].naturalWidth ? images[key].naturalWidth : (NATW[key] || 48); }
  function natH(key) { return images[key] && images[key].naturalHeight ? images[key].naturalHeight : (NATH[key] || 3); }

  /* ---------- 关卡状态 ---------- */
  var stage = null;                 // { w, h }
  var e = 0;                        // 相邻角点中心间距（渲染时计算，单位 px）
  var segs = {};                    // 'h/x/y' | 'v/x/y' -> { id }
  var vertices = {};                // 'x,y' -> { start, end, portal } (portal = 1..4)
  var portalCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
  var startCount = 0, endCount = 0;

  /* ---------- 撤销 / 重做（各记录最近 50 步） ---------- */
  var MAX_HISTORY = 50;
  var undoStack = [];
  var redoStack = [];
  function snapState() { return { segs: JSON.stringify(segs), vertices: JSON.stringify(vertices) }; }
  function pushHistory() {
    undoStack.push(snapState());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateHistBtns();
  }
  /* 关卡“已求解”标记（不入 JSON，仅运行期） */
  function ensureSolvedFlag(it) {
    if (it && typeof it === 'object' && !Object.prototype.hasOwnProperty.call(it, '_solved')) {
      Object.defineProperty(it, '_solved', { value: false, writable: true, enumerable: false });
    }
  }
  function markLevelEdited() {
    wsMark();
    if (currentItem) {
      ensureSolvedFlag(currentItem);
      currentItem._solved = false;
    }
  }
  function markLevelSolved(ok) {
    if (currentItem) {
      ensureSolvedFlag(currentItem);
      currentItem._solved = !!ok;
    }
  }
  function withHistory(action) {
    pushHistory();
    action();
    /* 实际未发生变化的操作不入历史 */
    var last = undoStack[undoStack.length - 1];
    var now = snapState();
    if (last && last.segs === now.segs && last.vertices === now.vertices) undoStack.pop();
    else markLevelEdited();
    updateHistBtns();
  }
  function resetHistory() { undoStack.length = 0; redoStack.length = 0; updateHistBtns(); }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapState());
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    restoreState(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapState());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    restoreState(redoStack.pop());
  }
  function restoreState(st) {
    if (!st) return;
    segs = JSON.parse(st.segs);
    vertices = JSON.parse(st.vertices);
    scanVertexCounts();
    renderGrid();
    renderToolBar();
    updateHistBtns();
    markLevelEdited();
  }
  function updateHistBtns() {
    var u = $('btn-undo'), r = $('btn-redo'), c = $('btn-clear'), s = $('btn-solve'), tk = $('btn-tasks'), bt = $('btn-batch'), tst = $('btn-test');
    if (u) u.disabled = undoStack.length === 0;
    if (r) r.disabled = redoStack.length === 0;
    if (c) c.disabled = !stage;
    if (s) s.disabled = !stage;
    if (tk) tk.disabled = !stage;
    if (tst) tst.disabled = !stage;
    if (bt) bt.disabled = !levelSet || !levelSet.length;
    var p = $('btn-prev'), nx = $('btn-next');
    var curIdx = levelSet && currentItem ? levelSet.indexOf(currentItem) : -1;
    if (p) p.disabled = curIdx <= 0;
    if (nx) nx.disabled = curIdx < 0 || curIdx >= levelSet.length - 1;
  }
  function clearAll() {
    if (!stage) return;
    withHistory(function () {
      segs = {};
      vertices = {};
      portalCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
      startCount = 0; endCount = 0;
      renderGrid();
      renderToolBar();
    });
  }

  /* ---------- 工具选择 ---------- */
  var toolKind = null;              // 'line' | 'point'
  var toolId = null;                // LINE_TOOLS id 或 POINT_TOOLS 项（portal 为动态图标）

  function currentPortalStage() {
    for (var l = 1; l <= 4; l++) if (portalCount[l] < 2) return l;
    return 4;
  }
  function portalFull() { return portalCount[1] >= 2 && portalCount[2] >= 2 && portalCount[3] >= 2 && portalCount[4] >= 2; }

  /* ---------- 面板 ---------- */
  var workbench = $('workbench');
  var boardWrap = $('board-wrap');
  var gridView = $('grid-view');
  var gridCanvas = $('grid-canvas');
  var emptyTip = $('workbench-empty');
  var gameLayoutEl = document.querySelector('.game-layout');
  var boardAreaEl = document.querySelector('.board-area');

  function showModal(el) { el.classList.remove('hidden'); }
  function hideModal(el) { el.classList.add('hidden'); }

  var toastTimer = null;
  function toast(msg) {
    var old = $('toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 8300);
  }

  /* ---------- 设置 ---------- */
  var editorSettings = { benchScale: 100, panelScale: 100, showLevelName: true, unordered: false };
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('tlEditorSettings'));
      if (s) for (var k in editorSettings) if (s[k] !== undefined) editorSettings[k] = s[k];
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem('tlEditorSettings', JSON.stringify(editorSettings)); } catch (e) {}
  }
  function styleSlider() {
    var sliders = [$('bench-scale'), $('panel-scale')].filter(Boolean);
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
  function refreshLevelName() {
    var lb = $('level-name');
    if (!lb) return;
    var show = editorSettings.showLevelName && currentItem && stage;
    lb.classList.toggle('hidden', !show);
    if (!show) { lb.textContent = ''; return; }
    lb.textContent = currentItem.name || '';
    var w = boardWrap ? boardWrap.getBoundingClientRect().width : benchSize();
    var fs = Math.max(10, Math.round(w / 13));
    lb.style.fontSize = fs + 'px';
    lb.style.top = Math.max(2, Math.round(w * 0.015)) + 'px';
  }
  function setToggleImg2(id, on) {
    var b = $(id);
    if (!b) return;
    b.setAttribute('data-on', on ? '1' : '0');
    var im = b.querySelector('img');
    if (im) im.src = 'turnleft-texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function openSettings() {
    setToggleImg2('opt-show-name', !!editorSettings.showLevelName);
    setToggleImg2('opt-unordered', !!editorSettings.unordered);
    $('bench-scale').value = editorSettings.benchScale;
    $('bench-scale-label').textContent = editorSettings.benchScale + '%';
    $('panel-scale').value = editorSettings.panelScale;
    $('panel-scale-label').textContent = editorSettings.panelScale + '%';
    showModal($('settings-modal'));
    styleSlider();
  }
  $('opt-unordered').addEventListener('click', function () {
    editorSettings.unordered = !editorSettings.unordered;
    saveSettings();
    setToggleImg2('opt-unordered', editorSettings.unordered);
  });

  /* ---------- 布局（列宽与制作台尺寸） ---------- */
  function applyEditorLayout() {
    if (!gameLayoutEl || !boardAreaEl) return;
    var ps = (editorSettings.panelScale || 100) / 100;
    var bs = (editorSettings.benchScale || 100) / 100;
    document.documentElement.style.setProperty('--panel-scale', ps.toFixed(2));
    var side;
    if (window.innerWidth <= 900) {
      /* 平板/手机：单列，棋盘按宽度取最大 1:1，高度不足时整页滚动 */
      gameLayoutEl.style.gridTemplateColumns = '';
      side = Math.max(160, Math.round((window.innerWidth - 24) * bs));
    } else {
      var pw = Math.round(230 * ps);
      var avail = Math.max(240, window.innerWidth - 2 * pw - 28 - 36);
      side = Math.max(200, Math.round(Math.min(avail, window.innerHeight - 40) * bs));
      gameLayoutEl.style.gridTemplateColumns = pw + 'px ' + side + 'px ' + pw + 'px';
    }
    if (boardWrap) { boardWrap.style.width = side + 'px'; boardWrap.style.height = side + 'px'; }
    boardAreaEl.style.height = side + 'px';
    updateEditorBtnBasis(ps);
    updateEditorToolBasis(ps);
    refreshLevelName();
    updateEditorShortcutHints();
  }
  function updateEditorToolBasis(ps) {
    var btns = document.querySelectorAll('.editor-page .panel.right .toolbar .tl-line, .editor-page .panel.right .toolbar .tl-point');
    if (!btns.length) return;
    if (window.innerWidth > 900) {
      for (var z = 0; z < btns.length; z++) btns[z].style.flexBasis = '';
      return;
    }
    var cols;
    if (window.innerWidth <= 560) {
      cols = 2;
    } else {
      var panelW = Math.max(140, window.innerWidth - 24 - 20);
      var minW = Math.max(90, 140 * ps);
      cols = Math.max(2, Math.min(4, Math.floor(panelW / minW)));
    }
    var basis = (100 / cols - 1.2).toFixed(2) + '%';
    for (var i = 0; i < btns.length; i++) btns[i].style.flexBasis = basis;
  }
  function updateEditorBtnBasis(ps) {
    var btns = document.querySelectorAll('.editor-page .panel.left .controls .btn');
    if (window.innerWidth <= 900) {
      var panelW = Math.max(120, window.innerWidth - 24 - 20);
      var minW = Math.max(96, 150 * ps);
      var cols = Math.max(1, Math.min(4, Math.floor(panelW / minW)));
      var basis = (100 / cols - 1.5).toFixed(2) + '%';
      for (var i = 0; i < btns.length; i++) btns[i].style.flexBasis = basis;
    } else {
      for (var j = 0; j < btns.length; j++) btns[j].style.flexBasis = '';
    }
  }
  function updateEditorShortcutHints() {
    var narrow = window.innerWidth <= 900;
    var defs = [
      { id: 'btn-save', full: '保存关卡集(Ctrl+S)', short: '保存关卡集' },
      { id: 'btn-undo', full: '撤销(Ctrl+Z)', short: '撤销' },
      { id: 'btn-redo', full: '重做(Ctrl+Y)', short: '重做' },
      { id: 'btn-clear', full: '清空(Shift+Z)', short: '清空' },
      { id: 'btn-test', full: '测试关卡(Ctrl+Space)', short: '测试关卡' }
    ];
    defs.forEach(function (d) {
      var b = $(d.id);
      if (b) b.textContent = narrow ? d.short : d.full;
    });
  }

  function benchSize() { return workbench.getBoundingClientRect().width; }

  /* ---------- 素材加载 ---------- */
  function loadAssets(cb) {
    var keys = Object.keys(TEX);
    var done = 0;
    keys.forEach(function (k) {
      var img = new Image();
      img.onload = function () { images[k] = img; if (k === 'dotDark') dotSize = img.naturalWidth; if (k === 'lineDark') { lineLen = img.naturalWidth; lineThick = img.naturalHeight; } if (++done >= keys.length) { imageReady = true; cb && cb(); } };
      img.onerror = function () { if (++done >= keys.length) { imageReady = true; cb && cb(); } };
      img.src = TEX[k];
    });
  }

  /* ---------- 工具面板渲染 ---------- */
  function selectTool(kind, id) {
    toolKind = kind;
    toolId = id;
    renderToolBar();
  }
  function renderToolBar() {
    var bar = $('toolbar');
    if (!bar) return;
    bar.innerHTML = '';
    var lineDefs = LINE_TOOLS;
    var pointDefs = POINT_TOOLS;

    function mkBtn(cls, imgKey, imgScale, kind, id, extraCls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls + (extraCls ? ' ' + extraCls : '') + (toolKind === kind && toolId === id ? ' sel' : '');
      var im = document.createElement('img');
      im.className = 'tool-img';
      im.draggable = false;
      if (images[imgKey]) { im.src = images[imgKey].src; } else { im.src = TEX[imgKey]; }
      im.style.setProperty('--tool-scale', imgScale);
      b.appendChild(im);
      b.addEventListener('click', function () { selectTool(kind, id); });
      return b;
    }

    /* 线工具：每行一个，高度 = 宽度的 1/5 */
    lineDefs.forEach(function (t) {
      var key = (t.col === 'r' ? 'r' : '') + t.id.replace(/^r/, '');
      bar.appendChild(mkBtn('tl-line', key, 0.8, 'line', t.id));
    });
    /* 点工具：一行三个，方形按钮 */
    var row = document.createElement('div');
    row.className = 'tl-point-row';
    for (var i = 0; i < pointDefs.length; i++) {
      var pd = pointDefs[i];
      /* portal 始终可选择：放满后也可选中以便右键删除，仅放置时提示已放满 */
      var off = pd.id === 'portal' && portalFull() ? '' : '';
      row.appendChild(mkBtn('tl-point', pd.key(), pd.scale, 'point', pd.id, off));
    }
    bar.appendChild(row);
    updateEditorToolBasis((editorSettings.panelScale || 100) / 100);
  }

  /* ---------- 网格（点/线状态）渲染 ---------- */
  function segKey(dir, x, y) { return dir + '/' + x + '/' + y; }
  function vertexKey(x, y) { return x + ',' + y; }

  function hasPlacedIncident(x, y) {
    var w = stage.w, h = stage.h;
    if (x < w && segs[segKey('h', x, y)]) return true;
    if (x > 0 && segs[segKey('h', x - 1, y)]) return true;
    if (y < h && segs[segKey('v', x, y)]) return true;
    if (y > 0 && segs[segKey('v', x, y - 1)]) return true;
    return false;
  }
  /* 角点“红线较多”判定：只有红线(无其他线)，或红线达 3 条及以上(可混有其他线) */
  function isRedVertex(x, y) {
    if (!stage) return false;
    if (!hasPlacedIncident(x, y)) return false;
    var red = 0, yellow = false;
    var w = stage.w, h = stage.h;
    var cand = [];
    if (x < w) cand.push(segKey('h', x, y));
    if (x > 0) cand.push(segKey('h', x - 1, y));
    if (y < h) cand.push(segKey('v', x, y));
    if (y > 0) cand.push(segKey('v', x, y - 1));
    cand.forEach(function (k) {
      var s = segs[k];
      if (!s) return;
      if (lineCol(s.id) === 'r') red++;
      else yellow = true;
    });
    if (!red) return false;
    if (!yellow || red >= 3) return true;
    return false;
  }
  /* 角点底色：
     旁边只有红线(无其他线) → redconnectpoint；
     旁边红线达 3 条及以上(任意类型、可混有其他线) → redconnectpoint；
     其余有线的角点 → connectpoint；无线 → darkconnectpoint */
  function dotBaseKey(x, y) {
    if (!hasPlacedIncident(x, y)) return 'dotDark';
    return isRedVertex(x, y) ? 'dotRed' : 'dotConnect';
  }

  /* 若某特殊点四周已无放置的线，则自动删除该点 */
  function sweepOrphanPoints() {
    if (!stage) return false;
    var changed = false;
    Object.keys(vertices).forEach(function (vk) {
      var xy = vk.split(',');
      var x = parseInt(xy[0], 10), y = parseInt(xy[1], 10);
      if (hasPlacedIncident(x, y)) return;
      var v = vertices[vk];
      var any = false;
      if (v.portal) { portalCount[v.portal]--; delete v.portal; any = true; }
      if (v.start) { delete v.start; startCount = Math.max(0, startCount - 1); any = true; }
      if (v.end) { delete v.end; endCount = Math.max(0, endCount - 1); any = true; }
      if (any) { delete vertices[vk]; changed = true; }
    });
    return changed;
  }

  function clearStage() {
    segs = {}; vertices = {};
    portalCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
    startCount = 0; endCount = 0;
    stage = null;
  }

  function renderGrid() {
    gridCanvas.innerHTML = '';
    if (!stage) return;
    var w = stage.w, h = stage.h;
    var L = benchSize();
    var maxD = Math.max(w, h);
    e = maxD > 0 ? Math.min((0.7 * L) / maxD, 0.3 * L) : 0.3 * L;
    var k = e / (dotSize + lineLen);
    var dotW = dotSize * k;
    var lineW = lineLen * k;
    var lineH = lineThick * k;

    function img(key) {
      var im = document.createElement('img');
      if (images[key]) im.src = images[key].src; else im.src = TEX[key];
      im.draggable = false;
      return im;
    }

    /* 边线（暗线始终存在；放置的线覆盖显示） */
    for (var y = 0; y <= h; y++) {
      for (var x = 0; x <= w; x++) {
        var cx = x * e, cy = y * e;
        if (x < w) drawSeg('h', x, y, cx, cy, k, dotW, lineW, lineH, img);
        if (y < h) drawSeg('v', x, y, cx, cy, k, dotW, lineW, lineH, img);
      }
    }
    /* 角点：默认暗点；有已放置边线相邻 → connectpoint；再叠加点工具放置（叠加点放大 1.5x，如 portal:角点 = 16.5:3） */
    function ovW(key) { return dotW * natW(key) / 3 * 1.5 * 0.9; }
    var dotBig = (dotW + 1) * 1.5;   /* 基础角点为当前尺寸的 1.5 倍，盖住与线头的接缝 */
    for (var py = 0; py <= h; py++) {
      for (var px = 0; px <= w; px++) {
        var d = img(dotBaseKey(px, py));
        d.className = 'dot';
        d.style.width = dotBig + 'px';
        d.style.height = dotBig + 'px';
        d.style.left = (px * e) + 'px';
        d.style.top = (py * e) + 'px';
        gridCanvas.appendChild(d);
        var vk = vertexKey(px, py);
        var v = vertices[vk];
        var redAdj = isRedVertex(px, py);
        if (v && v.portal) {
          var pKey = (redAdj ? 'redp' : 'p') + v.portal;
          var p = img(pKey);
          p.className = 'dot portal';
          var ow = ovW(pKey);
          p.style.width = ow + 'px';
          p.style.height = ow + 'px';
          p.style.left = (px * e) + 'px';
          p.style.top = (py * e) + 'px';
          gridCanvas.appendChild(p);
        }
        var ovKey = (v && v.start && v.end) ? 'startEnd' : (v && v.start) ? 'start' : (v && v.end) ? 'end' : null;
        if (ovKey) {
          /* 起点/终点/起点+终点：未叠在传送门上时再放大 15%；独立终点额外 +10% */
          var boost = v.portal ? 1 : 1.15;
          if (ovKey === 'end') boost *= 1.1;
          var sKey = ovKey;
          if (redAdj) sKey = { start: 'redstart', end: 'redend', startEnd: 'redstartEnd' }[ovKey];
          var s = img(sKey);
          s.className = 'dot ' + ovKey;
          var ow2 = ovW(sKey) * boost;
          s.style.width = ow2 + 'px';
          s.style.height = ow2 + 'px';
          s.style.left = (px * e) + 'px';
          s.style.top = (py * e) + 'px';
          gridCanvas.appendChild(s);
        }
      }
    }
    gridCanvas.style.width = (w * e) + 'px';
    gridCanvas.style.height = (h * e) + 'px';
  }

  function drawSeg(dir, x, y, cx, cy, k, dotW, lineW, lineH, img) {
    var st = segs[segKey(dir, x, y)];
    var vertical = dir === 'v';
    var key = 'lineDark';
    var orient = 'r';
    if (st) {
      var shape = lineShape(st.id);
      var col = lineCol(st.id);
      key = (col === 'r' ? 'r' : '') + shape;
      if (st.dir) orient = st.dir;
    }
    var im = img(key);
    im.className = 'line ' + (vertical ? 'vertical' : 'horizontal');
    /* 宽度统一为线长；高度按贴图原始宽高比（箭头 48x7、普通 48x3），不做压缩 */
    var imW = lineW;
    var imH = Math.round(lineW * natH(key) / natW(key));
    im.style.width = imW + 'px';
    im.style.height = imH + 'px';
    var flip = false;
    if (vertical) {
      if (orient === 'u') flip = true;
      im.style.left = cx + 'px';
      im.style.top = (cy + dotW / 2 + lineW / 2) + 'px';
      im.style.transform = 'translate(-50%, -50%) rotate(90deg)' + (flip ? ' scaleX(-1)' : '');
    } else {
      if (orient === 'l') flip = true;
      im.style.left = (cx + dotW / 2 + lineW / 2) + 'px';
      im.style.top = cy + 'px';
      im.style.transform = 'translate(-50%, -50%)' + (flip ? ' scaleX(-1)' : '');
    }
    gridCanvas.appendChild(im);
  }

  /* ---------- 交互 ---------- */
  function gridPointFromEvent(ev) {
    var vr = gridView.getBoundingClientRect();
    return { x: ev.clientX - vr.left, y: ev.clientY - vr.top };
  }
  function nearestSegment(p) {
    if (!stage) return null;
    var best = null, bd = Infinity;
    var w = stage.w, h = stage.h;
    var thr = Math.max(12, e * 0.5);
    for (var y = 0; y <= h; y++) {
      for (var x = 0; x <= w; x++) {
        if (x < w) {
          var x0 = x * e, x1 = (x + 1) * e, yy = y * e;
          var dx = clamp(p.x, x0, x1) - p.x;
          var dy = clamp(p.y, yy, yy) - p.y;
          var d = Math.hypot(dx, dy);
          if (d < bd) { bd = d; best = { dir: 'h', x: x, y: y }; }
        }
        if (y < h) {
          var xx = x * e, y0 = y * e, y1 = (y + 1) * e;
          var dx2 = clamp(p.x, xx, xx) - p.x;
          var dy2 = clamp(p.y, y0, y1) - p.y;
          var d2 = Math.hypot(dx2, dy2);
          if (d2 < bd) { bd = d2; best = { dir: 'v', x: x, y: y }; }
        }
      }
    }
    if (bd <= thr) return best;
    return null;
  }
  function nearestVertex(p) {
    if (!stage) return null;
    var best = null, bd = Infinity;
    var thr = Math.max(10, e * 0.45);
    for (var y = 0; y <= stage.h; y++) {
      for (var x = 0; x <= stage.w; x++) {
        var d = Math.hypot(p.x - x * e, p.y - y * e);
        if (d < bd) { bd = d; best = { x: x, y: y }; }
      }
    }
    if (bd <= thr) return best;
    return null;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function handleGridDown(ev) {
    if (!stage) return;
    var p = gridPointFromEvent(ev);
    if (ev.button === 2) {
      /* 右键删除 */
      if (toolKind === 'line') {
        var seg = nearestSegment(p);
        if (seg) {
          var k = segKey(seg.dir, seg.x, seg.y);
          if (segs[k]) {
            withHistory(function () {
              delete segs[k];
              sweepOrphanPoints();
              renderGrid();
              renderToolBar();
            });
          }
        }
      } else if (toolKind === 'point') {
        var vt = nearestVertex(p);
        if (vt) {
          withHistory(function () {
            var vk = vertexKey(vt.x, vt.y);
            var v = vertices[vk];
            if (!v) return;
            var done = false;
            if (toolId === 'start' && v.start) { delete v.start; startCount = Math.max(0, startCount - 1); done = true; }
            else if (toolId === 'end' && v.end) { delete v.end; endCount = Math.max(0, endCount - 1); done = true; }
            else if (toolId === 'portal' && v.portal) {
              /* portal 工具下可删除任意编号的传送门；图标自动跳回最早空缺的编号 */
              portalCount[v.portal]--;
              delete v.portal;
              done = true;
            }
            if (done) {
              if (!Object.keys(v).length) delete vertices[vk];
              renderGrid();
              renderToolBar();
            }
          });
        }
      }
      return;
    }
    if (toolKind === 'line') {
      var seg2 = nearestSegment(p);
      if (seg2) withHistory(function () { placeLine(seg2.dir, seg2.x, seg2.y); });
    } else if (toolKind === 'point') {
      var vt2 = nearestVertex(p);
      if (vt2) withHistory(function () { placePoint(vt2.x, vt2.y); });
    }
  }

  function placeLine(dir, x, y) {
    var k = segKey(dir, x, y);
    var cur = segs[k];
    var shape = lineShape(toolId);
    if (isArrowShape(shape) && cur) {
      var curShape = lineShape(cur.id);
      if (curShape === shape) {
        if (lineCol(cur.id) !== lineCol(toolId)) {
          /* 同形状不同颜色：重新上色并保持方向 */
          cur.id = toolId;
        } else {
          /* 已有同款箭头线：点击转换方向（横 l<=>r；竖 u<=>d） */
          var od = cur.dir || (dir === 'h' ? 'r' : 'd');
          cur.dir = dir === 'h' ? (od === 'r' ? 'l' : 'r') : (od === 'd' ? 'u' : 'd');
        }
      } else {
        var st = { id: toolId };
        st.dir = dir === 'h' ? 'r' : 'd';
        segs[k] = st;
      }
    } else if (cur) {
      var st2 = { id: toolId };
      if (isArrowShape(shape)) st2.dir = dir === 'h' ? 'r' : 'd';
      segs[k] = st2;
    } else {
      var st3 = { id: toolId };
      if (isArrowShape(shape)) st3.dir = dir === 'h' ? 'r' : 'd';
      segs[k] = st3;
    }
    renderGrid();
  }

  function placePoint(x, y) {
    var vk = vertexKey(x, y);
    var v = vertices[vk] || (vertices[vk] = {});
    if (!hasPlacedIncident(x, y)) {
      if (!Object.keys(v).length) delete vertices[vk];
      toast('空点不能放置特殊点：该角点周围还没有放置的线');
      return;
    }
    if (toolId === 'start') {
      if (startCount >= 1) { toast('起始点只能放置 1 个'); return; }
      if (v.start) return;
      v.start = true; startCount++;
    } else if (toolId === 'end') {
      if (endCount >= 1) { toast('终点只能放置 1 个'); return; }
      if (v.end) return;
      v.end = true; endCount++;
    } else {
      if (v.portal) { toast('传送门之间不能重叠'); return; }
      if (portalFull()) { toast('传送门已放满（1-4 级各 2 个），不能再放置'); return; }
      var level = currentPortalStage();
      v.portal = level;
      portalCount[level]++;
      renderToolBar();
    }
    renderGrid();
  }

  /* ---------- 保存 / 导入 ---------- */
  /* 线种类编码（参见关卡文件格式） */
  var KIND_LU = { a: 4, ra: 5, ta: 8, rta: 9 };    /* 横线=左 / 竖线=上 */
  var KIND_RD = { a: 6, ra: 7, ta: 10, rta: 11 };  /* 横线=右 / 竖线=下 */
  var KIND_PLAIN = { n: 0, t: 1, rn: 2, rt: 3 };
  function lineCode(st, vertical) {
    var id = st.id;
    if (KIND_PLAIN[id] !== undefined) return KIND_PLAIN[id];
    var shape = lineShape(id);
    var col = lineCol(id);
    var key = (col === 'r' ? 'r' : '') + shape;
    var dir = st.dir || (vertical ? 'd' : 'r');
    var isLU = vertical ? (dir === 'u') : (dir === 'l');
    return (isLU ? KIND_LU[key] : KIND_RD[key]);
  }
  function segFromCode(code, vertical) {
    var id, dir;
    if (code >= 0 && code <= 3) {
      var plain = ['n', 't', 'rn', 'rt'][code];
      id = plain;
    } else {
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

  function scanVertexCounts() {
    startCount = 0; endCount = 0;
    portalCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
    Object.keys(vertices).forEach(function (vk) {
      var v = vertices[vk];
      if (v.start) startCount++;
      if (v.end) endCount++;
      if (v.portal) portalCount[v.portal]++;
    });
  }

  /* ==================== 关卡集 ==================== */
  var levelSet = null;       // null=尚未创建；否则为关卡对象数组（顺序即关卡顺序）
  var selLevel = null;       // 关卡集弹窗中选中的关卡
  var selLevels = [];          // 多选模式下的关卡下标
  var multiSel = false;        // 多选模式
  var rangeAnchor = -1;        // Shift 区间起点
  var currentItem = null;    // 当前正在编辑的关卡（live maps 与其对应）

  function liveLines() {
    var lines = [];
    Object.keys(segs).forEach(function (k) {
      var parts = k.split('/');
      var vertical = parts[0] === 'v';
      lines.push([parseInt(parts[1], 10), parseInt(parts[2], 10), vertical ? 1 : 0, lineCode(segs[k], vertical)]);
    });
    lines.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
    return lines;
  }
  function livePoints() {
    var points = [];
    Object.keys(vertices).forEach(function (vk) {
      var xy = vk.split(',');
      var x = parseInt(xy[0], 10), y = parseInt(xy[1], 10);
      var v = vertices[vk];
      /* 每个点单独存储：终点 1；传送门 portal1=-1 … portal4=-4；起点 0 */
      if (v.portal) points.push([x, y, -v.portal]);
      if (v.end) points.push([x, y, 1]);
      if (v.start) points.push([x, y, 0]);
    });
    points.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return points;
  }
  /* 把 live 网格写回关卡对象（不校验） */
  function persistLiveTo(item) {
    if (item && currentItem === item && stage) {
      item.width = stage.w;
      item.height = stage.h;
      item.lines = liveLines();
      item.points = livePoints();
      if (!item.tasks) item.tasks = [];
      if (!item.name) item.name = 'level';
    }
  }
  /* 将关卡对象解码到 live 网格 */
  function decodeItem(item) {
    clearStage();
    stage = { w: item.width, h: item.height };
    if (Array.isArray(item.lines)) {
      item.lines.forEach(function (it) {
        if (!Array.isArray(it) || it.length < 4) return;
        var x = parseInt(it[0], 10), y = parseInt(it[1], 10), vertical = it[2] === 1;
        if (vertical ? (y >= stage.h) : (x >= stage.w)) return;
        if (x < 0 || y < 0 || x > stage.w || y > stage.h) return;
        var seg = segFromCode(parseInt(it[3], 10), vertical);
        if (seg) segs[segKey(vertical ? 'v' : 'h', x, y)] = seg;
      });
    }
    if (Array.isArray(item.points)) {
      item.points.forEach(function (it) {
        if (!Array.isArray(it) || it.length < 3) return;
        var x = parseInt(it[0], 10), y = parseInt(it[1], 10);
        var tp = parseInt(it[2], 10);
        if (x < 0 || y < 0 || x > stage.w || y > stage.h) return;
        var vk = vertexKey(x, y);
        var v = vertices[vk] || (vertices[vk] = {});
        if (tp === 0) v.start = true;
        else if (tp === 1) v.end = true;
        else if (tp === -1) v.portal = 1;
        else if (tp === -2) v.portal = 2;
        else if (tp === -3) v.portal = 3;
        else if (tp === -4 || tp === -5) v.portal = 4;
      });
    }
    scanVertexCounts();
    currentItem = item;
  }
  function refreshSetBtn() {
    var b = $('btn-set');
    if (b) b.textContent = levelSet === null ? '创建关卡集' : '管理关卡集';
    var c = $('btn-settings-clear');
    if (c) c.disabled = levelSet === null;
    updateHistBtns();
  }
  function showEmptyCanvas() {
    currentItem = null;
    stage = null;
    segs = {}; vertices = {};
    portalCount = { 1: 0, 2: 0, 3: 0, 4: 0 };
    startCount = 0; endCount = 0;
    gridView.classList.add('hidden');
    if (levelSet) {
      emptyTip.classList.remove('hidden');
      emptyTip.textContent = '制作台为空';
    } else {
      emptyTip.classList.add('hidden');
      emptyTip.textContent = '';
    }
    resetHistory();
    renderToolBar();
    refreshLevelName();
  }
  function nextLevelName() {
    var max = 0;
    (levelSet || []).forEach(function (it) {
      var m = /^level-(\d+)$/.exec(it.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'level-' + (max + 1);
  }

  /* 弹窗确认（ask-modal） */
  var askFn = null;
  function askConfirm(title, text, fn) {
    $('ask-title').textContent = title || '确认';
    $('ask-text').textContent = text || '';
    askFn = fn;
    showModal($('ask-modal'));
  }
  $('ask-no').addEventListener('click', function () { askFn = null; hideModal($('ask-modal')); });
  $('ask-yes').addEventListener('click', function () {
    var fn = askFn;
    askFn = null;
    hideModal($('ask-modal'));
    if (fn) fn();
  });

  /* 关卡集管理弹窗（选房界面风格） */
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
  var updateSetScroll = null, updateTaskScroll = null;

  function renderSetList() {
    var list = $('set-list');
    var empty = $('set-empty');
    list.innerHTML = '';
    empty.style.display = levelSet && levelSet.length ? 'none' : '';
    var arr = levelSet || [];
    var idxSel = selLevel ? arr.indexOf(selLevel) : -1;
    var inMulti = function (i) { return selLevels.indexOf(i) >= 0; };
    $('set-del').disabled = idxSel < 0;
    $('set-open').disabled = multiSel || idxSel < 0;
    arr.forEach(function (it, i) {
      var row = document.createElement('div');
      var singleSel = it === selLevel;
      var isSel = multiSel ? inMulti(i) : singleSel;
      row.className = 'room-btn open set-row' + (isSel ? ' sel' : '');
      var bar = document.createElement('span');
      bar.className = 'room-bar';
      row.appendChild(bar);
      var nameEl = document.createElement('span');
      nameEl.className = 'room-host set-row-name';
      nameEl.textContent = it.name || 'level';
      var sizeEl = document.createElement('span');
      sizeEl.className = 'room-rules set-row-size';
      sizeEl.textContent = it.width + 'x' + it.height;
      ensureSolvedFlag(it);
      if (it._solved) {
        var mark = document.createElement('span');
        mark.className = 'solved-mark';
        mark.textContent = ' | 已求解';
        sizeEl.appendChild(mark);
      }
      row.appendChild(nameEl);
      row.appendChild(sizeEl);
      row.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!multiSel && it === selLevel && ev.target === nameEl) { beginRename(it, nameEl); return; }
        if (ev.shiftKey) {
          /* Shift：选中上次锚点到当前点击之间（含两端）的所有关卡 */
          if (!multiSel) { multiSel = true; selLevel = null; selLevels = []; }
          var anchor = rangeAnchor >= 0 ? rangeAnchor : i;
          var lo = Math.min(anchor, i), hi = Math.max(anchor, i);
          selLevels = [];
          for (var r = lo; r <= hi; r++) selLevels.push(r);
          renderSetList();
          return;
        }
        if (ev.ctrlKey) {
          /* Ctrl：追加/取消多选 */
          if (!multiSel) { multiSel = true; selLevel = null; selLevels = []; }
          var pos = selLevels.indexOf(i);
          if (pos >= 0) selLevels.splice(pos, 1);
          else selLevels.push(i);
          if (!selLevels.length) multiSel = false;
          rangeAnchor = i;
          renderSetList();
          return;
        }
        if (multiSel) {
          var pos2 = selLevels.indexOf(i);
          if (pos2 >= 0) selLevels.splice(pos2, 1);
          else selLevels.push(i);
          if (!selLevels.length) multiSel = false;
          rangeAnchor = i;
          renderSetList();
          return;
        }
        if (it === selLevel) return;
        selLevel = it;
        selLevels = [];
        rangeAnchor = i;
        renderSetList();
      });
      row.addEventListener('dblclick', function () {
        if (multiSel) return;   /* 多选模式下双击不打开 */
        if (!levelSet || levelSet.indexOf(it) < 0) return;
        selLevel = it;
        openSelectedLevel();
      });
      if (!multiSel && it === selLevel) {
        var arrows = document.createElement('div');
        arrows.className = 'room-arrows';
        function mkArr(cls, disabled, delta) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'room-arrow-btn ' + cls;
          b.disabled = disabled;
          var im = document.createElement('img');
          im.src = 'turnleft-texture/rightarrow.png';
          im.alt = '';
          b.appendChild(im);
          b.addEventListener('click', function (ev) { ev.stopPropagation(); moveLevel(it, delta); });
          return b;
        }
        arrows.appendChild(mkArr('up', i === 0, -1));
        arrows.appendChild(mkArr('down', i === arr.length - 1, 1));
        row.appendChild(arrows);
      }
      list.appendChild(row);
    });
    updateSetHeader();
    if (updateSetScroll) updateSetScroll();
  }
  function updateSetHeader() {
    var del = $('set-del'), mu = $('set-multi');
    if (!del || !mu) return;
    if (multiSel) {
      del.classList.remove('hidden');
      del.disabled = !selLevels.length;
      mu.classList.add('hidden');
      return;
    }
    del.classList.toggle('hidden', !selLevel);
    del.disabled = !selLevel;
    mu.classList.toggle('hidden', !!selLevel);
  }
  function beginRename(it, nameEl) {
    var inp = document.createElement('input');
    inp.className = 'set-name-input';
    inp.value = it.name || '';
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') { inp.blur(); }
      else if (e.key === 'Escape') { nameEl.textContent = it.name || ''; inp.remove(); renderSetList(); }
    });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    nameEl.textContent = '';
    nameEl.appendChild(inp);
    inp.focus();
    inp.select();
    inp.addEventListener('blur', function () {
      var v = inp.value.trim();
      var dup = v && (levelSet || []).some(function (o) { return o !== it && o.name === v; });
      if (dup) { toast('关卡名称已存在，不能重名'); }
      else if (v) { it.name = v; wsMark(); }
      renderSetList();
    });
  }
  function moveLevel(it, delta) {
    if (!levelSet) return;
    var i = levelSet.indexOf(it);
    var j = i + delta;
    if (i < 0 || j < 0 || j >= levelSet.length) return;
    levelSet.splice(i, 1);
    levelSet.splice(j, 0, it);
    wsMark();
    renderSetList();
    updateHistBtns();
  }
  function openSetManager() {
    if (levelSet === null) levelSet = [];
    multiSel = false;
    selLevels = [];
    if (currentItem && levelSet.indexOf(currentItem) < 0) currentItem = null;
    if (selLevel && (!levelSet.length || levelSet.indexOf(selLevel) < 0)) selLevel = levelSet.length ? levelSet[0] : null;
    renderSetList();
    refreshSetBtn();
    showModal($('set-modal'));
    updateHistBtns();
    setTimeout(function () { if (updateSetScroll) updateSetScroll(); }, 30);
  }
  function addNewLevel() {
    if (!levelSet) levelSet = [];
    $('new-w').value = 3;
    $('new-h').value = 3;
    showModal($('new-modal'));
  }
  $('btn-new-cancel').addEventListener('click', function () { hideModal($('new-modal')); });
  $('btn-new-ok').addEventListener('click', function () {
    var w = parseInt($('new-w').value, 10);
    var h = parseInt($('new-h').value, 10);
    if (isNaN(w) || isNaN(h) || w < 0 || h < 0) { toast('宽和高需为不小于 0 的整数'); return; }
    if (w === 0 && h === 0) { toast('宽和高不能同时为 0'); return; }
    if (!levelSet) levelSet = [];
    var item = { name: nextLevelName(), width: w, height: h, minstep: 0, lines: [], points: [], tasks: [] };
    ensureSolvedFlag(item);
    levelSet.push(item);
    selLevel = item;
    wsMark();
    hideModal($('new-modal'));
    renderSetList();
  });
  function openSelectedLevel() {
    if (!selLevel || !levelSet || levelSet.indexOf(selLevel) < 0) return;
    persistLiveTo(currentItem);
    hideModal($('set-modal'));
    decodeItem(selLevel);
    emptyTip.classList.add('hidden');
    gridView.classList.remove('hidden');
    resetHistory();
    renderToolBar();
    renderGrid();
    updateHistBtns();
    refreshLevelName();
  }
  /* 快速切换编辑中的关卡 */
  function switchToIndex(i) {
    if (!levelSet || !levelSet.length) return;
    if (i < 0 || i >= levelSet.length) return;
    persistLiveTo(currentItem);
    var it = levelSet[i];
    decodeItem(it);
    emptyTip.classList.add('hidden');
    gridView.classList.remove('hidden');
    resetHistory();
    renderToolBar();
    renderGrid();
    updateHistBtns();
    refreshLevelName();
  }
  function deleteSelectedLevel() {
    if (multiSel) {
      if (!selLevels.length || !levelSet) return;
      var n = selLevels.length;
      askConfirm('删除关卡', '确定删除选中的 ' + n + ' 个关卡吗？', function () {
        var idxs = selLevels.slice().sort(function (a, b) { return b - a; });
        idxs.forEach(function (idx) {
          var it = levelSet[idx];
          if (currentItem === it) showEmptyCanvas();
          levelSet.splice(idx, 1);
        });
        selLevels = [];
        multiSel = false;
        rangeAnchor = -1;
        rangeAnchor = -1;
        wsMark();
        renderSetList();
        updateHistBtns();
      });
      return;
    }
    if (!selLevel || !levelSet) return;
    var it = selLevel;
    askConfirm('删除关卡', '确定删除关卡「' + (it.name || 'level') + '」吗？', function () {
      var i = levelSet.indexOf(it);
      if (i >= 0) levelSet.splice(i, 1);
      selLevel = null;
      rangeAnchor = -1;
      wsMark();
      if (currentItem === it) showEmptyCanvas();
      renderSetList();
      updateHistBtns();
    });
  }
  function deleteWorkshopSet() {
    if (!levelSet) { toast('请先创建关卡集'); return; }
    askConfirm('删除关卡集', '确定删除当前关卡集「' + (wsCtx ? wsCtx.fileName : '未命名') + '」并返回工坊吗？', function () {
      if (wsCtx) {
        try {
          var arr = JSON.parse(localStorage.getItem('tlWorkshopFolder') || '[]');
          localStorage.setItem('tlWorkshopFolder', JSON.stringify(arr.filter(function (e) { return e.name !== wsCtx.fileName; })));
        } catch (e) {}
      }
      wsGoBack();
    });
  }
  function clearLevelSet() {
    askConfirm('清空关卡集', '确定清空整个关卡集吗？所有关卡都会被删除，且无法撤销。', function () {
      levelSet = null;
      selLevel = null;
      showEmptyCanvas();
      refreshSetBtn();
    });
  }

  /* 关卡集保存校验（写入文件前的约束检查） */
  function validateItemRaw(it) {
    var start = 0, end = 0;
    var pc = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var endPos = null;
    var ok = true;
    (it.points || []).forEach(function (p) {
      var x = parseInt(p[0], 10), y = parseInt(p[1], 10), tp = parseInt(p[2], 10);
      var pos = x + ',' + y;
      if (tp === 0) start++;
      else if (tp === 1) { end++; endPos = pos; }
      else if (tp === -1) pc[1]++;
      else if (tp === -2) pc[2]++;
      else if (tp === -3) pc[3]++;
      else if (tp === -4 || tp === -5) pc[4]++;
    });
    if (start !== 1) ok = false;
    if (end !== 1) ok = false;
    if (ok) {
      for (var l = 1; l <= 4; l++) if (pc[l] !== 0 && pc[l] !== 2) ok = false;
    }
    if (!ok) return (it.name || 'level') + ': 缺少起点/终点，或传送门未成对出现';
    return null;
  }

  function sanitizeName(n) {
    n = (n || '').trim().replace(/[\\/:*?"<>|]+/g, '').trim();
    return n || 'levels';
  }

  /* ===== 工坊上下文（cmchess 集成版）===== */
  var wsCtx = null;            // { fileName }：编辑已有关卡集文件时非空
  var wsDirty = false;
  var wsDirHandle = null;      // 上次工坊打开的目录句柄（FS API + IndexedDB）
  var bypassUnload = false;    // 主动跳转时跳过离开提示
  var wsSavedSnap = '';
  function wsSnapNow() {
    try { return JSON.stringify(levelSet === null ? null : levelSet); } catch (e) { return ''; }
  }
  function wsMark() { wsDirty = true; }
  function wsMarkClean() { wsDirty = false; wsSavedSnap = wsSnapNow(); }
  function wsHasChanges() {
    /* 数据快照对比为准，避免残留脏标记造成误报 */
    return wsSavedSnap !== wsSnapNow();
  }
  function wsGoBack() {
    bypassUnload = true;
    try {
      localStorage.setItem('tlOpenWorkshop', '1');
      /* 从制作器退出：返回关卡集管理时应处于“编辑模式” */
      localStorage.setItem('tlOpenWorkshopEdit', '1');
    } catch (e) {}
    location.href = 'index.html';
  }
  function syncFolderCache(fname, data) {
    try {
      var arr = JSON.parse(localStorage.getItem('tlWorkshopFolder') || '[]');
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].name === fname) {
          arr[i].raw = data;
          try { arr[i].count = (JSON.parse(data).length); } catch (e) {}
          break;
        }
      }
      localStorage.setItem('tlWorkshopFolder', JSON.stringify(arr));
    } catch (e) {}
  }
  function downloadJson(fname, data, note) {
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fname + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    if (note) toast(note + '：' + fname + '.json');
  }
  function fsWriteFile(suggested, data) {
    var opts = {
      suggestedName: suggested,
      types: [{ description: 'Turn-Left 关卡集文件', accept: { 'application/json': ['.json'] } }]
    };
    if (wsDirHandle) opts.startIn = wsDirHandle;
    return window.showSaveFilePicker(opts).then(function (handle) {
      return handle.createWritable().then(function (w) { return w.write(data).then(function () { return w.close(); }); });
    });
  }
  /* IndexedDB：读取工坊保存的目录句柄 */
  function idbGetDirHandle() {
    return new Promise(function (resolve) {
      try {
        if (!window.indexedDB) return resolve(null);
        var req = indexedDB.open('tl-dir-db', 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('dirs')) db.createObjectStore('dirs');
        };
        req.onsuccess = function () {
          try {
            var db = req.result;
            if (!db.objectStoreNames.contains('dirs')) { resolve(null); return; }
            var tx = db.transaction('dirs', 'readonly');
            var g = tx.objectStore('dirs').get('workshop');
            g.onsuccess = function () { resolve(g.result || null); };
            g.onerror = function () { resolve(null); };
            tx.onerror = function () { resolve(null); };
          } catch (e) { resolve(null); }
        };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  }
  /* 校验当前关卡集并生成待写内容；失败返回 null */
  function buildSavePayload() {
    if (!levelSet) { toast('请先创建关卡集'); return null; }
    if (!levelSet.length) { toast('关卡集为空，无法保存'); return null; }
    persistLiveTo(currentItem);
    for (var s = 0; s < levelSet.length; s++) {
      ensureSolvedFlag(levelSet[s]);
      if (!levelSet[s]._solved) {
        toast('第 ' + (s + 1) + ' 关「' + (levelSet[s].name || 'level') + '」未求解，请先验证可解性');
        return null;
      }
    }
    for (var i = 0; i < levelSet.length; i++) {
      var err = validateItemRaw(levelSet[i]);
      if (err) { toast('第 ' + (i + 1) + ' 关无法保存：' + err); return null; }
    }
    var data = editorSettings.unordered
      ? JSON.stringify(['unordered'].concat(levelSet))
      : JSON.stringify(levelSet);
    return data;
  }
  function doSave(mode) {
    var data = buildSavePayload();
    if (!data) return;
    var inputName = $('save-name').value;
    if (mode === 'primary') {
      /* 覆盖原文件（FS API 优先，不支持则同名下载兜底） */
      if (!wsCtx) { toast('当前不是已打开的文件'); return; }
      var fname = sanitizeName(wsCtx.fileName);
      hideModal($('save-modal'));
      if (!window.showSaveFilePicker) {
        downloadJson(fname, data, '浏览器不支持直接覆盖，已下载同名文件');
        syncFolderCache(fname, data);
        wsMarkClean();
        return;
      }
      fsWriteFile(fname + '.json', data).then(function () {
        syncFolderCache(fname, data);
        wsMarkClean();
        toast('已保存：' + fname + '.json');
      }).catch(function (err) {
        if (!err || err.name === 'AbortError') return;
        downloadJson(fname, data, '保存失败，已下载同名文件');
        syncFolderCache(fname, data);
        wsMarkClean();
      });
      return;
    }
    /* 另存为 / 新建下载 */
    var fname2 = sanitizeName(inputName);
    hideModal($('save-modal'));
    if (mode === 'saveas') {
      if (!window.showSaveFilePicker) {
        downloadJson(fname2, data, '当前浏览器不支持「另存为」，已改用下载');
        wsMarkClean();
        return;
      }
      fsWriteFile(fname2 + '.json', data).then(function () {
        wsMarkClean();
        toast('已保存：' + fname2 + '.json');
      }).catch(function (err) {
        if (!err || err.name === 'AbortError') return;
        downloadJson(fname2, data, '另存为失败，已改用下载');
        wsMarkClean();
      });
      return;
    }
    downloadJson(fname2, data, '已保存');
    wsMarkClean();
  }

  function importSet(list, silent) {
    if (Array.isArray(list) && list.length && typeof list[0] === 'string') {
      /* “unordered” 标记：数组首元素为字符串 */
      if (list[0] === 'unordered') {
        editorSettings.unordered = true;
        saveSettings();
      }
      list = list.filter(function (x) { return x && typeof x === 'object'; });
    }
    if (!Array.isArray(list) || !list.length) { toast('导入失败：关卡集为空或格式不正确'); return false; }
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it !== 'object') { toast('导入失败：第 ' + (i + 1) + ' 个关卡数据无效'); return false; }
      var w = parseInt(it.width, 10), h = parseInt(it.height, 10);
      if (isNaN(w) || isNaN(h) || w < 0 || h < 0 || (w === 0 && h === 0)) { toast('导入失败：第 ' + (i + 1) + ' 个关卡宽高无效'); return false; }
      it.width = w; it.height = h;
      if (!Array.isArray(it.lines)) it.lines = [];
      if (!Array.isArray(it.points)) it.points = [];
      if (!Array.isArray(it.tasks)) it.tasks = [];
      else it.tasks = it.tasks.map(function (c) { return Array.isArray(c) ? c : [c]; });
      if (!it.name || typeof it.name !== 'string') it.name = 'level-' + (i + 1);
      if (it.minstep === undefined) it.minstep = 0;
    }
    /* 关卡名去重（重复的追加序号） */
    var used = {};
    list.forEach(function (it) {
      var base = it.name || 'level';
      if (!used[base]) { used[base] = true; return; }
      var n = 2;
      while (used[base + '-' + n]) n++;
      it.name = base + '-' + n;
      used[it.name] = true;
    });
    list.forEach(function (it) {
      it.minstep = 0;
      ensureSolvedFlag(it);
    });
    levelSet = list;
    selLevel = null;
    showEmptyCanvas();
    refreshSetBtn();
    renderSetList();
    if (!silent) toast('导入成功：共 ' + levelSet.length + ' 关');
    return true;
  }

  function openSaveModal() {
    if (!levelSet) { toast('请先创建关卡集'); return; }
    $('save-name').value = wsCtx ? sanitizeName(wsCtx.fileName) : '';
    $('save-name').disabled = !!wsCtx;
    var primary = $('btn-save-primary');
    primary.textContent = wsCtx ? '保存' : '下载';
    primary.disabled = false;
    showModal($('save-modal'));
    if (!wsCtx) $('save-name').focus();
  }

  /* ---------- 按钮 ---------- */
  $('btn-set').addEventListener('click', openSetManager);
  $('btn-prev').addEventListener('click', function () {
    if (!levelSet || !currentItem) return;
    switchToIndex(levelSet.indexOf(currentItem) - 1);
  });
  $('btn-next').addEventListener('click', function () {
    if (!levelSet || !currentItem) return;
    switchToIndex(levelSet.indexOf(currentItem) + 1);
  });
  $('set-back').addEventListener('click', function () { hideModal($('set-modal')); });
  $('set-del').addEventListener('click', deleteSelectedLevel);
  $('set-multi').addEventListener('click', function () {
    multiSel = true;
    selLevel = null;
    selLevels = [];
    rangeAnchor = -1;
    renderSetList();
  });
  $('set-add').addEventListener('click', addNewLevel);
  $('set-open').addEventListener('click', openSelectedLevel);
  $('set-lobby').addEventListener('click', function (ev) {
    /* 点击页面任意空白处取消选择（不落在行/按钮/输入框上即视为空白） */
    var t = ev.target;
    if (t && (t.closest('.set-row') || t.closest('.btn') || t.closest('.profile-btn') || t.closest('.start-join-btn') || t.tagName === 'INPUT')) return;
    if (multiSel) { selLevels = []; multiSel = false; rangeAnchor = -1; }
    else if (selLevel) selLevel = null;
    renderSetList();
  });
  $('set-modal').addEventListener('click', function (ev) {
    if (ev.target !== $('set-modal')) return;
    if (multiSel) { selLevels = []; multiSel = false; rangeAnchor = -1; }
    else if (selLevel) selLevel = null;
    renderSetList();
  });
  $('btn-save').addEventListener('click', openSaveModal);
  $('btn-save-back').addEventListener('click', function () { hideModal($('save-modal')); });
  $('btn-save-primary').addEventListener('click', function () {
    if (wsCtx) doSave('primary'); else doSave('download');
  });
  $('btn-save-as').addEventListener('click', function () { doSave('saveas'); });
  $('btn-back-ws').addEventListener('click', function () {
    function go() { wsGoBack(); }
    if (wsHasChanges()) {
      askConfirm('放弃更改', '对关卡做出了更改且尚未保存，确定放弃并返回工坊吗？', go);
    } else go();
  });
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', function () { hideModal($('settings-modal')); });
  $('btn-settings-clear').addEventListener('click', deleteWorkshopSet);
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-clear').addEventListener('click', clearAll);

  /* 滑杆事件 */
  $('bench-scale').addEventListener('input', function () {
    editorSettings.benchScale = parseInt(this.value, 10);
    $('bench-scale-label').textContent = this.value + '%';
    saveSettings(); applyEditorLayout(); if (stage) renderGrid(); styleSlider();
  });
  $('panel-scale').addEventListener('input', function () {
    editorSettings.panelScale = parseInt(this.value, 10);
    $('panel-scale-label').textContent = this.value + '%';
    saveSettings(); applyEditorLayout(); styleSlider();
  });
  $('opt-show-name').addEventListener('click', function () {
    editorSettings.showLevelName = !editorSettings.showLevelName;
    saveSettings();
    var on = editorSettings.showLevelName;
    var im = this.querySelector('img');
    if (im) im.src = 'turnleft-texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
    this.setAttribute('data-on', on ? '1' : '0');
    refreshLevelName();
  });

  /* 交互 */
  workbench.addEventListener('pointerdown', handleGridDown);
  workbench.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  workbench.addEventListener('selectstart', function (e) { e.preventDefault(); });
  workbench.addEventListener('dragstart', function (e) { e.preventDefault(); });
  $('toolbar').addEventListener('selectstart', function (e) { e.preventDefault(); });
  $('toolbar').addEventListener('dragstart', function (e) { e.preventDefault(); });
  workbench.addEventListener('dblclick', function (e) { e.preventDefault(); });

  /* 快捷键：Ctrl+S 保存；1-8 切换线工具；Ctrl+1-3 切换点工具（传送门/起点/终点） */
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      openSaveModal();
      return;
    }
    /* Ctrl+Space：测试关卡 */
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar')) {
      e.preventDefault();
      if (stage) launchTest();
      return;
    }
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    /* 关卡集弹窗打开时：上下方向键移动选中关卡 */
    if (!$('set-modal').classList.contains('hidden')) {
      if (e.key === 'ArrowUp') { e.preventDefault(); if (selLevel) moveLevel(selLevel, -1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (selLevel) moveLevel(selLevel, 1); return; }
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); return; }
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); return; }
    }
    /* Ctrl+A / Ctrl+D：切换关卡 */
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === 'a' || e.key === 'A') { e.preventDefault(); if (levelSet && currentItem) switchToIndex(levelSet.indexOf(currentItem) - 1); return; }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); if (levelSet && currentItem) switchToIndex(levelSet.indexOf(currentItem) + 1); return; }
    }
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      clearAll();
      return;
    }
    if (e.metaKey || e.altKey) return;
    var d = e.key;
    if (d.length !== 1) return;
    var n = d.charCodeAt(0);
    if (n < 49 || n > 57) return;
    var idx = n - 49;
    if (e.ctrlKey) {
      if (idx < POINT_TOOLS.length) {
        e.preventDefault();
        selectTool('point', POINT_TOOLS[idx].id);
      }
    } else {
      if (idx < LINE_TOOLS.length) {
        e.preventDefault();
        selectTool('line', LINE_TOOLS[idx].id);
      }
    }
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { applyEditorLayout(); if (stage) renderGrid(); if (updateSetScroll) updateSetScroll(); if (updateTaskScroll) updateTaskScroll(); }, 120);
  });
  window.addEventListener('beforeunload', function (e) {
    if (bypassUnload) return;
    if (!wsHasChanges()) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  /* ==================== 可解性求解器（测试用） ==================== */
  var SV_DIR = [
    { dx: 1, dy: 0, c: 'E', zh: '右' },   // 右
    { dx: 0, dy: -1, c: 'N', zh: '上' },  // 上
    { dx: -1, dy: 0, c: 'W', zh: '左' },  // 左
    { dx: 0, dy: 1, c: 'S', zh: '下' }    // 下
  ];
  var SV_ARROW = { 0: 'r', 2: 'l', 3: 'd', 1: 'u' };   // dirIdx -> 线段内部方向

  function svEdgeKey(x, y, d) {
    var D = SV_DIR[d];
    if (D.dx !== 0) return 'h/' + Math.min(x, x + D.dx) + '/' + y;
    return 'v/' + x + '/' + Math.min(y, y + D.dy);
  }
  function svLineMeta(st) {
    if (!st) return null;
    var shape = lineShape(st.id);
    return {
      st: st,
      arrow: shape === 'a' || shape === 'ta',
      task: shape === 't' || shape === 'ta',
      red: lineCol(st.id) === 'r',
      dirOk: function (d) { return !(shape === 'a' || shape === 'ta') || st.dir === SV_ARROW[d]; }
    };
  }
  /* 纯求解器：基于当前全局网格（segs/vertices/stage）判断可解并返回最短步数 */
  function solveLevel() {
    if (!stage) return { ok: false, dist: 0 };
    /* 收集任务线 / 红线 / 传送门对 */
    var taskKeys = [], redKeys = [];
    Object.keys(segs).forEach(function (k) {
      var m = svLineMeta(segs[k]);
      if (!m) return;
      if (m.task) taskKeys.push(k);
      if (m.red) redKeys.push(k);
    });
    taskKeys.sort();
    redKeys.sort();
    var taskBit = {}, redBit = {};
    taskKeys.forEach(function (k, i) { taskBit[k] = 1 << i; });
    redKeys.forEach(function (k, i) { redBit[k] = 1 << i; });
    var fullTasks = taskKeys.length ? (1 << taskKeys.length) - 1 : 0;
    var portalPair = {};
    for (var lv = 1; lv <= 4; lv++) {
      var list = [];
      Object.keys(vertices).forEach(function (vk) {
        var v = vertices[vk];
        if (v && v.portal === lv) {
          var xy = vk.split(',');
          list.push([parseInt(xy[0], 10), parseInt(xy[1], 10)]);
        }
      });
      if (list.length === 2) {
        portalPair[list[0][0] + ',' + list[0][1]] = list[1];
        portalPair[list[1][0] + ',' + list[1][1]] = list[0];
      }
    }
    var start = null, end = null;
    Object.keys(vertices).forEach(function (vk) {
      var v = vertices[vk];
      if (v.start) start = vk;
      if (v.end) end = vk;
    });
    if (!start || !end) return { ok: false, dist: 0 };
    var sx = parseInt(start.split(',')[0], 10), sy = parseInt(start.split(',')[1], 10);

    function nodeKey(x, y, face, tasks, reds) {
      return x + ',' + y + '|' + face + '|' + tasks + '|' + reds;
    }
    var visited = {};
    var queue = [];
    var head = 0;
    var root = { x: sx, y: sy, face: -1, tasks: 0, reds: 0, dist: 0 };
    visited[nodeKey(sx, sy, -1, 0, 0)] = true;
    queue.push(root);
    var winDist = -1;

    while (head < queue.length) {
      var n = queue[head++];
      var tryDirs = n.face < 0 ? [0, 1, 2, 3] : [n.face, (n.face + 1) % 4];
      for (var ti = 0; ti < tryDirs.length; ti++) {
        var d = tryDirs[ti];
        var D = SV_DIR[d];
        var nx = n.x + D.dx, ny = n.y + D.dy;
        if (nx < 0 || ny < 0 || nx > stage.w || ny > stage.h) continue;
        var key = svEdgeKey(n.x, n.y, d);
        var meta = svLineMeta(segs[key]);
        if (!meta) continue;
        if (meta.arrow && !meta.dirOk(d)) continue;
        if (meta.red && (n.reds & redBit[key])) continue;
        var tasks2 = n.tasks, reds2 = n.reds;
        if (meta.task) tasks2 |= taskBit[key];
        if (meta.red) reds2 |= redBit[key];
        var fx = nx, fy = ny, won = false;
        var doneAll = tasks2 === fullTasks;
        var v = vertices[nx + ',' + ny];
        if (v && v.end && doneAll) {
          won = true;
        } else if (v && v.portal) {
          var partner = portalPair[nx + ',' + ny];
          if (partner) {
            fx = partner[0]; fy = partner[1];
            var fv = vertices[fx + ',' + fy];
            if (fv && fv.end && tasks2 === fullTasks) won = true;
          }
        }
        var ckey = nodeKey(fx, fy, d, tasks2, reds2);
        if (won) { winDist = n.dist + 1; break; }
        if (visited[ckey]) continue;
        visited[ckey] = true;
        queue.push({ x: fx, y: fy, face: d, tasks: tasks2, reds: reds2, dist: n.dist + 1 });
      }
      if (winDist >= 0) break;
    }
    return { ok: winDist >= 0, dist: winDist >= 0 ? winDist : 0 };
  }

  /* 批量验证：只验证关卡集中未求解的关卡，标记结果并写入 minstep */
  function batchVerify() {
    if (!levelSet || !levelSet.length) { toast('请先创建关卡集'); return; }
    var cur = currentItem;
    var curStage = stage;
    var savedSegs = JSON.stringify(segs);
    var savedVerts = JSON.stringify(vertices);
    persistLiveTo(currentItem);
    var verified = 0, solvable = 0, unsolvable = 0;
    levelSet.forEach(function (it) {
      ensureSolvedFlag(it);
      if (it._solved) return;
      verified++;
      decodeItem(it);
      var r = solveLevel();
      it.minstep = r.ok ? r.dist : 0;
      it._solved = r.ok;
      if (r.ok) solvable++; else unsolvable++;
    });
    /* 恢复用户当前编辑现场 */
    segs = savedSegs ? JSON.parse(savedSegs) : {};
    vertices = savedVerts ? JSON.parse(savedVerts) : {};
    stage = curStage;
    currentItem = cur;
    if (currentItem) { scanVertexCounts(); renderToolBar(); renderGrid(); }
    if (!verified) {
      toast('所有关卡均已验证，无需重复验证');
      return;
    }
    wsMark();
    $('batch-msg').innerHTML = '本次验证 ' + verified + ' 关<br>可解 ' + solvable + ' 关<br>无解 ' + unsolvable + ' 关';
    showModal($('batch-modal'));
    updateHistBtns();
    if (!document.getElementById('set-modal').classList.contains('hidden')) renderSetList();
  }
  $('btn-batch').addEventListener('click', batchVerify);
  $('btn-batch-back').addEventListener('click', function () { hideModal($('batch-modal')); });

  function downloadFile(fname, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* 结果弹窗 / 导出弹窗 */
  var solveResult = null;     // { ok, dist }
  var SOLVE_CAP = 20000;

  function verifySolvable() {
    var r = solveLevel();
    if (!r) return;
    if (currentItem) {
      currentItem.minstep = r.ok ? r.dist : 0;
      markLevelSolved(r.ok);
      wsMark();
    }
    if (r.ok) {
      currentItem.minstep = r.dist;
      solveResult = { ok: true, dist: r.dist };
      $('solve-msg').textContent = '可解，最短步数：' + r.dist;
      $('btn-solve-export').disabled = false;
      $('btn-solve-export').style.display = '';
    } else {
      solveResult = { ok: false, dist: -1 };
      $('solve-msg').textContent = '无解';
      $('btn-solve-export').disabled = true;
      $('btn-solve-export').style.display = 'none';
    }
    showModal($('solve-modal'));
  }
  var exportConds = [];
  function openExportModal() {
    if (!solveResult || !solveResult.ok) return;
    /* 默认一个“限制步数”条件：最小值=理论最小步数，默认不限最大值 */
    exportConds = [{ type: 0, minstep: solveResult.dist, maxstep: null, _lim: false }];
    renderCondList($('export-cond-body'), exportConds, '限制条件', false);
    showModal($('export-modal'));
  }
  function doExportSolutions() {
    if (!solveResult || !solveResult.ok) return;
    var conds = [];
    for (var ci = 0; ci < exportConds.length; ci++) {
      var cc = collectCondFrom(exportConds, ci);
      if (!cc) return;
      conds.push(cc);
    }
    /* 仅“限制步数”条件决定枚举上下限，其余条件在胜利时过滤 */
    var mn = 0, mx = 200;
    conds.forEach(function (c) {
      if (c.type !== 0) return;
      if (c.minstep > mn) mn = c.minstep;
      if (c.maxstep !== null && c.maxstep !== undefined && c.maxstep < mx) mx = c.maxstep;
    });
    if (mn > mx) { toast('限制条件中的最小步数超过最大步数'); return; }
    var FACE_BIT = [2, 1, 8, 4];   /* SV_DIR 下标 -> 朝向位（右/上/左/下） */
    function condsPass(total, red, left, portal, faceDirIdx) {
      for (var i2 = 0; i2 < conds.length; i2++) {
        var c = conds[i2];
        if (c.type === 1) {
          if (!(c.facing & FACE_BIT[faceDirIdx])) return false;
          continue;
        }
        if (c.type === 5) continue;   /* 导出限制不含开局朝向 */
        var v = c.type === 2 ? left : c.type === 3 ? red : c.type === 4 ? portal : total;
        if (v < c.minstep) return false;
        if (c.maxstep !== null && c.maxstep !== undefined && v > c.maxstep) return false;
      }
      return true;
    }

    /* 枚举 [mn, mx] 步内的所有解法 */
    var solutions = [];
    var visitedPath = {};
    var pathLines = [];
    var pathSteps = [];
    var sy = null, sx = null;
    Object.keys(vertices).forEach(function (vk) {
      var v = vertices[vk];
      if (v.start) { var xy = vk.split(','); sx = parseInt(xy[0], 10); sy = parseInt(xy[1], 10); }
    });
    var startKey = sx + ',' + sy;
    visitedPath[startKey + '|-1'] = true;
    pathLines.push('起点 (' + sx + ',' + sy + ')');

    var taskKeys = [], redKeys = [];
    Object.keys(segs).forEach(function (k) {
      var m = svLineMeta(segs[k]);
      if (!m) return;
      if (m.task) taskKeys.push(k);
      if (m.red) redKeys.push(k);
    });
    taskKeys.sort();
    redKeys.sort();
    var taskBit = {}, redBit = {};
    taskKeys.forEach(function (k, i) { taskBit[k] = 1 << i; });
    redKeys.forEach(function (k, i) { redBit[k] = 1 << i; });
    var fullTasks = taskKeys.length ? (1 << taskKeys.length) - 1 : 0;
    var portalPair = {};
    for (var lv = 1; lv <= 4; lv++) {
      var list = [];
      Object.keys(vertices).forEach(function (vk2) {
        var v2 = vertices[vk2];
        if (v2 && v2.portal === lv) {
          var xy2 = vk2.split(',');
          list.push([parseInt(xy2[0], 10), parseInt(xy2[1], 10)]);
        }
      });
      if (list.length === 2) {
        portalPair[list[0][0] + ',' + list[0][1]] = list[1];
        portalPair[list[1][0] + ',' + list[1][1]] = list[0];
      }
    }
    /* 左转/传送门条件：把计数纳入状态去重，并按最大值剪枝 */
    var useLeft = false, usePortal = false, leftMax = null, portalMax = null;
    conds.forEach(function (c) {
      if (c.type === 2) { useLeft = true; if (c.maxstep !== null && c.maxstep !== undefined) leftMax = c.maxstep; }
      if (c.type === 4) { usePortal = true; if (c.maxstep !== null && c.maxstep !== undefined) portalMax = c.maxstep; }
    });
    function popcount(v) { var c = 0; while (v) { c += v & 1; v >>= 1; } return c; }
    var endKey = null;
    void endKey;
    function explore(x, y, face, tasks, reds, lefts, portals, steps) {
      if (solutions.length >= SOLVE_CAP) return;
      if (steps >= mx) return;
      var tryDirs = face < 0 ? [0, 1, 2, 3] : [face, (face + 1) % 4];
      for (var ti = 0; ti < tryDirs.length; ti++) {
        var d = tryDirs[ti];
        var D = SV_DIR[d];
        var nx = x + D.dx, ny = y + D.dy;
        if (nx < 0 || ny < 0 || nx > stage.w || ny > stage.h) continue;
        var key = svEdgeKey(x, y, d);
        var meta = svLineMeta(segs[key]);
        if (!meta) continue;
        if (meta.arrow && !meta.dirOk(d)) continue;
        if (meta.red && (reds & redBit[key])) continue;
        var tasks2 = tasks, reds2 = reds;
        if (meta.task) tasks2 |= taskBit[key];
        if (meta.red) reds2 |= redBit[key];
        var fx = nx, fy = ny, tp = false, won = false;
        var doneAll = tasks2 === fullTasks;
        var v = vertices[nx + ',' + ny];
        if (v && v.end && doneAll) won = true;
        else if (v && v.portal) {
          var partner = portalPair[nx + ',' + ny];
          if (partner) {
            tp = true;
            fx = partner[0]; fy = partner[1];
            var fv = vertices[fx + ',' + fy];
            if (fv && fv.end && tasks2 === fullTasks) won = true;
          }
        }
        var kindName = { n: '普通线', t: '任务线', rn: '红线', rt: '任务红线', a: '箭头线', ra: '红箭头线', ta: '任务箭头线', rta: '红任务箭头线' }[segs[key].id] || segs[key].id;
        var line = '第' + (steps + 1) + '步 (' + x + ',' + y + ') → (' + nx + ',' + ny + ') 朝' + D.zh + ' 经过' + kindName;
        if (tp) line += ' → 传送门落点(' + fx + ',' + fy + ')';
        var total = steps + 1;
        var rec = { left: face >= 0 && d !== face ? 1 : 0, red: meta.red ? 1 : 0, portal: tp ? 1 : 0, zh: D.zh };
        var lefts2 = lefts + rec.left, portals2 = portals + rec.portal;
        if (leftMax !== null && lefts2 > leftMax) continue;
        if (portalMax !== null && portals2 > portalMax) continue;
        if (won) {
          if (total >= mn && total <= mx && condsPass(total, popcount(reds2), lefts2, portals2, d)) {
            solutions.push({
              lines: pathLines.slice(1).concat([line]),
              len: total,
              red: popcount(reds2),
              left: lefts2,
              portal: portals2,
              face: D.zh
            });
          }
          continue;   /* 胜利即结束该分支 */
        }
        var vkey = fx + ',' + fy + '|' + d + '|' + tasks2 + '|' + reds2 + (useLeft ? '|' + lefts2 : '') + (usePortal ? '|' + portals2 : '');
        if (visitedPath[vkey] !== undefined) continue;
        visitedPath[vkey] = total;
        pathLines.push(line);
        pathSteps.push(rec);
        explore(fx, fy, d, tasks2, reds2, lefts2, portals2, total);
        pathLines.pop();
        pathSteps.pop();
      }
    }
    explore(sx, sy, -1, 0, 0, 0, 0, 0);

    var out = [];
    out.push('关卡：' + (currentItem.name || 'level'));
    out.push('宽高：' + stage.w + 'x' + stage.h);
    out.push('最短步数：' + solveResult.dist);
    out.push('限制条件：' + (conds.length ? conds.map(condLabel).join('；') : '无'));
    out.push('解法数量：' + solutions.length);
    out.push('');
    solutions.forEach(function (sol, i) {
      out.push('===== 解法 ' + (i + 1) + '（' + sol.len + ' 步） =====');
      sol.lines.forEach(function (ln) { out.push(ln); });
      out.push('经过红线：' + sol.red);
      out.push('左转次数：' + sol.left);
      out.push('传送门使用次数：' + sol.portal);
      out.push('通关时玩家朝向：' + sol.face);
      out.push('');
    });
    hideModal($('export-modal'));
    downloadFile(sanitizeName(currentItem ? currentItem.name : 'level') + '.solutions.txt', out.join('\n'));
    toast('已导出 ' + solutions.length + ' 个解法');
  }

  $('btn-solve').addEventListener('click', verifySolvable);
  $('btn-solve-back').addEventListener('click', function () { hideModal($('solve-modal')); });
  $('btn-solve-export').addEventListener('click', openExportModal);
  $('btn-exp-cancel').addEventListener('click', function () { hideModal($('export-modal')); });
  $('btn-exp-ok').addEventListener('click', doExportSolutions);

  /* ==================== 编辑任务集（任务 = 多个条件，条件之间为“与”关系） ==================== */
  var TASK_TYPES = ['限制步数', '限制通关时玩家朝向', '限制左转次数', '限制走过的红线数量', '限制传送门使用次数', '限制开局朝向'];
  var selTask = null;
  var editingIndex = -1;      // 正在编辑的任务下标
  var workingTask = null;     // 正在编辑的任务（条件数组的深拷贝）

  function taskList() { return currentItem ? currentItem.tasks : null; }
  function condArr(t) {
    if (Array.isArray(t)) return t;
    if (t && typeof t === 'object') return [t];
    return [];
  }
  function normalizeTasks() {
    var arr = taskList();
    if (!Array.isArray(arr)) return;
    arr.forEach(function (t) {
      if (Array.isArray(t)) return;
      /* 兼容旧格式：单个对象包成单条件数组 */
      var i = arr.indexOf(t);
      arr[i] = [t];
    });
  }
  function condLabel(c) {
    var i = parseInt(c.type, 10);
    if (isNaN(i) || i < 0 || i > 5) return '未知条件';
    if (i === 1 || i === 5) {
      var bits = parseInt(c.facing, 10) || 0;
      var dirs = [];
      if (bits & 1) dirs.push('朝上');
      if (bits & 2) dirs.push('朝右');
      if (bits & 4) dirs.push('朝下');
      if (bits & 8) dirs.push('朝左');
      return TASK_TYPES[i] + '(' + (dirs.length ? dirs.join('/') : '无') + ')';
    }
    var mn = c.minstep;
    var mx = c.maxstep === null || c.maxstep === undefined ? null : c.maxstep;
    return TASK_TYPES[i] + '[' + (mn === undefined || mn === null || mn === '' ? '不限' : mn) + ', ' + (mx === null ? '不限' : mx) + ']';
  }
  function renderTaskList() {
    var list = $('task-list');
    list.innerHTML = '';
    normalizeTasks();
    var arr = taskList() || [];
    $('task-empty').style.display = arr.length ? 'none' : '';
    $('task-del').disabled = !selTask || selTask.index < 0;
    $('task-view').disabled = !selTask || selTask.index < 0;
    arr.forEach(function (t, i) {
      var sel = selTask && selTask.index === i;
      var row = document.createElement('div');
      row.className = 'room-btn open set-row' + (sel ? ' sel' : '');
      var bar = document.createElement('span');
      bar.className = 'room-bar';
      row.appendChild(bar);
      var n1 = document.createElement('span');
      n1.className = 'room-host set-row-name';
      n1.textContent = '任务 ' + (i + 1) + '（' + condArr(t).length + ' 个条件）';
      var n2 = document.createElement('span');
      n2.className = 'room-rules set-row-size';
      n2.textContent = condArr(t).map(condLabel).join('、');
      row.appendChild(n1);
      row.appendChild(n2);
      if (sel) {
        var arrows = document.createElement('div');
        arrows.className = 'room-arrows';
        function mkArr(cls, disabled, delta) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'room-arrow-btn ' + cls;
          b.disabled = disabled;
          var im = document.createElement('img');
          im.src = 'turnleft-texture/rightarrow.png';
          im.alt = '';
          b.appendChild(im);
          b.addEventListener('click', function (ev) { ev.stopPropagation(); moveTask(t, delta); });
          return b;
        }
        arrows.appendChild(mkArr('up', i === 0, -1));
        arrows.appendChild(mkArr('down', i === arr.length - 1, 1));
        row.appendChild(arrows);
      }
      row.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selTask = { index: i };
        renderTaskList();
      });
      row.addEventListener('dblclick', function () {
        selTask = { index: i };
        editingIndex = i;
        openTaskDetail();
      });
      list.appendChild(row);
    });
    if (updateTaskScroll) updateTaskScroll();
  }
  function openTaskModal() {
    if (!stage || !currentItem) { toast('请先打开一个关卡'); return; }
    if (!Array.isArray(currentItem.tasks)) currentItem.tasks = [];
    normalizeTasks();
    selTask = null;
    renderTaskList();
    showModal($('task-modal'));
    setTimeout(function () { if (updateTaskScroll) updateTaskScroll(); }, 30);
  }
  function moveTask(t, delta) {
    var arr = taskList();
    if (!Array.isArray(arr)) return;
    var i = arr.indexOf(t);
    var j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return;
    arr.splice(i, 1);
    arr.splice(j, 0, t);
    selTask = { index: j };
    wsMark();
    renderTaskList();
  }
  function askDeleteTask() {
    if (!selTask || selTask.index < 0) return;
    askConfirm('删除任务', '确定删除任务 ' + (selTask.index + 1) + ' 吗？', function () {
      taskList().splice(selTask.index, 1);
      selTask = null;
      renderTaskList();
    });
  }

  /* ---------- 条件编辑器 ---------- */
  function newDefaultCond() {
    return { type: 0, minstep: '', maxstep: null, _lim: true, _fb: 0 };
  }
  function openTaskDetail() {
    var arr = taskList();
    if (!Array.isArray(arr)) { toast('请先打开一个关卡'); return; }
    editingIndex = editingIndex >= 0 ? editingIndex : (selTask ? selTask.index : -1);
    if (editingIndex < 0 || editingIndex >= arr.length) { toast('任务不存在'); return; }
    workingTask = JSON.parse(JSON.stringify(condArr(arr[editingIndex])));
    renderCondEditor();
    showModal($('task-detail-modal'));
  }
  /* 整行操作钮：直接复用关卡条/任务条的结构（room-btn + room-bar + room-host） */
  function mkActRow(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'room-btn act-row';
    var bar = document.createElement('span');
    bar.className = 'room-bar';
    var lab = document.createElement('span');
    lab.className = 'room-host act-text';
    lab.textContent = text;
    b.appendChild(bar);
    b.appendChild(lab);
    if (onClick) b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); onClick(ev); });
    return b;
  }
  function setToggleImg(btn, on) {
    btn.setAttribute('data-on', on ? '1' : '0');
    var im = btn.querySelector('img');
    if (im) im.src = 'turnleft-texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
  }
  function mkToggle(actName, on) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'toggle';
    b.setAttribute('data-act', actName);
    b.setAttribute('data-on', on ? '1' : '0');
    var im = document.createElement('img');
    im.src = 'turnleft-texture/' + (on ? 'toggleon' : 'toggleoff') + '.png';
    b.appendChild(im);
    return b;
  }
  function renderCondEditor() {
    renderCondList($('task-detail-body'), workingTask || [], '任务类型', true);
  }
  /* 条件编辑器（任务编辑 / 导出解法共用；allowStartFacing=false 时不提供“限制开局朝向”） */
  function renderCondList(body, arr, typeLabel, allowStartFacing) {
    body.innerHTML = '';
    var typeCount = allowStartFacing === false ? 5 : TASK_TYPES.length;
    /* 添加条件：独立一行（顶部） */
    var addRow = mkActRow('添加条件', function () {
      arr.push(newDefaultCond());
      renderCondList(body, arr, typeLabel, allowStartFacing);
    });
    addRow.classList.add('act-top');
    body.appendChild(addRow);
    if (!arr.length) {
      var empty = document.createElement('div');
      empty.className = 'task-cond-empty';
      empty.textContent = '暂无条件，点击上方「添加条件」';
      body.appendChild(empty);
      return;
    }
    arr.forEach(function (c, i) {
      if (i > 0) {
        var hr = document.createElement('hr');
        hr.className = 'setting-divider';
        body.appendChild(hr);
      }
      var blk = document.createElement('div');
      blk.className = 'cond-block';
      /* 删除条件：独立整行 */
      blk.appendChild(mkActRow('删除条件', function () {
        arr.splice(i, 1);
        renderCondList(body, arr, typeLabel, allowStartFacing);
      }));
      /* 任务类型行 */
      var typeRow = document.createElement('div');
      typeRow.className = 'setting-row';
      var tl = document.createElement('span');
      tl.className = 'setting-label';
      tl.textContent = typeLabel;
      var sw = document.createElement('div');
      sw.className = 'sp-difficulty-switch';
      function mkArrow(src, dir) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'switch-arrow';
        var im = document.createElement('img');
        im.src = src;
        b.appendChild(im);
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var t = arr[i].type + dir;
          if (t < 0) t = typeCount - 1;
          if (t >= typeCount) t = 0;
          arr[i].type = t;
          delete arr[i].facing;
          arr[i]._fb = 0;
          if (t === 1 || t === 5) {
            delete arr[i].minstep;
            delete arr[i].maxstep;
          } else {
            arr[i]._lim = arr[i]._lim === undefined ? true : arr[i]._lim;
          }
          renderCondList(body, arr, typeLabel, allowStartFacing);
        });
        return b;
      }
      sw.appendChild(mkArrow('turnleft-texture/lastchoice.png', -1));
      var lb = document.createElement('span');
      lb.className = 'switch-label';
      lb.textContent = TASK_TYPES[c.type] || TASK_TYPES[0];
      sw.appendChild(lb);
      sw.appendChild(mkArrow('turnleft-texture/nextchoice.png', 1));
      typeRow.appendChild(tl);
      typeRow.appendChild(sw);
      blk.appendChild(typeRow);
      var isFace = c.type === 1 || c.type === 5;
      var limitOn = c._lim !== undefined ? !!c._lim : (c.maxstep !== null && c.maxstep !== undefined);
      var fb = c._fb !== undefined ? c._fb : (parseInt(c.facing, 10) || 0);
      /* 数值区 */
      var ranges = document.createElement('div');
      ranges.className = 'cond-ranges';
      if (!isFace) {
        mkNumRow(ranges, '最小值', c.minstep, 'min');
        mkNumRow(ranges, '最大值', limitOn ? c.maxstep : '', 'max', !limitOn);
        var tRow = document.createElement('div');
        tRow.className = 'setting-row toggle-row';
        var tL = document.createElement('span');
        tL.className = 'setting-label';
        tL.textContent = '是否限制最大值';
        var tg = mkToggle('toggle-limit', limitOn);
        tg.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var on = tg.getAttribute('data-on') !== '1';
          var cw = arr[i];
          cw._lim = on;
          if (!on) cw.maxstep = '';
          renderCondList(body, arr, typeLabel, allowStartFacing);
        });
        tRow.appendChild(tL);
        tRow.appendChild(tg);
        ranges.appendChild(tRow);
      }
      blk.appendChild(ranges);
      /* 朝向区 */
      var faces = document.createElement('div');
      faces.className = 'cond-facing';
      if (isFace) {
        mkFaceRow(faces, '限制朝上', !!(fb & 1), 'face-up');
        mkFaceRow(faces, '限制朝右', !!(fb & 2), 'face-right');
        mkFaceRow(faces, '限制朝下', !!(fb & 4), 'face-down');
        mkFaceRow(faces, '限制朝左', !!(fb & 8), 'face-left');
      }
      blk.appendChild(faces);
      body.appendChild(blk);
      /* 行构建辅助（须在循环内使用，故声明于函数内联） */
      function mkNumRow(parent, label, value, key, disabled) {
        var row = document.createElement('div');
        row.className = 'setting-row slider-row';
        var l = document.createElement('span');
        l.className = 'setting-label';
        l.textContent = label;
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'num-input';
        inp.min = '0';
        inp.step = '1';
        inp.value = value === undefined || value === null ? '' : value;
        if (disabled) inp.disabled = true;
        inp.addEventListener('input', function () {
          if (key === 'min') arr[i].minstep = inp.value;
          else arr[i].maxstep = inp.value;
        });
        row.appendChild(l);
        row.appendChild(inp);
        parent.appendChild(row);
      }
      function mkFaceRow(parent, label, on, act) {
        var row = document.createElement('div');
        row.className = 'setting-row toggle-row';
        var l = document.createElement('span');
        l.className = 'setting-label';
        l.textContent = label;
        var tg = mkToggle(act, on);
        tg.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var on2 = tg.getAttribute('data-on') !== '1';
          setToggleImg(tg, on2);
          var bits = { 'face-up': 1, 'face-right': 2, 'face-down': 4, 'face-left': 8 };
          var cur = arr[i]._fb !== undefined ? arr[i]._fb : (parseInt(arr[i].facing, 10) || 0);
          arr[i]._fb = on2 ? (cur | bits[act]) : (cur & ~bits[act]);
        });
        row.appendChild(l);
        row.appendChild(tg);
        parent.appendChild(row);
      }
    });
  }
  function collectCond(ci) {
    return collectCondFrom(workingTask, ci);
  }
  function collectCondFrom(arr, ci) {
    var c = arr[ci];
    var clean = { type: c.type };
    if (c.type === 1 || c.type === 5) {
      var fb = c._fb !== undefined ? c._fb : (parseInt(c.facing, 10) || 0);
      if (!fb) { toast('条件 ' + (ci + 1) + '：至少开启一个朝向限制'); return null; }
      clean.facing = fb;
      return clean;
    }
    if (c._lim === undefined) {
      c._lim = typeof c.maxstep === 'number' || (c.maxstep !== null && c.maxstep !== undefined && c.maxstep !== '');
    }
    var mn = parseInt(c.minstep, 10);
    if (isNaN(mn) || mn < 0) { toast('条件 ' + (ci + 1) + '：最小值需为不小于 0 的整数'); return null; }
    clean.minstep = mn;
    if (c._lim) {
      var mx = parseInt(c.maxstep, 10);
      if (isNaN(mx) || mx < mn) { toast('条件 ' + (ci + 1) + '：最大值需为不小于最小值的整数'); return null; }
      clean.maxstep = mx;
    } else {
      clean.maxstep = null;
    }
    return clean;
  }
  function saveTaskDetail() {
    if (!workingTask) return;
    try {
      var cleaned = [];
      for (var i = 0; i < workingTask.length; i++) {
        var c = collectCond(i);
        if (!c) return;
        cleaned.push(c);
      }
      var arr = taskList();
      arr[editingIndex] = cleaned;
      wsMark();
      hideModal($('task-detail-modal'));
      renderTaskList();
    } catch (err) {
      toast('保存异常：' + err.message);
    }
  }

  $('btn-tasks').addEventListener('click', openTaskModal);
  /* 测试关卡：进入游玩界面试玩本关，返回时回到编辑页面并停留在本关 */
  function launchTest() {
    if (!levelSet || !levelSet.length || !currentItem) { toast('请先创建并选择一个关卡'); return; }
    persistLiveTo(currentItem);
    var idx = levelSet.indexOf(currentItem);
    var raw = JSON.stringify(editorSettings.unordered ? ['unordered'].concat(levelSet) : levelSet);
    try {
      localStorage.setItem('tlTestSetRaw', raw);
      localStorage.setItem('tlTestSetName', (wsCtx && wsCtx.fileName) || 'Test');
      localStorage.setItem('tlTestIndex', String(idx));
      localStorage.setItem('tlTestDirty', wsHasChanges() ? '1' : '0');
    } catch (e) {}
    bypassUnload = true;   /* 主动跳转不触发离开提示 */
    location.href = 'turnleft-play.html?mode=workshop&test=1';
  }
  $('btn-test').addEventListener('click', launchTest);
  $('task-back').addEventListener('click', function () { hideModal($('task-modal')); });
  $('task-lobby').addEventListener('click', function (ev) {
    /* 点击空白处取消选择 */
    var t = ev.target;
    if (t === $('task-lobby') || t === $('task-empty') || t.id === 'task-list') {
      if (selTask) { selTask = null; renderTaskList(); }
    }
  });
  $('task-del').addEventListener('click', askDeleteTask);
  $('task-add').addEventListener('click', function () {
    var arr = taskList();
    if (!Array.isArray(arr)) return;
    editingIndex = arr.length;
    arr.push([newDefaultCond()]);
    selTask = { index: editingIndex };
    openTaskDetail();
  });
  $('task-view').addEventListener('click', function () {
    if (!selTask || selTask.index < 0) return;
    editingIndex = selTask.index;
    openTaskDetail();
  });
  $('task-detail-cancel').addEventListener('click', function () { hideModal($('task-detail-modal')); });
  $('task-detail-save').addEventListener('click', saveTaskDetail);

  /* ---------- 启动 ---------- */
  updateSetScroll = wireListScroll($('set-lobby'), $('set-scrollbar'), $('set-scrollbar-thumb'));
  updateTaskScroll = wireListScroll($('task-lobby'), $('task-scrollbar'), $('task-scrollbar-thumb'));
  function handleLaunchQuery() {
    var q = location.search || '';
    wsDirty = false;
    if (q.indexOf('action=new') >= 0) {
      wsCtx = null;
      if (levelSet === null) levelSet = [];
      refreshSetBtn();
      openSetManager();
      return;
    }
    if (q.indexOf('action=test-back') >= 0) {
      /* 从“测试关卡”返回：恢复测试前的关卡集与当前关卡，不清除未保存状态 */
      var traw = '', tnm = '', tidx = 0, tdir = '0';
      try {
        traw = localStorage.getItem('tlTestSetRaw') || '';
        tnm = localStorage.getItem('tlTestSetName') || '';
        tidx = parseInt(localStorage.getItem('tlTestIndex'), 10);
        tdir = localStorage.getItem('tlTestDirty') || '0';
        localStorage.removeItem('tlTestSetRaw');
        localStorage.removeItem('tlTestSetName');
        localStorage.removeItem('tlTestIndex');
        localStorage.removeItem('tlTestDirty');
      } catch (e) {}
      try {
        var tdata = JSON.parse(traw);
        wsCtx = { fileName: tnm || sanitizeName('Levels') };
        var tok = importSet(Array.isArray(tdata) ? tdata : [tdata], true);
        if (tok) {
          var ti = isNaN(tidx) ? 0 : tidx;
          if (ti < 0 || ti >= levelSet.length) ti = 0;
          switchToIndex(ti);
          if (tdir === '1') wsDirty = true; else wsMarkClean();
        } else {
          wsCtx = null;
        }
      } catch (e2) {
        wsCtx = null;
        console.error('[workshop] 测试返回恢复失败', e2);
        toast('无法恢复测试前的关卡集：' + (e2 && e2.message ? e2.message : e2));
      }
      return;
    }
    if (q.indexOf('action=edit') >= 0) {
      var raw = '';
      var nm = '';
      try {
        raw = localStorage.getItem('tlWorkshopEditRaw') || '';
        localStorage.removeItem('tlWorkshopEditRaw');
        nm = localStorage.getItem('tlWorkshopEditName') || '';
        localStorage.removeItem('tlWorkshopEditName');
      } catch (e) {}
      try {
        var data = JSON.parse(raw);
        wsCtx = { fileName: nm || sanitizeName('Levels') };
        var ok = importSet(Array.isArray(data) ? data : [data]);
        if (!ok) { wsCtx = null; }
        wsMarkClean();
      } catch (e2) {
        wsCtx = null;
        console.error('[workshop] 打开关卡集失败', e2);
        toast('无法打开该关卡集：' + (e2 && e2.message ? e2.message : e2));
      }
      openSetManager();
    }
  }
  console.log('[editor] boot v2 q1');
  loadSettings();
  if (window.Profile && Profile.applyBackground) Profile.applyBackground();
  refreshSetBtn();
  applyEditorLayout();
  loadAssets(function () {
    renderToolBar();
    if (stage) renderGrid();
    idbGetDirHandle().then(function (h) {
      wsDirHandle = h;
      handleLaunchQuery();
    });
  });
})();


