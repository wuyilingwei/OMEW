# 聊天输入适配调研

- `ChatPane.vue` 已使用 `textarea rows="1"` 和 `resize: none`，但没有根据内容调整高度；现有 `max-height: 140px` 只限制 CSS 盒子，超出内容未明确内部滚动。
- 输入事件应覆盖 v-model 更新后的 DOM 测量；发送、表情快捷发送和图片发送都可能清空草稿，因此统一调用重置逻辑。
- 采用 `scrollHeight` 与 `Math.min` 测量高度；达到 140px 后将 `overflow-y` 切换为 `auto`，否则隐藏滚动条，避免输入框出现拖动手柄。
