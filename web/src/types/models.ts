export interface StrongholdNode {
  id: string
  name: string
  iconLabel: string
  description: string
  cover: string
  active: boolean
}

export interface TopicGroup {
  id: string
  name: string
}

export interface Post {
  id: string
  topicGroupId: string
  title: string
  preview: string
  content: string
  cover?: string
  author: string
  avatar: string
  timestamp: string
}

export interface ChannelSummary {
  id: string
  name: string
  description: string
  active: boolean
}

export interface ChatMessage {
  id: string
  author: string
  avatar: string
  content: string
  timestamp: string
  mine: boolean
}
