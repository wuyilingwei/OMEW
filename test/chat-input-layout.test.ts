import { describe, expect, it } from 'vitest'
import chatPaneSource from '../web/src/components/ChatPane.vue?raw'

describe('聊天室多行输入框布局', () => {
  it('从单行开始并按内容自动增高，达到上限后在输入框内部滚动', () => {
    expect(chatPaneSource).toContain('ref="chatInput"')
    expect(chatPaneSource).toContain('rows="1"')
    expect(chatPaneSource).toContain("input.style.height = 'auto'")
    expect(chatPaneSource).toContain('Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT)')
    expect(chatPaneSource).toContain("input.style.overflowY = input.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? 'auto' : 'hidden'")
    expect(chatPaneSource).toContain('resize: none')
  })

  it('草稿变化和发送后都会重新测量输入框，按钮不会被多行内容挤压', () => {
    expect(chatPaneSource).toContain('watch(draft, () => {')
    expect(chatPaneSource).toContain('void nextTick(resizeInput)')
    expect(chatPaneSource).toContain('@input="resizeInput"')
    expect(chatPaneSource).toContain('flex: 0 0 auto;')
  })

  it('保留 Enter 发送、Shift+Enter 换行与粘贴图片行为', () => {
    expect(chatPaneSource).toContain('@keydown.enter="onEnter"')
    expect(chatPaneSource).toContain('if (event.shiftKey) return')
    expect(chatPaneSource).toContain('@paste="onPaste"')
    expect(chatPaneSource).toContain('event.preventDefault()')
    expect(chatPaneSource).toContain('queueImages(files)')
  })
})
