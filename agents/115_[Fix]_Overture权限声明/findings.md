# Overture 权限声明调研

- [OAuth Worker 权限] -> OMEW 仅声明 `workers-scripts.write`，但配方会读取现有 Worker、创建带 D1/R2/DO/Secret bindings 的版本并切换流量 -> 需要与 EdgeSonic 一致的 `workers-scripts.read`、`workers-scripts.write`、`workers-scripts.bind`。
- [OAuth D1/R2 权限] -> OMEW 只声明写入，但资源 provision 会先列出现有资源再创建并写入 -> D1 与 R2 均需要 read + write。
- [OAuth 域名权限] -> 自定义域为 OMEW 必填输入；解析 zone、查看既有域名并绑定会跨账户级 Workers Routes 与区域读取 -> 需要 `workers-routes.read`、`workers-routes.write`、`zone.read`，展示 scope 应为 account 而非 zone。
- [长期 API Token] -> `cfApiToken` 同时用于 Overture 部署并作为 `CF_API_TOKEN` 注入实例；当前只声明 Workers Scripts Edit，无法覆盖 D1、R2 与域名步骤 -> 最小权限为 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit、Workers Routes Edit、Zone Read。
- [实例运行时边界] -> OMEW 部署后只用令牌读取并更新自身 Worker settings，但 Cloudflare 的 Workers Scripts Edit 是账户级权限 -> 场景和风险说明必须如实区分部署期使用与运行期保留。
- [Overture schema 验证] -> 用 Overture 当前 `validateRecipe` 直接验证生成的 1.0.0 清单，四组 OAuth 权限与五项 API Token 权限全部保留且 schema 返回 `ok: true` -> 权限键、scope 与结构均被部署器正式支持。
- [回归验证] -> Overture 包契约执行实际 Web 构建、Wrangler dry-run、归档和清单检查并通过；OMEW 全量 68 文件、455 项测试通过 -> 未发现产品或打包回归。
- [1.0.0 覆盖发布] -> `v1.0.0` 更新到包含权限声明与发布说明的 `c0eb3cb`；工作流 `33857551489` 成功覆盖三个 Overture 附件，下载后归档 SHA-256 校验通过 -> 正式 Release 已采用新权限集合。
- [发布附件检查] -> `overture.json` 仍为 1.0.0；OAuth 声明包含 Workers Scripts Write/Bind/Read、D1 Write/Read、R2 Write/Read、Routes Read/Write 与 Zone Read；长期 Token 包含 Scripts/D1/R2/Routes Edit 和 Zone Read -> 权限与 EdgeSonic 模式及实际配方端点一致。
- [Overture UI 验收] -> 当前 Overture 源码的本地同构 Worker 读取正式 GitHub Release，权限页显示五项必需权限与双语用途；Cloudflare 创建链接精确携带五项权限，Overture 另附 `account_api_tokens:read` 用于粘贴后只读核验 -> 未点击链接、未创建令牌、未执行部署。
- [公网复检限制] -> 本机系统 DNS 暂时不能解析 Overture 域名；公共 DNS 可解析为 Cloudflare 边缘且指定解析的 HTTPS 请求返回 200 -> 不影响正式 Release 与页面逻辑验证，但本轮最终 UI 验收使用本地同构 Overture 加线上 Release 完成。
