import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
  }
}

/**
 * ~/.claude/.credentials.json からアクセストークンを読み取る。
 * Keychain へのアクセスは行わない。
 */
export function getTokenFromCredentials(): string | null {
  const credFile = join(homedir(), '.claude', '.credentials.json')
  if (!existsSync(credFile)) return null
  try {
    const parsed: ClaudeCredentials = JSON.parse(readFileSync(credFile, 'utf-8'))
    return parsed?.claudeAiOauth?.accessToken ?? null
  } catch {
    return null
  }
}
