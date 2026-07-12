import { useEffect } from 'react'
import { UsageData, Settings, UsageEntry, BetaProvidersData, CcPaceData } from '../types'
import { useTheme } from '../ThemeContext'

function formatCodexWindow(minutes: number | null): string {
  if (minutes == null) return '%'
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}
import { calcPacePct } from '../paceUtil'
import { WEEKLY_FIELD_DEFS } from '../fieldDefs'

interface Props {
  usage: UsageData | null
  settings: Settings
  beta?: BetaProvidersData
  isStale: boolean
  ccPace?: CcPaceData
}

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

interface BarDef {
  key: string
  label: string
  color: string
  pct: number
  resetAt: string | null
  periodMs: number | null
  warning?: boolean
}

function formatRelCompact(iso: string | null): string {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const totalMin = Math.floor(diff / 60000)
  const days  = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins  = totalMin % 60
  if (days > 0)   return hours > 0 ? `${days}d${hours}h` : `${days}d`
  if (hours > 0)  return mins  > 0 ? `${hours}h${mins}m` : `${hours}h`
  return `${mins}m`
}

export function UltraCompactView({ usage, settings, beta, isStale, ccPace }: Props) {
  const th = useTheme()

  const clickThrough = settings.window.clickThrough ?? true
  useEffect(() => {
    if (!clickThrough) return
    window.api.setIgnoreMouseEvents(true)
    return () => window.api.setIgnoreMouseEvents(false)
  }, [clickThrough])

  const usageRecord = usage as (Record<string, UsageEntry | null> | null)
  const showFields = settings.tray.showFields ?? {}

  const barDefs: BarDef[] = []

  const ccPaceWarning = !!(
    ccPace?.minutesToLimit != null &&
    ccPace?.minutesToReset != null &&
    ccPace.minutesToLimit < ccPace.minutesToReset
  )

  if (settings.tray.show5h) {
    const entry = usageRecord?.['five_hour'] ?? null
    barDefs.push({
      key: 'five_hour',
      label: 'Cl5',
      color: '#4a9eff',
      pct: entry ? Math.min(Math.round(entry.utilization), 100) : 0,
      resetAt: entry?.resets_at ?? null,
      periodMs: 5 * HOUR,
      warning: ccPaceWarning,
    })
  }

  for (const f of WEEKLY_FIELD_DEFS) {
    if ((showFields[f.key] ?? false) && usageRecord?.[f.key] != null) {
      const entry = usageRecord[f.key]!
      barDefs.push({
        key: f.key,
        label: `Cl${f.shortLabel}`,
        color: f.color,
        pct: Math.min(Math.round(entry.utilization), 100),
        resetAt: entry.resets_at ?? null,
        periodMs: f.periodMs,
      })
    }
  }

  if (settings.tray.showExtra && usage?.extra_usage) {
    const extra = usage.extra_usage
    barDefs.push({
      key: 'extra',
      label: 'ClEX',
      color: '#a78bfa',
      pct: Math.min(Math.round(extra.utilization ?? 0), 100),
      resetAt: null,
      periodMs: null,
    })
  }

  if (settings.betaProviders?.copilot?.enabled && beta?.copilot) {
    const d = beta.copilot
    barDefs.push({
      key: 'copilot',
      label: 'βCpl',
      color: '#6e9ee8',
      pct: Math.min(Math.round(d.utilization), 100),
      resetAt: d.resetDate ?? null,
      periodMs: 30 * DAY,
    })
  }

  if (settings.codex?.enabled && beta?.codex) {
    const d = beta.codex
    if ((settings.tray.showCodexPrimary ?? true) && d.fiveHourUtilization != null) {
      barDefs.push({
        key: 'codex5h',
        label: `Cx${formatCodexWindow(d.primaryWindowMinutes)}`,
        color: '#10a37f',
        pct: Math.min(Math.round(d.fiveHourUtilization), 100),
        resetAt: d.fiveHourResetDate ?? null,
        periodMs: (d.primaryWindowMinutes ?? 5 * 60) * 60_000,
      })
    }
    if ((settings.tray.showCodexSecondary ?? true) && (d.secondaryWindowMinutes != null || d.fiveHourUtilization == null)) {
      barDefs.push({
        key: 'codex-secondary',
        label: `Cx${formatCodexWindow(d.secondaryWindowMinutes)}`,
        color: '#10a37f',
        pct: Math.min(Math.round(d.utilization), 100),
        resetAt: d.resetDate ?? null,
        periodMs: (d.secondaryWindowMinutes ?? 7 * 24 * 60) * 60_000,
      })
    }
  }


  if (barDefs.length === 0) {
    const entry = usageRecord?.['five_hour'] ?? null
    barDefs.push({
      key: 'five_hour',
      label: 'Cl5',
      color: '#4a9eff',
      pct: entry ? Math.min(Math.round(entry.utilization), 100) : 0,
      resetAt: entry?.resets_at ?? null,
      periodMs: 5 * HOUR,
      warning: ccPaceWarning,
    })
  }

  const textStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '0 5px',
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    textShadow: '0 0 3px #000, 0 1px 3px rgba(0,0,0,0.9), 1px 0 3px rgba(0,0,0,0.8), -1px 0 3px rgba(0,0,0,0.8)',
    gap: 0,
  }

  return (
    <div style={{
      background: th.isDark ? 'rgba(12,12,16,0.72)' : 'rgba(230,230,240,0.72)',
      borderRadius: 6,
      border: `1px solid ${th.border}`,
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      {/* Drag handle */}
      <div style={{ height: 4, WebkitAppRegion: 'drag' as any }} />

      {/* Bars */}
      <div style={{ padding: '0 4px 4px' }}>
        {barDefs.map((item, i) => {
          const barColor = item.pct >= 90 ? '#e05a2b' : item.pct >= 70 ? '#e0a12b' : item.color
          const rel = formatRelCompact(item.resetAt)
          const isLast = i === barDefs.length - 1
          const pacePct = (item.resetAt && item.periodMs)
            ? calcPacePct(item.resetAt, item.periodMs, settings.pace)
            : null
          return (
            <div
              key={item.key}
              style={{
                position: 'relative',
                height: 16,
                borderRadius: 3,
                overflow: 'hidden',
                background: isStale ? 'rgba(224,161,43,0.12)' : th.bgBar,
                marginBottom: isLast ? 0 : 2,
                boxShadow: item.warning ? 'inset 0 0 0 1px #e05a2b' : undefined,
              }}
            >
              <div style={{
                position: 'absolute',
                inset: 0,
                width: `${item.pct}%`,
                background: barColor,
                borderRadius: 3,
                transition: 'width 0.4s ease',
              }} />
              {pacePct != null && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${pacePct}%`,
                  width: 2,
                  marginLeft: -1,
                  background: 'rgba(255,255,255,0.7)',
                  boxShadow: '0 0 2px rgba(0,0,0,0.8)',
                  transition: 'left 0.4s ease',
                }} />
              )}
              <div style={textStyle}>
                <span style={{ width: 24, flexShrink: 0 }}>{item.warning ? '🔥' : item.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ marginRight: 4 }}>{rel}</span>
                <span style={{ minWidth: 26, textAlign: 'right' }}>{item.pct}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
