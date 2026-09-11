/* net.js - 基于 PeerJS (WebRTC) 的联机层
   房主可同时服务：1 名对局者 + 多名观战者。
   握手：加入方连接后发送 {type:'want', mode:'play'|'spec'}；
   房主按当前状态分配角色（hello）或拒绝（full/not-started）。 */
(function (global) {
  'use strict';

  var Net = {};
  var peer = null;
  var conn = null;
  var playerConn = null;   // 房主端：对局者连接
  var playerName = '';     // 房主端：对局者最终显示名
  var specConns = [];      // 房主端：观战者连接
  var specNames = {};      // 房主端：观战者名称（peerId → 名称）
  var allowSpec = true;    // 房主端：是否允许观战
  var myRole = null;
  var myId = null;         // 本端自己的 Peer ID
  var handlers = {};

  // 房主：将对局消息转发给所有观战者
  function broadcastToSpecs(data) {
    for (var i = specConns.length - 1; i >= 0; i--) {
      if (specConns[i].open) {
        specConns[i].send(data);
      } else {
        specConns.splice(i, 1);
      }
    }
  }

  function notifySpecCount() {
    var n = specConns.length;
    if (handlers.onSpecCount) handlers.onSpecCount(n);
    // 广播观战人数给对局者与所有观战者
    var msg = { type: 'spec-count', count: n };
    if (playerConn && playerConn.open) playerConn.send(msg);
    for (var i = 0; i < specConns.length; i++) {
      if (specConns[i].open) specConns[i].send(msg);
    }
  }

  function nameBase(name) {
    return String(name || '').trim() || 'Player';
  }

  function uniqueName(name, exceptPeer) {
    var raw = String(name || '').trim();
    var base = nameBase(raw);
    var used = {};
    for (var i = 0; i < specConns.length; i++) {
      var c = specConns[i];
      if (c.peer !== exceptPeer) used[nameBase(specNames[c.peer])] = true;
    }
    if (handlers.playerName) used[nameBase(handlers.playerName)] = true;
    if (raw && !used[base]) return base;
    var n = raw ? 2 : 1;
    if (!raw && handlers.playerName === 'Player #1') n = 2;
    while (used[base + ' #' + n]) n++;
    return base + ' #' + n;
  }

  function setupDataHandlers(c) {
    var rejected = false;   // 房主拒绝（满员/未开始）后不再触发断开提示
    c.on('data', function (data) {
      if (data && data.type === 'want') {
        // 房主端：根据当前状态分配角色
        if (data.mode === 'spec') {
          if (!allowSpec) {
            c.send({ type: 'no-spec' });
            try { c.close(); } catch (e) {}
          } else if (playerConn || handlers.soloSpec) {
            /* soloSpec：单人游戏（如空当接龙）无对局者，观战者随时可加入 */
            specConns.push(c);
            specNames[c.peer] = uniqueName(data.name, c.peer);
            c.send({ type: 'hello', role: 'spec', name: specNames[c.peer] });
            if (handlers.onSpecJoin) handlers.onSpecJoin(c);
            notifySpecCount();
          } else {
            c.send({ type: 'not-started' });
            try { c.close(); } catch (e) {}
          }
        } else {
          if (playerConn) {
            c.send({ type: 'full' });
            try { c.close(); } catch (e) {}
          } else {
            playerConn = c;
            playerName = uniqueName(data.name, c.peer);
            myRole = 'w';
            c.send({ type: 'hello', role: 'b', name: playerName });
            if (handlers.onOpen) handlers.onOpen('w');
            if (handlers.onState) handlers.onState('open');
          }
        }
      } else if (data && data.type === 'hello') {
        myRole = data.role;
        if (data.role === 'spec' && handlers.onSpecName) handlers.onSpecName(data.name || 'Player #1');
        if (data.role === 'b' && handlers.onPlayerName) handlers.onPlayerName(data.name || 'Player');
        if (handlers.onOpen) handlers.onOpen(myRole);
      } else if (data && data.type === 'full') {
        rejected = true;
        if (handlers.onError) handlers.onError(new Error('房间已满'));
      } else if (data && data.type === 'not-started') {
        rejected = true;
        if (handlers.onError) handlers.onError(new Error('对局未开始'));
      } else if (data && data.type === 'no-spec') {
        rejected = true;
        if (handlers.onError) handlers.onError(new Error('此对局被设置为不可被观战'));
      } else if (data && data.type === 'chat') {
        // 房主：转发聊天消息给目标（'w' 由房主本地处理，'b' 发给对局者，'s:x' 按 peerId 发给观战者）
        if (handlers.onMessage) handlers.onMessage(data);
        var to = data.to || [];
        var globalChat = !to.length;
        if (c !== playerConn && (globalChat || to.indexOf('b') !== -1) && playerConn && playerConn.open) {
          playerConn.send({ type: 'chat', from: data.from, text: data.text });
        }
        for (var si = 0; si < specConns.length; si++) {
          var sc = specConns[si];
          if (!sc.open) continue;
          if (sc === c) continue;
          if (globalChat || to.indexOf('s:' + sc.peer) !== -1) {
            sc.send({ type: 'chat', from: data.from, text: data.text });
          }
        }
      } else if (data && data.type === 'rename-spec' && specConns.indexOf(c) !== -1) {
        specNames[c.peer] = uniqueName(data.name, c.peer);
        c.send({ type: 'spec-name', name: specNames[c.peer] });
        if (handlers.onSpecRename) handlers.onSpecRename(c.peer, specNames[c.peer]);
      } else if (data && data.type === 'spec-name') {
        if (handlers.onSpecName) handlers.onSpecName(data.name || 'Player #1');
      } else {
        // 房主端：对局消息同步给观战者
        if (data && data.type === 'profile' && c === playerConn && data.profile) {
          if (!String(data.profile.name || '').trim()) data.profile.name = playerName || 'Player #2';
        }
        if (playerConn === c) broadcastToSpecs(data);
        if (handlers.onMessage) handlers.onMessage(data);
      }
    });
    c.on('close', function () {
      if (rejected) return;
      if (c === conn) {
        // 加入方自身连接关闭（对局者或观战者）：通知上层
        if (handlers.onState) handlers.onState('closed');
      } else if (playerConn === c) {
        // 房主端对局者断开：通知上层，并断开所有观战者（对局无法继续）
        playerConn = null;
        for (var i = specConns.length - 1; i >= 0; i--) {
          try { specConns[i].close(); } catch (e) {}
        }
        specConns = [];
        if (handlers.onState) handlers.onState('closed');
      } else {
        var idx = specConns.indexOf(c);
        if (idx !== -1) {
          specConns.splice(idx, 1);
          delete specNames[c.peer];
          notifySpecCount();
        }
      }
    });
    c.on('error', function (err) {
      if (handlers.onError) handlers.onError(err);
    });
  }

  function destroyPeer() {
    if (peer) {
      try { peer.destroy(); } catch (e) {}
      peer = null;
    }
  }

  // 使用 PeerJS 默认云信令（original 联机方式）
  function startPeer(opts, index) {
    destroyPeer();
    var p = new Peer();
    peer = p;
    var settled = false;

    function reportError(err) {
      if (peer !== p) return;
      if (handlers.onError) handlers.onError(err);
    }

    if (opts.mode === 'host') {
      p.on('open', function (id) {
        if (peer !== p) return;
        settled = true;
        myId = id;
        if (handlers.onId) handlers.onId(id);
        if (handlers.onState) handlers.onState('waiting');
      });
      p.on('connection', function (c) {
        setupDataHandlers(c);
      });
      p.on('disconnected', function () {
        if (peer !== p) return;
        if (handlers.onState) handlers.onState('disconnected');
      });
      p.on('error', function (err) {
        if (peer !== p) return;
        if (settled) reportError(err);
        else reportError(err);
      });
    } else {
      p.on('open', function (id) {
        if (peer !== p) return;
        settled = true;
        myId = id;
        conn = p.connect(opts.hostId, { reliable: true });
        if (handlers.onState) handlers.onState('connecting');
        setupDataHandlers(conn);
        conn.on('open', function () {
          // 加入方告知房主：对局 or 观战（携带名称用于成员列表）
          conn.send({ type: 'want', mode: opts.want || 'play', name: opts.name || '' });
          if (handlers.onState) handlers.onState('open');
        });
      });
      p.on('error', function (err) {
        if (peer !== p) return;
        if (settled) reportError(err);
        else reportError(err);
      });
    }
  }

  Net.connect = function (opts) {
    handlers = opts || {};
    handlers.playerName = nameBase(handlers.playerName || handlers.name) === 'Player'
      ? 'Player #1' : nameBase(handlers.playerName || handlers.name);
    myRole = null;
    conn = null;
    playerConn = null;
    playerName = '';
    specConns = [];
    startPeer(handlers, 0);
  };

  Net.send = function (data) {
    if (playerConn && playerConn.open) {
      // 房主：发给对局者，并同步给所有观战者
      playerConn.send(data);
      broadcastToSpecs(data);
      return;
    }
    if (conn && conn.open) conn.send(data);
  };

  // 房主：向所有观战者发送消息
  Net.sendToSpecs = function (data) {
    broadcastToSpecs(data);
  };

  Net.getRole = function () { return myRole; };
  Net.isHost = function () { return handlers.mode === 'host'; };

  // 房主：设置是否允许观战（关闭后观战请求将被拒绝）
  Net.setAllowSpec = function (v) { allowSpec = v !== false; };
  Net.getSpecCount = function () { return specConns.length; };
  Net.getMyId = function () { return myId; };

  // 房主：踢出所有观战者（发送提示后断开）
  Net.kickSpecs = function (reason) {
    var msg = { type: 'kicked', reason: reason || '' };
    for (var i = specConns.length - 1; i >= 0; i--) {
      try { specConns[i].send(msg); specConns[i].close(); } catch (e) {}
    }
    if (specConns.length) {
      specConns = [];
      notifySpecCount();
    }
  };

  Net.renameSpec = function (name) {
    if (conn && conn.open && handlers.want === 'spec') conn.send({ type: 'rename-spec', name: name });
  };

  // 发送聊天消息：房主直接分发给目标；加入方发给房主由其转发
  Net.sendChat = function (msg) {
    if (playerConn && playerConn.open) {
      var to = msg.to || [];
      var globalChat = !to.length;
      if (globalChat || to.indexOf('b') !== -1) {
        playerConn.send({ type: 'chat', from: msg.from, text: msg.text });
      }
      for (var i = 0; i < specConns.length; i++) {
        var sc = specConns[i];
        if (!sc.open) continue;
        if (globalChat || to.indexOf('s:' + sc.peer) !== -1) {
          sc.send({ type: 'chat', from: msg.from, text: msg.text });
        }
      }
      return;
    }
    if (conn && conn.open) conn.send({ type: 'chat', to: msg.to, from: msg.from, text: msg.text });
  };

  // 房主：当前观战者列表（id 供成员列表/消息寻址，name 为观战者名称）
  Net.getSpecs = function () {
    return specConns.filter(function (c) { return c.open; }).map(function (c) {
      return { id: 's:' + c.peer, name: specNames[c.peer] || 'Player' };
    });
  };

  Net.getSpecName = function (id) { return specNames[id] || 'Player'; };

  global.Net = Net;
})(window);
