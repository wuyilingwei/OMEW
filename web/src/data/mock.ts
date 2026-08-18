import type { ChannelSummary, ChatMessage, Post, StrongholdNode, TopicGroup } from '../types/models'

export const mockNodes: StrongholdNode[] = [
  { id: 'n1', name: '主据点', iconLabel: '主', active: true },
  { id: 'n2', name: '闲聊据点', iconLabel: '闲', active: false },
  { id: 'n3', name: '开发据点', iconLabel: '开', active: false },
  { id: 'n4', name: '游戏据点', iconLabel: '游', active: false },
  { id: 'n5', name: '摄影据点', iconLabel: '摄', active: false },
]

export const mockTopicGroups: TopicGroup[] = [
  { id: 'tg1', name: '公告' },
  { id: 'tg2', name: '创作分享' },
  { id: 'tg3', name: '闲聊' },
]

// placeholder cover art, generated inline so the feed has no external image dependency
const cover = (from: string, to: string, glyph: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="400" height="200" fill="url(#g)"/><text x="50%" y="54%" font-size="64" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, sans-serif">${glyph}</text></svg>`,
  )}`

export const mockPosts: Post[] = [
  {
    id: 'p1',
    topicGroupId: 'tg1',
    title: '本周维护窗口已更新',
    preview: '本次维护将在周四凌晨两点开始，预计持续一小时，期间聊天记录仍可正常读取……',
    author: '管理组',
    timestamp: '09:02',
  },
  {
    id: 'p2',
    topicGroupId: 'tg1',
    title: '社区行为守则修订',
    preview: '为了让讨论环境更舒适，我们对行为守则做了几处补充，重点是关于话题分区的使用规范……',
    author: '管理组',
    timestamp: '昨天',
  },
  {
    id: 'p3',
    topicGroupId: 'tg2',
    title: '新据点主题壁纸放出',
    preview: '这次的主题延续了上个季度的配色，加入了更多据点相关的细节，欢迎大家来挑喜欢的一张……',
    cover: cover('#345BAC', '#7294DA', '🎨'),
    author: 'Rin',
    timestamp: '10:24',
  },
  {
    id: 'p4',
    topicGroupId: 'tg2',
    title: '周末创作征集',
    preview: '主题是「据点日常」，形式不限，文字、绘画、摄影都可以，周日晚上十点截止投稿……',
    cover: cover('#7294DA', '#345BAC', '🖌️'),
    author: 'Aki',
    timestamp: '周二',
  },
  {
    id: 'p5',
    topicGroupId: 'tg3',
    title: '今晚一起联机吗',
    preview: '人已经凑得差不多了，还差一个，有兴趣的在下面接龙一下时间……',
    author: '我',
    timestamp: '10:05',
  },
  {
    id: 'p6',
    topicGroupId: 'tg3',
    title: '新人打个招呼',
    preview: '刚加入据点，之前主要在闲聊分区潜水，以后请多关照，先放一张自己拍的照片……',
    cover: cover('#5B7DC0', '#3F5FA8', '👋'),
    author: 'Mika',
    timestamp: '周三',
  },
]

export const mockChannels: ChannelSummary[] = [
  { id: 'c1', name: '综合讨论', active: true },
  { id: 'c2', name: '公告', active: false },
  { id: 'c3', name: '技术', active: false },
  { id: 'c4', name: '闲聊', active: false },
  { id: 'c5', name: '资源分享', active: false },
]

export const mockMessages: ChatMessage[] = [
  { id: 'm1', author: 'Rin', content: '早上好，今天的同步会议改到下午三点', timestamp: '09:12', mine: false },
  { id: 'm2', author: '我', content: '收到，我把文档链接放这里', timestamp: '09:13', mine: true },
  { id: 'm3', author: 'Rin', content: '看到了，辛苦', timestamp: '09:14', mine: false },
  { id: 'm4', author: 'Aki', content: '频道下拉切换起来顺手多了', timestamp: '10:02', mine: false },
  { id: 'm5', author: '我', content: '对，之前那条横向标签栏确实别扭', timestamp: '10:05', mine: true },
  { id: 'm6', author: 'Rin', content: '进度已经同步到看板了', timestamp: '10:24', mine: false },
]
