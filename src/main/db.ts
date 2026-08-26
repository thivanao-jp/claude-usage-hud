import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { UsageData } from './claudeApi'
import type { CodexUsageData } from './codexFetcher'
import type { CodexPacePoint } from './codexPaceMeter'

let _db: Database.Database | null = null

function db(): Database.Database {
  if (_db) return _db
  const path = join(app.getPath('userData'), 'history.db')
  _db = new Database(path)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS usage_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT    NOT NULL DEFAULT (datetime('now')),
      five_hour   REAL,
      seven_day   REAL,
      seven_day_oauth_apps REAL,
      seven_day_opus       REAL,
      seven_day_sonnet     REAL,
      seven_day_cowork     REAL,
      seven_day_omelette   REAL
    );
    CREATE INDEX IF NOT EXISTS idx_recorded_at ON usage_history(recorded_at);
    CREATE TABLE IF NOT EXISTS provider_usage_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      provider       TEXT NOT NULL,
      bucket_id      TEXT NOT NULL,
      recorded_at_ms INTEGER NOT NULL,
      utilization    REAL NOT NULL,
      resets_at      TEXT,
      window_minutes REAL
    );
    CREATE INDEX IF NOT EXISTS idx_provider_usage_history
      ON provider_usage_history(provider, bucket_id, recorded_at_ms);
  `)
  // 既存DBへのカラム追加（なければ追加）
  const cols = (_db.prepare("PRAGMA table_info(usage_history)").all() as { name: string }[]).map(c => c.name)
  if (!cols.includes('extra_usage')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN extra_usage REAL;')
  }
  if (!cols.includes('seven_day_sonnet')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN seven_day_sonnet REAL;')
  }
  if (!cols.includes('seven_day_cowork')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN seven_day_cowork REAL;')
  }
  if (!cols.includes('seven_day_omelette')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN seven_day_omelette REAL;')
  }
  if (!cols.includes('iguana_necktie')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN iguana_necktie REAL;')
  }
  if (!cols.includes('omelette_promotional')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN omelette_promotional REAL;')
  }
  if (!cols.includes('seven_day_fable')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN seven_day_fable REAL;')
  }
  if (!cols.includes('cinder_cove')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN cinder_cove REAL;')
  }
  if (!cols.includes('tangelo')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN tangelo REAL;')
  }
  if (!cols.includes('nimbus_quill')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN nimbus_quill REAL;')
  }
  if (!cols.includes('amber_ladder')) {
    _db.exec('ALTER TABLE usage_history ADD COLUMN amber_ladder REAL;')
  }
  return _db
}

export function saveUsageHistory(usage: UsageData): void {
  db()
    .prepare(
      `INSERT INTO usage_history (five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_fable, seven_day_sonnet, seven_day_cowork, seven_day_omelette, iguana_necktie, omelette_promotional, cinder_cove, tangelo, nimbus_quill, amber_ladder, extra_usage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      usage.five_hour?.utilization ?? null,
      usage.seven_day?.utilization ?? null,
      usage.seven_day_oauth_apps?.utilization ?? null,
      usage.seven_day_opus?.utilization ?? null,
      usage.seven_day_fable?.utilization ?? null,
      usage.seven_day_sonnet?.utilization ?? null,
      usage.seven_day_cowork?.utilization ?? null,
      usage.seven_day_omelette?.utilization ?? null,
      usage.iguana_necktie?.utilization ?? null,
      usage.omelette_promotional?.utilization ?? null,
      usage.cinder_cove?.utilization ?? null,
      usage.tangelo?.utilization ?? null,
      usage.nimbus_quill?.utilization ?? null,
      usage.amber_ladder?.utilization ?? null,
      usage.extra_usage?.utilization ?? null
    )
}

/** Codexのquota増分から燃費を計算できるよう、プロバイダー別の小さな時系列を保存する。 */
export function saveCodexUsageHistory(usage: CodexUsageData, recordedAt = Date.now()): void {
  const insert = db().prepare(
    `INSERT INTO provider_usage_history
      (provider, bucket_id, recorded_at_ms, utilization, resets_at, window_minutes)
     VALUES ('codex', ?, ?, ?, ?, ?)`
  )
  const transaction = db().transaction(() => {
    if (usage.fiveHourUtilization != null) {
      insert.run('primary', recordedAt, usage.fiveHourUtilization, usage.fiveHourResetDate, usage.primaryWindowMinutes)
    }
    insert.run('secondary', recordedAt, usage.utilization, usage.resetDate, usage.secondaryWindowMinutes)
    db().prepare(`DELETE FROM provider_usage_history WHERE recorded_at_ms < ?`).run(recordedAt - 14 * 24 * 60 * 60 * 1000)
  })
  transaction()
}

export function getCodexPaceHistory(sinceMs: number): CodexPacePoint[] {
  return db().prepare(
    `SELECT recorded_at_ms AS recordedAt, utilization, resets_at AS resetsAt
       FROM provider_usage_history
      WHERE provider = 'codex' AND bucket_id = 'primary' AND recorded_at_ms >= ?
      ORDER BY recorded_at_ms ASC`
  ).all(sinceMs) as CodexPacePoint[]
}

/**
 * デバッグ/スクリーンショット生成専用: usage_history を空にする。
 * screenshot mode は隔離済みプロファイルの DB を使い回すため、seed 前に必ず呼び、
 * 前回実行分の合成履歴が積み重なってグラフが二重化するのを防ぐ。
 */
export function debugClearHistory(): void {
  db().exec('DELETE FROM usage_history')
}

/**
 * デバッグ/スクリーンショット生成専用: recorded_at を明示指定して履歴を挿入する。
 * 呼び出し元 (main.ts の screenshot mode) で !app.isPackaged を確認してから使うこと。
 */
export function debugSeedHistory(points: { recordedAt: string; usage: UsageData }[]): void {
  const stmt = db().prepare(
    `INSERT INTO usage_history (recorded_at, five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_fable, seven_day_sonnet, seven_day_cowork, seven_day_omelette, iguana_necktie, omelette_promotional, cinder_cove, tangelo, nimbus_quill, amber_ladder, extra_usage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertAll = db().transaction((rows: typeof points) => {
    for (const { recordedAt, usage } of rows) {
      stmt.run(
        recordedAt,
        usage.five_hour?.utilization ?? null,
        usage.seven_day?.utilization ?? null,
        usage.seven_day_oauth_apps?.utilization ?? null,
        usage.seven_day_opus?.utilization ?? null,
        usage.seven_day_fable?.utilization ?? null,
        usage.seven_day_sonnet?.utilization ?? null,
        usage.seven_day_cowork?.utilization ?? null,
        usage.seven_day_omelette?.utilization ?? null,
        usage.iguana_necktie?.utilization ?? null,
        usage.omelette_promotional?.utilization ?? null,
        usage.cinder_cove?.utilization ?? null,
        usage.tangelo?.utilization ?? null,
        usage.nimbus_quill?.utilization ?? null,
        usage.amber_ladder?.utilization ?? null,
        usage.extra_usage?.utilization ?? null
      )
    }
  })
  insertAll(points)
}

export interface HistoryRow {
  recorded_at: string
  five_hour: number | null
  seven_day: number | null
  seven_day_oauth_apps: number | null
  seven_day_opus: number | null
  seven_day_fable: number | null
  seven_day_sonnet: number | null
  seven_day_cowork: number | null
  seven_day_omelette: number | null
  iguana_necktie: number | null
  omelette_promotional: number | null
  cinder_cove: number | null
  tangelo: number | null
  nimbus_quill: number | null
  amber_ladder: number | null
  extra_usage: number | null
}

export function getUsageHistory(days: number): HistoryRow[] {
  return db()
    .prepare(
      `SELECT recorded_at, five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_fable, seven_day_sonnet, seven_day_cowork, seven_day_omelette, iguana_necktie, omelette_promotional, cinder_cove, tangelo, nimbus_quill, amber_ladder, extra_usage
       FROM usage_history
       WHERE recorded_at >= datetime('now', ?)
       ORDER BY recorded_at ASC`
    )
    .all(`-${days} days`) as HistoryRow[]
}
