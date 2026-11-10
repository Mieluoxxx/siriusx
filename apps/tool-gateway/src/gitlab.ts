/** GitLab connector for the tool gateway; writes carry the gateway-held token. */
import type { ActionRequest, Connector } from './index.ts'

export interface GitLabConnectorOptions {
  readonly apiBase?: string
  readonly fetchImpl?: typeof fetch
}

function projectAndIid(target: string): { project: string; iid?: number } {
  const match = /^(?<project>[^#]+)(?:#(?<iid>\d+))?$/u.exec(target)
  if (match?.groups === undefined) throw new Error(`invalid GitLab target: ${target}`)
  return { project: match.groups.project!, ...(match.groups.iid === undefined ? {} : { iid: Number(match.groups.iid) }) }
}

export class GitLabConnector implements Connector {
  readonly #apiBase: string
  readonly #fetch: typeof fetch
  constructor(options: GitLabConnectorOptions = {}) {
    this.#apiBase = (options.apiBase ?? 'https://gitlab.com/api/v4').replace(/\/$/u, '')
    this.#fetch = options.fetchImpl ?? fetch
  }

  async execute(request: ActionRequest, credential: string | undefined): Promise<{ result: unknown }> {
    if (credential === undefined || credential === '') throw new Error('GitLab credential is not configured')
    const headers = { 'private-token': credential, 'content-type': 'application/json', accept: 'application/json' }
    const { project, iid } = projectAndIid(request.target)
    const id = encodeURIComponent(project)
    if (request.actionClass === 'read_issue') {
      if (iid === undefined) throw new Error('read_issue requires target group/project#iid')
      const response = await this.#fetch(`${this.#apiBase}/projects/${id}/issues/${iid}`, { headers })
      if (!response.ok) throw new Error(`GitLab issue read failed: HTTP ${response.status}`)
      const issue = await response.json() as { iid: number; title: string; description?: string; state: string; web_url: string }
      return { result: { provider: 'gitlab', number: issue.iid, title: issue.title, body: issue.description ?? '', state: issue.state, url: issue.web_url } }
    }
    if (request.actionClass === 'create_branch') {
      const input = JSON.parse(request.content ?? '{}') as { branch?: string; sha?: string }
      if (input.branch === undefined || input.sha === undefined) throw new Error('create_branch needs branch/sha')
      const response = await this.#fetch(`${this.#apiBase}/projects/${id}/repository/branches`, { method: 'POST', headers, body: JSON.stringify({ branch: input.branch, ref: input.sha }) })
      if (!response.ok) throw new Error(`GitLab branch creation failed: HTTP ${response.status}`)
      return { result: await response.json() }
    }
    if (request.actionClass === 'create_or_update_file') {
      const input = JSON.parse(request.content ?? '{}') as { path?: string; message?: string; content?: string; branch?: string }
      if (input.path === undefined || input.message === undefined || input.content === undefined || input.branch === undefined) throw new Error('create_or_update_file needs path/message/content/branch')
      const file = encodeURIComponent(input.path)
      const response = await this.#fetch(`${this.#apiBase}/projects/${id}/repository/files/${file}`, { method: 'POST', headers, body: JSON.stringify({ branch: input.branch, content: input.content, commit_message: input.message }) })
      if (!response.ok) throw new Error(`GitLab file write failed: HTTP ${response.status}`)
      return { result: await response.json() }
    }
    if (request.actionClass === 'open_pull_request' || request.actionClass === 'open_change_request') {
      const input = JSON.parse(request.content ?? '{}') as { head?: string; base?: string; title?: string; body?: string }
      if (input.head === undefined || input.base === undefined || input.title === undefined) throw new Error('open merge request needs head/base/title')
      const response = await this.#fetch(`${this.#apiBase}/projects/${id}/merge_requests`, {
        method: 'POST', headers, body: JSON.stringify({ source_branch: input.head, target_branch: input.base, title: input.title, description: input.body ?? '' }),
      })
      if (!response.ok) throw new Error(`GitLab merge request failed: HTTP ${response.status}`)
      const mergeRequest = await response.json() as { iid: number; web_url: string; title: string }
      return { result: { provider: 'gitlab', number: mergeRequest.iid, url: mergeRequest.web_url, title: mergeRequest.title } }
    }
    throw new Error(`GitLab connector does not implement ${request.actionClass}`)
  }
}
