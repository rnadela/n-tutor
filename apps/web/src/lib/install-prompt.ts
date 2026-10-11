/**
 * The deferred `beforeinstallprompt` event, held where React cannot lose it.
 *
 * The event fires **once** per page load, at a moment no screen-level component
 * can claim to own: it arrives as soon as the browser decides the app is
 * installable, which may be before the first screen has mounted and is never
 * tied to a particular route. It is also the only way to a one-tap install, so
 * missing it would silently downgrade every Chromium family to no banner at
 * all. So it is captured at the root layout into this module-level store, and
 * the banner subscribes.
 *
 * Framework-free for `service-worker.ts`'s reason: the window arrives as an
 * argument, so the whole store is drivable from a plain node spec.
 */

/** The part of the event this module uses. The platforms disagree on the rest. */
export interface InstallPromptEventLike {
  preventDefault(): void;
  /** Resolves once the person has answered the browser's own install dialog. */
  prompt(): Promise<{ outcome?: string } | void>;
}

/**
 * The sliver of `window` the capture needs.
 *
 * The listener takes `unknown` rather than the event type above: `window`'s own
 * `addEventListener` hands over an `Event`, and a narrower parameter here would
 * make the real `window` unassignable to this interface. What actually arrives
 * is checked at the top of the listener instead.
 */
export interface InstallPromptWindow {
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** The event the browser fires when the app becomes installable. */
export const BEFORE_INSTALL_PROMPT = 'beforeinstallprompt';
/** The event it fires once the app has been installed, however that happened. */
export const APP_INSTALLED = 'appinstalled';

/** The one held event, or `null` when the browser has not offered one. */
let deferred: InstallPromptEventLike | null = null;

const listeners = new Set<() => void>();

/**
 * The windows already listened to.
 *
 * React Strict Mode runs mount effects twice in development, so the capture
 * component calls this twice with the same window — and unlike a service-worker
 * registration, a second `addEventListener` is not a no-op: it would hold the
 * event twice and notify twice. A `WeakSet` because the key is the window
 * itself and nothing here should keep one alive.
 */
const captured = new WeakSet<InstallPromptWindow>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Whether what arrived is usable as a deferred install prompt. */
function isInstallPromptEvent(event: unknown): event is InstallPromptEventLike {
  if (typeof event !== 'object' || event === null) return false;
  const candidate = event as Partial<InstallPromptEventLike>;
  return typeof candidate.preventDefault === 'function' && typeof candidate.prompt === 'function';
}

/**
 * Starts listening for the browser's install offer, once per window.
 *
 * `preventDefault()` on the event is what keeps the browser's own mini-infobar
 * from competing with the banner — two offers to install the same app, one of
 * which the product cannot place, style or dismiss.
 *
 * `appinstalled` drops the held event, which is what makes "once accepted it
 * does not come back" true even when the person installs from the browser's own
 * menu rather than from the banner.
 */
export function captureInstallPrompt(windowLike: InstallPromptWindow): void {
  if (typeof windowLike.addEventListener !== 'function') return;
  if (captured.has(windowLike)) return;
  captured.add(windowLike);

  windowLike.addEventListener(BEFORE_INSTALL_PROMPT, (event) => {
    if (!isInstallPromptEvent(event)) return;
    try {
      event.preventDefault();
    } catch {
      // A platform that refuses to be prevented still gives us the event; the
      // worst case is its own infobar beside the banner, not a thrown listener.
    }
    deferred = event;
    notify();
  });

  windowLike.addEventListener(APP_INSTALLED, () => {
    deferred = null;
    notify();
  });
}

/** The held event, for a caller that only needs to know whether there is one. */
export function deferredInstallPrompt(): InstallPromptEventLike | null {
  return deferred;
}

/** Subscribes to changes in the held event. Returns the unsubscribe. */
export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Shows the browser's install dialog, and says whether the app was installed.
 *
 * A refusal, a rejection and an outright throw all end the same way: `false`,
 * nothing surfaced, and the event still held — so the action stays usable and a
 * parent who cancelled by accident can tap it again. Only an accepted install
 * drops the event, which is what takes the banner away for good.
 */
export async function promptToInstall(): Promise<boolean> {
  const event = deferred;
  if (event === null) return false;

  try {
    const choice = await event.prompt();
    const accepted = typeof choice === 'object' && choice !== null && choice.outcome === 'accepted';
    if (!accepted) return false;
  } catch {
    // Some platforms reject a second `prompt()` on the same event. That is a
    // non-event: the banner stays, and nothing is said.
    return false;
  }

  deferred = null;
  notify();
  return true;
}
