import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { parentTheme } from '@/theme/theme';
import { parentCopy } from '@/copy/parent';
import { ParentApiError } from '@/lib/parent-api';
import { endsParentView } from '@/lib/parent-view';
import { DataAndDeletionNote, deleteAccountNoteId, refusalText } from './page';

/** The screen's own source, for the rules that are about what it does, not what
 * it renders — the node environment cannot mount it. */
const CODE = readFileSync(path.resolve(import.meta.dirname, 'page.tsx'), 'utf8');

describe('what the Data & deletion section says before the parent confirms', () => {
  function render(): string {
    return renderToStaticMarkup(
      <ThemeProvider theme={parentTheme}>
        <DataAndDeletionNote />
      </ThemeProvider>,
    ).replace(/<style[\s\S]*?<\/style>/gu, '');
  }

  it('renders the note as text a parent can actually read', () => {
    // Not a `title`: a tooltip does not exist on touch at all, and the control
    // carries an `aria-describedby` pointing at this id.
    const markup = render();
    expect(markup).toContain(parentCopy.settings.deleteAccountNote);
    expect(markup).toContain(`id="${deleteAccountNoteId}"`);
  });

  it('says what deletion costs: every profile, the photographs, and the sign-out', () => {
    const markup = render();
    expect(markup).toMatch(/every profile/i);
    expect(markup).toMatch(/photographs/i);
    expect(markup).toMatch(/Nothing can be recovered/i);
    expect(markup).toMatch(/signed out/i);
  });

  it('names the section and the control in the copy file, not in the component', () => {
    expect(parentCopy.settings.dataAndDeletion).toBe('Data & deletion');
    expect(parentCopy.settings.deleteAccount).toMatch(/delete/i);
  });

  it('says why the control is disabled while either read is in flight', () => {
    // A disabled button with nothing beside it reads as a broken screen, and a
    // screen reader is told nothing at all.
    expect(CODE).toContain('role="status"');
    expect(CODE).toContain('parentCopy.settings.loading');
    expect(CODE).toContain('parentCopy.settings.preparing');
  });
});

describe('how the Settings screen is reached', () => {
  it('is linked from Parent View, client-side like its neighbours', () => {
    const PARENT = readFileSync(path.resolve(import.meta.dirname, '..', 'page.tsx'), 'utf8');
    // A screen a parent cannot reach is a screen that did not ship — and this is
    // the only way in to the account deletion.
    expect(PARENT).toContain('href="/parent/settings"');
    expect(PARENT).toContain('parentCopy.parentView.settings');
    expect(parentCopy.parentView.settings.length).toBeGreaterThan(0);
  });
});

describe('the confirmation’s counts', () => {
  it('reads the preview when Delete is pressed, not once on mount', () => {
    // FR-33 requires the sentence the parent confirms against to name what will
    // be destroyed. A figure read when the screen mounted is a figure that may
    // have moved since — a child added or an upload committed in another tab.
    const requested = CODE.slice(CODE.indexOf('async function onDeleteRequested'));
    const body = requested.slice(0, requested.indexOf('async function onDeleteConfirmed'));
    expect(body).toContain('parentApi.accountDeletionPreview(token)');
    expect(body).toContain('applyIfCurrent');
    expect(body).toContain('setConfirming');
  });

  it('opens nothing when that read fails, and shows the refusal on the page', () => {
    const requested = CODE.slice(CODE.indexOf('async function onDeleteRequested'));
    const body = requested.slice(0, requested.indexOf('async function onDeleteConfirmed'));
    // A dialog with no numbers in it is a dialog that is confirmable against
    // nothing, so the failure path sets the page's error and opens no dialog.
    expect(body).toContain('setError(refusalText(cause, parentCopy.settings.deleteAccountFailed))');
    expect(body.slice(body.indexOf('} catch'))).not.toContain('setConfirming');
  });

  it('announces nothing on the way out, because nothing would be read', () => {
    // `router.replace` unmounts the screen in the same tick, so a live region
    // would never be read — and `setDeleting(false)` there would be a write to a
    // component that is gone.
    expect(CODE).not.toContain('aria-live');
    expect(CODE).not.toContain('announce(');
  });
});

describe('what a refused account delete puts in the dialog', () => {
  it('shows the API’s own sentence when it authored one', () => {
    const refused = new ParentApiError(
      'generic',
      409,
      null,
      false,
      false,
      'That is not the account password.',
    );
    expect(refusalText(refused, parentCopy.settings.deleteAccountFailed)).toBe(
      'That is not the account password.',
    );
  });

  it('falls back to the error’s own message, then to the screen’s', () => {
    expect(refusalText(new ParentApiError('boom', 503), 'fallback')).toBe('boom');
    expect(refusalText('boom', 'fallback')).toBe('fallback');
  });

  it('leaves the parent in Parent View: a wrong password is not an expired session', () => {
    // A 401 would clear elevation and route to the PIN prompt, hiding the very
    // refusal the parent needs to read.
    const refused = new ParentApiError('generic', 409, null, false, false, 'Wrong password.');
    expect(endsParentView(refused)).toBe(false);
  });

  it('says nothing was removed, because nothing was', () => {
    expect(parentCopy.settings.deleteAccountFailed).toMatch(/Nothing was removed/i);
  });
});

describe('the Allowances section on the Settings screen', () => {
  it('renders the panel, above Data & deletion', () => {
    // Reading a limit is the routine visit; ending the account is not.
    expect(CODE).toContain('<AllowancesPanel consumption={consumption} />');
    expect(CODE.indexOf('<AllowancesPanel')).toBeLessThan(
      CODE.indexOf('aria-labelledby="data-and-deletion-heading"'),
    );
  });

  it('reads the allowances on mount, on the elevation the screen already holds', () => {
    const load = CODE.slice(CODE.indexOf('const load = useCallback'));
    const body = load.slice(0, load.indexOf('useEffect'));
    expect(body).toContain('parentApi.allowances(token)');
    expect(body).toContain('applyIfCurrent');
    // A lost elevation goes through the existing path, not a second one.
    expect(body).toContain('endsParentView(cause)');
  });

  it('states the loading sentence in a live region while the read is in flight', () => {
    expect(CODE).toContain('parentCopy.settings.allowancesLoading');
    expect(parentCopy.settings.allowancesLoading.length).toBeGreaterThan(0);
    const loading = CODE.slice(CODE.indexOf('allowancesLoading && ('));
    expect(loading.slice(0, loading.indexOf('</Typography>'))).toContain('role="status"');
  });

  it('reports a failed allowance read without suppressing Data & deletion', () => {
    // Its own error state, reported in its own alert: the deletion gate is FR-33's
    // and must not go dark because a counter could not be read.
    expect(CODE).toContain(
      'setAllowancesError(refusalText(cause, parentCopy.settings.allowancesFailed))',
    );
    expect(parentCopy.settings.allowancesFailed).toMatch(/Nothing has changed/i);
    // The failure is rendered from its own state, in its own alert.
    const alert = CODE.slice(CODE.indexOf('{allowancesError !== null && ('));
    expect(alert.slice(0, alert.indexOf('</Alert>'))).toContain('{allowancesError}');
    // And the delete control's own predicate does not read it at all: whatever
    // the allowance read came to, the deletion gate is decided by the preview,
    // the in-flight writes and the token.
    const disabled = CODE.slice(CODE.indexOf('disabled={'));
    const predicate = disabled.slice(0, disabled.indexOf('}'));
    expect(predicate).toContain('loading');
    expect(predicate).toContain('previewing');
    expect(predicate).toContain('deleting');
    expect(predicate).toContain('token === null');
    expect(predicate).not.toContain('allowances');
  });

  it('leaves no consumption rendered when the allowance read fails', () => {
    // A retry whose read fails must not leave the previous period's counters on
    // screen under an alert saying the read failed: a stale allowance is a
    // specific, confident number a parent may act on, while an absent one sends
    // them to the retry the alert offers.
    const handler = CODE.slice(CODE.indexOf('parentApi.allowances(token)'));
    const failure = handler.slice(handler.indexOf('(cause: unknown)'));
    const body = failure.slice(0, failure.indexOf('parentApi.accountDeletionPreview'));
    expect(body).toContain('setConsumption(null)');
    // And the panel renders only on a consumption, so clearing it is what makes
    // the alert stand alone.
    expect(CODE).toContain(
      '{consumption !== null && <AllowancesPanel consumption={consumption} />}',
    );
  });

  it('holds no tier figure, tier name or reset date of its own', () => {
    expect(CODE).not.toMatch(/\bFree\b|\bPlus\b|\bFamily\b|\bInternal\b/u);
    expect(CODE).not.toContain('Intl.');
  });
});
