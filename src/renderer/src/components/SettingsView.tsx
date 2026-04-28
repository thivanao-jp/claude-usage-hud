import { useEffect, useState } from 'react'
import { Settings, UsageData, UpdateStatus } from '../types'
import { useT } from '../LangContext'
import { useLang } from '../LangContext'
import { useTheme } from '../ThemeContext'
import { WEEKLY_FIELD_DEFS } from '../fieldDefs'

type ProviderStatus = 'logged-in' | 'logged-out' | 'unknown'

const defaultSettings: Settings = {
  token: '',
  launchAtLogin: false,
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  theme: 'auto',
  tray: {
    show5h: true,
    showExtra: false,
    showFields: {
      seven_day: true,
      seven_day_oauth_apps: false,
      seven_day_opus: false,
      seven_day_sonnet: false,
      seven_day_cowork: false,
      seven_day_omelette: false,
      iguana_necktie: false,
      omelette_promotional: false,
    },
  },
  window: { opacity: 90, alwaysOnTop: true },
  alerts: {},
  pace: { workHoursOnly: false, workDayStart: 5, workDayEnd: 22, excludeWeekends: true },
}

interface Props {
  onSettingsChange?: (s: Settings) => void
}

export function SettingsView({ onSettingsChange }: Props) {
  const t = useT()
  const lang = useLang()
  const th = useTheme()
  const [s, setS] = useState<Settings>(defaultSettings)
  const [saved, setSaved] = useState(false)
  const [loginStatus, setLoginStatus] = useState<'logged-in' | 'logged-out' | 'unknown'>('unknown')
  const [currentUsage, setCurrentUsage] = useState<UsageData | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [copilotStatus, setCopilotStatus] = useState<ProviderStatus>('unknown')
  const [codexStatus, setCodexStatus] = useState<ProviderStatus>('unknown')

  useEffect(() => {
    window.api.getSettings().then(setS)
    window.api.getLoginStatus().then(setLoginStatus)
    window.api.getUsage().then(r => setCurrentUsage(r.usage))
    window.api.getAppVersion().then(setAppVersion)
    window.api.getCopilotLoginStatus().then(setCopilotStatus)
    window.api.getCodexLoginStatus().then(setCodexStatus)
    const offLogin = window.api.onLoginStatusChanged(status => setLoginStatus(status))
    const offUpdate = window.api.onUpdateStatus(status => setUpdateStatus(status as UpdateStatus))
    return () => { offLogin(); offUpdate() }
  }, [])

  async function handleSave() {
    await window.api.saveSettings(s)
    onSettingsChange?.(s)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const upd = (fn: (prev: Settings) => Settings) => setS(fn)

  const inputStyle: React.CSSProperties = {
    background: th.bgInput,
    border: `1px solid ${th.borderInput}`,
    borderRadius: 6,
    color: th.text,
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  }

  const secondaryBtn: React.CSSProperties = {
    background: th.bgInput,
    color: th.textSub,
    border: `1px solid ${th.borderInput}`,
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{
      background: th.bgPanel,
      height: '100vh',
      overflowY: 'auto',
      padding: 20,
      color: th.text,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>{t('settingsTitle')}</h2>

      {/* Claude.ai Login */}
      <Section title={t('sectionClaudeSession')} th={th}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            display: 'inline-block',
            width: 8, height: 8, borderRadius: '50%',
            background: loginStatus === 'logged-in' ? '#4caf50'
              : loginStatus === 'logged-out' ? '#f44336'
              : '#888',
            flexShrink: 0
          }} />
          <span style={{ fontSize: 13, color: th.textSub }}>
            {loginStatus === 'logged-in' ? t('loggedIn')
              : loginStatus === 'logged-out' ? t('notLoggedIn')
              : t('statusUnknown')}
          </span>
          <button
            onClick={() => window.api.showLoginWindow()}
            style={{ ...secondaryBtn, marginLeft: 'auto' }}
          >
            {loginStatus === 'logged-in' ? t('relogin') : t('loginToClaude')}
          </button>
        </div>
        <div style={{ fontSize: 11, color: th.textFaint2 }}>{t('loginHint')}</div>
      </Section>

      {/* Appearance (Theme) */}
      <Section title={t('sectionTheme')} th={th}>
        <select
          value={s.theme ?? 'auto'}
          onChange={e => upd(p => ({ ...p, theme: e.target.value as Settings['theme'] }))}
          style={{ ...inputStyle, width: 'auto' }}
        >
          <option value="auto">{t('themeAuto')}</option>
          <option value="dark">{t('themeDark')}</option>
          <option value="light">{t('themeLight')}</option>
        </select>
      </Section>

      {/* Language */}
      <Section title={t('sectionLanguage')} th={th}>
        <select
          value={s.language ?? 'auto'}
          onChange={e => upd(p => ({ ...p, language: e.target.value as Settings['language'] }))}
          style={{ ...inputStyle, width: 'auto' }}
        >
          <option value="auto">{t('langAuto')}</option>
          <option value="en">{t('langEn')}</option>
          <option value="ja">{t('langJa')}</option>
        </select>
      </Section>

      {/* Tray display */}
      <Section title={t('sectionTray')} th={th}>
        <Label th={th}>{t('showInTray')}</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CheckRow label={t('show5h')} checked={s.tray.show5h} onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show5h: v } }))} th={th} />
          {WEEKLY_FIELD_DEFS.map(field => {
            const usageRecord = currentUsage as (Record<string, unknown> | null)
            const isAvailable = usageRecord?.[field.key] != null
            const label = lang === 'ja' ? field.showLabelJa : field.showLabelEn
            const checked = (s.tray.showFields ?? {})[field.key] ?? false
            if (!isAvailable && currentUsage != null) {
              // データあり but このフィールドが null = このプランでは利用不可
              return (
                <label key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: th.textFaint, opacity: 0.5 }}>
                  <input type="checkbox" checked={false} disabled />
                  {label} <span style={{ fontSize: 11, marginLeft: 4 }}>({t('fieldUnavailable')})</span>
                </label>
              )
            }
            return (
              <CheckRow
                key={field.key}
                label={label}
                checked={checked}
                onChange={v => upd(p => ({
                  ...p,
                  tray: { ...p.tray, showFields: { ...(p.tray.showFields ?? {}), [field.key]: v } }
                }))}
                th={th}
              />
            )
          })}
          <CheckRow label={t('showExtra')} checked={s.tray.showExtra ?? false} onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showExtra: v } }))} th={th} />
        </div>
      </Section>

      {/* Update interval */}
      <Section title={t('sectionInterval')} th={th}>
        <Label th={th}>{t('fetchEvery')}</Label>
        <select
          value={s.updateIntervalMinutes}
          onChange={e => upd(p => ({ ...p, updateIntervalMinutes: Number(e.target.value) }))}
          style={{ ...inputStyle, width: 'auto' }}
        >
          {[1, 5, 10, 30].map(m => (
            <option key={m} value={m}>{t('minuteUnit', m)}</option>
          ))}
        </select>
      </Section>

      {/* Window */}
      <Section title={t('sectionWindow')} th={th}>
        <CheckRow
          label={t('alwaysOnTop')}
          checked={s.window.alwaysOnTop}
          onChange={v => upd(p => ({ ...p, window: { ...p.window, alwaysOnTop: v } }))}
          th={th}
        />
        <div style={{ marginTop: 8 }}>
          <Label th={th}>{t('opacityLabel', s.window.opacity)}</Label>
          <input
            type="range"
            min={20}
            max={100}
            value={s.window.opacity}
            onChange={e => upd(p => ({ ...p, window: { ...p.window, opacity: Number(e.target.value) } }))}
            style={{ width: '100%' }}
          />
        </div>
      </Section>

      {/* Startup */}
      <Section title={t('sectionStartup')} th={th}>
        <CheckRow
          label={t('launchAtLogin')}
          checked={s.launchAtLogin ?? false}
          onChange={v => upd(p => ({ ...p, launchAtLogin: v }))}
          th={th}
        />
        <div style={{ fontSize: 11, color: th.textFaint2, marginTop: 4 }}>{t('launchAtLoginHint')}</div>
      </Section>

      {/* Alerts */}
      <Section title={t('sectionAlerts')} th={th}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <AlertThreshold
            label={`${t('alertLabel5h')} ${t('alertsPct')}`}
            value={s.alerts['five_hour']}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, five_hour: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
          {WEEKLY_FIELD_DEFS.map(field => {
            const usageRecord = currentUsage as (Record<string, unknown> | null)
            const isAvailable = currentUsage == null || usageRecord?.[field.key] != null
            if (!isAvailable) return null
            const alertLabel = lang === 'ja' ? field.alertLabelJa : field.alertLabelEn
            return (
              <AlertThreshold
                key={field.key}
                label={`${alertLabel} ${t('alertsPct')}`}
                value={s.alerts[field.key] as number | undefined}
                onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, [field.key]: v } }))}
                inputStyle={inputStyle}
                th={th}
              />
            )
          })}
          <AlertThreshold
            label={`${t('alertLabelExtra')} ${t('alertsPct')}`}
            value={s.alerts['extra_usage']}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, extra_usage: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
        </div>
        <div style={{ fontSize: 11, color: th.textFaint2, marginTop: 6 }}>{t('alertsHint')}</div>
      </Section>

      {/* Pace Indicator */}
      <Section title={t('sectionPace')} th={th}>
        <CheckRow
          label={t('paceWorkHoursOnly')}
          checked={s.pace?.workHoursOnly ?? false}
          onChange={v => upd(p => ({ ...p, pace: { ...p.pace, workHoursOnly: v } }))}
          th={th}
        />
        {s.pace?.workHoursOnly && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CheckRow
              label={t('paceExcludeWeekends')}
              checked={s.pace?.excludeWeekends ?? true}
              onChange={v => upd(p => ({ ...p, pace: { ...p.pace, excludeWeekends: v } }))}
              th={th}
            />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div>
                <Label th={th}>{t('paceWorkDayStart')}</Label>
                <select
                  value={s.pace?.workDayStart ?? 5}
                  onChange={e => upd(p => ({ ...p, pace: { ...p.pace, workDayStart: Number(e.target.value) } }))}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{`${i}:00`}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label th={th}>{t('paceWorkDayEnd')}</Label>
                <select
                  value={s.pace?.workDayEnd ?? 22}
                  onChange={e => upd(p => ({ ...p, pace: { ...p.pace, workDayEnd: Number(e.target.value) } }))}
                  style={{ ...inputStyle, width: 'auto' }}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{`${i}:00`}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: th.textFaint2, marginTop: 6 }}>{t('paceHint')}</div>
      </Section>

      {/* Updates */}
      <Section title={t('sectionUpdates')} th={th}>
        <div style={{ fontSize: 12, color: th.textLabel, marginBottom: 8 }}>{t('currentVersion', appVersion)}</div>
        <CheckRow
          label={t('autoUpdateLabel')}
          checked={s.autoUpdate ?? true}
          onChange={v => upd(p => ({ ...p, autoUpdate: v }))}
          th={th}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button
            onClick={() => { setUpdateStatus({ state: 'checking' }); window.api.checkForUpdates() }}
            disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
            style={{ ...secondaryBtn, opacity: (updateStatus.state === 'checking' || updateStatus.state === 'downloading') ? 0.5 : 1 }}
          >
            {updateStatus.state === 'checking' ? t('updateChecking') : t('checkNow')}
          </button>
          {updateStatus.state === 'downloaded' && (
            <button onClick={() => window.api.installUpdate()} style={{ ...secondaryBtn, color: '#4caf50', borderColor: '#4caf50' }}>
              {t('restartToUpdate')}
            </button>
          )}
        </div>
        {updateStatus.state !== 'idle' && updateStatus.state !== 'checking' && (
          <div style={{ fontSize: 12, marginTop: 8, color:
            updateStatus.state === 'downloaded' ? '#4caf50'
            : updateStatus.state === 'error' ? '#f44336'
            : th.textSub
          }}>
            {updateStatus.state === 'available' && t('updateAvailable', updateStatus.version ?? '')}
            {updateStatus.state === 'downloading' && t('updateDownloading', String(updateStatus.percent ?? 0))}
            {updateStatus.state === 'downloaded' && t('updateDownloaded', updateStatus.version ?? '')}
            {updateStatus.state === 'not-available' && t('updateNotAvailable')}
            {updateStatus.state === 'error' && `${t('updateError')}: ${updateStatus.message ?? ''}`}
          </div>
        )}
      </Section>

      {/* Beta Providers */}
      <Section title={t('sectionBeta')} th={th}>
        <div style={{ fontSize: 11, color: th.textFaint2, marginBottom: 10 }}>{t('betaHint')}</div>

        {/* GitHub Copilot */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <CheckRow
              label={t('betaCopilotLabel')}
              checked={s.betaProviders?.copilot?.enabled ?? false}
              onChange={v => upd(p => ({ ...p, betaProviders: { ...p.betaProviders, copilot: { enabled: v } } }))}
              th={th}
            />
            <StatusDot status={copilotStatus} t={t} />
            <button
              onClick={() => window.api.showCopilotLoginWindow()}
              style={{ ...secondaryBtn, marginLeft: 'auto', fontSize: 11 }}
            >
              {t('betaLoginBtn')}
            </button>
          </div>
          <div style={{ fontSize: 11, color: th.textFaint2, paddingLeft: 20 }}>{t('betaCopilotDesc')}</div>
        </div>

        {/* OpenAI Codex */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <CheckRow
              label={t('betaCodexLabel')}
              checked={s.betaProviders?.codex?.enabled ?? false}
              onChange={v => upd(p => ({ ...p, betaProviders: { ...p.betaProviders, codex: { enabled: v } } }))}
              th={th}
            />
            <StatusDot status={codexStatus} t={t} />
            <button
              onClick={() => window.api.showCodexLoginWindow()}
              style={{ ...secondaryBtn, marginLeft: 'auto', fontSize: 11 }}
            >
              {t('betaLoginBtn')}
            </button>
          </div>
          <div style={{ fontSize: 11, color: th.textFaint2, paddingLeft: 20 }}>{t('betaCodexDesc')}</div>
        </div>
      </Section>

      {/* Save */}
      <button onClick={handleSave} style={primaryBtn}>
        {saved ? t('savedConfirm') : t('saveSettings')}
      </button>
    </div>
  )
}

function StatusDot({ status, t }: { status: ProviderStatus; t: ReturnType<typeof useT> }) {
  const color = status === 'logged-in' ? '#4caf50' : status === 'logged-out' ? '#f44336' : '#888'
  const label = status === 'logged-in' ? t('betaLoggedIn') : status === 'logged-out' ? t('betaNotLoggedIn') : t('betaStatusUnknown')
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
      <span style={{ color: '#888' }}>{label}</span>
    </span>
  )
}

function Section({ title, children, th }: { title: string; children: React.ReactNode; th: ReturnType<typeof useTheme> }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: th.textFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Label({ children, th }: { children: React.ReactNode; th: ReturnType<typeof useTheme> }) {
  return <div style={{ fontSize: 12, color: th.textLabel, marginBottom: 4 }}>{children}</div>
}

function CheckRow({ label, checked, onChange, th }: { label: string; checked: boolean; onChange: (v: boolean) => void; th: ReturnType<typeof useTheme> }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: th.textSub }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function AlertThreshold({ label, value, onChange, inputStyle, th }: {
  label: string
  value?: number
  onChange: (v?: number) => void
  inputStyle: React.CSSProperties
  th: ReturnType<typeof useTheme>
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: th.textLabel, marginBottom: 4 }}>{label}</div>
      <input
        type="number"
        min={1}
        max={100}
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : undefined)}
        placeholder="—"
        style={{ ...inputStyle, width: '100%' }}
      />
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  background: '#e05a2b',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '9px 20px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
}
