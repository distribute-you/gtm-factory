// Render check: serve the static export under /gtm-factory (the demo reads its example database),
// open every page at desktop width, save a screenshot per page, and fail on any console error.
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
  ["new-campaign-plan", "/campaigns/new/?stage=plan"],
  ["campaigns", "/campaigns/"],
  ["campaign", "/campaigns/view/?id=campaign-outbound"],
  ["campaign-reactive", "/campaigns/view/?id=campaign-follow-ups"],
  ["campaign-ads", "/campaigns/view/?id=campaign-ads"],
  ["team", "/team/"],
  ["audiences", "/audiences/"],
  ["companies", "/companies/"],
  ["accounts", "/accounts/"],
  ["leads", "/leads/"],
  ["lead", "LEAD"],
  ["pinned-templates", "/pinned/?pin=outcome%3Atemplate_written"],
  ["pinned-llms", "/pinned/?pin=outcome%3Allm_completion"],
  ["research", "/research/"],
  ["catalogue", "/catalogue/"],
  ["catalogue-engines", "/catalogue/?tab=engines"],
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

let leadHref = "/leads/";
for (const [name, route] of PAGES) {
  await page.goto(`${origin}${route === "LEAD" ? leadHref.replace(BASE, "") : route}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
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
// The organization, brand and offer selector, open.
await page.goto(`${origin}/campaigns/`);
await page.waitForLoadState("networkidle");
await page.click('[data-testid="scope-selector"]');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(outDir, "scope-selector.png") });
console.log("saved scope-selector");
await browser.close();
server.close();
if (errors.length) {
  console.error(`console errors (${errors.length}):\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("no console error");
