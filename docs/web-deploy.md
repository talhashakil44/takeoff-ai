# Web app

The web version runs on Cloudflare Pages at takeoff.talkswithtalha.com, built from `main` on
every push:

- Framework: Vite. Build command: `npx vite build`. Output folder: `dist`. Node 22.
- Environment variable: `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.

## AI

There is no server-side AI and no shared key. Each user adds their own Claude or ChatGPT API
key in AI settings; it is kept only in their own browser (localStorage) and sent straight to
the provider. Another person on another computer has no key until they add their own.

The automatic takeoffs (rooms, walls, doors, windows, symbols, finishes and the rest under
Automate) read the drawings in the browser and use no AI at all.

The old access-code service (removed, along with `npm run build:web`) is no longer deployed:
its `/api/ai` route was removed. Don't set `AI_API_KEY` or `ACCESS_CODES` on the Pages project.

## Sample projects

`/samples/<file>.takeoff` (`functions/samples/[file].ts`, logic in `worker/samples.ts`) passes
the sample files through from the GitHub "samples" release, so the web app can open the full
samples (drawings, spec, takeoff, 3D model). GitHub's own download links can't be fetched from
another site.
