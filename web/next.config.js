/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["yt-search", "cheerio"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
    ],
  },
};

module.exports = nextConfig;
