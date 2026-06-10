/**
 * Claude モデルのトークン単価テーブル（$ per token）。
 * 前方一致でモデル名にマッチさせる（例: "claude-sonnet-4-5-20250929" → "claude-sonnet-4"）。
 * 未知のモデル（例: 将来の Fable 系）は null を返し、コスト寄与は 0 として扱う。
 */

export interface ModelPrice {
  input: number   // $ per token (base input)
  output: number  // $ per token (output)
}

// キャッシュ書き込み・読み込みは base input price からの倍率（Anthropic標準）
export const CACHE_WRITE_5M_MULT = 1.25
export const CACHE_WRITE_1H_MULT = 2.0
export const CACHE_READ_MULT = 0.1

const PRICING: { prefix: string; price: ModelPrice }[] = [
  // Opus 系: $15 / $75 per MTok
  { prefix: 'claude-opus-4', price: { input: 15e-6, output: 75e-6 } },
  { prefix: 'claude-3-opus', price: { input: 15e-6, output: 75e-6 } },
  // Sonnet 系: $3 / $15 per MTok
  { prefix: 'claude-sonnet-4', price: { input: 3e-6, output: 15e-6 } },
  { prefix: 'claude-3-7-sonnet', price: { input: 3e-6, output: 15e-6 } },
  { prefix: 'claude-3-5-sonnet', price: { input: 3e-6, output: 15e-6 } },
  { prefix: 'claude-3-sonnet', price: { input: 3e-6, output: 15e-6 } },
  // Haiku 4.5: $1 / $5 per MTok
  { prefix: 'claude-haiku-4', price: { input: 1e-6, output: 5e-6 } },
  // Haiku 3.5: $0.80 / $4 per MTok
  { prefix: 'claude-3-5-haiku', price: { input: 0.8e-6, output: 4e-6 } },
  // Haiku 3: $0.25 / $1.25 per MTok
  { prefix: 'claude-3-haiku', price: { input: 0.25e-6, output: 1.25e-6 } },
]

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
    + ephemeral5m * price.input * CACHE_WRITE_5M_MULT
    + ephemeral1h * price.input * CACHE_WRITE_1H_MULT
}
