import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemeRegistry } from './ThemeRegistry';

describe('the root registry', () => {
  it('mounts exactly one polite live region for the whole app', () => {
    // `useAnnounce()` throws outside a provider, so an unmounted region would
    // make the first snackbar on any surface a crash rather than a message.
    const markup = renderToStaticMarkup(<ThemeRegistry>body</ThemeRegistry>);
    expect(markup.match(/role="status"/gu)?.length).toBe(1);
    expect(markup).toContain('aria-live="polite"');
  });

  it('still renders what it wraps', () => {
    expect(renderToStaticMarkup(<ThemeRegistry>body</ThemeRegistry>)).toContain('body');
  });
});
