# XenoTerm 免费版发布

1.7.0 起客户端全部功能免费，无本地试用计时、机器绑定、许可证验证或支付 IPC。旧版支付及激活 API 返回 HTTP 410，提示下载免费版。历史订单及许可证数据保留，不再用于访问控制。

## 构建与发布

使用 `npm ci`、`npm run build` 和 `npx electron-builder --win --publish never` 构建 Windows 安装包；再运行 `node scripts/release-metadata.js` 生成 `release/release.json`。GitHub 的版本标签工作流也会执行构建并附带更新清单与校验值。

将安装包、blockmap、release.json、latest.yml 上传到网站 downloads 目录。先发布安装包，最后原子替换 latest.yml 和 release.json，避免下载入口指向未上传完成的文件。

## 后台

`xenoterm-server` 使用 Node.js 20 及 SQLite。执行 `npm ci` 后运行 `npm start`。默认只监听 127.0.0.1:3000，由 Nginx 代理 `/api/` 和 `/downloads/`；网站根目录为 `xenoterm-website`。

环境变量：`PORT`、`XENOTERM_DATA_DIR`、`XENOTERM_DOWNLOADS_DIR`、`XENOTERM_PUBLIC_BASE_URL`。管理密钥通过 `XENOTERM_ADMIN_TOKEN` 或 data/.admin-token 配置，密钥文件仅允许服务账户读取，不提交到 Git。

`/admin.html` 提供受管理密钥保护的下载统计。管理密钥只在当前浏览器标签页保存，退出时清除。API `/api/stats/downloads?days=30` 需要 `Authorization: Bearer <管理密钥>`；无密钥不返回统计数据。

## 统计口径

- 官网与自动更新下载分别统计；更新检查单独列出，不计为下载。
- 只记录安装包成功响应；HEAD、404、416、blockmap 和断点续传后续分片不计数。
- 同一客户端、同一文件 30 分钟内去重；去重键使用 HMAC，不保存新下载者的原始 IP 或 User-Agent。
- 日期采用北京时间，保留升级前的历史统计；历史数据仍遵循当时的计数规则。
- 下载请求次数不等于完成安装的人数；HTTP 206 的首个分片表示一次下载开始。

运行 `cd xenoterm-server && npm test` 验证鉴权、统计、去重、路径限制和旧支付接口关闭。

## 回滚

部署前备份服务器代码、网站页面、更新清单与 SQLite 在线快照。回滚时恢复这些文件及对应安装包清单，重启该 PM2 服务。日常发布不要删除或替换 data/license.db，确保历史订单与统计连续保留。
