/* profile.js - 个人设置（名称/头像/背景）共享存储 */
(function (global) {
  'use strict';

  var KEY = 'chessProfile';
  var profile = { name: '', avatar: 'default', avatarData: '', bgColor: '', bgImage: '', avatarSmooth: true, bgSmooth: true, pureBlack: false };

  try {
    var saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') {
      profile.name = saved.name || '';
      profile.avatar = saved.avatar || 'default';
      profile.avatarData = saved.avatarData || '';
      profile.bgColor = saved.bgColor || '';
      profile.bgImage = saved.bgImage || '';
      profile.avatarSmooth = saved.avatarSmooth !== false;   /* 线性插值：默认是 */
      profile.bgSmooth = saved.bgSmooth !== false;
      profile.pureBlack = saved.pureBlack === true;
    }
  } catch (e) {}

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) {}
  }

  // 将个人背景应用到页面 body（纯色或图片铺满，图片线性插值）
  function applyBackground() {
    var body = document.body;
    if (profile.bgImage) {
      body.style.backgroundImage = 'url("' + profile.bgImage + '")';
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundColor = '';
      body.classList.add('bg-image');
    } else if (profile.bgColor) {
      body.style.backgroundImage = '';
      body.style.backgroundColor = profile.bgColor;
      body.classList.remove('bg-image');
    } else {
      body.style.backgroundImage = '';
      body.style.backgroundColor = '';
      body.classList.remove('bg-image');
    }
  }

  // 自定义滚动条：亮色=当前可见区，暗色=整页高度；可拖拽/点击
  // 返回 update 函数，内容可能变化时调用（如弹窗打开后）
  function wireScrollbar(bodyEl, sbEl, thEl) {
    if (!bodyEl || !sbEl || !thEl) return function () {};
    function update() {
      var overflow = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (overflow <= 0) { sbEl.style.display = 'none'; return; }
      sbEl.style.display = 'block';
      var ratio = bodyEl.clientHeight / bodyEl.scrollHeight;
      var topRatio = bodyEl.scrollTop / overflow;
      var topPct = topRatio * (100 - ratio * 100);
      // 钳制滑块位置，确保永不滑出轨道
      if (topPct < 0) topPct = 0;
      if (topPct > 100 - ratio * 100) topPct = 100 - ratio * 100;
      thEl.style.height = (ratio * 100) + '%';
      thEl.style.top = topPct + '%';
    }
    bodyEl.addEventListener('scroll', update);
    thEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startY = e.clientY;
      var startTop = bodyEl.scrollTop;
      var trackH = sbEl.clientHeight - thEl.offsetHeight;   /* 滑块可移动像素范围 */
      var overflow = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (trackH <= 0) return;
      function onMove(ev) {
        var dy = ev.clientY - startY;
        /* 鼠标移动 dy 像素，滑块也移动 dy 像素 */
        var target = startTop + dy * (overflow / trackH);
        if (target < 0) target = 0;
        if (target > overflow) target = overflow;
        bodyEl.scrollTop = target;
        update();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    sbEl.addEventListener('mousedown', function (e) {
      if (e.target === thEl) return;
      var rect = sbEl.getBoundingClientRect();
      var ratio = (e.clientY - rect.top) / rect.height;
      var overflow = bodyEl.scrollHeight - bodyEl.clientHeight;
      bodyEl.scrollTop = ratio * overflow;
      update();
    });
    return update;
  }

  // 点击弹窗外部关闭（带拖拽防误触）：
  // 拖拽滑块/滚动条等控件时鼠标可能移动到弹窗背景上再松手，
  // 此时 click 会以弹窗本身为目标触发，若不判断位移会误关弹窗。
  function wireModalOutsideClick(modalEl, closeFn) {
    var down = null;
    modalEl.addEventListener('mousedown', function (e) {
      down = { x: e.clientX, y: e.clientY };
    });
    modalEl.addEventListener('click', function (e) {
      if (e.target !== modalEl) return;
      if (down && (Math.abs(e.clientX - down.x) > 5 || Math.abs(e.clientY - down.y) > 5)) return;
      closeFn();
    });
  }

  // 手机/平板端扩大按钮点击热区 25%（每边 12.5%），
  // 相邻按钮热区重叠时对半分（中线划分）；视觉不变，不影响其他元素点击
  function adjustBtnHitAreas() {
    var narrow = !!window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    var btns = document.querySelectorAll('.btn');
    if (!narrow) {
      for (var i = 0; i < btns.length; i++) {
        btns[i].style.removeProperty('--hit-l');
        btns[i].style.removeProperty('--hit-r');
        btns[i].style.removeProperty('--hit-t');
        btns[i].style.removeProperty('--hit-b');
      }
      return;
    }
    // 按父容器分组，仅同容器按钮可能重叠
    var groups = [];
    for (var i = 0; i < btns.length; i++) {
      var parent = btns[i].parentElement;
      if (groups.indexOf(parent) === -1) groups.push(parent);
    }
    for (var g = 0; g < groups.length; g++) {
      var items = [];
      var groupBtns = groups[g].querySelectorAll('.btn');
      for (var i = 0; i < groupBtns.length; i++) {
        var el = groupBtns[i];
        if (!el.offsetWidth) continue;   // 隐藏按钮跳过
        var r = el.getBoundingClientRect();
        items.push({
          el: el,
          left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          hitL: r.left - r.width * 0.125, hitR: r.right + r.width * 0.125,
          hitT: r.top - r.height * 0.125, hitB: r.bottom + r.height * 0.125
        });
      }
      // 迭代调整重叠（重叠区间取中点，两侧各得一半）
      for (var pass = 0; pass < 3; pass++) {
        for (var a = 0; a < items.length; a++) {
          for (var b = a + 1; b < items.length; b++) {
            var A = items[a], B = items[b];
            if (A.hitR > B.hitL && A.hitL < B.hitR &&
                Math.min(A.hitB, B.hitB) > Math.max(A.hitT, B.hitT)) {
              var midX = (Math.min(A.hitR, B.hitR) + Math.max(A.hitL, B.hitL)) / 2;
              if (A.left <= B.left) { A.hitR = midX; B.hitL = midX; }
              else { B.hitR = midX; A.hitL = midX; }
            }
            if (A.hitB > B.hitT && A.hitT < B.hitB &&
                Math.min(A.hitR, B.hitR) > Math.max(A.hitL, B.hitL)) {
              var midY = (Math.min(A.hitB, B.hitB) + Math.max(A.hitT, B.hitT)) / 2;
              if (A.top <= B.top) { A.hitB = midY; B.hitT = midY; }
              else { B.hitB = midY; A.hitT = midY; }
            }
          }
        }
      }
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        it.el.style.setProperty('--hit-l', (it.hitL - it.left) + 'px');
        it.el.style.setProperty('--hit-r', (it.right - it.hitR) + 'px');
        it.el.style.setProperty('--hit-t', (it.hitT - it.top) + 'px');
        it.el.style.setProperty('--hit-b', (it.bottom - it.hitB) + 'px');
      }
    }
  }

  // 纯黑模式：开启后所有 #000000XX / rgba(0,0,0,alpha) 变为纯黑
  function applyPureBlack() {
    var root = document.documentElement;
    if (profile.pureBlack) root.classList.add('pureblack');
    else root.classList.remove('pureblack');
  }

  global.Profile = {
    get: function () { return profile; },
    save: save,
    applyBackground: applyBackground,
    applyPureBlack: applyPureBlack,
    wireScrollbar: wireScrollbar,
    wireModalOutsideClick: wireModalOutsideClick,
    adjustBtnHitAreas: adjustBtnHitAreas
  };

  applyPureBlack();
})(window);