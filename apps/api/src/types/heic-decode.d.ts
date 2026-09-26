/**
 * `heic-decode` ships no types of its own, so the one call this repo makes is
 * declared here rather than reached through `any`.
 *
 * It is the libheif binding the ingest path uses for HEIC and HEIF: sharp's
 * prebuilt libvips decodes only AVIF out of the HEIF family, and an iPhone
 * photograph is HEIC. The decoder returns raw RGBA — four channels, already
 * upright, because libheif applies the container's own `irot`/`imir` transforms
 * while decoding.
 */
declare module 'heic-decode' {
  interface DecodedHeicImage {
    width: number;
    height: number;
    /** Raw RGBA, one byte per channel, `width * height * 4` long. */
    data: Uint8ClampedArray;
  }

  function decode(input: { buffer: Buffer | Uint8Array }): Promise<DecodedHeicImage>;

  export default decode;
}
