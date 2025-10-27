/** @type {import('next').NextConfig} */
const nextConfig = {
  swcMinify: true,
  trailingSlash: false,
  output: 'standalone',
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ 'sql.js': 'commonjs sql.js' });
    }
    return config;
  },
};

module.exports = nextConfig;