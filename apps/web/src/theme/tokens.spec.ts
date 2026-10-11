import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { colorTokens, type ColorTokenName } from './tokens';

const SRC_ROOT = path.resolve(import.meta.dirname, '..');
const TOKEN_MODULE = path.join(SRC_ROOT, 'theme', 'tokens.ts');

/**
 * The one file besides the token module allowed to write a hex outside a comment.
 *
 * `contrast.spec.ts` names the *retired* Clear Room values in order to assert
 * they are gone, and two reference colours to prove its luminance formula. Both
 * are hexes that must not resolve through `colorTokens` — naming them is the
 * assertion, not a painted surface.
 */
const ALLOWED_HEX_FILES = new Set([path.join(SRC_ROOT, 'theme', 'contrast.spec.ts')]);

/**
 * The 21 colour tokens, named once. "No token added, removed or renamed" is a
 * boundary of this story, so it is enforced here rather than reviewed by eye —
 * a palette revision re-values these keys and never grows the set.
 */
const COLOR_TOKEN_NAMES = [
  'primaryStudent',
  'primaryParent',
  'onPrimary',
  'secondary',
  'success',
  'error',
  'warning',
  'info',
  'backgroundDefault',
  'backgroundPaper',
  'textPrimary',
  'textSecondary',
  'divider',
  'tintHover',
  'tintSelected',
  'backgroundInverted',
  'primaryOnInverted',
  'dividerOnInverted',
  'textOnInverted',
  'brandGround',
  'brandInk',
] as const satisfies readonly ColorTokenName[];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Strips `//` and block comments, and the contents of template/quoted strings is
 * deliberately left alone — a hex inside a string literal is exactly what this
 * sweep is looking for. Comments are excluded because the camera-chrome block and
 * the capture spec legitimately *name* values as prose evidence of a measured
 * ratio; naming a value in prose is not painting with it.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const HEX_LITERAL = /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b/g;

describe('colorTokens is the only place colour exists', () => {
  it('holds exactly the 21 token names, none added, removed or renamed', () => {
    expect(Object.keys(colorTokens).sort()).toEqual([...COLOR_TOKEN_NAMES].sort());
  });

  it.each(['light', 'dark'] as const)('gives every token a %s value', (scheme) => {
    for (const [name, pair] of Object.entries(colorTokens)) {
      expect(pair[scheme], name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('is the only module under src with a hex colour literal outside comments', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => file !== TOKEN_MODULE && !ALLOWED_HEX_FILES.has(file))
      .flatMap((file) => {
        const matches = withoutComments(readFileSync(file, 'utf8')).match(HEX_LITERAL) ?? [];
        return matches.map((hex) => `${path.relative(SRC_ROOT, file)}: ${hex}`);
      });

    expect(offenders, `colour belongs in tokens.ts:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('spends every hex literal in its own source on a token value', () => {
    const matches = withoutComments(readFileSync(TOKEN_MODULE, 'utf8')).match(HEX_LITERAL) ?? [];
    const declared = new Set(Object.values(colorTokens).flatMap((pair) => [pair.light, pair.dark]));

    // Two values per token, and nothing else: no stray hex hiding in the module
    // that is not reachable as a token.
    expect(matches).toHaveLength(COLOR_TOKEN_NAMES.length * 2);
    for (const hex of matches) {
      expect(declared, hex).toContain(hex);
    }
  });
});
