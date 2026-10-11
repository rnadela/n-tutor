import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';
import { colorTokens } from '@/theme/tokens';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');

/**
 * What the committed PNG actually is, read out of its own bytes.
 *
 * The manifest declares a `sizes` string and the generator declares a ground
 * colour, and nothing so far has checked that either matches the file a browser
 * will download. A manifest naming a 512 that is really a 192 is an icon a
 * platform silently rejects or upscales, and neither failure reaches a spec
 * that only reads the route's return value.
 */
function readPng(file: string): { width: number; height: number; firstPixel: string } & {
  pixelAt: (x: number, y: number) => string;
} {
  const bytes = readFileSync(file);

  expect(bytes.subarray(0, 8).toString('hex'), `${file} must be a PNG`).toBe('89504e470d0a1a0a');
  // IHDR is always the first chunk: 8 signature + 4 length + 4 type, then the
  // two dimensions.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(bytes[24], `${file} must be 8-bit`).toBe(8);
  expect(bytes[25], `${file} must be truecolour RGB`).toBe(2);

  // The generator writes one IDAT; walk the chunks rather than assume an
  // offset, so a PNG replaced by a real design tool still reads.
  let at = 8;
  let idat: Buffer | null = null;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') {
      idat = bytes.subarray(at + 8, at + 8 + length);
      break;
    }
    at += 12 + length;
  }
  expect(idat, `${file} must carry image data`).not.toBeNull();

  const raw = inflateSync(idat!);
  const hex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase();
  const stride = 1 + width * 3;
  // Every scanline in this generator uses filter 0 (None), so a pixel's bytes
  // sit at a fixed offset from its row's filter byte.
  const pixelAt = (x: number, y: number): string => {
    const row = y * stride;
    expect(raw[row], `${file}'s scanline ${y} must be unfiltered`).toBe(0);
    const at = row + 1 + x * 3;
    return `#${hex(raw[at])}${hex(raw[at + 1])}${hex(raw[at + 2])}`;
  };
  const firstPixel = pixelAt(0, 0);

  return { width, height, firstPixel, pixelAt };
}

describe('the icon files the manifest names', () => {
  const icons = manifest().icons ?? [];

  it('names at least the three the install prompt needs', () => {
    expect(icons).toHaveLength(3);
  });

  it.each(icons.map((icon) => [icon.src, icon] as const))(
    '%s exists under public/, is the size it claims, and is the Student teal',
    (src, icon) => {
      const file = path.join(PUBLIC_DIR, src);
      expect(existsSync(file), `${src} must be a committed file under public/`).toBe(true);

      const png = readPng(file);

      // The declared `sizes` is what the platform picks on; a file that does
      // not match it is an icon chosen for the wrong slot.
      const [declaredWidth, declaredHeight] = (icon.sizes ?? '').split('x').map(Number);
      expect(png.width).toBe(declaredWidth);
      expect(png.height).toBe(declaredHeight);

      // The generator carries the ground colour as raw bytes, because a build
      // script cannot import a TypeScript module. This is the assertion that
      // notices when those bytes drift from the token they were copied from.
      expect(png.firstPixel).toBe(colorTokens.primaryStudent.light.toUpperCase());
    },
  );

  it('insets the maskable glyph further than the unmasked one', () => {
    // The maskable icon is cropped to the platform's shape, so it is different
    // art, not the same file relabelled: its glyph box is scaled down, so a
    // point that falls inside the unmasked stem can fall outside the maskable
    // one. A byte-size difference alone would also pass for an unrelated
    // change, so this reads the pixel each scale actually disagrees on.
    const maskable = icons.find((icon) => icon.purpose === 'maskable');
    const unmasked = icons.find((icon) => icon.sizes === '512x512' && icon.purpose !== 'maskable');
    expect(maskable).toBeDefined();
    expect(unmasked).toBeDefined();

    const glyph = colorTokens.onPrimary.light.toUpperCase();
    const ground = colorTokens.primaryStudent.light.toUpperCase();

    // x=120, y=256: inside the unmasked stem (scale 0.56 → stem spans roughly
    // x 113-181) but left of the maskable stem (scale 0.44 → stem starts
    // around x 143), so the two icons must disagree here if the inset is real.
    expect(readPng(path.join(PUBLIC_DIR, unmasked!.src)).pixelAt(120, 256)).toBe(glyph);
    expect(readPng(path.join(PUBLIC_DIR, maskable!.src)).pixelAt(120, 256)).toBe(ground);
  });
});
