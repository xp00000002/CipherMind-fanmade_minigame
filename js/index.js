/* index.js - 开始界面逻辑 + 个人设置 */
(function () {
  'use strict';

  var PIECE_IMG = {
    w: { p: 'texture/pawn2.png', n: 'texture/knight2.png', b: 'texture/bishop2.png', r: 'texture/rook2.png', q: 'texture/queen2.png', k: 'texture/king2.png' },
    b: { p: 'texture/pawn.png', n: 'texture/knight.png', b: 'texture/bishop.png', r: 'texture/rook.png', q: 'texture/queen.png', k: 'texture/king.png' }
  };

  var btnStart = document.getElementById('btn-start');
  var startWrap = document.querySelector('.start-wrap');
  var lobbyModal = document.getElementById('lobby-modal');
  var openRoomsEl = document.getElementById('open-rooms');
  var joinModal = document.getElementById('join-modal');
  var joinInput = document.getElementById('join-id-input');
  var errorModal = document.getElementById('error-modal');
  var errorText = document.getElementById('error-text');
  var profileModal = document.getElementById('profile-modal');
  var profileName = document.getElementById('profile-name');
  var avatarPreview = document.getElementById('avatar-preview');
  var avatarGrid = document.getElementById('avatar-grid');
  var bgColorInput = document.getElementById('bg-color-input');
  var bgPreview = document.getElementById('bg-preview');
  var errorReturn = null;

  // 个人设置自定义滚动条（内容超长时出现，公共实现见 profile.js）
  var updateProfileScrollbar = Profile.wireScrollbar(
    document.getElementById('profile-body'),
    document.getElementById('profile-scrollbar'),
    document.getElementById('profile-scrollbar-thumb')
  );
  window.addEventListener('resize', updateProfileScrollbar);

  function show(el) {
    el.classList.remove('hidden');
    Profile.adjustBtnHitAreas();   /* 弹窗按钮出现后重算热区 */
  }
  function hide(el) { el.classList.add('hidden'); }

  Profile.adjustBtnHitAreas();
  window.addEventListener('resize', Profile.adjustBtnHitAreas);

  /* ---------- 游戏切换（主界面下方 < 1/2 > 选择框） ---------- */
  var GAMES = [
    { title: 'Chess', img: 'texture/chessintro.png', page: 'game.html', game: 'chess' },
    { title: 'Freecell', img: 'texture/freecellintro.png', page: 'freecell.html', game: 'freecell' },
    { title: 'Klondike Solitaire', img: 'texture/klondikesolitaireintro.png', page: 'klondike.html', game: 'klondike' },
    { title: 'Spider Solitaire', img: 'texture/spidersolitaireintro.png', page: 'spider.html', game: 'spider' },
    { title: 'Compare', img: 'texture/compareintro.png', page: 'zjh.html', game: 'zjh' },
    { title: 'Battle', img: 'texture/battleintro.png', page: 'battle.html', game: 'battle' },
    { title: 'Turn Left', img: 'texture/turnleftintro.png', page: '', game: 'turnleft' }
  ];
  var gameIdx = 0;
  try {
    var savedGame = parseInt(localStorage.getItem('cmchessGame'), 10);
    if (!isNaN(savedGame) && savedGame >= 0 && savedGame < GAMES.length) gameIdx = savedGame;
  } catch (e) {}
  var switchLabel = document.getElementById('switch-label');
  var switchPrev = document.getElementById('switch-prev');
  var switchNext = document.getElementById('switch-next');
  var startTitle = document.querySelector('.start-title');
  var startImg = document.querySelector('.start-img');
  function applyGame() {
    var g = GAMES[gameIdx];
    if (switchLabel) switchLabel.textContent = (gameIdx + 1) + '/' + GAMES.length;
    if (startTitle) startTitle.textContent = g.title;
    if (startImg) { startImg.src = g.img; startImg.alt = g.title; }
    document.title = g.title;
    try { localStorage.setItem('cmchessGame', gameIdx); } catch (e) {}   /* 返回主界面时回到相应游戏窗口 */
  }
  if (switchPrev) switchPrev.addEventListener('click', function () {
    gameIdx = (gameIdx - 1 + GAMES.length) % GAMES.length;
    applyGame();
  });
  if (switchNext) switchNext.addEventListener('click', function () {
    gameIdx = (gameIdx + 1) % GAMES.length;
    applyGame();
  });
  applyGame();

  /* ---------- 主界面 ---------- */
  // 开放房间注册表（本地模拟，供测试）：房主创建开放房间时写入，3 分钟过期；按游戏类型区分
  var OPEN_ROOMS_KEY = 'cmchessOpenRooms';
  function getOpenRooms() {
    var list = [];
    try {
      var raw = JSON.parse(localStorage.getItem(OPEN_ROOMS_KEY));
      if (raw && Array.isArray(raw)) list = raw;
    } catch (e) {}
    var now = Date.now();
    var game = GAMES[gameIdx].game;
    return list.filter(function (r) { return r && r.game === game && r.id && now - (r.ts || 0) < 180000; });
  }
  function renderOpenRooms() {
    var lobbyBody = document.getElementById('lobby-body');
    var prevScroll = lobbyBody ? lobbyBody.scrollTop : 0;
    openRoomsEl.innerHTML = '';
    getOpenRooms().forEach(function (room) {
      var b = document.createElement('button');
      b.className = 'room-btn open';
      b.type = 'button';
      var bar = document.createElement('span');
      bar.className = 'room-bar';
      var host = document.createElement('span');
      host.className = 'room-host';
      host.textContent = room.hostName || 'Player';
      var rules = document.createElement('span');
      rules.className = 'room-rules';
      rules.textContent = (room.rules || 'Default') + (room.gameStarted ? ' | 已开局' : '');
      var arrow = document.createElement('img');
      arrow.className = 'room-arrow';
      arrow.src = 'texture/rightarrow.png';
      arrow.alt = '';
      b.appendChild(bar);
      b.appendChild(host);
      b.appendChild(rules);
      b.appendChild(arrow);
      b.addEventListener('click', function () {
        /* Freecell/Klondike 房间：以观战身份进入；Chess 已开局房间同；未开局的 Chess 房间以对局者进入 */
        if (room.game === 'chess') {
          location.href = 'game.html?mode=join&id=' + encodeURIComponent(room.id) + (room.gameStarted ? '&spec=1' : '');
          return;
        }
        location.href = GAMES[gameIdx].page + '?mode=join&id=' + encodeURIComponent(room.id) + '&spec=1' + (room.gameStarted ? '&started=1' : '');
      });
      openRoomsEl.appendChild(b);
    });
    if (lobbyBody) lobbyBody.scrollTop = prevScroll;   /* 自动刷新时保持翻页位置 */
  }

  // 选房界面自动刷新：其他标签页开房/改设置后无需手动刷新即可同步显示
  var lobbyTimer = null;
  function startLobbyAutoRefresh() {
    stopLobbyAutoRefresh();
    lobbyTimer = setInterval(renderOpenRooms, 1500);
  }
  function stopLobbyAutoRefresh() {
    if (lobbyTimer) { clearInterval(lobbyTimer); lobbyTimer = null; }
  }

  // 选房界面：两种游戏均显示输入房间码与开放房间列表
  function setupLobbyForGame() {
    var joinBtn = document.getElementById('btn-join-room');
    if (joinBtn) joinBtn.classList.remove('hidden');
    openRoomsEl.classList.remove('hidden');
  }

  // 开始游戏：Turn Left 先进入“游戏模式选择”（隐藏主界面，返回时恢复）；其余进入选房界面
  btnStart.addEventListener('click', function () {
    if (GAMES[gameIdx].game === 'turnleft') {
      hide(startWrap);
      show(document.getElementById('tl-mode-modal'));
      return;
    }
    renderOpenRooms();
    setupLobbyForGame();
    hide(startWrap);
    show(lobbyModal);
    startLobbyAutoRefresh();
  });

  document.getElementById('tl-mode-back').addEventListener('click', function () {
    hide(document.getElementById('tl-mode-modal'));
    show(startWrap);
  });

  /* ==================== Turn Left：关卡集管理 ==================== */
  var tlEntry = 'campaign';      // campaign | workshop
  var tlWorkshopEdit = false;    // 工坊：编辑模式？
  var tlSets = [];               // { name, count, tasks }
  var tlSel = null;
  var tlSetsModal = document.getElementById('tl-sets-modal');
  var tlSetsList = document.getElementById('tl-sets-list');
  var tlSetsEmpty = document.getElementById('tl-sets-empty');
  var tlRightBtn = document.getElementById('tl-sets-right');
  var tlFolderBtn = document.getElementById('tl-sets-folder');
  var tlModeBtn = document.getElementById('tl-sets-mode');
  var tlTopRight = document.getElementById('tl-topright');

  function parseSetJson(text, name, keepRaw) {
    var data = JSON.parse(text);
    var arr = Array.isArray(data) ? data : [data];
    var levelsArr = arr.filter(function (x) { return x && typeof x === 'object'; });
    if (!levelsArr.length) return null;
    var taskTotal = 0;
    levelsArr.forEach(function (lvl) {
      if (lvl && Array.isArray(lvl.tasks)) taskTotal += lvl.tasks.length;
    });
    var s = { name: name, count: levelsArr.length, tasks: taskTotal };
    if (keepRaw) s.raw = text;
    return s;
  }
  function renderTlSets(hint) {
    tlSetsList.innerHTML = '';
    tlSel = null;
    tlRightBtn.textContent = '';
    if (hint) {
      tlSetsEmpty.style.display = '';
      tlSetsEmpty.textContent = hint;
      tlSetsEmpty.className = 'tl-sets-hint';
      renderTlFooter();
      return;
    }
    if (!tlSets.length) {
      tlSetsEmpty.style.display = '';
      tlSetsEmpty.textContent = tlEntry === 'workshop' ? '点击左上角「打开文件夹」选择关卡目录' : '没有可用的关卡集';
      tlSetsEmpty.className = 'tl-sets-hint';
      renderTlFooter();
      return;
    }
    tlSetsEmpty.style.display = 'none';
    tlSets.forEach(function (set) {
      var row = document.createElement('div');
      row.className = 'tl-sets-row';
      var bar = document.createElement('span');
      bar.className = 'tl-bar';
      var nameEl = document.createElement('span');
      nameEl.className = 'tl-name';
      nameEl.textContent = set.name;
      var descEl = document.createElement('span');
      descEl.className = 'tl-desc';
      descEl.textContent = set.count + '个关卡' + (set.tasks ? ' | ' + set.tasks + '个任务' : '');
      row.appendChild(bar);
      row.appendChild(nameEl);
      row.appendChild(descEl);
      row.addEventListener('click', function () {
        if (tlEntry === 'workshop') {
          if (!tlWorkshopEdit) {
            /* 游玩模式：点击直接进入游玩界面 */
            location.href = 'turnleft-play.html?set=' + encodeURIComponent(set.name) + '&mode=workshop';
            return;
          }
        } else {
          /* 闯关模式：点击进入游玩界面 */
          location.href = 'turnleft-play.html?set=' + encodeURIComponent(set.name) + '&mode=campaign';
          return;
        }
        tlSel = set;
        renderTlFooter();
        var rows = tlSetsList.querySelectorAll('.tl-sets-row');
        rows.forEach(function (r) { r.classList.remove('sel'); });
        row.classList.add('sel');
      });
      tlSetsList.appendChild(row);
    });
    renderTlFooter();
  }
  function renderTlFooter() {
    var hasSel = !!tlSel;
    if (tlEntry === 'campaign') {
      tlRightBtn.classList.remove('hidden');
      tlRightBtn.textContent = '查看统计';
      return;
    }
    if (tlWorkshopEdit) {
      tlRightBtn.classList.remove('hidden');
      tlRightBtn.textContent = hasSel ? '编辑关卡集' : '新建关卡集';
    } else {
      /* 游玩模式：隐藏右侧按钮，“返回”独占整行 */
      tlRightBtn.classList.add('hidden');
      tlRightBtn.textContent = '';
    }
  }
  /* ---- 工坊目录句柄（FS API + IndexedDB，供制作器 startIn 定位） ---- */
  var TL_DIR_DB = 'tl-dir-db';
  var TL_DIR_KEY = 'workshop';
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(TL_DIR_DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('dirs'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbSaveDir(handle) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('dirs', 'readwrite');
        tx.objectStore('dirs').put(handle, TL_DIR_KEY);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGetDir() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('dirs', 'readonly');
        var req = tx.objectStore('dirs').get(TL_DIR_KEY);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  async function readDirHandle(root) {
    var loaded = [];
    async function walk(dir) {
      for await (var entry of dir.values()) {
        if (entry.kind === 'directory') { await walk(entry); continue; }
        if (!/\.json$/i.test(entry.name)) continue;
        var file = await entry.getFile();
        var text = await file.text();
        try {
          var s = parseSetJson(text, entry.name.replace(/\.json$/i, ''), true);
          if (s) loaded.push(s);
        } catch (e) {}
      }
    }
    await walk(root);
    loaded.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    tlSets = loaded;
    try { localStorage.setItem('tlWorkshopFolder', JSON.stringify(tlSets)); } catch (e) {}
    renderTlSets(null);
  }
  var techNoticeFn = null;
  function techNoticeSuppressed() {
    try { return localStorage.getItem('tlHideFolderTechNotice') === '1'; } catch (e) { return false; }
  }
  function showTechNotice(msg, action) {
    document.getElementById('tech-notice-msg').textContent = msg;
    techNoticeFn = action || null;
    document.getElementById('tech-notice-modal').classList.remove('hidden');
  }
  document.getElementById('tech-notice-ok').addEventListener('click', function () {
    var fn = techNoticeFn;
    techNoticeFn = null;
    document.getElementById('tech-notice-modal').classList.add('hidden');
    if (fn) fn();
  });
  document.getElementById('tech-notice-no').addEventListener('click', function () {
    try { localStorage.setItem('tlHideFolderTechNotice', '1'); } catch (e) {}
    var fn = techNoticeFn;
    techNoticeFn = null;
    document.getElementById('tech-notice-modal').classList.add('hidden');
    if (fn) fn();
  });

  function refreshWorkshopFromHandle(done) {
    idbGetDir().then(function (h) {
      if (!h) { if (done) done(false); return; }
      readDirHandle(h).then(function () { if (done) done(true); })
        .catch(function () { if (done) done(false); });
    }).catch(function () { if (done) done(false); });
  }
  function pickWorkshopDir() {
    if (!window.showDirectoryPicker) {
      document.getElementById('tl-folder-input').click();
      return;
    }
    window.showDirectoryPicker({ mode: 'read' }).then(function (handle) {
      idbSaveDir(handle).catch(function () {});
      return readDirHandle(handle);
    }).catch(function (err) {
      if (!err || err.name !== 'AbortError') renderTlSets('读取文件夹失败：' + (err && err.message ? err.message : err));
    });
  }

  function campaignMain61Done() {
    try {
      var arr = JSON.parse(window.TURNLEFT_CAMPAIGN_JSON || 'null');
      if (!Array.isArray(arr)) return false;
      var idx = -1;
      for (var i = 0; i < arr.length; i++) if ((arr[i].name || '') === '6-1') { idx = i; break; }
      if (idx < 0) return false;
      var o = JSON.parse(localStorage.getItem('tlCampaignSave:TurnLeft') || 'null');
      return !!(o && o.levels && o.levels[idx] && o.levels[idx].done);
    } catch (e) { return false; }
  }
  /* 旧存档（Levels 键）一次性迁移到 TurnLeft，避免误判解锁/丢失进度 */
  (function migrateCampaignSave() {
    try {
      if (localStorage.getItem('tlCampaignSave:TurnLeft')) return;
      var old = localStorage.getItem('tlCampaignSave:Levels');
      if (!old) return;
      localStorage.setItem('tlCampaignSave:TurnLeft', old);
      localStorage.removeItem('tlCampaignSave:Levels');
    } catch (e) {}
  })();
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
  /* 闯关模式的特殊关卡集（均在完成 6-1 后解锁；文件放入 turnleft-levels 后即自动可用） */
  var TL_SPECIAL_SETS = [
    { name: 'Oneshot', g: 'TURNLEFT_ONESHOT_JSON' },
    { name: 'Endportal', g: 'TURNLEFT_ENDPORTAL_JSON' },
    { name: 'Island', g: 'TURNLEFT_ISLAND_JSON' },
    { name: 'Symmetrical', g: 'TURNLEFT_SYMMETRICAL_JSON' },
    { name: 'Multiportal', g: 'TURNLEFT_MULTIPORTAL_JSON' },
    { name: 'Giant', g: 'TURNLEFT_GIANT_JSON' }
  ];
  function openCampaignStats() {
    var body = document.getElementById('campaign-stats-body');
    body.innerHTML = '';
    var sections = [
      { name: 'Turn Left', json: window.TURNLEFT_CAMPAIGN_JSON, key: 'tlCampaignSave:TurnLeft' }
    ];
    if (campaignMain61Done()) {
      TL_SPECIAL_SETS.forEach(function (s) {
        sections.push({ name: s.name, json: window[s.g], key: 'tlCampaignSave:' + s.name });
      });
    }
    sections.forEach(function (sec, si) {
      var arr = [];
      try { arr = JSON.parse(sec.json || 'null') || []; } catch (e) {}
      arr = arr.filter(function (x) { return x && typeof x === 'object'; });
      if (!arr.length) return;   /* 未加入/无效的关卡集不显示统计 */
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(sec.key) || 'null'); } catch (e) {}
      var doneN = 0, bestN = 0, tasksDone = 0, tasksTotal = 0;
      arr.forEach(function (lvl, i) {
        tasksTotal += taskCountOf(lvl);
        var rec = saved && saved.levels && saved.levels[i];
        if (!rec || !rec.done) return;
        doneN++;
        if (typeof lvl.minstep === 'number' && typeof rec.best === 'number' && lvl.minstep === rec.best) bestN++;
        if (Array.isArray(rec.doneTasks)) {
          tasksDone += rec.doneTasks.length;
        } else if (Array.isArray(rec.tasks)) {
          rec.tasks.forEach(function (ok) { if (ok) tasksDone++; });
        }
      });
      if (si > 0) {
        /* 段与段之间只留少量空白，不加分割线 */
      }
      var title = document.createElement('div');
      title.className = 'tl-record-title';
      title.textContent = sec.name;
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
      row('完成的关卡数', doneN + '/' + arr.length);
      row('以最少步数完成的关卡', bestN + '/' + arr.length);
      row('完成的任务数', tasksDone + '/' + tasksTotal);
    });
    document.getElementById('campaign-stats-modal').classList.remove('hidden');
  }
  var askConfirmFn = null;
  function openAsk(title, msg, fn) {
    document.getElementById('ask-confirm-title').textContent = title;
    document.getElementById('ask-confirm-msg').textContent = msg;
    askConfirmFn = fn;
    document.getElementById('confirm-ask-modal').classList.remove('hidden');
  }
  document.getElementById('ask-confirm-no').addEventListener('click', function () {
    askConfirmFn = null;
    document.getElementById('confirm-ask-modal').classList.add('hidden');
  });
  document.getElementById('ask-confirm-yes').addEventListener('click', function () {
    var fn = askConfirmFn;
    askConfirmFn = null;
    document.getElementById('confirm-ask-modal').classList.add('hidden');
    if (fn) fn();
  });
  document.getElementById('btn-camp-stats-del').addEventListener('click', function () {
    openAsk('删除存档', '确定删除闯关模式的所有存档吗？此操作不可恢复。', function () {
      ['tlCampaignSave:TurnLeft', 'tlCampaignSave:Oneshot', 'tlCampaignSave:Endportal', 'tlCampaignSave:Levels'].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (e) {}
      });
      openCampaignStats();
      showError('存档已删除');
    });
  });

  function openTlSets(entry) {    tlEntry = entry;
    tlWorkshopEdit = false;
    tlSets = [];
    tlSel = null;
    tlFolderBtn.classList.toggle('hidden', entry !== 'workshop');
    tlTopRight.classList.toggle('hidden', entry !== 'workshop');
    tlModeBtn.textContent = '游玩模式';
    tlRightBtn.classList.add('hidden');
    tlRightBtn.textContent = '';
    if (entry === 'workshop') {
      /* 优先恢复上次打开过的目录内容 */
      var restored = null;
      try {
        var cached = JSON.parse(localStorage.getItem('tlWorkshopFolder') || 'null');
        if (Array.isArray(cached) && cached.length) restored = cached;
      } catch (e) {}
      tlSets = restored || [];
      renderTlSets(null);
    } else {
      /* 闯关模式：Turn Left 主线 + 完成 6-1 后解锁的 Oneshot / Endportal */
      tlSets = [];
      var addSet = function (json, name) {
        if (!json) return;
        try {
          var s = parseSetJson(json, name);
          if (s) tlSets.push(s);
        } catch (e) {}
      };
      addSet(window.TURNLEFT_CAMPAIGN_JSON || '', 'TurnLeft');
      if (campaignMain61Done()) {
        TL_SPECIAL_SETS.forEach(function (s) {
          addSet(window[s.g] || '', s.name);
        });
      }
      if (!tlSets.length) renderTlSets('内置关卡数据缺失或损坏');
      else renderTlSets(null);
    }
    hide(document.getElementById('tl-mode-modal'));
    show(tlSetsModal);
  }
  document.getElementById('tl-mode-workshop').addEventListener('click', function () { openTlSets('workshop'); });
  document.getElementById('tl-mode-level').addEventListener('click', function () { openTlSets('campaign'); });
  document.getElementById('btn-camp-stats-close').addEventListener('click', function () { document.getElementById('campaign-stats-modal').classList.add('hidden'); });
  document.getElementById('tl-sets-back').addEventListener('click', function () {
    hide(tlSetsModal);
    show(startWrap);
  });
  document.getElementById('tl-sets-folder').addEventListener('click', pickWorkshopDir);
  document.getElementById('tl-sets-refresh').addEventListener('click', function () {
    refreshWorkshopFromHandle(function (ok) {
      if (ok) return;
      if (techNoticeSuppressed()) { pickWorkshopDir(); return; }
      showTechNotice('由于技术原因，你需要重新选择文件夹才可以刷新目录。', function () {
        pickWorkshopDir();
      });
    });
  });
  document.getElementById('tl-sets-mode').addEventListener('click', function () {
    tlWorkshopEdit = !tlWorkshopEdit;
    tlSel = null;
    tlModeBtn.textContent = tlWorkshopEdit ? '编辑模式' : '游玩模式';
    var rows = tlSetsList.querySelectorAll('.tl-sets-row');
    rows.forEach(function (r) { r.classList.remove('sel'); });
    renderTlFooter();
  });
  document.getElementById('tl-sets-right').addEventListener('click', function () {
    if (tlEntry === 'workshop') {
      var go = null;
      if (tlWorkshopEdit && tlSel) {
        /* 编辑关卡集：把原始 JSON 与文件名暂存，跳转制作器后自动载入 */
        go = function () {
          try {
            localStorage.setItem('tlWorkshopEditRaw', tlSel.raw || '');
            localStorage.setItem('tlWorkshopEditName', tlSel.name || '');
          } catch (e) {}
          location.href = 'turnleft-workshop.html?action=edit';
        };
      } else {
        go = function () { location.href = 'turnleft-workshop.html?action=new'; };
      }
      if (!campaignMain61Done()) {
        openAsk('提示', '建议先通过主线 6-1 了解全部游戏机制后再编辑关卡。', go);
      } else {
        go();
      }
      return;
    }
    openCampaignStats();
  });
  document.getElementById('tl-folder-input').addEventListener('change', function (ev) {
    var files = ev.target.files ? Array.prototype.slice.call(ev.target.files) : [];
    this.value = '';
    if (!files.length) return;
    var jsonFiles = files.filter(function (f) { return /\.json$/i.test(f.name); });
    var pending = jsonFiles.slice();
    var loaded = [];
    var step = function () {
      if (!pending.length) {
        loaded.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        tlSets = loaded;
        try { localStorage.setItem('tlWorkshopFolder', JSON.stringify(tlSets)); } catch (e) {}
        renderTlSets(null);
        return;
      }
      var f = pending.shift();
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var nm = f.webkitRelativePath ? f.webkitRelativePath : f.name;
          nm = nm.replace(/\.json$/i, '');
          var s = parseSetJson(rd.result, nm.split('/').pop(), true);
          if (s) loaded.push(s);
        } catch (e) {}
        step();
      };
      rd.onerror = function () { step(); };
      rd.readAsText(f);
    };
    step();
  });

  document.getElementById('btn-lobby-back').addEventListener('click', function () {
    hide(lobbyModal);
    stopLobbyAutoRefresh();
    show(startWrap);   /* 返回时恢复主界面 */
  });
  document.getElementById('btn-lobby-create').addEventListener('click', function () {
    if (gameIdx > 0) {
      location.href = GAMES[gameIdx].page + '?mode=host';   /* Freecell/Klondike：开房并游玩 */
      return;
    }
    try { sessionStorage.setItem('cmchess-host-launch', '1'); } catch (e) {}
    location.href = 'game.html?mode=host';   /* 与原来点击"开始游戏"相同 */
  });
  document.getElementById('btn-lobby-refresh').addEventListener('click', function () {
    renderOpenRooms();
  });
  document.getElementById('btn-join-room').addEventListener('click', function () {
    joinInput.value = '';
    hide(lobbyModal);
    show(joinModal);
    joinInput.focus();
  });
  Profile.wireModalOutsideClick(lobbyModal, function () {
    hide(lobbyModal);
    stopLobbyAutoRefresh();
    show(startWrap);   /* 点击外部同样恢复主界面 */
  });

  function showError(msg, returnTo) {
    errorText.textContent = msg;
    errorReturn = returnTo || null;
    if (returnTo) hide(returnTo);
    show(errorModal);
  }

  function closeError() {
    hide(errorModal);
    if (errorReturn) {
      show(errorReturn);
      if (errorReturn === joinModal) joinInput.focus();
    }
  }

  document.getElementById('btn-join-back').addEventListener('click', function () {
    hide(joinModal);
    show(lobbyModal);   /* 返回选房界面 */
  });
  function doJoin() {
    var id = joinInput.value.trim();
    if (!id) { showError('请输入房间号', joinModal); return; }
    if (!/^[0-9a-zA-Z\-_]+$/.test(id)) { showError('房间号格式不正确（只能包含字母、数字、-、_）', joinModal); return; }
    /* 输入房间码：以观战身份进入当前游戏 */
    location.href = GAMES[gameIdx].page + '?mode=join&id=' + encodeURIComponent(id) + '&spec=1';
  }
  document.getElementById('btn-join-spec').addEventListener('click', doJoin);
  document.getElementById('btn-join-confirm').addEventListener('click', function () {
    var id = joinInput.value.trim();
    if (!id) { showError('请输入房间号', joinModal); return; }
    if (!/^[0-9a-zA-Z\-_]+$/.test(id)) { showError('房间号格式不正确（只能包含字母、数字、-、_）', joinModal); return; }
    location.href = GAMES[gameIdx].page + '?mode=join&id=' + encodeURIComponent(id);
  });
  document.getElementById('error-ok').addEventListener('click', closeError);
  Profile.wireModalOutsideClick(joinModal, function () {
    hide(joinModal);
    show(lobbyModal);   /* 点击外部同样返回选房界面 */
  });
  Profile.wireModalOutsideClick(errorModal, closeError);
  joinInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doJoin();
  });

  /* ---------- 个人设置 ---------- */
  // 临时编辑状态（保存时才写入 Profile）
  var draft = { name: '', avatar: 'default', avatarData: '', bgColor: '', bgImage: '', avatarSmooth: true, bgSmooth: true, pureBlack: false };
  // 头像自动颜色开关（默认是）
  var avatarAutoColor = true;

  function loadDraft() {
    var p = Profile.get();
    draft = { name: p.name, avatar: p.avatar, avatarData: p.avatarData, bgColor: p.bgColor, bgImage: p.bgImage, avatarSmooth: p.avatarSmooth !== false, bgSmooth: p.bgSmooth !== false, pureBlack: p.pureBlack === true };
    // 若当前棋子头像为 auto 颜色，则开关为是
    setAvatarAuto(!(draft.avatar.indexOf('piece:') === 0 && draft.avatar.indexOf('piece:auto:') !== 0));
    setAvatarSmooth(draft.avatarSmooth);
    setBgSmooth(draft.bgSmooth);
    setPureBlack(draft.pureBlack);
    updateSmoothRows();
  }

  function setPureBlack(v) {
    draft.pureBlack = v;
    var img = document.getElementById('pureblack-toggle').querySelector('img');
    img.src = 'texture/' + (v ? 'toggleon' : 'toggleoff') + '.png';
    img.alt = v ? 'on' : 'off';
  }
  document.getElementById('pureblack-toggle').addEventListener('click', function () { setPureBlack(!draft.pureBlack); });

  /* 线性插值开关（自定义头像/背景时显示，默认是） */
  function setAvatarSmooth(v) {
    draft.avatarSmooth = v;
    var img = document.getElementById('avatar-smooth-toggle').querySelector('img');
    img.src = 'texture/' + (v ? 'toggleon' : 'toggleoff') + '.png';
    img.alt = v ? 'on' : 'off';
  }
  function setBgSmooth(v) {
    draft.bgSmooth = v;
    var img = document.getElementById('bg-smooth-toggle').querySelector('img');
    img.src = 'texture/' + (v ? 'toggleon' : 'toggleoff') + '.png';
    img.alt = v ? 'on' : 'off';
  }
  function updateSmoothRows() {
    document.getElementById('avatar-smooth-row').classList.toggle('hidden', draft.avatar !== 'custom');
    document.getElementById('bg-smooth-row').classList.toggle('hidden', !draft.bgImage);
  }
  document.getElementById('avatar-smooth-toggle').addEventListener('click', function () { setAvatarSmooth(!draft.avatarSmooth); renderAvatarPreview(); });
  document.getElementById('bg-smooth-toggle').addEventListener('click', function () { setBgSmooth(!draft.bgSmooth); renderBgPreview(); });

  function avatarSrc() {
    if (draft.avatar === 'custom' && draft.avatarData) return draft.avatarData;
    if (draft.avatar && draft.avatar.indexOf('piece:') === 0) {
      var parts = draft.avatar.slice(6).split(':');
      // 根据身份变色时（无身份上下文）预览用白棋
      var color = parts[0] === 'auto' ? 'w' : parts[0];
      return PIECE_IMG[color][parts[1]];
    }
    return '';
  }

  // 渲染头像预览（图片 + 边框叠加）
  function renderAvatarPreview() {
    var src = avatarSrc();
    var s = avatarPreview.style;
    s.backgroundImage = '';
    s.backgroundSize = '';
    if (!src) {
      s.backgroundImage = 'none';
    } else {
      s.backgroundImage = 'url("' + src + '")';
      // 背景尺寸由 CSS 控制(76%)，图片不露出边框
    }
    // 棋子头像像素化；自定义图片按线性插值开关平滑或像素化
    avatarPreview.className = 'profile-preview' + (draft.avatar === 'custom' && draft.avatarSmooth ? ' smooth' : '');
  }

  // 当前选择的棋子类型（auto 或固定颜色）
  function pieceType() {
    if (draft.avatar.indexOf('piece:') !== 0) return '';
    return draft.avatar.slice(6).split(':')[1];
  }

  // 渲染棋子头像选择
  function renderAvatarGrid() {
    avatarGrid.innerHTML = '';
    var types = ['k', 'q', 'r', 'b', 'n', 'p'];
    var selType = pieceType();
    ['w', 'b'].forEach(function (color) {
      types.forEach(function (t) {
        var b = document.createElement('button');
        var isOn = avatarAutoColor
          ? (draft.avatar === 'piece:auto:' + t)
          : (draft.avatar === 'piece:' + color + ':' + t);
        b.className = 'avatar-opt' + (isOn ? ' on' : '');
        b.type = 'button';
        var img = document.createElement('img');
        img.src = PIECE_IMG[color][t];
        img.alt = t;
        img.draggable = false;
        b.appendChild(img);
        b.addEventListener('click', function () {
          // 根据身份变色：只记类型；否则记固定颜色
          draft.avatar = avatarAutoColor ? 'piece:auto:' + t : 'piece:' + color + ':' + t;
          renderAvatarGrid();
          renderAvatarPreview();
        });
        avatarGrid.appendChild(b);
      });
    });
  }

  // 中心裁剪成 1:1 并缩放到 max 尺寸
  function cropSquare(file, maxSize, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;
        var size = Math.min(maxSize, side);
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        cb(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // 根据身份更改头像颜色 开关（与设置页切换键一致）
  var avatarAutoToggle = document.getElementById('avatar-auto-toggle');
  function setAvatarAuto(v) {
    avatarAutoColor = v;
    var img = avatarAutoToggle.querySelector('img');
    img.src = 'texture/' + (v ? 'toggleon' : 'toggleoff') + '.png';
    img.alt = v ? 'on' : 'off';
  }
  avatarAutoToggle.addEventListener('click', function () {
    var v = !avatarAutoColor;
    var t = pieceType();
    if (t && draft.avatar.indexOf('piece:') === 0) {
      // 切换时保持已选棋子类型
      draft.avatar = v ? 'piece:auto:' + t : 'piece:w:' + t;
    }
    setAvatarAuto(v);
    renderAvatarGrid();
    renderAvatarPreview();
    updateSmoothRows();
  });

  // 头像设为默认
  document.getElementById('avatar-default-btn').addEventListener('click', function () {
    draft.avatar = 'default';
    draft.avatarData = '';
    renderAvatarGrid();
    renderAvatarPreview();
    updateSmoothRows();
  });

  // 背景设为默认
  document.getElementById('bg-default-btn').addEventListener('click', function () {
    draft.bgColor = '';
    draft.bgImage = '';
    bgColorInput.value = '';
    renderBgPreview();
    updateSmoothRows();
  });

  document.getElementById('btn-profile').addEventListener('click', function () {
    loadDraft();
    profileName.value = draft.name;
    bgColorInput.value = draft.bgColor;
    renderAvatarGrid();
    renderAvatarPreview();
    show(profileModal);
    updateProfileScrollbar();
  });
  Profile.wireModalOutsideClick(profileModal, function () { hide(profileModal); });
  document.getElementById('profile-cancel').addEventListener('click', function () { hide(profileModal); });
  document.getElementById('profile-save').addEventListener('click', function () {
    var name = profileName.value.trim();
    if (name.length > 20) { showError('名称最多 20 个字符', profileModal); return; }
    draft.name = name;
    var color = bgColorInput.value.trim();
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) { showError('背景颜色需为 #RRGGBB 格式（不支持透明度）', profileModal); return; }
    draft.bgColor = color;
    var p = Profile.get();
    p.name = draft.name;
    p.avatar = draft.avatar;
    p.avatarData = draft.avatarData;
    p.bgColor = draft.bgColor;
    p.bgImage = draft.bgImage;
    p.avatarSmooth = draft.avatarSmooth;
    p.bgSmooth = draft.bgSmooth;
    p.pureBlack = draft.pureBlack;
    Profile.save();
    Profile.applyBackground();
    Profile.applyPureBlack();
    hide(profileModal);
    showError('已保存');
  });

  // 头像本地图片
  document.getElementById('avatar-file-btn').addEventListener('click', function () {
    document.getElementById('avatar-file-input').click();
  });
  document.getElementById('avatar-file-input').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    cropSquare(f, 120, function (dataUrl) {
      draft.avatar = 'custom';
      draft.avatarData = dataUrl;
      renderAvatarGrid();
      renderAvatarPreview();
      updateSmoothRows();
    });
    this.value = '';
  });

  // 背景本地图片
  document.getElementById('bg-file-btn').addEventListener('click', function () {
    document.getElementById('bg-file-input').click();
  });
  document.getElementById('bg-file-input').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        // 限制最大边 1920，保持宽高比
        var max = 1920;
        var w = img.width, h = img.height;
        if (w > max || h > max) {
          var scale = Math.min(max / w, max / h);
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          draft.bgImage = canvas.toDataURL('image/png');
        } else {
          draft.bgImage = reader.result;
        }
        bgColorInput.value = '';
        renderBgPreview();
        updateSmoothRows();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    this.value = '';
  });

  bgColorInput.addEventListener('input', function () {
    draft.bgImage = '';
    renderBgPreview();
    updateSmoothRows();
  });

  function renderBgPreview() {
    var color = bgColorInput.value.trim();
    bgPreview.style.background = '';
    bgPreview.classList.remove('smooth');
    if (draft.bgImage) {
      bgPreview.style.background = 'url("' + draft.bgImage + '") center/cover no-repeat';
      if (draft.bgSmooth) bgPreview.classList.add('smooth');
    } else if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      bgPreview.style.background = color;
    }
  }

  // 页面加载时应用个人背景
  Profile.applyBackground();

  document.getElementById('disclaimer-row').addEventListener('click', function () {
    document.getElementById('disclaimer-modal').classList.remove('hidden');
  });
  document.getElementById('btn-disclaimer-close').addEventListener('click', function () {
    document.getElementById('disclaimer-modal').classList.add('hidden');
  });

  /* 从制作器返回 / 深链：进入 Turn Left 工坊并保留上次目录 */
  var bootWs = false;
  var bootCampaign = false;
  var bootFromPlay = false;
  var bootWsEdit = false;
  try {
    if (localStorage.getItem('tlOpenWorkshop') === '1') {
      localStorage.removeItem('tlOpenWorkshop');
      bootWs = true;
    }
    if (localStorage.getItem('tlOpenWorkshopFromPlay') === '1') {
      localStorage.removeItem('tlOpenWorkshopFromPlay');
      bootFromPlay = true;
    }
    if (localStorage.getItem('tlOpenWorkshopEdit') === '1') {
      localStorage.removeItem('tlOpenWorkshopEdit');
      bootWsEdit = true;
    }
    if (location.search.indexOf('open=workshop') >= 0) bootWs = true;
    if (location.search.indexOf('open=campaign') >= 0) bootCampaign = true;
  } catch (e) {}
  if (bootWs || bootCampaign) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    for (var gi = 0; gi < GAMES.length; gi++) if (GAMES[gi].game === 'turnleft') gameIdx = gi;
    applyGame();
    hide(startWrap);
    openTlSets(bootCampaign ? 'campaign' : 'workshop');
    if (!bootCampaign && bootWsEdit) {
      /* 从制作器退出：直接进入编辑模式 */
      tlWorkshopEdit = true;
      tlModeBtn.textContent = '编辑模式';
      renderTlFooter();
    }
    if (!bootCampaign) {
      refreshWorkshopFromHandle(function (ok) {
        if (ok || bootFromPlay || techNoticeSuppressed()) return;   /* 从游玩界面退出不提示 */
        showTechNotice('由于技术原因，你的更改不会在本目录里显示，你需要重新选择文件夹以在本目录中查看更改后的关卡集。', null);
      });
    }
  }
})();