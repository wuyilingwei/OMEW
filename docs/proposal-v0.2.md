# OpenMew 项目书
> 状态:v0.2,取代 v0.1
> 日期:2026-08-18
---
## 1. 项目概述
OpenMew(OMEW)是开源、可自部署的兴趣社群平台,形态参考已停运的 Mew 社区。核心是以「据点」为单位的**实时聊天频道**与**帖子分区**混合体,支持多实例联邦互通。
技术定位:Cloudflare Workers 全栈,无本地设备依赖,单人可运维。**目标用户**:ACG 兴趣圈子的自建社群运营者,数十到数百人。
---
## 2. 目标与非目标
### 目标
- 免费档承载单据点约 300 人的活跃社群(瓶颈为 DO 时长);$5/月 档承载 600–1,000 人
- 完整历史追溯,消息不因容量限制而丢失
- 多实例联邦:各自部署、互相订阅
- 部署门槛控制在「有域名 + 有 Cloudflare 账号」
### 2.1 成本依据
基准:单据点 300 成员、峰值在线 60、日活跃 4h、3,000 条消息/天、同时热门房间 ≤3;tips 走 WS 推送而非轮询;静态资源经 Workers static assets 直出,不产生 Worker 调用。
**免费档**占比:DO 时长(醒着的 1 Stronghold + ≤3 房间 × 0.128 GB × 活跃秒数)≈ 4,000–7,400 / 13,000 GB-s = **31–57%,最紧**;DO 请求(WS 握手 3 × 2 会话 × 300 + 入站帧约 5,000 按 20:1 计 + 经 Worker 落到 DO 的首屏 tips 与历史分页)≈ 15–17%;DO 行写(3,000 条 × 3 行:item + 去重映射 + tip)9%;Worker 请求(首屏 API + 历史分页)≈ 15%。免费档瓶颈是 **DO 时长**,与人数弱相关、与「同时活跃房间数 × 日活跃时长」强相关:房间增至 8 个或接近全天活跃时先撞时长线,而非人数线。
**$5/月 档**(含 10M Worker 请求、1M DO 请求、400,000 GB-s):同场景占 0.5M / 0.4–0.5M / 120k–220k GB-s,R2、D1、Queues 远低于含量。DO 请求随人数近似线性增长,是 $5 档首个触顶项,故首个超额落在 600–1,000 人区间,1,000 人月成本约 $11–12。
### 非目标(v1 明确不做)
Matrix / ActivityPub 兼容;实时语音(仅预留信令与能力位);移动端原生应用;端到端加密;全站混合时间线。
账号跨实例迁移不再列为非目标,而是分期落地:**协议层**(所有权密钥字段、边表事件、`user.moved` 与逐边挑战握手端点)在 M0 定义,密钥生成与托管在 M1,**迁移执行流程**为 M5+ 实现项。字段与事件不 day-1 定死,事后给存量账号补钥会弱化归属证明。
---
## 3. 概念模型
```
Instance (实例,一个 Cloudflare 部署)
└── Stronghold (据点)         visibility: public | private
    ├── Channel × ≤25   聊天频道,扁平消息流
    └── Section × ≤10   帖子分区,主题帖 + 一层回复,实时顶贴
```
25 / 10 为**软上限**,代码 MUST NOT 假设该数值,据点级 fan-out MUST 支持分批。事实对照:Mew 据点基建为 3×3 网格、节点超 5 个扩为 5×5,中心格固定放据点图标,实际话题上限 24。
用户标识 `@user:instance.domain`,从 v1 第一天起使用。回复深度 = 一层,不做嵌套树。
---
## 4. 技术架构
### 4.1 组件映射
| 层 | 用途 |
|---|---|
| **Workers static assets** | Vue 3 + TS 前端,SPA 路由用 `assets.not_found_handling` |
| **Worker (API)** | HTTP 接口、鉴权、路由、历史代理读 |
| **Worker (Inbox)** | 接收远端事件,限流 + 验签后转发 |
| **ChannelDO** | 每频道一个:seq 分配、SQLite 存储、WS fan-out、tombstone 侧表、订阅表 |
| **SectionDO** | 每分区一个:帖子与回复、排序索引、bump 广播;其余同 ChannelDO |
| **StrongholdDO** | 据点配置与可见性、角色权限规则、成员表、tips 持久化聚合 + tips WS fan-out |
| **D1** | users / 宾客身份(含档案缓存与各据点成员状态)/ 边表 / instances(公钥集、轮换链、吊销)/ 归档索引 / FTS 正文 |
| **R2** | 附件、图片、归档分片、表情包 |
| **Queues** | 联邦慢路径出站投递与重试 |

**不使用 Workers KV**:tips 落 StrongholdDO 持久化、公钥落 D1、联邦订阅落房间 DO storage。**消息热写不进 D1**:单主写入 + 单库容量硬上限(免费 500 MB / 付费 10 GB),不适合高频小写;D1 只承接归档时批量写入的 FTS 正文副本(§6.4)。
### 4.2 ChannelDO / SectionDO 共用实现
共用 seq 分配、SQLite schema、归档 alarm、批广播窗口;频道是「所有 `parent_seq IS NULL`」的退化情形。`idFromName` 取 `${stronghold}/ch/${id}` 与 `${stronghold}/sec/${id}`。不为帖子回复单独开 DO。
### 4.3 批广播与 WebSocket
DO 内设 50–100ms 合并窗口,窗口内消息打包为数组一次广播。顺序 MUST 定死:SQLite 提交 → 立即向发送者单发 ack → 批量广播他人;休眠前 MUST 冲刷缓冲。合并 timer 只在有待发批次时存在(首条消息才 schedule,冲刷即 clear),否则每个活跃频道都变成常醒 DO(= 免费日时长配额 83%)。配套按 `actor` 的 token bucket 限流,非按连接。
用 Hibernation API(`state.acceptWebSocket()`),心跳走 `setWebSocketAutoResponse`(免计费、不唤醒);不用 SSE(流式响应等同进行中请求,DO 保持在内存计费)。attachment 上限 16,384 字节,存 `{actor, room, role, deny, last_seq}`(`role` 供 DO 内 owner/mod 特权操作判定免查库,写权限由 `deny` 位表达);`last_seq` 定义为「最后**成功发送**的 seq」。
### 4.4 订阅模型
可见房间通常 1–2 个,需要未读提示的是全部 35 个,三层分离:**活跃订阅**(当前打开的房间,一条 WS 全量推送);**tips 推送**(向 StrongholdDO 另开一条休眠 WS,未读增量直接推送);**轮询兜底**(`GET /stronghold/{id}/tips` 由 StrongholdDO 直接应答,用于首屏拉取与离线降级,20–30s)。
tips 数据流:房间 DO 写入后向 StrongholdDO 发 `tip.update`(携带**绝对** latest_seq,可幂等重发)→ StrongholdDO 先落 storage 再由 alarm 冲刷与广播(1–2s 节流);房间 DO 在归档 alarm 上顺带重报 latest_seq 作对账。跨实例 `tip.digest` 限额:同一 origin 对同一据点 MUST ≤ 1 次/60s,超出静默丢弃。
v1 用多条 WS(活跃房间各一条 + tips 一条 + 每远端实例 tips 各一条),浏览器并发上限不构成约束,GatewayDO 多路复用降级为远期可选。
### 4.5 实时顶贴
SectionDO 持有分区排序索引,回复到达时广播 `{type:"item.bump", post_seq, last_reply_seq, reply_count, preview, ts}`。bump MUST 为**绝对快照**(LWW),合并与丢弃才无害;客户端本地重排不重拉列表,(重)连接时重拉一次索引兜底。同帖 bump 最少间隔 2s,中间合并。
---
## 5. 数据模型
### 5.1 DO SQLite
```sql
CREATE TABLE item (
  seq INTEGER PRIMARY KEY,             -- DO 单点分配,全序
  parent_seq INTEGER, root_seq INTEGER, -- parent_seq NULL = 主题帖 / 聊天消息
  actor TEXT NOT NULL, origin TEXT NOT NULL, client_id TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 命名空间化类型,见 §5.4
  ts INTEGER NOT NULL, body TEXT NOT NULL,   -- body 为 JSON
  UNIQUE(origin, client_id)
);
CREATE INDEX idx_root ON item(root_seq, seq);
-- 以下侧表归档 alarm MUST NOT 淘汰
CREATE TABLE tombstone   (seq INTEGER PRIMARY KEY, actor TEXT, ts INTEGER, reason TEXT);
CREATE TABLE edit        (target_seq INTEGER PRIMARY KEY, seq INTEGER, body TEXT, edited_at INTEGER);
CREATE TABLE dedupe_local(origin TEXT, client_id TEXT, seq INTEGER, ts INTEGER, PRIMARY KEY(origin, client_id));
CREATE TABLE dedupe_fed  (origin TEXT, envelope_id TEXT, ts INTEGER, PRIMARY KEY(origin, envelope_id));
CREATE TABLE subscription(peer TEXT PRIMARY KEY, expires_at INTEGER);
```
房间 DO 内无 members / presence / read_state 表(权威成员表在 StrongholdDO),在线人数功能不做。
### 5.2 两条不变量
- **seq 严格单调**:`next_seq` MUST 单独持久化在 DO storage,永不从表推导,归档删行不得使其回退。违反将连锁破坏归档索引区间、联邦去重、远端永久缓存与客户端游标。
- **推送 seq 连续**:客户端逐条校验,发现空洞发 `resync {from_seq}`,不必断线重连。重连时上报 `last_seen_seq`,gap ≤ 500 直接全推,> 500 返回 `{gap:true, from, to}` 改走历史 API。
### 5.3 幂等两层键与游标
协议层 `(origin, envelope.id)` 为端到端权威键,用于联邦收包去重,保留期 R MUST ≥ 2W + Q(W = ts 新鲜度窗口半宽 300 s,Q = 队列最大重投期;免费档 Q 固定 24 h → R ≥ 24 h 10 min,实现取 26 h;付费档最长 14 d → R ≥ 14 d 10 min),Q MUST 在配置中显式声明,记录满 R 后 MAY 淘汰;应用层 `(origin, client_id)` 为 home 侧客户端重发去重,保留期 ≥ 客户端最大重试期。两层显式分开,去重映射不随归档淘汰;冲突时 MUST 返回原 `seq` 作 ack,未收到 ack 即重发,重发安全。
分页、引用、已读位置一律锚定 `seq` 不用 timestamp:`GET /channel/{id}/history?before=<seq>&limit=50`。
### 5.4 房间配置与能力
房间形态是配置值而非数据迁移:`{"type":"channel","capabilities":["text"]}`,带语音的频道为 `{"type":"channel","capabilities":["text","voice"]}`。`type` v1 枚举仅 `channel` / `section`;`capabilities` v1 词表为 `text`(所有房间 MUST 含)/ `attachments` / `voice`,未知能力值 MUST 忽略。能力值与事件类型名是两套命名空间,MUST NOT 混用。`item.kind` 初始集 `post` / `reply`;投票、日程、wiki 类留后续版本,不预先建模。
前向兼容规则(M0 冻结):事件类型命名空间化(`item.*` / `tip.*` / `member.*` / `user.*` / `stronghold.*` / `voice.*`);客户端与联邦对端对未知类型 **MUST 静默忽略**,不落库、不写去重表;实例能力经 `/.well-known/openmew/instance` 宣告。
---
## 6. 历史归档
### 6.1 三层存储
```
热  DO SQLite      最近 ~50k 条 / 30 天
温  R2 分片        按 seq 区间归档,每 10k 条一个 NDJSON + gzip
冷  R2 + D1 索引   D1 存 (do_key, seq_start, seq_end, r2_key, shard_version)
```
DO alarm 定时触发:批量写 R2 后从 SQLite 删除 item 行,侧表不动。
### 6.2 删除模型
常规删除只写 **tombstone 侧表**、编辑只写 **edit 侧表**(LWW by `seq`),读取时叠加过滤与替换,分片**正文不可变**;联邦发签名 `item.delete`,收到的实例 MUST 在自己的缓存副本上写 tombstone。**法务级硬删逃生通道**:重写受影响的 R2 分片并 bump D1 索引的 `shard_version`,远端按版本失效重取,无需全量回源。私有据点分片仅 home 持有,硬删自洽;公开据点的远端缓存靠 `item.delete` + 合规义务传导。
tombstone 侧表按 seq 区间分段:某区间的删除已固化进重写后的分片(`shard_version` 已 bump)后该段 MAY 淘汰,其余永久保留;容量量级为每条 tombstone ~16 B,百万次删除 ~16 MB,远低于 10 GB 对象上限。**媒体回收范围声明**:v1 不做引用计数,硬删只承诺移除 item 正文与重写分片,媒体对象本身的删除留给运营者工具。
### 6.3 可见性分流
历史可见性是**据点级**设置,跟随 `visibility`:

| | public 据点 | private 据点 |
|---|---|---|
| 读路径 | Worker 无鉴权读 + `Cache-Control` 吃边缘缓存,签名 URL 直连 R2 为可选优化 | Worker 鉴权代理,按成员关系授权 |
| 联邦回源 | 允许,远端 MAY 永久缓存到自己的 R2 | 仅 home 服务,远端转发、**MUST NOT 落盘** |
| 搜索 / tips / 目录 | 按同一可见性裁剪,入公开目录 | 裁剪,不入目录 |

**转私有仅对未来生效**:公开期间已被拉取或缓存的历史无法追回,协议 MUST NOT 承诺撤回能力,UI 须提示。
**房间级可见性**:v1 房间继承据点 `visibility`,不做逐房间可见性矩阵;唯一例外是房间 flag `restricted: true`(仅 owner / mod 可见可入,对齐 Mew `moderation_topic` 先例),restricted 房间 MUST NOT 联邦、MUST NOT 进公开目录与 tips 汇总。
### 6.4 搜索
D1 支持 FTS5(自带 unicode61 / porter / trigram tokenizer,不可自定义),搜索走 FTS5 正路,归档时把正文写入 D1 FTS 表。`LIKE` 仅作退路且 MUST 强制时间范围过滤(按扫描行计费)。FTS 表容量按库上限规划(免费 500 MB / 付费 10 GB),超限时 MUST 按时间窗裁剪索引或分库,搜索退化为仅覆盖近期区间。
---
## 7. 联邦协议
### 7.1 两层结构
**热路径**(聊天、发帖、回复、顶贴):客户端凭 home 签发的断言换取目标实例宾客会话,**直连**其 API 与房间 DO。
**慢路径 S2S**(密钥与档案发现、`user.update` / `user.deactivate`、审核事件、公开帖子流复制、跨实例通知与 tips 汇聚、历史回填、公开目录):HTTP POST + Ed25519 + Queues。
每个 Channel/Section 归属唯一 **home instance**,不做状态复制,不存在 state resolution。home 下线时该房间实时聊天中断,已缓存历史仍可读。
### 7.2 身份、宾客身份与网状边注册表
凭证**永不出境**,用户只在 home 实例注册与登录;用户名仅**实例内**唯一,不做全局命名空间,`@alice:a.example` 与 `@alice:b.example` 是两个人,UI 恒显全限定名。
**实例策略五设置**(管理员可配,自运营模式):①`allow_root` 是否作为根节点(否则拒绝本地注册,仅承载宾客身份与内容);②根节点注册门槛 ⊆ {邮箱, 手机(保留位,未接 SMS 通道时明确报错), 注册码};③`trusted_identity_servers` 承认哪些服务器的身份(`*` = 全部),联邦会话在验签前按此准入且不对名单外域发起密钥拉取;④`federation_peers` 要加入的已知服务器(内容对等出站白名单,与③的身份准入相互独立);⑤`stronghold_creation` 建据点策略 = open 公开 / restricted 特定人名单 / application 需申请审批。
远端用户首次登入实例 B 时,B 创建**宾客身份**行:actor 全名、档案缓存(`profile_version`)、该用户在 B 各据点的成员资格 / 角色 / 受限 / 黑名单 / 申请记录。**权威划分**:注册实例权威 = 档案与存在性,据点实例权威 = 该用户在本实例据点内的成员状态与惩戒,互不越界。
宾客身份的建立是**双向确认的握手**,不是单向缓存:home 在签发 `aud = B` 的断言时即记录预知边并发 `user.link`,B 建好宾客身份后回 `user.link_confirm`,home 据此持久化**边表**(该用户在哪些实例持有宾客身份),B 持有反向指针;B 清理闲置宾客身份时发 `user.unlink` 移除边。边表是 `user.update` / `user.deactivate` / 迁移通告的精确 fan-out 目标集合,取代「有关系的实例」这种模糊集合,也是「我的据点」跨实例聚合视图的数据源。**客户端 MUST 随边确认同步保存自己的一份边表副本**,它与所有权私钥同为可导出数据——旧 home 死亡时这份副本是迁移唯一的边来源。
档案文档 `GET /.well-known/openmew/users/{localpart}` 返回签名对象 `{v, actor, profile_version, display_name, avatar, bio, created_at, status, ownership_key, key_history, moved_to?, also_known_as?, key_id, sig}`,`status` 枚举 `active` / `deactivated`。同步 = 信封 `objects.users` sideload(携带单调 `profile_version` 与 `ownership_key`)+ `user.update` 按版本 upsert;事件丢失由下一条消息的 sideload 对账,无独立同步协议。
注册实例永久下线时宾客身份成为孤儿:历史归属与成员状态保留可读,无法再建新会话。补救是所有权密钥的灾难迁移路径——账号可凭密钥迁往新 home,各宾客实例经挑战握手把孤儿身份重指向新 home,该缺口就此闭合。
**账号所有权密钥**是账号主权的冷根,用途严格限定为所有权操作(迁移声明、密钥轮换),日常消息仍走实例签名。私钥由客户端**随机**生成,不从口令派生——所有权公钥全网钉扎且公开可见,确定性派生等同于把私钥摆上离线字典攻击的靶位,而登录口令又会被 home 在核验时观测到。home 只存公钥(进档案文档,随 sideload 传播至全部宾客实例并被钉扎)与一份私钥密文;密文的加密钥在客户端经 Argon2id 从**所有权口令**派生,该口令永不发送给任何服务器,home 无法解密。密文注册时保存、账号本人随时可导出,明文私钥与边表副本同样可导出。登录凭证与所有权口令分离:passkey 登录为推荐形态,用户唯一需记忆的口令就是所有权口令;退回密码登录的部署须使用不同口令,或明示「恶意 home 截获登录口令即可解密托管密文」的降级风险(OPAQUE 类 PAKE 列为后续增强)。口令与备份俱失只丧失迁移能力,不丧失账号。轮换为新钥由旧钥签名,复用 §7.7 的密钥连续性链机制,记入 `key_history`。
**迁移的传播责任在新权威**:所有权转移到新 home C 后,C 逐一向边表中每个关联实例发起挑战握手——对端出 nonce、C 以所有权密钥应答、对端凭本地钉扎的公钥链独立验证后重指向,每边一份新鲜 challenge,单一证明不可跨边重放;C 跟踪每边状态、失败重试直至全部解决并向用户呈现进度。`user.moved` 是迁移公告与公示期载体,不单独触发重指向。发起者可以是用户,也可以是母服务器(计划性关停时提供边表并出具双签配合),但所有权证明恒需所有权密钥签名,母服务器无法单方面转走账号。双路径:常规路径为旧 home 放行 + 所有权密钥双签,逐边即刻生效;灾难路径仅凭所有权密钥,经 7 天公示期生效,期间旧 home 若复活 MAY 以实例密钥发布异议冻结。home 由此从「账号的主人」降格为「账号的托管者」。
### 7.3 联邦 SSO 直连
客户端向 home A 取一张短时效签名断言 `{v, typ:"openmew.assertion.v1", iss, sub:"@user1:a.example", aud:"b.example", iat, exp, jti, profile_version, key_id, sig}`(`exp − iat` MUST ≤ 300 s,`aud` MUST 逐字节等于接收实例域)→ `POST /federation/session` 提交给 B → B 用已有的 A 公钥验签,发放 B 域宾客会话 token → 客户端直接与 B 建 API / WS 连接(§9 token 机制原样复用)。
无 cookie、无 iframe:所有实例跑同一份前端,客户端持多组 `(origin, token)` 跨域调用,token 走 `Sec-WebSocket-Protocol`,免疫第三方存储分区。
### 7.4 信任代价(MUST 明示)
直连模式下目标实例收到的是会话内明文,**该实例有能力在自己的房间内伪造宾客发言**,信任级别等同中心化平台的服主:恶意房主的唯一对策是退出该据点。UI MUST 在加入外部实例据点时提示。缓解:断言短时效使「无会话期的伪造」可被否认。「用户 home 对内容附加署名签名」为后续版本可选增强,v1 不做。
### 7.5 actor 绑定规则
**房间事件**:`origin` MUST = 房间 home;`actor` MAY 为外域,但该 actor 的宾客会话 MUST 曾由其 home 签发的断言建立。**身份类事件**(`user.update` / `user.deactivate` / `member.join_request`):`actor` 域(IDNA2008 规范化后)MUST == `origin`,否则拒收;`member.join_request` 的 `origin` 为用户注册实例,据点 home 以据点域的 `member.add` / `member.reject` 回应。localpart 注册期 MUST 先经 PRECIS `UsernameCaseMapped` 处理再校验 ASCII 子集,域走 IDNA2008 A-label;接收端 MUST NOT 对线上标识符做静默规范化。注册期 MUST 做 TR39 skeleton 碰撞检测(NFC + 大小写折叠不防同形字)。
### 7.6 信封与签名
信封 `{v, id, type, origin, room?, actor?, seq?, ts, payload, objects?, key_id, sig}`。签名输入 = `UTF8("openmew/event/v1") || 0x00 || JCS(移除 sig 后的完整信封)`,规范化用 **RFC 8785 (JCS)**;`key_id` 与本规范未定义的扩展字段 MUST 一并被签名覆盖,中继 MUST NOT 剥离未知字段后转发。M0 附验签伪码与测试向量;签名主体是**实例**,不是用户。接收端:`ts` MUST 落在 ±5 分钟窗口内;去重键 `(origin, envelope.id)`;维护 `(origin, room)` 的 seq 高水位;未知 `type` MUST 静默忽略且不写去重表。
### 7.7 密钥发现、轮换与吊销
信任锚 `GET /.well-known/openmew/keys`(TLS,MUST NOT 跟随重定向,设超时与体积上限)返回 key set。新钥 MUST 由现役钥签名,吊销为**显式事件**而非 TTL 过期;公钥集、轮换链、吊销标记落 D1 `instances` 表并本地钉扎,isolate 内存仅作热缓存;cache-miss 的失败模式是**拒绝**而非接受。Inbox MUST 在验签**前**限流(IP 粗限流 + 体积上限 + 超时);未知 `origin` 直接 4xx 且 MUST NOT 触发出站拉钥,否则构成 SSRF / 反射放大。
### 7.8 回源、订阅、投递与退联邦
- **历史回源** MUST 按据点可见性 + 请求方成员关系授权,不得只验「是联邦实例」;缓存规则见 §6.3。
- **订阅与联邦顶贴**:home 主动 POST bump 给已订阅的远端 Inbox,远端再 fan-out。订阅表存房间 DO storage,续订 = upsert,fan-out 时过滤过期行;订阅注册 MUST 验签,回调 URL MUST 限于对端自己域下并设配额。
- **出站** MUST 走 Queues,不在请求内循环 fetch;免费档保留固定 24h,超 24h 的重试需 D1 outbox 或付费档。
- **帖子流复制**:接收端按 `(origin, room)` 维护高水位 + 小乱序缓冲,空洞超时走历史 API 回填,展示顺序 = origin seq 序,死信不得静默丢失。
- **退联邦**:实例 blocklist;语义与错误码在 M0 冻结,含已缓存历史处置——本地已缓存的对端 public 历史 MAY 保留;私有据点历史本就 MUST NOT 落盘,退联邦时 MUST 清除内存 / 短 TTL 缓存;本方已被对端缓存的历史无法追回,规则同 §6.3 转私有。
- **目录**:`GET /.well-known/openmew/instance` 返回签名描述符 `{name, version, software, capabilities[], public_strongholds[], known_peers[]}`;手工配置对端起步 + `known_peers` gossip 扩散;目录内容为 advisory,**不作信任依据**。

> 本项目的「P2P」指实例间对等联邦(server-to-server),不是客户端 P2P。
---
## 8. 语音信令预留
v1 不实现任何媒体逻辑,仅在房间 WS 上预留一组命名空间化消息类型,由房间 `capabilities` 开关:`voice.join` / `voice.leave` / `voice.peers` / `voice.signal {to, sdp|candidate}` / `voice.token`(后期接 SFU 时才实现)。后期无论接 Cloudflare Realtime SFU 还是自建 SFU,客户端只换 `voice.token` 消费逻辑,DO 侧不动。
**Worker 不能转发媒体流。** 语音只有三条路:CF Realtime SFU(按量计费)、VPS 自建 SFU(架构变混合)、P2P mesh(4 人以上崩溃)。
---
## 9. 权限模型
角色 `owner` / `mod` / `member`(据点级,owner 唯一且可转让);惩戒两级:受限(按 `deny` 位掩码)与封禁(记录时间与操作者,不可自行回来)。`deny` 位仅对 `member` 生效,`owner` 豁免一切 deny;对 `mod` 施加 deny MUST 先降级为 `member`,单个事件 MUST NOT 同时降级与施加 deny。
据点级消息策略:`allow_message_edit` / `allow_message_retract` 开关 + 可配时间窗(默认 300 s,0 = 不限)约束**作者本人**的编辑与撤回;owner/mod 删除他人消息属审核权,不受该开关与窗口限制,但 mod MUST NOT 删除 owner 的消息。
无 presence 表,权限不能每条消息查库:WS 握手时前端带该实例签发的短期 token,DO 验签后写入 attachment,之后只读 attachment。token claims MUST 绑定**具体房间**(DO id)+ 据点角色 + `deny` 位快照 + 短 `exp` + `jti`;token MUST 走 `Sec-WebSocket-Protocol` 子协议或首帧,**MUST NOT 放在 URL query**(会进日志);过期由客户端静默续期。
attachment 是握手期授权快照,MUST 配合失效通道:StrongholdDO 在 `member.ban` / `member.update` / `user.deactivate` 生效时 MUST 通知相关房间 DO,房间 DO MUST 关闭该 actor 的连接或改写其 attachment;仅靠 token `exp` 不构成撤销。撤销时延上界:房间 WS token `exp` MUST ≤ 300 s,宾客会话 token `exp` MUST ≤ 24 h;收到 `user.deactivate` / `member.ban` 的实例 MUST 立即作废对应会话。残余风险窗口 = 未过期 token 的剩余 `exp`,M0 规范 MUST 明示该残余。
读路径与写路径同等鉴权:成员列表、申请记录、据点配置等 GET 端点 MUST 按角色裁剪。
---
## 10. 平台约束(已核实)
| 项 | 核实值 | 应对 |
|---|---|---|
| DO 免费计划 | 可用,仅 SQLite backend;100k req/天、13,000 GB-s/天、5M 行读 + 100k 行写/天、全账户 5GB | 见 §2.1 |
| DO SQLite 容量 | **10 GB / 对象**;付费总量不限,$0.20/GB-月(含 5GB) | 三层归档 |
| DO 时长计费 | 常醒 DO = 10,800 GB-s/天 = 免费日配额 83% | timer 按需存在;心跳走 auto-response |
| WS 计费 | 入站消息 20:1 计为请求,**出站免费**,握手计 1 请求 | tips 走 WS 推送 |
| WS attachment | **16,384 字节** | 存最小状态 |
| SSE on DO | 不受 Hibernation 支持 | 一律 WS |
| Worker 子请求 | 免费 50(外部)+ 1000(CF 服务另计);**付费默认 10,000**,可配至 10M | fan-out 走 Queues |
| Queues | 免费档可用:10k ops/天、保留固定 24h;付费 1M ops/月、最长 14 天;完整投递 ≈ 3 ops | 超 24h 重试需 D1 outbox |
| D1 | FTS5 可用(不可自定义 tokenizer);免费 500MB/库,付费 10GB/库(**硬上限**) | 消息不进 D1 |
| Ed25519 in WebCrypto | 标准标识符 `"Ed25519"`,无需 compatibility flag;`NODE-ED25519` 已 legacy | 直接使用 |
| PBKDF2 in WebCrypto | **迭代硬顶 100k**(超出抛 NotSupportedError;本地 workerd 不执行该限制,生产才暴露) | 口令散列固定 100k;更高强度需换 argon2 类库 |
| 浏览器同域 WS 并发 | Chrome 每源 255、Firefox 全局 200;CF 边缘不宣告 RFC 8441,WS 走 HTTP/1.1 Upgrade 各占一条 TCP | 每客户端 1–5 条,非约束 |
| 前端托管 | Pages 处于维护模式,新功能仅进 Workers | 用 Workers static assets |
| DO 单点吞吐 | 串行执行 | 批广播 + 按 actor 限流 |
---
## 11. 资源与 IP
**表情包技术面**:R2 存文件 + D1 存 `emotes(id, name, r2_key, pack_id)`,前端 `:name:` 替换。
**授权现状**(2026-08-19 运营者一手澄清):Mew **Logo/字标为受保护资产**,不使用;**Mew 自有表情包与官方插画**经运营人员停运前授予任意使用许可,可在实例中使用(官方吉祥物插画 76+116 文件已确认本地可恢复)。第三方 IP 包不属该许可范围:aru(阿鲁)署名画师微博 @\_SiC\_、2233 娘系 bilibili 官方 IP、萌百娘系萌娘百科——均不使用。
**资产现状**:三包共 338 张图片已随原 CDN 域名 DNS 失效而全部不可达,必须回源重新收集。可迁移的只有 desc 清单与 `id$hash$desc` 交换格式的**思路**,字段语义在 OMEW 中重新定义。分发上资源不进 Git 仓库,提供导入工具由部署者自行提供资源,代码开源与资源授权分发解耦。
**命名**:`openmew.org` / `.dev` / `.app` 均未注册可用;`openmew.com` 已被他人注册,不追;npm 包名 `openmew` 可用;GitHub 组织名定为 **`openmew-project`**(`openmew` 已被占用;`openmew-project` 经 API 实测未被注册)。名称含「Mew」的商标风险(商标权不因停运而放弃)待人工确认。
---
## 12. 里程碑
| 阶段 | 内容 |
|---|---|
| **M0** | 协议规范(不写代码):事件类型表(`item.*` / `tip.*` / `member.*` / `user.*` / `stronghold.*` / `voice.*`,含 `item.delete`、`member.ban`、`user.update`、`user.deactivate`、`stronghold.update`、`stronghold.room.create`);角色模型(owner/mod/member,进 token claims)与审核事件;RFC 8785 签名规范 + 测试向量;幂等两层键;seq 单调与推送连续性不变量;bump 绝对快照;房间 `type`/`capabilities`;据点 `visibility`、房间 `restricted` flag 与转私有语义;媒体引用格式;错误码;退联邦语义;密钥发现端点规范;联邦 SSO 断言 schema;宾客身份表 schema;所有权密钥字段(`ownership_key` / `key_history`)与轮换链;边表 schema 与 `user.link` / `user.link_confirm` / `user.unlink`;`user.moved` / `user.move_objection`、逐边挑战握手端点、双路径与公示期语义 |
| **M1** | 单实例核心:D1 schema + ChannelDO + WS + Vue 前端跑通聊天与发帖;注册门控(邀请码 + Turnstile)与首管理员引导;删除与封禁;附件上传管线(预签名直传 R2 → 上传后 Worker 校验 SHA-256 与嗅探 MIME、通过后才发布 `omew://` 媒体引用;大小 / MIME 白名单);凭证模型(passkey 优先,或密码 + Email Service)与运维重置 CLI;所有权密钥客户端随机生成 + Argon2id 所有权口令加密托管(注册时保存)+ 私钥与边表副本导出;结构化日志、DLQ 告警、DO 容量告警 |
| **M2** | 签名层:单实例下所有事件也走签名路径,不留后门 |
| **M3** | 归档层:DO alarm + R2 分片 + D1 索引 + 历史分页 + FTS5 搜索;备份导出(DO 快照 → R2、D1 dump、restore 文档) |
| **M4** | 分区与顶贴:SectionDO + bump 广播 + 节流 |
| **M5** | 联邦(帖子):两实例互相订阅帖子流,高水位收敛 |
| **M6** | 联邦(频道):联邦 SSO 断言交换 + 宾客身份 + 客户端直连房间 home;边表握手闭环与账号迁移流程(逐边挑战握手 + 公示期 + 异议冻结) |
| **M7** | 语音:接 SFU |

M0 先行:先写规范后写码。
---
## 13. License 与待确认项
**代码 License 已定:AGPL-3.0。** network copyleft 条款与联邦开放目标一致——对外提供服务的自部署方须回馈修改;资产授权与代码授权解耦不变(§11)。不再阻塞首次公开提交。
仍待人工确认(不阻塞 M0):名称含「Mew」的商标风险(§11)。
---
## 14. Mew 对照
可直接复用的考古结论:桌面三栏 flex 布局(最左图标导轨 + 左栏帖子流 26% + 中栏吃剩余 + 右栏主页 17%,顶栏 56px、feed 封面 12rem、圆角 20/15/10/5px)。经一手使用记忆修正:**话题组属于左栏帖子流**(组织/筛选帖子列表,选择器不占最左竖栏——竖栏是据点选择器);帖子卡片 = 标题 + 正文前若干字预览 + 可选封面,点开为**中栏居中悬浮窗**(移动端全屏);**频道选择器位于右栏**(据点主页卡:名称 + 封面 + 描述),中栏顶部显示当前频道描述;用户均有头像(CSS 反推的中栏横向 Tag 条不作准)。OMEW 前端界面语言采用 WinUI 3 / Fluent(vendored 控件,GPL-3.0 合规随附 NOTICE),accent 取 OMEW 双主色;全套语义配色 token(约 30 个 `--colors-*`,含 background 四级、消息气泡收发双色、文字三级层级,主色 #7294DA)—— OMEW MUST 全程用语义 token,不把配色语义压进工具类;话题图标体系(76 个预设图标 + 16 色日本传统色板 + S/M/L 三档);管理功能集(deny 型权限位掩码、受限与黑名单两级惩戒且踢出可回拉黑不可回、join/speak 双申请流三态可复原、申请答题、每据点一个管理专用房间);以及必须原生补齐的原版痛点(PC 端搜索、PC 端据点管理 UI、消息编辑、@提醒、话题栏可展开、图片右键保存、评论「只看某人」、浮层居中、想法栏可调宽)。反面教材:原版 GET 端点权限过宽、token 裸存 localStorage,§9 的读路径同等鉴权即针对此。细节见 [docs/mew-gui-archaeology.md](mew-gui-archaeology.md)。
---
## 15. 技术栈
Vue 3 + TypeScript + Vite,部署于 Cloudflare Workers static assets;后端 Cloudflare Workers + Durable Objects(SQLite storage);存储 D1 / R2(不使用 KV);队列 Cloudflare Queues;签名 Ed25519 via WebCrypto,规范化用 RFC 8785 JCS。无本地设备依赖;VPS 仅在 M7 接自建 SFU 时可能引入。
