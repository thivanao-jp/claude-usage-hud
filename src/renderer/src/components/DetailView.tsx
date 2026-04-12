import { useState } from 'react'
import { UsageData, ProfileData } from '../types'
import { UsageCard } from './UsageCard'
import { HistoryChart } from './HistoryChart'
import { useT } from '../LangContext'

interface Props {
  usage: UsageData | null
  profile: ProfileData | null
  lastSuccessAt: Date | null
  isStale: boolean
  onSwitchToCompact: () => void
  onRefresh: () => void
}

function planLabel(p: ProfileData): string {
  const tier = p.organization?.rate_limit_tier ?? ''
  if (tier.includes('5x')) return 'Max 5x'
  if (tier.includes('max') || p.account?.has_claude_max) return 'Max'
  if (p.account?.has_claude_pro) return 'Pro'
  return tier || 'Unknown'
}

export function DetailView({ usage, profile, lastSuccessAt, isStale, onSwitchToCompact, onRefresh }: Props) {
  const t = useT()
  const [showChart, setShowChart] = useState(false)
  const [chartDays, setChartDays] = useState(7)

  function formatAge(d: Date | null): string {
    if (!d) return t('unknown')
    const mins = Math.floor((Date.now() - d.getTime()) / 60000)
    if (mins < 1) return t('justNow')
    if (mins < 60) return t('minutesAgo', mins)
    const hours = Math.floor(mins / 60)
    if (hours < 24) return t('hoursAgo', hours)
    return t('daysAgo', Math.floor(hours / 24))
  }

  return (
    <div style={{
      background: 'rgba(18,18,22,0.93)',
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
      minWidth: 320,
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px 6px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        WebkitAppRegion: 'drag' as any,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc' }}>Claude Usage HUD</span>
          {profile && (
            <span style={{
              background: '#e05a2b22',
              color: '#e07a4b',
              border: '1px solid #e05a2b44',
              borderRadius: 4,
              padding: '1px 6px',
              fontSize: 11,
              fontWeight: 600,
            }}>
              {planLabel(profile)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as any }}>
          <button onClick={onRefresh}          title={t('refresh')}     style={iconBtn}>↻</button>
          <button onClick={onSwitchToCompact}  title={t('compactView')} style={iconBtn}>⊟</button>
          <button onClick={() => window.api.openSettings()} title={t('settings')} style={iconBtn}>⚙</button>
        </div>
      </div>

      {/* Profile */}
      {profile && (
        <div style={{ padding: '6px 14px 2px', fontSize: 11, color: '#888' }}>
          {profile.account?.email}
          {profile.organization?.name ? ` · ${profile.organization.name}` : ''}
        </div>
      )}

      {/* Usage Cards */}
      <div style={{ padding: '6px 10px 4px' }}>
        {usage ? (
          <>
            {usage.five_hour && (
              <UsageCard label={t('label5h')} description={t('desc5h')} entry={usage.five_hour} color="#4a9eff" />
            )}
            {usage.seven_day && (
              <UsageCard label={t('label7d')} description={t('desc7d')} entry={usage.seven_day} color="#54c98e" />
            )}
            {usage.seven_day_oauth_apps && (
              <UsageCard label={t('label7dOauth')} description={t('desc7dOauth')} entry={usage.seven_day_oauth_apps} color="#e0a12b" highlight />
            )}
            {usage.seven_day_opus && (
              <UsageCard label={t('label7dOpus')} description={t('desc7dOpus')} entry={usage.seven_day_opus} color="#b07aee" />
            )}
          </>
        ) : (
          <div style={{ color: '#555', textAlign: 'center', padding: '20px 0', fontSize: 12 }}>
            {t('loading')}
          </div>
        )}
      </div>

      {/* History */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '6px 12px' }}>
        <button
          onClick={() => setShowChart(!showChart)}
          style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, padding: 0 }}
        >
          {showChart ? '▲' : '▼'} {t('usageHistory')}
        </button>
        {showChart && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[1, 7, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setChartDays(d)}
                  style={{
                    background: chartDays === d ? '#333' : 'none',
                    border: '1px solid #333',
                    color: chartDays === d ? '#e8e8e8' : '#888',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
            <HistoryChart days={chartDays} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 12px 6px', fontSize: 10, textAlign: 'right' }}>
        {isStale ? (
          <span style={{ color: '#e0a12b' }}>
            {t('staleLastSuccess', lastSuccessAt
              ? lastSuccessAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : t('unknown'))}
          </span>
        ) : (
          <span style={{ color: '#888' }}>
            {t('updated', formatAge(lastSuccessAt))}
          </span>
        )}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#555',
  cursor: 'pointer',
  fontSize: 14,
  padding: '2px 4px',
  borderRadius: 4,
  lineHeight: 1,
}
