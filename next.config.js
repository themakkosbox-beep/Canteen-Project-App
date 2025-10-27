const { version } = require('./package.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: true,
  trailingSlash: false,
  output: 'standalone',
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION ?? version,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ 'sql.js': 'commonjs sql.js' });
    }
    return config;
  },
};

module.exports = nextConfig;