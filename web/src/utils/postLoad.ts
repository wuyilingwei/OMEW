export function canCommitPostPage(currentGeneration: number, currentKey: string, expectedGeneration: number, expectedKey: string) {
  return currentGeneration === expectedGeneration && currentKey === expectedKey
}
