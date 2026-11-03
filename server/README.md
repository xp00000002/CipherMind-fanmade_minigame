# 服务器端（静态站 + PeerJS 信令 + 开放房间 API）

一个 Node 进程同时提供：

- 静态游戏文件
- PeerJS 信令：`/peerjs`
- 开放房间注册：`/api/rooms`

游戏数据仍然走 WebRTC P2P，不经过本服务。

## 本地测试

```bash
cd server
npm install
npm start
```

默认监听 `9000`，打开：

```text
http://localhost:9000/
```

此时 `js/peer-config.js` 和 `js/rooms.js` 会自动使用同源的 `/peerjs` 和 `/api`。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `9000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；反代时可设为 `127.0.0.1` |
| `ROOM_TTL_MS` | `180000` | 房间无心跳过期时间 |
| `MAX_ROOMS` | `1000` | 房间数上限 |
| `CORS_ORIGIN` | `*` | 允许的跨域来源；同源部署可不管 |

```bash
PORT=9000 HOST=127.0.0.1 ROOM_TTL_MS=180000 npm start
```

## 生产部署

### 方式 A：Nginx 托管静态文件，只反代 API 和信令（推荐）

```nginx
server {
    listen 443 ssl http2;
    server_name game.example.com;

    root /var/www/ciphermind;   # cmchess-modify 的内容
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /peerjs {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 600s;
    }

    location ^~ /server/ { return 404; }
    location ~ /\. { deny all; }
}
```

服务端用 systemd 或 pm2 常驻：

```ini
[Unit]
Description=CipherMind minigame server
After=network.target

[Service]
WorkingDirectory=/opt/ciphermind/server
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=9000
Environment=HOST=127.0.0.1
User=www-data

[Install]
WantedBy=multi-user.target
```

### 方式 B：全部由 Node 服务托管

Nginx 只做 TLS 和整体反代：

```nginx
location / {
    proxy_pass http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## TURN

TURN 不是信令的一部分，需要单独安装 coturn。安装后：

1. 在 `js/peer-config.js` 把 `PEER_TURN.enabled` 改成 `true`
2. 填写与 coturn 一致的 `username` / `credential`
3. `host` 默认就是当前访问域名，同机 TURN 不用改
4. 放行端口：`3478/udp+tcp`、`5349/tcp+udp`、中继端口段（如 `49152-65535/udp`）

本地没有 coturn 时保持 `enabled: false`，先用 STUN/主机候选测试。

## 说明

- 房间注册 API 只保存 Peer ID、游戏类型、房主名、规则摘要等元数据，不保存游戏状态。
- 房间由客户端每 60 秒心跳续期，180 秒无心跳自动过期；房主关闭页面时也会尽量立即删除。
- 单实例即可：PeerJS 的在线 Peer 表在内存中，多实例需要粘性路由。
