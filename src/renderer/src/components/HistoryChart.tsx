import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { HistoryRow } from '../types'
import { useT } from '../LangContext'
import { useTheme } from '../ThemeContext'

interface Props {
  days: number
}

function buildReferenceLines(data: HistoryRow[]): string[] {
  const lines: string[] = []
  let prevDate = ''
  for (const row of data) {
    const d = new Date(row.recorded_at)
    const dateStr = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
    if (prevDate && dateStr !== prevDate) {
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
  const th = useTheme()
  const [data, setData] = useState<HistoryRow[]>([])

  useEffect(() => {
    window.api.getHistory(days).then(setData)
  }, [days])

  if (data.length === 0) {
    return (
      <div style={{ color: th.textFaint2, fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
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
        <CartesianGrid strokeDasharray="3 3" stroke={th.borderChart} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 9, fill: th.chartTick }}
          interval="preserveStartEnd"
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: th.chartTick }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            background: th.bgChartTooltip,
            border: `1px solid ${th.borderChartTooltip}`,
            borderRadius: 6,
            fontSize: 11
          }}
          labelStyle={{ color: th.textLabel }}
          formatter={(v: number) => [`${Math.round(v)}%`]}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, color: th.chartLegend }}
          iconType="plainline"
          iconSize={12}
        />
        {refLines.map(xVal => (
          <ReferenceLine
            key={xVal}
            x={xVal}
            stroke={th.chartRefLine}
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
