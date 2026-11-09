/* card-overlap-hover.js - 动态调整重叠牌（鼠标悬停时局部展开，保持整列/整行尺寸不变） */
(function () {
  'use strict';

  var initialized = false;
  var enabledFn = function () { return false; };
  var active = null;
  var ANIM_CLASS = 'fc-overlap-anim';
  var ANIM_MS = 180;
  var GROUP_SELECTORS = ['.bt-hand-row', '.bt-spec-cards', '.up-spec-cards', '.up-play-row', '.fc-col', '#bt-center'];
  var ELIGIBLE_CARDS = '.bt-hand-row .fc-card, .bt-spec-cards .fc-card, .up-spec-cards .fc-card, .up-play-row .fc-card, .fc-col .fc-card, #bt-center .fc-card';

  function isEnabled() {
    try { return !!enabledFn(); } catch (e) { return false; }
  }

  function closestCard(target) {
    return target && target.closest ? target.closest('.fc-card') : null;
  }

  function groupInfo(card) {
    if (!card) return null;
    var center = card.closest('#bt-center');
    if (center) return { group: center, type: 'center' };
    for (var i = 0; i < GROUP_SELECTORS.length; i++) {
      var g = card.closest(GROUP_SELECTORS[i]);
      if (g) return { group: g, type: GROUP_SELECTORS[i] };
    }
    return null;
  }

  function cardsInGroup(info, hovered) {
    var group = info.group;
    var all = Array.prototype.slice.call(group.querySelectorAll('.fc-card'));
    all = all.filter(function (c) {
      var g = c.closest('.bt-hand-row, .bt-spec-cards, .up-spec-cards, .up-play-row, .fc-col, #bt-center');
      return g === group;
    });
    if (info.type === 'center' && hovered) {
      var top = hovered.getBoundingClientRect().top;
      all = all.filter(function (c) {
        var r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && Math.abs(r.top - top) <= 1.5;
      });
    }
    return all;
  }

  function cardAt(x, y) {
    var el = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    var direct = closestCard(el);
    if (direct) {
      /* 鼠标在普通牌面上：如果它不属于可调整区域，不要穿透到下面的牌 */
      return { card: direct, info: groupInfo(direct) };
    }
    /* 出牌区使用 pointer-events:none；用矩形命中兜底，取 DOM 顺序最后的牌（视觉最上层） */
    var list = document.querySelectorAll(ELIGIBLE_CARDS);
    var found = null;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var r = c.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      var cs = window.getComputedStyle ? window.getComputedStyle(c) : null;
      if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = c;
    }
    return found ? { card: found, info: groupInfo(found) } : null;
  }

  function captureBase(cards) {
    return cards.map(function (c) {
      var cs = window.getComputedStyle(c);
      return {
        ml: parseFloat(cs.marginLeft) || 0,
        mt: parseFloat(cs.marginTop) || 0,
        inlineML: c.style.marginLeft,
        inlineMT: c.style.marginTop
      };
    });
  }

  function sameCards(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function measureLayout(cards, horizontal) {
    var n = cards.length;
    var rect = cards[0].getBoundingClientRect();
    var dim = horizontal ? cards[0].offsetWidth : cards[0].offsetHeight;
    var viewSize = horizontal ? rect.width : rect.height;
    var scale = (!dim || !viewSize) ? 0 : viewSize / dim;
    if (!dim || !scale) return null;
    var steps = [];
    var total = 0;
    var rects = cards.map(function (c) { return c.getBoundingClientRect(); });
    for (var i = 1; i < n; i++) {
      var step = (horizontal ? (rects[i].left - rects[i - 1].left) : (rects[i].top - rects[i - 1].top)) / scale;
      if (step < 0) step = -step;
      steps[i] = step;
      total += step;
    }
    if (!(total > 0)) return null;
    return { horizontal: horizontal, dim: dim, scale: scale, steps: steps, total: total };
  }

  function applyGroup(info, cards, hovered) {
    if (!cards || cards.length < 2) { restore(); return; }
    var horizontal = info.type !== '.fc-col';
    if (active && (!active.group.isConnected || !sameCards(active.cards, cards))) restore();

    if (!active || active.group !== info.group) {
      restore();
      var layout = measureLayout(cards, horizontal);
      if (!layout) { restore(); return; }
      active = {
        group: info.group,
        type: info.type,
        cards: cards,
        hovered: hovered,
        base: captureBase(cards),
        layout: layout
      };
    } else {
      active.hovered = hovered;
    }

    var n = cards.length;
    var dim = active.layout.dim;
    var steps = active.layout.steps;
    var total = active.layout.total;

    var overlap = 1 - (total / (n - 1)) / dim;
    var targetOverlap = null;
    if (horizontal) {
      if (overlap > 0.7) targetOverlap = 0.7;
    } else {
      if (overlap > 0.8) targetOverlap = 0.8;
    }
    if (targetOverlap === null) { restore(); return; }

    var hoverIdx = cards.indexOf(hovered);
    if (hoverIdx < 0) { restore(); return; }

    var selected = [];
    for (var j = hoverIdx; j <= hoverIdx + 2; j++) {
      if (j >= 1 && j < n) selected.push(j);
    }
    if (!selected.length) { restore(); return; }
    var selectedMap = {};
    selected.forEach(function (k) { selectedMap[k] = true; });
    var remaining = [];
    for (var q = 1; q < n; q++) if (!selectedMap[q]) remaining.push(q);
    /* 没有其它牌可压缩时无法保持总高度/宽度，按需求不生效 */
    if (!remaining.length) { restore(); return; }

    var targetStep = dim * (1 - targetOverlap);
    var selectedSum = selected.length * targetStep;
    var remainingSum = 0;
    remaining.forEach(function (k) { remainingSum += steps[k]; });
    var remainingTarget = total - selectedSum;
    if (remainingSum <= 0 || remainingTarget < 0) { restore(); return; }
    var ratio = remainingTarget / remainingSum;

    var newSteps = steps.slice();
    selected.forEach(function (k) { newSteps[k] = targetStep; });
    remaining.forEach(function (k) { newSteps[k] = steps[k] * ratio; });
    if (ratio < 0) { restore(); return; }

    active.group.classList.add(ANIM_CLASS);
    for (var m = 1; m < n; m++) {
      var delta = newSteps[m] - steps[m];
      var card = cards[m];
      var base = active.base[m];
      if (horizontal) card.style.marginLeft = (base.ml + delta) + 'px';
      else card.style.marginTop = (base.mt + delta) + 'px';
    }
  }

  function restore() {
    if (!active) return;
    var a = active;
    active = null;
    a.cards.forEach(function (c, i) {
      if (!c || !c.style) return;
      var b = a.base[i];
      c.style.marginLeft = b.inlineML;
      c.style.marginTop = b.inlineMT;
    });
    if (a.group) {
      setTimeout(function () {
        if (!active || active.group !== a.group) a.group.classList.remove(ANIM_CLASS);
      }, ANIM_MS + 20);
    }
  }

  function refresh() {
    if (!isEnabled()) { restore(); return; }
    if (active && (!active.group || !active.group.isConnected)) restore();
  }

  function onMove(e) {
    if (!isEnabled()) { restore(); return; }
    if (e && e.buttons) { restore(); return; }   /* 拖动时不要改变布局 */
    if (document.querySelector('.modal:not(.hidden)')) { restore(); return; }
    var hit = cardAt(e.clientX, e.clientY);
    if (!hit || !hit.info) { restore(); return; }
    var cards = cardsInGroup(hit.info, hit.card);
    if (cards.length < 2 || cards.indexOf(hit.card) < 0) { restore(); return; }
    if (active && active.group === hit.info.group && active.hovered === hit.card && sameCards(active.cards, cards)) return;
    applyGroup(hit.info, cards, hit.card);
  }

  function init(opts) {
    if (opts && typeof opts.enabled === 'function') enabledFn = opts.enabled;
    if (initialized) { refresh(); return; }
    initialized = true;
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) restore(); });
    window.addEventListener('blur', restore);
    window.addEventListener('resize', restore);
    window.addEventListener('scroll', restore, true);
    document.addEventListener('visibilitychange', function () { if (document.hidden) restore(); });
  }

  window.CardOverlapHover = { init: init, refresh: refresh, restore: restore };
})();
