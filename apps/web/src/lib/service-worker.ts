/**
 * The decision to register n-tutor's service worker (AD-35).
 *
 * Framework-free on purpose, like `idle-expiry.ts`. `apps/web` runs its unit
 * tests in `environment: 'node'` with no jsdom, so logic living inside a
 * component could only be pinned by matching its source text — which passes on
 * code that is structurally right and behaviourally wrong. Here the navigator
 * is passed in, so every row of the story's I/O matrix is drivable from a plain
 * spec with a hand-written stub.
 *
 * The worker this registers caches nothing and handles no request; see
 * `public/sw.js` for why it must stay that way.
 */

/** Where the worker lives, and the scope it claims — the whole app. */
export const SERVICE_WORKER_URL = '/sw.js';
export const SERVICE_WORKER_SCOPE = '/';

/**
 * The sliver of `navigator` this module needs.
 *
 * `serviceWorker` is optional because that is the real shape: a browser without
 * support simply has no such property, and a page served over plain HTTP does
 * not get one either.
 */
export interface ServiceWorkerCapableNavigator {
  serviceWorker?: {
    register(url: string, options?: { scope?: string }): Promise<unknown>;
  };
}

/**
 * Registers the worker, or does nothing at all.
 *
 * Registration is best-effort by design. It buys one thing — the browser's
 * willingness to offer "Install" — and nothing the person is doing depends on
 * it, so a browser without support, a page outside a secure context and an
 * outright rejection all end the same way: silently. Nothing is surfaced,
 * nothing is retried, and nothing is thrown at the caller, because a failed
 * registration must never take a working page down with it.
 */
export function registerServiceWorker(navigatorLike: ServiceWorkerCapableNavigator): void {
  const container = navigatorLike.serviceWorker;
  // Falsy rather than `!== undefined`, and the method checked as well: a
  // browser or a polyfill that leaves `serviceWorker` as `null`, or hands back
  // a container without `register`, would otherwise reach a TypeError that only
  // the catch below saves — and a thrown TypeError is a worse answer than the
  // honest "this browser cannot install the app" that absence already means.
  if (!container || typeof container.register !== 'function') return;

  try {
    // `void` rather than `await`: the caller is a mount effect, and the install
    // must not hold up anything the person is waiting for.
    void container
      .register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE })
      .then(undefined, () => {});
  } catch {
    // A synchronous throw — some browsers refuse this way outside a secure
    // context — is the same non-event as a rejection.
  }
}
