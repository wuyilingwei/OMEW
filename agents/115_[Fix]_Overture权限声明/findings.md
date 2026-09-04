# Overture 权限声明调研

- [OAuth Worker 权限] -> OMEW 仅声明 `workers-scripts.write`，但配方会读取现有 Worker、创建带 D1/R2/DO/Secret bindings 的版本并切换流量 -> 需要与 EdgeSonic 一致的 `workers-scripts.read`、`workers-scripts.write`、`workers-scripts.bind`。
- [OAuth D1/R2 权限] -> OMEW 只声明写入，但资源 provision 会先列出现有资源再创建并写入 -> D1 与 R2 均需要 read + write。
- [OAuth 域名权限] -> 自定义域为 OMEW 必填输入；解析 zone、查看既有域名并绑定会跨账户级 Workers Routes 与区域读取 -> 需要 `workers-routes.read`、`workers-routes.write`、`zone.read`，展示 scope 应为 account 而非 zone。
- [长期 API Token] -> `cfApiToken` 同时用于 Overture 部署并作为 `CF_API_TOKEN` 注入实例；当前只声明 Workers Scripts Edit，无法覆盖 D1、R2 与域名步骤 -> 最小权限为 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit、Workers Routes Edit、Zone Read。
- [实例运行时边界] -> OMEW 部署后只用令牌读取并更新自身 Worker settings，但 Cloudflare 的 Workers Scripts Edit 是账户级权限 -> 场景和风险说明必须如实区分部署期使用与运行期保留。
- [Overture schema 验证] -> 用 Overture 当前 `validateRecipe` 直接验证生成的 1.0.0 清单，四组 OAuth 权限与五项 API Token 权限全部保留且 schema 返回 `ok: true` -> 权限键、scope 与结构均被部署器正式支持。
- [回归验证] -> Overture 包契约执行实际 Web 构建、Wrangler dry-run、归档和清单检查并通过；OMEW 全量 68 文件、455 项测试通过 -> 未发现产品或打包回归。
