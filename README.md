# Claude Usage HUD

> 🇯🇵 [日本語版はこちら](README.ja.md)

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

## Local API Server (Claude Code Integration)

When running, Claude Usage HUD exposes a minimal HTTP server on **`http://127.0.0.1:49485`** (localhost only). This lets external tools — including Claude Code skills — read live usage data without requiring an OAuth token or browser session.

### Endpoint

```
GET http://127.0.0.1:49485/usage
```

**Response** (JSON):

```json
{
  "five_hour": {
    "utilization": 43,
    "resets_at": "2026-04-17T08:00:00.000Z"
  },
  "seven_day": {
    "utilization": 12,
    "resets_at": "2026-04-21T00:00:00.000Z"
  },
  "extra_usage": null,
  "last_updated": "2026-04-17T04:51:38.831Z"
}
```

| Field | Description |
|---|---|
| `five_hour` | 5-hour burst window — `utilization` (%) and `resets_at` (ISO 8601 UTC) |
| `seven_day` | 7-day rolling window |
| `extra_usage` | Monthly add-on credits, or `null` if not enabled |
| `last_updated` | Timestamp of the last successful data fetch |

Returns the last successfully fetched values. Returns `null` for any window that has not been fetched yet.

### Using with Claude Code's `rate-limit-guard` skill

The [`rate-limit-guard`](https://github.com/thivanao-jp/claude-usage-hud) skill for [Claude Code](https://claude.ai/code) uses this endpoint to automatically pause long-running tasks before hitting the 5-hour rate limit, then resume when the window resets.

**Helper script** (`~/.claude/scripts/check_usage.py`):

```python
import json, urllib.request
data = json.loads(urllib.request.urlopen('http://127.0.0.1:49485/usage', timeout=5).read())
five_hour = data.get('five_hour') or {}
print(f"5H usage: {five_hour.get('utilization', 0):.0f}%  resets at: {five_hour.get('resets_at')}")
```

**Skill usage** (`~/.claude/skills/rate-limit-guard.md`):

```
/rate-limit-guard              # check at default 90% threshold
/rate-limit-guard threshold=80 # custom threshold
```

When the 5-hour utilization exceeds the threshold, the skill calls `ScheduleWakeup` with a delay calculated from `resets_at`, pausing all work until the window resets. If Claude Usage HUD is not running, the skill logs a warning and continues without guarding.

---

## API Response Structure

> **Last verified: 2026-04-17**

Usage data is fetched from `https://claude.ai/api/organizations/{orgUuid}/usage`.

### Known response fields

| Field | Type | Description |
|---|---|---|
| `five_hour` | `UsageEntry \| null` | 5-hour rolling burst window |
| `seven_day` | `UsageEntry \| null` | 7-day window (claude.ai / Mobile) |
| `seven_day_oauth_apps` | `UsageEntry \| null` | 7-day window for OAuth apps (Claude Code, Cursor, etc.) |
| `seven_day_opus` | `UsageEntry \| null` | 7-day Opus-specific limit |
| `seven_day_sonnet` | `UsageEntry \| null` | 7-day Sonnet-specific limit (Team Premium) |
| `seven_day_cowork` | `UsageEntry \| null` | 7-day Cowork limit (plan-specific, observed as null) |
| `seven_day_omelette` | `UsageEntry \| null` | 7-day "Omelette" limit (internal codename, observed with `utilization: 0`) |
| `iguana_necktie` | unknown | Internal flag, always null — not tracked |
| `omelette_promotional` | unknown | Internal promotional flag, always null — not tracked |
| `extra_usage` | `ExtraUsage \| null` | Monthly add-on credits (Pro+ plans) |

`UsageEntry`:
```json
{ "utilization": 43, "resets_at": "2026-04-17T03:00:00+00:00" }
```

`ExtraUsage`:
```json
{
  "is_enabled": true,
  "monthly_limit": 5000,
  "used_credits": 123,
  "utilization": 2.46,
  "currency": "USD"
}
```

> **Note on internal codenames**: Anthropic uses internal codenames for some fields (e.g. `omelette`, `iguana_necktie`). These may be renamed, removed, or replaced without notice. The app handles unknown/missing fields gracefully — they simply appear as null and are hidden from the UI.

### Rate limiting

The official OAuth usage endpoint (`api.anthropic.com/api/oauth/usage`) returns persistent HTTP 429 for most users. This app avoids that by using the claude.ai web session instead.

---

## Adding a New Usage Field

When Anthropic adds a new usage field to the API response (e.g. a new model or plan tier), you can add it in these steps:

### 1. Add the field to `src/renderer/src/fieldDefs.ts` (and `src/main/fieldDefs.ts`)

```typescript
{
  key: 'seven_day_newmodel',
  shortLabel: 'New',
  labelEn: '7-Day (New Model)',
  labelJa: '7日間 (新モデル)',
  descEn: 'New Model weekly limit',
  descJa: '新モデル週次制限',
  alertLabelEn: '7-Day New',
  alertLabelJa: '7日間 新',
  showLabelEn: '7-Day New Model',
  showLabelJa: '7日間 新モデル',
  color: '#aabbcc',
  periodMs: 7 * DAY,
},
```

### 2. Add the field to `UsageData` in `src/main/claudeApi.ts` and `src/renderer/src/types.ts`

```typescript
seven_day_newmodel: UsageEntry | null
```

### 3. Add the field to `mapUsage()` in `src/main/claudeWebFetcher.ts`

```typescript
seven_day_newmodel: entry(src, 'seven_day_newmodel'),
```

### 4. Add the DB column in `src/main/db.ts`

Add to `CREATE TABLE` and add an `ALTER TABLE` migration block (follow the pattern of `seven_day_sonnet`).

That's it. The UI (compact/detail/settings/alerts/tray) updates automatically via `WEEKLY_FIELD_DEFS` iteration. Fields that return null from the API are automatically hidden from settings toggles and alert thresholds.

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
