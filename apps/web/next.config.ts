import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: [
    '@roomsell/catalogue',
    '@roomsell/pricing',
    '@roomsell/inventory',
    '@roomsell/scene-core',
    '@roomsell/geometry',
    '@roomsell/layout-engine',
    '@roomsell/ui',
  ],
  outputFileTracingExcludes: {
    '*': ['../../.local/**/*', '../../fixtures/**/*', '../../generated_images/**/*'],
  },
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
