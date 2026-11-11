import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PostgresStorage, SqliteStorage } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('storage boundary', () => {
  it('supports SQLite queries and rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'siriusx-storage-'))
    roots.push(root)
    const storage = new SqliteStorage(join(root, 'test.sqlite'))
    await storage.query('CREATE TABLE t (id TEXT PRIMARY KEY, value TEXT)')
    await storage.query('INSERT INTO t (id, value) VALUES (?, ?)', ['a', 'one'])
    expect((await storage.query('SELECT value FROM t WHERE id = ?', ['a'])).rows[0]).toEqual({ value: 'one' })
    await expect(storage.transaction(async tx => {
      await tx.query('INSERT INTO t (id, value) VALUES (?, ?)', ['b', 'two'])
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    expect((await storage.query('SELECT * FROM t')).rowCount).toBe(1)
    await storage.close()
  })

  const enabled = process.env.SIRIUSX_POSTGRES_TEST === '1' && process.env.DATABASE_URL !== undefined
  it.skipIf(!enabled)('supports PostgreSQL queries and rollback', async () => {
    const storage = new PostgresStorage(process.env.DATABASE_URL!)
    const table = `storage_test_${Date.now()}`
    try {
      await storage.query(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, value TEXT)`)
      await storage.query(`INSERT INTO ${table} (id, value) VALUES (?, ?)`, ['a', 'one'])
      expect((await storage.query(`SELECT value FROM ${table} WHERE id = ?`, ['a'])).rows[0]).toEqual({ value: 'one' })
      await expect(storage.transaction(async tx => {
        await tx.query(`INSERT INTO ${table} (id, value) VALUES (?, ?)`, ['b', 'two'])
        throw new Error('rollback')
      })).rejects.toThrow('rollback')
      expect((await storage.query(`SELECT * FROM ${table}`)).rowCount).toBe(1)
    } finally {
      await storage.query(`DROP TABLE IF EXISTS ${table}`)
      await storage.close()
    }
  })
})
