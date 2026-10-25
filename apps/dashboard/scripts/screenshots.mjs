// Render check: serve the static export under /gtm-factory, open every page after 30 simulated
// days at desktop width, save a screenshot per page, and fail on any console error.
// Usage: pnpm --filter dashboard build && pnpm --filter dashboard screenshots [outDir]
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.join(import.meta.dirname, "..", "out");
const outDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "..", "..", "..", "docs", "screenshots"));
const BASE = "/gtm-factory";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (!url.pathname.startsWith(BASE)) return void res.writeHead(404).end();
  let file = path.join(root, decodeURIComponent(url.pathname.slice(BASE.length)));
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(root, "404.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const origin = `http://localhost:${port}${BASE}`;

export const PAGES = [
  ["today", "/"],
  ["new-campaign", "/campaigns/new/"],
  ["new-campaign-funnels", "/campaigns/new/?step=funnels"],
  ["campaigns", "/campaigns/"],
  ["campaign", "/campaigns/view/?id=campaign-1"],
  ["campaign-reactive", "/campaigns/view/?id=campaign-1f"],
  ["icps", "/audiences/"],
  ["leads", "/leads/"],
  ["lead", "LEAD"],
  ["companies", "/companies/"],
  ["pinned-templates", "/pinned/?pin=outcome%3Atemplate_written"],
  ["pinned-llms", "/pinned/?pin=pipe%3Allm"],
  ["research", "/research/"],
  ["catalogue", "/catalogue/"],
  ["catalogue-pipes", "/catalogue/?tab=pipes"],
  ["catalogue-scripts", "/catalogue/?tab=scripts"],
  ["catalogue-tactics", "/catalogue/?tab=tactics"],
  ["catalogue-strategies", "/catalogue/?tab=strategies"],
  ["ledger", "/ledger/"],
  ["how-it-works", "/how-it-works/"],
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text()}`));
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

// Day 30 of the default scenario, then every page reads the same saved history.
await page.goto(`${origin}/?day=30`);
await page.waitForSelector('[data-testid="sim-day"]:has-text("Day 30")', { timeout: 90000 });
let leadHref = "/leads/";
for (const [name, route] of PAGES) {
  await page.goto(`${origin}${route === "LEAD" ? leadHref.replace(BASE, "") : route}`);
  await page.waitForSelector('[data-testid="sim-day"]:has-text("Day 30")', { timeout: 90000 });
  await page.waitForTimeout(1200);
  // The panel scrolls inside a fixed frame: grow the window to the panel's height to capture it whole.
  const h = await page.evaluate(() => (document.querySelector("main")?.scrollHeight ?? 900) + 64);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(900, h), 7000) });
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log("saved", file);
  if (name === "leads") {
    // The lead page shows the furthest lead of the board: its whole timeline, from first touch to paid.
    const cols = await page.$$eval("[data-col]", (els) => els.map((e) => ({ col: e.getAttribute("data-col"), href: e.querySelector("a")?.getAttribute("href") ?? null })));
    leadHref = [...cols].reverse().find((c) => c.href)?.href ?? leadHref;
  }
}
await browser.close();
server.close();
if (errors.length) {
  console.error(`console errors (${errors.length}):\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("no console error");
