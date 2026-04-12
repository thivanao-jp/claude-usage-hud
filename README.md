# Claude Usage HUD

A lightweight desktop HUD that keeps your Claude usage visible at all times — in the menu bar and as a floating window.

Claude の使用状況をメニューバーとフローティングウィンドウで常時表示する、軽量なデスクトップ HUD アプリです。

> **Requires a claude.ai account (Pro / Max recommended)**
> **claude.ai アカウント（Pro / Max 推奨）が必要です**

---

## Features / 機能

### Compact View / コンパクト表示
Always-on-top floating window showing usage bars at a glance.

使用率をバーで一覧表示する、常に最前面のフローティングウィンドウです。

- **5H** — 5-hour rolling window / 5時間ローリングウィンドウ
- **7D** — 7-day window (claude.ai / Mobile) / 7日間（claude.ai / モバイル）
- **OA** — 7-day OAuth Apps window (Claude Code, Cursor, Windsurf, etc.) / 7日間 OAuth アプリ（Claude Code 等）
- **Opus** — 7-day Opus window / 7日間 Opus
- **EX** — Extra usage (monthly add-on credits, when enabled) / Extra 使用量（月次追加クレジット）

### Detail View / 詳細表示
Expanded view with full usage cards, reset times, and a usage history chart.

リセット時刻・残り時間・使用履歴チャートを含む詳細ビューです。

### Menu Bar / Tray / メニューバー
Live usage percentages always visible in the macOS menu bar or Windows system tray.

使用率をリアルタイムで macOS メニューバー / Windows タスクトレイに表示します。

### Appearance / 外観
- **Dark / Light / Auto** theme (follows system setting when set to Auto)
- **ダーク / ライト / 自動** テーマ（自動はシステム設定に追従）
- Adjustable window opacity and always-on-top toggle / 透明度・最前面表示を調整可能

### Alerts / アラート
OS notifications when any usage window exceeds a configurable threshold.

各使用枠が設定した閾値を超えたときに OS 通知を送信します。

### Multilingual / 多言語対応
English and Japanese, with automatic OS language detection.

日本語・英語に対応。OS の言語設定を自動検出します。

---

## Requirements / 動作環境

- macOS 10.12+ or Windows 10+ / macOS 10.12 以上または Windows 10 以上
- A [claude.ai](https://claude.ai) account / claude.ai アカウント

---

## Installation / インストール

### macOS

1. Download the latest `.dmg` from [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases)
   - `arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
   - `.dmg` (no suffix) — Intel Mac

   [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases) から最新の `.dmg` をダウンロード

2. Open the `.dmg` and drag **Claude Usage HUD** to Applications

   `.dmg` を開き、**Claude Usage HUD** をアプリケーションフォルダへドラッグ

3. **First launch**: right-click the app → **Open** (required once to bypass Gatekeeper for unsigned builds)

   **初回起動時**: アプリを右クリック → **「開く」** を選択（未署名ビルドのため Gatekeeper を回避する操作が1回必要）

### Windows

1. Download the latest `.exe` installer from [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases)

   [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases) から最新の `.exe` インストーラーをダウンロード

2. Run the installer — it installs per-user with no admin rights required

   インストーラーを実行（管理者権限不要、ユーザーフォルダにインストール）

3. A portable `.exe` is also available if you prefer not to install

   インストール不要のポータブル版 `.exe` もあります

---

## Getting Started / 使い方

1. Launch the app — a **Claude Usage HUD** icon appears in the menu bar / system tray

   アプリを起動すると **Claude Usage HUD** アイコンがメニューバー / タスクトレイに表示されます

2. Click the icon → right-click → **Settings**

   アイコンをクリック → 右クリック → **「設定」**

3. In the **Claude.ai Session** section, click **Login to Claude.ai**

   **Claude.ai セッション** セクションの **「Claude.ai にログイン」** をクリック

4. Log in to your claude.ai account in the window that appears (it closes automatically after login)

   表示されたウィンドウで claude.ai にログイン（ログイン後は自動的に閉じます）

5. Usage data starts loading within a few seconds

   数秒で使用量データの取得が始まります

---

## Settings / 設定

| Section / セクション | Options / 内容 |
|---|---|
| **Claude.ai Session** | Login / re-login / ログイン・再ログイン |
| **Appearance / 外観** | Theme: Auto / Dark / Light / テーマ: 自動・ダーク・ライト |
| **Language / 言語** | Auto (OS) / English / 日本語 |
| **Menu Bar Display / メニューバー表示** | Toggle which windows appear in tray / 表示する使用枠を選択 |
| **Update Interval / 更新間隔** | 1 / 5 / 10 / 30 minutes / 分 |
| **Floating Window / ウィンドウ** | Always on top, opacity / 最前面・透明度 |
| **Alerts / アラート** | Notification threshold (%) per usage window / 各使用枠の通知閾値 (%) |

---

## How It Works / 仕組み

Claude Usage HUD uses a hidden Electron `BrowserWindow` that maintains your claude.ai session (via `persist:claude-ai` partition). It fetches usage data from claude.ai's internal API at your configured interval — no OAuth tokens or API keys required. Your session persists across app restarts.

非表示の Electron `BrowserWindow`（`persist:claude-ai` パーティション）で claude.ai のセッションを保持し、設定した間隔で claude.ai 内部 API から使用量を取得します。OAuth トークンや API キーは不要で、セッションはアプリ再起動後も維持されます。

---

## Development / 開発

### Prerequisites / 必要環境

- Node.js 20+
- npm

### Setup / セットアップ

```bash
git clone https://github.com/thivanao-jp/claude-usage-hud.git
cd claude-usage-hud
npm install
```

### Run in dev mode / 開発モードで起動

```bash
npm run dev
```

### Build / ビルド

```bash
# Production build (renderer + main) / プロダクションビルド
npm run build

# macOS distributable (.dmg + .zip for arm64 and x64) / macOS 配布物
npm run dist:mac

# Windows distributable (.exe installer + portable) / Windows 配布物
npm run dist:win
```

Build output goes to `dist/`. / ビルド成果物は `dist/` に出力されます。

---

## Tech Stack / 技術スタック

| Layer / レイヤー | Technology / 技術 |
|---|---|
| Framework | Electron 30 |
| Renderer | React 18 + TypeScript |
| Build tool | electron-vite |
| Styling | Inline styles with ThemeContext |
| Database | better-sqlite3 (usage history) |
| Charts | Recharts |

---

## CI / CD

GitHub Actions automatically builds macOS and Windows distributables on every version tag and publishes a GitHub Release.

バージョンタグをプッシュすると GitHub Actions が macOS・Windows のビルドを自動実行し、GitHub Release に成果物をアップロードします。

```bash
git tag v1.0.0
git push origin v1.0.0
```

See [`.github/workflows/build.yml`](.github/workflows/build.yml) for details.

---

## License

MIT
