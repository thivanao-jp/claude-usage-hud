export interface WeeklyFieldDef {
  key: string
  shortLabel: string
  labelEn: string
  labelJa: string
  descEn: string
  descJa: string
  alertLabelEn: string
  alertLabelJa: string
  showLabelEn: string
  showLabelJa: string
  color: string
  periodMs: number
}

const DAY = 24 * 60 * 60 * 1000

export const WEEKLY_FIELD_DEFS: WeeklyFieldDef[] = [
  {
    key: 'seven_day',
    shortLabel: '7D',
    labelEn: '7-Day (claude.ai)',
    labelJa: '7日間 (claude.ai)',
    descEn: 'Weekly · claude.ai / Mobile',
    descJa: '週次 · claude.ai / モバイル',
    alertLabelEn: '7-Day',
    alertLabelJa: '7日間',
    showLabelEn: '7-Day (claude.ai)',
    showLabelJa: '7日間 (claude.ai)',
    color: '#54c98e',
    periodMs: 7 * DAY,
  },
  {
    key: 'seven_day_oauth_apps',
    shortLabel: 'OA',
    labelEn: '7-Day (OAuth Apps)',
    labelJa: '7日間 (OAuthアプリ)',
    descEn: 'Weekly · Claude Code / Cursor / Windsurf etc.',
    descJa: '週次 · Claude Code / Cursor / Windsurf 等',
    alertLabelEn: '7-Day OAuth',
    alertLabelJa: '7日間 OAuth',
    showLabelEn: '7-Day OAuth Apps (Claude Code etc.)',
    showLabelJa: '7日間 OAuthアプリ (Claude Code 等)',
    color: '#e0a12b',
    periodMs: 7 * DAY,
  },
  {
    key: 'seven_day_opus',
    shortLabel: 'Opus',
    labelEn: '7-Day (Opus)',
    labelJa: '7日間 (Opus)',
    descEn: 'Opus weekly limit',
    descJa: 'Opus専用週次制限',
    alertLabelEn: '7-Day Opus',
    alertLabelJa: '7日間 Opus',
    showLabelEn: '7-Day Opus',
    showLabelJa: '7日間 Opus',
    color: '#b07aee',
    periodMs: 7 * DAY,
  },
  {
    key: 'seven_day_sonnet',
    shortLabel: 'Snt',
    labelEn: '7-Day (Sonnet)',
    labelJa: '7日間 (Sonnet)',
    descEn: 'Sonnet weekly limit (Team)',
    descJa: 'Sonnet週次制限 (Team)',
    alertLabelEn: '7-Day Sonnet',
    alertLabelJa: '7日間 Sonnet',
    showLabelEn: '7-Day Sonnet (Team)',
    showLabelJa: '7日間 Sonnet (Team)',
    color: '#e07aaa',
    periodMs: 7 * DAY,
  },
  {
    key: 'seven_day_cowork',
    shortLabel: 'Cow',
    labelEn: '7-Day (Cowork)',
    labelJa: '7日間 (Cowork)',
    descEn: 'Cowork weekly limit',
    descJa: 'Cowork週次制限',
    alertLabelEn: '7-Day Cowork',
    alertLabelJa: '7日間 Cowork',
    showLabelEn: '7-Day Cowork',
    showLabelJa: '7日間 Cowork',
    color: '#60c0c0',
    periodMs: 7 * DAY,
  },
  {
    key: 'seven_day_omelette',
    shortLabel: 'Oml',
    labelEn: '7-Day (Omelette)',
    labelJa: '7日間 (Omelette)',
    descEn: 'Omelette weekly limit',
    descJa: 'Omelette週次制限',
    alertLabelEn: '7-Day Omelette',
    alertLabelJa: '7日間 Omelette',
    showLabelEn: '7-Day Omelette',
    showLabelJa: '7日間 Omelette',
    color: '#f0a040',
    periodMs: 7 * DAY,
  },
]
