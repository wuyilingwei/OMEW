# Overture 权限声明修正进度

- 2026-09-04：从干净的 `main@a24629e` 创建隔离 worktree，未触碰用户当前工作区的未提交内容。
- 2026-09-04：完成 EdgeSonic Release 清单、OMEW 配方、Overture endpoint-to-scope 与 API Token 权限映射对照，确定两套最小权限集合。
- 2026-09-04：补齐四组部署期 OAuth scopes，将域名访问更正为账户级 Workers Routes 与 Zone Read 的组合说明。
- 2026-09-04：补齐长期 API Token 的五项必需权限及双语场景，明确同一令牌承担部署期访问并在部署后供实例更新自身 Worker 设置。
- 2026-09-04：扩展 Overture 包契约测试，锁定权限键、访问类型、必需性、OAuth scopes 与作用域。
- 2026-09-04：`npm run test:overture-package` 通过；固定 1.0.0 构建成功，Wrangler 4.124.0 dry-run 通过。
- 2026-09-04：生成清单通过 Overture 当前 schema validator，完整权限对象无裁剪、无未知键。
- 2026-09-04：`npm test` 通过，68 个测试文件、455 项测试全部成功。
