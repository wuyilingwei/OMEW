# OMEW 1.0.0 — 1400 天后，重新点亮

Mew 停止运营 1400 天后，OMEW 的首个正式版本发布。

这次完成了单实例社区的完整闭环：公开首页与据点目录、账号与通行密钥、实时聊天、Markdown 帖子、图片与表情、成员资料、私信、权限组、封禁，以及可自动恢复的临时功能限制。

## 快速部署

OMEW 现在可通过 Overture 部署到自己的 Cloudflare 账户。安装器会创建并连接 Worker、D1、R2 与 Durable Objects，同时清楚展示所需权限。

部署期 OAuth 权限按实际访问声明为 Workers Scripts Read/Write/Bind、D1 Read/Write、Workers R2 Storage Read/Write、Workers Routes Read/Write 与 Zone Read。部署并保存在实例中的 Cloudflare Account API Token 明确要求 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit、Workers Routes Edit 与 Zone Read；这些权限作用于账户或区域，并非只限单个 Worker。

服务器领主可以在 OMEW 内更新实例政策。该能力使用部署者提供、保存在 Worker Secret 中的 Cloudflare Account API Token；令牌不会进入浏览器。Workers Scripts 写权限属于账户级权限，推荐为 OMEW 使用专用 Cloudflare 账户。

## 条款与许可证

Overture 会在授权部署前展示 OMEW 的完整中英文使用条款，并要求部署者滚动阅读后明确同意。中文文本为控制文本，英文为参考翻译。

软件代码采用 AGPL-3.0-only；修改后通过网络向用户提供服务时，必须依许可证向这些用户提供所运行版本的相应源代码。OMEW Logo、favicon 与 Mew 官方美术不适用 AGPL，只能依独立条款用于非商业部署；商业部署必须移除或替换全部受限资产。`stamp-*` 第三方贴纸未获本仓库转授权，使用者必须自行取得许可或删除。纯自愿捐助与仅覆盖必要服务成本的非侵入式广告，严格依资产条款中的有限例外处理。

## 范围说明

1.0.0 的单实例核心已经可用。跨实例联邦、长期归档搜索与语音仍属于后续里程碑，不在本版本中冒充完成。

软件代码使用 AGPL-3.0-only；OMEW Logo、favicon 与 Mew 官方美术遵循仓库中的独立非商业资产条款。

我只是把曾经的梦之地，一点点拼凑了回来。愿这一次，成为漫长沉寂之后，仓促告别的圆满尾声。
