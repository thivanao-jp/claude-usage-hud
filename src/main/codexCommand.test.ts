import { describe, expect, it } from 'vitest'
import { codexCommand, CodexCliNotFoundError } from './codexCommand'

describe('Codex CLI launch command', () => {
  it('starts a standalone Windows exe directly, with spaces in its path', () => {
    const binary = 'C:\\Users\\Jane Doe\\bin\\codex.exe'
    const launch = codexCommand('win32', { Path: 'C:\\Windows;C:\\Users\\Jane Doe\\bin', PATHEXT: '.EXE;.CMD' }, p => p === binary)
    expect(launch.command).toBe(binary)
    expect(launch.args).toEqual(['app-server'])
    expect(launch.windowsVerbatimArguments).toBeUndefined()
    expect(launch.env.PATH).toBe('C:\\Windows;C:\\Users\\Jane Doe\\bin')
    expect(launch.env.Path).toBeUndefined()
  })

  it('runs an npm shim through cmd.exe with both layers of quoting', () => {
    const shim = 'C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\codex.cmd'
    const launch = codexCommand('win32', { PATH: '"C:\\Users\\Jane Doe\\AppData\\Roaming\\npm"', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, p => p === shim)
    expect(launch.command).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(launch.args).toEqual(['/d', '/v:off', '/s', '/c', '""%CLAUDE_USAGE_HUD_CODEX_CMD%" app-server"'])
    expect(launch.env.CLAUDE_USAGE_HUD_CODEX_CMD).toBe(shim)
    expect(launch.windowsVerbatimArguments).toBe(true)
  })

  it('preserves PATH order and prefers an exe to a shim in the same directory', () => {
    const available = ['C:\\one\\codex.cmd', 'C:\\two\\codex.exe']
    expect(codexCommand('win32', { PATH: 'C:\\one;C:\\two' }, p => available.includes(p)).env.CLAUDE_USAGE_HUD_CODEX_CMD).toBe('C:\\one\\codex.cmd')
    expect(codexCommand('win32', { PATH: 'C:\\one' }, () => true).command).toBe('C:\\one\\codex.exe')
  })

  it('supports an explicit executable override and reports a missing override', () => {
    const binary = 'D:\\Custom Tools\\my-codex.exe'
    expect(codexCommand('win32', { CODEX_BIN: binary }, p => p === binary).command).toBe(binary)
    expect(() => codexCommand('win32', { CODEX_BIN: binary, PATH: 'C:\\other' }, p => p === 'C:\\other\\codex.exe')).toThrow(CodexCliNotFoundError)
  })

  it('does not search the working directory or a relative PATH entry', () => {
    expect(() => codexCommand('win32', { PATH: ';.;relative' }, () => true)).toThrow(CodexCliNotFoundError)
  })

  it('keeps shell metacharacters in a shim path out of the command text', () => {
    const shim = 'C:\\Jane & %USERNAME% !\\codex.cmd'
    const launch = codexCommand('win32', { CODEX_BIN: shim }, p => p === shim)
    expect(launch.env.CLAUDE_USAGE_HUD_CODEX_CMD).toBe(shim)
    expect(launch.args.join(' ')).not.toContain(shim)
    expect(launch.args).toContain('/v:off')
  })

  it('keeps macOS launch behavior and a literal executable override', () => {
    expect(codexCommand('darwin', { PATH: '/usr/bin', CODEX_BIN: '/a path/codex' })).toEqual({
      command: '/a path/codex', args: ['app-server'], env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin', CODEX_BIN: '/a path/codex' },
    })
  })
})
