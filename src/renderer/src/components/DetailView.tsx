import { useState } from 'react'
import { UsageData, ProfileData } from '../types'
import { UsageCard } from './UsageCard'
import { HistoryChart } from './HistoryChart'

interface Props {
  usage: UsageData | null
  profile: ProfileData | null
}

function planLabel(p: ProfileData): string {
  const tier = p.organization?.rate_limit_tier ?? ''
  if (tier.includes('5x')) return 'Max 5x'
  if (tier.includes('max') || p.account?.has_claude_max) return 'Max'
  if (p.account?.has_claude_pro) return 'Pro'
  return tier || 'Unknown'
}

export function DetailView({ usage, profile }: Props) {
  const [showChart, setShowChart] = useState(false)
  const [chartDays, setChartDays] = useState(7)

  const now = new Date()
  const lastUpdated = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{
      background: 'rgba(18,18,22,0.93)',
      borderRadius: 12,
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
      minWidth: 320
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px 8px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        WebkitAppRegion: 'drag' as any
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8' }}>Claude Usage HUD</span>
          {profile && (
            <span style={{
              background: '#e05a2b22',
              color: '#e07a4b',
              border: '1px solid #e05a2b44',
              borderRadius: 4,
              padding: '1px 6px',
              fontSize: 11,
              fontWeight: 600
            }}>
              {planLabel(profile)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, WebkitAppRegion: 'no-drag' as any }}>
          <button onClick={() => window.api.refresh()} title="Refresh" style={iconBtn}>↻</button>
          <button onClick={() => window.api.openSettings()} title="Settings" style={iconBtn}>⚙</button>
          <button onClick={() => window.api.closeDetail()} title="Hide" style={iconBtn}>✕</button>
        </div>
      </div>

      {/* Profile */}
      {profile && (
        <div style={{ padding: '8px 14px 4px', fontSize: 11, color: '#777' }}>
          {profile.account?.email} · {profile.organization?.name}
        </div>
      )}

      {/* Usage Cards */}
      <div style={{ padding: '6px 10px 8px' }}>
        {usage ? (
          <>
            {usage.five_hour && (
              <UsageCard
                label="5-Hour Window"
                description="短期バースト制限（ローリング）"
                entry={usage.five_hour}
                color="#4a9eff"
              />
            )}
            {usage.seven_day && (
              <UsageCard
                label="7-Day (claude.ai)"
                description="週次制限 · claude.ai / モバイル直接利用"
                entry={usage.seven_day}
                color="#54c98e"
              />
            )}
            {usage.seven_day_oauth_apps && (
              <UsageCard
                label="7-Day (OAuth Apps)"
                description="週次制限 · Claude Code / Cursor / Windsurf 等"
                entry={usage.seven_day_oauth_apps}
                color="#e0a12b"
                highlight
              />
            )}
            {usage.seven_day_opus && (
              <UsageCard
                label="7-Day (Opus)"
                description="Opus モデル専用の週次制限"
                entry={usage.seven_day_opus}
                color="#b07aee"
              />
            )}
          </>
        ) : (
          <div style={{ color: '#555', textAlign: 'center', padding: '20px 0', fontSize: 12 }}>
            Loading...
          </div>
        )}
      </div>

      {/* History Toggle */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '6px 14px' }}>
        <button
          onClick={() => setShowChart(!showChart)}
          style={{
            background: 'none', border: 'none', color: '#666',
            cursor: 'pointer', fontSize: 12, padding: 0
          }}
        >
          {showChart ? '▲' : '▼'} Usage History
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
                    color: chartDays === d ? '#e8e8e8' : '#666',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer'
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
      <div style={{
        padding: '4px 14px 8px',
        fontSize: 10,
        color: '#444',
        textAlign: 'right'
      }}>
        Updated {lastUpdated}
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
  lineHeight: 1
}
