import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import manifest from './manifest';
import { colorTokens } from '@/theme/tokens';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');

type Rgb = [number, number, number];

/**
 * What the committed PNG actually is, read out of its own bytes.
 *
 * The manifest declares a `sizes` string and the icon art carries a ground
 * colour, and nothing else checks that either matches the file a browser will
 * download. A manifest naming a 512 that is really a 192 is an icon a platform
 * silently rejects or upscales, and neither failure reaches a spec that only
 * reads the route's return value.
 *
 * The art comes out of a design tool, so every scanline filter (PNG §9) is
 * undone here rather than assuming unfiltered rows.
 */
function readPng(file: string): {
  width: number;
  height: number;
  pixelAt: (x: number, y: number) => Rgb;
} {
  const bytes = readFileSync(file);

  expect(bytes.subarray(0, 8).toString('hex'), `${file} must be a PNG`).toBe('89504e470d0a1a0a');
  // IHDR is always the first chunk: 8 signature + 4 length + 4 type, then the
  // two dimensions.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(bytes[24], `${file} must be 8-bit`).toBe(8);
  // Truecolour without alpha: an install icon with transparency is composited
  // onto whatever the platform chooses, which is how a cream icon turns black.
  expect(bytes[25], `${file} must be opaque truecolour RGB`).toBe(2);

  const idat: Buffer[] = [];
  let at = 8;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  expect(idat.length, `${file} must carry image data`).toBeGreaterThan(0);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const toLeft = Math.abs(estimate - left);
        const toUp = Math.abs(estimate - up);
        const toUpLeft = Math.abs(estimate - upLeft);
        predictor = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }

  const pixelAt = (x: number, y: number): Rgb => {
    const offset = y * stride + x * bpp;
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  };
  return { width, height, pixelAt };
}

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

/**
 * Raster art is anti-aliased and compressed, so the ground is matched within a
 * couple of levels per channel rather than byte for byte — close enough that a
 * different colour still fails.
 */
function expectNear(actual: Rgb, hex: string, label: string): void {
  const expected = hexToRgb(hex);
  for (let channel = 0; channel < 3; channel++) {
    expect(
      Math.abs(actual[channel] - expected[channel]),
      `${label}: ${actual} vs ${hex}`,
    ).toBeLessThanOrEqual(2);
  }
}

describe('the icon files the manifest names', () => {
  const icons = manifest().icons ?? [];

  it('names at least the three the install prompt needs', () => {
    expect(icons).toHaveLength(3);
  });

  it.each(icons.map((icon) => [icon.src, icon] as const))(
    '%s exists under public/, is the size it claims, and sits on the brand ground',
    (src, icon) => {
      const file = path.join(PUBLIC_DIR, src);
      expect(existsSync(file), `${src} must be a committed file under public/`).toBe(true);

      const png = readPng(file);

      // The declared `sizes` is what the platform picks on; a file that does
      // not match it is an icon chosen for the wrong slot.
      const [declaredWidth, declaredHeight] = (icon.sizes ?? '').split('x').map(Number);
      expect(png.width).toBe(declaredWidth);
      expect(png.height).toBe(declaredHeight);

      // The manifest's `background_color` paints the splash around this icon,
      // so the token and the art's own ground must agree.
      const ground = colorTokens.brandGround.light;
      expectNear(png.pixelAt(0, 0), ground, `${src} top-left`);
      expectNear(png.pixelAt(png.width - 1, png.height - 1), ground, `${src} bottom-right`);
    },
  );

  it('insets the maskable art further than the unmasked one', () => {
    // The maskable icon is cropped to the platform's shape, so it is different
    // art, not the same file relabelled: its artwork is scaled into the safe
    // zone, so a point on the unmasked art can fall on bare ground in the
    // maskable one.
    const maskable = icons.find((icon) => icon.purpose === 'maskable');
    const unmasked = icons.find((icon) => icon.sizes === '512x512' && icon.purpose !== 'maskable');
    expect(maskable).toBeDefined();
    expect(unmasked).toBeDefined();

    // x=120, y=200: on the dark spine of the top book in the unmasked icon,
    // left of where the inset artwork begins in the maskable one.
    const [r, g, b] = readPng(path.join(PUBLIC_DIR, unmasked!.src)).pixelAt(120, 200);
    expect(r + g + b, 'unmasked icon must have artwork at (120, 200)').toBeLessThan(255);
    expectNear(
      readPng(path.join(PUBLIC_DIR, maskable!.src)).pixelAt(120, 200),
      colorTokens.brandGround.light,
      'maskable icon at (120, 200)',
    );
  });
});

describe('the favicon Next serves from the app folder', () => {
  it('holds only RGBA PNG entries, which is all Next can decode', () => {
    // Next decodes `app/favicon.ico` at build and on every dev request; an ICO
    // whose embedded PNGs are RGB fails "The PNG is not in RGBA format!" and
    // takes every page down with a 500, not just the tab icon.
    const bytes = readFileSync(path.resolve(import.meta.dirname, 'favicon.ico'));
    expect(bytes.readUInt16LE(2), 'favicon.ico must be an icon resource').toBe(1);

    const count = bytes.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);
    for (let entry = 0; entry < count; entry++) {
      const offset = bytes.readUInt32LE(6 + entry * 16 + 12);
      const png = bytes.subarray(offset);
      expect(png.subarray(0, 8).toString('hex'), `entry ${entry} must be a PNG`).toBe(
        '89504e470d0a1a0a',
      );
      expect(png[25], `entry ${entry} must be RGBA`).toBe(6);
    }
  });
});
