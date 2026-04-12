import { useState } from 'react'
import { UsageData, ProfileData, ExtraUsage } from '../types'
import { UsageCard } from './UsageCard'
import { HistoryChart } from './HistoryChart'
import { useT } from '../LangContext'
import { useTheme } from '../ThemeContext'

interface Props {
  usage: UsageData | null
  profile: ProfileData | null
  lastSuccessAt: Date | null
  isStale: boolean
  onSwitchToCompact: () => void
  onRefresh: () => void
}

function planLabel(p: ProfileData, usage?: UsageData | null): string {
  const tier = (p.organization?.rate_limit_tier ?? '').toLowerCase()

  // tier 文字列マッチ（大文字小文字・命名規則の違いを吸収）
  if (tier.includes('5x'))          return 'Max 5x'
  if (tier.includes('max'))         return 'Max'
  if (tier.includes('enterprise'))  return 'Enterprise'
  if (tier.includes('raven'))       return 'Team'   // default_raven = Team Premium
  if (tier.includes('team'))        return 'Team'
  if (tier.includes('business'))    return 'Business'
  if (tier.includes('pro'))         return 'Pro'
  if (tier.includes('free'))        return 'Free'

  // API フラグによる判定
  if (p.account?.has_claude_max) return 'Max'
  if (p.account?.has_claude_pro) return 'Pro'

  // 使用量データからの推論（フォールバック）
  if (usage?.seven_day_oauth_apps) return 'Max'
  if (usage?.extra_usage?.is_enabled) return 'Pro+'
  if (usage?.seven_day) return 'Pro'

  // 生の tier 文字列を短縮して表示（空なら ? ）
  const raw = p.organization?.rate_limit_tier ?? ''
  return raw ? raw.split('_').slice(0, 2).join(' ') : '?'
}

export function DetailView({ usage, profile, lastSuccessAt, isStale, onSwitchToCompact, onRefresh }: Props) {
  const t = useT()
  const th = useTheme()
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
      background: th.bg,
      borderRadius: 12,
      border: `1px solid ${th.border}`,
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
        borderBottom: `1px solid ${th.borderSection}`,
        WebkitAppRegion: 'drag' as any,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: th.textSub }}>Claude Usage HUD</span>
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
              {planLabel(profile, usage)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as any }}>
          <button onClick={onRefresh}          title={t('refresh')}     style={iconBtn(th.iconBtn)}>↻</button>
          <button onClick={onSwitchToCompact}  title={t('compactView')} style={iconBtn(th.iconBtn)}>⊟</button>
          <button onClick={() => window.api.openSettings()} title={t('settings')} style={iconBtn(th.iconBtn)}>⚙</button>
        </div>
      </div>

      {/* Profile */}
      {profile && (
        <div style={{ padding: '6px 14px 2px', fontSize: 11, color: th.textMuted }}>
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
            {usage.seven_day_sonnet && (
              <UsageCard label={t('label7dSonnet')} description={t('desc7dSonnet')} entry={usage.seven_day_sonnet} color="#e07aaa" />
            )}
            {usage.extra_usage?.is_enabled && (
              <ExtraUsageCard extra={usage.extra_usage} />
            )}
          </>
        ) : (
          <div style={{ color: th.textFaint, textAlign: 'center', padding: '20px 0', fontSize: 12 }}>
            {t('loading')}
          </div>
        )}
      </div>

      {/* History */}
      <div style={{ borderTop: `1px solid ${th.borderSection}`, padding: '6px 12px' }}>
        <button
          onClick={() => setShowChart(!showChart)}
          style={{ background: 'none', border: 'none', color: th.textMuted, cursor: 'pointer', fontSize: 12, padding: 0 }}
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
                    background: chartDays === d ? th.bgSelected : 'none',
                    border: `1px solid ${th.borderInput}`,
                    color: chartDays === d ? th.text : th.textMuted,
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
          <span style={{ color: th.textMuted }}>
            {t('updated', formatAge(lastSuccessAt))}
          </span>
        )}
      </div>
    </div>
  )
}

function ExtraUsageCard({ extra }: { extra: ExtraUsage }) {
  const t = useT()
  const th = useTheme()
  const pct = Math.min(Math.round(extra.utilization), 100)
  const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : '#a78bfa'

  return (
    <div style={{
      background: th.bgCardExtra,
      border: `1px solid ${th.borderCardExtra}`,
      borderRadius: 8,
      padding: '8px 10px',
      marginBottom: 6
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: th.textSub }}>{t('labelExtra')}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: barColor }}>{pct}%</span>
      </div>
      <div style={{
        background: th.bgBar, borderRadius: 3, height: 5, marginBottom: 6, overflow: 'hidden'
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: th.textMuted }}>
          {extra.used_credits.toLocaleString()} / {extra.monthly_limit.toLocaleString()} {t('creditsUnit')}
        </span>
        <span style={{ color: th.textMuted }}>{t('monthlyReset')}</span>
      </div>
      <div style={{ fontSize: 10, color: th.textDesc, marginTop: 3 }}>{t('descExtra')}</div>
    </div>
  )
}

function iconBtn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    color,
    cursor: 'pointer',
    fontSize: 14,
    padding: '2px 4px',
    borderRadius: 4,
    lineHeight: 1,
  }
}
