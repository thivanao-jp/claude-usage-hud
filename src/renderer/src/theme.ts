export interface ThemeTokens {
  isDark: boolean
  // backgrounds
  bg: string
  bgPanel: string
  bgBar: string
  bgCard: string
  bgCardHL: string
  bgCardExtra: string
  bgInput: string
  bgSelected: string
  bgChartTooltip: string
  // borders
  border: string
  borderSection: string
  borderCard: string
  borderCardHL: string
  borderCardExtra: string
  borderInput: string
  borderChart: string
  borderChartTooltip: string
  // text
  text: string
  textSub: string
  textValue: string
  textLabel: string
  textMuted: string
  textDesc: string
  textFaint: string
  textFaint2: string
  // interactive
  iconBtn: string
  // compact bar
  barText: string
  barTextBlend: 'difference' | 'normal'
  // chart
  chartRefLine: string
  chartLegend: string
  chartTick: string
}

export type ThemeSetting = 'auto' | 'dark' | 'light'

const dark: ThemeTokens = {
  isDark: true,
  bg: 'rgba(18,18,22,0.93)',
  bgPanel: '#1a1a1f',
  bgBar: 'rgba(255,255,255,0.06)',
  bgCard: 'rgba(255,255,255,0.03)',
  bgCardHL: 'rgba(224,161,43,0.06)',
  bgCardExtra: 'rgba(167,139,250,0.06)',
  bgInput: '#252530',
  bgSelected: '#333',
  bgChartTooltip: 'rgba(20,20,25,0.95)',
  border: 'rgba(255,255,255,0.08)',
  borderSection: 'rgba(255,255,255,0.06)',
  borderCard: 'rgba(255,255,255,0.06)',
  borderCardHL: 'rgba(224,161,43,0.2)',
  borderCardExtra: 'rgba(167,139,250,0.2)',
  borderInput: '#333',
  borderChart: 'rgba(255,255,255,0.06)',
  borderChartTooltip: 'rgba(255,255,255,0.1)',
  text: '#e8e8e8',
  textSub: '#ccc',
  textValue: '#bbb',
  textLabel: '#aaa',
  textMuted: '#888',
  textDesc: '#777',
  textFaint: '#666',
  textFaint2: '#555',
  iconBtn: '#555',
  barText: '#ffffff',
  barTextBlend: 'difference',
  chartRefLine: 'rgba(255,255,255,0.45)',
  chartLegend: '#666',
  chartTick: '#555',
}

const light: ThemeTokens = {
  isDark: false,
  bg: 'rgba(245,245,250,0.96)',
  bgPanel: '#f2f2f7',
  bgBar: 'rgba(0,0,0,0.08)',
  bgCard: 'rgba(0,0,0,0.04)',
  bgCardHL: 'rgba(224,161,43,0.08)',
  bgCardExtra: 'rgba(124,58,237,0.05)',
  bgInput: '#e5e5ea',
  bgSelected: '#e0e0e8',
  bgChartTooltip: 'rgba(250,250,255,0.98)',
  border: 'rgba(0,0,0,0.12)',
  borderSection: 'rgba(0,0,0,0.08)',
  borderCard: 'rgba(0,0,0,0.08)',
  borderCardHL: 'rgba(224,161,43,0.3)',
  borderCardExtra: 'rgba(124,58,237,0.2)',
  borderInput: '#c0c0c8',
  borderChart: 'rgba(0,0,0,0.07)',
  borderChartTooltip: 'rgba(0,0,0,0.12)',
  text: '#1a1a1f',
  textSub: '#333',
  textValue: '#444',
  textLabel: '#555',
  textMuted: '#666',
  textDesc: '#777',
  textFaint: '#888',
  textFaint2: '#999',
  iconBtn: '#666',
  barText: '#1a1a1f',
  barTextBlend: 'normal',
  chartRefLine: 'rgba(0,0,0,0.3)',
  chartLegend: '#888',
  chartTick: '#666',
}

export const themes = { dark, light }

export function resolveTheme(setting: ThemeSetting): ThemeTokens {
  if (setting === 'dark') return dark
  if (setting === 'light') return light
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return dark
  }
  return light
}
