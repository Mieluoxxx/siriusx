/** Minimal asynchronous storage boundary for SQLite and PostgreSQL. */
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: Row[]
  readonly rowCount: number
}

export interface Storage {
  readonly kind: 'sqlite' | 'postgres'
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<QueryResult<Row>>
  transaction<T>(operation: (storage: Storage) => Promise<T>): Promise<T>
  close(): Promise<void>
  listen?(channel: string, handler: () => void): Promise<() => Promise<void>>
}

function isRead(sql: string): boolean {
  return /^\s*(?:select|with|pragma|explain)\b/iu.test(sql)
}

export class SqliteStorage implements Storage {
  readonly kind = 'sqlite' as const
  readonly #db: DatabaseSync

  constructor(path: string) {
    this.#db = new DatabaseSync(path)
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> {
    const values = parameters as never[]
    if (isRead(sql)) {
      const rows = this.#db.prepare(sql).all(...values) as Row[]
      return { rows, rowCount: rows.length }
    }
    const result = this.#db.prepare(sql).run(...values)
    return { rows: [], rowCount: Number(result.changes) }
  }

  async transaction<T>(operation: (storage: Storage) => Promise<T>): Promise<T> {
    this.#db.exec('BEGIN')
    try {
      const value = await operation(this)
      this.#db.exec('COMMIT')
      return value
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  async close(): Promise<void> { this.#db.close() }
}

/** Convert the app's portable `?` placeholders to PostgreSQL `$n` placeholders. */
export function postgresPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/gu, () => `$${++index}`)
}

class PostgresTransaction implements Storage {
  readonly kind = 'postgres' as const
  readonly #client: pg.PoolClient

  constructor(client: pg.PoolClient) { this.#client = client }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> {
    const result = await this.#client.query(postgresPlaceholders(sql), parameters as never[])
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 }
  }

  async transaction<T>(): Promise<T> {
    throw new Error('nested PostgreSQL transactions are not supported')
  }

  async close(): Promise<void> {}
}

export class PostgresStorage implements Storage {
  readonly kind = 'postgres' as const
  readonly #pool: pg.Pool

  constructor(connectionString: string) {
    this.#pool = new pg.Pool({ connectionString, max: 10 })
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []): Promise<QueryResult<Row>> {
    const result = await this.#pool.query(postgresPlaceholders(sql), parameters as never[])
    return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 }
  }

  async transaction<T>(operation: (storage: Storage) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect()
    try {
      await client.query('BEGIN')
      const value = await operation(new PostgresTransaction(client))
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async listen(channel: string, handler: () => void): Promise<() => Promise<void>> {
    if (!/^[a-z_][a-z0-9_]*$/u.test(channel)) throw new Error('invalid PostgreSQL channel')
    const client = await this.#pool.connect()
    client.on('notification', message => { if (message.channel === channel) handler() })
    await client.query(`LISTEN "${channel}"`)
    return async () => {
      await client.query(`UNLISTEN "${channel}"`).catch(() => undefined)
      client.removeAllListeners('notification')
      client.release()
    }
  }

  async close(): Promise<void> { await this.#pool.end() }
}
