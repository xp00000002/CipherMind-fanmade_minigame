/* peer-config.js - PeerJS 信令服务器 / ICE 配置（所有联机游戏共用）
 *
 * 本机测试（默认）：
 *   静态页面：http://localhost:8000/...
 *   PeerJS 信令：localhost:9000，路径 /
 *   启动：peerjs --port 9000 --path /
 *
 * 正式部署（Nginx/Caddy 反代到同域 /peerjs）：
 *   HTTPS 下自动改为同域 443 + wss，无需改这里。
 */
(function (global) {
  'use strict';

  var https = global.location.protocol === 'https:';
  var host = global.location.hostname || 'localhost';

  /* 本机静态服务端口不是 80/443 时，信令默认走 9000。
     如果信令不在 9000，可在这之前设置 window.PEER_SIGNAL_PORT 覆盖。 */
  var isFile = global.location.protocol === 'file:';
  var sameOrigin = !isFile && (https || !global.location.port || global.location.port === '80');
  var signalPort = global.PEER_SIGNAL_PORT ||
    (isFile ? 9000 : (sameOrigin ? (https ? 443 : 80) : 9000));

  global.PEER_SERVER = {
    host: host,
    port: Number(signalPort),
    path: '/',          /* 与 peerjs --path 一致；Nginx 需反代 /peerjs */
    secure: https,
    key: 'peerjs',
    debug: 0
  };

  /* TURN 与信令同一台服务器时，host 会自动使用当前访问域名。
     本机没装 coturn 时保持 enabled: false；服务器配好后改成 true 并填写账号。 */
  global.PEER_TURN = {
    enabled: false,
    host: host,
    port: 3478,
    tlsPort: 5349,
    username: 'ciphermind',
    credential: 'CHANGE_ME_TURN_PASSWORD'
  };

  var iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];
  if (global.PEER_TURN.enabled) {
    var t = global.PEER_TURN;
    iceServers.push({
      urls: 'stun:' + t.host + ':' + t.port
    });
    iceServers.push({
      urls: 'turn:' + t.host + ':' + t.port,
      username: t.username,
      credential: t.credential
    });
    if (https) {
      iceServers.push({
        urls: 'turns:' + t.host + ':' + t.tlsPort,
        username: t.username,
        credential: t.credential
      });
    }
  }
  global.PEER_ICE_SERVERS = iceServers;

  global.makePeer = function (extra) {
    var opts = {};
    var k;
    for (k in global.PEER_SERVER) opts[k] = global.PEER_SERVER[k];
    if (extra) for (k in extra) opts[k] = extra[k];
    if (!opts.config) opts.config = { iceServers: global.PEER_ICE_SERVERS };
    return new Peer(opts);
  };
})(window);
