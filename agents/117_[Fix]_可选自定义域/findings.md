# 可选自定义域调研

- [EdgeSonic 参考] -> domain 输入为 `required: false`，说明留空使用 `*.workers.dev`；Routes 权限及 Token 的 `workers_routes` / `zone` 权限均为 optional；配方仅在 domain 非空时 attach -> OMEW 应采用同一公开契约。
- [OMEW 配方] -> `if (domain) await ctx.domains.attach(domain)` 已经避免空域名访问 Cloudflare Routes -> 不需要兼容层或新增配置分支。
- [OMEW 当前清单] -> domain 输入、OAuth domains 权限及长期 Token 的 Routes Edit / Zone Read 全部标为 required，发布说明也称其为必需 -> 三处必须同步改为 optional，避免声明与实际访问不一致。
- [运行时风险] -> `INSTANCE_DOMAIN` 为空时当前服务端回退 `local`，WebAuthn 回退 localhost -> 可选自定义域必须与 workers.dev hostname 自动推导任务共同交付，不能只修改安装器表面。
- [测试反馈] -> 首轮打包契约仍断言旧的“自定义域名或路由”属于无条件资源清单，导致测试按预期失败 -> 已将断言拆成必需资源与条件域名访问两部分，防止条款重新夸大权限。
- [集成复核] -> 条款的总括句和 Token 原因仍可能把区域权限、域名绑定读成无条件需求 -> 已明确改为仅在提供自定义域名时需要，并以契约测试锁定。
