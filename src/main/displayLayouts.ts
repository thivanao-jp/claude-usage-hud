/**
 * ディスプレイの接続構成ごとのウィンドウ配置（表示モード・位置）と、
 * ウィンドウを画面内に収める計算。Electron に依存しない純粋関数だけを置く（テスト用）。
 */

export type LayoutViewMode = 'compact' | 'detail' | 'ultra'
export type LayoutUltraPosition = 'top-left' | 'top-right' | 'top-center'

export interface Rect { x: number; y: number; width: number; height: number }

export interface DisplayInfo {
  bounds: Rect
  workArea: Rect
  scaleFactor: number
}

export interface DisplayLayout {
  viewMode: LayoutViewMode
  compactX?: number
  compactY?: number
  detailX?: number
  detailY?: number
  ultraPosition?: LayoutUltraPosition
  /** Ultra を置いていたディスプレイ（bounds の左上で識別） */
  ultraDisplay?: { x: number; y: number }
  savedAt: string
}

/** 記憶しておく構成の上限。古いものから捨てる */
export const MAX_LAYOUTS = 20

/**
 * 接続構成の識別キー。ディスプレイIDは再起動や接続し直しで変わることがあるため使わず、
 * 各ディスプレイの配置・解像度・拡大率の並びで識別する。
 */
export function displaySignature(displays: DisplayInfo[]): string {
  return displays
    .map(d => `${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}@${Math.round(d.scaleFactor * 100)}`)
    .sort()
    .join('|')
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function distanceSq(rect: Rect, area: Rect): number {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const dx = Math.max(area.x - cx, 0, cx - (area.x + area.width))
  const dy = Math.max(area.y - cy, 0, cy - (area.y + area.height))
  return dx * dx + dy * dy
}

/**
 * ウィンドウ全体がどれかのディスプレイの作業領域に収まっていればそのまま返す。
 * はみ出していれば、いちばん重なっている（重ならなければいちばん近い）ディスプレイの作業領域へ寄せる。
 * 左上の1点だけで判定すると、ほとんど画面外のウィンドウを「画面内」と見なしてしまうため。
 */
export function fitIntoWorkArea(rect: Rect, displays: DisplayInfo[]): { x: number; y: number } {
  if (displays.length === 0) return { x: rect.x, y: rect.y }
  const contained = displays.some(d => overlapArea(rect, d.workArea) === rect.width * rect.height)
  if (contained) return { x: rect.x, y: rect.y }

  let best = displays[0]
  let bestOverlap = -1
  let bestDist = Infinity
  for (const d of displays) {
    const o = overlapArea(rect, d.workArea)
    const dist = distanceSq(rect, d.workArea)
    if (o > bestOverlap || (o === bestOverlap && dist < bestDist)) {
      best = d
      bestOverlap = o
      bestDist = dist
    }
  }
  const wa = best.workArea
  const x = Math.min(Math.max(rect.x, wa.x), wa.x + Math.max(0, wa.width - rect.width))
  const y = Math.min(Math.max(rect.y, wa.y), wa.y + Math.max(0, wa.height - rect.height))
  return { x: Math.round(x), y: Math.round(y) }
}

/** Ultra を置くディスプレイを選ぶ。記憶した左上と一致するものが無ければ null */
export function findDisplayByOrigin(displays: DisplayInfo[], origin: { x: number; y: number } | undefined): DisplayInfo | null {
  if (!origin) return null
  return displays.find(d => d.bounds.x === origin.x && d.bounds.y === origin.y) ?? null
}

/** 構成ごとの配置を更新し、上限を超えたら古いものから捨てる */
export function upsertLayout(
  layouts: Record<string, DisplayLayout> | undefined,
  signature: string,
  patch: Partial<DisplayLayout> & { viewMode: LayoutViewMode },
  now: Date = new Date(),
): Record<string, DisplayLayout> {
  const next: Record<string, DisplayLayout> = { ...(layouts ?? {}) }
  next[signature] = { ...(next[signature] ?? {}), ...patch, savedAt: now.toISOString() }
  const keys = Object.keys(next)
  if (keys.length > MAX_LAYOUTS) {
    keys
      .sort((a, b) => next[a].savedAt.localeCompare(next[b].savedAt))
      .slice(0, keys.length - MAX_LAYOUTS)
      .forEach(k => { delete next[k] })
  }
  return next
}
