import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  output: 'standalone',
  /**
   * `/sw.js` is the one file that must never be served from a cache.
   *
   * A browser checks the worker's bytes to decide whether to install a
   * replacement, so a cached copy means a worker that can never be updated —
   * and the one we ship is the version that must be able to retire itself if a
   * later story ever removes it. `no-store` on the worker is the escape hatch
   * that keeps the decision reversible.
   *
   * The explicit `Content-Type` is belt and braces: a worker served as anything
   * other than a JavaScript type is refused outright by the registration.
   */
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript' },
        ],
      },
    ];
  },
};

export default nextConfig;
