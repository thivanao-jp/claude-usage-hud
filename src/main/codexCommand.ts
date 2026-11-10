import { statSync } from 'fs'
import { win32 } from 'path'

export class CodexCliNotFoundError extends Error {}

/** Resolve Windows executables without invoking a shell or searching the working directory. */
export function codexCommand(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  isFile: (path: string) => boolean = path => {
    try { return statSync(path).isFile() } catch { return false }
  },
): { command: string; args: string[]; env: NodeJS.ProcessEnv; windowsVerbatimArguments?: boolean } {
  const override = env.CODEX_BIN?.trim()
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  const path = pathKey ? env[pathKey] ?? '' : ''
  if (platform !== 'win32') {
    return {
      command: override || 'codex', args: ['app-server'],
      env: { ...env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', path].filter(Boolean).join(':') },
    }
  }

  // A single PATH key avoids Node choosing a different casing when creating a Windows process.
  const childEnv = { ...env }
  for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'path') delete childEnv[key]
  childEnv.PATH = path
  const name = override || 'codex'
  const names = win32.extname(name) ? [name] : [`${name}.exe`, `${name}.cmd`, `${name}.bat`]
  const hasDirectory = /[\\/]/.test(name)
  const candidates = hasDirectory ? names : path.split(';')
    .map(dir => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(dir => win32.isAbsolute(dir))
    .flatMap(dir => names.map(file => win32.join(dir, file)))
  const executable = candidates.find(isFile)
  if (!executable) throw new CodexCliNotFoundError('Codex CLI was not found. Check codex --version in Windows PowerShell, then restart the HUD.')
  if (/\.(cmd|bat)$/i.test(executable)) {
    // Expand the path once from the environment so literal % characters in a
    // user directory are not interpreted as variables. Disable delayed expansion
    // for literal ! characters, and quote both the path and the /c command.
    if (/["\r\n]/.test(executable)) throw new Error('Invalid Codex CLI executable path')
    const shimKey = 'CLAUDE_USAGE_HUD_CODEX_CMD'
    for (const key of Object.keys(childEnv)) if (key.toUpperCase() === shimKey) delete childEnv[key]
    childEnv[shimKey] = executable
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', `""%${shimKey}%" app-server"`],
      env: childEnv, windowsVerbatimArguments: true,
    }
  }
  return { command: executable, args: ['app-server'], env: childEnv }
}
