import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: [
    '@roomsell/catalogue',
    '@roomsell/scene-core',
    '@roomsell/geometry',
    '@roomsell/layout-engine',
    '@roomsell/ui',
  ],
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};
export default config;
