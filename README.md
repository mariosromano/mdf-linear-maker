# M|R Walls — MDF Linear Maker

Design tool for CNC-carved linear-texture wall panels — parallel lines,
crosshatch, chevron, waves, and fan patterns with per-line depth
variation. Part of the [MakeReal](https://makereal-mrwalls.vercel.app)
platform. Forked from the Voronoi Maker; shares its architecture and the
M|R Walls design system.

React + Vite + TypeScript + Three.js.

## Features

- Five linear pattern families (Parallel, Crosshatch, Chevron, Waves, Fan)
  with spacing, angle, wave shape, and jitter controls
- **Per-line depth variation** — Uniform, Alternating, Gradient, or Random,
  scaled against the max carve depth; reads beautifully under raking light
- Real-time 3D preview with exact groove profiles per CNC bit
  (ball-end / flat-end, 1/4" / 1/2", three max depths)
- Automatic panel tiling (4×4 / 4×2 / 2×4 / 2×2 ft) with seam lines and price estimate
- **Exports**: PNG snapshot · DXF cut file (inches, **one layer per carve
  depth** for CAM) · watertight binary STL solid
- **AI Render** via fal.ai — server-side key (`FAL_API_KEY` env var),
  `/api/render` proxy with per-IP rate limiting. No key ships to the browser.
- **MakeReal contract v1**: `?settings=` prefill, `makereal:design` /
  `makereal:render` postMessages, `?embedded=1` hides pricing,
  `?theme=makereal` ivory/terracotta house theme

## Develop

```
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

`/api/*` routes are Vercel serverless functions — they don't run under
`vite dev`. The AI Render modal falls back to asking for a personal FAL
key locally; on the deployed site it uses the server key.

## Deploy

Push to `main` → Vercel deploys. Required env vars in Vercel:

- `FAL_API_KEY` — server-side render key (required for AI Render)
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — optional, enables rate limiting
