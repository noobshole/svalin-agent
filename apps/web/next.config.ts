import type { NextConfig } from "next";

/**
 * The website is a static export (out/): every page is plain HTML, and the free scan calls the
 * API from the browser. Security headers are written to out/_headers by scripts/write-headers.mjs.
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
