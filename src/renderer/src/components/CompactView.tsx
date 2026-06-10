import { useEffect, useRef } from 'react'
import { UsageData, Settings, ExtraUsage, UsageEntry, BetaProvidersData, GeminiModelData, CcPaceData } from '../types'
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
  ccPace?: CcPaceData
  onSwitchToDetail: () => void
  onRefresh: () => void
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatUsd(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString()
  if (n >= 1) return n.toFixed(1)
  return n.toFixed(2)
}

function formatMinutes(min: number): string {
  const totalMin = Math.max(0, Math.round(min))
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours > 0) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`
  return `${mins}m`
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

export function CompactView({ usage, settings, beta, lastSuccessAt, isStale, ccPace, onSwitchToDetail, onRefresh }: Props) {
  const t = useT()
  const th = useTheme()
  const titleBarRef = useRef<HTMLDivElement>(null)

  const isTransparent = (settings.window.opacity ?? 100) < 100
  const clickThrough = settings.window.clickThrough ?? true
  // clickThrough OFF または非透過時はバー部分もドラッグ可
  const barRegion = (isTransparent && clickThrough) ? 'no-drag' : 'drag'

  // ドラッグ終了（mouseup）で元の不透明度に即時復元（main の 2 秒フォールバックより優先）
  useEffect(() => {
    if (!isTransparent) return
    const restore = () => window.api.setWindowOpacity(settings.window.opacity / 100)
    document.addEventListener('mouseup', restore)
    return () => document.removeEventListener('mouseup', restore)
  }, [isTransparent, settings.window.opacity])

  // 半透明 + clickThrough 有効時: タイトルバー上のみクリック可、それ以外はクリックスルー
  useEffect(() => {
    if (!isTransparent || !clickThrough) return
    window.api.setIgnoreMouseEvents(true)
    let prevOver = false
    const onMouseMove = (e: MouseEvent) => {
      const rect = titleBarRef.current?.getBoundingClientRect()
      const isOver = !!rect &&
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom
      if (isOver !== prevOver) {
        prevOver = isOver
        window.api.setIgnoreMouseEvents(!isOver)
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      window.api.setIgnoreMouseEvents(false)
    }
  }, [isTransparent, clickThrough])


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
      WebkitAppRegion: barRegion as any,
    }}>
      {/* タイトルバー: 常にドラッグ可 */}
      <div
        ref={titleBarRef}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: 24,
          padding: '0 6px',
          WebkitAppRegion: 'drag' as any,
        }}
      >
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
            <div key={item.key} style={{ marginBottom: 4, WebkitAppRegion: barRegion as any }}>
              <div
                style={{
                  position: 'relative',
                  height: 28,
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
              {item.key === 'five_hour' && ccPace?.available && ccPace.burnRatePerMin != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: th.textMuted, marginTop: 2, padding: '0 1px' }}>
                  <span>
                    🔥 {t('ccPaceBurnRate', formatTokens(ccPace.burnRatePerMin))}
                    {ccPace.burnRateCostPerMin != null && ccPace.burnRateCostPerMin > 0 && (
                      <> {t('ccPaceCostRate', formatUsd(ccPace.burnRateCostPerMin))}</>
                    )}
                    {ccPace.estimatedLimitUsd != null && ccPace.estimatedLimitUsd > 0 ? (
                      <> {t('ccPaceLimitEstUsd', formatUsd(ccPace.estimatedLimitUsd))}</>
                    ) : ccPace.estimatedLimitTokens != null && (
                      <> {t('ccPaceLimitEst', formatTokens(ccPace.estimatedLimitTokens))}</>
                    )}
                  </span>
                  {ccPace.minutesToLimit != null && (
                    <span style={{
                      color: (ccPace.minutesToReset != null && ccPace.minutesToLimit < ccPace.minutesToReset)
                        ? '#e05a2b' : th.textMuted
                    }}>
                      {t('ccPaceRange', formatMinutes(ccPace.minutesToLimit))}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}

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
                height: 28,
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 4,
                background: th.bgBar,
                WebkitAppRegion: barRegion as any,
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

        {/* Beta provider bars */}
        {settings.betaProviders?.copilot?.enabled && (() => {
          const d = beta?.copilot ?? null
          const pct = d ? Math.min(Math.round(d.utilization), 100) : 0
          const barColor = pct >= 90 ? '#e05a2b' : pct >= 70 ? '#e0a12b' : '#6e9ee8'
          const { date, time, rel } = formatReset(d?.resetDate ?? null, t('timeNow'))
          const pacePct = d?.resetDate ? calcPacePct(d.resetDate, 30 * DAY, settings.pace) : null
          return (
            <div style={{ marginBottom: 4, WebkitAppRegion: barRegion as any }}>
              <div style={{ position: 'relative', height: 28, borderRadius: 4, overflow: 'hidden', background: th.bgBar }}>
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
              {pacePct != null && (
                <div style={{ height: 3, borderRadius: 1, background: th.bgBar, marginTop: 1, overflow: 'hidden' }}>
                  <div style={{ width: `${pacePct}%`, height: '100%', background: th.textMuted, borderRadius: 1, opacity: 0.5, transition: 'width 0.4s ease' }} />
                </div>
              )}
            </div>
          )
        })()}
        {settings.betaProviders?.codex?.enabled && (() => {
          const d = beta?.codex ?? null
          // 5h primary window
          const pct5 = d?.fiveHourUtilization != null ? Math.min(Math.round(d.fiveHourUtilization), 100) : 0
          const color5 = pct5 >= 90 ? '#e05a2b' : pct5 >= 70 ? '#e0a12b' : '#10a37f'
          const reset5 = formatReset(d?.fiveHourResetDate ?? null, t('timeNow'))
          const pace5 = d?.fiveHourResetDate ? calcPacePct(d.fiveHourResetDate, 5 * HOUR, settings.pace) : null
          // 7d secondary window
          const pct7 = d ? Math.min(Math.round(d.utilization), 100) : 0
          const color7 = pct7 >= 90 ? '#e05a2b' : pct7 >= 70 ? '#e0a12b' : '#10a37f'
          const reset7 = formatReset(d?.resetDate ?? null, t('timeNow'))
          const pace7 = d?.resetDate ? calcPacePct(d.resetDate, 7 * DAY, settings.pace) : null

          const BetaBar = ({ label, pct, barColor, reset, hasData, pacePct }: {
            label: string; pct: number; barColor: string
            reset: ReturnType<typeof formatReset>; hasData: boolean; pacePct: number | null
          }) => (
            <div style={{ marginBottom: 4, WebkitAppRegion: barRegion as any }}>
              <div style={{ position: 'relative', height: 28, borderRadius: 4, overflow: 'hidden', background: th.bgBar }}>
                <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
                <div style={barTextStyle}>
                  <span style={{ width: 30, flexShrink: 0, fontSize: 9 }}>{label}</span>
                  <span style={{ width: 72, flexShrink: 0 }}>{hasData ? reset.date : '—'}</span>
                  <span style={{ width: 44, flexShrink: 0 }}>{hasData ? reset.time : ''}</span>
                  <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>{hasData ? reset.rel.major : ''}</span>
                  <span style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>{hasData ? reset.rel.minor : ''}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{hasData ? `${pct}%` : '—'}</span>
                </div>
              </div>
              {pacePct != null && (
                <div style={{ height: 3, borderRadius: 1, background: th.bgBar, marginTop: 1, overflow: 'hidden' }}>
                  <div style={{ width: `${pacePct}%`, height: '100%', background: th.textMuted, borderRadius: 1, opacity: 0.5, transition: 'width 0.4s ease' }} />
                </div>
              )}
            </div>
          )

          return (
            <>
              <BetaBar label="Cdx5β" pct={pct5} barColor={color5} reset={reset5} hasData={d?.fiveHourUtilization != null} pacePct={pace5} />
              <BetaBar label="Cdx7β" pct={pct7} barColor={color7} reset={reset7} hasData={d != null} pacePct={pace7} />
            </>
          )
        })()}
        {settings.betaProviders?.gemini?.enabled && (() => {
          const g = beta?.gemini ?? null
          const GeminiBar = ({ label, data }: {
            label: string; data: GeminiModelData | null
          }) => {
            const consumed = data != null ? 100 - data.remainingPct : 0
            const barColor = consumed >= 90 ? '#e05a2b' : consumed >= 70 ? '#e0a12b' : '#4285f4'
            const reset = formatReset(data?.resetTime ?? null, t('timeNow'))
            const pacePct = data?.resetTime ? calcPacePct(data.resetTime, 24 * HOUR, settings.pace) : null
            return (
              <div style={{ marginBottom: 4, WebkitAppRegion: barRegion as any }}>
                <div style={{ position: 'relative', height: 28, borderRadius: 4, overflow: 'hidden', background: th.bgBar }}>
                  <div style={{ position: 'absolute', inset: 0, width: `${consumed}%`, background: barColor, borderRadius: 4, transition: 'width 0.4s ease' }} />
                  <div style={barTextStyle}>
                    <span style={{ width: 30, flexShrink: 0, fontSize: 9 }}>{label}</span>
                    <span style={{ width: 72, flexShrink: 0 }}>{data ? reset.date : '—'}</span>
                    <span style={{ width: 44, flexShrink: 0 }}>{data ? reset.time : ''}</span>
                    <span style={{ width: 36, flexShrink: 0, textAlign: 'right' }}>{data ? reset.rel.major : ''}</span>
                    <span style={{ width: 28, flexShrink: 0, textAlign: 'right' }}>{data ? reset.rel.minor : ''}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>{data ? `${consumed}%` : '—'}</span>
                  </div>
                </div>
                {pacePct != null && (
                  <div style={{ height: 3, borderRadius: 1, background: th.bgBar, marginTop: 1, overflow: 'hidden' }}>
                    <div style={{ width: `${pacePct}%`, height: '100%', background: th.textMuted, borderRadius: 1, opacity: 0.5, transition: 'width 0.4s ease' }} />
                  </div>
                )}
              </div>
            )
          }
          return (
            <>
              <GeminiBar label="Gmn Proβ" data={g?.pro ?? null} />
              <GeminiBar label="Gmn Flsβ" data={g?.flash ?? null} />
            </>
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
