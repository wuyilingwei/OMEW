# Mew GUI 考古档案
> 生成:2026-08-18 · 来源:bettermew 用户脚本存档(MyUserScript/userjs/mew,原仓库 yige233/bettermew)
> 用途:OMEW 前端布局/交互/数据模型/管理功能对齐的原型依据

本档案由五份独立分析报告组成:

1. **mew.body.js 逆向**——DOM 层级重建、REST API 全量考古、功能挂载点、布局常量与设置键、WebSocket 事件
2. **框架层(mew.frame.js / 加载器)**——模块框架、设置持久化(可恢复的布局数据)、CSS 注入映射、路由与域名分工、WS 事件词表全集
3. **CSS 反推**——Mew 原生类名清单(按 UI 区域)、三栏布局度量、darkmode 完整配色表、可复用组件样式细节
4. **据点管理面板(16 个模板)**——信息架构、全部卡片字段(=数据模型与审核流)、布局交互、官方 API 能力清单
5. **表情包清单(stamps_*.txt)**——格式、三包内容、宿主可达性探测、授权风险

---
# Mew.fun GUI 考古报告 — 基于 `mew.body.js` 的逆向重建

来源文件：`/Users/user/development/MyUserScript/userjs/mew/mew.body.js`（1731 行，bettermew 用户脚本主体，配套框架 `mew.frame.js`）。以下所有选择器、端点、字段名均为源码原文引用。

---

## 0. 总体技术栈线索

- **前端框架**：Next.js + React + CSS Modules。证据：
  - 默认头像路径 `/_next/static/images/default-avatar-1-d21d3e0c70ccc333b797212fed6be0c9.png`（Next.js 静态资源目录）；
  - 类名统一为 CSS Modules 哈希格式 `{组件}_{元素}__{hash}`，如 `reaction-panel_stamp__8qpSD`、`reaction-panel_image__2FjNq`（脚本中仅这两个保留了完整哈希，其余用 `[class^=]` / `[class*=]` 前缀匹配）；
  - 脚本通过 `MewTool.getreact(el)` 直接读取 DOM 上挂载的 React fiber props（如 `props.children.props.topicId`、`props.id`）。
- **图片服务**：火山引擎 ImageX 风格管线。`https://image.mew.fun/{32位hex hash}` + 模板后缀 `~tplv-c226mjqywu-size:96.image`（96px 缩略图）、`~tplv-c226mjqywu-size:999999.png`（原图转 png）。
- **静态 CDN**：`https://cdn.mew.fun/spacelize/preset/icons/{icon_name}.png`（话题/节点图标，目录名 `spacelize` 暗示"空间化/基建"功能）。
- **图片灯箱**：PhotoSwipe（`.pswp__zoom-wrap` 选择器）。
- **ID 体系**：snowflake 式纯数字 ID，媒体 ID 为 17–18 位数字（校验正则 `/[0-9]{17,18}/`、`/[0-9]{18}?/`），图片 hash 为 32 位十六进制（`/[0-9a-f]{32}?/`）。
- **鉴权**：`localStorage.getItem("mew-token")`（存储值带引号，使用前 `.replace(/"/g, "")`），直接作为 `Authorization` 请求头的值。框架注释称该 token 即"当前用户的登录 cookie"。

---

## 1. 重建的 DOM 层级

### 1.1 页面路由

| 路由 | 含义 |
|---|---|
| `/n/{node_name}` | 据点页。脚本用 `window.location.pathname.slice(3)` 截取 `node_name`（去掉 `/n/` 前缀） |
| `/n/{node_name}?topicId={topic_id}` | 据点页并定位到某话题（分享/通知跳转用） |
| `https://mew.fun/betterMew/thoughts/{thought_id}` | 想法全文页。脚本用任意段 `/betterMew/` 也能打开，说明真实路由形如 `/*/thoughts/{id}` 或 `/thoughts/{id}`，中段宽松 |

### 1.2 桌面三栏（+据点导轨）总布局

bettermew 的 `desktop` 插件在 `document.body` 上注入两个 CSS 变量控制列宽：

- `--left-width` ← 设置项 `left_width`，**"想法栏宽度(%)"，默认 26%，上限 50%**
- `--right-width` ← 设置项 `right_width`，**"主页栏宽度(%)"，默认 17%，上限 50%**

即桌面版为「左：想法列表栏（约 26%）／中：主内容（剩余宽度）／右：主页栏（约 17%）」，另加最左侧一条窄的**据点图标导轨**。`desktop_reverse` 插件可整体镜像该排列（"实际上是将整个桌面的排列顺序进行了反转"）。

```
body  (--left-width / --right-width)
├── 据点导轨（最左窄栏）
│   ├── [class^='sidebar_logo__']          ← Mew logo，位于据点列表最上方
│   │      （search 插件在其后 .after() 插入 40×40px 的 #icon_search）
│   ├── 据点图标列表（默认可见数量少；compact_thought_more_node 插件
│   │      的 CSS 使其"可显示四个据点"——原版可见数 < 4）
│   └── [class*='sidebar_selected__']      ← 当前选中项高亮类
│          其 parentNode 带 data-id 属性 = 当前话题 topic id
├── 想法栏（左列，想法/post 流）
│   ├── 想法卡片：含图片 + 文字摘要
│   │      compact_thought_hide_img 隐藏卡片图片
│   │      compact_thought_hide_text 缩减文字高度
│   └── （卡片内部类名未被脚本直接引用，仅由远程 CSS 修改）
├── 主内容栏（中列：想法全文 / 话题聊天二选一）
│   ├── 话题栏（话题 Tag 横条）
│   │   └── [class*='panel_list__']        ← 话题 Tag 列表容器
│   │          topic_list 插件 CSS：鼠标悬停展开全部话题 Tag，移出收起
│   │          → 原版话题栏是折叠/单行的
│   ├── 讨论区（话题聊天）
│   │   ├── div[class*='message-container_widget__']   ← 聊天消息容器
│   │   │      React props 链：getreact(el).children[0].props.children.props.topicId
│   │   ├── div[class*='message-text_sent__']          ← 自己发出的文本消息
│   │   │      需同时含 message-text_bubble__（消息气泡）才算有效消息
│   │   ├── [class*='message-text_name__']             ← 文本消息的发送者昵称
│   │   ├── [class*='message-image_name__']            ← 图片消息的发送者昵称
│   │   ├── [class^='text-area-bar_form-root__']       ← 聊天输入框根节点（可 .focus()）
│   │   └── [class^='reaction-panel_stamp-list__']     ← "发送表情"面板的表情列表
│   │       └── button.reaction-panel_stamp__8qpSD     ← 单个表情按钮（完整哈希类名）
│   │           └── picture.reaction-panel_image__2FjNq
│   │               ├── source[srcset]
│   │               └── img
│   └── 想法全文视图
│       ├── [class^='thought_name__']       ← 想法作者昵称
│       ├── #comments                        ← 评论区容器（id！）
│       │      注意：脚本总是取 document.querySelectorAll("#comments") 的
│       │      最后一个 —— 说明想法全文视图可叠加多层，页面上会同时存在
│       │      多个 #comments（层叠式浮层导航）
│       └── [class^='comments_right-btn__']  ← 评论区右侧按钮组（querySelectorAll 取 [0]），
│              其中有原生"只看作者"按钮（innerText == "只看作者"），
│              点击后原生请求会带 authorOnly=1 参数
├── 主页栏（右列，--right-width）
└── 浮层
    ├── .pswp__zoom-wrap                     ← PhotoSwipe 图片灯箱（点开原图）
    │      内含 img（.src 为 image.mew.fun 原图 URL）
    ├── 私聊窗口（whisper）——原版"靠边显示"，whisper_in_middle 插件改为居中
    └── 想法全文浮层——原版"靠边显示"，thought_in_middle 插件改为居中
```

### 1.3 bettermew 自注入的 DOM（非原版，但反映交互模式）

- `#icon_search`（40×40px，插在 `sidebar_logo` 之后）；搜索页：`.form > .search_input + .search_btn`、`#sort.sort.switcher`（倒序开关，实现是 `#searchres` 加 `flex-direction: column-reverse`）、`#searchres` 结果容器；结果卡 `.searchitem > .poster (img + .nickname + .date + .shareto) + p.content`。
- 回到顶部：`.thought-widget > .to-top`（40×40px，`cursor:pointer`，点击对 `#comments` 的 `parentNode.parentNode` 执行 `scrollTo({top:0, behavior:"smooth"})` —— 说明滚动容器是 `#comments` 的祖父节点）。
- 表情管理页：`.stamp_manage`（ul）、`.stamp_card`、`.add_stamp_card`、`#preview_stamp`（预览图，5 秒倒计时属性 `disapper-count`）。
- 据点管理页（模板从 jsDelivr 拉取 16 个 HTML 模板）：分区锚点 `#node_basic`、`#node_speech`、`#node_topic`、`#node_member`、`#node_join`、`#node_speak`、`#node_library`；通用结构类 `.accordion__header` / `.accordion__content` / `.content` / `.tab1` `.tab2` `.tab3` / `.container__input` / `.input_container`；基建网格 `.ic_root > div[pos='x,y']`（`deployed` 属性，`(0,0)` 格固定放据点图标不可部署）；图标编辑 `.node_edit_items`、`.node_edit_selecor`、`#node_preview`、尺寸类 `.icon_size_S / .icon_size_M / .icon_size_L`；成员卡锚点 `#member_{username}`、书架锚点 `#shelf_{parent_id}`。
- 标记类（幂等防重挂）：`.custom_stamps`、`.onlyauthor-hook`、`.mark_mewmsg_edit`、`.called`、`.pswp__zoom-wrap-marked`。

---

## 2. API 考古

REST 基址：`https://api.mew.fun/api/v1`。请求头：`Authorization: <mew-token>`、`Content-type: application/json; charset=utf-8`。**请求体字段为 camelCase，响应体为 snake_case**（如请求 `enableSpeakQuestion`/`superModerator`/`permissionsDeny`/`parentId`，响应 `enable_speak_question`/`super_moderator`/`permissions_deny`/`parent_id`）。列表响应统一为 **`{entries: [...], objects: {users: {}, topics: {}, media: {}}, next_cursor / pagination}`**（实体正文 + 按 id 索引的关联对象池——Twitter API v2 式数据模型）。空成功响应为 `204 No Content`，错误响应含 `message` 字段。

### 2.1 用户

| 端点 | 方法 | 读/写字段 |
|---|---|---|
| `/users/@me/mynodes` | GET | `entries[]: {id, name, node_name, topics[]: {id, name}}` — 我加入的据点及其话题 |
| `/users/@me` | PATCH | 请求 `{avatar: <18位媒体id>}`；响应 `{avatar}` |
| `/users/{user_id}` | GET | 读 `username` |

### 2.2 据点（node）

| 端点 | 方法 | 字段 |
|---|---|---|
| `/nodes/{node_name 或 node_id}` | GET | `id, name, node_name（url 短名）, icon（媒体id）, searchable（bool）, tags[]（字符串数组）, enable_speak_question, speak_questions[]: {id, content}, enable_join_question, join_questions[]: {id, content}, super_moderator（用户id）, moderation_topic_id, map_size（3 或 5）, member: {is_moderator, is_super_moderator}, topics[]: {id, name, deployed, space_position: {x, y, z}, icon: {name, size, color, customize}, thought_count, message_count}, objects: {users, topics, media}` |
| `/nodes/{node_id}` | PATCH | `{name, node_name, icon, searchable, tags, enableSpeakQuestion, enableJoinQuestion, superModerator}`（superModerator = 领主转移） |
| `/nodes/{node_id}/questions/{question_id}` | PATCH | `{content}` — 修改加入/发言问题 |
| `/nodes/{node_name}/search-thoughts?keyword=&limit=100[&pagination=]` | GET | `entries[]: {id, status（想法正文）, author_id, created_at}`；`objects.users[author_id].{name, avatar}`、`objects.media[avatar_id].url`；`pagination` 游标；满 100 条翻页 |

### 2.3 话题（topic）与基建（spacelize）

| 端点 | 方法 | 字段 |
|---|---|---|
| `/nodes/{node_id}/topics` | POST | `{name, icon: {name, size: "S"/"M"/"L", color, customize: false}}` |
| `/topics/{topic_id}` | PATCH / DELETE | 同上编辑 / 删除话题 |
| `/topics/{topic_id}/moderation` | PATCH | `{name}` — 管理专用话题改名 |
| `/nodes/{node_id}/topics/space-position` | POST | `{View: [{id, position: {x, y, z:0}, icon}]}` — 基建网格布局保存 |
| `/nodes/{node_id}/topics/position` | PATCH | `{positions: [{id, position: <序号>}]}` — 话题列表排序 |
| `/topics/{topic_id}/messages` | POST | 三种消息体：文本 `{nonce, content}`；图片/表情 `{nonce, media: [媒体id]}`；**分享想法 `{type: 2, thought: thought_id}`**。`nonce` 为 18 位随机数字字符串（客户端去重） |

基建规则（脚本内提示文案）："3x3……任意时刻节点总数超过 5 个，基建规模即可扩大至 5x5"；3x3 改动"至少 5 分钟才会应用"，5x5 立即生效。

### 2.4 消息

| 端点 | 方法 | 字段 |
|---|---|---|
| `/messages/{message_id}` | PATCH | `{content}`；响应含 `created_at`（脚本借此读取消息元数据） |
| `/messages/{message_id}` | DELETE | 撤回消息（脚本自限 120 秒内） |

### 2.5 成员 / 申请 / 黑名单

| 端点 | 方法 | 字段 |
|---|---|---|
| `/nodes/{node_id}/members?limit=50[&type=restricted]` | GET | `entries[]: {user_id, node_id, is_moderator, is_super_moderator, permissions_deny}`；`next_cursor`，翻页参数 `&after=`；`type=restricted` 为受限成员 |
| `/nodes/{node_id}/members/search?keyword=[&type=restricted\|blocked]` | GET | 成员搜索 |
| `/nodes/{node_id}/members/{user_id}` | PATCH | `{isModerator: bool, permissionsDeny: <位掩码>}` |
| `/nodes/{node_id}/members/{user_id}` | DELETE | 移出据点（可重新加入） |
| `/nodes/{node_id}/bans?limit=50` | GET | `entries[]: {user_id, node_id, banned_at, operator_id}` |
| `/nodes/{node_id}/bans/{user_id}` | PUT / DELETE | 拉黑 / 解除拉黑 |
| `/nodes/{node_id}/applications?type=join\|speak&state=pending\|approved\|rejected&limit=50` | GET | `entries[]: {user_id, node_id, applied_at, answers[]: {content}}` — 入据点申请与发言申请两套并行 |
| `/nodes/{node_id}/applications/{join\|speak}/{user_id}` | PATCH | `{state: "approved" / "rejected" / "pending"}`（rejected 可恢复为 pending） |

**权限位掩码 `permissions_deny`（数据模型核心发现）**：`16 = 讨论(talk)`、`32 = 想法(thought)`、`64 = 评论(comment)`，按位相加；0 为全允许。成员身份三级文案：`is_super_moderator → "领主"`，`is_moderator → "管理员"`，否则 `"成员"`。

### 2.6 据点图书馆（书架）

| 端点 | 方法 | 字段 |
|---|---|---|
| `/nodes/{node_id}/libraries` | GET | `entries[]: {id, parent_id, name, description, icon}` — 扁平列表，`parent_id` 为空是书架、非空是词条 |
| `/nodes/{node_id}/libraries` | POST | `{name, description, icon, parentId}` |
| `/nodes/{node_id}/libraries/{entry_id}` | PATCH / DELETE | 同上编辑 / 删除 |

### 2.7 ajax-hook 拦截（评论 API）

`only_this_mewer` 插件注入 `https://unpkg.com/ajax-hook@2.0.3/dist/ajaxhook.min.js`，用 `ah.proxy({onRequest, onResponse, onError})` 拦截 XHR：命中 `response.config.url.indexOf("authorOnly=1")` 的响应（即原生"只看作者"按钮发出的评论列表请求），去掉 `&authorOnly=1` 重新 fetch 后本地按昵称过滤再回填。由此可知**想法评论列表 API 支持 `authorOnly=1` 查询参数**，其响应形如 `{entries: [{id, author_id, deleted}], objects: {users: {id: {name}}}}`（脚本用 `{id: <上一条id>, deleted: true}` 的假条目填充分页占位，说明评论列表按 20 条一页拉取且渲染层认识 `deleted` 标记）。

---

## 3. 功能 → 挂载点映射

| 插件 id | 功能 | 挂载点 / 机制 |
|---|---|---|
| `desktop` | 三栏宽度调节 | `document.body` 注入 `--left-width` / `--right-width` + 远程 `css_desktop` |
| `thought_in_middle` | 想法全文居中 | 纯 CSS（原版靠边） |
| `whisper_in_middle` | 私聊窗口居中 | 纯 CSS（原版靠边） |
| `desktop_reverse` | 左右栏互换 | 纯 CSS（整体反转排列） |
| `img_size` | 全文图片宽度 | `body` 注入 `--img-width` / `--img-left` |
| `compact_thought_hide_img` | 想法栏隐藏图片 | 纯 CSS，作用于左侧想法卡片 |
| `compact_thought_hide_text` | 想法栏压缩文字 | 纯 CSS |
| `compact_thought_more_node` | 据点导轨显示 4 个据点 | 纯 CSS |
| `topic_list` | 话题栏悬停展开 | 纯 CSS，作用于话题 Tag 栏 |
| `thought_widget` | 回到顶部按钮 | append 到最后一个 `#comments`；滚动容器为其 `parentNode.parentNode` |
| `only_this_mewer` | 只看某人评论 | ajax-hook 拦截 `authorOnly=1`；劫持 `[class^='comments_right-btn__']`[0]（原生"只看作者"按钮）；作者名取自 `[class^='thought_name__']` |
| `search` | 据点内想法搜索 | `#icon_search` 插在 `[class^='sidebar_logo__']` 之后；调 `search-thoughts` API；结果可经 `POST /topics/{id}/messages {type:2, thought}` 分享至讨论 |
| `custom_stamp` | 自定义表情 | append 进 `[class^='reaction-panel_stamp-list__']`；topic id 来源二选一：`[class*='panel_list__'] [class*='sidebar_selected__']` 的 `parentNode.data-id`，或 `message-container_widget__` 的 React props `topicId` |
| `node_manage` | PC 端据点管理面板 | 独立浮层页（`MewTool.stdpage`），16 个远程 HTML 模板；覆盖基本信息/发言与加入问题/话题与基建/成员/申请/书架 |
| `msg_edit` | 2 分钟内撤回重发 | `div[class*="message-text_sent__"]`（须含 `message-text_bubble__`）父节点 contextmenu；message id 取 React props `children[0].props.id`，正文取 `children[1].props.children.props.children` |
| `at` | @提醒 | `mew.ws.on("message_create")` 推送匹配；点击 `message-text_name__` / `message-image_name__` 复制 `@昵称` 并 focus `[class^='text-area-bar_form-root__']` |
| `tool_avatar` | URL 设头像 | 无挂载（设置页按钮），`PATCH /users/@me` |
| `custom_css` | 自定义样式 | `MewTool.loadcss` 注入任意 CSS |
| `fix_img_menu` | 原图右键菜单 | `.pswp__zoom-wrap`（PhotoSwipe 灯箱）contextmenu：新标签打开/保存/复制到剪贴板/复制链接/存为表情 |

---## 4. 布局常量与设置键

### 4.1 可恢复的布局数据

| 常量 | 值 | 含义 |
|---|---|---|
| `left_width` 默认 | **26**（%，max 50） | 想法栏默认宽度 ≈ 原版观感 |
| `right_width` 默认 | **17**（%，max 50） | 主页栏默认宽度 |
| `img_width` 默认 | **50**（%，max 100） | 全文图片宽度；居中偏移 `--img-left = (100 − width) / 2 %` |
| 按钮尺寸 | 40×40 px | 搜索图标、回到顶部按钮 |
| 头像缩略图 | 96 px（`size:96.image`） | 全站头像/表情缩略规格 |
| 据点导轨可见数 | 原版 < 4（插件扩到 4） | 窄导轨设计 |
| 评论分页 | 20 条/页 | ajax-hook 填充逻辑推得 |
| 搜索分页 | 100 条/页（`limit=100` + `pagination` 游标） | |
| 成员/申请分页 | 50 条/页（`limit=50` + `next_cursor`/`after`） | |
| 消息可撤回窗口 | 120 秒 | |
| 消息 nonce | 18 位随机数字 | 客户端幂等键 |
| 基建网格 | 3×3（据点话题 >5 个解锁 5×5）；`(0,0)` 固定为据点图标 | `space_position {x,y,z}` |
| 话题图标 | 75 个预置图标名（`friends`、`like-bubble`、`talk-bubble`、`parchment`、`pub`、`crown`、`black-cat` … `sliced-cylinder`），尺寸 `S/M/L`，`customize: false` | `cdn.mew.fun/spacelize/preset/icons/{name}.png` |

### 4.2 话题图标 16 色板（日本传统色命名，key → 中文名 → hex）

`ruri` 琉璃 `#2151a2`、`yamabuki` 山吹 `#f2ab31`、`terigaki` 照柿 `#af5d3e`、`tsuyukusa` 露草 `#4b9dd7`、`entan` 铅丹 `#c0544d`、`seiji` 青磁 `#6da4a2`、`kikyo` 桔梗 `#5b468e`、`wakatake` 若竹 `#649f78`、`kurumi` 胡桃 `#857063`、`benimidori` 红碧 `#7485c9`、`tokusa` 木贼 `#356143`、`kohaku` 琥珀 `#b7732f`、`kyara` 伽罗 `#684c29`、`ichigo` 莓 `#9f4851`、`araisyu` 洗朱 `#eb9167`、`momo` 桃 `#e591a0`。

### 4.3 设置键（bettermew 侧持久化，经框架 `configs` 存取）

| 插件.键 | 类型/形态 | 说明 |
|---|---|---|
| `desktop.left_width` / `desktop.right_width` | number | 见上 |
| `img_size.img_width` | number | 见上 |
| `only_this_mewer.only_this_mewer` | string | 目标昵称 |
| `custom_stamp.stamps` | string[]，每项 `"{媒体id}${hash}${说明}"`（`$` 分隔） | 可导入导出 txt，`#` 开头行为注释 |
| `at.keywords` | string[]（UI 中按行分隔） | 触发 @提醒的关键词 |
| `at.ats` | `{"u<user_id>": [unix秒,...]}` | 频率记录：同一人 180 秒内 @ 达 7 次 → 拉黑 |
| `at.block` | `{"u<user_id>": <解封unix秒>}` | 封禁 900 秒（15 分钟） |
| `custom_css.custom_css` | string | 原样注入 |
| 站方 localStorage：`mew-token` | JSON 字符串（带引号） | 登录凭据 |

@检测正则：`` new RegExp(`@${name}[,|，|。|？|?|!|：|:|;|！|\s]{1}`) `` 或 `` `@${name}$` `` —— @昵称后跟标点/空白/行尾即命中；匹配对象含 `mew.ws.user.name` 与 `mew.ws.user.username` 两种。

---

## 5. WebSocket / 实时机制

- **网关**：`wss://gateway.mew.fun/socket.io/?EIO=4&transport=websocket` —— Socket.IO（Engine.IO v4），纯 WebSocket 传输。鉴权用当前用户登录 cookie（`mew.ws.token`）。无用户登录时停止连接；断开自动重连（`mew.ws.close(reconnect)` 默认重连，`mew.ws.connect()` 手动连接，`readyState` 语义同原生 WebSocket）。
- **事件全集**（框架注释列出，每个事件的 `data` 恒有 `event_type` 字段）：
  - 消息：`message_create`、`message_delete`、`user_typing`
  - 想法：`thought_create`、`thought_update`、`thought_delete`、`thought_engagement`、`thought_pin`、`thought_unpin`
  - 据点：`node_update`、`node_member_activity_change`、`node_member_update`、`node_member_ban`、`node_member_add`、`node_member_remove`
  - 话题:`topic_create`、`topic_update`、`topic_delete`、`topic_position`
  - 评论：`comment_create`、`comment_engagement`
  - 其他：`user_relationship_update`、`role_update`、`notification`
- **`message_create` 载荷字段**（`at` 插件实际读取）：`{content, author_id, node_id（私信为空）, topic_id, objects: {users: {id: {name}}}}` —— 与 REST 相同的 entries/objects 规范化风格；据此可区分"据点话题消息"与"私信"。
- 事件命名精确对应数据模型四实体（node / topic / thought+comment / message）+ 成员关系 + 通知，`thought_engagement` / `comment_engagement` 说明点赞等互动走独立轻量事件。`thought_pin` / `thought_unpin` 证实想法置顶功能。
- 无轮询痕迹：脚本内所有实时性均依赖该 socket.io 网关；DOM 变化侦测由框架的 `func_loop`（DOM 树每更新执行一次，即 MutationObserver 驱动）承担，与服务端无关。

---

## 6. 对后继平台前端设计的关键结论

1. **数据模型**：node（据点）→ topic（话题，兼具聊天频道与基建格子实体，带 `thought_count`/`message_count`）→ thought（想法，正文字段名为 `status`）→ comment；message 独立于 thought，同 topic 下并存"想法流"与"聊天流"；`{type:2, thought:id}` 的消息类型实现想法→聊天的内嵌分享卡。
2. **响应规范**：`entries + objects{users,topics,media} + next_cursor/pagination` 的规范化引用池贯穿 REST 与 WS，前端可用同一套 store 归一化逻辑。
3. **权限**：三级身份（领主/管理员/成员）+ `permissions_deny` 位掩码（16 talk / 32 thought / 64 comment）+ 双申请流（join/speak，三态 pending/approved/rejected 可互转）+ 双问题开关（join_question/speak_question）。
4. **布局**：据点窄导轨 + 26% 想法栏 + 主内容（含折叠话题 Tag 条、层叠 `#comments` 浮层导航）+ 17% 右栏；浮层（想法全文、私聊）原生靠边停靠，为社区最常抱怨点（多个插件专门将其居中）。
5. **原版 GUI 痛点清单**（每个插件即一条原版缺陷）：无 PC 端搜索、无 PC 端据点管理、无消息编辑、无 @提醒、话题栏不可展开、图片不可右键保存、评论区无"只看某人"、浮层不居中——后继平台应原生补齐。


---

# bettermew 框架层报告（mew.frame.js / tampermonkey(.user).js，附 mew.body.js 佐证）

来源文件：
- `/Users/user/development/MyUserScript/userjs/mew/mew.frame.js`（框架 v0.77）
- `/Users/user/development/MyUserScript/userjs/mew/tampermonkey.user.js`（加载器 v0.37）与 `tampermonkey.js`（v0.36，仅 CDN 域名差异：`fastly.jsdelivr.net` vs `cdn.jsdelivr.net`）
- 模块列表与设置键需引用 `/Users/user/development/MyUserScript/userjs/mew/mew.body.js`（本地存档，98369 字节）与 `/Users/user/development/MyUserScript/userjs/mew/css/frame.css`

---

## 1. 模块化装载框架

### 1.1 三级加载链

1. **Tampermonkey 加载器**（`tampermonkey.user.js`）：`window.onload` 后请求 `https://api.mew.fun/api/v1/users/68907366539980800`（脚本作者的公告专用账号），把该用户 profile 的 `description` 字段第 2 行 `JSON.parse` 成公告对象 `{ver, hash, whatsnew[]}`，然后以 `<script type="module">` 注入 `https://fastly.jsdelivr.net/gh/yige233/bettermew@${announce.hash}/mew.body.js`（Beta 通道则为 `https://pc.doveyige.top/mew/mew.body.js`）。即：**用 Mew 自身的用户简介字段做版本分发通道**。
2. **mew.body.js**：`import { MewTool, MewPlugin, mew } from "./mew.frame.js"`，随后逐个 `mew.load(new MewPlugin(...))`。
3. **mew.frame.js**：定义 `Mew_ws` / `BetterMew` / `class_mp_configs` / `MewPlugin` / `MewTool`，末尾 `const mew = new BetterMew()` 单例导出。

### 1.2 插件注册协议（`MewPlugin`）

```js
new MewPlugin(id, {
    short_desc,   // 设置页行首标题
    long_desc,    // 设置页行内说明
    func_once,    // 启用时执行一次；返回值存入 this[mp_func_once_result]（getter: func_once_result）
    func_loop,    // DOM 每变动一次执行一次
    hide,         // true = 不在设置页渲染开关行
    always,       // true = 强制加入 active_plugins
}).addConf(confId, config)   // 链式添加设置项
```

`BetterMew.load(plugin)`：
- id 查重（`throw "重复的插件id："`）；
- `always` 插件自动写入 `active_plugins`；`"bettermew"` 核心插件永远在列；
- 激活的插件执行 `func_once()`（try/catch 包裹），并把 id 推入 `bm_loop` 队列。

**主循环不是定时器**，而是一个挂在 `document` 上的 `MutationObserver({childList:true, subtree:true, arrtibutes:true /*原文拼错*/})`：每次 DOM 变动即调用 `this.render()`（保证设置齿轮存在）+ 顺序执行所有激活插件的 `func_loop()`。这是脚本对 Mew（Next.js/React SPA）路由切换的适配方式——**不监听路由，只靠 DOM 变化重入 + 幂等标记类**（如 `.mark_mewmsg_edit`、`.called`、`.onlyauthor-hook`、`.custom_stamps`、`.pswp__zoom-wrap-marked` 防重复绑定）。

`mew.isActive(id)` 供插件间联动（如 `fix_img_menu` 右键菜单里按 `custom_stamp` 是否启用追加"保存为自定义表情"项）。

### 1.3 WebSocket 事件总线（`Mew_ws`）

- 地址固定 `wss://gateway.mew.fun/socket.io/?EIO=4&transport=websocket`（socket.io EIO4 裸帧：收 `0` 发 `40`，收 `2` 发 `3` 心跳，收 `40` 发 `420["identity", "{token, platform:\"web\", active:true}"]`；`42` 帧里 `type=="dispatch"` 时按 `message.event` 分发）。
- token 直接取 `localStorage.getItem("mew-token")` 去引号——**Mew 官方前端把登录 token 存在 localStorage 的 `mew-token` 键**。
- 已注册事件名全集（`data_mw_events`，等于 Mew 网关的事件词表）：`user_update, user_typing, user_relationship_update, node_create, node_update, node_delete, node_position, node_topic_space_position_change, topic_create, topic_update, topic_delete, topic_position, role_create, role_update, role_delete, role_position, node_member_add, node_member_update, node_member_remove, node_member_ban, node_member_activity_change, message_create, message_update, message_delete, message_engagement, message_acknowledge, thought_create, thought_update, thought_delete, thought_engagement, comment_engagement, comment_create, comment_update, comment_delete, notification, thought_pin, thought_unpin, app_update`。断线自动重连；无 token 时主动关闭。

### 1.4 模块清单（mew.body.js 注册顺序）

| id | short_desc | 说明 / 机制 |
|---|---|---|
| `bettermew` | （hide+always，核心） | 存 `active_plugins`、`notification` |
| `desktop` | 桌面布局更改 | 注入 desktop.css，`func_loop` 写 body 内联 CSS 变量 `--left-width` / `--right-width` |
| `thought_in_middle` | 想法全文居中 | 纯 CSS |
| `whisper_in_middle` | 私聊窗口居中 | 纯 CSS |
| `desktop_reverse` | 调换想法栏和主页栏 | 纯 CSS（整个桌面排列反转） |
| `img_size` | 调整想法全文内图片大小 | CSS + 变量 `--img-width`、`--img-left=(100-width)/2%` |
| `compact_thought_hide_img` | 隐藏图片 | 隐藏左侧想法栏图片，纯 CSS |
| `compact_thought_hide_text` | 缩减文字 | 缩减左侧想法栏文字高度，纯 CSS |
| `compact_thought_more_node` | 更多据点 | 左侧据点栏显示 4 个据点，纯 CSS |
| `topic_list` | 更好的话题栏 | hover 展开全部话题 Tag，纯 CSS |
| `thought_widget` | 回到顶部 | 向最后一个 `#comments` 追加 `.thought-widget > .to-top`（40×40px，背景 totop.svg） |
| `only_this_mewer` | "只看Ta" | 注入 `unpkg.com/ajax-hook@2.0.3` 劫持 XHR：拦截含 `authorOnly=1` 的评论请求并按昵称客户端过滤；按钮宿主 `[class^='comments_right-btn__']` |
| `search` | PC端想法搜索 | 在 `[class^='sidebar_logo__']` 后插 `#icon_search`（40×40px）；调 `/nodes/{node}/search-thoughts?keyword=&limit=100&pagination=`，结果卡 `.searchitem`，可"分享想法至讨论"（POST `/topics/{id}/messages` body `{type:2, thought}`） |
| `custom_stamp` | 自定义表情 | 向 `[class^='reaction-panel_stamp-list__']` 注入自定义表情按钮（复用 Mew 原类 `reaction-panel_stamp__8qpSD` / `reaction-panel_image__2FjNq`）；发送即 POST `/topics/{topicid}/messages` body `{nonce(18位随机数字), media:[id]}`；带完整管理页（增删排序、txt 批量导入导出，格式 `id$hash$desc` 每行一条，`#` 开头为注释，id 为 17-18 位雪花） |
| `node_manage` | PC端据点管理 | 16 个远程 HTML 模板拼出的完整据点后台：基本信息/发言与加入问题/基建(3x3、5x5 空间拓扑 `space-position`)/节点(话题)排序删除/成员(领主转移、任免管理员、permissionsDeny 位掩码 16=参与讨论 32=发想法 64=评论)/黑名单/加入申请/发言申请/书架(libraries 两级：书架→词条) |
| `msg_edit` | 修改消息 | 右键 `div[class*="message-text_sent__"]`（须含 `message-text_bubble__`），2 分钟内 DELETE 旧消息 + POST 新消息模拟"编辑" |
| `at` | @功能 | 监听 ws `message_create`，正则匹配 `@昵称[标点/空白/行尾]`，系统通知跳 `https://mew.fun/n/{node_name}?topicId={topic_id}`；附防骚扰限流（180 秒内被同一人 @ 7 次 → 拉黑 900 秒）；点 `[class*='message-text_name__']`/`[class*='message-image_name__']` 复制 `@昵称` 并 focus `[class^='text-area-bar_form-root__']` |
| `tool_avatar` | （hide+always） | 按钮：输入 Mew 图片 url → `imgurl2id` → PATCH `/users/@me` `{avatar:id}` |
| `custom_css` | 自定义css | 把文本框内容原样 `loadcss` |
| `fix_img_menu` | 修复保存不了图片 | 给 PhotoSwipe 原图容器 `.pswp__zoom-wrap` 加右键菜单：新标签打开/保存(blob 下载)/复制到剪贴板(取 `url+"~tplv-c226mjqywu-size:999999.png"`)/复制链接 |

---

## 2. 设置持久化（可恢复的布局数据）

### 2.1 存储介质

- **单一 localStorage 键 `bettermew`**，值为 JSON：`{ [pluginId]: { [confId]: value } }`。写入路径：`class_mp_configs.set(id, value)` → 更新内存 → 全量 `JSON.stringify` 回写。`set(id, undefined)` 表示重置为默认值。Tampermonkey 菜单"清除所有设置"即 `localStorage.setItem("bettermew", "{}")`。
- Tampermonkey `GM.setValue`：`is_bata`（boolean，默认 `false`，Beta 通道开关）、`version`（string，公告版本号，用于更新日志只打印一次）。
- 只读依赖：`localStorage["mew-token"]`（Mew 官方的 JWT，两侧带引号，脚本 `.replace(/"/g,"")` 后作为 `Authorization` 头裸用）。

### 2.2 全部设置键枚举

| 存储路径 (`bettermew.<plugin>.<key>`) | type | 默认值 | max | UI 控件 | 语义 |
|---|---|---|---|---|---|
| `bettermew.active_plugins` | `none` | `[]` | — | 无（由各插件行的开关间接维护） | 启用的插件 id 数组 |
| `bettermew.notification` | `none` | `true` | — | 无 | 是否已提示过浏览器通知授权 |
| `desktop.left_width` | `number` | `26` | `50` | 滑动条 | **想法栏宽度 %** → `--left-width` |
| `desktop.right_width` | `number` | `17` | `50` | 滑动条 | **主页栏宽度 %** → `--right-width` |
| `img_size.img_width` | `number` | `50` | `100` | 滑动条 | 想法全文内图片宽 % → `--img-width` |
| `only_this_mewer.only_this_mewer` | `none` | `""` | — | 无（由 prompt 写入） | "只看Ta"的目标昵称 |
| `custom_stamp.stamps` | `button` | `[]` | — | 按钮"打开表情管理页" | `"id$hash$desc"` 字符串数组（id=媒体雪花 id，hash=32 位十六进制图片 hash） |
| `node_manage.btn` | `button` | `""` | — | 按钮"打开据点管理页" | 无实际值 |
| `at.keywords` | `text` | `[]` | — | `textarea.mytextarea`（每行一个关键词，get 时 `join("\n")`，set 时 `split("\n").filter`） | 额外触发 @ 提醒的关键词 |
| `at.ats` | `none` | `{}` | — | 无 | `{ "u<userId>": [unix秒,...] }` 最近 @ 时间窗（限流用） |
| `at.block` | `none` | `{}` | — | 无 | `{ "u<userId>": 解除时刻unix秒 }` 限流黑名单 |
| `tool_avatar.btn` | `button` | `""` | — | 按钮"输入图片url" | 无实际值 |
| `custom_css.custom_css` | `text` | `""` | — | `textarea.mytextarea` | 用户自定义 CSS 全文 |

**布局考古要点**：Mew 原版桌面为三栏（左=想法/据点栏、中=内容、右=主页栏），bettermew 默认恢复值 **左 26% / 右 17%**（各上限 50%）就是作者认可的原版近似比例；图片默认占想法宽度 50% 且居中（`--img-left=(100-w)/2`）。

### 2.3 number 型控件精确规格

`<input type="range" id="control_{plugin}_{confId}" min="0" max="{max}" step="1" style="width: 300px;">`，行内结构 `<li><span>desc</span><span class="value">当前值</span><div><input range></div></li>`；`change` 事件写库并同步 `.value` 文本与 `title`；**额外绑定 `wheel` 事件**：滚轮上=+1、下=-1，边界钳制，`preventDefault`。

---

## 3. CSS 注入映射

`MewTool.loadcss(cssText, id?)` 把文本包进 `<style type="text/css">` 追加到 `<head>`；资源经 `fetch(url, {cache:"force-cache"})` 从 jsDelivr 按 **commit hash 钉版本** 拉取。本地 `css/` 目录即全部样式存档。

| 触发设置（插件 id） | CSS 文件 | 钉定版本 |
|---|---|---|
| （无条件，框架自身） | `css/frame.css` | `@c577cfc` |
| `desktop` | `css/desktop.css` | `@ce63961` |
| `desktop_reverse` | `css/desktop_reverse.css` | `@ce63961` |
| `thought_in_middle` | `css/thought_in_middle.css` | `@fbb9442` |
| `whisper_in_middle` | `css/whisper_in_middle.css` | `@4cbcef5` |
| `img_size` | `css/img_size.css` | `@4cbcef5` |
| `compact_thought_hide_img` | `css/compact_thought_hide_img.css` | `@4cbcef5` |
| `compact_thought_hide_text` | `css/compact_thought_hide_text.css` | `@4cbcef5` |
| `compact_thought_more_node` | `css/compact_thought_more_node.css` | `@4cbcef5` |
| `topic_list` | `css/topic_list.css` | `@e1c937b` |
| `thought_widget` | `css/thought_widget.css` | `@c577cfc` |
| `only_this_mewer` | `css/only_this_mewer.css` | `@4cbcef5` |
| `search` | `css/search.css` | `@59659ac` |
| `custom_stamp` | `css/custom_stamp.css` | `@c577cfc` |
| `node_manage` | `css/node_manage.css` | `@c577cfc` |
| `custom_css` | （用户输入文本直接注入） | — |

未被当前 body 引用但在仓库存档中的：`css/text2url.css`（resources 里有 `css_text2url` 条目但无对应插件，遗留）、`css/darkmode.css`（完全未引用，遗留的暗色模式实验）。`node_manage` 另拉取 16 个 HTML 模板（`template/node_manage*.html`，钉 `@7bb2bd0`/`@4cbcef5`/`@2582b68`/`@0f5e462`/`@c882444`），本地 `template/` 目录有存档。

---

## 4. 设置面板自身的 DOM 与布局

### 4.1 入口

齿轮图标 `#icon_setting`（32×32 SVG，填充色 `#345bac`，`padding: 10% 10%`，`cursor:pointer`）被 append 进 **Mew 左侧最外层竖条 `[class^='sidebar_root__']`**（这也证明 Mew 原版最左是一根图标 sidebar）。

### 4.2 "标准页面" stdpage（脚本自有的模态容器，所有自建页面共用）

```html
<div class="custompage_root">                      <!-- position:fixed; inset:0; z-index:10 -->
  <div aria-hidden="true" class="blackback"></div> <!-- fixed; inset:0; rgba(0,0,0,0.5); z-index:10 -->
  <div class="MuiPaper-root MuiPaper-elevation16 stdpage"
       style="animation: appear 0.5s ease 0s 1 normal;">…内容…</div>
</div>
```

- `.stdpage`：`width:50%; left:25%; top:0; height:100%; max-width:90%; position:fixed; z-index:12; overflow-y:auto; display:flex; flex-direction:column; background-color: rgb(var(--colors-white-dark-grayest)); box-shadow: rgb(0 0 0/20%) 0 8px 10px -5px, rgb(0 0 0/14%) 0 16px 24px 2px, rgb(0 0 0/12%) 0 6px 30px 5px;`
- 入场动画 `@keyframes appear { from{left:100%} to{left:25%} }`（0.5s，从右侧滑入居中）；点 `.blackback` 反向播放后自毁（`.disapper` 标记 + `animationend`）。
- **关键考古证据**：类名蹭了 `MuiPaper-root MuiPaper-elevation16` 且背景/文字全部使用宿主 CSS 变量——Mew 原版前端是 **Material-UI(MUI) + Tailwind**，暴露的原版设计令牌有：`--colors-white-dark-grayest`、`--colors-background-hover`、`--colors-secondary-darkest`、`--colors-primary`、`--colors-gray-100-dark-gray`、`--colors-gray-200`、`--tw-text-opacity`，颜色用法一律 `rgb(var(--token) / var(--tw-text-opacity))`（Tailwind RGB 通道式变量）。

### 4.3 设置页内容结构

`stdpage(`<div class="title">…</div><ul></ul>`)`；`.title`：`font-size:20px; margin:20px auto; padding:0 7%`。`ul`：`margin:20px 10%; padding:20px 0; border:2px solid rgb(var(--colors-primary)); border-radius:20px`；每个插件渲染完追加 `<hr>` 分隔。行 `li`：`display:flex; justify-content:space-between; align-items:center; margin:5px 20px`。

四种行模板：
- 插件开关行：`<li><span>{short_desc}：{long_desc}</span><div><input type="checkbox" id="control_{id}" class="switcher"><label for="control_{id}" class="switcher-label"></label></div></li>`
- text 行：`<li style="flex-wrap:wrap;"><span>{desc}</span><textarea class="mytextarea">…</textarea></li>`，`.mytextarea`：`width:100%; min-height:100px; white-space:nowrap; border:2px solid rgb(52,91,172); background: rgb(var(--colors-background-hover))`
- button 行：`<button class="myButton">`（拟物按钮：`linear-gradient(to bottom,#f9f9f9 5%,#e9e9e9 100%)`，`border:1px solid #9e9c9e`，`border-radius:6px`，`padding:6px 24px`，`font:bold 15px Arial`，`text-shadow:0 1px 0 #fff`，`:active{top:1px}`）
- number 行：见 §2.3。

iOS 风格开关 `.switcher`：原生 checkbox 隐藏，label 轨道 **40×20px、圆角 20px、底色 `#dddddd`**，滑块 `:after` 20px 圆、`box-shadow:0 2px 5px rgba(0,0,0,.3)`，选中轨道色 **`rgb(114 148 218)`**、滑块 `margin-left:20px`，过渡 0.4s。

### 4.4 自绘右键菜单 `#mew_menu`

`<ul id="mew_menu">`：`position:fixed; z-index:9999; width:200px`；项 `li`：`padding:5px 10px; background: rgb(var(--colors-gray-100-dark-gray)); transition:.2s ease`，hover 变 `--colors-gray-200`；首/末项圆角 `10px 10px 0 0` / `0 0 10px 10px`，项间 `<hr>`；定位取 `e.clientX/clientY` 并对底边溢出钳制；点击外部销毁。

---

## 5. Mew 页面路由与端点考古

### 5.1 前端路由（@match + 代码内构造）

| URL 模式 | 语义 |
|---|---|
| `https://*.mew.fun/n/*` | **据点页**：`/n/{node_name}`；代码用 `window.location.pathname.slice(3)` 取据点名，即路径严格为 `/n/` + 名称 |
| `https://*.mew.fun/n/{node_name}?topicId={topic_id}` | 据点内直达某话题（讨论频道）的深链 |
| `https://*.mew.fun/home*` | 个人主页/时间线 |
| `https://*.mew.fun/sector-explore*` | 据点发现/探索页 |
| `https://mew.fun/{username}/thoughts/{thought_id}` | 想法详情页（username 段不校验——搜索模块统一用 `https://mew.fun/betterMew/thoughts/{id}` 也能打开，说明路由只认 thought_id） |
| `/_next/static/images/default-avatar-1-d21d3e0c70ccc333b797212fed6be0c9.png` | 默认头像（Next.js 静态资源，证实官方栈为 Next.js） |

### 5.2 域名分工

- `mew.fun` — Next.js 前端；favicon `https://mew.fun/favicon.png`
- `api.mew.fun/api/v1/...` — REST API（`Authorization: <mew-token>` 裸 token，无 Bearer 前缀）
- `gateway.mew.fun` — socket.io 网关（见 §1.3）
- `image.mew.fun/{32位hex hash}` — 图床原图；缩略模板后缀 `~tplv-c226mjqywu-size:96.image`（火山引擎 veImageX 模板，服务 id `c226mjqywu`；`size:999999.png` 可取最大 PNG）
- `cdn.mew.fun/spacelize/preset/icons/{name}.png` — 据点"基建"话题图标预设（75 个图标名硬编码于 node_manage；颜色 16 色日本传统色系：琉璃 `#2151a2`、山吹 `#f2ab31`、照柿 `#af5d3e`、露草 `#4b9dd7`、铅丹 `#c0544d`、青磁 `#6da4a2`、桔梗 `#5b468e`、若竹 `#649f78`、胡桃 `#857063`、红碧 `#7485c9`、木贼 `#356143`、琥珀 `#b7732f`、伽罗 `#684c29`、莓 `#9f4851`、洗朱 `#eb9167`、桃 `#e591a0`；图标尺寸类 `icon_size_S/M/L`）

### 5.3 REST 端点清单（脚本实际调用）

`GET /nodes/{node_name}`、`PATCH /nodes/{id}`、`GET /nodes/{id}/search-thoughts?keyword=&limit=100&pagination=`、`POST /nodes/{id}/topics`、`POST /nodes/{id}/topics/space-position`、`PATCH /nodes/{id}/topics/position`、`PATCH /nodes/{id}/questions/{qid}`、`GET /nodes/{id}/members?limit=50[&type=restricted]`、`GET /nodes/{id}/members/search?keyword=`、`PATCH|DELETE /nodes/{id}/members/{uid}`（body `{isModerator, permissionsDeny}`，deny 位：16=讨论发言、32=发想法、64=评论；body `{superModerator: uid}` 转让领主）、`GET /nodes/{id}/bans?limit=50`、`PUT|DELETE /nodes/{id}/bans/{uid}`、`GET /nodes/{id}/applications?type=join|speak&state=pending|approved|rejected&limit=50`、`PATCH /nodes/{id}/applications/{type}/{uid}`（`{state}`）、`GET|POST|PATCH|DELETE /nodes/{id}/libraries[/{id}]`（书架/词条，`parentId` 两级树）、`PATCH /topics/{id}`、`DELETE /topics/{id}`、`PATCH /topics/{id}/moderation`、`POST /topics/{id}/messages`（文本 `{nonce, content}`、表情 `{nonce, media:[id]}`、分享想法 `{type:2, thought:id}`；nonce 为 18 位随机数字串）、`PATCH|DELETE /messages/{id}`、`GET /users/{id}`、`PATCH /users/@me`、`GET /users/@me/mynodes`、`POST /medias/image/{hash}`（hash 换媒体 id）。列表响应统一形如 `{entries:[], objects:{users:{}, media:{}, topics:{}}, pagination/next_cursor}`（引用规范化，实体按 id 挂在 objects 下）。

### 5.4 Mew 原版 GUI 选择器词表（脚本锚点，即原版 CSS Modules 类名前缀）

`sidebar_root__`（最左图标栏容器）、`sidebar_logo__`（logo，其后可插图标）、`sidebar_selected__`（话题列表选中态）、`panel_list__`（话题/频道列表面板，子项带 `data-id`=topicId）、`message-container_widget__`（聊天容器，React props 内含 `topicId`）、`message-text_sent__` / `message-text_bubble__`（自己发出的消息气泡）、`message-text_name__` / `message-image_name__`（消息作者名）、`text-area-bar_form-root__`（消息输入框）、`#comments`（想法详情评论区，页面可同时存在多个，取最后一个为当前层）、`comments_right-btn__`（评论区右上按钮，原生文案"只看作者"）、`thought_name__`（想法作者名）、`reaction-panel_stamp-list__` / `reaction-panel_stamp__8qpSD` / `reaction-panel_image__2FjNq`（表情面板及单枚表情按钮——带完整 hash 的两个类名被脚本原样复用）、`.pswp__zoom-wrap`（图片查看器为 PhotoSwipe）。命名模式 `{组件文件名}_{元素}__{hash}` 为 Next.js CSS Modules；配合 §4.2 的 MUI/Tailwind 令牌，可确认原版技术栈为 **Next.js + React + CSS Modules + Tailwind 变量 + 部分 MUI + PhotoSwipe + socket.io**。脚本读 React 内部数据的手法：遍历 DOM 元素属性匹配 `/__reactProps\$/`（`MewTool.getreact`）。


---

# Mew GUI 考古报告(基于 bettermew 用户脚本 CSS 反推)

来源文件:`/Users/user/development/MyUserScript/userjs/mew/css/`(frame、desktop、desktop_reverse、darkmode、search、node_manage、thought_widget、thought_in_middle、topic_list、custom_stamp、img_size、whisper_in_middle、only_this_mewer、text2url、compact_thought_more_node、compact_thought_hide_text、compact_thought_hide_img,共 17 个)与 `/Users/user/development/MyUserScript/userjs/mew/res/`(darkmode.css、search.css、node_manage.css)。

## 0. 技术栈指纹(从选择器形态反推)

- Mew 前端使用 **CSS Modules**,类名格式为 `文件名_元素名__hash`,脚本一律用 `[class^='xxx__']` 前缀匹配 —— 说明是 React(极可能 Next.js)工程,每个组件文件对应一组类。
- 同时混用 **Tailwind 工具类**(`.w-full`、`.h-14`、`.text-sm.truncate`、`.bg-background-regular`、`.h-\[12rem\]` 等 JIT 任意值类)。
- 弹层/抽屉使用 **MUI(Material-UI)**:`.MuiPaper-elevation16`、`.MuiPaper-elevation`、`.MuiIconButton-sizeSmall`、`.MuiButtonBase-root`、`.Mui-selected`、`.MuiDialogContent-root`。
- 富文本编辑器为 **ProseMirror**(`.ProseMirror`)。
- 面板滑入动画使用 **react-transition-group** 约定类 `.panel-slide-enter-done`(whisper 面板)。
- 主题体系:颜色全部走 CSS 变量,值为**裸 RGB 三元组**(如 `--colors-primary: 114 148 218`),配合 `rgb(var(--x) / var(--tw-text-opacity))` 使用 —— 典型 Tailwind 主题变量方案。暗色由 `body#app` / `:root` 上的变量覆盖生效,且存在 `[data-theme=dark]` 属性开关(node_manage.css 同时监听 `@media (prefers-color-scheme: dark)` 与 `[data-theme=dark]`)。
- 嵌入内容用 data 属性分型:`div[data-embed-type]`、`div[data-embed-type=link]>div`。

## 1. Mew 原生类名清单(按 UI 区域)

以下均为脚本**覆盖目标**、即 Mew 原生 DOM 中真实存在的类名(CSS Modules 前缀形式),脚本自造类见文末附录。

### 1.1 全局三栏骨架(layouts / containers)

| 类名前缀 | 推断用途 | 出处 |
|---|---|---|
| `layouts_root__` | 桌面端整页 flex 根容器(横向三栏) | desktop_reverse.css |
| `layouts_left-container__` | 左栏(据点/导航列表),有 `flex-basis` | desktop.css |
| `layouts_right-container__` | 右栏(想法流/信息栏),有 `flex-basis` | desktop.css |
| `containers_middle-root__` | 中栏根容器(讨论/聊天主区) | darkmode.css |
| `containers_chat-header__` | 中栏聊天区顶栏 | darkmode.css |
| `containers_selector__` | 顶部/侧边选择器面板 | darkmode.css |
| `div.w-full.flex.justify-center.absolute.top-0.z-10.bg-background-regular.h-14.items-center` | 顶部固定栏,**高 h-14 = 56px**,absolute top-0 z-10 | darkmode.css |

### 1.2 想法(thought,feed 卡片与详情)

| 类名前缀 | 推断用途 |
|---|---|
| `thought_root__` | 想法卡片根(右栏 feed 内) |
| `thought_content__` | 想法文本内容容器(内为 `>p`) |
| `thought_quote-bar__` | 想法引用条(转发/引用样式) |
| `thought_img-wrapper__` | 卡片内图片包装 |
| `thought_player-wrapper__` | 卡片内视频播放器包装 |
| `post-preview_cover__` | 帖子预览封面图 |
| `thought-view_post-content__` | 想法详情页正文容器(内含 `>div p`、h1–h3) |
| `thought-view_img-wrapper__` | 详情页图片包装 |
| `div.w-full.bg-center.bg-cover`(位于 `thought-view_post-content__` 内) | 详情页背景图式图片块 |
| `.h-\[12rem\]` | feed 封面图固定高 **12rem = 192px**(脚本 `height: unset` 解除) |
| `card_frame-wrapper__` | 嵌入 iframe 卡片包装 |
| `card_bili-root__` | B 站视频嵌入卡片 |
| `div[data-embed-type]` / `div[data-embed-type=link]>div` | 链接等嵌入卡片(按类型分型) |

### 1.3 讨论/评论(comments)

| 类名前缀 | 推断用途 |
|---|---|
| `comments_modal-out__` | 评论弹层外框 |
| `comments_title-bar__` | 评论区标题栏 |
| `comment-item_root__` | 单条评论根(脚本给它加 `content-visibility: auto` 做长列表优化) |
| `comment-item_name__` | 评论者昵称 |
| `comment-item_action-btn__` | 评论操作按钮(回复/赞) |
| `comment-item_deleted__` | 已删除评论占位(only_this_mewer.css 直接 `display:none`) |

### 1.4 聊天/私语(message)

| 类名前缀 | 推断用途 |
|---|---|
| `message-container_list__` | 消息列表容器(及其 `>div` 子行) |
| `message-container_reply-bar__` | 回复引用栏 |
| `message-container_reaction-panel__` | 表态(reaction)浮出面板 |
| `message-stamp_bubble__` | stamp(表情贴纸)消息气泡 |
| `button_reaction-btn__` | reaction 按钮 |
| `plain-input_compose-textarea-wrapper__` | 消息输入框外包装 |
| `.panel-slide-enter-done` | whisper 私语面板滑入完成态(react-transition-group) |

### 1.5 话题(topic)

| 类名前缀 | 推断用途 |
|---|---|
| `topic-selector_root__` | 话题选择器根(横向 tag 条,默认单行) |
| `topic-selector_wrapper__` | 话题选择器外包装 |

### 1.6 据点(node)与内容组织

| 类名前缀 | 推断用途 |
|---|---|
| `sector-view_sector-header-bar__` | 分区(sector,据点内板块)头部栏 |
| `pin-list_root__` | 置顶内容列表 |
| `item-in-list_header__` | 列表项头部 |
| `wiki-item_header__` | 据点 wiki 条目头部(Mew 有 wiki 功能) |
| `node-migration-dialog_node-migration-root__` | 「想法迁移到其他据点」对话框 |

### 1.7 用户/身份卡/关系

| 类名前缀 | 推断用途 |
|---|---|
| `card_root__` / `card_name__` / `card_content__` / `card_action-btn__` | 用户身份卡(hover 弹出名片):根/昵称/简介/操作按钮 |
| `card_identity-card-root-desktop__` | 桌面版身份卡根 |
| `v2_root__` | 某组件 v2 版根(与身份卡同色处理,疑为新版名片) |
| `relationships_info__` / `relationships_header__` / `relationships_user-item__` / `relationships_name__` / `relationships_name-center__` | 关注/粉丝关系列表页 |
| `user-description-dialog_dialog-root` | 用户简介对话框 |
| `user-setting-dialog_header__` | 用户设置对话框头部 |
| `compact-tabbar_tabbar-root__` / `compact-tabbar_tabbar-item__` | 紧凑型 tab 栏(个人页切换) |

### 1.8 基础组件与杂项

| 类名前缀 | 推断用途 |
|---|---|
| `base_root__` / `base_no-outline__` / `base_card__` | 基础按钮/无边框按钮/基础卡片(通用组件库) |
| `text-field_root__` / `text-field_input__` | 文本输入组件 |
| `search-bar_input__` | 全局搜索栏输入框 |
| `drawer_dialog__` | 抽屉式对话框 |
| `right_white-btn__` | 右栏白色按钮(如「发想法」) |
| `.ProseMirror` | 富文本编辑区 |
| `.text-black`、`.text-sm.truncate`、`.text-md.truncate`、`.text-xl/.text-2xl/.text-3xl`、`.font-medium`、`.my-4` | 直接以 Tailwind 工具类承载语义的文字节点(暗色模式需逐个补色,是反模式教训) |
| `body#app` | 应用 body 的 id 为 `app`(res/darkmode.css 以 `body#app` 提权) |

## 2. 三栏布局度量(desktop / desktop_reverse / frame)

Mew 桌面端为 **左栏 + 中栏 + 右栏** 的 flex 行布局:

- 根:`[class^='layouts_root__']`,`display:flex; flex-direction:row`(原生默认;desktop_reverse.css 改为 `row-reverse` 即为「左右互换」模式)。
- 左右栏均以 **flex-basis 定宽**,中栏 `containers_middle-root__` 吃剩余空间。脚本用变量强改:
  ```css
  [class^='layouts_right-container__'] { flex-basis: var(--right-width) !important }
  [class^='layouts_left-container__']  { flex-basis: var(--left-width) !important }
  ```
  说明原生左右栏是**固定 flex-basis**(具体像素值由脚本配置注入,原值不可从 CSS 得知,需截图佐证);可调宽是脚本加的能力。
- desktop_reverse.css 翻转后需补 `[class^='layouts_right-container__'] { margin-right: 1rem; }` —— 反推**原生右栏与中栏间距约 1rem(16px),由右栏的单侧 margin 提供**,翻转后该 margin 位于错误一侧才需补偿。
- 顶栏:absolute、`top-0`、`z-10`、高 **56px(h-14)**、内容水平居中、背景 `bg-background-regular`。
- 浮层面板体系(frame.css / thought_in_middle.css / whisper_in_middle.css):
  - 想法详情原生是 **MUI Drawer(`.MuiPaper-elevation16`)从右侧滑出**;脚本将其居中化:`width: 50% !important; left: 25%`。
  - whisper 面板同理:`.panel-slide-enter-done { width: 50%; left: 25%; z-index: 10 !important; }`。
  - 脚本自造页面 `.stdpage`:`width:50%; left:25%; max-width:90%; height:100%; position:fixed; top:0; z-index:12`,入场动画 `@keyframes appear { from { left:100% } to { left:25% } }`(从右滑入),遮罩 `.blackback` 为 `rgba(0,0,0,0.5)`、`z-index:10`。阴影三层:`rgb(0 0 0 / 20%) 0px 8px 10px -5px, rgb(0 0 0 / 14%) 0px 16px 24px 2px, rgb(0 0 0 / 12%) 0px 6px 30px 5px`(MUI elevation 风格)。
  - 评论弹层 `comments_modal-out__` 被限 `max-width: 40%`;关系页 `relationships_info__` 限 `max-width: 60%`;`base_card__` 强制 `width: 80% !important`;`relationships_header__`、`compact-tabbar_tabbar-root__`、`relationships_user-item__` 拉满 `width: 100%` —— 反推原生这些组件按移动端窄宽设计,桌面下不撑满。
- 图片度量:`thought-view_img-wrapper__` 与详情页 `div.w-full.bg-center.bg-cover` 宽由脚本变量 `--img-width`、左缩进 `--img-left` 控制(原生为 `w-full` 全宽);feed 封面高固定 `12rem`。

## 3. darkmode 完整配色表(= 反推出的 Mew 主题变量体系)

css/darkmode.css 与 res/darkmode.css 内容一致(前者多了脚本自造的 card-l1/l2/input/btn 四个变量,挂 `body` 与 `:root`;后者挂 `body#app`)。变量名全部是 **Mew 原生主题 token**(暗色值为脚本作者所配,但变量名 = Mew 亮色主题的语义槽位):

| CSS 变量 | 暗色值 (RGB) | HEX | 在暗色 CSS 中实际粉刷的对象 |
|---|---|---|---|
| `--colors-background-regular` | 33 33 33 | #212121 | 全局常规背景:56px 顶栏、`.MuiPaper-elevation16` / `.MuiPaper-elevation`、`containers_selector__`、`topic-selector_wrapper__` |
| `--colors-background-lighter` | 43 43 43 | #2B2B2B | 一级抬升面:`message-container_list__`(及 `>div`)、`containers_middle-root__`、`card_bili-root__`、`message-stamp_bubble__`、`div[data-embed-type]`、`div[data-embed-type=link]>div`;`textarea`、`pin-list_root__`、`node-migration-dialog_node-migration-root__`、`comments_title-bar__`(`!important`) |
| `--colors-background-morelighter` | 55 55 55 | #373737 | 二级抬升面:`message-container_reaction-panel__`、`drawer_dialog__`、`plain-input_compose-textarea-wrapper__` |
| `--colors-background-gray` | 60 60 60 | #3C3C3C | 灰底槽位(本文件仅定义未直接引用) |
| `--colors-background-darker` | 25 25 25 | #191919 | 下沉面:`containers_chat-header__`、`message-container_reply-bar__`、`user-description-dialog_dialog-root`(`!important`) |
| `--colors-background-light` | 45 45 45 | #2D2D2D | 亮抬升槽位(定义未直接引用) |
| `--colors-background-hover` | 43 43 43 | #2B2B2B | hover 背景槽位(frame.css 中 `.mytextarea` 引用) |
| `--colors-background-heading` | 45 45 45 | #2D2D2D | 标题区背景槽位 |
| `--colors-background-dialog` | 55 55 55 | #373737 | 对话框背景槽位 |
| `--colors-background-msg` | 100 100 100 | #646464 | 消息底色槽位 |
| `--colors-background-receive-msg` | 80 80 80 | #505050 | 接收消息气泡底;并被复用为控件底:`card_root__`、`v2_root__`、`button_reaction-btn__`、`search-bar_input__`、`base_no-outline__`(含 `:active`)、`card_action-btn__`、`text-field_root__` / `text-field_input__`;res/search.css 的 `.searchitem` / `.search_input` |
| `--colors-background-sent-msg` | 120 120 120 | #787878 | 发送消息气泡底 |
| `--colors-background-comment` | 60 60 60 | #3C3C3C | 评论区底色槽位 |
| `--colors-background-reply` | 80 80 80 | #505050 | 回复块底色槽位 |
| `--colors-background-selected-comment` | 100 100 100 | #646464 | 选中评论高亮底 |
| `--colors-emphasis` | 230 230 230 | #E6E6E6 | 强调文字:`thought-view_post-content__ >div p`、`h1/h2/h3`(`!important`) |
| `--colors-msg` | 235 235 235 | #EBEBEB | 次级文字:`comment-item_name__`、`comment-item_action-btn__`、`.text-sm.truncate`、`thought_quote-bar__`、`card_name__`、`.text-black` |
| `--colors-receive-msg` | 255 255 255 | #FFFFFF | 主文字(白):`card_content__`、`item-in-list_header__`、`.font-medium`、`.text-md.truncate`、`.text-xl/.text-2xl/.text-3xl`、`.my-4`、`wiki-item_header__`、`div.MuiDialogContent-root>p`、`user-setting-dialog_header__`、`right_white-btn__`、`.ProseMirror`、`compact-tabbar_tabbar-item__`、`relationships_name__` / `relationships_name-center__`(`!important`) |
| `--colors-caption` | 235 235 235 | #EBEBEB | 说明文字槽位 |
| `--colors-body` | 200 200 200 | #C8C8C8 | 正文文字槽位 |
| `--colors-disabled` | 200 200 200 | #C8C8C8 | 禁用态槽位 |
| `--colors-primary` | 114 148 218 | #7294DA | **品牌主色(Mew 蓝)**:开关选中态、`.thought-widget` 浮钮底、`.stdpage ul` 边框 |
| `--colors-primary-darker` | 154 178 228 | #9AB2E4 | 主色深/次级变体 |
| `--colors-gray-50` | 60 60 60 | #3C3C3C | 灰阶(暗色下反转:数字越小越暗) |
| `--colors-gray-100` | 110 110 110 | #6E6E6E | 灰阶;`sector-view_sector-header-bar__` 本想用它(见下方 bug) |
| `--colors-gray-200` | 140 140 140 | #8C8C8C | hover 底:`.MuiIconButton-sizeSmall:hover`、`base_root__`、`#mew_menu>li:hover` |
| `--colors-gray-400` | 240 240 240 | #F0F0F0 | 灰阶(暗色下为浅色文字级) |
| `--colors-gray-500` | 250 250 250 | #FAFAFA | 灰阶 |
| `--colors-gray-700` | 245 245 245 | #F5F5F5 | 灰阶 |
| `--colors-gray-900` | 255 255 255 | #FFFFFF | 灰阶最深(暗色下纯白) |
| 字面量 `white` | — | #FFFFFF | `.MuiIconButton-sizeSmall`、`.MuiButtonBase-root` 图标色 |
| 字面量 `wheat` | — | #F5DEB3 | `.Mui-selected !important`(选中 tab 高亮)——脚本作者选色,非 Mew 原生 |

已知 bug(考古时注意):`[class^='sector-view_sector-header-bar__'] { background-color: rgb(var(--colors-gary-100)) !important; }` 中 `gary` 为 `gray` 拼写错误,变量未定义,该规则实际失效。

**亮色侧线索**(darkmode 未覆盖、但被 frame/search/custom_stamp 引用的原生亮色变量,证明 Mew 亮色主题存在这些 token):`--colors-white-dark-grayest`(浅色页面底)、`--colors-secondary-darkest`(亮色主文字,配 `--tw-text-opacity`)、`--colors-gray-100-dark-gray`、`--colors-gray-150-dark-gray`(亮/暗自适应灰底)、`--colors-gray-300`(stamp 卡底,配 `--tw-bg-opacity`)。另有硬编码亮色:搜索框边 `#345bac`、文本域边 `rgb(52, 91, 172)`(同色,**Mew 亮色主题的深蓝 #345BAC**,与暗色主蓝 #7294DA 构成同一色相的明暗对);text2url 链接粉 `rgb(255 70 175)`(#FF46AF,脚本选色)。

## 4. 组件样式细节(值得后继平台复用)

### 4.1 想法卡片(thought card)与紧凑模式
- 原生卡片结构:`thought_root__` > (`thought_content__>p` 文本 | `post-preview_cover__` 封面 | `thought_img-wrapper__` 图 | `thought_player-wrapper__` 视频 | `card_frame-wrapper__` 嵌入 | `thought_quote-bar__` 引用条),封面图定高 12rem。
- 紧凑化三件套:`compact_thought_hide_text.css` 把 `thought_content__>p` 变单行省略(`text-overflow: ellipsis; white-space: nowrap; display: block !important`);`compact_thought_hide_img.css` 隐藏全部媒体 wrapper;`compact_thought_more_node.css` 用 `.h-\[12rem\] { height: unset }` 解除封面定高。三档密度是可复用的 feed 设计。
- 长列表优化:`comment-item_root__ { content-visibility: auto }`。

### 4.2 浮动想法按钮(thought-widget)
```css
.thought-widget { z-index:10; position:absolute; width:40px; bottom:20%; right:5%;
  display:flex; flex-direction:column; background-color:rgb(var(--colors-primary) / var(--tw-bg-opacity));
  cursor:pointer; border-radius:20px; }
```
40px 宽、主色胶囊形、右下角纵排图标 —— 快捷发想法/回顶入口(配套 `res/totop.svg`)。

### 4.3 话题列表(topic-selector)
原生话题条固定单行;脚本改为 hover 展开的折叠 tag 云:
```css
[class^='topic-selector_root__'] { max-height:55px; height:55px; flex-wrap:wrap; }
[class^='topic-selector_root__']:hover { transition:max-height 1s linear; max-height:500px; height:auto; }
[class^='topic-selector_root__'] button { margin:5px 0px; }
```
反推原生话题条高 **55px**、内为 button 列表。「收起 55px / 悬停展开 500px」是话题栏的好模式。

### 4.4 搜索浮层(search overlay)
- 面板:`.stdpage`(50% 宽、居中、右侧滑入 appear 动画、`.blackback` 半透明遮罩)。
- 表单:`.stdpage div.form` 为 `grid; width:300px; grid-template-columns: 7fr 1fr`(输入框 + 按钮);`.search_input` 高 40px、圆角 5px、边框 `2px solid #345bac`;`.search_btn` 40×40 背景图按钮。
- 结果卡 `.searchitem`:宽 90% 居中、圆角 **20px**、双层阴影 `0 4px 8px 0 rgb(0 0 0 / 20%), 0 6px 20px 0 rgb(0 0 0 / 19%)`;作者行 `.poster`:头像 **36×36、圆角 5px**,`.nickname` 加粗,`.date` 字号 **10px**;底色 `--colors-gray-150-dark-gray`(res 版用 `--colors-background-receive-msg`)。
- 分享列表 `.sharepage_root>ul>li`:圆角 5px、`padding:5px 10px`、hover 换 `--colors-gray-100`、`transition:.2s ease`。

### 4.5 stamp(贴纸)网格
```css
.custom_stamps { max-height:320px; width:105%; overflow:scroll; }
.stamp_manage { display:grid; gap:1rem; grid-template-columns: repeat(auto-fit, 80px); justify-content:center; }
.stamp_card { background-color: rgb(var(--colors-gray-300) / var(--tw-bg-opacity)); border-radius:10px; }
.stamp_card>img { max-height:80px; margin:0 auto; }
```
80px 定宽 auto-fit 网格 + 320px 限高滚动区,即 Mew 讨论区 stamp 选择器的形制;聊天内 stamp 显示为 `message-stamp_bubble__` 气泡。

### 4.6 据点管理(node_manage)——图标合成器与手风琴
- 据点图标 5×5 合成网格:`.ic_root { background:rgb(255 255 255 / 15%); padding:15px; border-radius:15px; display:grid; gap:15px; grid-template-columns/rows: repeat(5, minmax(96px, 1fr)); }`,单元 `min-width/height:96px`、圆形(`border-radius:50%`)、占位色 `wheat`;尺寸档 `.icon_size_S/M/L = scale(0.6/0.75/0.9)`,图像统一 `scale(0.8)`;中心格 `div[pos="0,0"]>div` 白底 `background-size:cover`。候选表 `.root_selector` 为 `repeat(auto-fill, minmax(96px,1fr))`、gap 5px。
- 成员头像 `.member_avatar`:40×40、圆角 5px、`margin:0 5px`。
- 手风琴(纯 CSS checkbox 驱动):`.accordion__toggle`(隐藏 checkbox)`:checked~.accordion__content { visibility:visible; max-height:800px; }`,收起态 `max-height:0`、`transition:all .2s linear`;卡片双层灰 `--colors-card-l1`(亮 230/暗 70)与 `--colors-card-l2`(亮 220/暗 80)交替嵌套,圆角 20px/15px。
- 三 tab 布局:`grid-template-areas: "tab1 tab2 tab3" "content content content"`。

### 4.7 开关与菜单(脚本设置 UI,风格仿 Mew)
- iOS 式开关:轨道 **40×20、圆角 20px、底 #dddddd/#f1f1f1**,滑块 **20px 圆、白色、阴影 `0 2px 5px rgba(0,0,0,0.3)`**,选中轨道 `rgb(114 148 218)`(= 主色)、滑块 `margin-left:20px`,过渡 0.4s。
- 右键菜单 `#mew_menu`:fixed、宽 **200px**、`z-index:9999`,项 `padding:5px 10px`、首尾项圆角 `10px 10px 0 0` / `0 0 10px 10px`、hover `--colors-gray-200`、`transition:.2s ease`。
- 设置页列表 `.stdpage ul`:`border:2px solid rgb(var(--colors-primary)); border-radius:20px; margin:20px 10%`,行内 `display:flex; justify-content:space-between`。

## 5. 端点与外部资源

- `https://fastly.jsdelivr.net/gh/yige233/bettermew@4cbcef5/icon/search.svg` —— css/search.css 的搜索按钮图标(jsDelivr,仓库 `yige233/bettermew`,commit `4cbcef5`)。
- `https://pc.doveyige.top/mew/res/search.svg` —— res/search.css 的同图标自托管版;res 目录另有 `node_manage.svg`、`totop.svg`、`node_manage.html` 本地资源。

## 附:脚本自造类/变量(勿误认为 Mew 原生)

- 类:`.custompage_root`、`.blackback`、`.stdpage`、`.switcher`、`.mytextarea`、`.title`、`.child_config`、`.myButton`、`#mew_menu`、`#icon_setting`、`#icon_search`、`#icon_node_manage`、`.search_input`、`.search_btn`、`#searchres`、`.searchitem`、`.poster`、`.nickname`、`.date`、`.shareto`、`.sharepage_root`、`.thought-widget`、`.custom_stamps`、`.stamp_manage`、`.stamp_card`、`.member_avatar`、`.container`、`.accordion*`、`.tab1/.tab2/.tab3`、`.tab_container`、`.content`、`.sortbtn`、`.input_container`、`.container__input`、`.container__addon`、`.ic_root`、`.root_selector`、`.icon_size_S/M/L`、`.node_edit`、`.node_edit_selecor`、`.url-turned`。
- 变量:`--right-width`、`--left-width`、`--img-width`、`--img-left`、`--colors-card-l1`、`--colors-card-l2`、`--colors-input`(60 60 60 暗 / 200 200 200 亮)、`--colors-btn`(120 120 120 暗 / 190 190 190 亮)。
- 其余 `--colors-*` 与 `--tw-*` 变量、全部 `[class^='xxx__']` 目标、MUI/Tailwind/ProseMirror 类均为 Mew 原生。


---

# Mew「据点管理」面板 GUI 考古报告

来源：bettermew 用户脚本（`/Users/user/development/MyUserScript/userjs/mew/`）

- 模板：`template/node_manage*.html`（16 个片段，按 `mew.body.js` 中 `this.templates[0..15]` 顺序装配）
- 样式：`css/node_manage.css`（正式版）、`res/node_manage.css` + `res/node_manage.html`（早期线框原型，`border: 1px dashed` 占位风格）
- 逻辑佐证：`mew.body.js` 中 `MewPlugin("node_manage")`（行 564–1402），API base `https://api.mew.fun/api/v1`，鉴权头 `Authorization: localStorage["mew-token"]`
- 入口：右上角图标按钮 `#icon_node_manage`（`res/node_manage.svg`），插件配置项 `btn` 描述为「打开据点管理页」，点击调用 `page_render()`

> 重要背景：该插件自述为「PC端据点管理 / 允许据点管理员在PC端管理据点」，README 写明「领主和管理员可以在网页端上管理据点」——即 **Mew 官方 web 端完全没有据点管理 UI**，整套面板是脚本用官方 API 重建的。因此本报告同时是 Mew 管理域 API 的数据模型快照。

---

## 一、信息架构（功能树）

顶层结构（`template/node_manage.html`）：`div.container` > `div.title`（文案「据点管理」）+ `div.accordion`，手风琴内 7 个 `div.accordion__item`，每项由隐藏 checkbox `input.accordion__toggle`（各有语义化 id）驱动展开。

```
据点管理 (.container > .title > span "据点管理")
├── #node_basic  据点基本信息：名称·据点代号·简介·管理员
│     字段：据点图标预览 img / 据点名称 / 领主(disabled) / 据点代号 / 据点图标(URL) / 保存
├── #node_topic  据点搭建：节点·基建·修改·排序          ← tab 容器
│     ├── .tab1 基建装修   （5x5 空间部署网格 + 管理专用节点改名）
│     └── .tab2 节点排序   （上移/下移/删除节点 + 保存）
│         （右键/点击菜单内含隐藏第三功能：新建节点/编辑节点 → topic_tab3 模态页）
├── #node_speech 门槛与发言：加入门槛·发言限制·搜索·曝光
│     字段：可被公开搜索(switch) / 据点标签(textarea, 一行一个最多10个) /
│           发言门槛开关+问题 / 私密据点开关+加入问题 / 保存
├── #node_join   加入申请列表：黑名单·删除·举报·管理
│     ├── .tab1 申请者   → applications?type=join&state=pending
│     ├── .tab2 已通过   → applications?type=join&state=approved
│     └── .tab3 已拒绝   → applications?type=join&state=rejected
├── #node_speak  发言申请列表：黑名单·删除·举报·管理
│     ├── .tab1 申请者   → applications?type=speak&state=pending
│     ├── .tab2 正式成员 → applications?type=speak&state=approved
│     └── .tab3 已拒绝   → applications?type=speak&state=rejected
├── #node_member 成员管理：黑名单·删除·举报·管理
│     ├── .tab1 全部成员   → /members?limit=50            （+搜索卡片）
│     ├── .tab2 受限成员   → /members?limit=50&type=restricted （+搜索 type=restricted）
│     └── .tab3 据点黑名单 → /bans?limit=50               （+搜索 type=blocked）
└── #node_library 图书馆管理：书架和词条创建·删除
      书架（shelf）列表 → 每个书架内嵌词条（entry）列表 + 「添加词条」卡 → 底部「添加书架」卡
```

早期原型（`res/node_manage.html`）与正式版的差异，反映概念演进：

| 早期原型 | 正式版 | 考古意义 |
|---|---|---|
| `#node_topic` 标题「话题管理：话题创建·删除·排序」，三 tab：话题一览/排序话题/添加话题 | 「据点搭建：节点·基建·修改·排序」，两 tab：基建装修/节点排序 | Mew 后期把「话题(topic)」升级为空间化「节点」+「基建」隐喻（spacelize） |
| 有「据点介绍」`textarea maxlength="140"`，placeholder「应少于140个字符。删除原有介绍会导致保存失败。」 | 该字段被移除 | 据点简介上限 140 字；API 不允许清空简介 |
| 据点图标 placeholder「填入Mew图片的id。」 | 「填入Mew图片链接。」（脚本用 `MewTool.imgurl2id` 转 id） | 图片以 media id 存储 |
| 发言申请 accordion id 为 `node_require_speech` | 改为 `node_speak` | — |
| 无图书馆管理 | 新增 `#node_library` | 图书馆是后加功能 |

---

## 二、各卡片字段清单（= 数据模型与审核流线索）

所有卡片复用同一骨架：`div.accordion__item` > `input.accordion__toggle`(id 携带业务键) + `div.accordion__header`（`label` 开关圆钮 + 可选 `img.member_avatar` + `span.accordion__title`）+ `div.accordion__content`（若干 `div.input_container` > `span.container__addon` 标签 + `input/textarea/button.container__input`）。模板变量为 `{{$var}}` 形式。

### 1. 成员卡 `node_manage_member_normal_card.html`（templates[6]）

- toggle id：`member_{{$username}}`
- 头部：`img.member_avatar src={{$avatar}}`；标题 `{{$class}}：{{$name}}`，其中 `$class` 由 `user.is_super_moderator ? "领主" : user.is_moderator ? "管理员" : "成员"` 得出 → **三级角色模型：领主/管理员/成员**
- 三个权限开关（`input.switcher.container__input`）：
  - `#p_thought_{{$username}}` 发布想法（`{{$P_thought}}` = checked/空）
  - `#p_talk_{{$username}}` 参与讨论
  - `#p_comment_{{$username}}` 发表评论
  - **权限位掩码**（`user.permissions_deny`，deny 语义）：`16 = 参与讨论(talk)`、`32 = 发布想法(thought)`、`64 = 发表评论(comment)`，可叠加（保存时 `permissionsDeny = P_comment + P_talk + P_thought`）
- `#p_moderator_{{$username}}` 设为管理员（保存为 `isModerator: bool`）
- 三个危险按钮：「转让领主身份给 @{{$username}}」（PATCH node `{superModerator: user_id}`，`confirm()` 提示"你将不再拥有该据点和该据点的管理权限"）、「将 @{{$username}} 加入黑名单」（`PUT /nodes/{nid}/bans/{uid}`，提示"将被移出据点，且无法重新加入"）、「将 @{{$username}} 移出据点」（`DELETE /nodes/{nid}/members/{uid}`，提示"可重新加入"）→ **踢出与拉黑是两种明确区分的操作**
- 保存按钮：`PATCH /nodes/{node_id}/members/{user_id}` body `{isModerator, permissionsDeny}`
- 数据来源字段：`user.user_id / node_id / is_moderator / is_super_moderator / permissions_deny`；用户信息经 sideload 对象表取出：`json.objects.users[user.user_id].{username,name,avatar}`，头像 `json.objects.media[avatar_id].url + "~tplv-c226mjqywu-size:96.image"`（火山引擎 imageX 缩略后缀），默认头像 `/_next/static/images/default-avatar-1-d21d3e0c70ccc333b797212fed6be0c9.png`（Next.js 静态资源）

### 2. 黑名单卡 `node_manage_member_ban_card.html`（templates[7]）

- toggle id：`ban_{{$username}}`；标题仅 `{{$name}}`
- 字段：「Ban于：」`{{$date}}`（`user.banned_at` 本地化，`hour12:false`）、「处理者：」`@{{$op_username}}`（由 `user.operator_id` 另行 `GET /users/{id}` 反查 username → **封禁记录含操作者审计字段**）、「解Ban：」按钮「将 @{{$username}} 移出据点黑名单」（`DELETE /nodes/{nid}/bans/{uid}`）

### 3. 待审核申请卡 `node_manage_req_pending_card.html`（templates[8]，join/speak 复用）

- toggle id：`{{$type}}_req_pending_{{$username}}`（`$type` ∈ `join`/`speak`）
- 标题：「审核中：{{$name}} 于 {{$date}} 的申请」（`user.applied_at`）
- 字段：「Ta的回答：」`{{$awnser}}`（原文拼写如此；取 `user.answers[0].content` → **申请附带答题数组，UI 只展示第一题**）
- 按钮：「通过」/「拒绝」→ `PATCH /nodes/{nid}/applications/{type}/{uid}` body `{state:"approved"}` / `{state:"rejected"}`

### 4. 已通过卡 `node_manage_req_approved_card.html`（templates[9]）

- toggle id：`join_approved_{{$username}}`；标题「已通过：{{$name}} 于 {{$date}} 的申请」；仅展示「Ta的回答：」，无操作按钮（纯审计记录）

### 5. 已拒绝卡 `node_manage_req_rejected_card.html`（templates[10]）

- toggle id：`joinreq_rejected_{{$username}}`；标题「已拒绝：…」
- 按钮：「加入黑名单」（同 `ban_someone`）与「恢复申请」→ `PATCH …/applications/{type}/{uid}` body `{state:"pending"}` → **审核状态机三态可逆：pending ⇄ approved/rejected，rejected 可回退 pending**

### 6. 搜索卡 `node_manage_member_search_card.html`（templates[11]）

- toggle id：`user_search`；标题「搜索用户」；字段：搜索关键字 input + 搜索按钮 → `GET /nodes/{nid}/members/search?keyword=…[&type=restricted|blocked]`

### 7. 纯文本卡 `node_manage_member_text_card.html`（templates[1]）

仅 header + `{{$text}}`，用于空态「啥也没有(っ °Д °;)っ」、错误提示、以及分页「点击加载更多」（cursor 分页：`limit=50`，满 50 条追加 `&after={next_cursor}`；追加页会跳过 `is_super_moderator/is_moderator` 条目防重复置顶）。

### 8. 书架卡 `node_manage_shelf.html`（templates[12]）

- toggle id：`shelf_{{$id}}`；标题 `{{$title}}`
- 字段：书架名称 input（`value={{$title}}`，`max="25"`，placeholder「必填。应少于25个字符。」）；第二个 `input_container.accordion` 是词条挂载槽；「删除书架」（confirm「防手滑二次确认」→ DELETE）；「保存」（PATCH `{name}`）

### 9. 词条卡 `node_manage_shelf_entry.html`（templates[13]）

- toggle id：`shelf_entry_{{$id}}`
- 字段：词条名称（`max="25"`）、词条描述 `textarea maxlength="140"`（`{{$desc_text}}`，默认回退词条名）、词条封面（`{{$desc_image}}`，placeholder「填入Mew图片链接。」）、删除词条 / 保存
- 保存 body：`{name, description, icon(media id), parentId}` → **图书馆为两层树：entry.parent_id 为空是书架，非空是词条**

### 10. 添加书架/词条 `node_manage_shelf_addshelf.html` / `node_manage_shelf_addentry.html`（templates[14]/[15]）

- toggle id：`shelf_addshelf` / `shelf_entry_addentry_{{$parent_id}}`
- 添加词条：名称 `max="50"`、描述 `maxlength="120"`、封面；POST `/nodes/{nid}/libraries` body `{name, description, icon, parentId}`
- 添加书架：名称 `max="50"`；POST body `{name}`
- （考古注：新增用 50/120 上限、编辑用 25/140，脚本自身不一致；且文本框误用 `max` 属性而非 `maxlength`——真实平台上限应以 API 为准）

### 11. 基建装修卡 `node_manage_topic_tab1.html`（templates[2]）

- toggle id：`ic_decoration`（默认 `checked`）
- 标题动态：「基建装修：当前据点基建的规模为{{$map_size_tip}}」；`map_size == 3` 时提示「3x3，请注意装修范围。更改保存后可能需要至少5分钟才会应用。任意时刻节点总数超过5个，基建规模即可扩大至5x5。」否则「5x5，更改保存后会立即应用。」→ **据点空间有 3x3/5x5 两档，随节点数升级**
- 核心：`div.ic_root` 内 25 个格子 `div[pos="x,y"]`，坐标 (-2,-2)…(2,2)；中心 `div[pos="0,0"]` 固定放据点图标（`background-image: url(json.objects.media[json.icon].url)`），不可部署
- 「保存基建状态」→ `POST /nodes/{id}/topics/space-position` body `{View:[{id, position:{x,y,z}, icon}]}`
- 「管理专用节点」改名 input（`{{$moderate_node_name}}`；非管理员填「没有权限查看管理专用节点名称。」且 `{{$is_moderator}}` 渲染为 `disabled`；tooltip `title="只允许修改管理专用节点的名称。"`）→ `PATCH /topics/{moderation_topic_id}/moderation` body `{name}` → **每个据点有一个只对管理层可见的管理专用节点（moderation topic）**

### 12. 节点排序卡 `node_manage_topic_tab2_card.html` + `_btn.html`（templates[3]/[4]）

- 每行：`div.input_container#topic_sort_{{$id}}` > 标签 `{{$title}}` + `div.container__input.sortbtn` 内三按钮「上移」「下移」「删除节点」（删除走 `DELETE /topics/{id}`，confirm「防手滑二次确认：真的要删除节点：{name} 吗？」）
- 保存按钮 → `PATCH /nodes/{id}/topics/position` body `{positions:[{id, position:1..n}]}`（脚本 URL 有笔误多一个 `}`）→ **列表顺序为显式 position 整数**

### 13. 节点编辑模态页 `node_manage_topic_tab3.html`（templates[5]）

独立整页（`div.container > div.title > {{$title}}`，标题为「添加节点」或「编辑节点」）：

- 节点预览：96px 圆形 `#node_preview.icon_size_{{$size}}`，`background-color:{{$colorhex}}`，图标 `https://cdn.mew.fun/spacelize/preset/icons/{{$icon}}.png`
- 节点名称：placeholder「必填。应少于32个字符。」
- 节点图标选择器：`div.container__input.root_selector.node_edit`，脚本注入 **76 个预设图标**（`friends, like-bubble, talk-bubble, parchment, pub, holiday, flower-shop, park, codex, golden-key, crown, … pyramid, sliced-cube, sliced-cylinder`）
- 节点主题色选择器：**16 种日本传统色**（`ruri 琉璃 #2151a2 / yamabuki 山吹 #f2ab31 / terigaki 照柿 #af5d3e / tsuyukusa 露草 #4b9dd7 / entan 铅丹 #c0544d / seiji 青磁 #6da4a2 / kikyo 桔梗 #5b468e / wakatake 若竹 #649f78 / kurumi 胡桃 #857063 / benimidori 红碧 #7485c9 / tokusa 木贼 #356143 / kohaku 琥珀 #b7732f / kyara 伽罗 #684c29 / ichigo 莓 #9f4851 / araisyu 洗朱 #eb9167 / momo 桃 #e591a0`）
- 节点尺寸：`input list="size_list"` + `datalist#size_list`（S/M/L）
- 确定 → 新建 `POST /nodes/{id}/topics` / 编辑 `PATCH /topics/{id}`，body `{name, icon:{name, size, color, customize:false}}`（`customize:false` 暗示官方 API 支持自定义图标位）

### 14. 据点主体数据模型（`load_basic` 读到的 node JSON）

`id`、`name`（据点名称）、`node_name`（据点代号=URL slug，路径 `/n/{node_name}`）、`icon`（media id）、`searchable`、`tags[]`（≤10）、`enable_speak_question` + `speak_questions[{id,content}]`、`enable_join_question` + `join_questions[{id,content}]`、`super_moderator`（user id）、`moderation_topic_id`、`map_size`（3/5）、`topics[]`（每个含 `id,name,deployed,space_position{x,y,z},icon{name,size,color},thought_count,message_count`）、`member{is_moderator,is_super_moderator}`（当前用户视角）、sideload 容器 `objects.{users,topics,media}`。**响应为 snake_case，写入 body 为 camelCase**（`enableSpeakQuestion/enableJoinQuestion/superModerator/isModerator/permissionsDeny/parentId`）。问题文案修改走独立端点 `PATCH /nodes/{nid}/questions/{qid}` body `{content}`；UI 约束「要想填写问题，请打开上方的开关并保存后重载管理页」说明**问题实体在开关开启后才由服务端创建**。

---

## 三、布局与交互

### 布局尺寸（`css/node_manage.css`）

- 页面：`.container { display:grid; width:90%; margin:0 auto; grid-template-rows: 80px 1fr }`（80px 标题区）
- 卡片层次色（RGB triplet 变量，暗色经 `[data-theme=dark]` 覆写——与 Mew 本体同款主题机制）：`--colors-card-l1: 230 230 230`→暗色 `70 70 70`；`--colors-card-l2: 220 220 220`→`80 80 80`；`--colors-input: 200 200 200`→`60 60 60`；`--colors-btn: 190 190 190`→`120 120 120`；文本色引用 Mew 本体 Tailwind 变量 `rgb(var(--colors-secondary-darkest) / var(--tw-text-opacity))`
- 圆角体系：外层 `.accordion` 20px，卡片 `.accordion__item` 15px，输入/按钮/tab 5px，头像 `.member_avatar` 40x40px 圆角 5px
- 嵌套交替底色：`.accordion__content > .accordion__item { background-color: rgb(var(--colors-card-l1)) }`（l1/l2 交替形成层级）

### 手风琴（纯 CSS checkbox hack，无 JS）

`input.accordion__toggle { display:none }`；`:checked ~ .accordion__content { visibility:visible; max-height:800px; padding:5px }`（原型 600px），收起态 `max-height:0; visibility:hidden; transition: all 0.2s linear; overflow:scroll`。头部开关钮是 iOS 风格拨杆：`label` 40x20px、`border-radius:20px`、底色 `#dddddd`/`#f1f1f1`，滑块 `:after` 20px 白圆 `box-shadow: 0 2px 5px rgba(0,0,0,0.3)`，选中态轨道色 `rgb(114 148 218)`、滑块 `margin-left:20px`，动效 `transition: background 0.4s / margin 0.4s`。表单内权限开关 `.switcher` 复用同一套样式。

### Tab 容器

`.tab_container { display:grid; grid-template-areas: "tab1 tab2 tab3" "content content content"; grid-template-columns: 1fr 1fr 1fr }`（原型另有 `grid-template-rows: 30px 8fr; gap:5px`）。tab 是 div 而非按钮：`.tab1/.tab2/.tab3 { cursor:pointer; background-color: rgb(var(--colors-input)); border-radius:5px; padding:0 5px; margin:0 auto }`。切换即 `content.innerHTML = ""` 后重拉 API；进入 `#node_topic` 时自动 `.tab1.click()` 预载。

### 表单行

`.input_container { display:flex; width:100%; justify-content: space-between; padding:5px 0 }`；左标签 `.container__addon`（flex 居中），右控件 `.container__input { min-width:80% }`——**统一的"左说明右控件"两栏行式**，按钮也套同一行式（如「保存 | 保存」）。

### 基建网格与选择器

`.ic_root { display:grid; grid-template-columns/rows: repeat(5, minmax(96px,1fr)); gap:15px; padding:15px; border-radius:15px; background-color: rgb(255 255 255 / 15%) }`；格子为 96px 圆形 `wheat` 底占位。图标尺寸三档以缩放实现：`.icon_size_S { transform: scale(0.6) }` / `M 0.75` / `L 0.9`，图标 img 再 `scale(0.8)`。图标/颜色选择器 `.root_selector { grid-template-columns: repeat(auto-fill, minmax(96px,1fr)); gap:5px }`，色块 `.node_edit_selecor` 96x96 `display:table` 居中显示色名；选择器容器 `.node_edit { max-height:300px; overflow-y:scroll }`。

### 右键/上下文菜单（`MewTool.contextmenu`）

- 空格子点击 → 菜单「部署节点」（二级菜单列出所有未部署节点名）/「新建节点」
- 已部署格子点击 → 菜单：节点名（只读）/「想法：{thought_count}，消息：{message_count}」（只读统计）/「编辑节点」/「移除节点」
- 格子状态用 `deployed` attribute 标记，`(0,0)` 拒绝 undeploy

### 危险操作确认

一律原生 `confirm()`，文案明确后果分级：移出据点「可重新加入」 vs 黑名单「无法重新加入」 vs 转让领主「你将不再拥有该据点和该据点的管理权限」；删除类统一前缀「防手滑二次确认：真的要删除…吗？」。操作结果经 `mew.notice(title, msg)` toast 通知（成功/失败文案成对，如「据点信息保存成功！/失败！」）。204 响应显示「204 No Content」；PATCH 前做 diff，未改动字段置 `null` 剔除，全空 body 时报「没有改动任何数据！」。

### 模态页

节点编辑（templates[5]）经 `MewTool.stdpage(...).apply()` 渲染为覆盖式标准页（与主面板同构：`.container > .title + .accordion`），非浮窗。

---

## 四、端点总表（= 官方 API 能力清单）

| 功能 | 方法与端点 | 关键 body/参数 |
|---|---|---|
| 读据点 | `GET /api/v1/nodes/{node_name}` | 路径取自 `location.pathname.slice(3)`（`/n/…`） |
| 改据点 | `PATCH /nodes/{id}` | `{name, node_name, icon, searchable, tags[], enableSpeakQuestion, enableJoinQuestion, superModerator}` |
| 改问题 | `PATCH /nodes/{id}/questions/{qid}` | `{content}` |
| 建/改/删节点 | `POST /nodes/{id}/topics`、`PATCH /topics/{id}`、`DELETE /topics/{id}` | `{name, icon:{name,size,color,customize}}` |
| 空间部署 | `POST /nodes/{id}/topics/space-position` | `{View:[{id,position:{x,y,z},icon}]}` |
| 列表排序 | `PATCH /nodes/{id}/topics/position` | `{positions:[{id,position}]}` |
| 管理专用节点改名 | `PATCH /topics/{moderation_topic_id}/moderation` | `{name}` |
| 成员列表 | `GET /nodes/{id}/members?limit=50[&type=restricted][&after=cursor]` | 返回 `{entries[], next_cursor}` |
| 成员搜索 | `GET /nodes/{id}/members/search?keyword=…[&type=restricted\|blocked]` | |
| 改成员 | `PATCH /nodes/{id}/members/{uid}` | `{isModerator, permissionsDeny}`（16=讨论 32=想法 64=评论） |
| 踢出成员 | `DELETE /nodes/{id}/members/{uid}` | |
| 黑名单 | `GET /nodes/{id}/bans?limit=50`、`PUT /nodes/{id}/bans/{uid}`、`DELETE /nodes/{id}/bans/{uid}` | ban 记录含 `banned_at, operator_id` |
| 申请列表 | `GET /nodes/{id}/applications?type=join\|speak&state=pending\|approved\|rejected&limit=50` | 条目含 `applied_at, answers[]` |
| 审批 | `PATCH /nodes/{id}/applications/{type}/{uid}` | `{state:"approved"\|"rejected"\|"pending"}` |
| 图书馆 | `GET/POST /nodes/{id}/libraries`、`PATCH/DELETE /nodes/{id}/libraries/{entry_id}` | `{name, description, icon, parentId}` |
| 用户反查 | `GET /users/{id}`；`GET /users/@me/mynodes` | |
| 静态资源 | `https://cdn.mew.fun/spacelize/preset/icons/{icon}.png`；media URL + `~tplv-c226mjqywu-size:96.image` | |

---

## 五、哪些是「官方 API 已有、web 端未做 UI」

依据插件描述（「允许据点管理员在PC端管理据点。非管理员无法保存设置。」）与 README（「PC端据点管理功能：领主和管理员可以在网页端上管理据点，一般成员也可以偷窥下据点里的小秘密(◔◡◔)」），可确证：

1. **整个据点管理域在 web 端都没有 UI**——上表所有端点均为官方 API 原生存在（脚本零后端），web 端缺失的完整清单即：据点资料编辑、节点/基建 CRUD 与空间部署、加入/发言双审核流、成员权限位与管理员任免、领主转让、黑名单、成员搜索、图书馆书架/词条管理、管理专用节点。这些只在官方移动 App 有界面。
2. **细粒度权限位掩码**（`permissions_deny` 16/32/64）与 `type=restricted` 受限成员筛选：API 一等公民，web 端连展示都没有。
3. **审核状态机的「恢复申请」**（rejected→pending 回写）：API 支持任意 state 回写，App 端是否有此 UI 不明，web 端肯定没有。
4. **管理专用节点**（`moderation_topic_id` + `/topics/{id}/moderation`）：非管理员在 API 层即拿不到名称（模板兜底文案「没有权限查看管理专用节点名称。」），是服务端权限裁剪的 sideload 设计。
5. **README「偷窥」一句**说明多数 GET 端点（成员、申请、图书馆列表）普通成员也可读，仅写操作在服务端做权限校验——后继平台设计 API 时须注意这是隐私漏洞式的宽松读权限，不宜照搬。
6. `icon.customize:false` 字段暗示官方 API 预留了自定义节点图标能力（预设图标以外），前端（含脚本）未实现。

## 六、对后继平台前端的直接启示（速记）

- 角色模型：领主(super_moderator, 唯一, 可转让) / 管理员(is_moderator) / 成员 + deny 型权限位（发想法/参与讨论/发评论三项独立）+ 受限成员/黑名单两级惩戒（踢出可回、拉黑不可回、封禁记录带操作者与时间）。
- 审核模型:join(入点)与 speak(发言)两条独立申请流，同构复用同一套卡片/端点，三态 state + 答题(answers[])佐证。
- 内容组织：据点 → 节点(topic，聊天/话题混合体，带 thought_count/message_count) → 空间化部署(3x3/5x5 网格 + 列表 position 双排序)；图书馆 = 书架/词条两层树(parent_id)。
- API 风格：REST + snake_case 读 / camelCase 写、sideload `objects.{users,media,topics}`、cursor 分页 `{entries, next_cursor}` limit=50、diff-PATCH。
- UI 风格：单页手风琴 + 三分 tab、左标签右控件行式、iOS 拨杆开关、l1/l2 交替卡片底色、RGB triplet 主题变量 + `[data-theme=dark]`、原生 confirm 分级文案、toast 成对反馈。


---

# Mew 表情包清单档案报告（stamps_*.txt）

来源文件：
- `/Users/user/development/MyUserScript/userjs/mew/stamps_aru.txt`
- `/Users/user/development/MyUserScript/userjs/mew/stamps_bili_2233.txt`
- `/Users/user/development/MyUserScript/userjs/mew/stamps_mengbai.txt`

解析/消费方代码：`/Users/user/development/MyUserScript/userjs/mew/mew.body.js`（`plugin_custom_stamps`，插件名 `custom_stamp`）、`/Users/user/development/MyUserScript/userjs/mew/mew.frame.js`（`MewTool.imgurl2id`）。

---

## 1. 文件格式（每行结构、字段含义）

### 1.1 行结构

纯文本、按行分隔（解析时用 `split(/\n|\r|\r\n/).filter(i => i)`，即容忍 CRLF 与空行）。每行三种情况：

1. **注释行**：以 `#` 开头，解析时直接跳过（`if (i.slice(0, 1) == "#") continue;`）。实际用作包内元数据/署名，例如：
   - `#阿鲁系列表情的作者是微博@_SiC_，https://weibo.com/u/1691356984`
   - `#来自 @萌娘百科 的动态，快去关注萌百娘吧！https://space.bilibili.com/1300259363`
2. **数据行**：以 `$` 为字段分隔符，`id$hash$desc`，其中 `desc` 可省略（aru 包整包无第三字段）。
3. **空行**：被 `.filter(i => i)` 丢弃（`stamps_mengbai.txt` 第 20 行即空行）。

### 1.2 字段含义（由消费代码反推，均为事实）

| 字段 | 形态 | 含义与用途 |
|---|---|---|
| `id` | 17–18 位十进制数字（校验正则 `/[0-9]{17,18}/`，不匹配整行丢弃） | Mew 服务端的 **media id**（snowflake 风格，同包内单调递增，说明是按顺序批量上传产生的）。发送表情即发一条消息：`POST https://api.mew.fun/api/v1/topics/${topicid}/messages`，body 为 `{ nonce: <18位随机数字串>, media: [id] }`，携带 `Authorization: localStorage["mew-token"]` |
| `hash` | 32 位十六进制（提取正则 `/[0-9a-f]{32}?/`） | 图片内容哈希，直接拼 URL 渲染：缩略图 `https://image.mew.fun/${hash}~tplv-c226mjqywu-size:96.image`（96px，`<source type="image/png">`），原图 `https://image.mew.fun/${hash}`。`~tplv-…` 是字节跳动/火山引擎 veImageX 的处理模板语法，`c226mjqywu` 为其服务 ID |
| `desc` | 任意文本，可空 | 仅用于 UI 的 `title`/`alt` 提示，缺省显示 `"木有说明(っ °Д °;)っ"` |

`id` 与 `hash` 的对应由 Mew API 建立：`POST https://api.mew.fun/api/v1/medias/image/${hash}` 返回 `json.id`（见 `mew.frame.js:482-497` 的 `imgurl2id`）。即 **hash 定位图片资产，id 定位服务端媒体记录**，两者缺一则分别无法显示/无法发送。

相关 GUI 挂载点（顺带记录，供 GUI 考古）：表情面板容器 `[class^='reaction-panel_stamp-list__']`（注入后加 `.custom_stamps`），单个表情按钮 `class="reaction-panel_stamp__8qpSD"`，图片包裹 `class="reaction-panel_image__2FjNq"`；管理页自定义类 `.stamp_manage`、`.stamp_card`、`.add_stamp_card`。导入途径三种：URL 批量导入、本地 `.txt` 批量导入、单张图片链接添加；导出即把 `id$hash$desc` 数组 join("\n") 存为 `.txt` —— 本三份文件就是这种导出/分发格式。

## 2. 每包数量与命名规律

| 文件 | 注释行 | 数据行数 | desc 命名规律 |
|---|---|---|---|
| `stamps_aru.txt` | 2 行（署名 + "共306个表情，太多了所以不一一写说明了"） | **306**（与注释自述一致；id 段 `117993078…`–`117995074…`） | **无 desc**，全部两字段 `id$hash` |
| `stamps_bili_2233.txt` | 0 行 | **14**（id 段 `116831734…`–`116833373…`） | 三字段，desc 带方括号：`[2233娘_疑问]`、`[2233娘_大笑]`、`[2233娘_汗]`、`[2233娘_大哭]`、`[2233娘_喝水]`、`[2233娘_困惑]`、`[2233娘_第一]`、`[2233娘_郁闷]`、`[2233娘_委屈]`、`[2233娘_吃惊]`、`[2233娘_耶]`、`[2233娘_吐魂]`、`[2233娘_怒]`、`[2233娘_无言]` —— 模式 `[角色名_情绪词]`，与 bilibili 官方表情的 `[tv_xx]` 记法同风格 |
| `stamps_mengbai.txt` | 1 行（署名） | **18**（末行空行；id 段 `149553593…`–`149553728…`） | 三字段，desc 不带括号：`萌百娘_贫穷`、`萌百娘_布`、`萌百娘_剪刀`、`萌百娘_石头`（含猜拳一套）、`萌百娘_扇子笑`、`萌百娘_睡觉`、`萌百娘_咸鱼`、`萌百娘_哭泣`、`萌百娘_？？？`、`萌百娘_生气`、`萌百娘_大闹`、`萌百娘_比心`、`萌百娘_吃瓜`、`萌百娘_无语`、`萌百娘_开饭开饭`、`萌百娘_关小黑屋`、`萌百娘_带恶人`、`萌百娘_乖巧` —— 模式 `角色名_情绪/动作` |

文件命名规律：`stamps_<包名>.txt`（aru＝阿鲁、bili_2233＝bilibili 2233 娘、mengbai＝萌百娘）。三包 desc 风格不统一（无/带括号/不带括号），说明 desc 是自由文本、无 schema 约束。

## 3. 图片宿主域名与可达性探测

三份清单中的图片资产**只有一个宿主**：`image.mew.fun`（注释里的 `weibo.com`、`space.bilibili.com` 仅为署名链接，非图片宿主）。

探测（样本取 aru 包首个 hash）：

```
curl -s -o /dev/null -w '%{http_code}' -I --max-time 8 \
  'https://image.mew.fun/a340c5da4ce546b79da1af64671fc3f7~tplv-c226mjqywu-size:96.image'
→ 000   （GET 同样 000）
```

失败模式：`curl: Could not resolve host: image.mew.fun` —— **DNS 层死亡**，非 4xx/5xx。补充证据：`dig +short image.mew.fun A` 返回 CNAME `image.mew.fun.bytexns.com.` 且无最终 A 记录；`bytexns.com` 是字节跳动 CDN 的权威 DNS 域，与 URL 中 veImageX 模板 `~tplv-c226mjqywu` 互相印证——Mew 图床架在火山引擎 veImageX 上，服务注销后 CNAME 残留但不再解析。**结论：所有 306+14+18=338 个图片资产均不可达，且无 Wayback 类替代 URL 记录在案。**

## 4. 对后继项目表情包功能的启示

**格式可否直接作导入格式：结构上可以，语义上不行。**
- 行式 `id$hash$desc` + `#` 注释 + 空行容忍，解析成本极低（一个 `split("$")`），且已验证过导入/导出/URL 分发三条链路，作为"表情包交换文本格式"的骨架可直接继承。
- 但两个核心字段都绑死了 Mew 后端：`id` 只对 `api.mew.fun` 的消息 API 有意义，`hash` 只能拼出 `image.mew.fun` 的 veImageX URL。后继项目若沿用此格式，字段语义必须重定义（如 `id` → 本平台 media id 或废弃、`hash` → 自有对象存储 key 或完整 URL）。可把这三份文件视为"仅 desc 与包结构可迁移"的清单。
- 设计教训：desc 无 schema（可空、括号风格不一）、`#` 注释承载署名属"约定俗成"，后继格式若要机器可读的作者/授权信息，应设显式元数据字段而非注释。

**资产是否需要重新收集：需要，且必须回源。**
- 图床 DNS 已死（实测 000），hash 是定位符不是内容，无法从清单还原任何像素。338 张图全部需要从原始出处重新收集，desc 字段（2233 娘 14 个、萌百娘 18 个）可用作重收集时的对照清单；阿鲁 306 张连名字都没有，只能整包回源。

**授权注意点（仅陈述事实与风险，不做法律结论）：**
- **阿鲁（aru）**：文件内注释明确署名"作者是微博@_SiC_，https://weibo.com/u/1691356984"（并非 NB；任务提示中的 "by NB?" 与档案不符，以文件内署名为准）。306 张为个人画师作品，在后继平台内置或预装需取得该作者许可；原清单仅有署名、无任何许可条款。
- **2233 娘（bili_2233）**：2233 娘是 bilibili 的官方看板娘 IP，desc 的 `[2233娘_x]` 记法与 bilibili 站内官方表情同风格，极可能直接搬运自 bilibili 官方表情资产。商业 IP + 官方素材，未经授权内置的风险在三包中最高。
- **萌百娘（mengbai）**：注释署名来源为萌娘百科官方 bilibili 账号（space.bilibili.com/1300259363）的动态图。萌百娘是萌娘百科的站娘形象；萌娘百科站内条目文本常以 CC BY-NC-SA 类条款发布，但站娘形象图的权利归属与许可条款并未记录在本清单中，需另行确认。
- 共性风险：三包均是**用户自行打包分发**的清单（bettermew 的导出格式），不代表任何一方授权了在 Mew 或后继平台的使用；后继项目若提供"预装表情包"，每包都需要独立的授权链，或改为仅提供空格式让用户自行导入。
