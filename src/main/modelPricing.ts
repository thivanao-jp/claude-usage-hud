/**
 * Claude モデルのトークン単価テーブル（$ per token）。
 * 前方一致でモデル名にマッチさせる（例: "claude-sonnet-4-5-20250929" → "claude-sonnet-4-5"）。
 * 価格データは modelPricing.json（LiteLLM の model_prices_and_context_window.json から抽出した
 * スナップショット）を読み込む。未知のモデル（例: 将来の新モデル）は null を返し、コスト寄与は 0 として扱う。
 */
import pricingData from './modelPricing.json'

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

// 前方一致の優先順位を保つため、JSON内のキー順をそのまま利用する
const PRICING: { prefix: string; price: ModelPrice }[] = Object.entries(
  (pricingData as { models: Record<string, RawPrice> }).models
).map(([prefix, p]) => ({
  prefix,
  price: {
    input: p.in,
    output: p.out,
    cacheWrite5m: p.cw5m,
    cacheWrite1h: p.cw1h,
    cacheRead: p.cr,
  },
}))

/** モデル名から単価を取得。未知モデルは null（コスト0扱い） */
export function getModelPrice(model: string | undefined | null): ModelPrice | null {
  if (!model) return null
  for (const p of PRICING) {
    if (model.startsWith(p.prefix)) return p.price
  }
  return null
}

/**
 * usage オブジェクトから「ペース対象コスト」（cache_read除く）を計算する。
 * cache_creation の内訳（ephemeral_5m / ephemeral_1h）が無い場合は5m扱いとする。
 */
export function calcPaceCostUsd(usage: Record<string, unknown>, model: string | undefined | null): number {
  const price = getModelPrice(model)
  if (!price) return 0

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

  return inputTokens * price.input
    + outputTokens * price.output
    + ephemeral5m * price.cacheWrite5m
    + ephemeral1h * price.cacheWrite1h
}
