import { describe, expect, it } from 'vitest'
import composePostSource from '../web/src/components/ComposePostModal.vue?raw'
import postModalSource from '../web/src/components/PostModal.vue?raw'
import { renderMarkdown } from '../web/src/utils/markdown'
import { markdownPreview as clientPreview } from '../web/src/utils/markdownPreview'
import { markdownPreview as serverPreview } from '../server/src/markdown-preview'

describe('post Markdown rendering', () => {
  it('renders standard Markdown and uploaded media URLs safely', () => {
    const html = renderMarkdown('# Title\n\n**bold** and ![photo](/media/file-1)')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<img src="/media/file-1" alt="photo">')
  })

  it('escapes raw HTML and refuses unsafe or non-media relative URLs', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) ![bad](data:image/png;base64,AAAA) [other](/not-media)')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('src="data:')
    expect(html).not.toContain('href="/not-media"')
  })

  it('hardens external links and shares the renderer between preview and published posts', () => {
    const html = renderMarkdown('[site](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(composePostSource).toContain('<MarkdownContent :text="form.text" />')
    expect(postModalSource).toContain('<MarkdownContent :text="thread.post.text" />')
    expect(composePostSource).toContain('insertAtCursor(`![图片](${uploaded.url})`)')
    expect(composePostSource).toContain(':IsEnabled="canPublish"')
    expect(composePostSource).toContain('imageQueue.value.length === 0')
    expect(postModalSource).toContain('visiblePostMedia')
  })

  it('derives matching plain-text summaries without Markdown control syntax', () => {
    const source = '# Heading\n\n![cover](/media/a) **Bold** [link](https://example.com)'
    expect(serverPreview(source)).toBe('Heading cover Bold link')
    expect(clientPreview(source)).toBe(serverPreview(source))
  })
})
