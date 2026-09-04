# Workers.dev 实例域修复计划

- [x] 建立隔离 worktree，核对 main 基线与既有实例域实现。
- [x] 追踪 HTTP 请求、Worker 到 Durable Object 的转发及 WebSocket 后续写入所需的实例域来源。
- [x] 实现受限的 workers.dev 请求主机解析，并保持显式 INSTANCE_DOMAIN 与本地测试回退不变。
- [x] 将 HTTP 身份、WebAuthn、RoomDO 写入和 StrongholdDO 本地成员判断统一到正确实例域。
- [x] 添加根目录 test 覆盖配置域、workers.dev、非 workers.dev 和 DO/WebSocket 路径。
- [x] 执行相关及全量验证，审阅 diff，提交分支。
