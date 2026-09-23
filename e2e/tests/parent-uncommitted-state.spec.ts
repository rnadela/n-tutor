import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createGradeLevelFixture, uniqueParentEmail } from '../fixtures';

const PASSWORD = 'correct-horse-battery-staple';
const PIN = '4821';

/** Where the API answers, as `playwright.config.ts` states it. */
const API_BASE = `http://localhost:${process.env.API_PORT ?? '3001'}/api`;

/**
 * The idle window, read from the same expression `playwright.config.ts` reads.
 * Only the *browser's* clock is ever moved here; the server's runs at real
 * speed, which is the case this story is about — a parent whose Parent View
 * ended while the work they had half-typed was perfectly alive server-side.
 */
const WINDOW_MS = Number(process.env.ELEVATION_TTL_SECONDS ?? '900') * 1000;

/** Comfortably more than one window, and comfortably less than two. */
const PAST_THE_WINDOW = Math.ceil(WINDOW_MS * 1.1);

/**
 * A string nothing but this test would ever write. It is what the storage
 * assertion looks for: if any trace of the payload had been kept client-side,
 * this is the needle that would be in it.
 */
const MARKER = 'uncommitted-marker-9f2c41';

const DRAFT = { note: MARKER, at: 3 };

// The helpers below are `parent-idle-expiry.spec.ts`'s, verbatim: this suite
// drives the same real expiry, and the two must not drift into asserting
// against different journeys.

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/auth/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByLabel('I accept the terms of use.').check();
  await page.getByLabel('I accept the notice on children’s data.').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
}

async function chooseGradeLevel(page: Page, selectId: string, name: string): Promise<void> {
  await page.locator(`[role="combobox"]#${selectId}`).click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * A signed-up parent, a PIN, one child, and a device handed over to them. Done
 * before the browser's clock is replaced: a faked clock stalls the MUI
 * transitions this setup clicks through, and none of it is what is under test.
 */
async function handOverTheDevice(page: Page, child: string): Promise<{ gradeLevelId: string }> {
  const grade = await createGradeLevelFixture('Grade');
  await signUp(page, uniqueParentEmail('uncommitted'));
  await page.getByRole('link', { name: 'Enter Parent View' }).click();
  await expect(page.getByRole('heading', { name: 'Set a PIN for Parent View' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Save the PIN' }).click();
  await expect(parentViewHeading(page)).toBeVisible();

  await page.getByRole('link', { name: 'Student Profiles' }).click();
  await expect(page.getByRole('heading', { name: 'Student Profiles', level: 1 })).toBeVisible();
  await page.locator('#student-name').fill(child);
  await chooseGradeLevel(page, 'student-grade-level', grade.name);
  await page.getByRole('button', { name: 'Add the profile' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText(child);

  // One child is no choice at all: the exit binds the device and goes.
  await page.getByRole('button', { name: 'Back to Student Mode' }).click();
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
  return { gradeLevelId: grade.id };
}

function parentViewHeading(page: Page) {
  return page.getByRole('heading', { name: 'Parent View', level: 1, exact: true });
}

async function enterParentView(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
  await page.locator('#parent-pin').fill(PIN);
  await page.getByRole('button', { name: 'Enter Parent View' }).click();
  await expect(parentViewHeading(page)).toBeVisible();
}

/** Installs the browser's own clock, opens Student Mode on it, crosses the PIN. */
async function enterParentViewOnAFakeClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.goto('/student');
  await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Parent' }).click();
  await enterParentView(page);
}

/**
 * Crosses the PIN over HTTP for a bearer of the test's own.
 *
 * `page.request` shares the browser context's cookies, so the session cookie
 * the browser holds authorises this exactly as it authorises the app's own
 * call. The bearer never touches the page: the test drives the mechanism
 * through the real API while the browser drives the real expiry.
 */
async function bearerFor(api: APIRequestContext): Promise<string> {
  const response = await api.post(`${API_BASE}/parent/pin/verify`, { data: { pin: PIN } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

function elevated(token: string): { headers: Record<string, string> } {
  return { headers: { authorization: `Bearer ${token}` } };
}

/** The bound child's id, read through the same route the app reads it through. */
async function onlyProfileId(api: APIRequestContext, token: string): Promise<string> {
  const response = await api.get(`${API_BASE}/parent/students/selectable`, elevated(token));
  expect(response.status()).toBe(200);
  const profiles = (await response.json()) as Array<{ id: string }>;
  expect(profiles.length).toBeGreaterThan(0);
  return profiles[0]!.id;
}

/**
 * Everything this origin has persisted, as text: both `Storage` objects, the
 * readable cookies, and every IndexedDB database with the contents of its
 * object stores.
 *
 * IndexedDB is named explicitly because the prohibition names it: a draft
 * tucked into a database rather than a key would be invisible to a check that
 * only dumped `localStorage`, which is exactly the hiding place worth ruling
 * out.
 */
async function clientStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const dump = (store: Storage): string => {
      const entries: string[] = [];
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key === null) continue;
        entries.push(`${key}=${store.getItem(key) ?? ''}`);
      }
      return entries.join('\n');
    };

    const openDatabase = (name: string): Promise<IDBDatabase | null> =>
      new Promise((resolve) => {
        const pending = indexedDB.open(name);
        pending.onsuccess = () => resolve(pending.result);
        pending.onerror = () => resolve(null);
        pending.onblocked = () => resolve(null);
      });

    const readStore = (db: IDBDatabase, store: string): Promise<string> =>
      new Promise((resolve) => {
        try {
          const pending = db.transaction(store, 'readonly').objectStore(store).getAll();
          pending.onsuccess = () => resolve(JSON.stringify(pending.result));
          pending.onerror = () => resolve('');
        } catch {
          resolve('');
        }
      });

    const databases: string[] = [];
    // `databases()` is the only way to enumerate them; where it is missing, the
    // list below is empty and the assertion rests on the other three surfaces.
    const listed = (await indexedDB.databases?.()) ?? [];
    for (const { name } of listed) {
      if (name === undefined) continue;
      databases.push(`db:${name}`);
      const db = await openDatabase(name);
      if (db === null) continue;
      for (const store of Array.from(db.objectStoreNames)) {
        databases.push(`${name}.${store}=${await readStore(db, store)}`);
      }
      db.close();
    }

    return [
      dump(window.localStorage),
      dump(window.sessionStorage),
      document.cookie,
      databases.join('\n'),
    ].join('\n');
  });
}

test.describe('Uncommitted parent input across an expired Parent View', () => {
  test('survives the expiry server-side, leaving no trace on the device', async ({ page }) => {
    await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);

    const api = page.request;
    const token = await bearerFor(api);
    const studentProfileId = await onlyProfileId(api, token);

    const saved = await api.put(`${API_BASE}/parent/uncommitted`, {
      ...elevated(token),
      data: { studentProfileId, kind: 'DraftEdit', payload: DRAFT },
    });
    expect(saved.status()).toBe(200);
    const slot = (await saved.json()) as { id: string; createdAt: string; expiresAt: string };

    // Nothing is touched: no pointer, no key, no scroll. The window lapses and
    // the device goes back to the child it was already bound to.
    await page.clock.fastForward(PAST_THE_WINDOW);
    await expect(page.getByRole('heading', { name: 'Your practice', level: 1 })).toBeVisible();
    await expect(page.getByText('Hello, Noah.')).toBeVisible();

    // The draft is server-side only: no storage on this device holds a trace of
    // it, and the device is now a child's.
    const storage = await clientStorage(page);
    expect(storage).not.toContain(MARKER);
    expect(storage).not.toContain(token);

    // And the session cookie alone — which this device still has — reaches none
    // of it. The elevation bearer is the only credential these routes accept.
    const unelevated = await api.get(
      `${API_BASE}/parent/uncommitted?studentProfileId=${studentProfileId}`,
    );
    expect(unelevated.status()).toBe(401);
    expect((await unelevated.json()) as { elevated: boolean }).toMatchObject({ elevated: false });

    // The browser's clock was run ahead of the server's; they go back in step
    // before the PIN gate, whose figures are the server's.
    await page.clock.setSystemTime(new Date());
    await page.clock.resume();

    await page.getByRole('link', { name: 'Parent' }).click();
    await enterParentView(page);

    // A fresh PIN crossing, and the payload comes back exactly as saved — on
    // the window the first save set, not one measured from the re-entry.
    const reElevated = await bearerFor(api);
    expect(reElevated).not.toBe(token);
    const restored = await api.get(
      `${API_BASE}/parent/uncommitted?studentProfileId=${studentProfileId}`,
      elevated(reElevated),
    );
    expect(restored.status()).toBe(200);
    const rows = (await restored.json()) as Array<{
      id: string;
      payload: unknown;
      createdAt: string;
      expiresAt: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual(DRAFT);
    expect(rows[0]!.id).toBe(slot.id);
    expect(rows[0]!.createdAt).toBe(slot.createdAt);
    expect(rows[0]!.expiresAt).toBe(slot.expiresAt);
  });

  test('is keyed to the child it was saved under', async ({ page }) => {
    const { gradeLevelId } = await handOverTheDevice(page, 'Noah');
    await enterParentViewOnAFakeClock(page);

    const api = page.request;
    const token = await bearerFor(api);
    const profileA = await onlyProfileId(api, token);

    // A sibling, created through the same route the Students screen uses.
    const created = await api.post(`${API_BASE}/parent/students`, {
      ...elevated(token),
      data: { displayName: 'Ada', gradeLevelId },
    });
    expect(created.status()).toBe(201);
    const profileB = ((await created.json()) as { id: string }).id;

    const saved = await api.put(`${API_BASE}/parent/uncommitted`, {
      ...elevated(token),
      data: { studentProfileId: profileA, kind: 'DraftEdit', payload: DRAFT },
    });
    // Asserted, so that a rejected save cannot make every check below trivially
    // true by leaving nothing saved at all.
    expect(saved.status()).toBe(200);
    const slotId = ((await saved.json()) as { id: string }).id;

    // Naming the sibling returns nothing of the first child's work.
    const sibling = await api.get(
      `${API_BASE}/parent/uncommitted?studentProfileId=${profileB}`,
      elevated(token),
    );
    expect(sibling.status()).toBe(200);
    expect(await sibling.json()).toEqual([]);

    // And reading the row itself into the sibling is refused, not rebound: the
    // device may be in the other child's hands by now, which is the whole
    // reason the row is keyed to a profile at all.
    const crossed = await api.get(
      `${API_BASE}/parent/uncommitted/${slotId}?studentProfileId=${profileB}`,
      elevated(token),
    );
    expect(crossed.status()).toBe(404);

    // Named with the profile it was saved under, the same row comes back.
    const own = await api.get(
      `${API_BASE}/parent/uncommitted/${slotId}?studentProfileId=${profileA}`,
      elevated(token),
    );
    expect(own.status()).toBe(200);
    expect(((await own.json()) as { payload: unknown }).payload).toEqual(DRAFT);

    // A profile that is not this account's is a 404, never a 403, which would
    // confirm the row exists.
    const stranger = await api.get(
      `${API_BASE}/parent/uncommitted?studentProfileId=00000000-0000-4000-8000-000000000000`,
      elevated(token),
    );
    expect(stranger.status()).toBe(404);
  });
});
