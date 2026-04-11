import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir, platform } from 'os'

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: string
  }
}

/**
 * Claude Code の認証情報からアクセストークンを自動取得する。
 * 優先順位:
 *   1. macOS: Keychain から取得
 *   2. 全OS共通: ~/.claude/.credentials.json から取得
 */
export function getTokenFromCredentials(): string | null {
  // 1. macOS Keychain
  if (platform() === 'darwin') {
    try {
      const raw = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8' }
      ).trim()
      if (raw) {
        const parsed: ClaudeCredentials = JSON.parse(raw)
        const token = parsed?.claudeAiOauth?.accessToken
        if (token) return token
      }
    } catch {
      // Keychain になければファイルへフォールバック
    }
  }

  // 2. ~/.claude/.credentials.json (全OS)
  const credFile = join(homedir(), '.claude', '.credentials.json')
  if (existsSync(credFile)) {
    try {
      const parsed: ClaudeCredentials = JSON.parse(readFileSync(credFile, 'utf-8'))
      const token = parsed?.claudeAiOauth?.accessToken
      if (token) return token
    } catch {
      // 読み取り失敗
    }
  }

  return null
}
