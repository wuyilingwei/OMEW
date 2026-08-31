export interface HomeUpdate {
  id: string
  publishedAt: string
  category: string
  title: string
  summary: string
}

export const HOME_UPDATES = [
  {
    id: 'omew-1-0-0',
    publishedAt: '2026-08-31',
    category: '正式版本',
    title: 'OMEW 1.0.0 正式发布',
    summary: 'Mew 停止运营 1400 天后，OMEW 完成单实例社区闭环，并可通过 Overture 部署到自己的 Cloudflare 账户。',
  },
  {
    id: 'member-profiles-and-conversations',
    publishedAt: '2026-08-23',
    category: '社区体验',
    title: '成员资料与私聊上线',
    summary: '现在可以填写自我介绍、从据点成员列表查看完整资料，并向同一据点的成员发起私聊或管理拉黑关系。',
  },
  {
    id: 'permanent-home-and-discovery',
    publishedAt: '2026-08-23',
    category: '首页',
    title: 'OMEW 首页始终可达',
    summary: '登录前后都可以回到首页，并从公开据点目录直接进入想去的小世界，不再把首页当成一次性的登录入口。',
  },
  {
    id: 'layered-dream-world',
    publishedAt: '2026-08-23',
    category: '视觉',
    title: '多层梦境场景回归',
    summary: '云海、城景、双光环与前景被重建为八个远近层次，随着指针移动呈现平滑的 2.5D 景深。',
  },
] as const satisfies readonly HomeUpdate[]
