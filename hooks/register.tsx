import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Team, Walker } from '../types'
import { measurePng } from './png'

const team = atom({ plugin: 'pokewait', key: 'team' } as const, [] as Team)

// Every Pokémon, #1–1025, drawn as the games of its own generation drew it,
// from PokeAPI's sprite repo. `frame` is that generation's sprite frame in
// pixels, what a Pokémon's size is measured against (see spriteHeight).
type Source = { last: number; path: (id: number) => string; frame: number }
export const SOURCES: Source[] = [
  { last: 151, path: id => `versions/generation-i/red-blue/transparent/${id}.png`, frame: 56 },
  { last: 251, path: id => `versions/generation-ii/crystal/transparent/${id}.png`, frame: 56 },
  { last: 386, path: id => `versions/generation-iii/emerald/${id}.png`, frame: 64 },
  { last: 493, path: id => `versions/generation-iv/platinum/${id}.png`, frame: 80 },
  { last: 649, path: id => `versions/generation-v/black-white/${id}.png`, frame: 96 },
  // Gens 6–9 had no pixel sprites of their own; PokeAPI's default ones are.
  { last: 1025, path: id => `${id}.png`, frame: 96 },
]
export const MAX_ID = SOURCES[SOURCES.length - 1]!.last

export function sourceOf(id: number): Source {
  return SOURCES.find(s => id <= s.last) ?? SOURCES[SOURCES.length - 1]!
}

const SPRITES = 'PokeAPI/sprites/master/sprites/pokemon'
// The file itself, for curl: no rate limit.
export const rawUrl = (id: number) => `https://raw.githubusercontent.com/${SPRITES}/${sourceOf(id).path(id)}`
// The same file as base64 JSON, for when curl is missing: 60 an hour.
export const apiUrl = (id: number) =>
  `https://api.github.com/repos/PokeAPI/sprites/contents/sprites/pokemon/${sourceOf(id).path(id)}`

const TEAM_SIZE = 8
export const BAND_HEIGHT = 30
// The smallest Pokémon is drawn this share of the band's height, the biggest
// all of it: big ones stand taller, small ones stay easy to see.
const MIN_SHARE = 0.65
// The canvas is wider than any band and cropped, never scaled, to the width
// the surface gives the image: see bandSvg.
const CANVAS_WIDTH = 4000

const px = (n: number) => Math.round(n * 100) / 100

// How tall a sprite is drawn, from how much of its generation's frame it fills.
export function spriteHeight(id: number, boxHeight: number): number {
  const fill = Math.min(1, boxHeight / sourceOf(id).frame)
  return px(BAND_HEIGHT * (MIN_SHARE + (1 - MIN_SHARE) * fill))
}

// One walker crosses the whole band and back, standing on the ground line.
// The front sprites face left, so it is mirrored on the way right. `100vw`
// inside the image is the width it is drawn at, so the walk ends at the
// band's right edge whatever its width.
export function walkerSvg(w: Walker, index: number): string {
  const [bx, by, bw, bh] = w.box
  const height = spriteHeight(w.id, bh)
  const width = px((bw * height) / bh)
  const timing = `${w.seconds}s linear -${w.offset}s infinite`
  return (
    `<style>@keyframes walk${index}{0%,100%{transform:translateX(0)}50%{transform:translateX(calc(100vw - ${width}px))}}</style>` +
    `<g style="animation:walk${index} ${timing}">` +
    `<g class="face" style="animation:face ${timing}">` +
    `<g class="bob" style="animation-delay:-${(w.offset % 0.4).toFixed(2)}s">` +
    `<svg x="0" y="${px(BAND_HEIGHT - height)}" width="${width}" height="${height}" viewBox="${bx} ${by} ${bw} ${bh}">` +
    `<image width="${w.width}" height="${w.height}" href="data:image/png;base64,${w.png}"/>` +
    `</svg></g></g></g>`
  )
}

// An Svg drawn as an image with no size of its own is 300px wide, so the
// canvas is CANVAS_WIDTH wide: the surface draws it as wide as the band allows
// at the height given, and `slice` crops the rest instead of shrinking it.
export function bandSvg(walkers: Team): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${BAND_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${BAND_HEIGHT}" preserveAspectRatio="xMinYMax slice">` +
    `<style>` +
    `@keyframes face{0%,49.99%{transform:scaleX(-1)}50%,100%{transform:scaleX(1)}}` +
    `@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1px)}}` +
    `.face{transform-box:fill-box;transform-origin:center}` +
    `.bob{animation:bob 0.4s linear infinite}` +
    `</style>` +
    walkers.map(walkerSvg).join('') +
    `</svg>`
  )
}

// A small seeded generator: picks stay reproducible in tests.
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function pickIds(rand: () => number, n = TEAM_SIZE): number[] {
  const ids = new Set<number>()
  while (ids.size < n) ids.add(1 + Math.floor(rand() * MAX_ID))
  return [...ids]
}

// Spread walkers along the path so they don't start in a pile.
export function pace(rand: () => number, index: number, size: number): { seconds: number; offset: number } {
  const seconds = Math.round(20 + rand() * 16)
  const offset = Math.round(((index + rand() * 0.5) / size) * seconds * 10) / 10
  return { seconds, offset }
}

const fromBase64 = (b64: string): Uint8Array =>
  (Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }).fromBase64(b64)

type $ = EngineInterface
type Sprite = Omit<Walker, 'seconds' | 'offset'>

// Sprites live on disk, one PNG each, so the cache can hold all 1025.
async function cacheDir($: $): Promise<string | null> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.claude/pokewait-cache` : null
}

async function readBase64($: $, file: string): Promise<string | null> {
  try {
    return (await $.fs.read(file, { as: 'bytes' })).base64
  } catch {
    return null
  }
}

// The cached PNG, else one curl downloads into the cache, else the GitHub API's copy.
async function fetchPng($: $, id: number, dir: string | null): Promise<string | null> {
  const file = dir && `${dir}/${id}.png`
  if (file) {
    const hit = await readBase64($, file)
    if (hit) return hit
    try {
      const { exitCode } = await $.process.run(['curl', '-sfL', '--create-dirs', '-o', file, rawUrl(id)], {
        timeoutMs: 20_000,
      })
      if (exitCode === 0) {
        const got = await readBase64($, file)
        if (got) return got
      }
    } catch {
      // No curl: fall through to the API.
    }
  }
  try {
    const res = await $.http.fetch(apiUrl(id), { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    return String((JSON.parse(res.text) as { content?: string }).content ?? '').replace(/\s/g, '') || null
  } catch {
    return null
  }
}

// The PNG and where its pixels lie, measured once it arrives.
async function loadSprite($: $, id: number, dir: string | null): Promise<Sprite | null> {
  const png = await fetchPng($, id, dir)
  if (!png) return null
  try {
    const m = measurePng(fromBase64(png))
    return m ? { id, png, width: m.width, height: m.height, box: m.box } : null
  } catch {
    return null
  }
}

// Offline or rate-limited: any sprite already in the cache.
async function anyCached($: $, dir: string | null, rand: () => number, skip: Set<number>): Promise<Sprite | null> {
  if (!dir) return null
  try {
    const ids = (await $.fs.list(dir))
      .map(e => Number(/^(\d+)\.png$/.exec(e.name)?.[1]))
      .filter(id => id > 0 && !skip.has(id))
    for (let tries = 0; tries < 3 && ids.length > 0; tries++) {
      const [id] = ids.splice(Math.floor(rand() * ids.length), 1)
      const sprite = await loadSprite($, id!, dir)
      if (sprite) return sprite
    }
  } catch {
    // No cache yet.
  }
  return null
}

export async function newTeam($: $, seed: number): Promise<Team> {
  const rand = rng(seed)
  const dir = await cacheDir($)
  const ids = pickIds(rand)
  const found = await Promise.all(ids.map(id => loadSprite($, id, dir)))
  const picked: Sprite[] = []
  const used = new Set<number>()
  for (const sprite of found) {
    const s = sprite && !used.has(sprite.id) ? sprite : await anyCached($, dir, rand, used)
    if (s) {
      used.add(s.id)
      picked.push(s)
    }
  }
  return picked.map((s, i) => ({ ...s, ...pace(rand, i, picked.length) }))
}

// Earlier versions cached sprites in the store, up to 3 MB of them.
async function dropOldCache($: $): Promise<void> {
  for (const key of await $.store.keys()) {
    if (/^(sprite|gen1):/.test(key) || key === 'index' || key === 'cached') await $.store.delete(key)
  }
}

let refreshing = false

// Fetch the next party in the background; the band shows it once it lands.
async function refresh($: $): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const party = await newTeam($, await $.clock.now())
    if (party.length > 0) await update($, team, () => party)
  } finally {
    refreshing = false
  }
}

export const register: Register = on => {
  refreshing = false

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await dropOldCache($)
    const current = await read($, team)
    if (current.length === 0 || !current[0]?.box) void refresh($)
    return result
  })

  // A fresh party for every prompt.
  on('prompt.submit', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  // Draw whatever the plugins beneath draw (the usage band, say) first, then
  // stack the Pokémon on top of it, so they sit above every other band mod.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!e.props.isWorking || e.props.hasSurvey) return below

    const els = $.ui.resolve(e)
    if (!('Svg' in els)) return below
    const { Box, Svg } = els

    // A party from an earlier version has no box; wait for a new one.
    const walkers = (await read($, team)).filter(w => w.png && w.box)
    if (walkers.length === 0) return below

    // A growing box in a row is what stretches an Svg across the band.
    return (
      <Box flexDirection="column" width="100%">
        <Box flexDirection="row" width="100%">
          <Box flexGrow={1} flexShrink={1} minWidth={8}>
            <Svg
              source={bandSvg(walkers)}
              alt={`Pokémon #${walkers.map(w => w.id).join(', #')} walking while Claude works`}
              height={BAND_HEIGHT}
            />
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
