import { useEffect, useState } from 'react'
import { DetailView } from './components/DetailView'
import { CompactView } from './components/CompactView'
import { SettingsView } from './components/SettingsView'
import { UsageData, ProfileData, Settings, ViewMode } from './types'

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 5,
  viewMode: 'compact',
  tray: { show5h: true, show7d: true, showOauth: false, showOpus: false },
  window: { opacity: 90, alwaysOnTop: true },
  alerts: {},
}

export default function App() {
  const isSettings = window.location.hash === '#/settings'

  const [usage, setUsage] = useState<UsageData | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [mode, setMode] = useState<ViewMode>('compact')

  useEffect(() => {
    if (isSettings) return

    // 初期データ取得
    window.api.getUsage().then(({ usage, profile }) => {
      if (usage) setUsage(usage)
      if (profile) setProfile(profile)
    })
    window.api.getSettings().then(s => {
      setSettings(s)
      setMode(s.viewMode ?? 'compact')
    })

    // リアルタイム更新
    const unsubUsage = window.api.onUsageUpdate(({ usage, profile }) => {
      setUsage(usage)
      setProfile(profile)
    })
    // メインプロセスからのモード切り替え通知
    const unsubMode = window.api.onModeChanged((m) => {
      setMode(m as ViewMode)
    })

    return () => { unsubUsage(); unsubMode() }
  }, [isSettings])

  if (isSettings) return <SettingsView />

  // トークン未設定
  if (!settings.token) {
    return (
      <div style={{
        background: 'rgba(18,18,22,0.93)',
        borderRadius: 10,
        padding: 24,
        textAlign: 'center',
        color: '#888',
      }}>
        <div style={{ fontSize: 26, marginBottom: 10 }}>🤖</div>
        <div style={{ marginBottom: 6, color: '#e8e8e8', fontWeight: 600 }}>Claude Usage HUD</div>
        <div style={{ marginBottom: 14, fontSize: 12 }}>Set your API token to start</div>
        <button
          onClick={() => window.api.openSettings()}
          style={{
            background: '#e05a2b', color: '#fff', border: 'none',
            borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 13,
          }}
        >
          Open Settings
        </button>
      </div>
    )
  }

  function switchMode(m: ViewMode) {
    setMode(m)
    window.api.setViewMode(m)
  }

  if (mode === 'compact') {
    return (
      <CompactView
        usage={usage}
        settings={settings}
        onRefresh={() => window.api.refresh()}
        onSwitchToDetail={() => switchMode('detail')}
      />
    )
  }

  return (
    <DetailView
      usage={usage}
      profile={profile}
      onRefresh={() => window.api.refresh()}
      onSwitchToCompact={() => switchMode('compact')}
    />
  )
}
