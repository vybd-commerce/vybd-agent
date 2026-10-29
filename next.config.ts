import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is per-user and fully dynamic; Cache Components adds no value yet.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
