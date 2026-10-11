/*
 * n-tutor's service worker. It exists so that browsers consider the app
 * installable, and for nothing else (AD-35).
 *
 * THIS FILE MUST NEVER GAIN A `fetch` HANDLER, A CACHE, OR A PUSH SUBSCRIPTION.
 *
 * Why, concretely:
 *  - A cache in front of requests would hold Parent View and child data in a
 *    store that outlives the session, and could hand it back after a Parent
 *    View expiry — the one thing the idle clock exists to prevent.
 *  - It would serve stale JS after a deploy, so a family could be running one
 *    version of the app against another version of the API.
 *  - It would be a second client-persistence mechanism beside the sanctioned
 *    in-progress Attempt state, with no story saying which one wins.
 *
 * Offline behaviour is therefore unchanged by installing: FR-36 remains the
 * only offline carve-out, and an installed app with no network behaves exactly
 * as the browser tab does, because nothing here is cached.
 *
 * `skipWaiting` + `clients.claim` so a replacement worker takes over on the
 * next load instead of waiting for every tab to close. With no fetch handler
 * there is nothing in flight for the handover to disturb.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
