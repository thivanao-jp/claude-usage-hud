export type CodexLoginStatus = 'logged-in' | 'logged-out' | 'unknown'
export type CodexLoginErrorCode = 'cli-not-found' | 'server' | 'browser' | 'login'

export interface CodexAuthState {
  status: CodexLoginStatus
  phase: 'idle' | 'starting' | 'waiting' | 'complete' | 'error'
  error: { code: CodexLoginErrorCode; message: string } | null
}
