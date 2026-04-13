interface PaceSettings {
  workHoursOnly: boolean
  workDayStart: number
  workDayEnd: number
  excludeWeekends: boolean
}

/**
 * Calculate work-time milliseconds between two timestamps.
 * Iterates hour-by-hour to correctly handle weekends and work-hour boundaries.
 */
function calcWorkMs(from: number, to: number, start: number, end: number, excludeWeekends: boolean): number {
  if (from >= to) return 0

  let ms = 0
  // Align to the start of the current hour
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  let cursor = d.getTime()
  if (cursor < from) cursor += 3600_000

  // Partial first hour
  {
    const hourStart = cursor - 3600_000
    const h = new Date(hourStart)
    const dow = h.getDay()
    const hour = h.getHours()
    const isWorkDay = !excludeWeekends || (dow !== 0 && dow !== 6)
    const isWorkHour = hour >= start && hour < end
    if (isWorkDay && isWorkHour) {
      const segEnd = Math.min(cursor, to)
      if (segEnd > from) ms += segEnd - from
    }
  }

  // Full hours
  while (cursor < to) {
    const nextCursor = cursor + 3600_000
    const h = new Date(cursor)
    const dow = h.getDay()
    const hour = h.getHours()
    const isWorkDay = !excludeWeekends || (dow !== 0 && dow !== 6)
    const isWorkHour = hour >= start && hour < end
    if (isWorkDay && isWorkHour) {
      ms += Math.min(nextCursor, to) - cursor
    }
    cursor = nextCursor
  }

  return ms
}

/**
 * Calculate pace percentage (0-100) based on elapsed time in period.
 * @param resetsAt - ISO timestamp when the period resets
 * @param periodMs - total period duration in milliseconds
 * @param pace - pace settings (work hours config)
 * @returns pace percentage, or null if cannot calculate
 */
export function calcPacePct(
  resetsAt: string,
  periodMs: number,
  pace: PaceSettings | undefined,
): number | null {
  const resetTime = new Date(resetsAt).getTime()
  const now = Date.now()
  const periodStart = resetTime - periodMs

  if (now <= periodStart) return 0
  if (now >= resetTime) return 100

  if (pace?.workHoursOnly) {
    const totalWork = calcWorkMs(periodStart, resetTime, pace.workDayStart, pace.workDayEnd, pace.excludeWeekends)
    if (totalWork <= 0) return null
    const elapsedWork = calcWorkMs(periodStart, now, pace.workDayStart, pace.workDayEnd, pace.excludeWeekends)
    return Math.min(Math.round((elapsedWork / totalWork) * 100), 100)
  }

  const elapsed = now - periodStart
  return Math.min(Math.round((elapsed / periodMs) * 100), 100)
}
