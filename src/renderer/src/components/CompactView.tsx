import { UsageData, Settings } from '../types'

interface Props {
  usage: UsageData | null
  settings: Settings
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

function formatReset(iso: string | null): { date: string; rel: string } {
  if (!iso) return { date: '—', rel: '—' }
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()

  const date = d.toLocaleString([], {
    month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit'
  })

  if (diffMs <= 0) return { date, rel: 'reset' }
  const totalMin = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  let rel = ''
  if (days > 0) rel += `${days}d `
  if (hours > 0) rel += `${hours}h `
  if (days === 0) rel += `${mins}m`
  return { date, rel: rel.trim() }
}

export function CompactView({ usage, settings, onSwitchToDetail, onRefresh }: Props) {
  const visibleBars = BAR_ITEMS.filter(item => {
    if (item.key === 'five_hour')            return settings.tray.show5h
    if (item.key === 'seven_day')            return settings.tray.show7d
    if (item.key === 'seven_day_oauth_apps') return settings.tray.showOauth
    if (item.key === 'seven_day_opus')       return settings.tray.showOpus
    return false
  })

  // 表示するものが1つもなければ全部表示
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
        justifyContent: 'flex-end',
        alignItems: 'center',
        height: 24,
        padding: '0 6px',
        gap: 4,
        WebkitAppRegion: 'drag' as any,
      }}>
        <button
          onClick={onRefresh}
          title="Refresh"
          style={iconBtnStyle}
        >
          ↻
        </button>
        <button
          onClick={onSwitchToDetail}
          title="Detail view"
          style={iconBtnStyle}
        >
          ⊞
        </button>
      </div>

      {/* Bars */}
      <div style={{ padding: '0 4px 4px' }}>
        {bars.map(item => {
          const entry = usage?.[item.key]
          const pct = entry ? Math.min(Math.round(entry.utilization), 100) : 0
          const { date, rel } = formatReset(entry?.resets_at ?? null)
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : item.color

          // バーの中のテキスト: 反転エフェクト (mix-blend-mode: difference)
          const label = `${item.label}  ${date}  ${rel}  ${pct}%`

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

              {/* Text (mix-blend-mode: difference で反転) */}
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
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em',
              }}>
                {label}
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
  color: '#555',
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 4px',
  borderRadius: 3,
  lineHeight: 1,
  WebkitAppRegion: 'no-drag' as any,
}
