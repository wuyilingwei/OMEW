import { createApp } from 'vue'
import App from './App.vue'
import { installGifPlaybackPolicy } from './composables/useGifPlayback'
import './vendor/winui/styles/theme.css'
import './vendor/winui/styles/animations.css'
import './style/theme.css'
import './style/base.css'
import './style/forms.css'

installGifPlaybackPolicy()
createApp(App).mount('#app')
