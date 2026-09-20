#!/usr/bin/env node
// Generates the landing page and the Cloudflare Pages deploy directory from
// /config/apps.json. Zero dependencies on purpose: Pages runs this with a bare
// `node scripts/build.mjs`, so there is no install step that can fail.
//
//   node scripts/build.mjs          build site/index.html and dist/
//   node scripts/build.mjs --check  validate only, write nothing
//
// Anything that would ship a broken site is a hard error here rather than a
// mystery 404 later.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

// Hosts an app is allowed to reference. cdnjs for scripts, Google Fonts for
// stylesheets. Everything else must be inlined in the single HTML file.
const ALLOWED_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// Claude-runtime APIs. These only exist inside a Claude artifact and are dead
// code on Pages, so they are rejected outright.
const FORBIDDEN = [/window\.claude\b/, /claude\.use\s*\(/, /window\.storage\b/, /api\.anthropic\.com/];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Slugs that would collide with a file the deploy writes at the site root.
const RESERVED = new Set(['index', 'assets', '_headers', '_redirects', '404']);

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${what}: cannot read ${path} (${e.message})`);
    return null;
  }
}

/* ---------- load and validate ---------- */

const config = readJson(join(ROOT, 'config', 'apps.json'), 'config');
if (!config || !Array.isArray(config.apps)) {
  console.error('config/apps.json is missing or has no "apps" array.');
  process.exit(1);
}

const site = Object.assign(
  { title: 'apps', tagline: '', domain: 'apps.jnssn.io' },
  config.site || {}
);

const seen = new Set();
const apps = [];

for (const entry of config.apps) {
  const slug = entry && entry.slug;
  if (!slug || !SLUG_RE.test(slug)) {
    fail(`config: "${slug}" is not a valid slug (lowercase letters, digits and single hyphens).`);
    continue;
  }
  if (RESERVED.has(slug)) { fail(`config: "${slug}" is reserved and would collide with a site-root file.`); continue; }
  if (seen.has(slug)) { fail(`config: "${slug}" is listed twice.`); continue; }
  seen.add(slug);

  const dir = join(ROOT, 'apps', slug);
  const html = join(dir, 'index.html');
  if (!existsSync(html)) { fail(`${slug}: apps/${slug}/index.html does not exist.`); continue; }

  const meta = readJson(join(dir, 'meta.json'), slug);
  if (!meta) continue;
  for (const k of ['title', 'description', 'created']) {
    if (!meta[k]) fail(`${slug}: meta.json is missing "${k}".`);
  }

  // The app must be one self-contained file.
  const extra = readdirSync(dir).filter((f) => f !== 'index.html' && f !== 'meta.json');
  if (extra.length) fail(`${slug}: apps must be a single index.html; found ${extra.join(', ')}.`);

  const source = readFileSync(html, 'utf8');
  for (const re of FORBIDDEN) {
    if (re.test(source)) fail(`${slug}: uses a Claude-runtime API (${re.source}). It will not work on Pages.`);
  }
  for (const host of new Set([...source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))) {
    if (!ALLOWED_HOSTS.includes(host)) fail(`${slug}: references ${host}, which is not on the allowlist (${ALLOWED_HOSTS.join(', ')}).`);
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(source)) fail(`${slug}: no viewport meta tag; it will not be responsive on a phone.`);
  if (!/prefers-color-scheme/.test(source)) fail(`${slug}: does not respond to prefers-color-scheme.`);

  apps.push({ slug, enabled: entry.enabled === true, meta, html, bytes: Buffer.byteLength(source) });
}

// A directory under /apps that nobody registered will never be deployed.
if (existsSync(join(ROOT, 'apps'))) {
  for (const d of readdirSync(join(ROOT, 'apps'))) {
    if (statSync(join(ROOT, 'apps', d)).isDirectory() && !seen.has(d)) {
      warnings.push(`apps/${d}/ is not listed in config/apps.json and will not be deployed.`);
    }
  }
}

if (errors.length) {
  console.error('\nBuild failed:\n' + errors.map((e) => '  ✗ ' + e).join('\n') + '\n');
  process.exit(1);
}
warnings.forEach((w) => console.warn('  ! ' + w));

const enabled = apps.filter((a) => a.enabled);
const disabled = apps.filter((a) => !a.enabled);

/* ---------- shared chrome ---------- */

// One stylesheet for the landing page, the unavailable page and the 404, so the
// site around the apps reads as one thing.
const SHELL_CSS = `
:root{--paper:#FBFBF6;--grid:#D9E4F2;--ink:#1B3A9C;--ink-soft:#5B6FA8;--red:#C4202B;--pencil:#3A3D45;--fill:#EAF0FB;--on-ink:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#0F1626;--grid:#1B2740;--ink:#AFC4FF;--ink-soft:#7F93C8;--red:#FF7B7B;--pencil:#E4E8F2;--fill:#18233C;--on-ink:#0F1626}}
:root[data-theme="dark"]{--paper:#0F1626;--grid:#1B2740;--ink:#AFC4FF;--ink-soft:#7F93C8;--red:#FF7B7B;--pencil:#E4E8F2;--fill:#18233C;--on-ink:#0F1626}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:"Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--pencil);background-color:var(--paper);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:22px 22px;min-height:100vh;line-height:1.45;font-size:16px;-webkit-tap-highlight-color:transparent}
.wrap{max-width:520px;margin:0 auto;padding:calc(28px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom))}
.disp{font-family:"Caveat","Bradley Hand","Segoe Script",cursive;font-weight:700;color:var(--ink);line-height:1}
h1{font-size:52px}
.tagline{color:var(--ink-soft);font-size:16px;margin:8px 2px 26px}
.sheet{background:var(--paper);border:1.5px solid var(--ink);border-radius:6px;overflow:hidden}
a.card{display:flex;align-items:center;gap:14px;padding:16px 14px;border-top:1px solid var(--grid);text-decoration:none;color:inherit}
a.card:first-child{border-top:0}
a.card:active{background:var(--fill)}
.icon{font-size:26px;width:34px;text-align:center;flex:none;line-height:1}
.body{min-width:0;flex:1}
.t{display:block;font-weight:700;font-size:18px;color:var(--ink);line-height:1.25}
.d{display:block;font-size:14px;color:var(--ink-soft);margin-top:3px;line-height:1.35}
.arrow{color:var(--ink-soft);font-size:20px;flex:none}
.empty{padding:22px 16px;color:var(--ink-soft)}
.note{margin:22px 2px 0;font-size:13.5px;color:var(--ink-soft)}
.mid{text-align:center;padding-top:8vh}
.mid h1{font-size:46px}
.mid p{margin:16px auto 0;max-width:34ch;color:var(--ink-soft)}
.back{display:inline-block;margin-top:26px;border:1.5px solid var(--ink);border-radius:6px;padding:13px 22px;color:var(--ink);text-decoration:none;font-weight:700}
a:focus-visible{outline:3px solid var(--ink-soft);outline-offset:2px}
`.trim();

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Caveat:wght@600;700&display=swap" rel="stylesheet">`;

const page = (title, description, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${FONTS}
<style>
${SHELL_CSS}
</style>
</head>
<body>
<main class="wrap">
${body}
</main>
</body>
</html>
`;

/* ---------- landing page ---------- */

const cards = enabled.length
  ? enabled.map((a) => `  <a class="card" href="/${a.slug}/">
    <span class="icon" aria-hidden="true">${esc(a.meta.icon || '◆')}</span>
    <span class="body"><span class="t">${esc(a.meta.title)}</span><span class="d">${esc(a.meta.description)}</span></span>
    <span class="arrow" aria-hidden="true">→</span>
  </a>`).join('\n')
  : '  <div class="empty">Nothing published yet.</div>';

const landing = page(
  site.title,
  site.tagline || site.title,
  `<h1 class="disp">${esc(site.title)}</h1>
<p class="tagline">${esc(site.tagline)}</p>
<div class="sheet">
${cards}
</div>
<p class="note">Everything here runs entirely in your browser. Nothing you type leaves the device.</p>`
);

const unavailable = page(
  'Unavailable',
  'This app is currently switched off.',
  `<div class="mid">
  <h1 class="disp">Not right now</h1>
  <p>This app is switched off. It is not gone — it will come back when it is turned on again.</p>
  <a class="back" href="/">Back to all apps</a>
</div>`
);

const notFound = page(
  'Not found',
  'There is nothing at this address.',
  `<div class="mid">
  <h1 class="disp">Nothing here</h1>
  <p>There is no app at this address.</p>
  <a class="back" href="/">Back to all apps</a>
</div>`
);

// Sent with every response. No framing, no MIME sniffing, no referrer leakage.
const headers = `/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/*.html
  Cache-Control: public, max-age=0, must-revalidate
`;

if (CHECK_ONLY) {
  console.log(`✓ ${apps.length} app(s) valid — ${enabled.length} enabled, ${disabled.length} disabled. Nothing written (--check).`);
  process.exit(0);
}

/* ---------- write ---------- */

writeFileSync(join(ROOT, 'site', 'index.html'), landing);

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

copyFileSync(join(ROOT, 'site', 'index.html'), join(dist, 'index.html'));
writeFileSync(join(dist, '404.html'), notFound);
writeFileSync(join(dist, '_headers'), headers);

for (const a of apps) {
  mkdirSync(join(dist, a.slug), { recursive: true });
  // A disabled app's source is never uploaded, so "off" means genuinely absent
  // from the deploy rather than merely unlinked. The slug still resolves, with
  // an explanation, instead of a 404.
  if (a.enabled) copyFileSync(a.html, join(dist, a.slug, 'index.html'));
  else writeFileSync(join(dist, a.slug, 'index.html'), unavailable);
}

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
console.log(`\nBuilt dist/ for https://${site.domain}`);
for (const a of apps) console.log(`  ${a.enabled ? '● on ' : '○ off'}  /${a.slug}/`.padEnd(28) + (a.enabled ? kb(a.bytes) : 'unavailable page'));
console.log(`\n${enabled.length} enabled, ${disabled.length} disabled.\n`);
