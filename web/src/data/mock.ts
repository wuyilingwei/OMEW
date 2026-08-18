import type { ChannelSummary, ChatMessage, StrongholdNode, Topic } from '../types/models'

export const mockNodes: StrongholdNode[] = [
  { id: 'n1', name: '主据点', iconLabel: '主', active: true },
  { id: 'n2', name: '闲聊据点', iconLabel: '闲', active: false },
  { id: 'n3', name: '开发据点', iconLabel: '开', active: false },
  { id: 'n4', name: '游戏据点', iconLabel: '游', active: false },
  { id: 'n5', name: '摄影据点', iconLabel: '摄', active: false },
]

export const mockTopics: Topic[] = [
  { id: 't1', name: '综合讨论' },
  { id: 't2', name: '公告' },
  { id: 't3', name: '技术' },
  { id: 't4', name: '闲聊' },
  { id: 't5', name: '资源分享' },
  { id: 't6', name: '反馈' },
]

export const mockChannels: ChannelSummary[] = [
  { id: 'c1', name: '综合讨论', preview: '今天的进度已经同步到看板了', timestamp: '10:24', unread: 3, active: true },
  { id: 'c2', name: '公告', preview: '本周维护窗口已更新', timestamp: '09:02', unread: 0, active: false },
  { id: 'c3', name: '技术', preview: 'Durable Object 的迁移方案定下来了', timestamp: '昨天', unread: 1, active: false },
  { id: 'c4', name: '闲聊', preview: '周末有人一起打游戏吗', timestamp: '昨天', unread: 0, active: false },
  { id: 'c5', name: '资源分享', preview: '整理了一份图标素材包', timestamp: '周二', unread: 0, active: false },
]

export const mockMessages: ChatMessage[] = [
  { id: 'm1', author: 'Rin', content: '早上好，今天的同步会议改到下午三点', timestamp: '09:12', mine: false },
  { id: 'm2', author: '我', content: '收到，我把文档链接放这里', timestamp: '09:13', mine: true },
  { id: 'm3', author: 'Rin', content: '看到了，辛苦', timestamp: '09:14', mine: false },
  { id: 'm4', author: 'Aki', content: '话题栏悬停展开的交互挺好用的', timestamp: '10:02', mine: false },
  { id: 'm5', author: '我', content: '对，这是从原版考古出来的模式', timestamp: '10:05', mine: true },
  { id: 'm6', author: 'Rin', content: '进度已经同步到看板了', timestamp: '10:24', mine: false },
]
