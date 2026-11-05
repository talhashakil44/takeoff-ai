/**
 * The sample projects for the web app, served from the app's own address. The files live in the
 * GitHub "samples" release (drawings, spec, takeoff and 3D model each); GitHub's download links
 * don't allow a page on another site to fetch them, so this passes them through.
 */
const RELEASE = 'https://github.com/talhashakil44/takeoff-ai/releases/download/samples/';

export async function sample(file: string, get: typeof fetch = fetch): Promise<Response> {
  if (!/^[\w-]+\.takeoff$/.test(file)) return new Response('Not found', { status: 404 });
  const r = await get(RELEASE + file, { redirect: 'follow' });
  if (!r.ok || !r.body) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
  const len = r.headers.get('content-length');
  if (len) headers.set('content-length', len);
  return new Response(r.body, { headers });
}
