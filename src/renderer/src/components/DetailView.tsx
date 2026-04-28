import { useState, useEffect } from 'react'
import { UsageData, ProfileData, ExtraUsage, Settings, UsageEntry, BetaProvidersData, CopilotUsageData, CodexUsageData } from '../types'
import { UsageCard } from './UsageCard'
import { HistoryChart } from './HistoryChart'
import { useT } from '../LangContext'
import { useTheme } from '../ThemeContext'
import { WEEKLY_FIELD_DEFS } from '../fieldDefs'
import { useLang } from '../LangContext'

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR

function getWeeklyEntry(usage: UsageData, key: string): UsageEntry | null {
  return (usage as unknown as Record<string, UsageEntry | null>)[key] ?? null
}

interface Props {
  usage: UsageData | null
  profile: ProfileData | null
  settings: Settings
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

export function DetailView({ usage, profile, settings, lastSuccessAt, isStale, onSwitchToCompact, onRefresh }: Props) {
  const t = useT()
  const th = useTheme()
  const lang = useLang()
  const [showChart, setShowChart] = useState(false)
  const [chartDays, setChartDays] = useState(7)
  const [beta, setBeta] = useState<BetaProvidersData>({ copilot: null, codex: null })

  useEffect(() => {
    window.api.getBetaData().then(setBeta).catch(() => {})
  }, [usage])

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
              <UsageCard label={t('label5h')} description={t('desc5h')} entry={usage.five_hour} color="#4a9eff" periodMs={5 * HOUR} paceSettings={settings.pace} />
            )}
            {WEEKLY_FIELD_DEFS.map(field => {
              const entry = getWeeklyEntry(usage, field.key)
              if (!entry) return null
              const label = lang === 'ja' ? field.labelJa : field.labelEn
              const desc  = lang === 'ja' ? field.descJa  : field.descEn
              return (
                <UsageCard
                  key={field.key}
                  label={label}
                  description={desc}
                  entry={entry}
                  color={field.color}
                  periodMs={field.periodMs}
                  paceSettings={settings.pace}
                />
              )
            })}
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

      {/* Beta Provider Cards */}
      {(settings.betaProviders?.copilot?.enabled || settings.betaProviders?.codex?.enabled) && (
        <div style={{ padding: '0 10px 4px' }}>
          <div style={{ fontSize: 10, color: th.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, paddingLeft: 2 }}>
            β Providers
          </div>
          {settings.betaProviders?.copilot?.enabled && (
            <BetaUsageCard
              label="GitHub Copilot"
              data={beta.copilot}
              color="#6e9ee8"
              unit="requests"
            />
          )}
          {settings.betaProviders?.codex?.enabled && (
            <BetaUsageCard
              label="OpenAI Codex"
              data={beta.codex}
              color="#10a37f"
              unit={beta.codex?.unit ?? 'tasks'}
            />
          )}
        </div>
      )}

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

function BetaUsageCard({ label, data, color, unit }: { label: string; data: CopilotUsageData | CodexUsageData | null; color: string; unit: string }) {
  const t = useT()
  const th = useTheme()

  if (!data) {
    return (
      <div style={{ background: th.bgCardExtra, border: `1px solid ${th.borderCardExtra}`, borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: th.textSub }}>{label}</span>
          <span style={{ fontSize: 10, color: '#e0a12b', background: '#e0a12b18', border: '1px solid #e0a12b33', borderRadius: 4, padding: '1px 6px' }}>β</span>
        </div>
        <div style={{ fontSize: 11, color: th.textFaint, marginTop: 4 }}>{t('betaDataUnavailable')}</div>
      </div>
    )
  }

  const pct = Math.min(Math.round(data.utilization), 100)
  const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : color

  return (
    <div style={{ background: th.bgCardExtra, border: `1px solid ${th.borderCardExtra}`, borderRadius: 8, padding: '7px 10px', marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: th.textSub }}>{label}</span>
          <span style={{ fontSize: 10, color: '#e0a12b', background: '#e0a12b18', border: '1px solid #e0a12b33', borderRadius: 4, padding: '1px 5px' }}>β</span>
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, color: barColor }}>{pct}%</span>
      </div>
      <div style={{ background: th.bgBar, borderRadius: 3, height: 5, marginBottom: 5, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: th.textMuted }}>
          {t('betaMonthlyUsed', data.used.toLocaleString(), data.limit.toLocaleString(), unit)}
        </span>
        {data.resetDate && (
          <span style={{ color: th.textMuted }}>
            {t('betaResetLabel')} {new Date(data.resetDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
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
