import path from "node:path";
import type { NextConfig } from "next";

// Served from GitHub Pages under /gtm-factory. Set NEXT_PUBLIC_BASE_PATH="" to serve from the root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/gtm-factory";

const config: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  transpilePackages: ["@gtm-factory/engine"],
  turbopack: { root: path.join(import.meta.dirname, "../..") },
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default config;
