import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { ColorModeSwitch, ColorModeSwitchView } from './ColorModeSwitch';
import { commonCopy } from '@/copy/common';
import type { ColorSchemeChoice } from '@/lib/color-mode';
import { parentTheme, studentTheme } from '@/theme/theme';
import { comfortableDensity, density } from '@/theme/tokens';

function render(node: ReactElement, theme: Theme = parentTheme): string {
  return renderToStaticMarkup(createElement(ThemeProvider, { theme }, node));
}

/** The view at a scheme, with its press recorded rather than rendered. */
function viewAt(scheme: ColorSchemeChoice) {
  const presses: ColorSchemeChoice[] = [];
  const node = ColorModeSwitchView({ scheme, onSelect: (next) => presses.push(next) });
  // The `Tooltip` and the `IconButton` it wraps, read as elements rather than
  // as markup: MUI lets the child's own `aria-label` win over the tooltip's
  // title, so the two strings being equal is not visible in the HTML.
  const tooltip = node as unknown as {
    props: { title: string; children: { props: Record<string, unknown> } };
  };
  return { presses, title: tooltip.props.title, button: tooltip.props.children.props };
}

describe('what the switch says it will do', () => {
  it('offers dark, as a real button, while light is in effect', () => {
    const markup = render(<ColorModeSwitchView scheme="light" onSelect={() => {}} />);
    expect(markup).toContain('<button');
    expect(markup).toContain('type="button"');
    expect(markup).toContain(`aria-label="${commonCopy.colorMode.toDark}"`);
    expect(markup).not.toContain(commonCopy.colorMode.toLight);
  });

  it('offers light while dark is in effect', () => {
    const markup = render(<ColorModeSwitchView scheme="dark" onSelect={() => {}} />);
    expect(markup).toContain('<button');
    expect(markup).toContain(`aria-label="${commonCopy.colorMode.toLight}"`);
    expect(markup).not.toContain(commonCopy.colorMode.toDark);
  });

  it('names the next press rather than the state showing, from the copy module', () => {
    // The distinction the whole control turns on: "Switch to dark mode" is a
    // promise, where "Dark mode" could as easily be a report.
    expect(viewAt('light').button['aria-label']).toBe(commonCopy.colorMode.toDark);
    expect(viewAt('dark').button['aria-label']).toBe(commonCopy.colorMode.toLight);
  });

  it('says the same sentence in the tooltip as in the accessible name', () => {
    // Two carriers, one string: a tooltip that disagreed with the name would
    // tell a sighted mouse user one thing and a screen reader another.
    for (const scheme of ['light', 'dark'] as const) {
      const view = viewAt(scheme);
      expect(view.title).toBe(view.button['aria-label']);
    }
  });

  it('hides the icon from assistive technology, leaving the name to carry it', () => {
    const markup = render(<ColorModeSwitchView scheme="light" onSelect={() => {}} />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<svg');
  });

  it('draws a different glyph for each offer', () => {
    // Sun and moon are the only visual difference between the two states, so
    // the markup must actually change with the scheme.
    const light = render(<ColorModeSwitchView scheme="light" onSelect={() => {}} />);
    const dark = render(<ColorModeSwitchView scheme="dark" onSelect={() => {}} />);
    expect(light).not.toBe(dark);
  });

  it('asks for the opposite scheme when pressed', () => {
    const offeringDark = viewAt('light');
    (offeringDark.button['onClick'] as () => void)();
    expect(offeringDark.presses).toEqual(['dark']);

    const offeringLight = viewAt('dark');
    (offeringLight.button['onClick'] as () => void)();
    expect(offeringLight.presses).toEqual(['light']);
  });
});

describe('the box the finger has to hit', () => {
  it('meets each surface tap-target floor from the mounted theme', () => {
    expect(
      render(<ColorModeSwitchView scheme="light" onSelect={() => {}} />, parentTheme),
    ).toContain(`width:${density.tapTarget}px`);
    expect(
      render(<ColorModeSwitchView scheme="light" onSelect={() => {}} />, studentTheme),
    ).toContain(`width:${comfortableDensity.tapTarget}px`);
  });

  it('states no figure of its own: a caller may hand it the floor instead', () => {
    const markup = render(
      <ColorModeSwitchView
        scheme="light"
        onSelect={() => {}}
        tapTarget={comfortableDensity.tapTarget}
      />,
      parentTheme,
    );
    expect(markup).toContain(`width:${comfortableDensity.tapTarget}px`);
  });
});

describe('before the mode is known', () => {
  it('reserves the space without claiming anything, and renders no button', () => {
    // `mode` is `undefined` through the server render and the hydration render,
    // which is exactly what a render with no provider reproduces. A button
    // here would have announced a next press it could not know.
    const markup = renderToStaticMarkup(<ColorModeSwitch />);
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain(commonCopy.colorMode.toDark);
    expect(markup).not.toContain(commonCopy.colorMode.toLight);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(`width:${density.tapTarget}px`);
  });

  it('reserves it under a surface theme too, at that surface floor', () => {
    const markup = render(<ColorModeSwitch />, studentTheme);
    expect(markup).not.toContain('<button');
    expect(markup).toContain(`width:${comfortableDensity.tapTarget}px`);
  });
});
