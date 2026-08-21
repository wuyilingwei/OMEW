import { nextTick, onBeforeUnmount, ref, watch, type WatchSource } from 'vue'

// how far from the bottom still counts as "reading the latest" - wide enough
// to absorb fractional scrollHeight under browser zoom
const BOTTOM_THRESHOLD_PX = 48

// keeps a scroll container pinned to its newest content the way a chat log
// should: follows growth only while the reader is already at the bottom,
// re-pins after layout that lands late (images decoding, a hidden pane
// becoming visible), and holds the reader's place when older content is
// prepended above them. `contentSource` is whatever changes when the rendered
// content changes, e.g. the message count.
export function useStickyScroll(contentSource: WatchSource) {
  const el = ref<HTMLElement | null>(null)
  const stuck = ref(true)
  let resizeObserver: ResizeObserver | null = null

  function atBottom(node: HTMLElement): boolean {
    return node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_THRESHOLD_PX
  }

  function scrollToBottom() {
    const node = el.value
    if (node) node.scrollTop = node.scrollHeight
  }

  // must run before the DOM grows: once new content is in, the scroll position
  // no longer says whether the reader had been at the bottom
  function measure() {
    const node = el.value
    if (node) stuck.value = atBottom(node)
  }

  // no-op while the reader is scrolled up
  function follow() {
    if (stuck.value) scrollToBottom()
  }

  // unconditional return to the newest content, for actions the reader
  // initiated themselves (sending a message, switching rooms)
  function pin() {
    stuck.value = true
    scrollToBottom()
  }

  // an <img> load event doesn't bubble but does capture, so one listener on
  // the container catches every avatar, emote and attachment that grows the
  // content after it was already laid out
  function onLoadCapture() {
    follow()
  }

  function detach(node: HTMLElement) {
    node.removeEventListener('scroll', measure)
    node.removeEventListener('load', onLoadCapture, true)
  }

  watch(
    el,
    (node, previous) => {
      if (previous) detach(previous)
      resizeObserver?.disconnect()
      resizeObserver = null
      if (!node) return
      node.addEventListener('scroll', measure, { passive: true })
      node.addEventListener('load', onLoadCapture, true)
      // a scrollTop written while the container is display:none is silently
      // dropped (scrollHeight is 0 there). Observing the container catches the
      // 0 -> N jump when it becomes visible - on mobile the chat column is
      // hidden until its tab is active, which is exactly when history loads.
      resizeObserver = new ResizeObserver(follow)
      resizeObserver.observe(node)
      follow()
    },
    { flush: 'post' },
  )

  watch(contentSource, measure, { flush: 'pre' })
  watch(contentSource, follow, { immediate: true, flush: 'post' })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    if (el.value) detach(el.value)
  })

  // anchors on distance from the bottom, which is invariant to however much
  // content the load prepends above the reader
  async function preserveOnPrepend(load: () => Promise<void>) {
    const node = el.value
    const fromBottom = node ? node.scrollHeight - node.scrollTop : 0
    await load()
    await nextTick()
    if (node) node.scrollTop = node.scrollHeight - fromBottom
  }

  return { el, pin, preserveOnPrepend }
}
