/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  // Enable for offline-first capabilities
  swcMinify: true,
  // Configure for desktop app feel
  trailingSlash: false,
  output: 'standalone'
}

module.exports = nextConfig