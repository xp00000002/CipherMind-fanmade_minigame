# Third-Party Notices / 第三方组件声明

本项目本身采用 MIT License（见 [LICENSE](LICENSE)）。下列第三方组件、牌局生成工具和素材仍归其各自作者所有，并适用各自的许可条款；本项目的 MIT 许可不会改变这些第三方权利。

## 1. MinimalKlondike

- 项目：MinimalKlondike
- 作者：ShootMe 及贡献者
- 项目地址：https://github.com/ShootMe/MinimalKlondike
- 许可证：MIT
- 许可证文本：https://github.com/ShootMe/MinimalKlondike/blob/main/LICENSE
- 用途：`tools/Klondike.exe` / `tools/Klondike.pdb` 由该项目编译而来，用于生成 `banks/bank_*.js` 中的 Klondike 可解牌局。网页运行时只读取预生成牌库，不直接调用求解器。

## 2. Credible-Spider

- 项目：Credible-Spider（可靠蜘蛛纸牌）
- 作者：tomwillow 及贡献者
- 项目地址：https://github.com/tomwillow/Credible-Spider
- 许可证状态：截至 2026-11-11，仓库根目录未找到 `LICENSE` 文件，GitHub API 也未声明许可证（`license: null`）。该项目源码公开，但这不等同于授予再分发或商用许可；本项目的 MIT 许可不覆盖这部分第三方代码。若需再分发或商用，请先向原作者确认授权。
- 用途：`js/spider-solver.js` 是基于其 DFS + 估值函数思路的 JavaScript 移植，用于生成/验证 Spider 牌局；`tools/spider-gen-worker.js` 使用该求解器生成 `banks/spider_bank_two.js`。

## 3. PeerJS

- 项目：PeerJS
- 项目地址：https://github.com/peers/peerjs
- 许可证：MIT
- 许可证文本：https://github.com/peers/peerjs/blob/master/LICENSE
- 用途：`js/vendor/peerjs.min.js` 以及服务端 `peer` 依赖，用于多人联机与观战信令。

## 4. 服务端 npm 依赖

`server/package.json` 中声明的 npm 依赖（包括 Express、ws、peer 等）由 npm 安装，其版权和许可证归各依赖作者所有；具体版本和许可信息见 `server/package-lock.json` 及各依赖包内的 `LICENSE` 文件。

## 5. 游戏与素材说明

本项目是非官方的 CipherMind 同人小游戏集，与 Pigeon Games 无隶属关系。CipherMind 名称、原作及相关商标归其各自权利人所有。项目内部分素材为原作素材的重绘版本，其余素材由本项目自行设计；第三方素材不因本项目采用 MIT 许可而改变其原有权利状态。
