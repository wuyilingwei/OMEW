# OpenMew 项目书
> 状态:草案 v0.1
> 日期:2026-08-18
---
## 1. 项目概述
OpenMew 是一个开源、可自部署的兴趣社群平台,形态参考已停运的 Mew 社区(北京时代传浮科技)。核心是以「据点」为单位组织的**实时聊天频道**与**帖子分区**混合体,支持多实例联邦互通。
技术定位:Cloudflare Workers 全栈,无本地设备依赖,单人可运维。
**目标用户**:ACG 兴趣圈子的自建社群运营者,规模在数十到数百人。
---
## 2. 目标与非目标
### 目标
- 单实例可在 Cloudflare 免费/低价套餐下运行数百人规模的活跃社群
- 完整历史追溯,消息不因容量限制而丢失
- 多实例联邦:各自部署、互相订阅
- 部署门槛控制在「有域名 + 有 Cloudflare 账号」
### 非目标(v1 明确不做)
- Matrix / ActivityPub 协议兼容
- 实时语音(仅预留信令接口)
- 移动端原生应用
- 端到端加密
- 全站混合时间线(已因频道数可枚举而砍掉)
---
## 3. 概念模型
```
Instance (实例,一个 Cloudflare 部署)
└── Stronghold (据点)
    ├── Channel × ≤25   聊天频道,扁平消息流
    └── Section × ≤10   帖子分区,主题帖 + 一层回复,实时顶贴
```
**25 / 10 为设计上限,非强制校验。** 代码不得假设该数值,据点级 fan-out 必须支持分批。
用户标识:`@user:instance.domain`(从 v1 第一天起使用,即使单实例)
---
## 4. 技术架构
### 4.1 组件映射
| 层 | 用途 |
|---|---|
| **Cloudflare Pages** | Vue 3 + TypeScript 前端 |
| **Worker (API)** | HTTP 接口、鉴权、路由 |
| **Worker (Inbox)** | 接收远端实例事件,验签后转发 |
| **ChannelDO** | 每频道一个:seq 分配、消息 SQLite 存储、WS fan-out |
| **SectionDO** | 每分区一个:帖子与回复、排序索引、bump 广播 |
| **StrongholdDO** | 据点配置、权限规则、tips 聚合 |
| **D1** | users / instances / follows / 归档索引 |
| **R2** | 附件、图片、归档分片、表情包 |
| **KV** | 远端实例公钥缓存、tips 快照 |
| **Queues** | 出站联邦投递与重试 |
**关键约束:消息不进 D1。** D1 单主写入 + 10GB 上限,不适合高频小写。
### 4.2 ChannelDO / SectionDO 共用实现
两者共用同一份 seq 分配、SQLite schema、归档 alarm、批广播窗口。频道是「所有 `parent_seq IS NULL`」的退化情形。
```
ChannelDO : idFromName(`${stronghold}/ch/${channel}`)
SectionDO : idFromName(`${stronghold}/sec/${section}`)
```
不为帖子回复单独开 DO。
### 4.3 批广播窗口
DO 内设 **50–100ms 合并窗口**,窗口内消息打包为数组一次广播。降低 `ws.send()` 调用次数与客户端渲染压力。
配套:按 `actor` 的 token bucket 限流(非按连接)。
### 4.4 WebSocket 策略
- 使用 **Hibernation API**(`state.acceptWebSocket()`),不使用 `server.accept()`
- **不使用 SSE** —— SSE 在 DO 上不受 Hibernation 支持,计费更差
- WS attachment 仅存 `{actor, can_write, last_seq}`,注意大小上限(约 2KB,需实测)
### 4.5 订阅模型
用户同时**可见**的频道通常 1–2 个,但需要**未读提示**的是全部 35 个。两者分离:
- **活跃订阅**:当前打开的频道/分区,WS 全量推送
- **未读提示**:`GET /stronghold/{id}/tips` 轮询,20–30s 间隔,返回 `{ch_id: latest_seq}` 映射
**tips 数据流**:各 DO 写入后向 StrongholdDO 发 fire-and-forget 的 `tip.update` → StrongholdDO 串行合并(1–2s 节流)→ 落 KV → tips 端点读 KV。
> 不可让各 DO 直接写同一个 KV key —— KV 最后写入者获胜,会丢更新。
v1 采用多条 WS(每个活跃频道一条)。若后续连接数成为问题,再加 GatewayDO 多路复用层,客户端接口对两者无感。
### 4.6 实时顶贴
SectionDO 持有该分区所有帖子的排序索引。回复到达时广播轻量事件:
```json
{ "type": "bump", "post_id": 0, "last_reply_seq": 0, "reply_count": 0, "preview": "" }
```
客户端本地重排,不重拉列表。
**必须节流**:同一帖子的 bump 最少间隔 2s,中间合并。
---
## 5. 数据模型
### 5.1 DO SQLite 主表
```sql
CREATE TABLE item (
  seq        INTEGER PRIMARY KEY,   -- DO 单点分配,全序
  parent_seq INTEGER,               -- NULL = 主题帖 / 聊天消息
  root_seq   INTEGER,               -- 冗余,用于按帖取全部回复
  actor      TEXT NOT NULL,         -- @user:instance
  origin     TEXT NOT NULL,         -- 来源实例
  client_id  TEXT NOT NULL,         -- 客户端 UUID,幂等用
  kind       TEXT NOT NULL,         -- 见 §5.2
  ts         INTEGER NOT NULL,
  body       TEXT NOT NULL,         -- JSON
  deleted    INTEGER DEFAULT 0,
  UNIQUE(origin, client_id)
);
CREATE INDEX idx_root ON item(root_seq, seq);
```
无 members / presence / read_state 表。在线人数功能不做。
### 5.2 body 为 JSON 而非纯文本
> **⚠️ 依赖待决事项 A** —— 若「扩展分区功能」确认为分区类型可扩展(投票/日程/wiki 等),`kind` 字段与 JSON body 现在就要落地。事后加需要数据迁移。当前按需要扩展设计。
### 5.3 游标
所有分页、引用、已读位置锚定 `seq`,**不使用 timestamp**。
```
GET /channel/{id}/history?before=<seq>&limit=50
```
### 5.4 重连补洞
客户端上报 `last_seen_seq`:
- gap ≤ 500 → 直接全推
- gap > 500 → 返回 `{gap: true, from, to}`,客户端改走历史 API 分页
### 5.5 幂等与 ack
客户端发送时带 `client_msg_id` (UUID),DO 唯一索引去重,返回 `{client_msg_id, seq}` 作为 ack。未收到 ack 即重发,重发安全。同一机制复用于联邦投递重试。
---
## 6. 历史归档
### 6.1 三层存储
```
热  DO SQLite      最近 ~50k 条 / 30 天
温  R2 分片        按 seq 区间归档,每 10k 条一个 NDJSON + gzip
冷  R2 + D1 索引   D1 存 (do_key, seq_start, seq_end, r2_key)
```
由 DO alarm 定时触发归档:批量写 R2 后从 SQLite 删除。
### 6.2 不可变性
> **⚠️ 依赖待决事项 B、C** —— 归档分片的不可变性是联邦缓存永久有效的前提。删除策略与历史公开性未定,本节无法最终定稿。
暂定默认:
- 删除只写 tombstone,客户端过滤,**R2 分片永不重写**
- 历史需鉴权,客户端不直连 R2
### 6.3 搜索
D1 底层为 SQLite,理论上可用 FTS5 虚拟表,但**是否启用 FTS5 扩展未经确认,需实测**。
退路:归档时把消息文本单写一份到 D1 普通表,`LIKE` + 时间范围限定。数百人规模勉强可用,非长久方案。
---
## 7. 联邦协议
### 7.1 核心决策:房间有唯一 home,不做状态复制
每个 Channel/Section 归属唯一 home instance,远端实例作为**代理客户端**接入,不持有房间状态副本。
- 代价:home 实例下线时实时聊天中断
- 收益:完全消除 state resolution 问题(Matrix 最难的部分,Worker 上不可行)
- 降级保证:已缓存的历史仍可读
帖子流(公开、最终一致)另走 push-to-inbox,可复制。**两种语义分开处理,不用一套机制硬套。**
### 7.2 传输
实例间用 **HTTP POST + Ed25519 签名**,不用 WebSocket。DO 维持长期出站连接的计费与生命周期不可控。
### 7.3 事件信封
```json
{
  "id": "",
  "type": "",
  "origin": "a.example.com",
  "seq": 0,
  "actor": "@lanc:a.example.com",
  "ts": 0,
  "payload": {},
  "sig": ""
}
```
### 7.4 四条必须在协议阶段定死的规则
1. **签名主体是实例,不是用户。** 本地实例代表用户签名,省掉跨实例用户身份体系。
2. **幂等键 = `(origin, seq)`。** 接收端去重表,重投递必须无副作用。
3. **Unicode 规范化。** 用户名/频道名跨实例传递前统一 NFC + 大小写折叠,防同形异码点身份混淆。
4. **实时路径**:远端用户发言 → 本地 Worker 签名 POST → home InboxWorker 验签 → RoomDO fan-out。跨大洲典型 150–300ms,可接受。
### 7.5 历史缓存
远端实例首次请求某 seq 区间时回源 home,拿到后**永久缓存到自己的 R2**。之后本地服务不再回源。远端实例逐渐成为该频道历史的部分副本。
### 7.6 联邦顶贴
home 主动 POST bump 给已注册订阅的远端实例 InboxWorker,远端再 fan-out 给本地客户端。订阅关系存 KV 带 TTL,远端定期续订。
### 7.7 出站投递
必须走 Queues。Worker 子请求上限 50(免费)/ 1000(付费),不可在请求内循环 fetch。
---
## 8. 语音信令预留
v1 **不实现任何媒体逻辑**,仅在 ChannelDO 的 WS 上加一组消息类型:
```
voice.join / voice.leave / voice.peers
voice.signal { to, sdp | candidate }
voice.token   ← 后期接 SFU 时才实现
```
后期无论接 Cloudflare Realtime SFU 还是 VPS 上的 LiveKit,客户端只换 `voice.token` 消费逻辑,DO 侧不动。
**Worker 不能转发媒体流。** 语音只有三条路:CF Realtime SFU(按量计费)、VPS 自建 SFU(架构变混合)、P2P mesh(4 人以上崩溃)。
---
## 9. 权限模型
无 presence 表后,权限不能每条消息查库。
WS 握手时前端带短期 token(本地实例签发,含 `actor` + `can_write` + `exp`),DO 验签后写入 attachment。之后所有消息只读 attachment。token 过期由客户端静默续期。
---
## 10. 平台约束(会咬人的)
| 项 | 约束 | 应对 |
|---|---|---|
| Worker 子请求 | 50(免费)/ 1000(付费) | fan-out 走 Queues,分批 |
| DO SQLite 容量 | 约 10GB(**需确认当前值**) | 三层归档 |
| WS attachment | 约 2KB(**需实测**) | 只存最小状态 |
| Ed25519 in WebCrypto | 算法标识符历史上改过名 | **写码前在 Playground 实测可用字符串** |
| DO 免费计划可用性 | **不确定,需在 dashboard 确认** | 影响成本模型 |
| DO 单点吞吐 | 串行执行 | 批广播 + 限流;预留广播频道只读降级路径 |
| 浏览器同域 WS 并发 | HTTP/2 下限制不明,**需实测** | 影响多 WS 方案上限 |
> 上述标注「需确认/需实测」的项目均为推测,请勿直接采信。
---
## 11. 资源与 IP
### 表情包
技术上:R2 存文件 + D1 存 `emotes(id, name, r2_key, pack_id)`,前端 `:name:` 替换。
> **⚠️ 授权风险 —— 需确认合同原文**
>
> 已有的 NB 使用许可**是否覆盖「随开源项目再分发」**?若项目开源且他人自部署,表情包打包进仓库即构成再分发,通常超出「使用许可」范围。
>
> 规避方案:资源不进 Git 仓库,改为部署时从主实例拉取(可撤销的分发端点),或提供导入工具由部署者自行提供资源。代码开源与资源授权分发解耦。
### 命名
暂定 **OpenMew**(简称 OMEW)。需自行确认:
- [ ] `openmew.org` / `openmew.dev` 域名可用性
- [ ] GitHub 组织名 `openmew` 是否被占用
- [ ] 名称中含「Mew」是否在授权范围内(商标权仍在时代传浮手上,停运不等于放弃)
---
## 12. 里程碑
| 阶段 | 内容 | 交付物 |
|---|---|---|
| **M0** | 协议规范文档(不写代码) | 事件类型表、签名算法、幂等规则、错误码 |
| **M1** | 单实例核心 | D1 schema + ChannelDO + WS + Vue 前端,跑通聊天与发帖 |
| **M2** | 签名层 | 单实例下所有事件也走签名路径,不留后门 |
| **M3** | 归档层 | DO alarm + R2 分片 + D1 索引 + 历史分页 |
| **M4** | 分区与顶贴 | SectionDO + bump 广播 + 节流 |
| **M5** | 联邦(帖子) | 两实例互相订阅帖子流,最终一致 |
| **M6** | 联邦(频道) | 远端代理接入 home 频道 |
| **M7** | 语音 | 接 SFU |
M0 先行,理由:SSR 协议项目上已验证「先写规范后写码」有效。
---
## 13. 🔴 待决事项(阻塞开发)
| # | 问题 | 阻塞什么 | 备注 |
|---|---|---|---|
| **A** | 「预想的扩展分区功能」具体指什么? | `kind` 字段与 JSON body 设计 | 若指分区类型可扩展,现在做零成本,事后做要迁移 |
| **B** | 删除策略:只 tombstone,还是真删 R2 分片? | 归档格式、联邦缓存不可变假设 | 已问 3 轮 |
| **C** | 历史是否公开可读? | 客户端能否凭签名 URL 直连 R2(对成本影响大) | 已问 3 轮 |
| **D** | 「之前的 5x5 设计」是什么? | 25/10 上限的合理性对照 | 无此上下文 |
另有一项**已代为决定,如有异议请推翻**:
- **回复深度 = 一层**(非嵌套树)。理由:分区上限 10 + 实时顶贴 = 论坛式而非 Reddit 式交互,嵌套树收益低、复杂度高(影响归档切片与联邦缓存)。
---
## 14. 技术栈
- 前端:Vue 3 + TypeScript + Vite,部署于 Cloudflare Pages
- 后端:Cloudflare Workers + Durable Objects (SQLite storage)
- 存储:D1 / R2 / KV
- 队列:Cloudflare Queues
- 签名:Ed25519 via WebCrypto
- 无本地设备依赖;VPS 仅在 M7 接自建 SFU 时可能引入
