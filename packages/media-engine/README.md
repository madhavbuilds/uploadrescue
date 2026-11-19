# @uploadrescue/media-engine

Opt-in MP4/MOV/MP3/WAV optimization for UploadRescue with FFmpeg WebAssembly. FFmpeg is loaded lazily from URLs you host — never from a third-party CDN.

```bash
pnpm add @uploadrescue/media-engine
```

## Usage

```bash
pnpm add @uploadrescue/media-engine @ffmpeg/ffmpeg @ffmpeg/core
# copy node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.{js,wasm} to your public folder
```

```ts
import { createMediaEngine, getMediaSupport } from "@uploadrescue/media-engine";

const media = createMediaEngine({
  coreURL: "/ffmpeg/ffmpeg-core.js",
  wasmURL: "/ffmpeg/ffmpeg-core.wasm",
});
```

Documentation: https://github.com/madhavbuilds/uploadrescue/tree/main/docs · Source: https://github.com/madhavbuilds/uploadrescue

License: Apache-2.0
