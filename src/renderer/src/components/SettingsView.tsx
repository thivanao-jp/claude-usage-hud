import { useEffect, useState } from 'react'
import { Settings } from '../types'
import { useT } from '../LangContext'

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  tray: { show5h: true, show7d: true, showOauth: false, showOpus: false },
  window: { opacity: 90, alwaysOnTop: true },
  alerts: {},
}

interface Props {
  onSettingsChange?: (s: Settings) => void
}

export function SettingsView({ onSettingsChange }: Props) {
  const t = useT()
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

  return (
    <div style={{
      background: '#1a1a1f',
      height: '100vh',
      overflowY: 'auto',
      padding: 20,
      color: '#e8e8e8'
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>{t('settingsTitle')}</h2>

      {/* Claude.ai Login */}
      <Section title={t('sectionClaudeSession')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            display: 'inline-block',
            width: 8, height: 8, borderRadius: '50%',
            background: loginStatus === 'logged-in' ? '#4caf50'
              : loginStatus === 'logged-out' ? '#f44336'
              : '#888',
            flexShrink: 0
          }} />
          <span style={{ fontSize: 13, color: '#ccc' }}>
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
        <div style={{ fontSize: 11, color: '#555' }}>{t('loginHint')}</div>
      </Section>

      {/* Language */}
      <Section title={t('sectionLanguage')}>
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
      <Section title={t('sectionTray')}>
        <Label>{t('showInTray')}</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CheckRow label={t('show5h')}    checked={s.tray.show5h}    onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show5h: v } }))} />
          <CheckRow label={t('show7d')}    checked={s.tray.show7d}    onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show7d: v } }))} />
          <CheckRow label={t('showOauth')} checked={s.tray.showOauth} onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showOauth: v } }))} />
          <CheckRow label={t('showOpus')}  checked={s.tray.showOpus}  onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showOpus: v } }))} />
        </div>
      </Section>

      {/* Update interval */}
      <Section title={t('sectionInterval')}>
        <Label>{t('fetchEvery')}</Label>
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
      <Section title={t('sectionWindow')}>
        <CheckRow
          label={t('alwaysOnTop')}
          checked={s.window.alwaysOnTop}
          onChange={v => upd(p => ({ ...p, window: { ...p.window, alwaysOnTop: v } }))}
        />
        <div style={{ marginTop: 8 }}>
          <Label>{t('opacityLabel', s.window.opacity)}</Label>
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
      <Section title={t('sectionAlerts')}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <AlertThreshold
            label={`${t('alertLabel5h')} ${t('alertsPct')}`}
            value={s.alerts.five_hour}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, five_hour: v } }))}
          />
          <AlertThreshold
            label={`${t('alertLabel7d')} ${t('alertsPct')}`}
            value={s.alerts.seven_day}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day: v } }))}
          />
          <AlertThreshold
            label={`${t('alertLabel7dOauth')} ${t('alertsPct')}`}
            value={s.alerts.seven_day_oauth_apps}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_oauth_apps: v } }))}
          />
          <AlertThreshold
            label={`${t('alertLabel7dOpus')} ${t('alertsPct')}`}
            value={s.alerts.seven_day_opus}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_opus: v } }))}
          />
        </div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>{t('alertsHint')}</div>
      </Section>

      {/* Save */}
      <button onClick={handleSave} style={primaryBtn}>
        {saved ? t('savedConfirm') : t('saveSettings')}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: '#aaa', marginBottom: 4 }}>{children}</div>
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#ccc' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function AlertThreshold({ label, value, onChange }: { label: string; value?: number; onChange: (v?: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
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

const inputStyle: React.CSSProperties = {
  background: '#252530',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#e8e8e8',
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  outline: 'none'
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
  width: '100%'
}

const secondaryBtn: React.CSSProperties = {
  background: '#252530',
  color: '#ccc',
  border: '1px solid #333',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}
