import { test, expect, mock } from 'claude-code/testing'

import { measurePng } from './png'
import { bandSvg, pickIds, rawUrl, rng, sourceOf, spriteHeight, walkerSvg, BAND_HEIGHT, MAX_ID } from './register'

// Real sprites from PokeAPI: Pikachu from Red/Blue, Typhlosion from Crystal.
const PIKACHU = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAD1BMVEUAAAASCwvRnAD/5Gj/7f+w919nAAAAAXRSTlMAQObYZgAAAW1JREFUeNrtloeR5EAMxIRu5h/zl0yL78py9u0gAKCoI2/n2Gw2m81ms9lsNn8OWuSxj58CE6tAb6ALgngpjmEBdaD16PEnMC68fiQB8ScwKEicgfhtSfEnMEFVbgk+iT+BGZS7QH3nL813E9viQlXtnw+QzRH1QDnf32N/T1BNK8kfY4Qvfw/A1wVmhaB6C1wFHWFNgYIE6BH6JFacgevC4F5MpPgnoDqhHqQqlvp1F9qv0tjfYFWR/bkLZe7C3J8bQFWgenC+EZr6Y23of03AuIC+KyBhK3kYB0SVT25/iaousGRLfVO9r7lfseTXILz+EplAU7/KTd3o5PYvGyABx89nAre/qky/mrww0KfGO4CHATduv8kAHgUEcsMbEM8K2eM7c0P0EuoVXVfAl99W9GsLQs5dxz8HhC69vmnlzbEG8vuVAnk2LYOTd23VD7PlgGwSWFsISLwBfzCw/hsFOP43NpvNZrPZbDZfAPq1CUX13OMvAAAAAElFTkSuQmCC'
const TYPHLOSION = 'iVBORw0KGgoAAAANSUhEUgAAADgAAAA4BAMAAABaqCYtAAAAD1BMVEX/////3kreMRgAAAD///9yvnKyAAAABXRSTlP/////APu2DlMAAAJXSURBVHicdZTNdts4DEYvOFmHoGZvU+4DjNtn6OtPT/oAkejuK4HtOkQXsn6ck2IjSFcgwA8g5Su7lQy0sL1vXgHeaFBgAP4fDrABlEIzBuBbCvC0wlxyq8TyFgdoo5IPkbQZV/EuGYyVsOcsIIwJeZ5dcVPyDk9DAElJq4phifBW2gpHBiWBJ3Gdxfl5az9W2COYgYA4UUiQVxjAowIgaAUj7NUatd5dEXV/2Mo1xnh31aiVXwf5XGoFfDBwVw3XA/zHo4KPTEiqkHfh2zxLBUYyBgpDYdF21FYCZ2hcBkx1FsOnLj/B+IoKZwELL88A4lEImYD/RCrcHOzs4AgiXDIEppqi0rLQkP/AweCyFCRXBHgzLLQCMJ99qfOJhAWdDItGEQc30+neMhFNKVx+TyOEEwgxoq3c99kp/TNuhNMNxEREaWXZp0D7zvWHn2+54Diz5bTLF75cf3uQ0w0UEdowA7IP9dhsaZniBp/0MH1kuzdong3R8Tiaj3YaJztCyauTNLz864eJP/zUQ8fJx88fLOsFTz39h5E4gjp/g4Dsc/veCpCOcOnXYgo87FM2z+7Pj3LeB/Av0KO8X/YAxd7DwXY/2juo0bek0h5hc6trrCH2AOUF1/VH3B/gK8iWtUg6wlbYI1mE2ODEKhqA87gsyHoruC8HZlXIC7qJW1FTP0TWLQ5ixJj3yCkeulJRpzsILwCdwmRLYfv0eQGkd6DrJoPk3fFKpb+oqDnWZdJ0s+2qeZ0JnYpIStZLd5lp23GQ0P3qAUUloZIuprqdshk5SLd++AMVXAyuQxRxUwAAAABJRU5ErkJggg=='
const bytes = (b64: string) => (Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }).fromBase64(b64)

test('measures where a sprite is drawn in its PNG', async () => {
  // As Node's zlib measured the same file.
  expect(JSON.stringify(measurePng(bytes(PIKACHU)))).toBe('{"width":96,"height":96,"box":[29,30,39,40]}')
  const typhlosion = measurePng(bytes(TYPHLOSION))!
  expect(typhlosion.width).toBe(56)
  expect(typhlosion.box[1] + typhlosion.box[3] <= 56).toBe(true)
  expect(measurePng(bytes('aGVsbG8gd29ybGQh'))).toBe(null)
})

test('each Pokémon comes from the games of its own generation', async () => {
  expect(MAX_ID).toBe(1025)
  expect(rawUrl(25)).toContain('generation-i/red-blue/transparent/25.png')
  expect(rawUrl(157)).toContain('generation-ii/crystal/transparent/157.png')
  expect(rawUrl(257)).toContain('generation-iii/emerald/257.png')
  expect(rawUrl(392)).toContain('generation-iv/platinum/392.png')
  expect(rawUrl(500)).toContain('generation-v/black-white/500.png')
  expect(rawUrl(906)).toBe('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/906.png')
  expect(sourceOf(151).frame).toBe(56)
  expect(sourceOf(649).frame).toBe(96)
})

test('eight different Pokémon from all 1025, the same for the same seed', async () => {
  const ids = pickIds(rng(42))
  expect(ids.length).toBe(8)
  expect(new Set(ids).size).toBe(8)
  for (const id of ids) expect(id >= 1 && id <= MAX_ID).toBe(true)
  expect(pickIds(rng(42)).join()).toBe(ids.join())
})

const PIKA_BOX: [number, number, number, number] = [29, 30, 39, 40]

test('a walker stands on the ground line and crosses the full width', async () => {
  const svg = walkerSvg({ id: 25, png: PIKACHU, width: 96, height: 96, box: PIKA_BOX, seconds: 20, offset: 3 }, 0)
  // Pikachu fills 40 of Red/Blue's 56px frame: 30 × (0.65 + 0.35 × 40/56) = 27px tall.
  expect(svg).toContain('y="3"')
  expect(svg).toContain('height="27"')
  expect(svg).toContain('translateX(calc(100vw - 26.33px))')
  expect(svg).toContain('animation:face 20s linear -3s infinite')
  expect(svg).toContain('viewBox="29 30 39 40"')
  expect(svg).toContain('<image width="96" height="96"')
})

test('small Pokémon stay easy to see, big ones stand tallest', async () => {
  expect(spriteHeight(25, 56)).toBe(BAND_HEIGHT)
  // Cherubi-sized: 10 of Platinum's 80px frame, 30 × (0.65 + 0.35 × 10/80).
  expect(spriteHeight(420, 10)).toBe(20.81)
  expect(spriteHeight(420, 10) >= BAND_HEIGHT * 0.65).toBe(true)
})

test('one Svg holds the whole party on a wide canvas cropped, never scaled', async () => {
  const party = [1, 2, 3].map(id => ({ id, png: PIKACHU, width: 96, height: 96, box: PIKA_BOX, seconds: 20, offset: id }))
  const svg = bandSvg(party)
  expect(svg).toContain(`viewBox="0 0 4000 ${BAND_HEIGHT}" preserveAspectRatio="xMinYMax slice"`)
  expect(svg.split('<image ').length - 1).toBe(3)
})

const band = (isWorking: boolean) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 100 },
})

type On = Parameters<Parameters<typeof test>[1]>[1]

// Stands in for the machine beneath: a home folder, a disk cache curl fills,
// GitHub's API rate-limited, prompts answered without a model turn, and a
// band of its own.
function machine(on: On, opts: { hasCurl: boolean; cached?: string[] }) {
  const dir = 'C:/home/.claude/pokewait-cache'
  // The engine hands paths on as the OS spells them; the fake disk ignores which slash.
  const key = (path: string) => path.replace(/\\/g, '/')
  const disk = new Map<string, string>((opts.cached ?? []).map(f => [`${dir}/${f}`, PIKACHU]))
  const downloads: string[] = []
  mock.env(on, { USERPROFILE: 'C:/home' })
  mock.store(on)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('process.run', ($, e) => {
    if (!opts.hasCurl) return { deny: 'curl: not found' } as never
    const argv = e.argv as readonly string[]
    downloads.push(argv[argv.length - 1]!)
    disk.set(key(argv[argv.length - 2]!), PIKACHU)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.read', ($, e) => {
    const hit = disk.get(key(e.path as string))
    if (!hit) return { deny: 'ENOENT' } as never
    return { value: { base64: hit } } as never
  })
  on('fs.list', () => ({
    value: [...disk.keys()].map(k => ({ name: k.split('/').pop()!, kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  }) as never)
  on('http.fetch', () => ({
    value: { status: 403, ok: false, headers: {}, text: '{"message":"API rate limit exceeded"}' },
  }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage bar</Text>
  })
  return { downloads, disk }
}

test('with no party yet, the band beneath is drawn untouched', async ($, on) => {
  machine(on, { hasCurl: true })
  for (const isWorking of [true, false]) {
    const ui = await $.ui.mount({ plugin: 'pokewait', surface: 'desktop', ...band(isWorking) } as never)
    expect(await ui.find({ text: 'usage bar' })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a prompt downloads a party into the disk cache and draws it above the band beneath', async ($, on) => {
  const clock = mock.clock(on)
  const { downloads, disk } = machine(on, { hasCurl: true })

  await $.prompt.submit({ text: 'hi' } as never)
  await clock.settle()
  expect(downloads.length).toBe(8)
  expect(downloads[0]).toContain('raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/')
  expect(disk.size).toBe(8)

  const ui = await $.ui.mount({ plugin: 'pokewait', surface: 'desktop', ...band(true) } as never)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.split('<image ').length - 1).toBe(8)
  expect(tree.indexOf('"type":"Svg"') < tree.indexOf('usage bar')).toBe(true)
  await ui.unmount()

  const idle = await $.ui.mount({ plugin: 'pokewait', surface: 'desktop', ...band(false) } as never)
  expect(await idle.find({ type: 'Svg' })).toBeUndefined()
  await idle.unmount()

  const term = await $.ui.mount({ plugin: 'pokewait', surface: 'terminal', ...band(true) } as never)
  expect(await term.find({ text: 'usage bar' })).toBeDefined()
  await term.unmount()
})

test('no curl and rate-limited: the party comes from the disk cache', async ($, on) => {
  const clock = mock.clock(on)
  machine(on, { hasCurl: false, cached: ['1.png', '4.png', '7.png', '25.png', '133.png', '152.png', '255.png', '258.png', '387.png'] })

  await $.prompt.submit({ text: 'hi' } as never)
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'pokewait', surface: 'desktop', ...band(true) } as never)
  expect(JSON.stringify(await ui.drawn()).split('<image ').length - 1).toBe(8)
  await ui.unmount()
})
