const BASE = 'https://api.anthropic.com'
const BETA_HEADER = 'oauth-2025-04-20'

export interface UsageEntry {
  utilization: number
  resets_at: string | null
}

export interface ExtraUsage {
  is_enabled: boolean
  monthly_limit: number
  used_credits: number
  utilization: number
}

export interface UsageData {
  five_hour: UsageEntry | null
  seven_day: UsageEntry | null
  seven_day_oauth_apps: UsageEntry | null
  seven_day_opus: UsageEntry | null
  seven_day_sonnet: UsageEntry | null
  extra_usage: ExtraUsage | null
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

export async function fetchUsage(token: string): Promise<UsageData> {
  const res = await fetch(`${BASE}/api/oauth/usage`, { headers: headers(token) })
  if (!res.ok) throw new ApiError(`Usage API ${res.status}: ${await res.text()}`, res.status)
  return res.json() as Promise<UsageData>
}


export async function fetchProfile(token: string): Promise<ProfileData> {
  const res = await fetch(`${BASE}/api/oauth/profile`, { headers: headers(token) })
  if (!res.ok) throw new ApiError(`Profile API ${res.status}: ${await res.text()}`, res.status)
  return res.json() as Promise<ProfileData>
}
