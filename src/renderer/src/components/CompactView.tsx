import { UsageData, Settings } from '../types'

interface Props {
  usage: UsageData | null
  settings: Settings
  lastSuccessAt: Date | null
  isStale: boolean
  onSwitchToDetail: () => void
  onRefresh: () => void
}

interface BarItem {
  key: keyof UsageData
  label: string
  color: string
}

const BAR_ITEMS: BarItem[] = [
  { key: 'five_hour',            label: '5H',   color: '#4a9eff' },
  { key: 'seven_day',            label: '7D',   color: '#54c98e' },
  { key: 'seven_day_oauth_apps', label: 'OA',   color: '#e0a12b' },
  { key: 'seven_day_opus',       label: 'Opus', color: '#b07aee' },
]

/** 残り時間を major / minor に分解 */
interface RelTime {
  major: string   // "3d" / "11h" / "45m" など
  minor: string   // "7h" / "4m" / ""
}

function formatReset(iso: string | null): { date: string; time: string; rel: RelTime } {
  const empty = { date: '—', time: '—', rel: { major: '—', minor: '' } }
  if (!iso) return empty

  const d = new Date(iso)
  const diffMs = d.getTime() - Date.now()

  const date = d.toLocaleDateString([], { month: 'numeric', day: 'numeric', weekday: 'short' })
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (diffMs <= 0) return { date, time, rel: { major: 'now', minor: '' } }

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

export function CompactView({ usage, settings, lastSuccessAt, isStale, onSwitchToDetail, onRefresh }: Props) {
  const visibleBars = BAR_ITEMS.filter(item => {
    if (item.key === 'five_hour')            return settings.tray.show5h
    if (item.key === 'seven_day')            return settings.tray.show7d
    if (item.key === 'seven_day_oauth_apps') return settings.tray.showOauth
    if (item.key === 'seven_day_opus')       return settings.tray.showOpus
    return false
  })
  const bars = visibleBars.length > 0 ? visibleBars : BAR_ITEMS

  return (
    <div style={{
      background: 'rgba(18,18,22,0.93)',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.08)',
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
        {/* 更新時刻 / stale 警告 */}
        <div style={{
          fontSize: 10,
          color: isStale ? '#e0a12b' : '#888',
          WebkitAppRegion: 'drag' as any,
        }}>
          {isStale
            ? `⚠ stale — ${formatUpdatedAt(lastSuccessAt)}`
            : lastSuccessAt ? formatUpdatedAt(lastSuccessAt) : ''}
        </div>
        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' as any }}>
          <button onClick={onRefresh}        title="Refresh"      style={iconBtnStyle}>↻</button>
          <button onClick={onSwitchToDetail} title="Detail view"  style={iconBtnStyle}>⊞</button>
        </div>
      </div>

      {/* Bars */}
      <div style={{ padding: '0 4px 4px' }}>
        {bars.map(item => {
          const entry = usage?.[item.key]
          const pct      = entry ? Math.min(Math.round(entry.utilization), 100) : 0
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : item.color
          const { date, time, rel } = formatReset(entry?.resets_at ?? null)

          return (
            <div
              key={item.key}
              style={{
                position: 'relative',
                height: 34,
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 4,
                background: 'rgba(255,255,255,0.06)',
                WebkitAppRegion: 'drag' as any,
              }}
            >
              {/* Fill */}
              <div style={{
                position: 'absolute',
                inset: 0,
                width: `${pct}%`,
                background: barColor,
                borderRadius: 4,
                transition: 'width 0.4s ease',
              }} />

              {/* Text columns (mix-blend-mode: difference で反転) */}
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                fontSize: 11,
                fontWeight: 600,
                color: '#ffffff',
                mixBlendMode: 'difference',
                gap: 0,
              }}>
                {/* ラベル */}
                <span style={{ width: 30, flexShrink: 0 }}>{item.label}</span>
                {/* リセット日付 */}
                <span style={{ width: 72, flexShrink: 0 }}>{date}</span>
                {/* リセット時刻 */}
                <span style={{ width: 44, flexShrink: 0 }}>{time}</span>
                {/* 残り major (Xd / Xh / Xm) 右揃え */}
                <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>{rel.major}</span>
                {/* 残り minor (Xh / Xm / 空) 右揃え */}
                <span style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>{rel.minor}</span>
                {/* % 右揃え */}
                <span style={{ flex: 1, textAlign: 'right' }}>{pct}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#777',
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 4px',
  borderRadius: 3,
  lineHeight: 1,
  WebkitAppRegion: 'no-drag' as any,
}
