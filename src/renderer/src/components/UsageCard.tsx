import { UsageEntry } from '../types'
import { useT } from '../LangContext'

interface Props {
  label: string
  description: string
  entry: UsageEntry
  color: string
  highlight?: boolean
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

export function UsageCard({ label, description, entry, color, highlight }: Props) {
  const t = useT()
  const pct = Math.min(Math.round(entry.utilization), 100)
  const { abs, rel } = formatResetAt(entry.resets_at, t('resetting'))

  const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : color

  return (
    <div style={{
      background: highlight ? 'rgba(224,161,43,0.06)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${highlight ? 'rgba(224,161,43,0.2)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 8,
      padding: '8px 10px',
      marginBottom: 6
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc' }}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: barColor }}>{pct}%</span>
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 3,
        height: 5,
        marginBottom: 6,
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

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: '#888' }}>{t('resetLabel')} <span style={{ color: '#bbb' }}>{abs}</span></span>
        <span style={{ color: '#888' }}>{t('remaining')} <span style={{ color: '#bbb' }}>{rel}</span></span>
      </div>

      <div style={{ fontSize: 10, color: '#777', marginTop: 3 }}>{description}</div>
    </div>
  )
}
