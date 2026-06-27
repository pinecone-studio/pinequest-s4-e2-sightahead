/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["yt-search", "cheerio", "youtube-transcript"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "yt3.googleusercontent.com" },
    ],
  },
};

module.exports = nextConfig;
