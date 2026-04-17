import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { UsageData } from './claudeApi'

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
  return _db
}

export function saveUsageHistory(usage: UsageData): void {
  db()
    .prepare(
      `INSERT INTO usage_history (five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_sonnet, seven_day_cowork, seven_day_omelette, extra_usage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      usage.five_hour?.utilization ?? null,
      usage.seven_day?.utilization ?? null,
      usage.seven_day_oauth_apps?.utilization ?? null,
      usage.seven_day_opus?.utilization ?? null,
      usage.seven_day_sonnet?.utilization ?? null,
      usage.seven_day_cowork?.utilization ?? null,
      usage.seven_day_omelette?.utilization ?? null,
      usage.extra_usage?.utilization ?? null
    )
}

export interface HistoryRow {
  recorded_at: string
  five_hour: number | null
  seven_day: number | null
  seven_day_oauth_apps: number | null
  seven_day_opus: number | null
  seven_day_sonnet: number | null
  seven_day_cowork: number | null
  seven_day_omelette: number | null
  extra_usage: number | null
}

export function getUsageHistory(days: number): HistoryRow[] {
  return db()
    .prepare(
      `SELECT recorded_at, five_hour, seven_day, seven_day_oauth_apps, seven_day_opus, seven_day_sonnet, seven_day_cowork, seven_day_omelette, extra_usage
       FROM usage_history
       WHERE recorded_at >= datetime('now', ?)
       ORDER BY recorded_at ASC`
    )
    .all(`-${days} days`) as HistoryRow[]
}
