export {}

declare global {
  /**
   * go2rtc `<video-stream>` web component (vendored in `public/players`).
   * Created imperatively (document.createElement) — set mode/background/
   * visibilityThreshold BEFORE appending to the DOM: the player reads them in
   * oninit(), which runs once on the first connectedCallback.
   */
  interface VideoStreamElement extends HTMLElement {
    /** Transport priority list, comma-separated, e.g. `"mse,hls"`. */
    mode: string
    /** Keep streaming while off-screen/hidden. `false` pauses to save bandwidth. */
    background: boolean
    /** 0..1 — stream only while at least this fraction of the tile is visible.
     *  0 disables the IntersectionObserver (default). */
    visibilityThreshold: number
    /** WebSocket URL of go2rtc `/api/ws?src=<name>`. */
    src: string
  }
}
