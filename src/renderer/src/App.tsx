import { useEffect, useState } from 'react'
import { DetailView } from './components/DetailView'
import { SettingsView } from './components/SettingsView'
import { UsageData, ProfileData } from './types'

export default function App() {
  const isSettings = window.location.hash === '#/settings'

  const [usage, setUsage] = useState<UsageData | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [hasToken, setHasToken] = useState(true)

  useEffect(() => {
    if (isSettings) return

    window.api.getUsage().then(({ usage, profile }) => {
      if (usage) setUsage(usage)
      if (profile) setProfile(profile)
    })

    window.api.getSettings().then((s) => {
      if (!s.token) setHasToken(false)
    })

    const unsubscribe = window.api.onUsageUpdate(({ usage, profile }) => {
      setUsage(usage)
      setProfile(profile)
    })
    return unsubscribe
  }, [isSettings])

  if (isSettings) return <SettingsView />

  if (!hasToken) {
    return (
      <div style={{
        background: 'rgba(20,20,25,0.92)',
        borderRadius: 12,
        padding: 24,
        textAlign: 'center',
        color: '#aaa'
      }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>🤖</div>
        <div style={{ marginBottom: 8, color: '#e8e8e8', fontWeight: 600 }}>Claude Usage HUD</div>
        <div style={{ marginBottom: 16, fontSize: 12 }}>Set your API token to start monitoring</div>
        <button
          onClick={() => window.api.openSettings()}
          style={{
            background: '#e05a2b',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          Open Settings
        </button>
      </div>
    )
  }

  return <DetailView usage={usage} profile={profile} />
}
