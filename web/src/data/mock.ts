import type { ChannelSummary, ChatMessage, Post, StrongholdNode, TopicGroup } from '../types/models'

// placeholder cover art, generated inline so the feed has no external image dependency
const cover = (from: string, to: string, glyph: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="400" height="200" fill="url(#g)"/><text x="50%" y="54%" font-size="64" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, sans-serif">${glyph}</text></svg>`,
  )}`

export const mockNodes: StrongholdNode[] = [
  { id: 'n1', name: '主据点', iconLabel: '主', description: '综合讨论与公告的默认据点，日常消息大多汇聚在这里。', cover: cover('#345BAC', '#1F3C7A', '主'), active: true },
  { id: 'n2', name: '闲聊据点', iconLabel: '闲', description: '不聊正事，专门用来水群、扯淡、发无意义的表情包。', cover: cover('#C0678A', '#8A3F63', '闲'), active: false },
  { id: 'n3', name: '开发据点', iconLabel: '开', description: '技术讨论、代码评审与项目进度同步的地方。', cover: cover('#3F8F6B', '#245C43', '开'), active: false },
  { id: 'n4', name: '游戏据点', iconLabel: '游', description: '组队开黑、攻略分享，欢迎随时来接龙。', cover: cover('#C0863F', '#8A5C24', '游'), active: false },
  { id: 'n5', name: '摄影据点', iconLabel: '摄', description: '交流器材与后期心得，偶尔举办主题摄影征集。', cover: cover('#5B7DC0', '#345BAC', '摄'), active: false },
]

export const mockTopicGroups: TopicGroup[] = [
  { id: 'tg1', name: '公告' },
  { id: 'tg2', name: '创作分享' },
  { id: 'tg3', name: '闲聊' },
]

export const mockPosts: Post[] = [
  {
    id: 'p1',
    topicGroupId: 'tg1',
    title: '本周维护窗口已更新',
    preview: '本次维护将在周四凌晨两点开始，预计持续一小时，期间聊天记录仍可正常读取……',
    content:
      '本次维护将在周四凌晨两点开始，预计持续一小时，期间聊天记录仍可正常读取，但发送新消息与上传附件会暂时不可用。\n\n' +
      '维护内容包括：数据库存储层的例行优化、消息同步链路的小幅调整，以及若干后台监控项的补齐。整个过程对绝大多数用户无感，唯一影响是维护窗口内无法发送新消息。\n\n' +
      '如果维护结束后你发现历史消息顺序异常或附件加载失败，请直接在本帖回复，管理组会逐一跟进排查。感谢大家的理解与配合。',
    author: '管理组',
    avatar: '管理组',
    timestamp: '09:02',
  },
  {
    id: 'p2',
    topicGroupId: 'tg1',
    title: '社区行为守则修订',
    preview: '为了让讨论环境更舒适，我们对行为守则做了几处补充，重点是关于话题分区的使用规范……',
    content:
      '为了让讨论环境更舒适，我们对行为守则做了几处补充，重点是关于话题分区的使用规范：请尽量将内容发到对应的话题组，避免在「公告」分区闲聊，也避免在「闲聊」分区刷屏式发布长篇技术贴。\n\n' +
      '此外新增了一条关于头像与昵称的建议：不要使用可能引起误解或冒犯他人的内容。违规内容第一次会私信提醒，多次出现会视情况限制发言。\n\n' +
      '完整条款见置顶帖，如果对某一条有疑问，欢迎在这里留言讨论，管理组会尽量给出解释。',
    author: '管理组',
    avatar: '管理组',
    timestamp: '昨天',
  },
  {
    id: 'p3',
    topicGroupId: 'tg2',
    title: '新据点主题壁纸放出',
    preview: '这次的主题延续了上个季度的配色，加入了更多据点相关的细节，欢迎大家来挑喜欢的一张……',
    content:
      '这次的主题延续了上个季度的配色，加入了更多据点相关的细节，欢迎大家来挑喜欢的一张。\n\n' +
      '一共准备了六张，分辨率覆盖到 4K，桌面端和手机端的比例都有考虑。素材来自几位志愿者的投稿，画风统一做了调色处理，所以放在一起看不会显得违和。\n\n' +
      '下载链接会在稍后整理到置顶帖里，如果你也想为下个季度的主题投稿，可以关注「周末创作征集」那条帖子。',
    cover: cover('#345BAC', '#7294DA', '🎨'),
    author: 'Rin',
    avatar: 'Rin',
    timestamp: '10:24',
  },
  {
    id: 'p4',
    topicGroupId: 'tg2',
    title: '周末创作征集',
    preview: '主题是「据点日常」，形式不限，文字、绘画、摄影都可以，周日晚上十点截止投稿……',
    content:
      '主题是「据点日常」，形式不限，文字、绘画、摄影都可以，周日晚上十点截止投稿。\n\n' +
      '投稿直接回复在本帖下面，或者私信发给我都可以。收到后会统一整理转发到公告区，被选中作为下期壁纸素材的作者会额外收到一份小礼物。\n\n' +
      '往期的征集作品还留着，感兴趣的话可以往前翻几页看看大家都拍/画了些什么，说不定能找到灵感。',
    cover: cover('#7294DA', '#345BAC', '🖌️'),
    author: 'Aki',
    avatar: 'Aki',
    timestamp: '周二',
  },
  {
    id: 'p5',
    topicGroupId: 'tg3',
    title: '今晚一起联机吗',
    preview: '人已经凑得差不多了，还差一个，有兴趣的在下面接龙一下时间……',
    content:
      '人已经凑得差不多了，还差一个，有兴趣的在下面接龙一下时间。\n\n' +
      '大概晚上九点开始，预计打两三个小时，语音在游戏据点的常驻频道，没加的话先申请一下权限。萌新也欢迎，人多主要是图个热闹，不卡人。\n\n' +
      '接龙格式随意，报个大概能上线的时间段就行。',
    author: '我',
    avatar: '我',
    timestamp: '10:05',
  },
  {
    id: 'p6',
    topicGroupId: 'tg3',
    title: '新人打个招呼',
    preview: '刚加入据点，之前主要在闲聊分区潜水，以后请多关照，先放一张自己拍的照片……',
    content:
      '刚加入据点，之前主要在闲聊分区潜水，以后请多关照，先放一张自己拍的照片。\n\n' +
      '平时喜欢瞎拍风景和猫，偶尔也写点东西。如果摄影据点有活动欢迎叫我，正好想找机会多练练手。\n\n' +
      '先自我介绍到这，之后应该会比较活跃地冒泡，大家多多指教。',
    cover: cover('#5B7DC0', '#3F5FA8', '👋'),
    author: 'Mika',
    avatar: 'Mika',
    timestamp: '周三',
  },
]

export const mockChannels: ChannelSummary[] = [
  { id: 'c1', name: '综合讨论', description: '不限主题的日常聊天，据点里最热闹的频道。', active: true },
  { id: 'c2', name: '公告', description: '管理组发布的通知与重要更新，仅管理组可发言。', active: false },
  { id: 'c3', name: '技术', description: '开发相关的讨论、踩坑记录与代码分享。', active: false },
  { id: 'c4', name: '闲聊', description: '正经话题聊累了，来这里放松一下。', active: false },
  { id: 'c5', name: '资源分享', description: '素材、工具与链接的汇总地，转载请注明来源。', active: false },
]

export const mockMessages: ChatMessage[] = [
  { id: 'm1', author: 'Rin', avatar: 'Rin', content: '早上好，今天的同步会议改到下午三点', timestamp: '09:12', mine: false },
  { id: 'm2', author: '我', avatar: '我', content: '收到，我把文档链接放这里', timestamp: '09:13', mine: true },
  { id: 'm3', author: 'Rin', avatar: 'Rin', content: '看到了，辛苦', timestamp: '09:14', mine: false },
  { id: 'm4', author: 'Aki', avatar: 'Aki', content: '频道下拉切换起来顺手多了', timestamp: '10:02', mine: false },
  { id: 'm5', author: '我', avatar: '我', content: '对，之前那条横向标签栏确实别扭', timestamp: '10:05', mine: true },
  { id: 'm6', author: 'Rin', avatar: 'Rin', content: '进度已经同步到看板了', timestamp: '10:24', mine: false },
]
