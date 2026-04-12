const BASE = 'https://api.anthropic.com'
const BETA_HEADER = 'oauth-2025-04-20'

export interface UsageEntry {
  utilization: number
  resets_at: string | null
}

export interface UsageData {
  five_hour: UsageEntry | null
  seven_day: UsageEntry | null
  seven_day_oauth_apps: UsageEntry | null
  seven_day_opus: UsageEntry | null
}

export interface ProfileData {
  account: {
    display_name: string
    email: string
    has_claude_max: boolean
    has_claude_pro: boolean
  }
  organization: {
    uuid: string
    name: string
    rate_limit_tier: string
  }
}

/** APIエラー（429かどうか判別できる） */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
  get isRateLimit(): boolean { return this.status === 429 }
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': BETA_HEADER,
    'Content-Type': 'application/json'
  }
}

/**
 * 使用量取得。
 * org UUID が渡された場合は claude.ai の内部 API を優先する（レートリミットが緩い）。
 * 失敗した場合は api.anthropic.com/api/oauth/usage にフォールバック。
 */
export async function fetchUsage(token: string, orgUuid?: string): Promise<UsageData> {
  // まず claude.ai の内部 API を試す（Chrome拡張と同じエンドポイント）
  if (orgUuid) {
    try {
      const res = await fetch(
        `https://claude.ai/api/organizations/${orgUuid}/usage`,
        { headers: headers(token) }
      )
      if (res.ok) return res.json() as Promise<UsageData>
      // 認証エラーやサーバーエラーはフォールバックしない
      if (res.status === 401 || res.status === 403 || res.status >= 500) {
        throw new ApiError(`claude.ai Usage API ${res.status}: ${await res.text()}`, res.status)
      }
      console.warn(`claude.ai Usage API ${res.status}, falling back to oauth endpoint`)
    } catch (e) {
      if (e instanceof ApiError) throw e
      console.warn('claude.ai endpoint failed, falling back:', e)
    }
  }

  // フォールバック: api.anthropic.com/api/oauth/usage
  const res = await fetch(`${BASE}/api/oauth/usage`, { headers: headers(token) })
  if (!res.ok) throw new ApiError(`Usage API ${res.status}: ${await res.text()}`, res.status)
  return res.json() as Promise<UsageData>
}

export async function fetchProfile(token: string): Promise<ProfileData> {
  const res = await fetch(`${BASE}/api/oauth/profile`, { headers: headers(token) })
  if (!res.ok) throw new ApiError(`Profile API ${res.status}: ${await res.text()}`, res.status)
  return res.json() as Promise<ProfileData>
}
