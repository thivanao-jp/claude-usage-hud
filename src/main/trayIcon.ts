/**
 * 使用率に応じたカラフルな縦バーアイコンを動的生成する。
 * 外部ライブラリなし（Node.js 組み込みの zlib のみ使用）。
 */

import { deflateSync } from 'zlib'
import { nativeImage, NativeImage } from 'electron'
import { UsageData, UsageEntry } from './claudeApi'
import { Settings } from './settings'
import { WEEKLY_FIELD_DEFS } from './fieldDefs'

// ---- Minimal PNG encoder ----

function encodePNG(width: number, height: number, rgba: Buffer): Buffer {
  const crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    crcTable[i] = c
  }
  function crc32(data: Buffer): number {
    let crc = 0xFFFFFFFF
    for (const b of data) crc = crcTable[(crc ^ b) & 0xFF]! ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  function u32be(n: number): Buffer {
    const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b
  }
  function chunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii')
    const crcBuf = u32be(crc32(Buffer.concat([t, data])))
    return Buffer.concat([u32be(data.length), t, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 6  // 8-bit RGBA

  // filter type 0 (None) を各スキャンラインの先頭に付与
  const rowSize = width * 4
  const raw = Buffer.alloc(height * (rowSize + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0
    rgba.copy(raw, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- Bar icon generator ----

type RGB = [number, number, number]

/** 使用率に応じて色を返す（基本色 → 黄 → 赤） */
function barColor(pct: number, base: RGB): RGB {
  if (pct >= 90) return [224, 90, 43]
  if (pct >= 70) return [224, 161, 43]
  return base
}

function hexToRgb(hex: string): RGB {
  const m = hex.replace('#', '').match(/.{2}/g)
  if (!m || m.length < 3) return [128, 128, 128]
  return [parseInt(m[0]!, 16), parseInt(m[1]!, 16), parseInt(m[2]!, 16)] as RGB
}

/**
 * 使用率バーの PNG を生成して NativeImage を返す。
 * 表示対象バーが 0 件の場合は空の NativeImage を返す。
 */
export function createBarIcon(
  usage: UsageData,
  settings: Settings,
  isStale: boolean
): NativeImage {
  type Bar = { pct: number; color: RGB }
  const bars: Bar[] = []
  const usageRecord = usage as unknown as Record<string, UsageEntry | null>
  const showFields = settings.tray.showFields ?? {}

  function addRgb(pct: number | null | undefined, base: RGB): void {
    if (pct == null) return
    bars.push({ pct: Math.min(Math.round(pct), 100), color: barColor(pct, base) })
  }

  if (settings.tray.show5h) addRgb(usage.five_hour?.utilization, [74, 158, 255])
  for (const field of WEEKLY_FIELD_DEFS) {
    if (showFields[field.key]) {
      const entry = usageRecord[field.key]
      addRgb(entry?.utilization, hexToRgb(field.color))
    }
  }

  if (bars.length === 0) return nativeImage.createEmpty()

  const SIZE = 32
  const rgba = Buffer.alloc(SIZE * SIZE * 4, 0)

  // ギャップ 1px を挟んで等幅に分割（最後のバーは端まで埋める）
  const gap = 1
  const barW = Math.floor((SIZE - gap * (bars.length - 1)) / bars.length)

  for (let i = 0; i < bars.length; i++) {
    const { pct, color } = bars[i]
    const x = i * (barW + gap)
    const w = (i === bars.length - 1) ? SIZE - x : barW
    const fillH = Math.round((pct / 100) * SIZE)

    for (let y = 0; y < SIZE; y++) {
      const filled = y >= SIZE - fillH
      const alpha = isStale ? (filled ? 160 : 60) : (filled ? 255 : 90)
      const [r, g, b] = filled ? color : [40, 40, 40]
      for (let px = x; px < x + w; px++) {
        const idx = (y * SIZE + px) * 4
        rgba[idx + 0] = r!
        rgba[idx + 1] = g!
        rgba[idx + 2] = b!
        rgba[idx + 3] = alpha
      }
    }
  }

  return nativeImage.createFromBuffer(encodePNG(SIZE, SIZE, rgba))
}
