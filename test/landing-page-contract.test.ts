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

  it('loads the public directory directly below the hero and covers its complete states', () => {
    expect(landing).toMatch(/useStronghold\s*\(\)/)
    expect(landing).toMatch(/publicDirectory:\s*entries/)
    expect(landing).toMatch(/loadPublicDirectory/)
    expect(landing).not.toMatch(/api\.getDirectory\s*\(\)/)
    expect(landing).toContain('正在加载公开据点')
    expect(landing).toContain('无法加载据点目录')
    expect(landing).toContain('还没有公开据点')
    expect(landing).toMatch(/v-for="entry in entries"/)
    expect(landing).toContain('entry.cover')
    expect(landing).toContain('entry.description')
    expect(landing).toContain('entry.member_count')
    expect(landing).toMatch(/class="landing-directory-card"[\s\S]*@click="emit\('browse', entry\.id\)"/)
  })

  it('owns vertical scrolling because the application shell clips document overflow', () => {
    expect(landing).toMatch(/\.landing-page\s*\{(?=[\s\S]*?height:\s*100%)(?=[\s\S]*?overflow-y:\s*auto)(?=[\s\S]*?overflow-x:\s*hidden)/)
  })

  it('passes the clicked stronghold id into route installation so the chosen card is selected', () => {
    expect(app).toMatch(/function\s+installRoute\s*\(strongholdId\?\s*:\s*string\)/)
    expect(app).toMatch(/if\s*\(strongholdId\)\s*selectNode\(strongholdId\)/)
    expect(app).toMatch(/const\s*\{[^}]*selectNode[^}]*\}\s*=\s*useStronghold\s*\(\)/)
  })

  it('keeps every homepage directory avatar in a non-shrinking square crop', () => {
    expect(landing).toMatch(/\.landing-directory-card__avatar\s*\{(?=[\s\S]*?aspect-ratio:\s*1)(?=[\s\S]*?flex-shrink:\s*0)/)
    expect(landing).toMatch(/\.landing-directory-card__avatar img\s*\{[\s\S]*object-fit:\s*cover/)
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
