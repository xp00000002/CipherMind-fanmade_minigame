/* settings-shortcuts.js - 可配置快捷键：运行时触发、快捷键设置弹窗与持久化 */
(function () {
  'use strict';

  var MODAL_ID = 'shortcut-settings-modal';
  var STORE_PREFIX = 'cmchessShortcuts:';

  var KEY_NAMES = {
    Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt',
    Tab: 'Tab', Enter: 'Enter', CapsLock: 'Caps Lock', Backspace: 'Backspace', Space: 'Space',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Delete: 'Delete'
  };
  var KEY_ORDER = {};
  (function () {
    [
      'Ctrl', 'Shift', 'Alt', 'Tab', 'Enter', 'CapsLock', 'Backspace', 'Space'
    ].forEach(function (id) { KEY_ORDER[id] = Object.keys(KEY_ORDER).length; });
    for (var i = 0; i < 26; i++) {
      var letter = String.fromCharCode(65 + i);
      KEY_NAMES['Key' + letter] = letter;
      KEY_ORDER['Key' + letter] = Object.keys(KEY_ORDER).length;
    }
    for (var d = 0; d < 10; d++) {
      KEY_NAMES['Digit' + d] = String(d);
      KEY_ORDER['Digit' + d] = Object.keys(KEY_ORDER).length;
    }
    ['Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
      'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'ArrowUp', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'Delete'].forEach(function (id) {
      KEY_ORDER[id] = Object.keys(KEY_ORDER).length;
    });
  })();

  var PAGE_DEFS = {
    battle: {
      modal: 'settings-modal',
      main: { id: 'bt-scale', label: '牌桌缩放' },
      panel: { id: 'bt-panel-scale', label: '面板缩放' },
      actions: [
        { id: 'actionpos', label: '出牌选项位置', click: 'bt-actionpos-next', keys: ['Shift', 'KeyS'] },
        { id: 'hand-plus', label: '手牌大小(+)', scale: 'bt-hand-scale', delta: 5, keys: ['Shift', 'ArrowRight'] },
        { id: 'hand-minus', label: '手牌大小(-)', scale: 'bt-hand-scale', delta: -5, keys: ['Shift', 'ArrowLeft'] },
        { id: 'counter-plus', label: '记牌器大小(+)', scale: 'bt-counter-scale', delta: 5, keys: ['Shift', 'Equal'] },
        { id: 'counter-minus', label: '记牌器大小(-)', scale: 'bt-counter-scale', delta: -5, keys: ['Shift', 'Minus'] },
        { id: 'transparent', label: '牌面透明', click: 'bt-opt-transparent', keys: ['Shift', 'KeyA'] },
        { id: 'suitborder', label: '边框提示花色', click: 'bt-opt-suitborder', keys: ['Shift', 'KeyC'] },
        { id: 'twocolor', label: '双色模式', click: 'bt-opt-twocolor', keys: ['Shift', 'KeyD'] },
        { id: 'overlap', label: '动态调整重叠牌', click: 'bt-opt-overlap', keys: ['Shift', 'KeyF'] },
        { id: 'hidechat', label: '隐藏消息提示', click: 'bt-opt-hidechat', keys: ['Shift', 'KeyT'] }
      ]
    },
    upgrade: {
      modal: 'up-settings-modal',
      main: { id: 'up-scale', label: '牌桌缩放' },
      panel: { id: 'up-panel-scale', label: '面板缩放' },
      actions: [
        { id: 'actionpos', label: '出牌选项位置', click: 'up-actionpos-next', keys: ['Shift', 'KeyS'] },
        { id: 'hand-plus', label: '手牌大小(+)', scale: 'up-hand-scale', delta: 5, keys: ['Shift', 'ArrowRight'] },
        { id: 'hand-minus', label: '手牌大小(-)', scale: 'up-hand-scale', delta: -5, keys: ['Shift', 'ArrowLeft'] },
        { id: 'counter-plus', label: '记牌器大小(+)', scale: 'up-counter-scale', delta: 5, keys: ['Shift', 'Equal'] },
        { id: 'counter-minus', label: '记牌器大小(-)', scale: 'up-counter-scale', delta: -5, keys: ['Shift', 'Minus'] },
        { id: 'transparent', label: '牌面透明', click: 'up-opt-transparent', keys: ['Shift', 'KeyA'] },
        { id: 'suitborder', label: '边框提示花色', click: 'up-opt-suitborder', keys: ['Shift', 'KeyC'] },
        { id: 'twocolor', label: '双色模式', click: 'up-opt-twocolor', keys: ['Shift', 'KeyD'] },
        { id: 'overlap', label: '动态调整重叠牌', click: 'up-opt-overlap', keys: ['Shift', 'KeyF'] },
        { id: 'hidechat', label: '隐藏消息提示', click: 'up-opt-hidechat', keys: ['Shift', 'KeyT'] }
      ]
    },
    zjh: {
      modal: 'settings-modal',
      main: { id: 'zjh-scale', label: '牌桌缩放' },
      panel: { id: 'zjh-panel-scale', label: '面板缩放' },
      actions: [
        { id: 'transparent', label: '牌面透明', click: 'zjh-opt-transparent', keys: ['Shift', 'KeyA'] },
        { id: 'suitborder', label: '边框提示花色', click: 'zjh-opt-suitborder', keys: ['Shift', 'KeyC'] },
        { id: 'twocolor', label: '双色模式', click: 'zjh-opt-twocolor', keys: ['Shift', 'KeyD'] },
        { id: 'hidechat', label: '隐藏消息提示', click: 'zjh-opt-hidechat', keys: ['Shift', 'KeyT'] }
      ]
    },
    freecell: {
      modal: 'fc-settings-modal',
      main: { id: 'fc-win-scale', label: '窗口缩放' },
      actions: [
        { id: 'transparent', label: '牌面透明', click: 'opt-transparent', keys: ['Shift', 'KeyA'] },
        { id: 'suitborder', label: '边框提示花色', click: 'opt-suit-border', keys: ['Shift', 'KeyC'] },
        { id: 'twocolor', label: '双色模式', click: 'opt-two-color', keys: ['Shift', 'KeyD'] },
        { id: 'overlap', label: '动态调整重叠牌', click: 'opt-overlap', keys: ['Shift', 'KeyF'] }
      ]
    },
    klondike: {
      modal: 'fc-settings-modal',
      main: { id: 'fc-win-scale', label: '窗口缩放' },
      actions: [
        { id: 'transparent', label: '牌面透明', click: 'opt-transparent', keys: ['Shift', 'KeyA'] },
        { id: 'suitborder', label: '边框提示花色', click: 'opt-suit-border', keys: ['Shift', 'KeyC'] },
        { id: 'twocolor', label: '双色模式', click: 'opt-two-color', keys: ['Shift', 'KeyD'] },
        { id: 'overlap', label: '动态调整重叠牌', click: 'opt-overlap', keys: ['Shift', 'KeyF'] }
      ]
    },
    spider: {
      modal: 'fc-settings-modal',
      main: { id: 'fc-win-scale', label: '窗口缩放' },
      actions: [
        { id: 'opbottom', label: '操作区底部边界位置', click: 'sp-opbottom-next', keys: ['Shift', 'KeyW'] },
        { id: 'transparent', label: '牌面透明', click: 'opt-transparent', keys: ['Shift', 'KeyA'] },
        { id: 'suitborder', label: '边框提示花色', click: 'opt-suit-border', keys: ['Shift', 'KeyC'] },
        { id: 'twocolor', label: '双色模式', click: 'opt-two-color', keys: ['Shift', 'KeyD'] },
        { id: 'overlap', label: '动态调整重叠牌', click: 'opt-overlap', keys: ['Shift', 'KeyS'] }
      ]
    },
    chess: {
      modal: 'settings-modal',
      main: { id: 'board-scale', label: '棋盘大小' },
      panel: { id: 'panel-scale', label: '面板缩放' },
      actions: [
        { id: 'flip', label: '反转棋盘朝向', click: 'opt-flip', keys: ['Shift', 'KeyR'] },
        { id: 'moves', label: '显示可走点', click: 'opt-moves', keys: ['Shift', 'KeyE'] },
        { id: 'hidechat', label: '隐藏消息提示', click: 'opt-hide-chat', keys: ['Shift', 'KeyT'] },
        { id: 'lastmove', label: '显示上一步路径', click: 'opt-lastmove', keys: ['Shift', 'KeyZ'] },
        { id: 'coords', label: '显示行列坐标', click: 'opt-coords', keys: ['Shift', 'KeyC'] },
        { id: 'oppmoves', label: '显示对方选子', click: 'opt-oppmoves', keys: ['Shift', 'KeyF'] },
        { id: 'material', label: '显示子力分领先', click: 'opt-material', keys: ['Shift', 'KeyX'] }
      ]
    },
    'turnleft-play': {
      modal: 'play-settings-modal',
      main: { id: 'ps-bench-scale', label: '游戏区域缩放' },
      panel: { id: 'ps-panel-scale', label: '面板缩放' },
      actions: [
        { id: 'speed-plus', label: '动画速度(+)', scale: 'ps-speed-scale', delta: 5, keys: ['Shift', 'ArrowRight'] },
        { id: 'speed-minus', label: '动画速度(-)', scale: 'ps-speed-scale', delta: -5, keys: ['Shift', 'ArrowLeft'] },
        { id: 'opacity-plus', label: '玩家不透明度(+)', scale: 'ps-opacity-scale', delta: 5, keys: ['Shift', 'Equal'] },
        { id: 'opacity-minus', label: '玩家不透明度(-)', scale: 'ps-opacity-scale', delta: -5, keys: ['Shift', 'Minus'] },
        { id: 'dir', label: '方向键定位', click: 'ps-dir-next', keys: ['Shift', 'KeyL'] },
        { id: 'pass', label: '经过任务线后', click: 'ps-pass-next', keys: ['Shift', 'KeyT'] },
        { id: 'red', label: '经过红线后', click: 'ps-red-next', keys: ['Shift', 'KeyR'] },
        { id: 'showanim', label: '是否显示动画效果', click: 'ps-showanim-toggle', keys: ['Shift', 'KeyC'] },
        { id: 'facing', label: '是否显示玩家朝向', click: 'ps-facing-toggle', keys: ['Shift', 'KeyF'] },
        { id: 'animhint', label: '是否启用动态方向提示', click: 'ps-anim-toggle', keys: ['Shift', 'KeyE'] }
      ]
    },
    'turnleft-editor': {
      modal: 'settings-modal',
      main: { id: 'bench-scale', label: '制作台缩放' },
      panel: { id: 'panel-scale', label: '面板缩放' },
      actions: []
    }
  };

  var active = null;
  var shortModal = null;
  var shortBody = null;
  var shortPage = null;
  var shortScrollUpdate = null;
  var shortRows = {};
  var saved = {};
  var draft = {};
  var defaults = {};
  var runtimeMap = {};
  var capture = null;
  var heldNonModifiers = {};
  var pendingModifierSig = null;

  function cloneCombo(keys) {
    return (keys || []).slice();
  }

  function cloneMap(map) {
    var out = {};
    Object.keys(map).forEach(function (key) { out[key] = cloneCombo(map[key]); });
    return out;
  }

  function isModifierKey(id) {
    return id === 'Ctrl' || id === 'Shift' || id === 'Alt';
  }

  function include(list, value) {
    return list.indexOf(value) >= 0;
  }

  function sortKeys(keys) {
    var seen = {};
    return (keys || []).filter(function (key) {
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(function (a, b) {
      var ra = KEY_ORDER[a];
      var rb = KEY_ORDER[b];
      if (ra === undefined) ra = 1000;
      if (rb === undefined) rb = 1000;
      if (ra !== rb) return ra - rb;
      return String(a).localeCompare(String(b));
    });
  }

  function comboSignature(keys) {
    return sortKeys(keys).join('|');
  }

  function isModifierOnly(keys) {
    if (!keys || !keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
      if (!isModifierKey(keys[i])) return false;
    }
    return true;
  }

  function formatCombo(keys) {
    return sortKeys(keys).map(function (key) {
      return KEY_NAMES[key] || key;
    }).join('+');
  }

  function keyIdFromEvent(e) {
    var code = e.code || '';
    var key = e.key || '';

    if (code === 'NumpadEnter') return 'Enter';
    if (/^Numpad[0-9]$/.test(code)) return 'Digit' + code.slice(-1);
    if (code === 'NumpadMultiply') return 'Digit8';
    if (code === 'NumpadAdd') return 'Equal';
    if (code === 'NumpadSubtract') return 'Minus';
    if (code === 'NumpadDivide') return 'Slash';
    if (code === 'NumpadDecimal') return 'Period';
    if (code === 'NumpadComma') return 'Comma';
    if (code === 'NumpadEqual') return 'Equal';

    if (code === 'ControlLeft' || code === 'ControlRight' || key === 'Control') return 'Ctrl';
    if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'Shift') return 'Shift';
    if (code === 'AltLeft' || code === 'AltRight' || key === 'Alt') return 'Alt';
    if (code === 'MetaLeft' || code === 'MetaRight' || code === 'OSLeft' || code === 'OSRight' || key === 'Meta' || key === 'OS') return null;

    if (code && KEY_NAMES[code]) return code;

    if (code && /^Key[A-Z]$/.test(code)) return code;
    if (code && /^Digit[0-9]$/.test(code)) return code;

    if (key === 'CapsLock') return 'CapsLock';
    if (key === 'Backspace') return 'Backspace';
    if (key === 'Tab') return 'Tab';
    if (key === 'Enter') return 'Enter';
    if (key === ' ' || key === 'Spacebar' || key === 'Space') return 'Space';
    if (key === 'ArrowUp') return 'ArrowUp';
    if (key === 'ArrowDown') return 'ArrowDown';
    if (key === 'ArrowLeft') return 'ArrowLeft';
    if (key === 'ArrowRight') return 'ArrowRight';
    if (key === 'Delete') return 'Delete';

    if (key.length === 1) {
      var upper = key.toUpperCase();
      if (upper >= 'A' && upper <= 'Z') return 'Key' + upper;
      if (key >= '0' && key <= '9') return 'Digit' + key;
      var charMap = {
        '`': 'Backquote', '~': 'Backquote',
        '-': 'Minus', '_': 'Minus',
        '=': 'Equal', '+': 'Equal',
        '[': 'BracketLeft', '{': 'BracketLeft',
        ']': 'BracketRight', '}': 'BracketRight',
        '\\': 'Backslash', '|': 'Backslash',
        ';': 'Semicolon', ':': 'Semicolon',
        "'": 'Quote', '"': 'Quote',
        ',': 'Comma', '<': 'Comma',
        '.': 'Period', '>': 'Period',
        '/': 'Slash', '?': 'Slash',
        '*': 'Digit8'
      };
      if (charMap[key]) return charMap[key];
    }
    return null;
  }

  function isIgnoredKey(e) {
    var key = e.key || '';
    var code = e.code || '';
    if (key === 'Meta' || key === 'OS' || key === 'Win' || key === 'Command' ||
      /^Meta/.test(code) || /^OS/.test(code)) return true;
    if (key === 'Fn' || code === 'Fn') return true;
    if (/^F([1-9]|1[0-2])$/.test(key) || /^F([1-9]|1[0-2])$/.test(code)) return true;
    if (key === 'ContextMenu' || key === 'Menu' || key === 'Apps' || code === 'ContextMenu') return true;
    if (key === 'Escape' || key === 'Esc' || code === 'Escape') return true;
    if (key === 'NumLock' || key === 'Num Lock' || code === 'NumLock') return true;
    if (key === 'Insert' || code === 'Insert') return true;
    if (key === 'PrintScreen' || key === 'Print Screen' || code === 'PrintScreen') return true;
    if (key === 'Home' || code === 'Home') return true;
    if (key === 'End' || code === 'End') return true;
    if (key === 'PageUp' || key === 'Page Up' || code === 'PageUp') return true;
    if (key === 'PageDown' || key === 'Page Down' || code === 'PageDown') return true;
    if (key === 'ScrollLock' || key === 'Scroll Lock' || code === 'ScrollLock') return true;
    if (key === 'Pause' || key === 'Break' || key === 'Pause Break' ||
      code === 'Pause' || code === 'Break') return true;
    return false;
  }

  function isEditableTarget(target) {
    if (!target || !target.tagName) return false;
    var tag = target.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    if (tag === 'INPUT') {
      var type = (target.getAttribute('type') || 'text').toLowerCase();
      return type !== 'range';
    }
    return false;
  }

  function buildActions(def) {
    var list = [];
    if (def.main) {
      list.push({
        id: 'main-plus', label: def.main.label + '(+)',
        keys: ['Shift', 'BracketRight'], scale: def.main.id, delta: 5
      });
      list.push({
        id: 'main-minus', label: def.main.label + '(-)',
        keys: ['Shift', 'BracketLeft'], scale: def.main.id, delta: -5
      });
    }
    if (def.panel) {
      list.push({
        id: 'panel-plus', label: def.panel.label + '(+)',
        keys: ['Shift', 'Period'], scale: def.panel.id, delta: 5
      });
      list.push({
        id: 'panel-minus', label: def.panel.label + '(-)',
        keys: ['Shift', 'Comma'], scale: def.panel.id, delta: -5
      });
    }
    (def.actions || []).forEach(function (action) {
      list.push({
        id: action.id,
        label: action.label,
        click: action.click || null,
        run: action.run || null,
        scale: action.scale || null,
        delta: action.delta || 0,
        keys: cloneCombo(action.keys)
      });
    });
    return list;
  }

  function defaultMap(cfg) {
    var out = {};
    cfg.actions.forEach(function (action) {
      out[action.id] = sortKeys(cloneCombo(action.keys));
    });
    return out;
  }

  function normalizeStoredCombo(combo) {
    if (!Array.isArray(combo)) return null;
    var keys = sortKeys(combo.filter(function (key) {
      return typeof key === 'string' && (KEY_NAMES[key] || isModifierKey(key) || KEY_ORDER[key] !== undefined);
    }));
    return keys.length ? keys : null;
  }

  function loadSaved(cfg) {
    var result = defaultMap(cfg);
    try {
      var text = localStorage.getItem(STORE_PREFIX + cfg.page);
      if (!text) return result;
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') return result;
      cfg.actions.forEach(function (action) {
        var combo = normalizeStoredCombo(parsed[action.id]);
        if (combo) result[action.id] = combo;
      });
    } catch (e) {}
    return result;
  }

  function persistSaved() {
    try {
      localStorage.setItem(STORE_PREFIX + active.page, JSON.stringify(saved));
    } catch (e) {}
  }

  function rebuildRuntimeMap() {
    runtimeMap = {};
    active.actions.forEach(function (action) {
      var sig = comboSignature(saved[action.id]);
      if (sig && !runtimeMap[sig]) runtimeMap[sig] = action;
    });
  }

  function nudge(inputId, delta) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var value = parseFloat(input.value);
    var min = parseFloat(input.min);
    var max = parseFloat(input.max);
    if (!isFinite(value)) value = 0;
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 100;
    value = Math.max(min, Math.min(max, value + delta));
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function runAction(action) {
    if (!action) return;
    if (action.scale) {
      nudge(action.scale, action.delta);
    } else if (action.click) {
      var el = document.getElementById(action.click);
      if (el) el.click();
    } else if (typeof action.run === 'function') {
      action.run();
    }
    if (active && typeof active.after === 'function') active.after();
  }

  function currentHeldKeys(e) {
    var keys = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.shiftKey) keys.push('Shift');
    if (e.altKey) keys.push('Alt');
    Object.keys(heldNonModifiers).forEach(function (key) {
      if (heldNonModifiers[key]) keys.push(key);
    });
    return sortKeys(keys);
  }

  function clearHeldKeys() {
    heldNonModifiers = {};
    pendingModifierSig = null;
  }

  function shortcutOpen() {
    return !!shortModal && !shortModal.classList.contains('hidden');
  }

  function cancelCapture() {
    if (!capture) return;
    capture = null;
    refreshRows();
  }

  function commitCapture() {
    if (!capture) return;
    var actionId = capture.actionId;
    var keys = sortKeys(capture.keys);
    if (keys.length) draft[actionId] = keys;
    capture = null;
    refreshRows();
  }

  function startCapture(actionId, el) {
    if (capture && capture.actionId === actionId) return;
    capture = null;
    refreshRows();
    capture = { actionId: actionId, el: el, keys: [] };
    el.classList.add('scs-selected');
    fitCombo(el);
  }

  function handleCaptureKeyDown(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isIgnoredKey(e)) return;
    if (!capture) return;
    if (e.ctrlKey && !include(capture.keys, 'Ctrl')) capture.keys.push('Ctrl');
    if (e.shiftKey && !include(capture.keys, 'Shift')) capture.keys.push('Shift');
    if (e.altKey && !include(capture.keys, 'Alt')) capture.keys.push('Alt');
    var keyId = keyIdFromEvent(e);
    if (!keyId || e.repeat) return;
    if (!include(capture.keys, keyId)) capture.keys.push(keyId);
    capture.el.textContent = formatCombo(capture.keys);
    capture.el.classList.add('scs-selected');
    fitCombo(capture.el);
  }

  function handleCaptureKeyUp(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!capture) return;
    if (isIgnoredKey(e)) return;
    var keyId = keyIdFromEvent(e);
    if (!keyId) return;
    if (include(capture.keys, keyId)) commitCapture();
  }

  function getConflicts() {
    var counts = {};
    active.actions.forEach(function (action) {
      var sig = comboSignature(draft[action.id]);
      if (sig) counts[sig] = (counts[sig] || 0) + 1;
    });
    return counts;
  }

  function fitCombo(el) {
    if (!el || !el.offsetParent) return;
    el.style.fontSize = '';
    var base = parseFloat(window.getComputedStyle(el).fontSize);
    if (!isFinite(base) || base <= 0) return;
    if (el.scrollWidth <= el.clientWidth + 0.5) return;
    var min = base * 0.5;
    var size = base;
    while (size > min && el.scrollWidth > el.clientWidth + 0.5) {
      size = Math.max(min, size - Math.max(0.5, base * 0.04));
      el.style.fontSize = size + 'px';
    }
  }

  function fitAllCombos() {
    Object.keys(shortRows).forEach(function (id) { fitCombo(shortRows[id]); });
  }

  function refreshRows() {
    if (!active || !shortBody) return;
    var conflicts = getConflicts();
    active.actions.forEach(function (action) {
      var el = shortRows[action.id];
      if (!el) return;
      var sig = comboSignature(draft[action.id]);
      el.textContent = formatCombo(draft[action.id]);
      el.classList.toggle('scs-selected', !!(capture && capture.actionId === action.id));
      el.classList.toggle('scs-conflict', !!sig && conflicts[sig] > 1);
      fitCombo(el);
    });
    if (shortScrollUpdate) shortScrollUpdate();
  }

  function selectShortcutRow(actionId) {
    if (!shortRows[actionId]) return;
    startCapture(actionId, shortRows[actionId]);
  }

  function openShortcutSettings() {
    if (!active || !shortModal) return;
    capture = null;
    clearHeldKeys();
    draft = cloneMap(saved);
    refreshRows();
    if (shortBody) shortBody.scrollTop = 0;
    shortModal.classList.remove('hidden');
    window.requestAnimationFrame(function () {
      fitAllCombos();
      if (shortScrollUpdate) shortScrollUpdate();
    });
  }

  function closeShortcutSettings() {
    capture = null;
    clearHeldKeys();
    if (shortModal) shortModal.classList.add('hidden');
  }

  function applyShortcutSettings() {
    saved = cloneMap(draft);
    persistSaved();
    rebuildRuntimeMap();
    closeShortcutSettings();
  }

  function resetShortcutSettings() {
    capture = null;
    clearHeldKeys();
    draft = cloneMap(defaults);
    refreshRows();
    fitAllCombos();
  }

  function onDocumentMouseDown(e) {
    if (!capture || e.button !== 0) return;
    var target = e.target;
    var combo = target && target.closest ? target.closest('.scs-combo') : null;
    if (combo !== capture.el) cancelCapture();
  }

  function onGlobalKeyDown(e) {
    if (!active) return;
    if (shortcutOpen()) {
      if (capture) handleCaptureKeyDown(e);
      else e.stopImmediatePropagation();
      return;
    }
    if (isEditableTarget(e.target)) {
      clearHeldKeys();
      return;
    }

    if (isIgnoredKey(e)) return;
    var keyId = keyIdFromEvent(e);
    if (!keyId) return;
    if (!isModifierKey(keyId)) heldNonModifiers[keyId] = true;

    var keys = currentHeldKeys(e);
    var sig = comboSignature(keys);
    var action = runtimeMap[sig];
    if (e.repeat) {
      if (action) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (action) {
      pendingModifierSig = null;
      if (isModifierOnly(keys)) {
        pendingModifierSig = sig;
      } else {
        runAction(action);
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    pendingModifierSig = null;
  }

  function onGlobalKeyUp(e) {
    if (!active) return;
    if (shortcutOpen()) {
      if (capture) handleCaptureKeyUp(e);
      else e.stopImmediatePropagation();
      return;
    }
    if (isEditableTarget(e.target)) {
      clearHeldKeys();
      return;
    }

    if (!isIgnoredKey(e)) {
      var keyId = keyIdFromEvent(e);
      if (keyId && !isModifierKey(keyId)) delete heldNonModifiers[keyId];
    }

    if (pendingModifierSig) {
      var keys = currentHeldKeys(e);
      if (!keys.length) {
        var action = runtimeMap[pendingModifierSig];
        pendingModifierSig = null;
        if (action) {
          runAction(action);
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    }
  }

  function onWindowBlur() {
    clearHeldKeys();
  }

  function onWindowResize() {
    if (shortcutOpen()) {
      fitAllCombos();
      if (shortScrollUpdate) shortScrollUpdate();
    }
  }

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function buildShortcutUI(cfg) {
    var settingsModal = document.getElementById(cfg.def.modal);
    var settingsPage = settingsModal && settingsModal.querySelector('.settings-page');
    if (!settingsPage) return;

    var openBtn = element('button', 'start-join-btn scs-open-btn', '快捷键设置');
    openBtn.type = 'button';
    openBtn.id = 'scs-open-btn';
    settingsPage.appendChild(openBtn);

    var modal = element('div', 'modal hidden');
    modal.id = MODAL_ID;
    var page = element('div', 'settings-page scs-page');
    var back = element('button', 'start-join-btn scs-back', '返回');
    back.type = 'button';
    var frame = element('div', 'settings-frame');
    var scroll = element('div', 'settings-scroll');
    var body = element('div', 'settings-body scs-body');
    var scrollbar = element('div', 'settings-scrollbar');
    scrollbar.id = 'scs-scrollbar';
    var thumb = element('div', 'settings-scrollbar-thumb');
    thumb.id = 'scs-scrollbar-thumb';
    scrollbar.appendChild(thumb);
    scroll.appendChild(body);
    scroll.appendChild(scrollbar);
    var foot = element('div', 'settings-foot');
    var apply = element('button', 'btn', '应用');
    apply.type = 'button';
    var reset = element('button', 'btn', '设为默认');
    reset.type = 'button';
    foot.appendChild(apply);
    foot.appendChild(reset);
    frame.appendChild(scroll);
    frame.appendChild(foot);
    page.appendChild(back);
    page.appendChild(frame);
    modal.appendChild(page);
    document.body.appendChild(modal);

    shortModal = modal;
    shortBody = body;
    shortPage = page;
    shortRows = {};

    active.actions.forEach(function (action) {
      var row = element('div', 'setting-row scs-shortcut-row');
      var label = element('span', 'setting-label scs-shortcut-label', action.label);
      var combo = element('button', 'scs-combo', formatCombo(draft[action.id]));
      combo.type = 'button';
      combo.dataset.action = action.id;
      combo.addEventListener('click', function () { selectShortcutRow(action.id); });
      row.appendChild(label);
      row.appendChild(combo);
      body.appendChild(row);
      shortRows[action.id] = combo;
    });

    openBtn.addEventListener('click', openShortcutSettings);
    back.addEventListener('click', closeShortcutSettings);
    apply.addEventListener('click', applyShortcutSettings);
    reset.addEventListener('click', resetShortcutSettings);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeShortcutSettings();
    });

    if (window.Profile && typeof Profile.wireScrollbar === 'function') {
      shortScrollUpdate = Profile.wireScrollbar(body, scrollbar, thumb);
    }
    requestAnimationFrame(function () {
      if (shortScrollUpdate) shortScrollUpdate();
    });
  }

  function attach(options) {
    options = options || {};
    var def = PAGE_DEFS[options.page];
    if (!def) return;
    active = {
      page: options.page,
      def: def,
      actions: buildActions(def),
      after: typeof options.after === 'function' ? options.after : null
    };
    saved = loadSaved(active);
    draft = cloneMap(saved);
    defaults = defaultMap(active);
    rebuildRuntimeMap();
    buildShortcutUI(active);
  }

  window.addEventListener('keydown', onGlobalKeyDown, true);
  window.addEventListener('keyup', onGlobalKeyUp, true);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('mousedown', onDocumentMouseDown, true);

  window.SettingsShortcuts = { attach: attach };
})();
