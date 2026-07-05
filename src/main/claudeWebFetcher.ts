import { BrowserWindow } from 'electron'
import { UsageData, ProfileData } from './claudeApi'

export type LoginStatus = 'logged-in' | 'logged-out' | 'unknown'

export interface WebFetchResult {
  usage: UsageData | null
  profile: ProfileData | null
  loginStatus: LoginStatus
}

/**
 * 非表示の BrowserWindow を使い、claude.ai の内部 API から使用量データを取得する。
 * Electron の Chromium セッション（persist:claude-ai）でログイン状態を保持するため、
 * OAuth API のレートリミットを回避できる。
 */
export class ClaudeWebFetcher {
  private win: BrowserWindow | null = null
  private loginStatus: LoginStatus = 'unknown'
  private orgUuid: string | null = null
  private statusChangeCallback: ((status: LoginStatus) => void) | null = null
  private orgUuidChangedCallback: ((uuid: string) => void) | null = null
  private logCallback: ((...args: unknown[]) => void) | null = null
  private rawUsageLoggedOnce = false
  private loggedUnknownModelNames = new Set<string>()

  setStatusChangeCallback(cb: (status: LoginStatus) => void): void {
    this.statusChangeCallback = cb
  }

  setOrgUuidChangedCallback(cb: (uuid: string) => void): void {
    this.orgUuidChangedCallback = cb
  }

  setInitialOrgUuid(uuid: string | null): void {
    this.orgUuid = uuid
  }

  setLogCallback(cb: (...args: unknown[]) => void): void {
    this.logCallback = cb
  }

  private log(...args: unknown[]): void {
    this.logCallback?.(...args)
  }

  private setLoginStatus(status: LoginStatus): void {
    if (this.loginStatus !== status) {
      this.loginStatus = status
      this.statusChangeCallback?.(status)
    }
  }

  getLoginStatus(): LoginStatus {
    return this.loginStatus
  }

  private createWindow(): BrowserWindow {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      title: 'Claude.ai',
      webPreferences: {
        partition: 'persist:claude-ai',
        nodeIntegration: false,
        contextIsolation: true,
      }
    })

    // Cloudflare の bot 判定を回避するため UA から "Electron" を除去
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/131.0.0.0 Safari/537.36'
    )

    // ログイン後の自動非表示: did-finish-load を使うと Google OAuth のリダイレクト後も確実に捕捉できる
    win.webContents.on('did-finish-load', () => {
      const url = win.webContents.getURL()
      if (url.includes('claude.ai') && !url.includes('/login') && !url.includes('/auth')) {
        this.checkAndAutoHide().catch(() => {})
      } else if (url.includes('/login') || url.includes('/auth')) {
        this.setLoginStatus('logged-out')
      }
    })

    // × ボタンで閉じられたら hide（セッション保持のため destroy しない）
    win.on('close', (e) => {
      e.preventDefault()
      win.hide()
    })

    win.on('closed', () => { this.win = null })

    return win
  }

  private ensureWindow(): BrowserWindow {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.createWindow()
    }
    return this.win
  }

  private async loadClaudeAi(): Promise<void> {
    const win = this.ensureWindow()
    const current = win.webContents.getURL()
    if (current.includes('claude.ai')) return  // すでに読み込み済み

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Load timeout')), 20000)
      win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
      win.loadURL('https://claude.ai').catch(reject)
    })
  }

  /** ログイン確認 → ログイン済みなら非表示に戻す */
  private async checkAndAutoHide(): Promise<void> {
    const status = await this.fetchLoginStatus()
    if (status === 'logged-in' && this.win?.isVisible()) {
      setTimeout(() => this.win?.hide(), 800)
    }
  }

  /** ログイン状態のみを確認（軽量チェック） */
  async fetchLoginStatus(): Promise<LoginStatus> {
    const win = this.ensureWindow()
    const current = win.webContents.getURL()
    if (!current.includes('claude.ai')) {
      // まだ claude.ai を読み込んでいないので確認不可
      return 'unknown'
    }

    try {
      const status: number = await win.webContents.executeJavaScript(`
        fetch('/api/organizations', { credentials: 'include' })
          .then(r => r.status)
          .catch(() => 0)
      `, true)

      const result: LoginStatus = status === 200 ? 'logged-in'
        : (status === 401 || status === 403) ? 'logged-out'
        : 'unknown'
      this.setLoginStatus(result)
      return result
    } catch {
      return 'unknown'
    }
  }

  /**
   * claude.ai から使用量データを取得する。
   * 初回呼び出し時に claude.ai を非表示で読み込む。
   */
  async fetchData(): Promise<WebFetchResult> {
    const empty: WebFetchResult = { usage: null, profile: null, loginStatus: this.loginStatus }

    try {
      await this.loadClaudeAi()
    } catch {
      return empty
    }

    const win = this.ensureWindow()

    type RawResult =
      | { error: number | string }
      | { orgUuid: string; usage: unknown; account: unknown }

    let raw: RawResult | null = null

    const cachedUuid = this.orgUuid

    try {
      raw = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            let orgUuid = ${JSON.stringify(cachedUuid)};
            let account = null;

            // キャッシュ済み orgUuid がある場合は /api/organizations をスキップして直接 usage を取得
            if (orgUuid) {
              const usageRes = await fetch('/api/organizations/' + orgUuid + '/usage', { credentials: 'include' });
              if (usageRes.ok) {
                const usage = await usageRes.json();
                return { orgUuid, usage, account: null };
              }
              // 401/403/404 なら orgUuid が無効と判断してリセット → /api/organizations から再取得
              if (usageRes.status === 401 || usageRes.status === 403 || usageRes.status === 404) {
                orgUuid = null;
              } else {
                return { error: 'usage:' + usageRes.status };
              }
            }

            // orgUuid 不明 or 無効になった場合は /api/organizations から取得
            const orgsRes = await fetch('/api/organizations', { credentials: 'include' });
            if (!orgsRes.ok) return { error: 'orgs:' + orgsRes.status };
            const orgs = await orgsRes.json();

            // レスポンスは配列 or 単一オブジェクト
            const orgList = Array.isArray(orgs) ? orgs : [orgs];
            orgUuid = orgList[0]?.uuid ?? null;
            account = orgList[0] ?? null;
            if (!orgUuid) return { error: 'no-org' };

            const usageRes2 = await fetch('/api/organizations/' + orgUuid + '/usage', { credentials: 'include' });
            if (!usageRes2.ok) return { error: 'usage:' + usageRes2.status };
            const usage = await usageRes2.json();

            return { orgUuid, usage, account };
          } catch (e) {
            return { error: String(e) };
          }
        })()
      `, true) as RawResult
    } catch {
      return empty
    }

    if (!raw || 'error' in raw) {
      const errCode = raw && 'error' in raw ? raw.error : 0
      this.log('claudeWebFetcher: API error', errCode)
      // errCode は 'orgs:403' のような文字列なので数値を抽出して判定
      const statusNum = typeof errCode === 'number'
        ? errCode
        : parseInt(String(errCode).replace(/\D/g, '')) || 0
      if (statusNum === 401 || statusNum === 403) {
        this.orgUuid = null  // キャッシュも無効化
        this.setLoginStatus('logged-out')
      }
      return { ...empty, loginStatus: this.loginStatus }
    }

    this.setLoginStatus('logged-in')
    if (raw.orgUuid !== this.orgUuid) {
      this.orgUuid = raw.orgUuid
      this.orgUuidChangedCallback?.(raw.orgUuid)
    }

    const usage = mapUsage(raw.usage)
    const profile = mapProfile(raw.account, raw.orgUuid)

    // プラン診断ログ（Team/Enterprise など非標準プランのデバッグ用）
    // 毎ポーリング（デフォルト1分間隔）でフルダンプするとログファイルが際限なく肥大化するため、
    // セッション中1回だけ出す。それ以降は未知のフィールド／モデル名が現れた時だけ差分を記録する。
    if (!this.rawUsageLoggedOnce) {
      this.rawUsageLoggedOnce = true
      this.log('fetchData: rate_limit_tier=', (raw.account as Record<string, unknown>)?.['rate_limit_tier'])
      this.log('fetchData: raw_usage=', JSON.stringify(raw.usage, null, 2))
    } else {
      this.logUnknownUsageShapes(raw.usage)
    }

    return { usage, profile, loginStatus: 'logged-in' }
  }

  /** 未知のトップレベルフィールドや limits[] のモデル名が現れたら一度だけ記録する（フルダンプはしない） */
  private logUnknownUsageShapes(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const r = raw as Record<string, unknown>
    const src = (r['utilization'] && typeof r['utilization'] === 'object')
      ? r['utilization'] as Record<string, unknown>
      : r

    for (const key of Object.keys(src)) {
      const tag = `field:${key}`
      if (!KNOWN_USAGE_KEYS.has(key) && !this.loggedUnknownModelNames.has(tag)) {
        this.loggedUnknownModelNames.add(tag)
        this.log('fetchData: unknown usage field detected:', key, JSON.stringify(src[key]))
      }
    }

    const limits = r['limits']
    if (!Array.isArray(limits)) return
    for (const item of limits) {
      if (!item || typeof item !== 'object') continue
      const scope = (item as Record<string, unknown>)['scope']
      const model = (scope && typeof scope === 'object') ? (scope as Record<string, unknown>)['model'] : null
      const displayName = (model && typeof model === 'object') ? (model as Record<string, unknown>)['display_name'] : null
      const name = displayName != null ? String(displayName) : null
      const tag = `model:${name}`
      if (name && !MODEL_DISPLAY_TO_KEY[name] && !this.loggedUnknownModelNames.has(tag)) {
        this.loggedUnknownModelNames.add(tag)
        this.log('fetchData: unknown limits[] model display_name detected:', name)
      }
    }
  }

  /** Settings からログインウィンドウを開く */
  async showLoginWindow(): Promise<void> {
    const win = this.ensureWindow()
    const current = win.webContents.getURL()

    if (!current.includes('claude.ai')) {
      // ページ読み込みが完了してから表示（白画面防止）
      await new Promise<void>((resolve) => {
        win.webContents.once('did-finish-load', resolve)
        win.loadURL('https://claude.ai').catch(resolve)
      })
    }
    win.show()
    win.focus()
  }

  /** 明示的にウィンドウを非表示にする（IPC 経由） */
  hideLoginWindow(): void {
    this.win?.hide()
  }

  /** アプリ終了時に呼ぶ */
  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.removeAllListeners('close')
      this.win.destroy()
    }
    this.win = null
  }
}

// ---- データマッピング ----

function entry(src: Record<string, unknown>, key: string) {
  const v = src[key]
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  const utilization = Number(e['utilization'] ?? e['percent'] ?? 0)
  const resets_at = (e['resets_at'] ?? null) as string | null
  return { utilization, resets_at }
}

// モデル別週次制限は seven_day_* のフラットフィールドではなく、
// limits[] 配列内の scope.model.display_name で返ってくる場合がある（2026-07時点で Fable 確認）
const MODEL_DISPLAY_TO_KEY: Record<string, string> = {
  Fable: 'seven_day_fable',
  Opus: 'seven_day_opus',
  Sonnet: 'seven_day_sonnet',
}

// mapUsage が認識済みのトップレベルフィールド一覧（未知フィールド検出用）
const KNOWN_USAGE_KEYS = new Set([
  'five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_fable',
  'seven_day_sonnet', 'seven_day_cowork', 'seven_day_omelette', 'iguana_necktie',
  'omelette_promotional', 'cinder_cove', 'tangelo', 'nimbus_quill', 'amber_ladder',
  'extra_usage', 'limits', 'spend', 'member_dashboard_available',
])

function entriesFromLimits(limits: unknown): Record<string, { utilization: number; resets_at: string | null }> {
  const out: Record<string, { utilization: number; resets_at: string | null }> = {}
  if (!Array.isArray(limits)) return out

  for (const item of limits) {
    if (!item || typeof item !== 'object') continue
    const l = item as Record<string, unknown>
    const utilization = Number(l['percent'] ?? 0)
    const resets_at = (l['resets_at'] ?? null) as string | null
    const scope = (l['scope'] && typeof l['scope'] === 'object') ? l['scope'] as Record<string, unknown> : null
    const model = (scope?.['model'] && typeof scope['model'] === 'object') ? scope['model'] as Record<string, unknown> : null
    const displayName = model?.['display_name'] != null ? String(model['display_name']) : null

    if (displayName && MODEL_DISPLAY_TO_KEY[displayName]) {
      out[MODEL_DISPLAY_TO_KEY[displayName]] = { utilization, resets_at }
    } else if (l['kind'] === 'session') {
      out['five_hour'] = { utilization, resets_at }
    } else if (l['kind'] === 'weekly_all') {
      out['seven_day'] = { utilization, resets_at }
    }
  }
  return out
}

function mapUsage(raw: unknown): UsageData | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // claude.ai が { utilization: { five_hour: ... } } の構造で返す場合に対応
  const src = (r['utilization'] && typeof r['utilization'] === 'object')
    ? r['utilization'] as Record<string, unknown>
    : r

  // extra_usage は構造が異なるので個別にマッピング
  // monthly_limit=0 かつ utilization=null はプランが extra_usage 未設定の状態なので null 扱い
  const extraRaw = r['extra_usage']
  let extra_usage = null
  if (extraRaw && typeof extraRaw === 'object') {
    const e = extraRaw as Record<string, unknown>
    const monthlyLimit = Number(e['monthly_limit'] ?? 0)
    if (e['is_enabled'] && monthlyLimit > 0) {
      extra_usage = {
        is_enabled: Boolean(e['is_enabled']),
        monthly_limit: monthlyLimit,
        used_credits: Number(e['used_credits'] ?? 0),
        utilization: e['utilization'] != null ? Number(e['utilization']) : null,
        currency: e['currency'] != null ? String(e['currency']) : undefined,
      }
    }
  }

  // limits[] 配列由来のモデル別スコープ値をフラットフィールドが null のときのフォールバックとして使う
  const fromLimits = entriesFromLimits(r['limits'])

  const result: UsageData = {
    five_hour: entry(src, 'five_hour') ?? fromLimits['five_hour'] ?? null,
    seven_day: entry(src, 'seven_day') ?? fromLimits['seven_day'] ?? null,
    seven_day_oauth_apps: entry(src, 'seven_day_oauth_apps'),
    seven_day_opus: entry(src, 'seven_day_opus') ?? fromLimits['seven_day_opus'] ?? null,
    seven_day_fable: entry(src, 'seven_day_fable') ?? fromLimits['seven_day_fable'] ?? null,
    seven_day_sonnet: entry(src, 'seven_day_sonnet') ?? fromLimits['seven_day_sonnet'] ?? null,
    seven_day_cowork: entry(src, 'seven_day_cowork'),
    seven_day_omelette: entry(src, 'seven_day_omelette'),
    iguana_necktie: entry(src, 'iguana_necktie'),
    omelette_promotional: entry(src, 'omelette_promotional'),
    cinder_cove: entry(src, 'cinder_cove'),
    tangelo: entry(src, 'tangelo'),
    nimbus_quill: entry(src, 'nimbus_quill'),
    amber_ladder: entry(src, 'amber_ladder'),
    extra_usage,
  }

  if (!result.five_hour && !result.seven_day) return null
  return result
}

function mapProfile(rawAccount: unknown, orgUuid: string): ProfileData | null {
  if (!rawAccount || typeof rawAccount !== 'object') return null
  const a = rawAccount as Record<string, unknown>

  const memberships = Array.isArray(a['memberships']) ? a['memberships'] : []
  const membership = (memberships[0] ?? {}) as Record<string, unknown>
  const org = (membership['organization'] ?? {}) as Record<string, unknown>
  const settings = (typeof a['settings'] === 'object' && a['settings'] ? a['settings'] : {}) as Record<string, unknown>
  const capabilities = (typeof a['capabilities'] === 'object' && a['capabilities'] ? a['capabilities'] : {}) as Record<string, unknown>

  // rate_limit_tier はトップレベル・ネストされた org・settings など複数箇所を探す
  const rate_limit_tier = String(
    a['rate_limit_tier'] ??
    org['rate_limit_tier'] ??
    settings['rate_limit_tier'] ??
    capabilities['rate_limit_tier'] ??
    ''
  )

  // プランフラグも複数箇所から取得
  const has_claude_max = Boolean(
    a['has_claude_max'] ?? org['has_claude_max'] ??
    settings['has_claude_max'] ?? capabilities['has_claude_max']
  )
  const has_claude_pro = Boolean(
    a['has_claude_pro'] ?? org['has_claude_pro'] ??
    settings['has_claude_pro'] ?? capabilities['has_claude_pro']
  )

  return {
    account: {
      display_name: String(a['name'] ?? a['display_name'] ?? ''),
      email: String(a['email'] ?? ''),
      has_claude_max,
      has_claude_pro,
    },
    organization: {
      uuid: String(a['uuid'] ?? org['uuid'] ?? orgUuid ?? ''),
      name: String(a['name'] ?? org['name'] ?? ''),
      rate_limit_tier,
    }
  }
}
