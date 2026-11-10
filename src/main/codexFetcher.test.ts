import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { CodexFetcher } from './codexFetcher'
import { CodexCliNotFoundError } from './codexCommand'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), openExternal: vi.fn(), command: vi.fn() }))
vi.mock('electron', () => ({ app: { getVersion: () => '1.2.6' }, shell: { openExternal: mocks.openExternal } }))
vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./codexCommand', async importOriginal => ({
  ...await importOriginal<typeof import('./codexCommand')>(), codexCommand: mocks.command,
}))

type Request = { id: number; method: string; params?: unknown }
class FakeServer extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  killed = false
  requests: Request[] = []
  respond: (request: Request) => void = request => {
    if (request.method === 'initialize') this.reply(request.id, {})
    if (request.method === 'account/login/start') this.reply(request.id, { loginId: 'login-1', authUrl: 'https://example.test/login' })
  }
  constructor() {
    super()
    this.stdin.on('data', data => {
      const request = JSON.parse(String(data)) as Request
      this.requests.push(request)
      this.respond(request)
    })
  }
  reply(id: number, result: unknown) { this.stdout.write(JSON.stringify({ id, result }) + '\n') }
  notify(params: unknown) { this.stdout.write(JSON.stringify({ method: 'account/login/completed', params }) + '\n') }
  kill() { this.killed = true; return true }
}

describe('Codex login lifecycle', () => {
  let server: FakeServer
  let fetcher: CodexFetcher
  beforeEach(() => {
    vi.resetAllMocks()
    server = new FakeServer()
    fetcher = new CodexFetcher()
    mocks.command.mockReturnValue({ command: 'codex', args: ['app-server'], env: {} })
    mocks.spawn.mockReturnValue(server)
    mocks.openExternal.mockResolvedValue(undefined)
  })
  afterEach(() => { fetcher.destroy(); vi.useRealTimers() })

  it('shows an actionable missing-CLI failure and preserves its message in the log', async () => {
    const log = vi.fn()
    fetcher.setLogCallback(log)
    mocks.command.mockImplementation(() => { throw new CodexCliNotFoundError('Codex CLI was not found') })
    expect(await fetcher.showLoginWindow()).toMatchObject({ phase: 'error', error: { code: 'cli-not-found', message: 'Codex CLI was not found' } })
    expect(log).toHaveBeenCalledWith('codex login error:', 'Codex CLI was not found')
    expect(mocks.openExternal).not.toHaveBeenCalled()
    // A failed synchronous command resolution must not poison subsequent attempts.
    mocks.command.mockImplementation(() => ({ command: 'codex', args: ['app-server'], env: {} }))
    expect((await fetcher.showLoginWindow()).phase).toBe('waiting')
  })

  it('opens the browser, correlates login completion, and publishes status changes', async () => {
    const changed = vi.fn()
    fetcher.setAuthChangeCallback(changed)
    expect((await fetcher.showLoginWindow()).phase).toBe('waiting')
    expect(mocks.openExternal).toHaveBeenCalledWith('https://example.test/login')
    server.notify({ loginId: 'stale-login', success: true })
    expect(fetcher.getLoginStatus()).toBe('unknown')
    server.notify({ loginId: 'login-1', success: true })
    expect(fetcher.getAuthState()).toEqual({ status: 'logged-in', phase: 'complete', error: null })
    expect(changed).toHaveBeenLastCalledWith(fetcher.getAuthState())
  })

  it('reopens an outstanding login without starting another flow', async () => {
    await fetcher.showLoginWindow()
    await fetcher.showLoginWindow()
    expect(server.requests.filter(r => r.method === 'account/login/start')).toHaveLength(1)
    expect(mocks.openExternal).toHaveBeenCalledTimes(2)
  })

  it('coalesces repeated clicks while starting and does not overwrite fast completion', async () => {
    mocks.openExternal.mockImplementation(async () => server.notify({ loginId: 'login-1', success: true }))
    const one = fetcher.showLoginWindow()
    const two = fetcher.showLoginWindow()
    expect(one).toBe(two)
    expect((await one).phase).toBe('complete')
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('reports browser and authentication failures separately', async () => {
    mocks.openExternal.mockRejectedValueOnce(new Error('No default browser'))
    expect(await fetcher.showLoginWindow()).toMatchObject({ phase: 'error', error: { code: 'browser', message: 'No default browser' } })
    await fetcher.showLoginWindow()
    server.notify({ loginId: 'login-1', success: false, error: 'Login expired' })
    expect(fetcher.getAuthState()).toMatchObject({ phase: 'error', status: 'logged-out', error: { code: 'login', message: 'Login expired' } })
  })

  it('cleans up a timed-out initialization and allows a retry', async () => {
    vi.useFakeTimers()
    server.respond = () => {}
    const attempt = fetcher.showLoginWindow()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await attempt).toMatchObject({ phase: 'error', error: { code: 'server', message: expect.stringContaining('initialize') } })
    expect(server.killed).toBe(true)
    const replacement = new FakeServer()
    mocks.spawn.mockReturnValue(replacement)
    expect((await fetcher.showLoginWindow()).phase).toBe('waiting')
    // A late exit from the old process must not tear down the replacement.
    server.killed = false
    server.emit('exit', 1, null)
    expect(fetcher.getAuthState().phase).toBe('waiting')
    expect(replacement.killed).toBe(false)
  })

  it('reports an App Server exit while waiting for authentication', async () => {
    await fetcher.showLoginWindow()
    server.emit('exit', 1, null)
    expect(fetcher.getAuthState()).toMatchObject({ phase: 'error', error: { code: 'server', message: expect.stringContaining('exited') } })
  })

  it('reports spawn errors and invalid login responses without opening a browser', async () => {
    mocks.spawn.mockImplementationOnce(() => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) })
    expect(await fetcher.showLoginWindow()).toMatchObject({ error: { code: 'cli-not-found' } })
    server.respond = r => server.reply(r.id, {})
    expect(await fetcher.showLoginWindow()).toMatchObject({ error: { code: 'server' } })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('handles an asynchronous spawn error and an initialization RPC error', async () => {
    server.respond = r => {
      if (r.method === 'initialize') server.emit('error', new Error('Access denied'))
    }
    expect(await fetcher.showLoginWindow()).toMatchObject({ error: { code: 'server', message: expect.stringContaining('Access denied') } })
    const replacement = new FakeServer()
    replacement.respond = r => replacement.stdout.write(JSON.stringify({ id: r.id, error: { message: 'Unsupported initialize' } }) + '\n')
    mocks.spawn.mockReturnValue(replacement)
    expect(await fetcher.showLoginWindow()).toMatchObject({ error: { code: 'server', message: 'Unsupported initialize' } })
    expect(replacement.killed).toBe(true)
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('handles stdin failure during a pending login and ignores non-object output', async () => {
    server.respond = r => {
      if (r.method === 'initialize') server.reply(r.id, {})
      if (r.method === 'account/login/start') server.stdin.emit('error', new Error('write EPIPE'))
    }
    expect(await fetcher.showLoginWindow()).toMatchObject({ error: { code: 'server', message: expect.stringContaining('EPIPE') } })
    expect(() => (fetcher as any).handleMessage('null')).not.toThrow()
  })
})

describe('Codex App Server rate-limit parsing', () => {
  it('parses official primary/secondary windows and earned reset credits', () => {
    const fetcher = new CodexFetcher()
    const parsed = (fetcher as any).parseRateLimits({
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 42, windowDurationMins: 10_080, resetsAt: 1_800_604_800 },
          credits: { hasCredits: true, balance: '220.5', unlimited: false },
        },
      },
      rateLimitResetCredits: { availableCount: 2, credits: [] },
    }, 'plus')

    expect(parsed.fiveHourUtilization).toBe(25)
    expect(parsed.primaryWindowMinutes).toBe(300)
    expect(parsed.utilization).toBe(42)
    expect(parsed.secondaryWindowMinutes).toBe(10_080)
    expect(parsed.creditBalance).toBe(220.5)
    expect(parsed.rateLimitResetCreditsAvailable).toBe(2)
    expect(parsed.pace).toBeNull()
  })
})
