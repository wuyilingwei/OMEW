# 调研记录

## Overture 规范

- `docs/RECIPE.md` 与 `src/lib/recipe/types.ts` 是当前规范来源：GitHub Release 必须发布固定名称 `overture.json` 和 `overture.tar.gz`；配置声明资源、权限、Worker 入口、静态资源、步骤与 capability，压缩包包含 `recipe.js`、Worker 模块、assets、migrations。
- 规范要求 `package.sha256` 为安装包真实 SHA-256，Worker 路径必须包内相对路径，认证模式使用 `oauth`/`auto`。

## OMEW 资源盘点

- `server/wrangler.jsonc` 声明 Worker `openmew-server`、D1 `DB`/`openmew`、R2 `MEDIA`/`omew-media`、DO `ROOM_DO`/`STRONGHOLD_DO`、21 个 migrations、静态资源 `../web/dist`，并有 `INSTANCE_DOMAIN` 等公开 vars。
- 服务端已有 `npm run deploy:check`（`wrangler deploy --dry-run`）、`types`、`typecheck`；根目录已有 build/test/typecheck/verify。
- 不记录任何账号、token 或 secret 值。生产部署不在本任务范围。

## 边界

- Overture 主机需要显式支持 OMEW 的 Durable Object bindings、declarative exports 与 assets routing，因此同步维护独立 Overture worktree；不污染其原 checkout。
- 已有 OMEW D1 只能从 Wrangler 的 `d1_migrations` 精确接管进度；仅凭业务表存在无法推断所有迁移均已执行，必须拒绝无账本的危险覆盖。
