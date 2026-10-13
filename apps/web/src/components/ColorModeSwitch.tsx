'use client';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useColorScheme } from '@mui/material/styles';
import { Moon, Sun } from 'lucide-react';
import { commonCopy } from '@/copy/common';
import { effectiveScheme, nextScheme, type ColorSchemeChoice } from '@/lib/color-mode';
import { density } from '@/theme/tokens';

/**
 * How large the icon is drawn inside its tap target. A figure rather than a
 * token because it is the glyph's own size, not a tap target, a spacing or a
 * radius — the same way every other chrome icon in this app states it.
 */
const ICON_SIZE = 20;

/**
 * What the switch offers next, said two ways that cannot drift: the sentence is
 * the accessible name *and* the tooltip, and the glyph is the same promise
 * drawn. A moon means "pressing this goes dark", never "it is dark now".
 */
const OFFER = {
  dark: { label: commonCopy.colorMode.toDark, Icon: Moon },
  light: { label: commonCopy.colorMode.toLight, Icon: Sun },
} as const satisfies Record<ColorSchemeChoice, { label: string; Icon: typeof Sun }>;

/**
 * The switch's markup and nothing about where the mode comes from.
 *
 * Split off the hook so every claim this component makes is assertable: the
 * `node` test runner cannot click, but it can render this at a given scheme and
 * read the label, the icon and the box off the markup. The wrapper below is the
 * only part that needs a provider.
 */
export function ColorModeSwitchView({
  scheme,
  onSelect,
  tapTarget,
}: {
  /** The scheme in effect. The control describes the *other* one. */
  scheme: ColorSchemeChoice;
  /** Handed the scheme the press asked for. */
  onSelect(next: ColorSchemeChoice): void;
  /**
   * The surface's tap-target floor, for a caller that is not under the
   * surface's own theme. Omitted everywhere in the app: the mounted theme's
   * density is the answer, and a figure passed in would be a second one.
   */
  tapTarget?: number;
}) {
  const next = nextScheme(scheme);
  const { label, Icon } = OFFER[next];
  return (
    // On hover *and* on focus, because a keyboard is how this is reached by
    // anyone who cannot see the glyph, and a tooltip that only answers a mouse
    // answers nobody there.
    <Tooltip title={label}>
      <IconButton
        type="button"
        aria-label={label}
        onClick={() => onSelect(next)}
        sx={(theme) => {
          // `theme.density` is optional on `ThemeOptions`, so a theme not built
          // by `buildTheme` would otherwise size this to `undefined`. The
          // compact set is the floor, exactly as `Screen.tsx` does it.
          const floor = tapTarget ?? (theme.density ?? density).tapTarget;
          return { width: floor, height: floor, flexShrink: 0 };
        }}
      >
        <Icon size={ICON_SIZE} aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );
}

/**
 * The one light/dark switch, mounted on each of its four placements.
 *
 * It configures nothing. `ThemeRegistry` is the only non-nested
 * `ThemeProvider`, so it owns the single colour-scheme context and the four
 * route providers inherit it — which is why one stored mode is shared by every
 * surface without a storage key, a `defaultMode` or a `disableNestedContext`
 * anywhere. Adding one here would be the bug, not the fix.
 *
 * Nothing is written anywhere but the browser's own store, by MUI: no API call,
 * no cookie, no column. A blocked store means the press still repaints this
 * visit and is simply forgotten by the next one.
 */
export function ColorModeSwitch() {
  const { mode, systemMode, setMode } = useColorScheme();
  const scheme = effectiveScheme(mode, systemMode);

  if (scheme === null) {
    // The server render and the hydration render both land here, where the
    // scheme is genuinely unknown. A placeholder of the same size keeps the
    // header from shifting when the real control arrives, and keeps the markup
    // honest: a button whose label flipped after hydration would have
    // announced the wrong next press for a frame.
    return (
      <Box
        aria-hidden="true"
        sx={(theme) => {
          const floor = (theme.density ?? density).tapTarget;
          return { width: floor, height: floor, flexShrink: 0 };
        }}
      />
    );
  }

  return <ColorModeSwitchView scheme={scheme} onSelect={(next) => setMode(next)} />;
}
