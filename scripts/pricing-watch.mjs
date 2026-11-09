#!/usr/bin/env node
// 公式の料金ページと src/main/modelPricing.json を突き合わせ、モデルの追加・単価の変更を見つける。
//
//   node scripts/pricing-watch.mjs                  差分を表示するだけ（終了コード: 差分なし0 / 差分あり10 / 読み取り失敗1）
//   node scripts/pricing-watch.mjs --write          差分を単価表に書き込む（新モデル追加・単価更新・familyFallbacks更新）
//   node scripts/pricing-watch.mjs --summary out.md 差分の説明をMarkdownで書き出す（PR本文用）
//   node scripts/pricing-watch.mjs --source page.md 取得済みのページを使う（テスト用）
//
// 単価表は main にマージした時点でインストール済みのアプリへ配信されるため、
// このスクリプトは書き換えるだけで、マージは人（またはレビュー後のClaude）が行う前提。

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const here = dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = join(here, '..', 'src', 'main', 'modelPricing.json')

const args = process.argv.slice(2)
const argValue = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const WRITE = args.includes('--write')
const SUMMARY_PATH = argValue('--summary')
const SOURCE_PATH = argValue('--source')

/** "$0.20 / MTok<sup>1</sup>" → 1トークンあたりのドル */
export function parsePerToken(cell) {
  const m = cell.replace(/<[^>]+>/g, '').match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*MTok/i)
  if (!m) throw new Error(`price cell not understood: ${cell.trim()}`)
  return Number((Number(m[1]) / 1_000_000).toPrecision(12))
}

/** "Claude Mythos 5.2 ([limited availability](...))" → { id, tier } */
export function parseModelName(cell) {
  let name = cell.trim()
  const tierMatch = name.match(/\(for prompts (up to|over) ([0-9,]+) tokens\)/i)
  const tier = tierMatch ? { kind: tierMatch[1].toLowerCase() === 'over' ? 'over' : 'base', tokens: Number(tierMatch[2].replace(/,/g, '')) } : null
  // 括弧書き（注記・リンク）を外す。リンク文中の括弧も含めて取り除く
  name = name.replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  const m = name.match(/^Claude ([A-Za-z]+) ([0-9]+(?:\.[0-9]+)?)$/)
  if (!m) throw new Error(`model name not understood: ${cell.trim()}`)
  const family = m[1].toLowerCase()
  const version = m[2]
  // Claude 3 世代は "claude-3-5-haiku" の順（APIのモデルIDの並びに合わせる）
  const id = version.startsWith('3')
    ? `claude-${version.replace('.', '-')}-${family}`
    : `claude-${family}-${version.replace('.', '-')}`
  return { id, family, version, tier }
}

/** 料金ページのMarkdownから「Model pricing」の表を読み、モデルID→単価に変換する。 */
export function parsePricingPage(markdown) {
  const start = markdown.indexOf('## Model pricing')
  if (start < 0) throw new Error('"## Model pricing" section not found')
  const rest = markdown.slice(start + 1)
  const end = rest.search(/\n## /)
  const section = end >= 0 ? rest.slice(0, end) : rest

  const rows = section.split('\n').filter(l => /^\|\s*Claude /.test(l))
  if (rows.length < 5) throw new Error(`too few model rows (${rows.length}); page format may have changed`)

  // 列の並び（Base input / 5m cache writes / 1h cache writes / Cache hits / Output）を見出しで確認する
  const header = section.split('\n').find(l => /^\|\s*Model\s*\|/.test(l)) ?? ''
  const cols = header.split('|').map(c => c.trim().toLowerCase())
  const expected = ['model', 'base input tokens', '5m cache writes', '1h cache writes', 'cache hits and refreshes', 'output tokens']
  if (expected.some((e, i) => cols[i + 1] !== e)) throw new Error(`unexpected table header: ${header}`)

  const models = {}
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1)
    const { id, family, version, tier } = parseModelName(cells[0])
    const price = {
      in: parsePerToken(cells[1]),
      out: parsePerToken(cells[5]),
      cw5m: parsePerToken(cells[2]),
      cw1h: parsePerToken(cells[3]),
      cr: parsePerToken(cells[4]),
    }
    models[id] ??= { family, version }
    if (tier?.kind === 'over') models[id].longContext = { overPromptTokens: tier.tokens, ...price }
    else models[id].price = price
  }
  for (const [id, m] of Object.entries(models)) {
    if (!m.price) throw new Error(`base price row missing for ${id}`)
  }
  return models
}

function compareVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function versionOfId(id) {
  const m = id.match(/^claude-[a-z]+-([0-9]+(?:-[0-9]+)?)$/)
  return m ? m[1].replace('-', '.') : null
}

const FIELDS = ['in', 'out', 'cw5m', 'cw1h', 'cr']

/** 既存ファイルと同じ書き方（1e-4未満は "4e-06" の指数表記）で書き出し、無関係な行を差分に出さない。 */
export function serializeCatalog(catalog) {
  return JSON.stringify(catalog, null, 2).replace(/(?<=: )([0-9][0-9.]*(?:e-[0-9]+)?)(?=,?\n)/g, n => {
    const v = Number(n)
    if (v === 0 || v >= 1e-4) return n
    const [mant, exp] = v.toExponential().split('e')
    const e = Number(exp)
    return `${mant}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
  }) + '\n'
}

/** アプリは updatedAt が手元の表と同じか新しいときだけ取り込むため、既存の日付より前にはしない。 */
export function nextUpdatedAt(current) {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return current && current > jst ? current : jst
}
const fmt = v => `$${Number((v * 1_000_000).toPrecision(6))}`

/** 単価表とページの差分を求め、反映後の単価表を返す。 */
export function diffCatalog(catalog, page, today) {
  const added = []
  const changed = []
  const next = structuredClone(catalog)
  const models = { ...next.models }

  for (const [id, m] of Object.entries(page)) {
    const want = { ...m.price, ...(m.longContext ? { longContext: m.longContext } : {}) }
    const have = models[id]
    if (!have) {
      added.push({ id, want })
      models[id] = want
      continue
    }
    const diffs = []
    for (const f of FIELDS) {
      if (have[f] !== want[f]) diffs.push(`${f}: ${fmt(have[f])} → ${fmt(want[f])}`)
    }
    const hl = have.longContext
    const wl = want.longContext
    if (JSON.stringify(hl ?? null) !== JSON.stringify(wl ?? null)) {
      diffs.push(`longContext: ${hl ? `>${hl.overPromptTokens} ${FIELDS.map(f => fmt(hl[f])).join('/')}` : 'なし'} → ${wl ? `>${wl.overPromptTokens} ${FIELDS.map(f => fmt(wl[f])).join('/')}` : 'なし'}`)
    }
    if (diffs.length) {
      changed.push({ id, diffs })
      models[id] = want
    }
  }

  // 追加されたモデルは同系列の既存モデルの直前に置く（読みやすさのため。照合は前方一致の長さ順なので順序は無関係）
  const ordered = {}
  const pending = new Map(added.map(a => [a.id, a]))
  for (const [id, v] of Object.entries(models)) {
    if (pending.has(id)) continue
    for (const [aid, a] of pending) {
      if (page[aid].family === (id.match(/^claude-([a-z]+)-/)?.[1]) && compareVersion(page[aid].version, versionOfId(id) ?? '0') > 0) {
        ordered[aid] = models[aid]
        pending.delete(aid)
      }
    }
    ordered[id] = v
  }
  for (const aid of pending.keys()) ordered[aid] = models[aid]
  next.models = ordered

  // 各系列の代わりの単価は、ページにある最新バージョンへ
  const fallbackChanges = []
  const newest = {}
  for (const [id, m] of Object.entries(page)) {
    if (m.version.startsWith('3')) continue
    if (!newest[m.family] || compareVersion(m.version, newest[m.family].version) > 0) newest[m.family] = { id, version: m.version }
  }
  for (const [family, n] of Object.entries(newest)) {
    const current = next.familyFallbacks[family]
    const currentVersion = current ? versionOfId(current) : null
    if (!current || (currentVersion && compareVersion(n.version, currentVersion) > 0)) {
      fallbackChanges.push(`${family}: ${current ?? 'なし'} → ${n.id}`)
      next.familyFallbacks[family] = n.id
    }
  }

  const hasChanges = added.length > 0 || changed.length > 0 || fallbackChanges.length > 0
  if (hasChanges) next._meta.updatedAt = today
  return { next, added, changed, fallbackChanges, hasChanges }
}

function summaryMarkdown({ added, changed, fallbackChanges }) {
  const lines = [`公式の料金ページ（${PRICING_URL}）と単価表に差がありました。`, '']
  if (added.length) {
    lines.push('### 追加されたモデル', '', '| モデル | 入力 | 出力 | 5分書込 | 1時間書込 | キャッシュ読込 | 長いプロンプト |', '|---|---|---|---|---|---|---|')
    for (const { id, want } of added) {
      const lc = want.longContext ? `${want.longContext.overPromptTokens}超: ${FIELDS.map(f => fmt(want.longContext[f])).join(' / ')}` : '—'
      lines.push(`| \`${id}\` | ${fmt(want.in)} | ${fmt(want.out)} | ${fmt(want.cw5m)} | ${fmt(want.cw1h)} | ${fmt(want.cr)} | ${lc} |`)
    }
    lines.push('')
  }
  if (changed.length) {
    lines.push('### 単価が変わったモデル', '')
    for (const { id, diffs } of changed) lines.push(`- \`${id}\`: ${diffs.join(', ')}`)
    lines.push('')
  }
  if (fallbackChanges.length) {
    lines.push('### 未知のバージョンの代わりに使う単価（familyFallbacks）', '')
    for (const c of fallbackChanges) lines.push(`- ${c}`)
    lines.push('')
  }
  lines.push(
    '### マージ前に確認すること',
    '',
    '- 上の値が料金ページと一致しているか（表の読み取りミスがそのまま全ユーザーへ配信されるため）',
    '- キャッシュ読み込みの倍率が標準(0.1x)と違うモデルや、段階料金など、単価表の形で表せない新しい料金体系が無いか',
    '- `_meta.note` の説明を更新する必要が無いか',
    '- マージすると、アプリの更新なしでインストール済みのアプリに12時間以内に届きます（版上げ不要）',
  )
  return lines.join('\n') + '\n'
}

async function main() {
  const markdown = SOURCE_PATH
    ? readFileSync(SOURCE_PATH, 'utf8')
    : await fetch(`${PRICING_URL}.md`, { headers: { 'user-agent': 'claude-usage-hud-pricing-watch' } }).then(async r => {
      if (!r.ok) throw new Error(`fetch failed: HTTP ${r.status}`)
      return r.text()
    })

  const page = parsePricingPage(markdown)
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
  const result = diffCatalog(catalog, page, nextUpdatedAt(catalog._meta?.updatedAt))

  console.log(`models on page: ${Object.keys(page).length}`)
  if (!result.hasChanges) {
    console.log('no changes')
    return 0
  }
  const summary = summaryMarkdown(result)
  console.log(summary)
  if (SUMMARY_PATH) writeFileSync(SUMMARY_PATH, summary)
  if (WRITE) writeFileSync(CATALOG_PATH, serializeCatalog(result.next))
  return 10
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(code => process.exit(code), err => {
    console.error(`pricing-watch: ${err.message}`)
    process.exit(1)
  })
}
