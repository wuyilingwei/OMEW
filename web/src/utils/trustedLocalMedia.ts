const trustedLocalMediaUrls = new Set<string>()

export function trustLocalMediaUrl(url: string): void {
  if (url.startsWith('blob:')) trustedLocalMediaUrls.add(url)
}

export function isTrustedLocalMediaUrl(url: string): boolean {
  return trustedLocalMediaUrls.has(url)
}
