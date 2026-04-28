export type Lang = 'en' | 'ja'
export type LangSetting = 'auto' | Lang

const en = {
  // ---- 共通 ----
  refresh:        'Refresh',
  settings:       'Settings',
  loading:        'Loading...',
  unknown:        'unknown',
  timeNow:        'now',
  justNow:        'just now',
  minutesAgo:     '{0}m ago',
  hoursAgo:       '{0}h ago',
  daysAgo:        '{0}d ago',
  resetting:      'Resetting...',

  // ---- CompactView ----
  detailView:     'Detail view',
  stalePrefix:    '⚠ stale — ',

  // ---- DetailView ----
  compactView:    'Compact view',
  updated:        'Updated {0}',
  staleLastSuccess: '⚠ stale — last success: {0}',
  usageHistory:   'Usage History',

  // ---- UsageCard ----
  resetLabel:     'Reset:',
  remaining:      'Remaining',

  // カードラベル
  label5h:        '5-Hour',
  label7d:        '7-Day (claude.ai)',
  label7dOauth:   '7-Day (OAuth Apps)',
  label7dOpus:    '7-Day (Opus)',
  label7dSonnet:  '7-Day (Sonnet)',
  labelExtra:     'Extra Usage',

  // カード説明
  desc5h:         'Short-term burst (rolling)',
  desc7d:         'Weekly · claude.ai / Mobile',
  desc7dOauth:    'Weekly · Claude Code / Cursor / Windsurf etc.',
  desc7dOpus:     'Opus weekly limit',
  desc7dSonnet:   'Sonnet weekly limit (Team)',
  descExtra:      'Monthly add-on credits (beyond plan quota)',
  creditsUnit:    'credits',
  monthlyReset:   'Resets monthly',

  // ---- App (初期状態) ----
  setupTitle:     'Claude Usage HUD',
  setupDesc:      'Log in to Claude.ai to start',
  openSettings:   'Open Settings',

  // ---- HistoryChart ----
  noHistory:      'No history yet. Data accumulates over time.',

  // ---- SettingsView ----
  settingsTitle:       'Settings',
  sectionClaudeSession:'Claude.ai Session',
  loggedIn:            'Logged in',
  notLoggedIn:         'Not logged in',
  statusUnknown:       'Status unknown',
  relogin:             'Re-login',
  loginToClaude:       'Login to Claude.ai',
  loginHint:           'Log in to Claude.ai to fetch usage data. The session cookie is used for API access. The window closes automatically after login.',
  sectionTray:         'Menu Bar / Tray Display',
  showInTray:          'Show in tray label',
  show5h:              '5-Hour window',
  show7d:              '7-Day (claude.ai)',
  showOauth:           '7-Day OAuth Apps (Claude Code etc.)',
  showOpus:            '7-Day Opus',
  showSonnet:          '7-Day Sonnet (Team)',
  showExtra:           'Extra Usage (monthly add-on)',
  sectionInterval:     'Update Interval',
  fetchEvery:          'Fetch every',
  minuteUnit:          '{0} min',
  sectionWindow:       'Floating Window',
  alwaysOnTop:         'Always on top',
  opacityLabel:        'Opacity: {0}%',
  sectionAlerts:       'Alerts (OS Notification)',
  alertLabel5h:        '5-Hour',
  alertLabel7d:        '7-Day',
  alertLabel7dOauth:   '7-Day OAuth',
  alertLabel7dOpus:    '7-Day Opus',
  alertLabel7dSonnet:  '7-Day Sonnet',
  alertLabelExtra:     'Extra Usage',
  alertsPct:           '(%)',
  alertsHint:          'Leave blank to disable alerts for that window',
  sectionPace:         'Pace Indicator',
  paceWorkHoursOnly:   'Exclude non-work hours from pace calculation',
  paceWorkDayStart:    'Work start hour',
  paceWorkDayEnd:      'Work end hour',
  paceExcludeWeekends: 'Exclude weekends (Sat/Sun)',
  paceHint:            'A thin line below each bar shows the ideal pace based on elapsed time in the period. With work hours mode, non-work hours are excluded from the calculation.',
  saveSettings:        'Save Settings',
  savedConfirm:        '✓ Saved',
  sectionLanguage:     'Language',
  langAuto:            'Auto (OS)',
  langEn:              'English',
  langJa:              '日本語',
  sectionTheme:        'Appearance',
  themeAuto:           'Auto (System)',
  themeDark:           'Dark',
  themeLight:          'Light',
  fieldUnavailable:    'Not available on your plan',
  sectionStartup:      'Startup',
  launchAtLogin:       'Launch at login',
  launchAtLoginHint:   'Start Claude Usage HUD automatically when you log in to your computer.',
  sectionUpdates:      'Updates',
  currentVersion:      'Current version: {0}',
  autoUpdateLabel:     'Automatically check for updates',
  checkNow:            'Check Now',
  updateChecking:      'Checking...',
  updateAvailable:     'v{0} available — downloading...',
  updateDownloading:   'Downloading... {0}%',
  updateDownloaded:    'v{0} ready — restart to apply',
  updateNotAvailable:  'You\'re up to date',
  updateError:         'Update error',
  restartToUpdate:     'Restart to Update',

  // ---- Beta Providers ----
  sectionBeta:             'Beta Providers (Experimental)',
  betaHint:                'Experimental: fetch usage limits from other AI services. APIs are unofficial and may change without notice.',
  betaCopilotLabel:        'GitHub Copilot',
  betaCopilotDesc:         'Monthly premium requests limit (requires gh CLI login)',
  betaCodexLabel:          'OpenAI Codex',
  betaCodexDesc:           'Monthly usage limit (requires ChatGPT session)',
  betaEnabled:             'Enable',
  betaLoginBtn:            'Login',
  betaLoggedIn:            'Logged in',
  betaNotLoggedIn:         'Not logged in',
  betaStatusUnknown:       'Unknown',
  betaDataUnavailable:     'Data unavailable — API may have changed',
  betaMonthlyUsed:         '{0} / {1} {2} used',
  betaResetLabel:          'Resets:',
} as const

const ja = {
  refresh:        '更新',
  settings:       '設定',
  loading:        '読み込み中...',
  unknown:        '不明',
  timeNow:        '今',
  justNow:        'たった今',
  minutesAgo:     '{0}分前',
  hoursAgo:       '{0}時間前',
  daysAgo:        '{0}日前',
  resetting:      'リセット中...',

  detailView:     '詳細表示',
  stalePrefix:    '⚠ 古いデータ — ',

  compactView:    'コンパクト表示',
  updated:        '{0} 更新',
  staleLastSuccess: '⚠ 古いデータ — 最終成功: {0}',
  usageHistory:   '使用履歴',

  resetLabel:     'リセット:',
  remaining:      '残り',

  label5h:        '5時間',
  label7d:        '7日間 (claude.ai)',
  label7dOauth:   '7日間 (OAuthアプリ)',
  label7dOpus:    '7日間 (Opus)',
  label7dSonnet:  '7日間 (Sonnet)',
  labelExtra:     'Extra使用量',

  desc5h:         '短期バースト（ローリング）',
  desc7d:         '週次 · claude.ai / モバイル',
  desc7dOauth:    '週次 · Claude Code / Cursor / Windsurf 等',
  desc7dOpus:     'Opus専用週次制限',
  desc7dSonnet:   'Sonnet週次制限 (Team)',
  descExtra:      '月次追加クレジット（プランの枠を超えた分）',
  creditsUnit:    'クレジット',
  monthlyReset:   '月次リセット',

  setupTitle:     'Claude Usage HUD',
  setupDesc:      'Claude.ai にログインして開始',
  openSettings:   '設定を開く',

  noHistory:      'まだ履歴がありません。データは時間とともに蓄積されます。',

  settingsTitle:       '設定',
  sectionClaudeSession:'Claude.ai セッション',
  loggedIn:            'ログイン済み',
  notLoggedIn:         '未ログイン',
  statusUnknown:       '状態不明',
  relogin:             '再ログイン',
  loginToClaude:       'Claude.ai にログイン',
  loginHint:           'Claude.ai にログインして使用量データを取得します。セッションCookieをAPI アクセスに使用します。ログイン後、ウィンドウは自動的に閉じます。',
  sectionTray:         'メニューバー / トレイ表示',
  showInTray:          'トレイに表示',
  show5h:              '5時間枠',
  show7d:              '7日間 (claude.ai)',
  showOauth:           '7日間 OAuthアプリ (Claude Code 等)',
  showOpus:            '7日間 Opus',
  showSonnet:          '7日間 Sonnet (Team)',
  showExtra:           'Extra使用量（月次追加分）',
  sectionInterval:     '更新間隔',
  fetchEvery:          '取得間隔',
  minuteUnit:          '{0} 分',
  sectionWindow:       'フローティングウィンドウ',
  alwaysOnTop:         '常に最前面',
  opacityLabel:        '透明度: {0}%',
  sectionAlerts:       'アラート (OS通知)',
  alertLabel5h:        '5時間',
  alertLabel7d:        '7日間',
  alertLabel7dOauth:   '7日間 OAuth',
  alertLabel7dOpus:    '7日間 Opus',
  alertLabel7dSonnet:  '7日間 Sonnet',
  alertLabelExtra:     'Extra使用量',
  alertsPct:           '(%)',
  alertsHint:          '空欄にするとそのウィンドウのアラートを無効にします',
  sectionPace:         'ペースインジケーター',
  paceWorkHoursOnly:   '勤務時間外をペース計算から除外',
  paceWorkDayStart:    '勤務開始時刻',
  paceWorkDayEnd:      '勤務終了時刻',
  paceExcludeWeekends: '週末（土日）を除外',
  paceHint:            '各バーの下に、期間の経過時間に基づく理想的なペースを細い線で表示します。勤務時間モードでは、勤務時間外を計算から除外します。',
  saveSettings:        '設定を保存',
  savedConfirm:        '✓ 保存しました',
  sectionLanguage:     '言語',
  langAuto:            '自動 (OS設定)',
  langEn:              'English',
  langJa:              '日本語',
  sectionTheme:        '外観',
  themeAuto:           '自動 (システム設定)',
  themeDark:           'ダーク',
  themeLight:          'ライト',
  fieldUnavailable:    'このプランでは利用不可',
  sectionStartup:      '起動設定',
  launchAtLogin:       'ログイン時に自動起動',
  launchAtLoginHint:   'コンピューターにログインしたとき、Claude Usage HUD を自動的に起動します。',
  sectionUpdates:      'アップデート',
  currentVersion:      '現在のバージョン: {0}',
  autoUpdateLabel:     '自動的にアップデートを確認する',
  checkNow:            '今すぐ確認',
  updateChecking:      '確認中...',
  updateAvailable:     'v{0} が利用可能 — ダウンロード中...',
  updateDownloading:   'ダウンロード中... {0}%',
  updateDownloaded:    'v{0} 準備完了 — 再起動して適用',
  updateNotAvailable:  '最新バージョンです',
  updateError:         'アップデートエラー',
  restartToUpdate:     '再起動してアップデート',

  // ---- Beta Providers ----
  sectionBeta:             'β プロバイダー (試験的)',
  betaHint:                '試験的機能: 他のAIサービスの使用量リミットを取得します。非公式APIを使用しており、予告なく変更される場合があります。',
  betaCopilotLabel:        'GitHub Copilot',
  betaCopilotDesc:         '月間プレミアムリクエスト数リミット (gh CLI ログインが必要)',
  betaCodexLabel:          'OpenAI Codex',
  betaCodexDesc:           '月間使用量リミット (ChatGPT セッションが必要)',
  betaEnabled:             '有効にする',
  betaLoginBtn:            'ログイン',
  betaLoggedIn:            'ログイン済み',
  betaNotLoggedIn:         '未ログイン',
  betaStatusUnknown:       '状態不明',
  betaDataUnavailable:     'データ取得不可 — APIが変更された可能性があります',
  betaMonthlyUsed:         '{0} / {1} {2} 使用',
  betaResetLabel:          'リセット:',
} satisfies typeof en

const dict: Record<Lang, typeof en> = { en, ja }

export type TranslationKey = keyof typeof en

/** OS言語設定から Lang を解決する */
export function detectLang(): Lang {
  return navigator.language.startsWith('ja') ? 'ja' : 'en'
}

/** 言語設定（'auto' | 'en' | 'ja'）から実際の Lang を解決する */
export function resolveLang(setting: LangSetting): Lang {
  return setting === 'auto' ? detectLang() : setting
}

/** 翻訳。{0} {1} ... を args で補間する */
export function t(lang: Lang, key: TranslationKey, ...args: (string | number)[]): string {
  const str = dict[lang][key] ?? dict.en[key] ?? key
  return str.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''))
}
