import { UsageData, Settings, ExtraUsage, UsageEntry, BetaProvidersData } from '../types'
import { useT } from '../LangContext'
import { useTheme } from '../ThemeContext'
import { calcPacePct } from '../paceUtil'
import { WEEKLY_FIELD_DEFS } from '../fieldDefs'

interface Props {
  usage: UsageData | null
  settings: Settings
  beta?: BetaProvidersData
  lastSuccessAt: Date | null
  isStale: boolean
  onSwitchToDetail: () => void
  onRefresh: () => void
}

interface BarItem {
  key: string
  label: string
  color: string
  periodMs: number
}

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

const FIVE_HOUR_BAR: BarItem = { key: 'five_hour', label: '5H', color: '#4a9eff', periodMs: 5 * HOUR }

interface RelTime {
  major: string
  minor: string
}

function formatReset(iso: string | null, nowLabel: string): { date: string; time: string; rel: RelTime } {
  const empty = { date: '—', time: '—', rel: { major: '—', minor: '' } }
  if (!iso) return empty

  const d = new Date(iso)
  const diffMs = d.getTime() - Date.now()

  const date = d.toLocaleDateString([], { month: 'numeric', day: 'numeric', weekday: 'short' })
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (diffMs <= 0) return { date, time, rel: { major: nowLabel, minor: '' } }

  const totalMin = Math.floor(diffMs / 60000)
  const days  = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins  = totalMin % 60

  let rel: RelTime
  if (days > 0)        rel = { major: `${days}d`,  minor: `${hours}h` }
  else if (hours > 0)  rel = { major: `${hours}h`, minor: `${mins}m`  }
  else                 rel = { major: `${mins}m`,   minor: ''          }

  return { date, time, rel }
}

function formatUpdatedAt(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function CompactView({ usage, settings, beta, lastSuccessAt, isStale, onSwitchToDetail, onRefresh }: Props) {
  const t = useT()
  const th = useTheme()

  const usageRecord = usage as (Record<string, UsageEntry | null> | null)
  const showFields = settings.tray.showFields ?? {}

  const weeklyBarItems: BarItem[] = WEEKLY_FIELD_DEFS.map(f => ({
    key: f.key,
    label: f.shortLabel,
    color: f.color,
    periodMs: f.periodMs,
  }))

  const visibleBars: BarItem[] = []
  if (settings.tray.show5h) visibleBars.push(FIVE_HOUR_BAR)
  for (const item of weeklyBarItems) {
    // フィールドが設定で有効かつ API レスポンスに存在する場合のみ表示
    if ((showFields[item.key] ?? false) && usageRecord?.[item.key] != null) {
      visibleBars.push(item)
    }
  }
  const showExtraBar = settings.tray.showExtra
  const bars = visibleBars.length > 0 || showExtraBar ? visibleBars : [FIVE_HOUR_BAR]

  const barTextStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    fontSize: 11,
    fontWeight: 600,
    color: th.barText,
    mixBlendMode: th.barTextBlend as any,
    gap: 0,
  }

  return (
    <div style={{
      background: th.bg,
      borderRadius: 8,
      border: `1px solid ${th.border}`,
      overflow: 'hidden',
      userSelect: 'none',
      WebkitAppRegion: 'drag' as any,
    }}>
      {/* Button strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 24,
        padding: '0 6px',
        WebkitAppRegion: 'drag' as any,
      }}>
        <div style={{
          fontSize: 10,
          color: isStale ? '#e0a12b' : th.textMuted,
          WebkitAppRegion: 'drag' as any,
        }}>
          {isStale
            ? `${t('stalePrefix')}${formatUpdatedAt(lastSuccessAt)}`
            : lastSuccessAt ? formatUpdatedAt(lastSuccessAt) : ''}
        </div>
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' as any }}>
          <button onClick={onRefresh}        title={t('refresh')}    style={iconBtnStyle(th.iconBtn)}>↻</button>
          <button onClick={onSwitchToDetail} title={t('detailView')} style={iconBtnStyle(th.iconBtn)}>⊞</button>
          <button onClick={() => window.api.openSettings()} title={t('settings')} style={iconBtnStyle(th.iconBtn)}>⚙</button>
        </div>
      </div>

      {/* Bars */}
      <div style={{ padding: '0 4px 4px' }}>
        {bars.map(item => {
          const entry = usageRecord?.[item.key] ?? null
          const pct      = entry ? Math.min(Math.round(entry.utilization), 100) : 0
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : item.color
          const { date, time, rel } = formatReset(entry?.resets_at ?? null, t('timeNow'))
          const resetsAt = entry?.resets_at ?? null
          const pacePct = resetsAt ? calcPacePct(resetsAt, item.periodMs, settings.pace) : null

          return (
            <div key={item.key} style={{ marginBottom: 4, WebkitAppRegion: 'drag' as any }}>
              <div
                style={{
                  position: 'relative',
                  height: 34,
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: th.bgBar,
                }}
              >
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${pct}%`,
                  background: barColor,
                  borderRadius: 4,
                  transition: 'width 0.4s ease',
                }} />
                <div style={barTextStyle}>
                  <span style={{ width: 30, flexShrink: 0 }}>{item.label}</span>
                  <span style={{ width: 72, flexShrink: 0 }}>{date}</span>
                  <span style={{ width: 44, flexShrink: 0 }}>{time}</span>
                  <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>{rel.major}</span>
                  <span style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>{rel.minor}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{pct}%</span>
                </div>
              </div>
              {pacePct != null && (
                <div style={{
                  height: 3,
                  borderRadius: 1,
                  background: th.bgBar,
                  marginTop: 1,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pacePct}%`,
                    height: '100%',
                    background: th.textMuted,
                    borderRadius: 1,
                    opacity: 0.5,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              )}
            </div>
          )
        })}

        {/* Beta provider bars */}
        {settings.betaProviders?.copilot?.enabled && (() => {
          const d = beta?.copilot ?? null
          const pct = d ? Math.min(Math.round(d.utilization), 100) : 0
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : '#6e9ee8'
          const { date, time, rel } = formatReset(d?.resetDate ?? null, t('timeNow'))
          return (
            <div style={{ marginBottom: 4, WebkitAppRegion: 'drag' as any }}>
              <div style={{ position: 'relative', height: 34, borderRadius: 4, overflow: 'hidden', background: th.bgBar }}>
                <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
                <div style={barTextStyle}>
                  <span style={{ width: 30, flexShrink: 0, fontSize: 9 }}>Cpl β</span>
                  <span style={{ width: 72, flexShrink: 0 }}>{d ? date : '—'}</span>
                  <span style={{ width: 44, flexShrink: 0 }}>{d ? time : ''}</span>
                  <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>{d ? rel.major : ''}</span>
                  <span style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>{d ? rel.minor : ''}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{d ? `${pct}%` : '—'}</span>
                </div>
              </div>
            </div>
          )
        })()}
        {settings.betaProviders?.codex?.enabled && (() => {
          const d = beta?.codex ?? null
          const pct = d ? Math.min(Math.round(d.utilization), 100) : 0
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : '#10a37f'
          const { date, time, rel } = formatReset(d?.resetDate ?? null, t('timeNow'))
          return (
            <div style={{ marginBottom: 4, WebkitAppRegion: 'drag' as any }}>
              <div style={{ position: 'relative', height: 34, borderRadius: 4, overflow: 'hidden', background: th.bgBar }}>
                <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
                <div style={barTextStyle}>
                  <span style={{ width: 30, flexShrink: 0, fontSize: 9 }}>Cdx β</span>
                  <span style={{ width: 72, flexShrink: 0 }}>{d ? date : '—'}</span>
                  <span style={{ width: 44, flexShrink: 0 }}>{d ? time : ''}</span>
                  <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>{d ? rel.major : ''}</span>
                  <span style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>{d ? rel.minor : ''}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{d ? `${pct}%` : '—'}</span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Extra usage bar */}
        {showExtraBar && (() => {
          const extra: ExtraUsage | null = usage?.extra_usage ?? null
          const pct = extra ? Math.min(Math.round(extra.utilization), 100) : 0
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : '#a78bfa'
          const creditsText = extra
            ? `${extra.used_credits.toLocaleString()}/${extra.monthly_limit.toLocaleString()}cr`
            : '—'

          return (
            <div
              style={{
                position: 'relative',
                height: 34,
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 4,
                background: th.bgBar,
                WebkitAppRegion: 'drag' as any,
              }}
            >
              <div style={{
                position: 'absolute',
                inset: 0,
                width: `${pct}%`,
                background: barColor,
                borderRadius: 4,
                transition: 'width 0.4s ease',
              }} />
              <div style={barTextStyle}>
                <span style={{ width: 30, flexShrink: 0 }}>EX</span>
                <span style={{ flex: 1 }}>{creditsText}</span>
                <span>{pct}%</span>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function iconBtnStyle(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    color,
    cursor: 'pointer',
    fontSize: 13,
    padding: '2px 4px',
    borderRadius: 3,
    lineHeight: 1,
    WebkitAppRegion: 'no-drag' as any,
  }
}
