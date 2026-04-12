# Claude Usage HUD

A lightweight desktop HUD that keeps your Claude usage visible at all times — in the menu bar and as a floating window.

> **Requires a claude.ai account (Pro / Max recommended)**

---

## Features

### Compact View
Always-on-top floating window showing usage bars at a glance.

- **5H** — 5-hour rolling window
- **7D** — 7-day window (claude.ai / Mobile)
- **OA** — 7-day OAuth Apps window (Claude Code, Cursor, Windsurf, etc.)
- **Opus** — 7-day Opus window
- **EX** — Extra usage (monthly add-on credits, when enabled)

### Detail View
Expanded view with full usage cards, reset times, and a usage history chart.

### Menu Bar / Tray
Live usage percentages always visible in the macOS menu bar or Windows system tray.

### Appearance
- **Dark / Light / Auto** theme (follows system setting when set to Auto)
- Adjustable window opacity and always-on-top toggle

### Alerts
OS notifications when any usage window exceeds a configurable threshold.

### Multilingual
English and Japanese, with automatic OS language detection.

---

## Requirements

- macOS 10.12+ or Windows 10+
- A [claude.ai](https://claude.ai) account

---

## Installation

### macOS

1. Download the latest `.dmg` from [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases)
   - `arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
   - `.dmg` (no suffix) — Intel Mac
2. Open the `.dmg` and drag **Claude Usage HUD** to Applications
3. **First launch**: right-click the app → **Open** (required once to bypass Gatekeeper for unsigned builds)

### Windows

1. Download the latest `.exe` installer from [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases)
2. Run the installer — it installs per-user with no admin rights required
3. A portable `.exe` is also available if you prefer not to install

---

## Getting Started

1. Launch the app — a **Claude Usage HUD** icon appears in the menu bar / system tray
2. Click the icon → right-click → **Settings**
3. In the **Claude.ai Session** section, click **Login to Claude.ai**
4. Log in to your claude.ai account in the window that appears (it closes automatically after login)
5. Usage data starts loading within a few seconds

---

## Settings

| Section | Options |
|---|---|
| **Claude.ai Session** | Login / re-login |
| **Appearance** | Theme: Auto / Dark / Light |
| **Language** | Auto (OS) / English / 日本語 |
| **Menu Bar Display** | Toggle which windows appear in the tray label |
| **Update Interval** | 1 / 5 / 10 / 30 minutes |
| **Floating Window** | Always on top, opacity |
| **Alerts** | Notification threshold (%) per usage window |

---

## How It Works

Claude Usage HUD uses a hidden Electron `BrowserWindow` that maintains your claude.ai session (via `persist:claude-ai` partition). It fetches usage data from claude.ai's internal API at your configured interval — no OAuth tokens or API keys required. Your session persists across app restarts.

---

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/thivanao-jp/claude-usage-hud.git
cd claude-usage-hud
npm install
```

### Run in dev mode

```bash
npm run dev
```

### Build

```bash
# Production build (renderer + main)
npm run build

# macOS distributable (.dmg + .zip for arm64 and x64)
npm run dist:mac

# Windows distributable (.exe installer + portable)
npm run dist:win
```

Build output goes to `dist/`.

---

## Tech Stack

| Layer | Technology |
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

```bash
git tag v1.0.0
git push origin v1.0.0
```

See [`.github/workflows/build.yml`](.github/workflows/build.yml) for details.

---

## License

MIT
