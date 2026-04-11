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
    name: string
    rate_limit_tier: string
  }
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
  if (!res.ok) throw new Error(`Usage API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<UsageData>
}

export async function fetchProfile(token: string): Promise<ProfileData> {
  const res = await fetch(`${BASE}/api/oauth/profile`, { headers: headers(token) })
  if (!res.ok) throw new Error(`Profile API ${res.status}: ${await res.text()}`)
  return res.json() as Promise<ProfileData>
}
