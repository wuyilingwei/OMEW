export interface StrongholdNode {
  id: string
  name: string
  iconLabel: string
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
  cover?: string
  author: string
  timestamp: string
}

export interface ChannelSummary {
  id: string
  name: string
  active: boolean
}

export interface ChatMessage {
  id: string
  author: string
  content: string
  timestamp: string
  mine: boolean
}
