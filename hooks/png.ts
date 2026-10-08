// Just enough PNG to find where a sprite's visible pixels lie: an inflate
// (the plugin environment has no DecompressionStream) and the five filters.

type Tree = { counts: Uint16Array; symbols: Uint16Array }

function buildTree(lengths: ArrayLike<number>, n: number): Tree {
  const counts = new Uint16Array(16)
  const symbols = new Uint16Array(n)
  const offs = new Uint16Array(16)
  for (let i = 0; i < n; i++) counts[lengths[i]!]!++
  counts[0] = 0
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1]! + counts[i - 1]!
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]!]!++] = i
  return { counts, symbols }
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LBITS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DBITS = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

const FIXED_LIT = buildTree(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)), 288)
const FIXED_DIST = buildTree(Array.from({ length: 30 }, () => 5), 30)

// zlib stream (2-byte header, deflate blocks) to bytes.
export function inflate(data: Uint8Array): Uint8Array {
  let pos = 2
  let tag = 0
  let bitcount = 0
  const out: number[] = []

  const bit = () => {
    if (bitcount === 0) {
      tag = data[pos++] ?? 0
      bitcount = 8
    }
    const b = tag & 1
    tag >>>= 1
    bitcount--
    return b
  }
  const bits = (n: number, base: number) => {
    let v = 0
    for (let i = 0; i < n; i++) v |= bit() << i
    return base + v
  }
  const sym = (t: Tree) => {
    let sum = 0
    let cur = 0
    let len = 0
    do {
      cur = 2 * cur + bit()
      len++
      sum += t.counts[len]!
      cur -= t.counts[len]!
    } while (cur >= 0 && len < 15)
    return t.symbols[sum + cur]!
  }

  for (let final = 0; !final; ) {
    final = bit()
    const type = bits(2, 0)
    if (type === 0) {
      bitcount = 0
      const len = data[pos]! | (data[pos + 1]! << 8)
      pos += 4
      for (let i = 0; i < len; i++) out.push(data[pos++]!)
      continue
    }
    let lit = FIXED_LIT
    let dist = FIXED_DIST
    if (type === 2) {
      const hlit = bits(5, 257)
      const hdist = bits(5, 1)
      const hclen = bits(4, 4)
      const clens = new Uint8Array(19)
      for (let i = 0; i < hclen; i++) clens[CLC_ORDER[i]!] = bits(3, 0)
      const clTree = buildTree(clens, 19)
      const lens = new Uint8Array(hlit + hdist)
      for (let n = 0; n < hlit + hdist; ) {
        const s = sym(clTree)
        if (s < 16) lens[n++] = s
        else {
          const [value, count] =
            s === 16 ? [lens[n - 1] ?? 0, bits(2, 3)] : s === 17 ? [0, bits(3, 3)] : [0, bits(7, 11)]
          for (let i = 0; i < count; i++) lens[n++] = value
        }
      }
      lit = buildTree(lens.subarray(0, hlit), hlit)
      dist = buildTree(lens.subarray(hlit), hdist)
    } else if (type !== 1) {
      throw new Error('bad deflate block')
    }
    for (;;) {
      const s = sym(lit)
      if (s === 256) break
      if (s < 256) {
        out.push(s)
        continue
      }
      const length = bits(LBITS[s - 257]!, LBASE[s - 257]!)
      const d = sym(dist)
      const back = bits(DBITS[d]!, DBASE[d]!)
      const from = out.length - back
      for (let i = 0; i < length; i++) out.push(out[from + i]!)
    }
  }
  return Uint8Array.from(out)
}

export type SpriteBox = { width: number; height: number; box: [number, number, number, number] }

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

// The image's size and the box around its visible pixels, or null when the
// bytes are no PNG this can read (an interlaced one draws whole).
export function measurePng(bytes: Uint8Array): SpriteBox | null {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const u32 = (p: number) => ((bytes[p]! << 24) | (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!) >>> 0
  let p = 8
  let width = 0
  let height = 0
  let depth = 8
  let ct = 6
  let interlace = 0
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  while (p + 8 <= bytes.length) {
    const len = u32(p)
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!)
    const data = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      width = u32(p + 8)
      height = u32(p + 12)
      depth = data[8]!
      ct = data[9]!
      interlace = data[12]!
    } else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const channels = CHANNELS[ct]
  if (!width || !height || !channels) return null
  const whole: SpriteBox = { width, height, box: [0, 0, width, height] }
  if (interlace) return whole

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of idat) {
    joined.set(c, o)
    o += c.length
  }
  const raw = inflate(joined)
  const bpp = Math.max(1, (depth * channels) >> 3)
  const stride = Math.ceil((width * depth * channels) / 8)
  const sample = (line: Uint8Array, i: number) =>
    depth === 16 ? line[i * 2]! : depth === 8 ? line[i]! : (line[(i * depth) >> 3]! >> (8 - depth - ((i * depth) & 7))) & ((1 << depth) - 1)

  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  let prev = new Uint8Array(stride)
  let r = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[r++]!
    const line = raw.slice(r, r + stride)
    r += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      let v = line[i]!
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 255
    }
    prev = line
    for (let x = 0; x < width; x++) {
      let isVisible = true
      if (ct === 6 || ct === 4) isVisible = sample(line, x * channels + channels - 1) > 0
      else if (ct === 3) {
        const idx = sample(line, x)
        isVisible = !trns || idx >= trns.length || trns[idx]! > 0
      } else if (trns && depth === 8) {
        // A single transparent colour: grey (ct 0) or RGB (ct 2), 16-bit values.
        isVisible = [...Array(channels)].some((_, k) => line[x * channels + k] !== trns![k * 2 + 1])
      }
      if (isVisible) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { width, height, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] }
}
