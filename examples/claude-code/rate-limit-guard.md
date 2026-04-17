# rate-limit-guard

Claude Codeの5時間レートリミット残量を確認し、閾値を超えていたらリミット解除まで待機する。

## セットアップ

1. `check_usage.py` を `~/.claude/scripts/check_usage.py` にコピー
2. このファイルを `~/.claude/skills/rate-limit-guard.md` にコピー
3. Claude Usage HUD を起動しておく

## 引数

- `threshold` (省略可, デフォルト 90): 待機を開始する使用率 (%)
- `resume_prompt` (省略可): リミット解除後に再開するプロンプト。省略時は現在の /loop プロンプトを継続。

## 手順

### ステップ1: 使用量を取得する

以下のコマンドを実行してJSON結果を取得する:

```bash
python ~/.claude/scripts/check_usage.py [threshold]
```

取得結果の例:
```json
{"utilization": 87.5, "resets_at": "2026-04-17T15:30:00Z", "over_threshold": false, "threshold": 90.0}
```

`"error"` キーが存在する場合: Claude Usage HUD が起動していない。その旨をユーザーに伝え、ガード不可として作業を継続する。

### ステップ2: 閾値判定

**`over_threshold` が false（閾値以下）**:
- `"Rate limit OK: {utilization:.1f}% (threshold: {threshold}%)"` と1行報告して終了
- 呼び出し元の作業を継続する

**`over_threshold` が true（閾値超過）**:

1. `resets_at` がある場合: 現在時刻（UTC）との差分から待機秒数を計算
   - `delay_seconds = max(60, (resets_at - now_utc).total_seconds() + 60)`（1分マージン追加）
   - 3600秒を超える場合は 3600 に丸める（ScheduleWakeup の上限）
   - 残り時間が3600秒を超える場合はwakeup後に再度チェックが必要

2. `resets_at` が null の場合: `delay_seconds = 1200`（20分）でポーリング

3. ユーザーに報告:
   ```
   Rate limit at {utilization:.1f}% (>= {threshold}%).
   Waiting until {resets_at} ({delay_seconds}s). Will resume automatically.
   ```

4. `ScheduleWakeup` を呼び出す:
   - `delaySeconds`: 上記で計算した値
   - `prompt`: `resume_prompt` が指定されていればそれを使用。なければ現在の /loop プロンプトをそのまま渡す。
   - `reason`: `"Rate limit at {utilization:.0f}%, waiting for reset"`

5. 現在のイテレーションを終了する（それ以上作業を進めない）

## 注意事項

- **長時間ループの先頭**で呼び出すことを想定している
- Claude Usage HUD が起動していない場合はガード不可として作業継続（止まらない）
- ScheduleWakeup の上限は3600秒のため、残り2時間以上でも1時間後に再チェックが入る
- 同一セッションの並行やり取りで100%を超えてしまった場合は次のwakeup時に再チェックされる
