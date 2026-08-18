export interface StrongholdNode {
  id: string
  name: string
  iconLabel: string
  active: boolean
}

export interface Topic {
  id: string
  name: string
}

export interface ChannelSummary {
  id: string
  name: string
  preview: string
  timestamp: string
  unread: number
  active: boolean
}

export interface ChatMessage {
  id: string
  author: string
  content: string
  timestamp: string
  mine: boolean
}
