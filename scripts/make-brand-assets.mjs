/**
 * Renders the link-preview card and the Apple touch icon from the same pixel
 * mark the header uses, so the brand stays in one place.
 *
 * Telegram, Slack and iMessage will not render an SVG preview, so these have
 * to be real PNGs committed to the repo rather than generated at request time.
 *
 *   node scripts/make-brand-assets.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MARK = readFileSync(join(ROOT, "src/app/icon.svg"), "utf8");
const PIXEL_FONT = join(ROOT, "public/fonts/silkscreen-700.woff2");

/**
 * The favicon is a self-contained tile. On the card the same mark has to sit
 * directly on the panel, so the tile is dropped and the perforation is painted
 * in the surface colour to bite into it.
 */
function markOn(surface) {
  return MARK.replace('<rect width="16" height="16" fill="#141311" />', "").replaceAll(
    "#141311",
    surface,
  );
}

function card() {
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Pixel; src: url('file://${PIXEL_FONT}') format('woff2'); }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #141311; display: grid; place-items: center;
         font-family: -apple-system, Helvetica, Arial, sans-serif; }
  .frame { width: 1136px; height: 566px; border: 2px solid #393329; background: #1d1b17;
           display: grid; grid-template-columns: 240px 1fr; align-items: center; gap: 64px;
           padding: 0 72px; box-shadow: 8px 8px 0 #100f0d; }
  .mark svg { width: 240px; height: 240px; image-rendering: pixelated; }
  h1 { font-family: Pixel, monospace; font-size: 82px; color: #eeeae1; letter-spacing: 0.04em; }
  .tag { font-size: 40px; color: #c5a04c; margin-top: 22px; }
  .sub { font-size: 28px; color: #b6ad9d; margin-top: 18px; line-height: 1.45; max-width: 660px; }
  .host { font-family: ui-monospace, Menlo, monospace; font-size: 22px; color: #6d6354; margin-top: 30px; }
</style>
<div class="frame">
  <div class="mark">${markOn("#1d1b17")}</div>
  <div>
    <h1>STAMPPAD</h1>
    <p class="tag">Small stamps. Big ideas.</p>
    <p class="sub">Burn a Solana coin to issue a stamp on Zcash, then own it, send it, or sell the whole stamp for ZEC.</p>
    <p class="host">stamppad.fun</p>
  </div>
</div>`;
}

function icon(size) {
  return `<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; }
  body { width: ${size}px; height: ${size}px; background: #141311; }
  svg { width: ${size}px; height: ${size}px; image-rendering: pixelated; display: block; }
</style>${MARK}`;
}

function shoot(html, width, height, out) {
  const dir = mkdtempSync(join(tmpdir(), "stamppad-brand-"));
  const page = join(dir, "page.html");
  writeFileSync(page, html);
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      `--screenshot=${join(dir, "out.png")}`,
      `--window-size=${width},${height}`,
      `file://${page}`,
    ],
    { stdio: "ignore" },
  );
  copyFileSync(join(dir, "out.png"), out);
  rmSync(dir, { recursive: true, force: true });
  console.log(`${out} ${width}x${height}`);
}

shoot(card(), 1200, 630, join(ROOT, "src/app/opengraph-image.png"));
// Next only emits twitter:image from its own file convention, so keep a copy.
copyFileSync(join(ROOT, "src/app/opengraph-image.png"), join(ROOT, "src/app/twitter-image.png"));
shoot(icon(180), 180, 180, join(ROOT, "src/app/apple-icon.png"));
