const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g

/** Keep optimistic post summaries aligned with the Worker-side projection. */
export function markdownPreview(text: string, limit = 80): string {
  return text
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+\.\s+)/gm, '')
    .replace(/(\*\*|__|~~|`|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}
