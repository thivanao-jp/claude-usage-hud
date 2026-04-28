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

    try {
      raw = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            // ログイン確認
            const meRes = await fetch('/backend-api/me', { credentials: 'include' })
            if (!meRes.ok) return { error: 'not-logged-in:' + meRes.status }

            // Codex 使用量エンドポイントを試行（内部 API、仕様未公開）
            const candidates = [
              '/backend-api/codex/cloud/usage',
              '/backend-api/codex/usage',
              '/api/v1/codex/cloud/usage',
              '/api/codex/usage',
              '/backend-api/limits',
            ]
            for (const ep of candidates) {
              const r = await fetch(ep, { credentials: 'include' })
              if (r.ok) {
                const d = await r.json()
                return { endpoint: ep, data: d }
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

    this.log('codex: raw result:', JSON.stringify(raw))

    if (!raw || 'error' in raw) {
      const err = (raw as { error: string } | null)?.error ?? ''
      if (err.includes('not-logged-in')) this.setStatus('logged-out')
      return null
    }

    this.setStatus('logged-in')
    const r = raw as { endpoint: string; data: unknown }
    this.log('codex: hit endpoint:', r.endpoint)
    return this.parseResponse(r.data)
  }

  /**
   * レスポンスから使用量データを解析する。
   * フィールド名は未公開のため複数のパターンを試みる。
   */
  private parseResponse(data: unknown): CodexUsageData | null {
    if (!data || typeof data !== 'object') return null
    const d = data as Record<string, unknown>

    // ネストされた codex キーがある場合は展開
    const src = (d['codex'] && typeof d['codex'] === 'object')
      ? d['codex'] as Record<string, unknown>
      : d

    const used = Number(
      src['used'] ??
      src['usage'] ??
      src['tasks_used'] ??
      src['requests_used'] ??
      src['conversations_used'] ??
      0
    )
    const limit = Number(
      src['limit'] ??
      src['quota'] ??
      src['monthly_limit'] ??
      src['tasks_limit'] ??
      src['requests_limit'] ??
      0
    )
    const resetDate = (
      String(src['reset_at'] ?? src['resets_at'] ?? src['period_end'] ?? src['next_reset'] ?? '')
    ) || null
    const unit = String(src['unit'] ?? src['resource_type'] ?? 'tasks')

    if (limit > 0) {
      return {
        used,
        limit,
        utilization: Math.min((used / limit) * 100, 100),
        resetDate,
        unit,
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
