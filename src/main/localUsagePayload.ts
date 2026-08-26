import type { BetaProvidersData, UsageData } from './claudeApi'
import type { CcPaceData } from './ccPaceMeter'

export interface LocalUsagePayloadInput {
  usage: UsageData | null
  lastUpdated: string | null
  beta: BetaProvidersData
  claudePace: CcPaceData
  generatedAt?: string
}

/** v1互換フィールドを維持しつつ、provider別の正規形を返す。 */
export function buildLocalUsagePayload(input: LocalUsagePayloadInput): Record<string, unknown> {
  const { usage, lastUpdated, beta, claudePace } = input
  return {
    schema_version: 2,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    five_hour: usage?.five_hour ?? null,
    seven_day: usage?.seven_day ?? null,
    extra_usage: usage?.extra_usage ?? null,
    last_updated: lastUpdated,
    beta,
    providers: {
      claude: {
        five_hour: usage?.five_hour ?? null,
        seven_day: usage?.seven_day ?? null,
        extra_usage: usage?.extra_usage ?? null,
        last_updated: lastUpdated,
        pace: claudePace,
      },
      codex: beta.codex ? { usage: beta.codex, pace: beta.codex.pace } : null,
      copilot: beta.copilot ? { usage: beta.copilot } : null,
    },
    claude_code_pace: claudePace,
    cc_pace: claudePace,
  }
}
