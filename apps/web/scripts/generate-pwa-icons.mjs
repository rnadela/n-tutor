/**
 * Generates the placeholder PWA icon set, dependency-free.
 *
 * Why by hand rather than with an image library: this change is not permitted
 * to add a dependency, runtime or dev (AD-35), and `next/og`'s `ImageResponse`
 * produces hashed, route-served URLs that a manifest's `src` cannot name
 * stably. A PNG of a flat ground plus a few rectangles is ~40 lines against
 * `node:zlib`, and the output is **committed**, so nothing is generated at
 * build or request time and the art stays swappable: replace the four
 * constants below — or the PNGs themselves — when real artwork arrives.
 *
 * Run with `node apps/web/scripts/generate-pwa-icons.mjs` from the repo root.
 * Re-running is a no-op in `git status`: same input, same deflate, same bytes.
 */
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Student teal, light value — `colorTokens.primaryStudent.light` in
 * `src/theme/tokens.ts`. Duplicated here as bytes because a build script
 * cannot import a TypeScript module without a loader, and the PNG needs the
 * channels anyway. The manifest reads the token itself; this is the art.
 */
const GROUND = [0x0f, 0x6e, 0x78];
/** `colorTokens.onPrimary.light` — the monogram, white on teal. */
const GLYPH = [0xff, 0xff, 0xff];

/**
 * The monogram "n" as three rectangles in a unit box: one stem, one shoulder,
 * one right leg. Rectangles rather than curves so the same code renders every
 * size, and the maskable variant is the same art at a smaller scale factor.
 */
const GLYPH_RECTS = [
  { x0: 0.0, y0: 0.0, x1: 0.24, y1: 1.0 },
  { x0: 0.24, y0: 0.0, x1: 0.76, y1: 0.26 },
  { x0: 0.76, y0: 0.26, x1: 1.0, y1: 1.0 },
];

/** How much of the canvas the glyph box spans on an unmasked icon. */
const SCALE_ANY = 0.56;
/**
 * The maskable inset. A maskable icon may be cropped to a circle of 80% of the
 * canvas, so the glyph box has to fit inside that circle, not merely inside the
 * centre 80% square: at 0.44 the box's diagonal is ~0.62 of the canvas, which
 * clears the safe zone with room to spare, and the teal is full-bleed so the
 * crop never exposes a transparent corner.
 */
const SCALE_MASKABLE = 0.44;

/**
 * Paints one icon into raw PNG scanlines: a filter byte per row followed by
 * 8-bit RGB triples (colour type 2, no alpha — the ground is opaque).
 */
function renderScanlines(size, scale) {
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);

  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter 0 (None); nothing here benefits from a predictor
    for (let x = 0; x < size; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = GROUND[0];
      raw[at + 1] = GROUND[1];
      raw[at + 2] = GROUND[2];
    }
  }

  const box = size * scale;
  const origin = (size - box) / 2;
  for (const rect of GLYPH_RECTS) {
    const x0 = Math.round(origin + rect.x0 * box);
    const x1 = Math.round(origin + rect.x1 * box);
    const y0 = Math.round(origin + rect.y0 * box);
    const y1 = Math.round(origin + rect.y1 * box);
    for (let y = y0; y < y1; y += 1) {
      const row = y * stride;
      for (let x = x0; x < x1; x += 1) {
        const at = row + 1 + x * 3;
        raw[at] = GLYPH[0];
        raw[at + 1] = GLYPH[1];
        raw[at + 2] = GLYPH[2];
      }
    }
  }

  return raw;
}

/** length + type + data + CRC32 over type and data — the PNG chunk framing. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** PNG = signature + IHDR + IDAT(zlib of the scanlines) + IEND. */
function encodePng(size, scale) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(renderScanlines(size, scale), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The set, and the only place it is decided. `public/icons` holds what the
 * manifest names; the two app-directory files are Next's `icon` / `apple-icon`
 * conventions, which emit the favicon and the iOS home-screen icon.
 */
const ICONS = [
  { path: 'public/icons/icon-192.png', size: 192, scale: SCALE_ANY },
  { path: 'public/icons/icon-512.png', size: 512, scale: SCALE_ANY },
  { path: 'public/icons/icon-512-maskable.png', size: 512, scale: SCALE_MASKABLE },
  { path: 'src/app/icon.png', size: 512, scale: SCALE_ANY },
  { path: 'src/app/apple-icon.png', size: 180, scale: SCALE_ANY },
];

for (const icon of ICONS) {
  const target = join(WEB_ROOT, icon.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, encodePng(icon.size, icon.scale));
  process.stdout.write(`${icon.path} ${icon.size}x${icon.size}\n`);
}
