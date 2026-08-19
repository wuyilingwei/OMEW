# Mew 一手存档盘点(二次考古)
> 2026-08-19 · 材料:OneDrive 私人存档五类(主页截图+CSS / 备份包 / 102 个想法存档 / 官方 APK / 历史设计稿与站点数据)
> 本文为分析报告;原始提取件(色表/CSS 原文/class 清单/截图样本)存于本地审计目录,不随仓库分发。

## 对既有考古结论的证实 / 修正 / 新增

### 真实配色(核心翻案)
从官方构建产物 `index.54e95e04.css` 直接读出**完整亮色 `:root` 块 104 个 token**,另有官方 `[data-theme=dark]`(51 token)与此前未知的 `[data-theme=genshin]` 第三主题(原神联动皮肤,与落地页 keywords 互证)。

| 结论 | 类型 |
|---|---|
| 亮色主蓝 `--colors-primary` = **#345BAC** | 证实(三重独立来源:CSS 原文 / `theme-color` meta / mew.js SVG fill) |
| **官方暗色主蓝 = #5288F6** | **修正**——先前考古的暗色表(#7294DA)系 bettermew 作者自配,非官方值 |
| Genshin 主题主色 #8D7650 | 新增 |
| ~90 个未收录 token(pin/snackbar/space/status 平台色/node-public-private-owner 等) | 新增 |

节选:`--colors-secondary-darkest` #111111;gray-100/150/300 = #F5F5F5/#EEEEEE/#CCCCCC;error #FF6565;node-public/private/owner = #34AC56/#4883FE/#AC3434;平台色 PSN/Xbox/Steam/Switch 各有专属 token。

### 表情/插画资产:三条结论并立
1. 第三方自定义表情 338 张(阿鲁/2233娘/萌百娘)**仍不可达**(维持原判);
2. **官方吉祥物/UI 插画完全可恢复**:备份包 43 概念 76 文件(PNG+WebP 全),APK webview 内扩展至 116 文件;
3. **用户想法配图真实可恢复**:102 个想法存档目录中 162 张(~205MB,106 jpg/54 png/2 gif),文件名 100% 保持 image.mew.fun 的 32 位内容哈希对象键;系停运前手工抢救的原始字节而非网页另存。

### 真实 UI 截图(首次,像素级)
旧设定稿 pptx 内 7 张 1080px 真机截图,终结了「纯代码逆向」时代:
- 节点聊天:据点名 +「XX 分钟前活跃」、浅蓝气泡、圆形头像、贴纸卡片、底部输入框+表情选择器;
- 个人主页:封面+头像+关注计数+**PSN/Switch/Steam/Xbox 平台图标**(与 CSS 平台色 token 交叉确认);
- 据点首页:封面+成员证/邀请+公告横幅+搜索+**话题 Tag 横条**(ALL+具名,胶囊按钮;证实 topic-selector 反推)+话题图标横排(绿环=活跃、蓝盾=置顶);
- **基建视图为六边形网格观感**(中枢+彩色椭圆底话题图标+未读徽标+「切换视图」);先前仅有方格 x,y 坐标的 API 推断——官方 App 的视觉呈现与 bettermew 网页重建的方格布局并立;
- 节点分享卡 ×2(星标收藏、双吉祥物封面)。

### 其他证实/澄清
- 505 个真实 CSS-Modules class 名提取比对:layouts/thought/topic-selector/card/drawer 族证实;若干族本快照未见(版本差异,非否定)。`--tw-text-opacity`、ProseMirror、PhotoSwipe、`mew-token`、`cdn.mew.fun/spacelize/preset/icons/` 动态模板、gateway/api 域名全部原样命中。落地页为 Vite 构建,与主 App 两套流水线。
- mew.js(70KB)= bettermew 同项目早期/姊妹版本(`.custompage_root`/`appear` 关键帧/#345bac 三证)。
- sitemap 双切片:2022-05-15 共 2342 条、05-28 共 2376 条,**全部为 /n/{node} 据点页**(SEO 仅收录据点);两周 +34 个据点,可作规模增长证据。`all.docx` 实为 sitemap URL 粘贴件(非设计文档);`一些瞎想.docx` 为 0 字节空文件。
- 品牌全称首录:**Members of the Excellent World**;运营 2019–2022;停运时间线(用户自留公告):2022-10-24 关注册 → 10-25 停发布 → 10-31 关服。
- 新 URL 模式:`cdn.mew.fun/release/android/mew-{version}.apk`。

## APK 资产要点(mew-latest,57.5MB → 解包 93MB/2947 文件)
原生 Android(Kotlin,multidex)+ 内嵌 Vite/React WebView;75 个 spacelize 预置图标确证**纯 CDN 分发**(APK 内无离线副本);res 经收缩混淆,启动图标经 arsc 定位(192/432px 蓝渐变字标);SDK:MMKV/Sentry/字节跳动安全网络与视频上传(与 veImageX 图床结论互证);字体为 Roboto 家族 28 子集。历史版本序列 v1.15.8→v1.16.19-0(2021-12→2022-06)另存 12 个。

## 可用性(事实陈述)
- 数值型信息(色值/圆角/间距/布局比例/class 命名)可作 OMEW 设计规范参照;
- **授权边界(运营者一手说明,2026-08-19)**:Logo/字标为受保护资产,不使用不分发;Mew 自有表情包与吉祥物插画等,运营人员在停运前已授予任意使用许可——可在 OMEW 实例中使用,分发仍走「不进 Git 仓库、部署时导入」的解耦方式(工程选择,与许可无关);
- 第三方 IP 表情包(2233 娘 = bilibili、阿鲁 = 画师 @_SiC_、萌百娘 = 萌娘百科)不属 Mew 运营方可授权范围,维持不使用;
- 想法配图为其他用户 UGC、Tomon 贴纸与 Mew 无关,均不作设计参照;
- 全部素材未拷入本仓库,提取件仅存本地审计目录。
