import path from "node:path";
import type { NextConfig } from "next";

// Served from GitHub Pages under /gtm-factory. Set NEXT_PUBLIC_BASE_PATH="" to serve from the root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/gtm-factory";

// NEXT_OUTPUT=standalone builds a Node server (a factory serving the api data source); the default is the static export.
const output = process.env.NEXT_OUTPUT === "standalone" ? "standalone" : "export";

const config: NextConfig = {
  output,
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  transpilePackages: ["@gtm-factory/engine"],
  turbopack: { root: path.join(import.meta.dirname, "../..") },
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default config;
