import { shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'

export interface CodexUsageData {
  used: number
  limit: number
  utilization: number
  resetDate: string | null
  unit: string
  fiveHourUtilization: number | null
  fiveHourResetDate: string | null
  primaryWindowMinutes: number | null
  secondaryWindowMinutes: number | null
  planType: string | null
}

export type CodexLoginStatus = 'logged-in' | 'logged-out' | 'unknown'

type JsonRpcResponse = { id?: number; result?: unknown; error?: { message?: string } }

/**
 * Codex CLI App Server の公開 JSON-RPC API を使って ChatGPT の利用枠を読む。
 *
 * 以前の実装は chatgpt.com の非公開 Web API と画面通信の傍受に依存していた。
 * analytics 画面が通信を発火しないとヘッダーを取得できず、データが断続的に
 * 消える原因になっていたため、ここでは Codex が公式に公開している
 * account/rateLimits/read だけを利用する。
 */
export class CodexFetcher {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private loginStatus: CodexLoginStatus = 'unknown'
  private logCallback: ((...args: unknown[]) => void) | null = null
  private statusChangeCallback: ((status: CodexLoginStatus) => void) | null = null

  setLogCallback(cb: (...args: unknown[]) => void): void { this.logCallback = cb }
  setStatusChangeCallback(cb: (status: CodexLoginStatus) => void): void { this.statusChangeCallback = cb }
  getLoginStatus(): CodexLoginStatus { return this.loginStatus }
  private log(...args: unknown[]): void { this.logCallback?.(...args) }

  private setStatus(status: CodexLoginStatus): void {
    if (this.loginStatus !== status) {
      this.loginStatus = status
      this.statusChangeCallback?.(status)
    }
  }

  private executable(): string {
    // npm installs the Windows CLI as codex.cmd.  Unlike POSIX executables,
    // command shims need to be launched through cmd.exe.
    return process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.cmd' : 'codex')
  }

  private async ensureServer(): Promise<void> {
    if (this.ready) return this.ready

    this.ready = new Promise<void>((resolve, reject) => {
      const inheritedPath = process.env.PATH ?? ''
      // Keep Windows' semicolon-delimited PATH intact.  Rebuilding it with
      // ':' prevented Windows from resolving codex.cmd at all.
      const path = process.platform === 'win32'
        ? inheritedPath
        : ['/opt/homebrew/bin', '/usr/local/bin', inheritedPath].filter(Boolean).join(':')
      const proc = spawn(this.executable(), ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: path },
        // codex.cmd is the standard npm shim on Windows; cmd.exe also handles
        // a user-specified executable or command name through CODEX_BIN.
        shell: process.platform === 'win32',
      })
      this.proc = proc
      const rl = createInterface({ input: proc.stdout })
      let initialized = false

      const fail = (error: Error): void => {
        if (!initialized) reject(error)
        this.rejectPending(error)
        this.proc = null
        this.ready = null
      }

      proc.once('error', (error) => fail(new Error(`Codex CLI could not start: ${error.message}`)))
      proc.once('exit', (code, signal) => {
        if (!proc.killed) fail(new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})`))
      })
      proc.stderr.on('data', (data) => this.log('codex app-server:', String(data).trim()))
      rl.on('line', (line) => this.handleMessage(line))

      this.requestRaw('initialize', {
        clientInfo: { name: 'claude_usage_hud', title: 'Claude Usage HUD', version: '1.0.1' },
      }).then(() => {
        initialized = true
        this.send({ method: 'initialized', params: {} })
        resolve()
      }).catch(fail)
    })
    return this.ready
  }

  private handleMessage(line: string): void {
    let message: JsonRpcResponse
    try { message = JSON.parse(line) as JsonRpcResponse } catch { return }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message ?? 'Codex App Server request failed'))
    else pending.resolve(message.result)
  }

  private send(message: unknown): void {
    if (!this.proc?.stdin.writable) throw new Error('Codex App Server is not running')
    this.proc.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private requestRaw(method: string, params: unknown = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex App Server timed out while calling ${method}`))
      }, 20_000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ method, id, params }) } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private async request(method: string, params: unknown = {}): Promise<unknown> {
    await this.ensureServer()
    return this.requestRaw(method, params)
  }

  private rejectPending(error: Error): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.pending.clear()
  }

  async fetchData(): Promise<CodexUsageData | null> {
    try {
      const accountResult = await this.request('account/read', { refreshToken: true }) as { account?: { type?: string; planType?: string } | null }
      if (accountResult.account?.type !== 'chatgpt') {
        this.setStatus('logged-out')
        return null
      }
      const limits = await this.request('account/rateLimits/read')
      const parsed = this.parseRateLimits(limits, accountResult.account.planType ?? null)
      this.setStatus(parsed ? 'logged-in' : 'unknown')
      return parsed
    } catch (error) {
      this.log('codex app-server fetch error:', error)
      return null
    }
  }

  private parseRateLimits(data: unknown, planType: string | null): CodexUsageData | null {
    if (!data || typeof data !== 'object') return null
    const result = data as Record<string, unknown>
    const buckets = result['rateLimitsByLimitId']
    const byId = buckets && typeof buckets === 'object' ? buckets as Record<string, unknown> : {}
    const raw = byId['codex'] ?? result['rateLimits'] ?? Object.values(byId).find(v => typeof v === 'object')
    if (!raw || typeof raw !== 'object') return null
    const bucket = raw as Record<string, unknown>
    const parseWindow = (value: unknown) => {
      if (!value || typeof value !== 'object') return null
      const window = value as Record<string, unknown>
      const utilization = Number(window['usedPercent'])
      if (!Number.isFinite(utilization)) return null
      const resetAt = Number(window['resetsAt'])
      const minutes = Number(window['windowDurationMins'])
      return {
        utilization: Math.max(0, Math.min(utilization, 100)),
        resetDate: Number.isFinite(resetAt) && resetAt > 0 ? new Date(resetAt * 1000).toISOString() : null,
        minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
      }
    }
    const primary = parseWindow(bucket['primary'])
    const secondary = parseWindow(bucket['secondary'])
    const base = secondary ?? primary
    if (!base) return null
    return {
      used: Math.round(base.utilization), limit: 100, utilization: base.utilization,
      resetDate: base.resetDate, unit: this.windowLabel(base.minutes),
      fiveHourUtilization: primary?.utilization ?? null,
      fiveHourResetDate: primary?.resetDate ?? null,
      primaryWindowMinutes: primary?.minutes ?? null,
      secondaryWindowMinutes: secondary?.minutes ?? null,
      planType,
    }
  }

  private windowLabel(minutes: number | null): string {
    if (minutes == null) return '%'
    if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
    if (minutes % 60 === 0) return `${minutes / 60}h`
    return `${minutes}m`
  }

  async showLoginWindow(): Promise<void> {
    try {
      const result = await this.request('account/login/start', {
        type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt',
      }) as { authUrl?: string }
      if (result.authUrl) await shell.openExternal(result.authUrl)
      else throw new Error('Codex App Server did not return an authentication URL')
    } catch (error) {
      this.log('codex login error:', error)
      this.setStatus('logged-out')
    }
  }

  hideLoginWindow(): void { /* Login is handled by the system browser. */ }

  destroy(): void {
    const proc = this.proc
    this.proc = null
    this.ready = null
    this.rejectPending(new Error('Codex App Server stopped'))
    if (proc && !proc.killed) proc.kill()
  }
}
