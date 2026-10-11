import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

const workerSource = readFileSync(path.resolve(import.meta.dirname, '../../public/sw.js'), 'utf8');

/** The worker's code with its comment block removed — the block says `fetch`. */
const workerCode = workerSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

async function swHeaders(): Promise<Record<string, string>> {
  const groups = (await nextConfig.headers?.()) ?? [];
  const group = groups.find((entry) => entry.source === '/sw.js');
  expect(group, 'next.config.ts must state headers for /sw.js').toBeDefined();
  return Object.fromEntries(group!.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

describe('how /sw.js is delivered', () => {
  it('is served uncacheable, so a replacement worker can always be seen', async () => {
    // A cached worker is a worker that can never be updated — including never
    // being able to retire itself if a later story removes it.
    expect((await swHeaders())['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it('is served as JavaScript, which registration requires', async () => {
    expect((await swHeaders())['content-type']).toBe('application/javascript');
  });
});

describe('what the worker does', () => {
  it('takes over on the next load', () => {
    expect(workerCode).toContain('skipWaiting');
    expect(workerCode).toContain('clients.claim');
  });

  it('never handles a request, however the handler is spelt (AD-35)', () => {
    // Asserted on the source rather than left to review: a `fetch` handler
    // added here would put a cache in front of child data and stale JS in
    // front of the API, which is the one thing this worker exists not to do.
    //
    // All three spellings, because a denylist that only knew the quoted form
    // would wave through `addEventListener(`fetch`, …)` and `self.onfetch =`,
    // which do exactly the same thing.
    expect(workerCode).not.toMatch(/['"`]fetch['"`]/u);
    expect(workerCode).not.toMatch(/\bonfetch\b/u);
  });

  it('never opens a store of any kind (AD-35)', () => {
    // A cache is the named risk, but any of these would be the same mistake
    // wearing a different API: a second client-persistence mechanism beside
    // the sanctioned in-progress Attempt state, holding child data past the
    // session that produced it.
    for (const forbidden of [
      /\bcaches\b/u,
      /\bCacheStorage\b/u,
      /\bindexedDB\b/iu,
      /\blocalStorage\b/u,
      /\bsessionStorage\b/u,
    ]) {
      expect(workerCode).not.toMatch(forbidden);
    }
  });

  it('never notifies, and never pulls in code of its own (AD-35)', () => {
    // Push is explicitly out of scope for the whole epic. `importScripts` is
    // here because it is the one line that would let every rule above be
    // broken somewhere this spec cannot read.
    for (const forbidden of [
      /\bpushManager\b/u,
      /['"`]push['"`]/u,
      /\bshowNotification\b/u,
      /\bimportScripts\b/u,
    ]) {
      expect(workerCode).not.toMatch(forbidden);
    }
  });
});
