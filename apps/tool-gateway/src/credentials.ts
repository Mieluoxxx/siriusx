/** Connector credential providers. Secrets never enter approval/audit payloads. */
export interface CredentialProvider {
  get(system: string): Promise<string | undefined>
}

export class StaticCredentialProvider implements CredentialProvider {
  readonly #values: Readonly<Record<string, string>>
  constructor(values: Readonly<Record<string, string>>) { this.#values = values }
  async get(system: string): Promise<string | undefined> { return this.#values[system] }
}

export interface HttpCredentialProviderOptions {
  readonly url: string
  readonly token: string
  readonly fetchImpl?: typeof fetch
}

/** Minimal Vault/secret-manager adapter: GET <url>/<system> with a service token. */
export class HttpCredentialProvider implements CredentialProvider {
  readonly #url: string
  readonly #token: string
  readonly #fetch: typeof fetch
  readonly #cache = new Map<string, string>()
  constructor(options: HttpCredentialProviderOptions) {
    this.#url = options.url.replace(/\/$/u, '')
    this.#token = options.token
    this.#fetch = options.fetchImpl ?? fetch
  }

  async get(system: string): Promise<string | undefined> {
    const cached = this.#cache.get(system)
    if (cached !== undefined) return cached
    const response = await this.#fetch(`${this.#url}/${encodeURIComponent(system)}`, {
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/json' },
    })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`credential manager failed for ${system}: HTTP ${response.status}`)
    const value = await response.json() as { value?: unknown; data?: { value?: unknown; data?: { value?: unknown } } }
    const secret = typeof value.value === 'string' ? value.value : typeof value.data?.value === 'string' ? value.data.value : typeof value.data?.data?.value === 'string' ? value.data.data.value : undefined
    if (secret === undefined) throw new Error(`credential manager returned no value for ${system}`)
    this.#cache.set(system, secret)
    return secret
  }
}
