import { useEffect, useState } from 'react'
import { DetailView } from './components/DetailView'
import { CompactView } from './components/CompactView'
import { SettingsView } from './components/SettingsView'
import { UsageData, ProfileData, Settings, ViewMode } from './types'
import { LangContext, useT } from './LangContext'
import { ThemeContext } from './ThemeContext'
import { resolveLang } from './i18n'
import { ThemeTokens, ThemeSetting, resolveTheme } from './theme'

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

function useResolvedTheme(themeSetting: ThemeSetting): ThemeTokens {
  const [tokens, setTokens] = useState(() => resolveTheme(themeSetting))

  useEffect(() => {
    setTokens(resolveTheme(themeSetting))
    if (themeSetting !== 'auto') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setTokens(resolveTheme('auto'))
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [themeSetting])

  return tokens
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
      settings={settings}
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
    const unsub = window.api.onSettingsChanged(s => setSettings(s as Settings))
    return unsub
  }, [])

  const lang = resolveLang(settings.language ?? 'auto')
  const theme = useResolvedTheme(settings.theme ?? 'auto')

  if (isSettings) {
    return (
      <LangContext.Provider value={lang}>
        <ThemeContext.Provider value={theme}>
          <SettingsView onSettingsChange={setSettings} />
        </ThemeContext.Provider>
      </LangContext.Provider>
    )
  }

  return (
    <LangContext.Provider value={lang}>
      <ThemeContext.Provider value={theme}>
        <HudApp />
      </ThemeContext.Provider>
    </LangContext.Provider>
  )
}
