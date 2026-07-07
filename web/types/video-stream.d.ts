import type * as React from 'react'

declare global {
  /**
   * go2rtc `<video-stream>` web component (vendored in `public/players`).
   * Picks the best transport per device: MSE (desktop/Android) or native HLS
   * (iOS), H264 passthrough. See public/players/README.md for provenance.
   */
  interface VideoStreamElement extends HTMLElement {
    /** Transport priority list, comma-separated, e.g. `"mse,hls"`. */
    mode: string
    /** Keep streaming while off-screen/hidden. `false` pauses to save bandwidth. */
    background: boolean
    /** WebSocket URL of go2rtc `/api/ws?src=<name>`. */
    src: string
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'video-stream': React.DetailedHTMLProps<
        React.HTMLAttributes<VideoStreamElement>,
        VideoStreamElement
      >
    }
  }
}
