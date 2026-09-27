/**
 * Where a child's answers actually live while they work (AD-26).
 *
 * The browser holds the work; it does not hold the clock. This module is the
 * whole of the first half — a record keyed to one Attempt and one Student
 * Profile, carrying what has been typed, where the child is in the test, and the
 * one latch that survives a reload.
 *
 * **Storage is injected, never reached for.** `apps/web` runs its unit tests with
 * `environment: 'node'`, and this is the rule that decides whether a child's work
 * survives a refresh — so it is stated as a function of a `Storage`, not of
 * `window`. A caller with no storage at all passes `null` and every function here
 * still answers: the screen degrades to in-memory answers for the page's lifetime
 * and never breaks.
 *
 * **Every accessor is wrapped.** A private-mode `localStorage` throws on read, a
 * blocked-site-data one throws on write, and a full one throws on `setItem`. None
 * of those is a reason a child cannot answer a question, so none of them escapes
 * this file.
 *
 * Nothing here knows what an answer means. There is no grade, no score, no
 * correctness and no verdict in the record or in any function that touches it.
 */

/**
 * 72 hours, measured from the record's creation and **never extended by a save**.
 *
 * The same figure and the same rule as the server-side uncommitted-state TTL
 * (AD-16, `UNCOMMITTED_STATE_TTL_MS`), restated here because this is a different
 * mechanism in a different place rather than the same one read twice: AD-26 is
 * explicitly the one uncommitted mechanism that is not parent-gated, and its
 * store is the browser's. The rule is what matters and it is identical — an
 * actively re-saved record must not become an indefinite store of a child's
 * schoolwork that no clock reaches, which is exactly what a TTL extended by a
 * save would produce.
 */
export const ATTEMPT_STATE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * The key prefix every record shares.
 *
 * Namespaced, because the origin is shared with anything else this app ever
 * stores: `retainOnly` and `clearAll` sweep by this prefix, and a sweep that
 * reached beyond it would delete somebody else's key.
 */
export const ATTEMPT_KEY_PREFIX = 'ntr.attempt.';

/**
 * The slice of `Storage` this module uses, and no more.
 *
 * `length` and `key` are here because the sweeps enumerate: clearing a sibling's
 * abandoned work means finding keys nobody handed us.
 */
export interface AttemptStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What one Attempt's record holds. Answers, a place, and a latch. */
export interface AttemptState {
  /**
   * When this record was first written, on the browser's clock. The TTL is
   * measured from here and a later save never moves it.
   */
  createdAt: number;
  /**
   * Which child's record this is. Kept **in** the record as well as in the key,
   * so a record read under the wrong profile is recognised as wrong even if a key
   * were ever rebuilt by hand.
   */
  profileId: string;
  attemptId: string;
  /**
   * What the child has answered, by Question id. A Question nobody has touched is
   * absent, never `''` — the same rule the screen's own state holds to, because
   * "never answered" and "answered then cleared" are one state to a child.
   */
  answers: Record<string, string>;
  /** Which Question is on screen, as an index into the stored order. */
  index: number;
  /**
   * The instant the deadline passed with no connection, or null.
   *
   * This is the latch: it is armed when the time runs out offline and **emptied by
   * the act of reading it** (`takePending`), so two `online` events, a reload
   * between them, or a re-render all produce at most one dispatch.
   */
  pendingSubmitAt: number | null;
}

/** What a caller states when it saves. Everything else the record holds is ours. */
export interface AttemptStateInput {
  answers: Record<string, string>;
  index: number;
  pendingSubmitAt: number | null;
}

/**
 * One record's key.
 *
 * Both ids are UUIDs from the server, which is what actually keeps either id from
 * forging the `.` separator — `encodeURIComponent` leaves `.` unescaped, so it is
 * the id format doing the work here, not the encoding.
 */
export function attemptKey(profileId: string, attemptId: string): string {
  return `${ATTEMPT_KEY_PREFIX}${encodeURIComponent(profileId)}.${encodeURIComponent(attemptId)}`;
}

/** The key prefix every record of one profile shares. */
function profilePrefix(profileId: string): string {
  return `${ATTEMPT_KEY_PREFIX}${encodeURIComponent(profileId)}.`;
}

/**
 * Reads one item, answering `null` for anything that is not a readable string.
 *
 * A throwing `getItem` — private mode, blocked site data — is a record that is
 * not there, which is a state the screen already renders.
 */
function getItem(storage: AttemptStorage | null, key: string): string | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(key);
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/** Removes one item, and never throws. A removal that failed is not an error. */
function removeItem(storage: AttemptStorage | null, key: string): void {
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do and nothing to say: the caller asked for the record to be
    // gone, and a storage that refuses to remove it will refuse to read it too.
  }
}

/**
 * Every key this module owns, collected **before** anything is removed.
 *
 * Enumerating and deleting in one pass shifts the indices underneath the loop and
 * silently leaves half the keys behind — which, for a profile switch, is half a
 * sibling's work still on the device.
 */
function ownedKeys(storage: AttemptStorage | null): string[] {
  if (storage === null) return [];
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && key.startsWith(ATTEMPT_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    return keys;
  }
  return keys;
}

/** Whether a parsed value is a record this module wrote. Shape only. */
function isAttemptState(value: unknown): value is AttemptState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return false;
  if (typeof record.profileId !== 'string' || typeof record.attemptId !== 'string') return false;
  // A whole number, and not a negative one: `index` is a position in an array, and a
  // `-1` or a `2.5` is not a Question the screen can be on. The caller clamps against
  // the *upper* end, which depends on a test this module has never seen; the shape is
  // this function's to settle.
  if (!Number.isInteger(record.index) || (record.index as number) < 0) return false;
  // A finite instant or nothing at all. `NaN` matters here more than anywhere else in
  // the record: it is neither `null` nor a usable time, so it reads as an **armed**
  // latch and dispatches an auto-submit on the next reconnect that no deadline ever
  // asked for.
  if (
    record.pendingSubmitAt !== null &&
    (typeof record.pendingSubmitAt !== 'number' || !Number.isFinite(record.pendingSubmitAt))
  ) {
    return false;
  }
  if (typeof record.answers !== 'object' || record.answers === null) return false;
  return Object.values(record.answers as Record<string, unknown>).every(
    (answer) => typeof answer === 'string',
  );
}

/**
 * One Attempt's record, or `null`.
 *
 * `null` means every way there is of not having one, because to the screen they
 * are the same state: nothing stored, a storage that throws, a storage that is not
 * there at all, a record that does not parse, one written under another profile,
 * or one past its TTL. The last four are **deleted on the way out** — a record
 * this function will never return again is a record that has no business sitting
 * on a child's device.
 */
export function readAttemptState(
  storage: AttemptStorage | null,
  profileId: string,
  attemptId: string,
  now: number = Date.now(),
): AttemptState | null {
  const key = attemptKey(profileId, attemptId);
  const raw = getItem(storage, key);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeItem(storage, key);
    return null;
  }

  if (!isAttemptState(parsed)) {
    removeItem(storage, key);
    return null;
  }
  // Wrong profile, right key: not a state that should be reachable, and exactly
  // the one where being wrong means one child reading another's work.
  if (parsed.profileId !== profileId || parsed.attemptId !== attemptId) {
    removeItem(storage, key);
    return null;
  }
  if (now - parsed.createdAt >= ATTEMPT_STATE_TTL_MS) {
    removeItem(storage, key);
    return null;
  }
  return parsed;
}

/**
 * Saves one Attempt's record and answers what is now stored, or `null` if nothing
 * could be.
 *
 * `createdAt` is carried over from the record already there and is **not** moved:
 * the TTL is measured from creation, and a save that reset it would turn an
 * actively used record into one no clock reaches. A record past its TTL is already
 * gone by the time this reads it, so the replacement starts a fresh 72 hours —
 * which is a new record rather than an extended one.
 *
 * The returned value is what a caller should hold: a storage that threw on write
 * still gets a complete record back, so the screen keeps the child's answers in
 * memory for the page's lifetime instead of losing the keystroke.
 */
export function writeAttemptState(
  storage: AttemptStorage | null,
  profileId: string,
  attemptId: string,
  input: AttemptStateInput,
  now: number = Date.now(),
): AttemptState {
  const existing = readAttemptState(storage, profileId, attemptId, now);
  const state: AttemptState = {
    createdAt: existing?.createdAt ?? now,
    profileId,
    attemptId,
    answers: input.answers,
    index: input.index,
    pendingSubmitAt: input.pendingSubmitAt,
  };
  if (storage !== null) {
    try {
      storage.setItem(attemptKey(profileId, attemptId), JSON.stringify(state));
    } catch {
      // A quota-full or blocked storage is not a reason to drop a keystroke. The
      // record is returned all the same and the page holds it in memory.
    }
  }
  return state;
}

/**
 * Removes one Attempt's record.
 *
 * Called on a successful submission: work that has been handed in is not work the
 * device has any reason to keep.
 */
export function clearAttemptState(
  storage: AttemptStorage | null,
  profileId: string,
  attemptId: string,
): void {
  removeItem(storage, attemptKey(profileId, attemptId));
}

/**
 * Keeps this profile's records and drops every other.
 *
 * The mode-gate sweep AD-26 asks for: the device is now this child's, so no trace
 * of a sibling's work remains under any key. It is called where the binding is
 * established and where every child passes through, because those are the two
 * moments at which "whose device is this" changes.
 *
 * **Decided from the key, never from the payload.** A record that does not parse
 * is exactly the record a payload-based sweep would leave behind, and "the other
 * child's work is gone" must not be conditional on their record being readable.
 */
export function retainOnly(storage: AttemptStorage | null, profileId: string): void {
  const keep = profilePrefix(profileId);
  for (const key of ownedKeys(storage)) {
    if (key.startsWith(keep)) continue;
    removeItem(storage, key);
  }
}

/**
 * Drops every record this module owns.
 *
 * For the crossings where no profile is the right one to retain: sign-in, and
 * leaving Student Mode for the parent surface.
 */
export function clearAll(storage: AttemptStorage | null): void {
  for (const key of ownedKeys(storage)) removeItem(storage, key);
}

/**
 * This browser's `localStorage`, or `null` where there is not one.
 *
 * The single place `window` is named, so every rule above stays a function of a
 * `Storage` and remains testable with no DOM. Merely *touching* the property
 * throws in some blocked-site-data configurations, which is why even the lookup is
 * wrapped.
 */
export function browserAttemptStorage(): AttemptStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/**
 * A `Storage` backed by a `Map`, with the same interface and none of the
 * persistence.
 *
 * This is what "degrades to in-memory answers for the page's lifetime" *is*. A
 * private-mode or blocked `localStorage` leaves the screen with one of these, so
 * every rule above — the TTL, the profile keying, the sweep, the latch — keeps
 * working against one implementation rather than the screen growing a second,
 * storage-less path that no test ever runs.
 */
export function memoryAttemptStorage(): AttemptStorage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

/**
 * The fallback for this page load, created once.
 *
 * Once, because two of them would be two different sets of answers: the screen
 * reads the store on mount and writes it on every change, and a fresh `Map` per
 * render would lose the child's work on the next keystroke.
 */
let fallback: AttemptStorage | null = null;

/**
 * The storage every screen should use: this browser's, or an in-memory stand-in.
 *
 * A caller never has to decide what to do without storage, because it always has
 * some. What it loses in private mode is persistence across a reload, which is the
 * one thing nothing can give it back.
 */
export function attemptStorage(): AttemptStorage {
  const browser = browserAttemptStorage();
  if (browser !== null) return browser;
  fallback ??= memoryAttemptStorage();
  return fallback;
}
