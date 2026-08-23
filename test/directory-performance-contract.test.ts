import { describe, expect, it } from 'vitest'
import api from '../server/src/api.ts?raw'
import strongholdDo from '../server/src/stronghold-do.ts?raw'

describe('directory performance projection', () => {
  it('reads cards from the D1 directory projection and only hydrates missing rows', () => {
    const start = api.indexOf('async function listPublicDirectory')
    const directory = api.slice(start, api.indexOf('\n}', start) + 2)
    expect(directory).toContain('stronghold_directory_index')
    expect(directory).toContain('stronghold_slug_index EXCEPT SELECT stronghold_id FROM stronghold_directory_index')
    expect(directory).toContain('missing.map((row) => env.STRONGHOLD_DO.getByName(row.stronghold_id).hydrateDirectoryIndex())')
    expect(directory).not.toContain('stub.listMembers()')
    expect(directory).not.toContain('stub.getConfig()')
  })

  it('updates the projection on config and membership writes and clears it on deletion', () => {
    expect(strongholdDo).toContain('async syncDirectoryIndex(config: ConfigRow)')
    expect(strongholdDo).toContain('INSERT INTO stronghold_slug_index (slug, stronghold_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
    expect(strongholdDo).toContain('await this.syncDirectoryIndex(config);')
    expect(strongholdDo).toContain('await this.syncDirectoryIndex(next);')
    expect(strongholdDo).toContain('async hydrateDirectoryIndex(): Promise<boolean>')
    expect(api).toContain('DELETE FROM stronghold_directory_index WHERE stronghold_id = ?')
  })
})
