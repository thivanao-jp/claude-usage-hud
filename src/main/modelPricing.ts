/** Claude モデルのトークン単価カタログ（USD/token）。 */
import pricingData from './modelPricing.json'
import { readFile, rename, writeFile } from 'fs/promises'
import { join } from 'path'

export interface ModelPrice {
  input: number   // $ per token (base input)
  output: number  // $ per token (output)
  cacheWrite5m: number // $ per token (5分キャッシュ書き込み)
  cacheWrite1h: number // $ per token (1時間キャッシュ書き込み)
  cacheRead: number    // $ per token (キャッシュ読み込み)
}

interface RawPrice {
  in: number
  out: number
  cw5m: number
  cw1h: number
  cr: number
}

interface PricingCatalog {
  _meta: {
    schemaVersion: number
    source: string
    updatedAt: string
    note?: string
  }
  familyFallbacks: Record<string, string>
  models: Record<string, RawPrice>
}

export interface PricingCatalogStatus {
  source: 'bundled' | 'cache' | 'remote' | 'override'
  updatedAt: string
  reference: string
}

export interface ModelPriceResolution {
  price: ModelPrice | null
  matchedPrefix: string | null
  match: 'exact-prefix' | 'family-fallback' | 'unpriced'
}

export interface PaceCostResult {
  usd: number
  resolution: ModelPriceResolution
}

export const PRICING_REMOTE_URL =
  'https://raw.githubusercontent.com/thivanao-jp/claude-usage-hud/main/src/main/modelPricing.json'

const MAX_CATALOG_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 5_000
const CACHE_FILENAME = 'modelPricing.cache.json'
export const OVERRIDE_FILENAME = 'modelPricing.override.json'

function isFinitePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
}

function validateRawPrice(value: unknown): value is RawPrice {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return isFinitePrice(p.in) && isFinitePrice(p.out) && isFinitePrice(p.cw5m)
    && isFinitePrice(p.cw1h) && isFinitePrice(p.cr)
}

function validateCatalog(value: unknown): PricingCatalog | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const meta = raw._meta as Record<string, unknown> | undefined
  const models = raw.models as Record<string, unknown> | undefined
  const familyFallbacks = raw.familyFallbacks as Record<string, unknown> | undefined
  if (!meta || Number(meta.schemaVersion) !== 1 || typeof meta.source !== 'string' || typeof meta.updatedAt !== 'string') return null
  if (!models || typeof models !== 'object' || Object.keys(models).length === 0 || Object.keys(models).length > 1000) return null
  if (!Object.entries(models).every(([key, price]) => key.length > 0 && key.length < 160 && validateRawPrice(price))) return null
  const fallbacks: Record<string, string> = {}
  if (familyFallbacks && typeof familyFallbacks === 'object') {
    for (const [family, prefix] of Object.entries(familyFallbacks)) {
      if (typeof prefix === 'string' && models[prefix]) fallbacks[family.toLowerCase()] = prefix
    }
  }
  return {
    _meta: {
      schemaVersion: 1,
      source: meta.source,
      updatedAt: meta.updatedAt,
      note: typeof meta.note === 'string' ? meta.note : undefined,
    },
    familyFallbacks: fallbacks,
    models: models as Record<string, RawPrice>,
  }
}

function parseCatalog(text: string): PricingCatalog | null {
  if (text.length > MAX_CATALOG_BYTES) return null
  try { return validateCatalog(JSON.parse(text)) } catch { return null }
}

const bundledCatalog = validateCatalog(pricingData)
if (!bundledCatalog) throw new Error('Bundled model pricing catalog is invalid')

let activeCatalog: PricingCatalog = bundledCatalog
let catalogStatus: PricingCatalogStatus = {
  source: 'bundled',
  updatedAt: bundledCatalog._meta.updatedAt,
  reference: bundledCatalog._meta.source,
}
let pricingEntries: { prefix: string; price: ModelPrice }[] = []

function rawToPrice(p: RawPrice): ModelPrice {
  return { input: p.in, output: p.out, cacheWrite5m: p.cw5m, cacheWrite1h: p.cw1h, cacheRead: p.cr }
}

function activateCatalog(catalog: PricingCatalog, source: PricingCatalogStatus['source']): void {
  activeCatalog = catalog
  catalogStatus = { source, updatedAt: catalog._meta.updatedAt, reference: catalog._meta.source }
  pricingEntries = Object.entries(catalog.models)
    .sort(([a], [b]) => b.length - a.length)
    .map(([prefix, p]) => ({ prefix: prefix.toLowerCase(), price: rawToPrice(p) }))
}

activateCatalog(bundledCatalog, 'bundled')

function isNewerOrEqual(candidate: PricingCatalog, current: PricingCatalog): boolean {
  return candidate._meta.updatedAt.localeCompare(current._meta.updatedAt) >= 0
}

function mergeOverride(base: PricingCatalog, override: PricingCatalog): PricingCatalog {
  return {
    _meta: override._meta,
    familyFallbacks: { ...base.familyFallbacks, ...override.familyFallbacks },
    models: { ...base.models, ...override.models },
  }
}

/**
 * 内蔵表→キャッシュ→GitHub上のデータファイル→ユーザーoverrideの順に価格を読み込む。
 * リモートはデータのみで、数値とサイズを検証してからatomicにキャッシュする。
 */
export async function initializeModelPricing(
  userDataDir: string,
  log: (...args: unknown[]) => void = () => {},
  remoteUrl = PRICING_REMOTE_URL
): Promise<PricingCatalogStatus> {
  const cachePath = join(userDataDir, CACHE_FILENAME)
  const overridePath = join(userDataDir, OVERRIDE_FILENAME)

  try {
    const cached = parseCatalog(await readFile(cachePath, 'utf8'))
    if (cached && isNewerOrEqual(cached, activeCatalog)) activateCatalog(cached, 'cache')
  } catch {}

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(remoteUrl, { signal: controller.signal, cache: 'no-store' })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    const remote = parseCatalog(text)
    if (!remote) throw new Error('catalog validation failed')
    if (isNewerOrEqual(remote, activeCatalog)) {
      activateCatalog(remote, 'remote')
      const tempPath = `${cachePath}.tmp`
      await writeFile(tempPath, `${JSON.stringify(remote, null, 2)}\n`, 'utf8')
      await rename(tempPath, cachePath)
    }
  } catch (error) {
    log('Pricing catalog update skipped:', error)
  }

  try {
    const override = parseCatalog(await readFile(overridePath, 'utf8'))
    if (override) activateCatalog(mergeOverride(activeCatalog, override), 'override')
  } catch {}

  log('Pricing catalog:', catalogStatus)
  return { ...catalogStatus }
}

export function getPricingCatalogStatus(): PricingCatalogStatus {
  return { ...catalogStatus }
}

export interface PricingCatalogModelEntry extends ModelPrice {
  id: string
}

export interface PricingCatalogSnapshot {
  status: PricingCatalogStatus
  models: PricingCatalogModelEntry[]
}

/** 設定画面表示用に、現在有効な単価表を取得日付付きでスナップショットする。 */
export function getPricingCatalogSnapshot(): PricingCatalogSnapshot {
  return {
    status: getPricingCatalogStatus(),
    models: Object.entries(activeCatalog.models)
      .map(([id, p]) => ({ id, ...rawToPrice(p) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}

function modelFamily(model: string): string | null {
  return Object.keys(activeCatalog.familyFallbacks).find(family =>
    new RegExp(`(^|[-_.])${family}($|[-_.])`, 'i').test(model)
  ) ?? null
}

/** モデル名から単価と照合方法を取得する。 */
export function resolveModelPrice(model: string | undefined | null): ModelPriceResolution {
  if (!model) return { price: null, matchedPrefix: null, match: 'unpriced' }
  const normalized = model.toLowerCase()
  const exact = pricingEntries.find(p => normalized.startsWith(p.prefix))
  if (exact) return { price: exact.price, matchedPrefix: exact.prefix, match: 'exact-prefix' }

  const family = modelFamily(normalized)
  const fallbackPrefix = family ? activeCatalog.familyFallbacks[family] : null
  const fallback = fallbackPrefix ? activeCatalog.models[fallbackPrefix] : null
  if (fallback) {
    return { price: rawToPrice(fallback), matchedPrefix: fallbackPrefix, match: 'family-fallback' }
  }
  return { price: null, matchedPrefix: null, match: 'unpriced' }
}

/** モデル名から単価を取得。未知バージョンは同系列の明示フォールバックを使う。 */
export function getModelPrice(model: string | undefined | null): ModelPrice | null {
  return resolveModelPrice(model).price
}

/**
 * usage オブジェクトから「ペース対象コスト」（cache_read除く）を計算する。
 * cache_creation の内訳（ephemeral_5m / ephemeral_1h）が無い場合は5m扱いとする。
 */
export function calcPaceCost(usage: Record<string, unknown>, model: string | undefined | null): PaceCostResult {
  const resolution = resolveModelPrice(model)
  const price = resolution.price
  if (!price) return { usd: 0, resolution }

  const inputTokens = Number(usage['input_tokens'] ?? 0)
  const outputTokens = Number(usage['output_tokens'] ?? 0)

  const cacheCreation = usage['cache_creation'] as Record<string, unknown> | undefined
  let ephemeral5m = 0
  let ephemeral1h = 0
  if (cacheCreation && typeof cacheCreation === 'object') {
    ephemeral5m = Number(cacheCreation['ephemeral_5m_input_tokens'] ?? 0)
    ephemeral1h = Number(cacheCreation['ephemeral_1h_input_tokens'] ?? 0)
  } else {
    ephemeral5m = Number(usage['cache_creation_input_tokens'] ?? 0)
  }

  const usd = inputTokens * price.input
    + outputTokens * price.output
    + ephemeral5m * price.cacheWrite5m
    + ephemeral1h * price.cacheWrite1h
  return { usd, resolution }
}

export function calcPaceCostUsd(usage: Record<string, unknown>, model: string | undefined | null): number {
  return calcPaceCost(usage, model).usd
}
