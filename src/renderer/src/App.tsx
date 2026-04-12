import { useEffect, useState } from 'react'
import { DetailView } from './components/DetailView'
import { CompactView } from './components/CompactView'
import { SettingsView } from './components/SettingsView'
import { UsageData, ProfileData, Settings, ViewMode } from './types'
import { LangContext, useT } from './LangContext'
import { resolveLang } from './i18n'

const defaultSettings: Settings = {
  token: '',
  updateIntervalMinutes: 10,
  viewMode: 'compact',
  language: 'auto',
  tray: { show5h: true, show7d: true, showOauth: false, showOpus: false },
  window: { opacity: 90, alwaysOnTop: true },
  alerts: {},
}

function HudApp() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [mode, setMode] = useState<ViewMode>('compact')
  const [lastSuccessAt, setLastSuccessAt] = useState<Date | null>(null)
  const [isStale, setIsStale] = useState(false)

  useEffect(() => {
    window.api.getUsage().then(({ usage, profile }) => {
      if (usage) setUsage(usage)
      if (profile) setProfile(profile)
    })
    window.api.getSettings().then(s => {
      setSettings(s)
      setMode(s.viewMode ?? 'compact')
    })

    const unsubUsage = window.api.onUsageUpdate(({ usage, profile, lastSuccessAt, isStale }) => {
      setUsage(usage)
      setProfile(profile)
      setIsStale(isStale)
      if (lastSuccessAt) setLastSuccessAt(new Date(lastSuccessAt))
    })
    const unsubMode = window.api.onModeChanged(m => setMode(m as ViewMode))
    const unsubSettings = window.api.onSettingsChanged(s => setSettings(s as Settings))

    return () => { unsubUsage(); unsubMode(); unsubSettings() }
  }, [])

  function switchMode(m: ViewMode) {
    setMode(m)
    window.api.setViewMode(m)
  }

  if (mode === 'compact') {
    return (
      <CompactView
        usage={usage}
        settings={settings}
        lastSuccessAt={lastSuccessAt}
        isStale={isStale}
        onRefresh={() => window.api.refresh()}
        onSwitchToDetail={() => switchMode('detail')}
      />
    )
  }

  return (
    <DetailView
      usage={usage}
      profile={profile}
      lastSuccessAt={lastSuccessAt}
      isStale={isStale}
      onRefresh={() => window.api.refresh()}
      onSwitchToCompact={() => switchMode('compact')}
    />
  )
}

export default function App() {
  const isSettings = window.location.hash === '#/settings'
  const [settings, setSettings] = useState<Settings>(defaultSettings)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    // Settings 画面でも言語変更を即時反映
    const unsub = window.api.onSettingsChanged(s => setSettings(s as Settings))
    return unsub
  }, [])

  const lang = resolveLang(settings.language ?? 'auto')

  if (isSettings) {
    return (
      <LangContext.Provider value={lang}>
        <SettingsView onSettingsChange={setSettings} />
      </LangContext.Provider>
    )
  }

  return (
    <LangContext.Provider value={lang}>
      <HudApp />
    </LangContext.Provider>
  )
}
