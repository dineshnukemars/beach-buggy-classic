import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeB = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.concat([typeB, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcBuf))
  return Buffer.concat([len, typeB, data, crc])
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hash(x: number, y: number, s: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453
  return n - Math.floor(n)
}

function fill(
  size: number,
  pixel: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y)
      const i = (y * size + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = 255
    }
  }
  return rgba
}

const size = 128

const textures: Record<string, Uint8Array> = {
  sand: fill(size, (x, y) => {
    const n = hash(x, y, 1) * 40
    return [210 + n, 176 + n * 0.6, 110 + n * 0.3]
  }),
  ocean: fill(size, (x, y) => {
    const wave = Math.sin(x * 0.2 + y * 0.05) * 18 + hash(x, y, 2) * 12
    return [20 + wave, 90 + wave, 140 + wave]
  }),
  rust: fill(size, (x, y) => {
    const n = hash(x, y, 3)
    return [120 + n * 80, 50 + n * 30, 28 + n * 10]
  }),
  checker: fill(size, (x, y) => {
    const cell = (Math.floor(x / 16) + Math.floor(y / 16)) % 2
    return cell ? [240, 240, 240] : [40, 40, 40]
  }),
  asphalt: fill(size, (x, y) => {
    const n = hash(x, y, 4) * 25
    return [45 + n, 46 + n, 48 + n]
  }),
}

const out = join(fileURLToPath(new URL('.', import.meta.url)), '../public/samples')
mkdirSync(out, { recursive: true })
for (const [name, rgba] of Object.entries(textures)) {
  writeFileSync(join(out, `${name}.png`), encodePng(size, size, rgba))
  console.log('wrote', name)
}
