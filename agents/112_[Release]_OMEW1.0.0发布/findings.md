# OMEW 1.0.0 发布调研

- [审计基线] -> `main` 与 `origin/main` 均为 `7858d09`，类型检查、65 个测试文件 442 项测试与生产构建通过 -> 后续发布工作从该干净提交分支展开。
- [实例政策写入] -> 当前 Web 定义了 `patchAdminConfig`，服务端固定返回 `POLICY_IS_ENV` -> 用户明确该接口应通过预存密钥更新 Worker 环境变量，需要恢复为受控的发布面而不是删除。
- [安全边界] -> 预存密钥不得返回给浏览器、日志或错误消息；浏览器只能提交白名单政策值，Worker 侧使用服务端绑定调用 Cloudflare API。
- [Cloudflare 设置更新] -> 官方 `PATCH /accounts/{account}/workers/scripts/{script}/settings` 接受 multipart 的 `settings` 对象；bindings 必须放在该对象内，并用 `inherit/latest` 保留 D1、R2、DO 与 Secret -> 后端按完整继承集合提交，任一异常均失败关闭。
- [Overture 凭证注入] -> Overture 已支持 `cfApiToken` host secret 和 `ctx.secrets.putHostValue` -> 1.0.0 改为 auto 模式，部署者创建的长期令牌只作为 Worker Secret 注入，recipe 无法读取其值。
- [权限风险] -> Cloudflare 的 Workers Scripts 写权限是账户级而非单 Worker 级 -> 安装说明明确建议使用专用 Cloudflare 账户，界面不展示或记录令牌。
- [演示表达] -> 保留 1400 天、梦之地与仓促告别的情感核心 -> 对治理能力使用自治、权限边界与抗滥用表达，不针对具体个人。
- [全量测试并发波动] -> 默认并发运行中 `stronghold-management` 的 3 项消息顺序断言先收到合法 batch，而非预期 ack/error -> 该文件隔离运行 31/31，通过单 Worker 全量复跑 67 文件 453/453，确认是既有异步顺序波动而非功能回归。
- [浏览器验收] -> mock 领主可编辑并保存，服务器管理员只读；390px 下 body/dialog 均无横向溢出 -> 同时修复 WinUI 菜单大小写事件警告，新会话控制台无 warning/error。
