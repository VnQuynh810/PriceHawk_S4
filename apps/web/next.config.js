/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  compress: true,
  swcMinify: true,
  poweredByHeader: false,
  images: {
    minimumCacheTTL: 3600,
    remotePatterns: [
      { protocol: "https", hostname: "**.tgdd.vn" },
      { protocol: "https", hostname: "**.thegioididong.com" },
      { protocol: "https", hostname: "**.fptshop.com.vn" },
      { protocol: "https", hostname: "**.hoanghamobile.com" },
      { protocol: "https", hostname: "**.cellphones.com.vn" },
      { protocol: "https", hostname: "**.cdnvn.com" },
      { protocol: "https", hostname: "via.placeholder.com" },
      { protocol: "https", hostname: "**.ebayimg.com" },
      { protocol: "https", hostname: "**.backmarket.co.uk" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
