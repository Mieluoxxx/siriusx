/** GitHub connector for the tool gateway; all writes carry the gateway-held token. */
import type { ActionRequest, Connector } from './index.ts'

export interface GitHubConnectorOptions {
  readonly apiBase?: string
  readonly fetchImpl?: typeof fetch
}

function targetParts(target: string): { owner: string; repo: string; number?: number } {
  const match = /^(?<owner>[^/]+)\/(?<repo>[^#]+)(?:#(?<number>\d+))?$/u.exec(target)
  if (match?.groups === undefined) throw new Error(`invalid GitHub target: ${target}`)
  return {
    owner: match.groups.owner!,
    repo: match.groups.repo!,
    ...(match.groups.number === undefined ? {} : { number: Number(match.groups.number) }),
  }
}

export class GitHubConnector implements Connector {
  readonly #apiBase: string
  readonly #fetch: typeof fetch
  constructor(options: GitHubConnectorOptions = {}) {
    this.#apiBase = options.apiBase ?? 'https://api.github.com'
    this.#fetch = options.fetchImpl ?? fetch
  }

  async execute(request: ActionRequest, credential: string | undefined): Promise<{ result: unknown }> {
    if (credential === undefined || credential === '') throw new Error('GitHub credential is not configured')
    const headers = {
      authorization: `Bearer ${credential}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'siriusx-tool-gateway',
    }
    const parts = targetParts(request.target)
    if (request.actionClass === 'read_issue') {
      if (parts.number === undefined) throw new Error('read_issue requires target owner/repo#number')
      const response = await this.#fetch(`${this.#apiBase}/repos/${parts.owner}/${parts.repo}/issues/${parts.number}`, { headers })
      if (!response.ok) throw new Error(`GitHub issue read failed: HTTP ${response.status}`)
      const issue = await response.json() as { number: number; title: string; body?: string; state: string; html_url: string }
      return { result: { provider: 'github', number: issue.number, title: issue.title, body: issue.body ?? '', state: issue.state, url: issue.html_url } }
    }
    if (request.actionClass === 'open_pull_request') {
      const input = JSON.parse(request.content ?? '{}') as { head?: string; base?: string; title?: string; body?: string }
      if (input.head === undefined || input.base === undefined || input.title === undefined) throw new Error('open_pull_request needs head/base/title')
      const response = await this.#fetch(`${this.#apiBase}/repos/${parts.owner}/${parts.repo}/pulls`, {
        method: 'POST', headers, body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(`GitHub pull request failed: HTTP ${response.status}`)
      const pull = await response.json() as { number: number; html_url: string; title: string }
      return { result: { provider: 'github', number: pull.number, url: pull.html_url, title: pull.title } }
    }
    if (request.actionClass === 'create_or_update_file') {
      const input = JSON.parse(request.content ?? '{}') as { path?: string; message?: string; content?: string; branch?: string }
      if (input.path === undefined || input.message === undefined || input.content === undefined || input.branch === undefined) throw new Error('create_or_update_file needs path/message/content/branch')
      const response = await this.#fetch(`${this.#apiBase}/repos/${parts.owner}/${parts.repo}/contents/${input.path}`, {
        method: 'PUT', headers, body: JSON.stringify({ message: input.message, content: Buffer.from(input.content).toString('base64'), branch: input.branch }),
      })
      if (!response.ok) throw new Error(`GitHub file write failed: HTTP ${response.status}`)
      return { result: await response.json() }
    }
    if (request.actionClass === 'create_branch') {
      const input = JSON.parse(request.content ?? '{}') as { branch?: string; sha?: string }
      if (input.branch === undefined || input.sha === undefined) throw new Error('create_branch needs branch/sha')
      const response = await this.#fetch(`${this.#apiBase}/repos/${parts.owner}/${parts.repo}/git/refs`, {
        method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: input.sha }),
      })
      if (!response.ok) throw new Error(`GitHub branch creation failed: HTTP ${response.status}`)
      return { result: await response.json() }
    }
    throw new Error(`GitHub connector does not implement ${request.actionClass}`)
  }
}
