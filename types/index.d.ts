export type Walker = {
  id: number
  /** The sprite's PNG, base64. */
  png: string
  /** The PNG's own size in pixels. */
  width: number
  height: number
  /** Where its visible pixels lie: x, y, width, height. */
  box: [number, number, number, number]
  seconds: number
  offset: number
}
export type Team = Walker[]

declare module 'claude-code' {
  interface PluginState {
    pokewait: { team: Team }
  }
}
