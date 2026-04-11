import { useEffect, useState } from 'react'
import { Settings } from '../types'

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 5,
  tray: { show5h: true, show7d: true, showOauth: false, showOpus: false },
  window: { opacity: 90, alwaysOnTop: true },
  alerts: {}
}

export function SettingsView() {
  const [s, setS] = useState<Settings>(defaultSettings)
  const [saved, setSaved] = useState(false)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    window.api.getSettings().then(setS)
  }, [])

  async function handleAutoDetect() {
    setDetecting(true)
    const token = await window.api.autoDetectToken()
    setDetecting(false)
    if (token) {
      setS(prev => ({ ...prev, token }))
    } else {
      alert('Token not found. Please enter manually.')
    }
  }

  async function handleSave() {
    await window.api.saveSettings(s)
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
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Settings</h2>

      {/* Token */}
      <Section title="Authentication">
        <Label>OAuth Access Token</Label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          <input
            type="password"
            value={s.token}
            onChange={e => upd(p => ({ ...p, token: e.target.value }))}
            placeholder="sk-ant-oat01-..."
            style={inputStyle}
          />
          <button
            onClick={handleAutoDetect}
            disabled={detecting}
            style={secondaryBtn}
          >
            {detecting ? '...' : 'Auto-detect'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#555' }}>
          Auto-detect reads from Claude Code's local credentials (Keychain or ~/.claude/.credentials.json)
        </div>
      </Section>

      {/* Tray display */}
      <Section title="Menu Bar / Tray Display">
        <Label>Show in tray label</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CheckRow
            label="5-Hour window"
            checked={s.tray.show5h}
            onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show5h: v } }))}
          />
          <CheckRow
            label="7-Day (claude.ai)"
            checked={s.tray.show7d}
            onChange={v => upd(p => ({ ...p, tray: { ...p.tray, show7d: v } }))}
          />
          <CheckRow
            label="7-Day OAuth Apps (Claude Code etc.)"
            checked={s.tray.showOauth}
            onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showOauth: v } }))}
          />
          <CheckRow
            label="7-Day Opus"
            checked={s.tray.showOpus}
            onChange={v => upd(p => ({ ...p, tray: { ...p.tray, showOpus: v } }))}
          />
        </div>
      </Section>

      {/* Update interval */}
      <Section title="Update Interval">
        <Label>Fetch every</Label>
        <select
          value={s.updateIntervalMinutes}
          onChange={e => upd(p => ({ ...p, updateIntervalMinutes: Number(e.target.value) }))}
          style={{ ...inputStyle, width: 'auto' }}
        >
          {[1, 5, 10, 30].map(m => (
            <option key={m} value={m}>{m} min</option>
          ))}
        </select>
      </Section>

      {/* Window */}
      <Section title="Floating Window">
        <CheckRow
          label="Always on top"
          checked={s.window.alwaysOnTop}
          onChange={v => upd(p => ({ ...p, window: { ...p.window, alwaysOnTop: v } }))}
        />
        <div style={{ marginTop: 8 }}>
          <Label>Opacity: {s.window.opacity}%</Label>
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
      <Section title="Alerts (OS Notification)">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <AlertThreshold
            label="5-Hour"
            value={s.alerts.five_hour}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, five_hour: v } }))}
          />
          <AlertThreshold
            label="7-Day"
            value={s.alerts.seven_day}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day: v } }))}
          />
          <AlertThreshold
            label="7-Day OAuth"
            value={s.alerts.seven_day_oauth_apps}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_oauth_apps: v } }))}
          />
          <AlertThreshold
            label="7-Day Opus"
            value={s.alerts.seven_day_opus}
            onChange={v => upd(p => ({ ...p, alerts: { ...p.alerts, seven_day_opus: v } }))}
          />
        </div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
          Leave blank to disable alerts for that window
        </div>
      </Section>

      {/* Save */}
      <button onClick={handleSave} style={primaryBtn}>
        {saved ? '✓ Saved' : 'Save Settings'}
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
      <Label>{label} (%)</Label>
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
