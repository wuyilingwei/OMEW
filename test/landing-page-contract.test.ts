import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(testDir, '..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')
const hash = (relative: string) => createHash('sha256').update(readFileSync(resolve(root, relative))).digest('hex')

describe('OMEW landing page contract', () => {
  const app = read('web/src/App.vue')

  it('keeps the landing page at the unauthenticated root and scopes route setup to the shell', () => {
    expect(app).toMatch(/import\s+LandingPage\s+from\s+["']\.\/components\/LandingPage\.vue/)
    expect(app).toMatch(/<LandingPage\b/)
    expect(app).toMatch(/useRoute\s*\(/)
    expect(app).toMatch(/auth\.isAuthenticated\.value/)
    expect(app).toMatch(/allow_guest_browsing/)
    expect(app).toMatch(/<AuthModal\b/)
    expect(app).not.toMatch(/<AuthModal\b[^>]*(?:v-if|v-else|v-else-if)=/)
    expect(app).toMatch(/(?:showLanding|landing|isAuthenticated|allow_guest_browsing)[\s\S]{0,500}useRoute\s*\(/)
  })

  it('defines the landing-page visual and interaction vocabulary', () => {
    const landing = read('web/src/components/LandingPage.vue')
    expect(landing).toMatch(/HOME_WORLD/)
    expect(landing).toMatch(/(?:favicon\.svg|OMEW Logo)/)
    expect(landing).toMatch(/WinButton/)
    expect(landing).toMatch(/@Click=/)
    expect(landing).toMatch(/(?:登录|注册)/)
    expect(landing).toMatch(/allow_guest_browsing/)
    expect(landing).toMatch(/浏览公开据点/)
    expect(landing).toMatch(/(?:@enter|enter\s*\()/)
    expect(landing).not.toMatch(/mew-fg|Mew Online/)
  })

  it('contains desktop/narrow-screen and reduced-motion presentation contracts', () => {
    const landing = read('web/src/components/LandingPage.vue')
    expect(landing).toMatch(/@media\s*\([^)]*(?:max-width|min-width)/)
    expect(landing).toMatch(/prefers-reduced-motion\s*:\s*reduce/)
  })

  it('keeps the duplicated home-world asset byte-identical and exports it', () => {
    expect(existsSync(resolve(root, 'assets/mew/home-world.jpg'))).toBe(true)
    expect(existsSync(resolve(root, 'web/src/assets/mew/home-world.jpg'))).toBe(true)
    expect(hash('assets/mew/home-world.jpg')).toBe(hash('web/src/assets/mew/home-world.jpg'))
    expect(read('web/src/assets/mew/index.ts')).toMatch(/(?:import\s+HOME_WORLD|export\s+\{?\s*HOME_WORLD|export\s+const\s+HOME_WORLD)/)
  })

  it('records the updated official Mew artwork count', () => {
    expect(read('assets/mew/NOTICE.md')).toMatch(/官方插画（110 张/)
  })
})
