import { BrowserWindow } from 'electron'

export interface CodexUsageData {
  used: number
  limit: number
  utilization: number  // 0-100
  resetDate: string | null
  unit: string  // 'tasks' | 'requests' など
}

export type CodexLoginStatus = 'logged-in' | 'logged-out' | 'unknown'

/**
 * [β] OpenAI Codex Cloud の月間リミット使用量を取得する。
 *
 * 隠し BrowserWindow で chatgpt.com セッションを維持し、
 * 内部 API エンドポイント（非公式）を呼び出す。
 *
 * NOTE: Codex の内部 API は未公開のため、エンドポイントが変わった場合は
 *       null を返して graceful degradation する。
 */
export class CodexFetcher {
  private win: BrowserWindow | null = null
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
    win.on('closed', () => { this.win = null })
    return win
  }

  private ensureWindow(): BrowserWindow {
    if (!this.win || this.win.isDestroyed()) this.win = this.createWindow()
    return this.win
  }

  private async loadChatGPT(): Promise<void> {
    const win = this.ensureWindow()
    const current = win.webContents.getURL()
    if (current.includes('chatgpt.com') || current.includes('chat.openai.com')) return

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Load timeout')), 20000)
      win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
      win.loadURL('https://chatgpt.com').catch(reject)
    })
  }

  async fetchData(): Promise<CodexUsageData | null> {
    try {
      await this.loadChatGPT()
    } catch {
      return null
    }

    const win = this.ensureWindow()

    type RawResult =
      | { error: string }
      | { endpoint: string; data: unknown }

    let raw: RawResult | null = null

    const currentUrl = win.webContents.getURL()
    this.log('codex: current page URL:', currentUrl)

    try {
      raw = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            // ログイン確認: /backend-api/me が実ユーザーデータを返すか確認
            const meRes = await fetch('/backend-api/me', { credentials: 'include' })
            if (!meRes.ok) return { error: 'not-logged-in:' + meRes.status }
            const meData = await meRes.json()
            // email または id がない場合はゲスト/未ログイン
            const userId = meData?.email || meData?.id || meData?.user_id || ''
            if (!userId) return { error: 'not-logged-in:guest' }

            // NextAuth セッションからアクセストークンを取得
            let accessToken = ''
            try {
              const sessionRes = await fetch('/api/auth/session', { credentials: 'include' })
              if (sessionRes.ok) {
                const session = await sessionRes.json()
                accessToken = session?.accessToken || session?.user?.accessToken || ''
              }
            } catch {}

            const authHeaders = accessToken
              ? { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }
              : { 'Content-Type': 'application/json' }

            // Codex 使用量エンドポイントを試行（内部 API、仕様未公開）
            const candidates = [
              '/backend-api/codex/usage',
              '/backend-api/codex/cloud/usage',
              '/api/v1/codex/cloud/usage',
              '/api/codex/usage',
              '/backend-api/limits',
            ]
            const statuses = {}
            for (const ep of candidates) {
              const r = await fetch(ep, { credentials: 'include', headers: authHeaders })
              statuses[ep] = r.status
              if (r.ok) {
                const d = await r.json()
                return { endpoint: ep, data: d }
              }
            }
            return { error: 'no-endpoint', me: userId, token: !!accessToken, statuses }
          } catch (e) {
            return { error: String(e) }
          }
        })()
      `, true) as RawResult
    } catch {
      return null
    }

    this.log('codex: raw result:', JSON.stringify(raw))

    if (!raw || 'error' in raw) {
      const err = (raw as { error: string } | null)?.error ?? ''
      if (err.includes('not-logged-in')) this.setStatus('logged-out')
      // no-endpoint = ログイン済みだがエンドポイント未発見
      if (err === 'no-endpoint' || err.startsWith('no-endpoint')) this.setStatus('logged-in')
      return null
    }

    this.setStatus('logged-in')
    const r = raw as { endpoint: string; data: unknown }
    this.log('codex: hit endpoint:', r.endpoint)
    return this.parseResponse(r.data)
  }

  /**
   * レスポンスから使用量データを解析する。
   *
   * 確認済み構造（/backend-api/codex/usage）:
   *   rate_limit.secondary_window.{used_percent, reset_at, limit_window_seconds}
   *   rate_limit.primary_window.{used_percent, reset_at} (5時間ローリング)
   *   plan_type
   */
  private parseResponse(data: unknown): CodexUsageData | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    // rate_limit 形式（確認済み: /backend-api/codex/usage）
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

    // フラットフィールド形式（将来の構造変更に備えたフォールバック）
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
    const current = win.webContents.getURL()
    if (!current.includes('chatgpt.com') && !current.includes('chat.openai.com')) {
      await new Promise<void>((resolve) => {
        win.webContents.once('did-finish-load', resolve)
        win.loadURL('https://chatgpt.com').catch(resolve)
      })
    }
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
