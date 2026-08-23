import { describe, expect, it } from 'vitest'
import assetNotice from '../assets/mew/NOTICE.md?raw'
import app from '../web/src/App.vue?raw'
import assetIndex from '../web/src/assets/mew/index.ts?raw'
import landing from '../web/src/components/LandingPage.vue?raw'

describe('OMEW landing page contract', () => {
  it('keeps the landing page at the unauthenticated root and scopes route setup to the shell', () => {
    expect(app).toMatch(/import\s+LandingPage\s+from\s+["']\.\/components\/LandingPage\.vue/)
    expect(app).toMatch(/<LandingPage\b/)
    expect(app).toMatch(/useRoute\s*\(/)
    expect(app).toMatch(/auth\.isAuthenticated\.value/)
    expect(app).toMatch(/guestBrowsingAllowed|guest-browsing-allowed/)
    expect(app).toMatch(/<AuthModal\b/)
    expect(app).not.toMatch(/<AuthModal\b[^>]*(?:v-if|v-else|v-else-if)=/)
    expect(app).toMatch(/routeInstalled/)
    expect(app).toMatch(/routeInstalled[\s\S]{0,500}auth\.isAuthenticated\.value[\s\S]{0,160}location\.pathname\s*!==\s*['"]\//)
    expect(app).toMatch(/routeInstalled[\s\S]{0,500}useRoute\s*\(/)
  })

  it('defines the landing-page visual and interaction vocabulary', () => {
    expect(landing).toMatch(/HOME_WORLD/)
    expect(landing).toMatch(/(?:favicon\.svg|OMEW Logo)/)
    expect(landing).toMatch(/WinButton/)
    expect(landing).toMatch(/@Click=/)
    expect(landing).toMatch(/(?:登录|注册)/)
    expect(landing).toMatch(/guestBrowsingAllowed|guest-browsing-allowed/)
    expect(landing).toMatch(/浏览公开据点/)
    expect(landing).toMatch(/emit\(['"]authenticate['"]\)/)
    expect(landing).toMatch(/emit\(['"]browse['"]\)/)
    expect(landing).not.toMatch(/mew-fg|Mew Online/)
  })

  it('contains desktop/narrow-screen and reduced-motion presentation contracts', () => {
    expect(landing).toMatch(/@media\s*\([^)]*(?:max-width|min-width)/)
    expect(landing).toMatch(/prefers-reduced-motion\s*:\s*reduce/)
  })

  it('bundles and exports the licensed home-world asset', () => {
    expect(assetIndex).toContain("import homeWorldUrl from './home-world.jpg'")
    expect(assetIndex).toContain('export const HOME_WORLD = homeWorldUrl')
  })

  it('records the updated official Mew artwork count', () => {
    expect(assetNotice).toMatch(/官方插画（110 张/)
    expect(assetNotice).toContain('官方客户端与站点资源')
  })
})
