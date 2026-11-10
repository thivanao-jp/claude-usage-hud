import { describe, expect, it } from 'vitest'
import { MAX_LAYOUTS, displaySignature, findDisplayByOrigin, fitIntoWorkArea, upsertLayout, type DisplayInfo } from './displayLayouts'

const laptop: DisplayInfo = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 25, width: 1512, height: 957 },
  scaleFactor: 2,
}
const external: DisplayInfo = {
  bounds: { x: 1512, y: -200, width: 2560, height: 1440 },
  workArea: { x: 1512, y: -175, width: 2560, height: 1415 },
  scaleFactor: 1,
}

describe('displaySignature', () => {
  it('does not depend on the order displays are reported in', () => {
    expect(displaySignature([laptop, external])).toBe(displaySignature([external, laptop]))
  })
  it('distinguishes a different arrangement of the same monitors', () => {
    const moved = { ...external, bounds: { ...external.bounds, x: -2560 } }
    expect(displaySignature([laptop, external])).not.toBe(displaySignature([laptop, moved]))
  })
})

describe('fitIntoWorkArea', () => {
  it('keeps a window that is fully on a display', () => {
    expect(fitIntoWorkArea({ x: 100, y: 100, width: 320, height: 200 }, [laptop])).toEqual({ x: 100, y: 100 })
  })
  it('pulls back a window whose top-left is on screen but most of it is not', () => {
    // 左上は画面内（以前の判定では採用されていた）
    expect(fitIntoWorkArea({ x: 1500, y: 950, width: 320, height: 200 }, [laptop])).toEqual({ x: 1192, y: 782 })
  })
  it('moves a window left on a disconnected display onto the nearest remaining one', () => {
    expect(fitIntoWorkArea({ x: 3000, y: 300, width: 320, height: 200 }, [laptop])).toEqual({ x: 1192, y: 300 })
  })
  it('prefers the display the window overlaps most', () => {
    expect(fitIntoWorkArea({ x: 1400, y: 100, width: 320, height: 200 }, [laptop, external])).toEqual({ x: 1512, y: 100 })
  })
  it('keeps a window that sits fully on the external display', () => {
    expect(fitIntoWorkArea({ x: 2000, y: -100, width: 320, height: 200 }, [laptop, external])).toEqual({ x: 2000, y: -100 })
  })
})

describe('layout store', () => {
  it('finds the display that held the Ultra window by its origin', () => {
    expect(findDisplayByOrigin([laptop, external], { x: 1512, y: -200 })).toBe(external)
    expect(findDisplayByOrigin([laptop], { x: 1512, y: -200 })).toBeNull()
  })
  it('merges into the existing layout and drops the oldest beyond the limit', () => {
    let layouts = upsertLayout(undefined, 'a', { viewMode: 'compact', compactX: 1, compactY: 2 }, new Date('2026-01-01'))
    layouts = upsertLayout(layouts, 'a', { viewMode: 'detail', detailX: 3, detailY: 4 }, new Date('2026-01-02'))
    expect(layouts.a).toMatchObject({ viewMode: 'detail', compactX: 1, detailX: 3 })
    for (let i = 0; i < MAX_LAYOUTS; i++) {
      layouts = upsertLayout(layouts, `k${i}`, { viewMode: 'ultra' }, new Date(Date.UTC(2026, 1, 1 + i)))
    }
    expect(Object.keys(layouts)).toHaveLength(MAX_LAYOUTS)
    expect(layouts.a).toBeUndefined()
  })
})
