import MarkdownIt from 'markdown-it'

const renderer = new MarkdownIt({ html: false, linkify: true, breaks: true })

// markdown-it rejects dangerous schemes by default. The application narrows
// its accepted set further so uploaded images remain on the existing media API.
renderer.validateLink = (url: string) => {
  if (/^\/media(?:\/|$)/.test(url)) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}

const defaultLinkOpen = renderer.renderer.rules.link_open
renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]!
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options)
}

export function renderMarkdown(text: string): string {
  return renderer.render(text)
}
