import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { HistoryRow } from '../types'
import { useT } from '../LangContext'

interface Props {
  days: number
}

/** データの中から日付変わり目（00:00）または 5h リセット境界などのX軸インデックスを返す */
function buildReferenceLines(data: HistoryRow[]): string[] {
  const lines: string[] = []
  let prevDate = ''
  for (const row of data) {
    const d = new Date(row.recorded_at)
    // YYYY-MM-DD を日付境界として使う
    const dateStr = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
    if (prevDate && dateStr !== prevDate) {
      // この行の time ラベルを境界として記録
      lines.push(d.toLocaleString([], {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }))
    }
    prevDate = dateStr
  }
  return lines
}

export function HistoryChart({ days }: Props) {
  const t = useT()
  const [data, setData] = useState<HistoryRow[]>([])

  useEffect(() => {
    window.api.getHistory(days).then(setData)
  }, [days])

  if (data.length === 0) {
    return (
      <div style={{ color: '#444', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
        {t('noHistory')}
      </div>
    )
  }

  const chartData = data.map(row => ({
    time: new Date(row.recorded_at).toLocaleString([], {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }),
    '5h': row.five_hour ?? undefined,
    '7d': row.seven_day ?? undefined,
    'OAuth': row.seven_day_oauth_apps ?? undefined,
    'Opus': row.seven_day_opus ?? undefined,
    'Extra': row.extra_usage ?? undefined,
  }))

  const refLines = buildReferenceLines(data)

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 9, fill: '#555' }}
          interval="preserveStartEnd"
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: '#555' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'rgba(20,20,25,0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            fontSize: 11
          }}
          labelStyle={{ color: '#aaa' }}
          formatter={(v: number) => [`${Math.round(v)}%`]}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, color: '#666' }}
          iconType="plainline"
          iconSize={12}
        />
        {/* 日付変わり目の縦ガイド線 */}
        {refLines.map(xVal => (
          <ReferenceLine
            key={xVal}
            x={xVal}
            stroke="rgba(255,255,255,0.45)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            label={undefined}
          />
        ))}
        <Line type="monotone" dataKey="5h"    stroke="#4a9eff" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="7d"    stroke="#54c98e" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="OAuth" stroke="#e0a12b" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="Opus"  stroke="#b07aee" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="Extra" stroke="#a78bfa" dot={false} strokeWidth={1.5} strokeDasharray="5 3" />
      </LineChart>
    </ResponsiveContainer>
  )
}
