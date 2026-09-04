# Overture 权限声明修正进度

- 2026-09-04：从干净的 `main@a24629e` 创建隔离 worktree，未触碰用户当前工作区的未提交内容。
- 2026-09-04：完成 EdgeSonic Release 清单、OMEW 配方、Overture endpoint-to-scope 与 API Token 权限映射对照，确定两套最小权限集合。
- 2026-09-04：补齐四组部署期 OAuth scopes，将域名访问更正为账户级 Workers Routes 与 Zone Read 的组合说明。
- 2026-09-04：补齐长期 API Token 的五项必需权限及双语场景，明确同一令牌承担部署期访问并在部署后供实例更新自身 Worker 设置。
- 2026-09-04：扩展 Overture 包契约测试，锁定权限键、访问类型、必需性、OAuth scopes 与作用域。
- 2026-09-04：`npm run test:overture-package` 通过；固定 1.0.0 构建成功，Wrangler 4.124.0 dry-run 通过。
- 2026-09-04：生成清单通过 Overture 当前 schema validator，完整权限对象无裁剪、无未知键。
- 2026-09-04：`npm test` 通过，68 个测试文件、455 项测试全部成功。
- 2026-09-04：确认远端 main 未受分支保护且规则集为空；快进合并并推送 `main@8f6d8dc`，开始按用户既定口径覆盖 1.0.0 Release。
- 2026-09-04：发布声明补充部署期 OAuth scopes 与长期 API Token 的完整权限清单及账户/区域作用域风险。
- 2026-09-04：将 `v1.0.0` 更新到 `c0eb3cb`，覆盖 Release 声明并启动附件工作流 `33857551489`；工作流成功完成。
- 2026-09-04：重新下载三个附件并通过 SHA-256 校验，清单版本保持 1.0.0，四组 OAuth 与五项 Token 权限全部匹配预期。
- 2026-09-04：生产域名遇到本机 DNS 解析异常；改用当前 Overture 源码启动本地同构 Worker，并读取线上 1.0.0 Release 完成权限列表与 Token 创建链接验收，未进入 Cloudflare 授权或部署。
