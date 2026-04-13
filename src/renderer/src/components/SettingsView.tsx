import { useEffect, useState } from 'react'
import { Settings } from '../types'
import { useT } from '../LangContext'
import { useTheme } from '../ThemeContext'

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  theme: 'auto',
  tray: { show5h: true, show7d: true, showOauth: false, showOpus: false, showSonnet: false, showExtra: false },
  window: { opacity: 90, alwaysOnTop: true },
  alerts: {},
  pace: { workHoursOnly: false, workDayStart: 5, workDayEnd: 22, excludeWeekends: true },
}

interface Props {
  onSettingsChange?: (s: Settings) => void
}

export function SettingsView({ onSettingsChange }: Props) {
  const t = useT()
  const th = useTheme()
  const [s, setS] = useState<Settings>(defaultSettings)
  const [saved, setSaved] = useState(false)
  const [loginStatus, setLoginStatus] = useState<'logged-in' | 'logged-out' | 'unknown'>('unknown')

  useEffect(() => {
    window.api.getSettings().then(setS)
    window.api.getLoginStatus().then(setLoginStatus)
    const off = window.api.onLoginStatusChanged(status => setLoginStatus(status))
    return off
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
          <CheckRow label={t('show5h')}    checked={s.tray.show5h}    onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show5h: v } }))}    th={th} />
          <CheckRow label={t('show7d')}    checked={s.tray.show7d}    onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show7d: v } }))}    th={th} />
          <CheckRow label={t('showOauth')} checked={s.tray.showOauth} onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showOauth: v } }))} th={th} />
          <CheckRow label={t('showOpus')}   checked={s.tray.showOpus}         onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showOpus: v } }))}   th={th} />
          <CheckRow label={t('showSonnet')} checked={s.tray.showSonnet ?? false} onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showSonnet: v } }))} th={th} />
          <CheckRow label={t('showExtra')}  checked={s.tray.showExtra ?? false}  onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showExtra: v } }))}  th={th} />
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

      {/* Alerts */}
      <Section title={t('sectionAlerts')} th={th}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <AlertThreshold
            label={`${t('alertLabel5h')} ${t('alertsPct')}`}
            value={s.alerts.five_hour}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, five_hour: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
          <AlertThreshold
            label={`${t('alertLabel7d')} ${t('alertsPct')}`}
            value={s.alerts.seven_day}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
          <AlertThreshold
            label={`${t('alertLabel7dOauth')} ${t('alertsPct')}`}
            value={s.alerts.seven_day_oauth_apps}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_oauth_apps: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
          <AlertThreshold
            label={`${t('alertLabel7dOpus')} ${t('alertsPct')}`}
            value={s.alerts.seven_day_opus}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_opus: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
          <AlertThreshold
            label={`${t('alertLabel7dSonnet')} ${t('alertsPct')}`}
            value={s.alerts.seven_day_sonnet}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_sonnet: v } }))}
            inputStyle={inputStyle}
            th={th}
          />
          <AlertThreshold
            label={`${t('alertLabelExtra')} ${t('alertsPct')}`}
            value={s.alerts.extra_usage}
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

      {/* Save */}
      <button onClick={handleSave} style={primaryBtn}>
        {saved ? t('savedConfirm') : t('saveSettings')}
      </button>
    </div>
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
