/** Docker-backed sandbox provider. Volumes survive container destruction. */
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import type { Sandbox, SandboxCreateRequest, SandboxExecOptions, SandboxExecResult, SandboxProvider } from './index.ts'

const execFileAsync = promisify(execFile)

export interface DockerSandboxProviderOptions {
  readonly dockerBin?: string
  readonly image?: string
  readonly allowlistNetwork?: string
  readonly prefix?: string
  readonly binds?: readonly { hostPath: string; containerPath: string; readOnly?: boolean }[]
  readonly memoryLimit?: string
  readonly cpuLimit?: string
  readonly pidsLimit?: number
  readonly proxyUrl?: string
  readonly addHosts?: readonly string[]
}

function safePart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

async function dockerBin(bin: string, args: readonly string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync(bin, [...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean }
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? (error instanceof Error ? error.message : String(error)),
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    }
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly #dockerBin: string
  readonly #image: string
  readonly #allowlistNetwork: string | undefined
  readonly #prefix: string
  readonly #binds: readonly { hostPath: string; containerPath: string; readOnly?: boolean }[]
  readonly #memoryLimit: string
  readonly #cpuLimit: string
  readonly #pidsLimit: number
  readonly #proxyUrl: string | undefined
  readonly #addHosts: readonly string[]

  constructor(options: DockerSandboxProviderOptions = {}) {
    this.#dockerBin = options.dockerBin ?? 'docker'
    this.#image = options.image ?? 'debian:bookworm-slim'
    this.#allowlistNetwork = options.allowlistNetwork
    this.#prefix = options.prefix ?? 'siriusx'
    this.#binds = options.binds ?? []
    this.#memoryLimit = options.memoryLimit ?? '1g'
    this.#cpuLimit = options.cpuLimit ?? '1'
    this.#pidsLimit = options.pidsLimit ?? 256
    this.#proxyUrl = options.proxyUrl
    this.#addHosts = options.addHosts ?? []
  }

  async available(): Promise<boolean> {
    return (await dockerBin(this.#dockerBin, ['info', '--format', '{{.ServerVersion}}'])).exitCode === 0
  }

  private volumeName(tenantId: string, workdirKey: string, kind: 'home' | 'work'): string {
    return `${this.#prefix}-${kind}-${safePart(`${tenantId}/${workdirKey}`)}`
  }

  async create(request: SandboxCreateRequest): Promise<Sandbox> {
    if (request.network === 'allowlist' && this.#allowlistNetwork === undefined) {
      throw new Error('allowlist network requested but no allowlistNetwork is configured')
    }
    const home = this.volumeName(request.tenantId, request.workdirKey, 'home')
    const work = this.volumeName(request.tenantId, request.workdirKey, 'work')
    for (const volume of [home, work]) {
      const created = await dockerBin(this.#dockerBin, ['volume', 'create', volume])
      if (created.exitCode !== 0) throw new Error(`docker volume create failed: ${created.stderr}`)
    }
    const container = `${this.#prefix}-${safePart(request.tenantId)}-${randomUUID().slice(0, 8)}`
    const network = request.network === 'none' ? 'none' : this.#allowlistNetwork!
    const started = await dockerBin(this.#dockerBin, [
      'run', '-d', '--name', container,
      '--network', network,
      '--memory', this.#memoryLimit,
      '--cpus', this.#cpuLimit,
      '--pids-limit', String(this.#pidsLimit),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--security-opt', 'no-new-privileges',
      ...this.#addHosts.flatMap(host => ['--add-host', host]),
      '--label', 'siriusx.managed=true',
      '--label', `siriusx.tenant=${request.tenantId}`,
      '--label', `siriusx.workdir=${request.workdirKey}`,
      '-v', `${home}:/home/siriusx`,
      '-v', `${work}:/workspace`,
      ...this.#binds.flatMap(bind => ['-v', `${bind.hostPath}:${bind.containerPath}${bind.readOnly === true ? ':ro' : ''}`]),
      '-w', '/workspace',
      request.image || this.#image,
      'sleep', 'infinity',
    ])
    if (started.exitCode !== 0) throw new Error(`docker run failed: ${started.stderr}`)
    const sandboxEnv = this.#proxyUrl === undefined ? {} : {
      HTTP_PROXY: this.#proxyUrl, HTTPS_PROXY: this.#proxyUrl, ALL_PROXY: this.#proxyUrl, NO_PROXY: '127.0.0.1,localhost',
    }
    return {
      id: container,
      workdir: '/workspace',
      exec: async (command: string, options?: SandboxExecOptions): Promise<SandboxExecResult> => {
        const env = Object.entries({ ...sandboxEnv, ...(options?.env ?? {}) }).flatMap(([key, value]) => ['-e', `${key}=${value}`])
        const result = await dockerBin(this.#dockerBin, ['exec', ...env, container, 'sh', '-lc', command], options?.timeoutMs)
        return result
      },
      copyIn: async (localPath: string, remotePath: string): Promise<void> => {
        const copied = await dockerBin(this.#dockerBin, ['cp', localPath, `${container}:${remotePath}`])
        if (copied.exitCode !== 0) throw new Error(`docker cp failed: ${copied.stderr}`)
      },
      spawn: async (command: string, args: readonly string[] = [], options?: SandboxExecOptions) => {
        const env = Object.entries({ ...sandboxEnv, ...(options?.env ?? {}) }).flatMap(([key, value]) => ['-e', `${key}=${value}`])
        const child = spawn(this.#dockerBin, ['exec', '-i', ...env, '-w', '/workspace', container, command, ...args], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        child.on('error', () => undefined)
        child.stderr?.on('data', () => undefined)
        return {
          readable: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
          writable: Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
          exited: new Promise<void>(resolve => { child.once('exit', () => resolve()) }),
          kill: () => { child.kill('SIGTERM') },
        }
      },
      destroy: async (): Promise<void> => {
        await dockerBin(this.#dockerBin, ['rm', '-f', container])
      },
    }
  }

  async removeVolumes(tenantId: string, workdirKey: string): Promise<void> {
    await dockerBin(this.#dockerBin, ['volume', 'rm', '-f', this.volumeName(tenantId, workdirKey, 'home'), this.volumeName(tenantId, workdirKey, 'work')])
  }

  /** Remove managed containers older than maxAgeMs. Returns the number removed. */
  async reapOrphans(maxAgeMs = 0): Promise<number> {
    const listed = await dockerBin(this.#dockerBin, ['ps', '-aq', '--filter', 'label=siriusx.managed=true'])
    if (listed.exitCode !== 0) throw new Error(`docker ps failed: ${listed.stderr}`)
    let removed = 0
    for (const id of listed.stdout.split('\n').map(value => value.trim()).filter(Boolean)) {
      const created = await dockerBin(this.#dockerBin, ['inspect', '--format', '{{.Created}}', id])
      const createdAt = Date.parse(created.stdout.trim())
      if (created.exitCode !== 0 || Number.isNaN(createdAt) || Date.now() - createdAt < maxAgeMs) continue
      const result = await dockerBin(this.#dockerBin, ['rm', '-f', id])
      if (result.exitCode === 0) removed++
    }
    return removed
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    await dockerBin(this.#dockerBin, ['rm', '-f', sandboxId])
  }
}
