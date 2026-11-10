// Exercise the production launcher on Windows during artifact builds, without
// a Codex installation, OAuth credentials, or a browser.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

if (process.platform !== 'win32') throw new Error('This artifact check must run on Windows')
const scratch = mkdtempSync(join(tmpdir(), 'hud-codex-launch-'))
try {
  const compiled = join(scratch, 'codexCommand.cjs')
  writeFileSync(compiled, ts.transpileModule(readFileSync(new URL('../src/main/codexCommand.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)
  const { codexCommand } = createRequire(import.meta.url)(compiled)
  for (const type of ['exe', 'cmd']) {
    for (const directory of ['Jane Doe', 'Jane & %USERNAME% !']) {
      const bin = join(scratch, type, directory)
      mkdirSync(bin, { recursive: true })
      const fixture = 'process.stdout.write(JSON.stringify({ok: true, args: process.argv.slice(2)}) + "\\n")'
      if (type === 'exe') {
        copyFileSync(process.execPath, join(bin, 'codex.exe'))
        // The renamed node.exe treats the fixed app-server argument as a script.
        writeFileSync(join(bin, 'app-server'), fixture)
      } else {
        writeFileSync(join(bin, 'server.cjs'), fixture)
        writeFileSync(join(bin, 'codex.cmd'), `@"${process.execPath}" "%~dp0server.cjs" %*\r\n`)
      }
      const env = { ...process.env }
      for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key]
      env.PATH = bin
      const launch = codexCommand('win32', env)
      const result = spawnSync(launch.command, launch.args, {
        env: launch.env, windowsVerbatimArguments: launch.windowsVerbatimArguments,
        windowsHide: true, cwd: bin, encoding: 'utf8', timeout: 10_000,
      })
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout.trim()), { ok: true, args: type === 'exe' ? [] : ['app-server'] })
      console.log(`PASS ${type}: ${directory}`)
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
