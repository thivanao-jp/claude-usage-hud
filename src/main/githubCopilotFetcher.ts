import { exec } from 'child_process'
import { promisify } from 'util'
import { BrowserWindow } from 'electron'

const execAsync = promisify(exec)

export interface CopilotUsageData {
  used: number
  limit: number
  utilization: number  // 0-100
  resetDate: string | null
  planType: string
}

export type CopilotLoginStatus = 'logged-in' | 'logged-out' | 'unknown'

/**
 * [β] GitHub Copilot の月間リミット使用量を取得する。
 *
 * 優先順位:
 *   1. gh CLI で取得した OAuth token → GitHub REST API (copilot_internal/user)
 *   2. 隠し BrowserWindow の GitHub セッション経由での内部 API 呼び出し（フォールバック）
 *
 * NOTE: copilot_internal/user は非公式エンドポイント。API 仕様は未公開のため
 *       レスポンスフィールド名が変わった場合は null を返して graceful degradation する。
 */
export class GitHubCopilotFetcher {
  private win: BrowserWindow | null = null
  private loginStatus: CopilotLoginStatus = 'unknown'
  private cachedToken: string | null = null
  private logCallback: ((...args: unknown[]) => void) | null = null
  private statusChangeCallback: ((status: CopilotLoginStatus) => void) | null = null

  setLogCallback(cb: (...args: unknown[]) => void): void { this.logCallback = cb }
  setStatusChangeCallback(cb: (status: CopilotLoginStatus) => void): void { this.statusChangeCallback = cb }
  getLoginStatus(): CopilotLoginStatus { return this.loginStatus }

  private log(...args: unknown[]): void { this.logCallback?.(...args) }

  private setStatus(status: CopilotLoginStatus): void {
    if (this.loginStatus !== status) {
      this.loginStatus = status
      this.statusChangeCallback?.(status)
    }
  }

  private async getToken(): Promise<string | null> {
    if (this.cachedToken) return this.cachedToken
    try {
      const { stdout } = await execAsync('gh auth token', { timeout: 5000 })
      const token = stdout.trim()
      if (token) { this.cachedToken = token; return token }
    } catch {}
    return null
  }

  async fetchData(): Promise<CopilotUsageData | null> {
    // 1. gh CLI token → REST API
    const token = await this.getToken()
    if (token) {
      const result = await this.fetchViaToken(token)
      if (result !== 'auth-error') {
        return result
      }
      this.cachedToken = null
    }

    // 2. Browser session fallback
    return await this.fetchViaBrowser()
  }

  private async fetchViaToken(token: string): Promise<CopilotUsageData | null | 'auth-error'> {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }

    try {
      const res = await fetch('https://api.github.com/copilot_internal/user', { headers })
      this.log('copilot: copilot_internal/user status:', res.status)
      if (res.status === 401 || res.status === 403) {
        this.setStatus('logged-out')
        return 'auth-error'
      }
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>
        this.log('copilot: copilot_internal/user raw:', JSON.stringify(data))
        const parsed = this.parseResponse(data)
        this.setStatus('logged-in')
        return parsed  // null = logged in but no usage data in response
      }
    } catch (e) {
      this.log('copilot: fetch error:', e)
    }

    return null
  }

  private async fetchViaBrowser(): Promise<CopilotUsageData | null> {
    try {
      await this.loadGitHub()
    } catch {
      return null
    }

    const win = this.ensureWindow()

    type RawResult = { error: string } | { data: unknown }
    let raw: RawResult | null = null

    try {
      raw = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            // ログイン確認
            const meRes = await fetch('https://github.com/session', { credentials: 'include' })
            if (!meRes.ok) return { error: 'session:' + meRes.status }

            // GitHub が設定ページへの内部 XHR で使う可能性のあるエンドポイントを試行
            const endpoints = [
              'https://github.com/settings/copilot/usage.json',
              'https://github.com/github-copilot/usage',
              'https://github.com/settings/copilot/features.json',
            ]
            for (const ep of endpoints) {
              const r = await fetch(ep, { credentials: 'include', headers: { 'Accept': 'application/json' } })
              if (r.ok) {
                const d = await r.json()
                return { data: d }
              }
            }
            return { error: 'no-endpoint' }
          } catch (e) {
            return { error: String(e) }
          }
        })()
      `, true) as RawResult
    } catch {
      return null
    }

    this.log('copilot: browser raw:', JSON.stringify(raw))

    if (!raw || 'error' in raw) {
      const err = (raw as { error: string } | null)?.error ?? ''
      if (err.includes('session')) this.setStatus('logged-out')
      return null
    }

    this.setStatus('logged-in')
    return this.parseResponse((raw as { data: unknown }).data as Record<string, unknown>)
  }

  /**
   * レスポンスから使用量データを解析する。
   * フィールド名は未公開のため複数のパターンを試みる。
   */
  private parseResponse(data: Record<string, unknown>): CopilotUsageData | null {
    const limit = Number(
      data['monthly_included_requests'] ??
      data['quota_monthly'] ??
      data['monthly_quota'] ??
      data['monthly_requests_limit'] ??
      data['premium_requests_limit'] ??
      0
    )
    const used = Number(
      data['used_requests'] ??
      data['quota_used'] ??
      data['requests_used'] ??
      data['monthly_requests_used'] ??
      data['premium_requests_used'] ??
      0
    )
    const remaining = Number(
      data['remaining_requests'] ??
      data['quota_remaining'] ??
      data['premium_requests_remaining'] ??
      0
    )
    const resetDate = (
      String(data['quota_reset_at'] ?? data['reset_at'] ?? data['next_reset_at'] ?? data['billing_cycle_end'] ?? '')
    ) || null

    if (limit > 0) {
      const actualUsed = used > 0 ? used : (limit - remaining)
      return {
        used: actualUsed,
        limit,
        utilization: Math.min((actualUsed / limit) * 100, 100),
        resetDate,
        planType: String(data['copilot_plan'] ?? data['plan'] ?? 'unknown'),
      }
    }

    // limit が取れなくても used + remaining があれば計算
    if (remaining > 0 || used > 0) {
      const total = used + remaining
      if (total > 0) {
        return {
          used,
          limit: total,
          utilization: Math.min((used / total) * 100, 100),
          resetDate,
          planType: String(data['copilot_plan'] ?? 'unknown'),
        }
      }
    }

    return null
  }

  async showLoginWindow(): Promise<void> {
    const win = this.ensureWindow()
    const current = win.webContents.getURL()
    if (!current.includes('github.com')) {
      await new Promise<void>((resolve) => {
        win.webContents.once('did-finish-load', resolve)
        win.loadURL('https://github.com/login').catch(resolve)
      })
    }
    win.show()
    win.focus()
  }

  hideLoginWindow(): void { this.win?.hide() }

  private async loadGitHub(): Promise<void> {
    const win = this.ensureWindow()
    const current = win.webContents.getURL()
    if (current.includes('github.com')) return

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Load timeout')), 20000)
      win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
      win.loadURL('https://github.com').catch(reject)
    })
  }

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      title: 'GitHub',
      webPreferences: {
        partition: 'persist:github',
        nodeIntegration: false,
        contextIsolation: true,
      }
    })
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    win.on('close', (e) => { e.preventDefault(); win.hide() })
    win.on('closed', () => { this.win = null })
    return win
  }

  private ensureWindow(): BrowserWindow {
    if (!this.win || this.win.isDestroyed()) this.win = this.createWindow()
    return this.win
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners('close')
      this.win.destroy()
    }
    this.win = null
  }
}
