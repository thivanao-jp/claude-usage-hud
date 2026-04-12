# Claude Usage HUD

> 🇺🇸 [English version](README.md)

Claude の使用状況をメニューバーとフローティングウィンドウで常時表示する、軽量なデスクトップ HUD アプリです。

> **claude.ai アカウント（Pro / Max 推奨）が必要です**

---

## 機能

### コンパクト表示
使用率をバーで一覧表示する、常に最前面のフローティングウィンドウです。

- **5H** — 5時間ローリングウィンドウ
- **7D** — 7日間（claude.ai / モバイル）
- **OA** — 7日間 OAuth アプリ（Claude Code, Cursor, Windsurf 等）
- **Opus** — 7日間 Opus
- **EX** — Extra 使用量（月次追加クレジット、有効時のみ表示）

### 詳細表示
リセット時刻・残り時間・使用履歴チャートを含む詳細ビューです。

### メニューバー / タスクトレイ
使用率をリアルタイムで macOS メニューバー / Windows タスクトレイに表示します。

### 外観
- **ダーク / ライト / 自動** テーマ（自動はシステム設定に追従）
- 透明度・最前面表示を調整可能

### アラート
各使用枠が設定した閾値を超えたときに OS 通知を送信します。

### 多言語対応
日本語・英語に対応。OS の言語設定を自動検出します。

---

## 動作環境

- macOS 10.12 以上 または Windows 10 以上
- [claude.ai](https://claude.ai) アカウント

---

## インストール

### macOS

1. [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases) から最新の `.dmg` をダウンロード
   - `arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
   - `.dmg`（サフィックスなし） — Intel Mac
2. `.dmg` を開き、**Claude Usage HUD** をアプリケーションフォルダへドラッグ
3. **初回起動時**: アプリを右クリック → **「開く」** を選択（未署名ビルドのため Gatekeeper の回避操作が1回必要）

### Windows

1. [Releases](https://github.com/thivanao-jp/claude-usage-hud/releases) から最新の `.exe` インストーラーをダウンロード
2. インストーラーを実行（管理者権限不要、ユーザーフォルダにインストール）
3. インストール不要のポータブル版 `.exe` もあります

---

## 使い方

1. アプリを起動すると **Claude Usage HUD** アイコンがメニューバー / タスクトレイに表示されます
2. アイコンをクリック → 右クリック → **「設定」**
3. **Claude.ai セッション** セクションの **「Claude.ai にログイン」** をクリック
4. 表示されたウィンドウで claude.ai にログイン（ログイン後は自動的に閉じます）
5. 数秒で使用量データの取得が始まります

---

## 設定

| セクション | 内容 |
|---|---|
| **Claude.ai セッション** | ログイン・再ログイン |
| **外観** | テーマ: 自動・ダーク・ライト |
| **言語** | 自動 (OS設定) / English / 日本語 |
| **メニューバー表示** | 表示する使用枠を選択 |
| **更新間隔** | 1 / 5 / 10 / 30 分 |
| **フローティングウィンドウ** | 最前面表示・透明度 |
| **アラート** | 各使用枠の通知閾値 (%) |

---

## 仕組み

非表示の Electron `BrowserWindow`（`persist:claude-ai` パーティション）で claude.ai のセッションを保持し、設定した間隔で claude.ai 内部 API から使用量を取得します。OAuth トークンや API キーは不要で、セッションはアプリ再起動後も維持されます。

---

## 開発

### 必要環境

- Node.js 20+
- npm

### セットアップ

```bash
git clone https://github.com/thivanao-jp/claude-usage-hud.git
cd claude-usage-hud
npm install
```

### 開発モードで起動

```bash
npm run dev
```

### ビルド

```bash
# プロダクションビルド
npm run build

# macOS 配布物（arm64・x64 の .dmg + .zip）
npm run dist:mac

# Windows 配布物（.exe インストーラー + ポータブル版）
npm run dist:win
```

ビルド成果物は `dist/` に出力されます。

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フレームワーク | Electron 30 |
| レンダラー | React 18 + TypeScript |
| ビルドツール | electron-vite |
| スタイリング | インラインスタイル + ThemeContext |
| データベース | better-sqlite3（使用履歴） |
| チャート | Recharts |

---

## CI / CD

バージョンタグをプッシュすると GitHub Actions が macOS・Windows のビルドを自動実行し、GitHub Release に成果物をアップロードします。

```bash
git tag v1.0.0
git push origin v1.0.0
```

詳細は [`.github/workflows/build.yml`](.github/workflows/build.yml) を参照してください。

---

## ライセンス

MIT
