import { describe, expect, it } from 'vitest';
import { sample } from '../worker/samples';

describe('sample project pass-through', () => {
  it('only serves .takeoff files by plain name', async () => {
    const never = (() => { throw new Error('should not fetch'); }) as unknown as typeof fetch;
    expect((await sample('../secrets', never)).status).toBe(404);
    expect((await sample('a/b.takeoff', never)).status).toBe(404);
    expect((await sample('notes.txt', never)).status).toBe(404);
  });
  it('passes the release file through, or 404 when it is not there', async () => {
    let asked = '';
    const ok = (async (u: string) => { asked = u; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } }); }) as unknown as typeof fetch;
    const r = await sample('sample-1-ski-lodge.takeoff', ok);
    expect(asked).toBe('https://github.com/talhashakil44/takeoff-ai/releases/download/samples/sample-1-ski-lodge.takeoff');
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const missing = (async () => new Response('x', { status: 404 })) as unknown as typeof fetch;
    expect((await sample('sample-3-waterfront-restaurant.takeoff', missing)).status).toBe(404);
  });
});
