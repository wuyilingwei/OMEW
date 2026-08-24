export type GifPlaybackMode = 'disabled' | 'once' | 'normal'

interface GifStructure {
  firstImageEnd: number
  loopExtensions: Array<{ start: number; end: number }>
}

const GIF87A = 'GIF87a'
const GIF89A = 'GIF89a'
const NETSCAPE_LOOP_IDS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0'])

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

function skipSubBlocks(bytes: Uint8Array, start: number): number | null {
  let offset = start
  while (offset < bytes.byteLength) {
    const size = bytes[offset]!
    offset += 1
    if (size === 0) return offset
    if (offset + size > bytes.byteLength) return null
    offset += size
  }
  return null
}

function inspectGif(bytes: Uint8Array): GifStructure | null {
  if (bytes.byteLength < 14) return null
  const signature = ascii(bytes, 0, 6)
  if (signature !== GIF87A && signature !== GIF89A) return null

  const logicalScreenPacked = bytes[10]!
  const globalColorTableSize = (logicalScreenPacked & 0x80) === 0
    ? 0
    : 3 * (1 << ((logicalScreenPacked & 0x07) + 1))
  let offset = 13 + globalColorTableSize
  if (offset >= bytes.byteLength) return null

  let firstImageEnd = -1
  const loopExtensions: Array<{ start: number; end: number }> = []

  while (offset < bytes.byteLength) {
    const marker = bytes[offset]!
    if (marker === 0x3b) {
      return firstImageEnd >= 0 ? { firstImageEnd, loopExtensions } : null
    }

    if (marker === 0x2c) {
      if (offset + 10 > bytes.byteLength) return null
      const imagePacked = bytes[offset + 9]!
      const localColorTableSize = (imagePacked & 0x80) === 0
        ? 0
        : 3 * (1 << ((imagePacked & 0x07) + 1))
      const imageDataStart = offset + 10 + localColorTableSize
      if (imageDataStart >= bytes.byteLength) return null
      const imageEnd = skipSubBlocks(bytes, imageDataStart + 1)
      if (imageEnd === null) return null
      if (firstImageEnd < 0) firstImageEnd = imageEnd
      offset = imageEnd
      continue
    }

    if (marker !== 0x21 || offset + 2 >= bytes.byteLength) return null
    const extensionLabel = bytes[offset + 1]!
    const extensionDataStart = offset + 2

    let isLoopExtension = false
    if (extensionLabel === 0xff) {
      const applicationIdLength = bytes[extensionDataStart]!
      const applicationIdStart = extensionDataStart + 1
      const applicationDataStart = applicationIdStart + applicationIdLength
      if (applicationDataStart >= bytes.byteLength) return null
      const applicationId = ascii(bytes, applicationIdStart, applicationIdLength)
      const loopBlockSize = bytes[applicationDataStart]!
      if (
        NETSCAPE_LOOP_IDS.has(applicationId)
        && loopBlockSize >= 3
        && applicationDataStart + loopBlockSize < bytes.byteLength
        && bytes[applicationDataStart + 1] === 1
      ) {
        isLoopExtension = true
      }
    }

    const extensionEnd = skipSubBlocks(bytes, extensionDataStart)
    if (extensionEnd === null) return null
    if (isLoopExtension) loopExtensions.push({ start: offset, end: extensionEnd })
    offset = extensionEnd
  }

  return null
}

export function transformGifForPlayback(bytes: Uint8Array, mode: GifPlaybackMode): Uint8Array | null {
  const structure = inspectGif(bytes)
  if (!structure) return null
  if (mode === 'normal') return bytes

  if (mode === 'disabled') {
    const firstFrame = new Uint8Array(structure.firstImageEnd + 1)
    firstFrame.set(bytes.subarray(0, structure.firstImageEnd))
    firstFrame[structure.firstImageEnd] = 0x3b
    return firstFrame
  }

  if (structure.loopExtensions.length === 0) return bytes
  const removedBytes = structure.loopExtensions.reduce((total, extension) => total + extension.end - extension.start, 0)
  const playOnce = new Uint8Array(bytes.byteLength - removedBytes)
  let sourceOffset = 0
  let targetOffset = 0
  for (const extension of structure.loopExtensions) {
    const chunk = bytes.subarray(sourceOffset, extension.start)
    playOnce.set(chunk, targetOffset)
    targetOffset += chunk.byteLength
    sourceOffset = extension.end
  }
  playOnce.set(bytes.subarray(sourceOffset), targetOffset)
  return playOnce
}
