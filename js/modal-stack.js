/* modal-stack.js - 多个弹窗同时显示时，只显示最顶层弹窗（后显示者在上），
   底部弹窗临时隐藏，直到顶部弹窗关闭后恢复。仅作用于 .modal 容器，
   不影响游戏区域/游戏面板内的元素。 */
(function () {
  'use strict';

  var stack = [];                  // 当前可见弹窗（按显示顺序，末尾为最顶层）
  var visibleState = new WeakMap();// 每个弹窗上次的可见状态

  function topModal() { return stack.length ? stack[stack.length - 1] : null; }

  function update() {
    /* 清理已移除/已隐藏的弹窗 */
    stack = stack.filter(function (el) {
      return el.isConnected && !el.classList.contains('hidden');
    });
    var top = topModal();
    var list = document.querySelectorAll('.modal');
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m === top) m.classList.remove('modal-stack-hidden');
      else if (!m.classList.contains('hidden')) m.classList.add('modal-stack-hidden');
      else m.classList.remove('modal-stack-hidden');
    }
  }

  function sync(m) {
    var vis = !m.classList.contains('hidden');
    var prev = visibleState.get(m) === true;
    if (vis === prev) return;
    visibleState.set(m, vis);
    var idx = stack.indexOf(m);
    if (idx >= 0) stack.splice(idx, 1);
    if (vis) stack.push(m);
    update();
  }

  function init() {
    var list = document.querySelectorAll('.modal');
    for (var i = 0; i < list.length; i++) {
      (function (m) {
        var vis = !m.classList.contains('hidden');
        visibleState.set(m, vis);
        if (vis) stack.push(m);
        var ob = new MutationObserver(function () { sync(m); });
        ob.observe(m, { attributes: true, attributeFilter: ['class'] });
      })(list[i]);
    }
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* 供调试/特殊场景手动刷新（例如动态插入的弹窗） */
  window.ModalStack = { refresh: init, top: topModal };
})();
