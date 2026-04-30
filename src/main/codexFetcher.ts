import { BrowserWindow } from 'electron'

export interface CodexUsageData {
  used: number
  limit: number
  utilization: number  // 0-100
  resetDate: string | null
  unit: string
  fiveHourUtilization: number | null
  fiveHourResetDate: string | null
}

export type CodexLoginStatus = 'logged-in' | 'logged-out' | 'unknown'

/**
 * [β] OpenAI Codex Cloud の使用量を取得する。
 *
 * chatgpt.com/codex/cloud/settings/analytics をコンテキストとして使用し、
 * /backend-api/codex/usage を呼び出す。
 * analytics ページに遷移することでセッションが有効になり、401 を回避できる。
 */
export class CodexFetcher {
  private win: BrowserWindow | null = null
  private loginStatus: CodexLoginStatus = 'unknown'
  private logCallback: ((...args: unknown[]) => void) | null = null
  private statusChangeCallback: ((status: CodexLoginStatus) => void) | null = null
  private analyticsLoaded = false

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

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      title: 'ChatGPT',
      webPreferences: {
        partition: 'persist:chatgpt',
        nodeIntegration: false,
        contextIsolation: true,
      }
    })
    win.webContents.setUserAgent(
      process.platform === 'win32'
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    win.on('close', (e) => { e.preventDefault(); win.hide() })
    win.on('closed', () => { this.win = null; this.analyticsLoaded = false })
    return win
  }

  private ensureWindow(): BrowserWindow {
    if (!this.win || this.win.isDestroyed()) this.win = this.createWindow()
    return this.win
  }

  /** analytics ページへ遷移し、実際のリクエストヘッダーを使って wham/usage を取得する */
  private async fetchViaPageIntercept(): Promise<CodexUsageData | null> {
    const win = this.ensureWindow()
    const session = win.webContents.session

    // wham/usage リクエストのヘッダーと URL を記録する
    let capturedWhamHeaders: Record<string, string> | null = null
    let capturedWhamUrl: string | null = null

    const headerHandler = (
      details: Electron.OnBeforeSendHeadersListenerDetails,
      callback: (response: Electron.CallbackResponse) => void
    ) => {
      if (details.url.includes('wham/usage') && !details.url.includes('breakdown') && !details.url.includes('daily')) {
        capturedWhamHeaders = details.requestHeaders as Record<string, string>
        capturedWhamUrl = details.url
        this.log('codex: captured wham/usage headers:', Object.keys(capturedWhamHeaders))
      }
      callback({ requestHeaders: details.requestHeaders })
    }

    session.webRequest.onBeforeSendHeaders(
      { urls: ['https://chatgpt.com/backend-api/wham/*'] },
      headerHandler
    )

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15000)
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        setTimeout(resolve, 3000)
      })
      win.loadURL('https://chatgpt.com/codex/cloud/settings/analytics').catch(() => resolve())
    })

    session.webRequest.onBeforeSendHeaders(null as unknown as Electron.OnBeforeSendHeadersListener)

    if (!capturedWhamHeaders || !capturedWhamUrl) {
      this.log('codex: wham/usage not captured')
      return null
    }

    // session.fetch() でセッションの Cookie を引き継いでリクエスト
    // capturedWhamHeaders から Authorization 等の重要ヘッダーを転送する
    try {
      // 認証に必要なヘッダーのみ転送（Sec-* 等は除外）
      const essential = ['Authorization', 'OAI-Device-Id', 'OAI-Session-Id',
        'ChatGPT-Account-ID', 'OAI-Language', 'OAI-Client-Version',
        'OAI-Client-Build-Number', 'X-OpenAI-Target-Route', 'X-OpenAI-Target-Path', 'X-OAI-IS']
      const headers: Record<string, string> = {}
      for (const key of essential) {
        const val = capturedWhamHeaders![key] ?? capturedWhamHeaders![key.toLowerCase()]
        if (val) headers[key] = Array.isArray(val) ? val[0] : String(val)
      }
      this.log('codex: using session.fetch, auth?', !!headers['Authorization'])
      const resp = await session.fetch(capturedWhamUrl!, { method: 'GET', headers })
      this.log('codex: wham/usage session.fetch status:', resp.status)
      const data = resp.ok ? await resp.json() : null

      this.log('codex: wham/usage data:', JSON.stringify(data)?.slice(0, 400))
      const parsed = this.parseWhamUsage(data)
      if (parsed) {
        this.setStatus('logged-in')
        return parsed
      }
    } catch (e) {
      this.log('codex: wham session.fetch error:', e)
    }

    return null
  }

  /** /backend-api/wham/usage のレスポンスを解析する */
  private parseWhamUsage(data: unknown): CodexUsageData | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    // wham/usage 形式: { rate_limits: { five_hour: { used_percent, reset_at }, seven_day: {...} } }
    const rateLimits = d['rate_limits'] ?? d['rate_limit']
    if (rateLimits && typeof rateLimits === 'object') {
      const rl = rateLimits as Record<string, unknown>
      const parseWin = (w: unknown) => {
        if (!w || typeof w !== 'object') return null
        const win = w as Record<string, unknown>
        const used = Number(win['used_percent'] ?? win['utilization'] ?? 0)
        const resetAt = win['reset_at'] ? Number(win['reset_at']) : 0
        return {
          utilization: Math.min(used, 100),
          resetDate: resetAt > 0 ? new Date(resetAt * 1000).toISOString() : null,
        }
      }
      // wham では five_hour / seven_day キーを使う場合がある
      const fiveHour = parseWin(rl['five_hour'] ?? rl['primary_window'] ?? rl['5h'])
      const sevenDay = parseWin(rl['seven_day'] ?? rl['secondary_window'] ?? rl['7d'])
      const base = sevenDay ?? fiveHour
      if (base) {
        return {
          used: Math.round(base.utilization),
          limit: 100,
          utilization: base.utilization,
          resetDate: base.resetDate,
          unit: sevenDay ? '7d' : '5h',
          fiveHourUtilization: fiveHour?.utilization ?? null,
          fiveHourResetDate: fiveHour?.resetDate ?? null,
        }
      }
    }
    // 既存の parseResponse でも試みる
    return this.parseResponse(data)
  }

  async fetchData(): Promise<CodexUsageData | null> {
    const interceptResult = await this.fetchViaPageIntercept()
    if (interceptResult) return interceptResult

    const win = this.ensureWindow()

    type RawResult =
      | { error: string; statuses?: Record<string, number> }
      | { endpoint: string; data: unknown }

    let raw: RawResult | null = null

    this.log('codex: page URL before fetch:', win.webContents.getURL())
    try {
      raw = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const candidates = [
              '/backend-api/wham/usage',
              '/backend-api/codex/usage',
              '/backend-api/codex/cloud/usage',
              '/backend-api/codex/cloud/rate_limit',
              '/backend-api/codex/cloud/limits',
            ]
            const statuses = {}
            for (const ep of candidates) {
              try {
                const r = await fetch(ep, { credentials: 'include' })
                statuses[ep] = r.status
                if (r.ok) {
                  const d = await r.json()
                  return { endpoint: ep, data: d }
                }
              } catch (_) {}
            }
            let me = ''
            try {
              const meRes = await fetch('/backend-api/me', { credentials: 'include' })
              if (meRes.ok) {
                const meData = await meRes.json()
                me = meData?.email || meData?.id || ''
              }
            } catch (_) {}
            return { error: 'no-endpoint', me, statuses }
          } catch (e) {
            return { error: String(e) }
          }
        })()
      `, true) as RawResult
    } catch (e) {
      this.log('codex: executeJavaScript error:', e)
      return null
    }

    this.log('codex: raw result:', JSON.stringify(raw))

    if (!raw || 'error' in raw) {
      const err = (raw as { error: string } | null)?.error ?? ''
      if (err.includes('not-logged-in')) {
        this.setStatus('logged-out')
        this.analyticsLoaded = false  // 再ロードを強制
      }
      if (err === 'no-endpoint' || err.startsWith('no-endpoint')) this.setStatus('logged-in')
      return null
    }

    this.setStatus('logged-in')
    const r = raw as { endpoint: string; data: unknown }
    this.log('codex: hit endpoint:', r.endpoint)
    return this.parseResponse(r.data)
  }

  private parseResponse(data: unknown): CodexUsageData | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    // { rate_limit: { primary_window, secondary_window } } 形式
    const rateLimit = d['rate_limit']
    if (rateLimit && typeof rateLimit === 'object') {
      const rl = rateLimit as Record<string, unknown>

      const parseWindow = (w: unknown): { utilization: number; resetDate: string | null } | null => {
        if (!w || typeof w !== 'object') return null
        const win = w as Record<string, unknown>
        const usedPct = Number(win['used_percent'] ?? 0)
        const resetAt = Number(win['reset_at'] ?? 0)
        return {
          utilization: Math.min(usedPct, 100),
          resetDate: resetAt > 0 ? new Date(resetAt * 1000).toISOString() : null,
        }
      }

      const secondary = parseWindow(rl['secondary_window'])  // 7d
      const primary   = parseWindow(rl['primary_window'])    // 5h

      const base = secondary ?? primary
      if (base) {
        return {
          used: Math.round(base.utilization),
          limit: 100,
          utilization: base.utilization,
          resetDate: base.resetDate,
          unit: secondary ? '7d' : '5h',
          fiveHourUtilization: primary?.utilization ?? null,
          fiveHourResetDate:   primary?.resetDate   ?? null,
        }
      }
    }

    // フラットフィールド形式（フォールバック）
    const src = (d['codex'] && typeof d['codex'] === 'object')
      ? d['codex'] as Record<string, unknown>
      : d
    const used = Number(src['used'] ?? src['usage'] ?? src['used_percent'] ?? 0)
    const limit = Number(src['limit'] ?? src['quota'] ?? src['monthly_limit'] ?? 0)
    const resetDate = String(src['reset_at'] ?? src['resets_at'] ?? '') || null
    const unit = String(src['unit'] ?? src['resource_type'] ?? '%')
    if (limit > 0) {
      return {
        used, limit, utilization: Math.min((used / limit) * 100, 100), resetDate, unit,
        fiveHourUtilization: null, fiveHourResetDate: null,
      }
    }
    return null
  }

  async showLoginWindow(): Promise<void> {
    const win = this.ensureWindow()
    // ログイン時は必ず chatgpt.com ルートから開始し、セッションをリセットする
    this.analyticsLoaded = false
    await new Promise<void>((resolve) => {
      win.webContents.once('did-finish-load', resolve)
      win.loadURL('https://chatgpt.com').catch(resolve)
    })
    win.show()
    win.focus()
  }

  hideLoginWindow(): void { this.win?.hide() }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners('close')
      this.win.destroy()
    }
    this.win = null
  }
}
