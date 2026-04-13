import { UsageEntry, Settings } from '../types'
import { useT } from '../LangContext'
import { useTheme } from '../ThemeContext'
import { calcPacePct } from '../paceUtil'

interface Props {
  label: string
  description: string
  entry: UsageEntry
  color: string
  highlight?: boolean
  periodMs: number
  paceSettings?: Settings['pace']
}

function formatResetAt(iso: string | null, resettingLabel: string): { abs: string; rel: string } {
  if (!iso) return { abs: '—', rel: '—' }
  const d = new Date(iso)
  const diffMs = d.getTime() - Date.now()

  const abs = d.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

  if (diffMs <= 0) return { abs, rel: resettingLabel }

  const totalMin = Math.floor(diffMs / 60000)
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60

  let rel = ''
  if (days > 0) rel += `${days}d `
  if (hours > 0) rel += `${hours}h `
  if (days === 0) rel += `${mins}m`
  return { abs, rel: rel.trim() }
}

export function UsageCard({ label, description, entry, color, highlight, periodMs, paceSettings }: Props) {
  const t = useT()
  const th = useTheme()
  const pct = Math.min(Math.round(entry.utilization), 100)
  const { abs, rel } = formatResetAt(entry.resets_at, t('resetting'))
  const pacePct = entry.resets_at ? calcPacePct(entry.resets_at, periodMs, paceSettings) : null

  const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : color

  return (
    <div style={{
      background: highlight ? th.bgCardHL : th.bgCard,
      border: `1px solid ${highlight ? th.borderCardHL : th.borderCard}`,
      borderRadius: 8,
      padding: '8px 10px',
      marginBottom: 6
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: th.textSub }}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: barColor }}>{pct}%</span>
      </div>

      <div style={{
        background: th.bgBar,
        borderRadius: 3,
        height: 5,
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: barColor,
          borderRadius: 3,
          transition: 'width 0.4s ease'
        }} />
      </div>
      {pacePct != null && (
        <div style={{
          height: 3,
          borderRadius: 1,
          background: th.bgBar,
          marginTop: 1,
          marginBottom: 4,
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
      {pacePct == null && <div style={{ marginBottom: 6 }} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: th.textMuted }}>{t('resetLabel')} <span style={{ color: th.textValue }}>{abs}</span></span>
        <span style={{ color: th.textMuted }}>{t('remaining')} <span style={{ color: th.textValue }}>{rel}</span></span>
      </div>

      <div style={{ fontSize: 10, color: th.textDesc, marginTop: 3 }}>{description}</div>
    </div>
  )
}
