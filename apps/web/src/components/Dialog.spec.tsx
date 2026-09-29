import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { commonCopy } from '@/copy/common';
import { parentTheme } from '@/theme/theme';
import {
  AppDialog,
  canConfirmDestructive,
  ConfirmDestructiveDialog,
  DestructiveActions,
  DestructiveConfirmDialog,
  passwordOnToggle,
} from './Dialog';

/**
 * Renders an overlay inline rather than through a portal, which emits nothing
 * under `renderToStaticMarkup`.
 */
function renderOverlay(node: React.ReactElement): string {
  const markup = renderToStaticMarkup(<ThemeProvider theme={parentTheme}>{node}</ThemeProvider>);
  // Emotion inlines the stylesheet, which names `Mui-disabled` whether or not
  // anything is disabled. Assertions here are about the markup, not the CSS.
  return markup.replace(/<style[\s\S]*?<\/style>/gu, '');
}

const noop = () => {};

describe('the destructive confirmation gate', () => {
  it('refuses to confirm while the password field is empty', () => {
    expect(canConfirmDestructive('')).toBe(false);
  });

  it('refuses whitespace: a space is not a password', () => {
    expect(canConfirmDestructive('   ')).toBe(false);
  });

  it('allows the confirm once a password has been entered', () => {
    expect(canConfirmDestructive('correct horse')).toBe(true);
  });

  it('disables the rendered confirm control while the password is empty', () => {
    const markup = renderOverlay(
      <DestructiveActions password="" busy={false} onCancel={noop} onConfirm={noop} />,
    );
    const confirm = markup.slice(markup.indexOf(commonCopy.destructive.confirm) - 400);
    expect(markup).toContain('disabled');
    expect(confirm).toContain(commonCopy.destructive.confirm);
    expect(markup.match(/<button[^>]*disabled/gu)?.length).toBe(1);
  });

  it('enables it once a password is there', () => {
    const markup = renderOverlay(
      <DestructiveActions password="hunter2" busy={false} onCancel={noop} onConfirm={noop} />,
    );
    expect(markup).toContain(commonCopy.destructive.confirm);
    expect(markup).not.toContain('disabled');
  });

  it('disables both controls while a delete is already in flight', () => {
    const markup = renderOverlay(
      <DestructiveActions password="hunter2" busy onCancel={noop} onConfirm={noop} />,
    );
    expect(markup.match(/<button[^>]*disabled/gu)?.length).toBe(2);
  });
});

describe('when the confirmation is cancelled and reopened', () => {
  it('empties the password the parent backed out of', () => {
    expect(passwordOnToggle(false, 'hunter2')).toBe('');
  });

  it('leaves what is being typed alone while the dialog stays open', () => {
    expect(passwordOnToggle(true, 'hunt')).toBe('hunt');
  });

  it('closes the gate again, so the reopened dialog cannot confirm', () => {
    // The defect this prevents: cancel with a password typed, reopen, and the
    // confirm control is live against a password that is no longer shown.
    const carried = passwordOnToggle(false, 'hunter2');
    expect(canConfirmDestructive(carried)).toBe(false);
  });

  it('renders the reopened dialog with its confirm control disabled', () => {
    const markup = renderOverlay(
      <DestructiveConfirmDialog
        open
        subject="Ada"
        onCancel={noop}
        onConfirm={noop}
        disablePortal
        keepMounted
      />,
    );
    expect(markup).toContain(commonCopy.destructive.title('Ada'));
    expect(markup).toMatch(/<button[^>]*disabled/u);
  });
});

describe('a destructive confirmation with no named subject', () => {
  it('refuses an empty subject rather than rendering a headless "Delete ?"', () => {
    expect(() =>
      renderOverlay(
        <DestructiveConfirmDialog
          open
          subject=""
          onCancel={noop}
          onConfirm={noop}
          disablePortal
          keepMounted
        />,
      ),
    ).toThrow(/subject/u);
  });

  it('refuses a whitespace-only subject the same way', () => {
    expect(() =>
      renderOverlay(
        <DestructiveConfirmDialog
          open
          subject="   "
          onCancel={noop}
          onConfirm={noop}
          disablePortal
          keepMounted
        />,
      ),
    ).toThrow(/subject/u);
  });
});

describe('the destructive confirmation copy', () => {
  it('names exactly what will be destroyed', () => {
    expect(commonCopy.destructive.title('Ada')).toContain('Ada');
    expect(commonCopy.destructive.irreversible('Ada')).toContain('Ada');
  });

  it('states that the action cannot be undone', () => {
    expect(commonCopy.destructive.irreversible('Ada')).toContain('cannot be undone');
  });

  it('asks for the account password, not the Parent PIN', () => {
    expect(commonCopy.destructive.passwordLabel.toLowerCase()).toContain('account password');
    expect(commonCopy.destructive.passwordHint.toLowerCase()).not.toContain('pin');
  });

  it('carries no exclamation mark anywhere', () => {
    const strings = [
      commonCopy.destructive.title('Ada'),
      commonCopy.destructive.irreversible('Ada'),
      commonCopy.destructive.passwordLabel,
      commonCopy.destructive.passwordHint,
      commonCopy.destructive.confirm,
      commonCopy.destructive.cancel,
      commonCopy.snackbar.dismiss,
    ];
    for (const value of strings) expect(value, value).not.toContain('!');
  });

  it('is what the rendered dialog actually says', () => {
    const markup = renderOverlay(
      <DestructiveConfirmDialog
        open
        subject="Ada"
        onCancel={noop}
        onConfirm={noop}
        disablePortal
        keepMounted
      />,
    );
    expect(markup).toContain(commonCopy.destructive.irreversible('Ada'));
    expect(markup).toContain(commonCopy.destructive.passwordLabel);
    expect(markup).toContain('Ada');
  });
});

describe('the dialog primitive', () => {
  it('re-authenticates through a real password input', () => {
    const markup = renderOverlay(
      <DestructiveConfirmDialog
        open
        subject="Ada"
        onCancel={noop}
        onConfirm={noop}
        disablePortal
        keepMounted
      />,
    );
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain('<label');
  });

  it('labels itself by its own title rather than leaving the overlay unnamed', () => {
    const markup = renderOverlay(
      <AppDialog open title="Delete Ada?" onClose={noop} disablePortal keepMounted>
        body
      </AppDialog>,
    );
    const labelledBy = /aria-labelledby="([^"]+)"/u.exec(markup)?.[1];
    expect(labelledBy).toBeDefined();
    expect(markup).toContain(`id="${labelledBy}"`);
    expect(markup).toContain('Delete Ada?');
  });

  it('describes itself by the sentence a caller names, and by nothing when none is', () => {
    // A dialog whose whole point is one sentence — a count, a consequence, a figure
    // — announces only its title without this, which is the one thing a reader
    // arriving needed.
    const described = renderOverlay(
      <AppDialog
        open
        title="Hand in now?"
        describedBy="the-count"
        onClose={noop}
        disablePortal
        keepMounted
      >
        <p id="the-count">You have 2 questions that are not answered.</p>
      </AppDialog>,
    );
    expect(described).toContain('aria-describedby="the-count"');
    expect(described).toContain('id="the-count"');

    // Absent rather than empty when no caller named one: an `aria-describedby`
    // pointing at nothing is a description that silently never arrives.
    const plain = renderOverlay(
      <AppDialog open title="Your questions" onClose={noop} disablePortal keepMounted>
        body
      </AppDialog>,
    );
    expect(plain).not.toContain('aria-describedby');
  });

  it('carries the destructive intent as an outlined error button, never a fill', () => {
    const markup = renderOverlay(
      <DestructiveActions password="hunter2" busy={false} onCancel={noop} onConfirm={noop} />,
    );
    expect(markup).toContain('MuiButton-outlined');
    expect(markup).toContain('MuiButton-colorError');
    expect(markup).not.toContain('MuiButton-contained');
  });

  it('draws no shadow of its own: separation is the theme’s scrim and border', () => {
    const markup = renderOverlay(
      <AppDialog open title="Delete Ada?" onClose={noop} disablePortal keepMounted>
        body
      </AppDialog>,
    );
    // Elevation 0, not MUI Dialog's own 24 — the separation is the scrim and
    // the border, and `shadows[0]` is `none`.
    expect(markup).toContain('MuiPaper-elevation0');
    expect(markup).toContain('--Paper-shadow:var(--mui-shadows-0)');
    expect(markup).not.toContain('mui-shadows-24');
  });
});

describe('the passwordless destructive confirmation', () => {
  const BODY = 'All 3 photos of this upload will be removed.';

  function render(props: Partial<React.ComponentProps<typeof ConfirmDestructiveDialog>> = {}) {
    return renderOverlay(
      <ConfirmDestructiveDialog
        open
        title="Delete the photos of this upload?"
        body={BODY}
        onCancel={noop}
        onConfirm={noop}
        disablePortal
        keepMounted
        {...props}
      />,
    );
  }

  it('renders the body the caller wrote, which is the whole point of the dialog', () => {
    const markup = render();
    expect(markup).toContain('Delete the photos of this upload?');
    expect(markup).toContain(BODY);
  });

  it('describes itself by that body rather than announcing only its title', () => {
    const markup = render();
    const describedBy = /aria-describedby="([^"]+)"/u.exec(markup)?.[1];
    expect(describedBy).toBeDefined();
    expect(markup).toContain(`id="${describedBy}"`);
  });

  it('asks for no password: there is no password field to fill', () => {
    // The absent field *is* the requirement. Nothing built from the photographs
    // is lost, so there is no loss for a re-authentication to stand in front of.
    const markup = render();
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('autoComplete="current-password"');
    expect(markup).not.toContain(commonCopy.destructive.passwordLabel);
    expect(markup).not.toContain(commonCopy.destructive.passwordHint);
    expect(markup).not.toContain('<input');
  });

  it('enables the confirm on arrival, with nothing typed', () => {
    // Asserted on the controls themselves rather than on the whole markup: a
    // bare `not.toContain('disabled')` also matches `aria-disabled`, MUI's
    // `Mui-disabled` class and anything else that merely spells the word, so it
    // would pass and fail for reasons that have nothing to do with the confirm.
    const markup = render();
    expect(markup).toContain(commonCopy.destructive.confirm);
    expect(markup).toContain(commonCopy.destructive.cancel);
    expect(markup.match(/<button[^>]*disabled/gu)).toBeNull();
  });

  it('offers a way out beside the confirm, and offers it first', () => {
    // The order matters: the cancel is what a parent who opened this by mistake
    // reaches first, by tab and by eye.
    const markup = render();
    const buttons = [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/gu)].map((match) => match[1]);
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain(commonCopy.destructive.cancel);
    expect(buttons[1]).toContain(commonCopy.destructive.confirm);
  });

  it('locks both controls while the delete is in flight', () => {
    // Reachable only because the dialog does not close itself on confirm: the
    // caller keeps it open until the write settles.
    const markup = render({ busy: true });
    expect(markup.match(/<button[^>]*disabled/gu)?.length).toBe(2);
  });

  it('carries the destructive intent as an outlined error button, never a fill', () => {
    const markup = render();
    expect(markup).toContain('MuiButton-outlined');
    expect(markup).toContain('MuiButton-colorError');
    expect(markup).not.toContain('MuiButton-contained');
  });
});
