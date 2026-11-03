/* rooms.js - 开放房间注册表（服务器 /api/rooms，所有联机游戏共用）
 *
 * 默认地址：
 *   同源部署            -> /api
 *   本机 8000 + API 9000 -> http://<host>:9000/api
 *   全部由 server/server.js 托管（9000）-> 同源 /api
 * 可用 window.ROOMS_API_BASE 或 window.ROOMS_API_PORT 覆盖。
 */
(function (global) {
  'use strict';

  var https = global.location.protocol === 'https:';
  var isFile = global.location.protocol === 'file:';
  var pagePort = global.location.port ? Number(global.location.port) : (https ? 443 : 80);
  var apiPort = global.ROOMS_API_PORT ||
    (isFile ? 9000 : ((pagePort === 80 || pagePort === 443) ? pagePort : 9000));
  var apiBase = global.ROOMS_API_BASE;
  if (!apiBase) {
    if (isFile) apiBase = 'http://localhost:9000/api';
    else if (apiPort === pagePort) apiBase = '/api';
    else apiBase = global.location.protocol + '//' + (global.location.hostname || 'localhost') + ':' + apiPort + '/api';
  }

  var HEARTBEAT_MS = 60000;
  var timers = {};

  function request(method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'omit' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(apiBase + path, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') >= 0 ? res.json() : null;
    });
  }

  function noop() { return null; }

  function payload(info) {
    return {
      id: String(info.id),
      game: String(info.game || ''),
      hostName: String(info.hostName || 'Player').slice(0, 64),
      rules: String(info.rules || '').slice(0, 256),
      gameStarted: !!info.gameStarted,
      allowSpec: !!info.allowSpec,
      noChat: !!info.noChat
    };
  }

  var Rooms = {};

  Rooms.register = function (info) {
    if (!info || !info.id) return Promise.resolve(null);
    var data = payload(info);
    if (timers[data.id]) clearInterval(timers[data.id]);
    timers[data.id] = setInterval(function () {
      request('POST', '/rooms', data).catch(noop);
    }, HEARTBEAT_MS);
    return request('POST', '/rooms', data).catch(noop);
  };

  Rooms.unregister = function (id) {
    if (!id) return Promise.resolve(null);
    id = String(id);
    if (timers[id]) { clearInterval(timers[id]); delete timers[id]; }
    return request('DELETE', '/rooms/' + encodeURIComponent(id)).catch(noop);
  };

  Rooms.list = function (game) {
    var q = game ? ('?game=' + encodeURIComponent(game)) : '';
    return request('GET', '/rooms' + q).then(function (data) {
      return data && Array.isArray(data.rooms) ? data.rooms : [];
    }).catch(function () { return []; });
  };

  /* 页面关闭时尽量立即删除；失败也没关系，服务器会在 TTL 后清理 */
  global.addEventListener('pagehide', function () {
    Object.keys(timers).forEach(function (id) {
      try {
        fetch(apiBase + '/rooms/' + encodeURIComponent(id), { method: 'DELETE', keepalive: true, credentials: 'omit' });
      } catch (e) {}
    });
  });

  Rooms.apiBase = apiBase;
  global.Rooms = Rooms;
})(window);
