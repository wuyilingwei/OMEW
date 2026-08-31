# OMEW 1.0.0 — 1400 天后，重新点亮

Mew 停止运营 1400 天后，OMEW 的首个正式版本发布。

这次完成了单实例社区的完整闭环：公开首页与据点目录、账号与通行密钥、实时聊天、Markdown 帖子、图片与表情、成员资料、私信、权限组、封禁，以及可自动恢复的临时功能限制。

## 快速部署

OMEW 现在可通过 Overture 部署到自己的 Cloudflare 账户。安装器会创建并连接 Worker、D1、R2 与 Durable Objects，同时清楚展示所需权限。

服务器领主可以在 OMEW 内更新实例政策。该能力使用部署者提供、保存在 Worker Secret 中的 Cloudflare Account API Token；令牌不会进入浏览器。Workers Scripts 写权限属于账户级权限，推荐为 OMEW 使用专用 Cloudflare 账户。

## 范围说明

1.0.0 的单实例核心已经可用。跨实例联邦、长期归档搜索与语音仍属于后续里程碑，不在本版本中冒充完成。

软件代码使用 AGPL-3.0-only；OMEW Logo、favicon 与 Mew 官方美术遵循仓库中的独立非商业资产条款。

我只是把曾经的梦之地，一点点拼凑了回来。愿这一次，成为漫长沉寂之后，仓促告别的圆满尾声。
