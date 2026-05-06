import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { BrowserWindow } from 'electron'

const QUOTA_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GEMINI_HOME = join(homedir(), '.gemini')

/**
 * Gemini CLI のバンドルファイルから OAuth クライアント情報を動的に読み取る。
 * これにより本リポジトリにシークレットをハードコードせずに済む。
 */
function loadGeminiOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  try {
    // gemini コマンドのパスを解決
    let geminiBin: string
    try {
      geminiBin = execSync('which gemini', { timeout: 3000 }).toString().trim()
    } catch {
      return null
    }
    if (!geminiBin || !existsSync(geminiBin)) return null

    // バンドルディレクトリ (bin/../lib/node_modules/...) を探す
    const binDir = join(geminiBin, '..')
    const bundleSearchPaths = [
      join(binDir, '..', 'lib', 'node_modules', '@google', 'gemini-cli', 'bundle'),
      join(binDir, '..', '..', 'lib', 'node_modules', '@google', 'gemini-cli', 'bundle'),
    ]

    for (const bundleDir of bundleSearchPaths) {
      if (!existsSync(bundleDir)) continue
      // OAUTH_CLIENT_ID と OAUTH_CLIENT_SECRET を含むチャンクを探す
      const { readdirSync } = require('fs') as typeof import('fs')
      const files = readdirSync(bundleDir).filter((f: string) => f.endsWith('.js'))
      for (const file of files) {
        const content = readFileSync(join(bundleDir, file), 'utf-8')
        const idMatch = content.match(/OAUTH_CLIENT_ID\s*=\s*["']([^"']+\.apps\.googleusercontent\.com)["']/)
        const secretMatch = content.match(/OAUTH_CLIENT_SECRET\s*=\s*["']([^"']+)["']/)
        if (idMatch && secretMatch) {
          return { clientId: idMatch[1], clientSecret: secretMatch[1] }
        }
      }
    }
  } catch {
    // ignore
  }
  return null
}

export interface GeminiModelData {
  remainingPct: number   // 0–100 remaining
  resetTime: string | null
}

export interface GeminiUsageData {
  pro: GeminiModelData | null    // gemini-2.5-pro
  flash: GeminiModelData | null  // gemini-2.5-flash
}

export type GeminiLoginStatus = 'logged-in' | 'logged-out' | 'unknown'

interface QuotaBucket {
  modelId: string
  remainingFraction: number
  resetTime?: string
}

/**
 * [β] Google Gemini CLI の残量クォータを取得する。
 *
 * ~/.gemini/oauth_creds.json の refresh_token を使って
 * cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota を呼び出す。
 * Gemini CLI (v0.41+) がインストール・ログイン済みであることが前提。
 *
 * NOTE: cloudcode-pa の v1internal は非公式エンドポイント。
 *       API 仕様が変わった場合は null を返して graceful degradation する。
 */
export class GeminiFetcher {
  private loginStatus: GeminiLoginStatus = 'unknown'
  private logCallback: ((...args: unknown[]) => void) | null = null
  private statusChangeCallback: ((status: GeminiLoginStatus) => void) | null = null
  private helpWin: BrowserWindow | null = null

  setLogCallback(cb: (...args: unknown[]) => void): void { this.logCallback = cb }
  setStatusChangeCallback(cb: (status: GeminiLoginStatus) => void): void {
    this.statusChangeCallback = cb
  }
  getLoginStatus(): GeminiLoginStatus { return this.loginStatus }

  private log(...args: unknown[]): void { this.logCallback?.(...args) }

  private setStatus(status: GeminiLoginStatus): void {
    if (this.loginStatus !== status) {
      this.loginStatus = status
      this.statusChangeCallback?.(status)
    }
  }

  private getRefreshToken(): string | null {
    try {
      const credsPath = join(GEMINI_HOME, 'oauth_creds.json')
      if (!existsSync(credsPath)) return null
      const creds = JSON.parse(readFileSync(credsPath, 'utf-8')) as Record<string, unknown>
      return (creds['refresh_token'] as string) ?? null
    } catch {
      return null
    }
  }

  private getProjectId(): string {
    try {
      const projectsPath = join(GEMINI_HOME, 'projects.json')
      if (!existsSync(projectsPath)) return 'default'
      const data = JSON.parse(readFileSync(projectsPath, 'utf-8')) as {
        projects?: Record<string, string>
      }
      const projects = data.projects ?? {}
      const home = homedir()
      return projects[home] ?? Object.values(projects)[0] ?? 'default'
    } catch {
      return 'default'
    }
  }

  private async refreshAccessToken(): Promise<string | null> {
    const refreshToken = this.getRefreshToken()
    if (!refreshToken) return null

    const creds = loadGeminiOAuthCredentials()
    if (!creds) {
      this.log('gemini: could not load OAuth credentials from Gemini CLI bundle')
      return null
    }

    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        this.log('gemini: token refresh failed:', res.status)
        return null
      }
      const data = await res.json() as Record<string, unknown>
      return (data['access_token'] as string) ?? null
    } catch (e) {
      this.log('gemini: token refresh error:', e)
      return null
    }
  }

  async fetchData(): Promise<GeminiUsageData | null> {
    const accessToken = await this.refreshAccessToken()
    if (!accessToken) {
      this.setStatus('logged-out')
      return null
    }

    const projectId = this.getProjectId()
    try {
      const res = await fetch(QUOTA_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(10000),
      })
      this.log('gemini: quota API status:', res.status)
      if (!res.ok) {
        this.setStatus(res.status === 401 || res.status === 403 ? 'logged-out' : 'unknown')
        return null
      }
      const data = await res.json() as { buckets?: QuotaBucket[] }
      this.log('gemini: quota buckets:', JSON.stringify(data.buckets))
      this.setStatus('logged-in')
      return this.parseBuckets(data.buckets ?? [])
    } catch (e) {
      this.log('gemini: fetch error:', e)
      return null
    }
  }

  private parseBuckets(buckets: QuotaBucket[]): GeminiUsageData {
    const find = (id: string): GeminiModelData | null => {
      const b = buckets.find(b => b.modelId === id)
      if (!b) return null
      return {
        remainingPct: Math.round(b.remainingFraction * 100),
        resetTime: b.resetTime ?? null,
      }
    }
    return {
      pro: find('gemini-2.5-pro'),
      flash: find('gemini-2.5-flash'),
    }
  }

  /** Gemini auth は CLI ベースのため、使い方を説明するウィンドウを表示する */
  async showLoginWindow(): Promise<void> {
    if (this.helpWin && !this.helpWin.isDestroyed()) {
      this.helpWin.show()
      this.helpWin.focus()
      return
    }
    const win = new BrowserWindow({
      width: 500,
      height: 340,
      title: 'Gemini CLI Auth',
      resizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 28px 32px;
         background: #1a1a2e; color: #e0e0e0; margin: 0; }
  h2   { color: #4fc3f7; margin: 0 0 14px; font-size: 17px; }
  p    { margin: 0 0 12px; line-height: 1.6; font-size: 13px; }
  pre  { background: #0d0d1a; padding: 10px 14px; border-radius: 6px;
         color: #80deea; font-size: 15px; margin: 0 0 14px; }
  .note { color: #aaa; font-size: 11px; }
</style>
</head>
<body>
<h2>Gemini CLI 認証 / Gemini CLI Auth</h2>
<p>Gemini CLI のログイン情報（<code>~/.gemini/oauth_creds.json</code>）を使用します。<br>
まだ認証していない場合は、ターミナルで以下を実行してください:</p>
<pre>gemini</pre>
<p>ブラウザが開いてGoogleアカウントへのログインを求められます。<br>
ログイン完了後、このアプリを再起動するか更新してください。</p>
<p class="note">※ 認証済みの場合は自動で検出されます。このウィンドウは閉じて構いません。</p>
</body>
</html>`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    win.show()
    this.helpWin = win
    win.on('closed', () => { this.helpWin = null })
  }

  hideLoginWindow(): void { this.helpWin?.hide() }

  destroy(): void {
    if (this.helpWin && !this.helpWin.isDestroyed()) {
      this.helpWin.removeAllListeners()
      this.helpWin.destroy()
    }
    this.helpWin = null
  }
}
