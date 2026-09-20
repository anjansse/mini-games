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
//
// Apps under /apps stay single self-contained HTML files, so that opening one
// straight from a git clone still works. Everything a file cannot carry on its
// own — the web app manifest, the icons, the service worker registration — is
// injected here, on the way into dist/.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { appIcon, themeColor } from './icon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const ALLOWED_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const FORBIDDEN = [/window\.claude\b/, /claude\.use\s*\(/, /window\.storage\b/, /api\.anthropic\.com/];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['index', 'assets', '_headers', '_redirects', '404', 'sw', 'offline', 'manifest', 'icon']);

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readJson(path, what) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { fail(`${what}: cannot read ${path} (${e.message})`); return null; }
}

/* ---------- load and validate ---------- */

const config = readJson(join(ROOT, 'config', 'apps.json'), 'config');
if (!config || !Array.isArray(config.apps)) {
  console.error('config/apps.json is missing or has no "apps" array.');
  process.exit(1);
}

const site = Object.assign(
  { title: 'Games', tagline: '', domain: 'games.jnssn.io', languages: ['en'], defaultLanguage: 'en' },
  config.site || {}
);
const LANGS = site.languages;
const DEFAULT_LANG = site.defaultLanguage;
if (!LANGS.includes(DEFAULT_LANG)) fail(`config: defaultLanguage "${DEFAULT_LANG}" is not in languages.`);

// A user-facing string is either a plain string (same in every language) or an
// object keyed by language code.
function pick(value, lang, where) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value[lang] != null) return value[lang];
    if (value[DEFAULT_LANG] != null) {
      warnings.push(`${where}: no "${lang}" translation, falling back to "${DEFAULT_LANG}".`);
      return value[DEFAULT_LANG];
    }
  }
  fail(`${where}: cannot resolve a string for "${lang}".`);
  return '';
}

const seen = new Set();
const apps = [];

for (const entry of config.apps) {
  const slug = entry && entry.slug;
  if (!slug || !SLUG_RE.test(slug)) { fail(`config: "${slug}" is not a valid slug (lowercase letters, digits and single hyphens).`); continue; }
  if (RESERVED.has(slug)) { fail(`config: "${slug}" is reserved and would collide with a site-root file.`); continue; }
  if (seen.has(slug)) { fail(`config: "${slug}" is listed twice.`); continue; }
  seen.add(slug);

  const dir = join(ROOT, 'apps', slug);
  const html = join(dir, 'index.html');
  if (!existsSync(html)) { fail(`${slug}: apps/${slug}/index.html does not exist.`); continue; }

  const meta = readJson(join(dir, 'meta.json'), slug);
  if (!meta) continue;
  for (const k of ['title', 'description', 'created']) if (!meta[k]) fail(`${slug}: meta.json is missing "${k}".`);

  const extra = readdirSync(dir).filter((f) => f !== 'index.html' && f !== 'meta.json');
  if (extra.length) fail(`${slug}: apps must be a single index.html; found ${extra.join(', ')}.`);

  const source = readFileSync(html, 'utf8');
  for (const re of FORBIDDEN) if (re.test(source)) fail(`${slug}: uses a Claude-runtime API (${re.source}). It will not work on Pages.`);
  for (const host of new Set([...source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))) {
    if (!ALLOWED_HOSTS.includes(host)) fail(`${slug}: references ${host}, which is not on the allowlist (${ALLOWED_HOSTS.join(', ')}).`);
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(source)) fail(`${slug}: no viewport meta tag; it will not be responsive on a phone.`);
  if (!/prefers-color-scheme/.test(source)) fail(`${slug}: does not respond to prefers-color-scheme.`);
  if (!/<\/head>/i.test(source) || !/<\/body>/i.test(source)) fail(`${slug}: needs literal </head> and </body> tags; the build injects the PWA plumbing there.`);
  // A multilingual app must actually carry the shared language runtime, or the
  // site-wide toggle will not reach it.
  const appLangs = meta.languages || [DEFAULT_LANG];
  if (appLangs.length > 1 && !/jnssn-lang/.test(source)) {
    fail(`${slug}: meta.json declares ${appLangs.length} languages but the app does not use the shared 'jnssn-lang' runtime.`);
  }

  apps.push({ slug, enabled: entry.enabled === true, meta, html, source, langs: appLangs, bytes: Buffer.byteLength(source) });
}

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

const enabled = apps.filter((a) => a.enabled);
const disabled = apps.filter((a) => !a.enabled);

/* ---------- shared chrome ---------- */

// Language is chosen once for the whole origin and every page reads the same
// key, so switching on the index carries into each game and back.
const LANG_RUNTIME = `
(function(){
  var K='jnssn-lang', LANGS=${JSON.stringify(LANGS)}, DEF=${JSON.stringify(DEFAULT_LANG)};
  function stored(){ try{ return localStorage.getItem(K); }catch(e){ return null; } }
  function initial(){
    var s=stored(); if(LANGS.indexOf(s)>-1) return s;
    var nav=(navigator.languages||[navigator.language||'']).join(',').toLowerCase();
    for(var i=0;i<LANGS.length;i++) if(nav.indexOf(LANGS[i])>-1) return LANGS[i];
    return DEF;
  }
  var cur=initial();
  document.documentElement.lang=cur;
  window.JLang={
    langs:LANGS,
    get:function(){ return cur; },
    set:function(l){
      if(LANGS.indexOf(l)<0||l===cur) return;
      cur=l; document.documentElement.lang=l;
      try{ localStorage.setItem(K,l); }catch(e){}
      window.dispatchEvent(new CustomEvent('jlangchange',{detail:l}));
    }
  };
})();`.trim();

// Rendered by each page; the runtime above keeps the pressed state in sync.
const LANG_TOGGLE_CSS = `
.langbar{display:flex;gap:0;border:1.5px solid var(--ink-soft);border-radius:999px;overflow:hidden;flex:none}
.langbar button{appearance:none;border:0;background:transparent;color:var(--ink-soft);cursor:pointer;
  font:700 12.5px/1 system-ui,sans-serif;letter-spacing:.06em;padding:8px 11px;min-height:34px;text-transform:uppercase}
.langbar button[aria-pressed="true"]{background:var(--ink);color:var(--on-ink)}
`.trim();

const LANG_TOGGLE_JS = `
function langBar(){
  var l=window.JLang; if(!l||l.langs.length<2) return '';
  return '<div class="langbar" role="group" aria-label="Language">'+l.langs.map(function(c){
    return '<button type="button" data-lang="'+c+'" aria-pressed="'+(c===l.get())+'">'+c+'</button>';
  }).join('')+'</div>';
}
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('[data-lang]');
  if(b&&window.JLang) window.JLang.set(b.getAttribute('data-lang'));
});`.trim();

const SHELL_CSS = `
:root{--paper:#FBFBF6;--grid:#D9E4F2;--ink:#1B3A9C;--ink-soft:#5B6FA8;--red:#C4202B;--pencil:#3A3D45;--fill:#EAF0FB;--on-ink:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#0F1626;--grid:#1B2740;--ink:#AFC4FF;--ink-soft:#7F93C8;--red:#FF7B7B;--pencil:#E4E8F2;--fill:#18233C;--on-ink:#0F1626}}
:root[data-theme="dark"]{--paper:#0F1626;--grid:#1B2740;--ink:#AFC4FF;--ink-soft:#7F93C8;--red:#FF7B7B;--pencil:#E4E8F2;--fill:#18233C;--on-ink:#0F1626}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:"Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--pencil);background-color:var(--paper);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:22px 22px;min-height:100vh;line-height:1.45;font-size:16px;-webkit-tap-highlight-color:transparent}
.wrap{max-width:520px;margin:0 auto;padding:calc(24px + env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom))}
.disp{font-family:"Caveat","Bradley Hand","Segoe Script",cursive;font-weight:700;color:var(--ink);line-height:1}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px}
h1{font-size:52px}
.tagline{color:var(--ink-soft);font-size:16px;margin:8px 2px 26px}
.sheet{background:var(--paper);border:1.5px solid var(--ink);border-radius:6px;overflow:hidden}
a.card{display:flex;align-items:center;gap:14px;padding:16px 14px;border-top:1px solid var(--grid);text-decoration:none;color:inherit}
a.card:first-child{border-top:0}
a.card:active{background:var(--fill)}
.ic{width:38px;height:38px;border-radius:9px;flex:none}
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
a:focus-visible,button:focus-visible{outline:3px solid var(--ink-soft);outline-offset:2px}
/* Hide only the variants that do NOT match the current language. Revealing a
   match with display:revert would reset it to the UA default and discard the
   author's own display rule, e.g. .t{display:block}. */
${LANGS.map((l) => `html[lang="${l}"] [data-l]:not([data-l="${l}"]){display:none}`).join('\n')}
${LANG_TOGGLE_CSS}
`.trim();

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Caveat:wght@600;700&display=swap" rel="stylesheet">`;

// Renders one string in every language as sibling elements; CSS shows the one
// matching html[lang]. No flash, and it still reads correctly with JS disabled.
const ml = (tag, byLang, attrs = '') =>
  LANGS.map((l) => `<${tag} data-l="${l}"${attrs}>${esc(byLang[l])}</${tag}>`).join('');

const SITE_TITLE = Object.fromEntries(LANGS.map((l) => [l, pick(site.title, l, 'site.title')]));
const SITE_TAGLINE = Object.fromEntries(LANGS.map((l) => [l, pick(site.tagline, l, 'site.tagline')]));

function page({ title, description, body, bodyClass = '', extraCss = '', extraJs = '' }) {
  return `<!doctype html>
<html lang="${DEFAULT_LANG}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
${FONTS}
<style>
${SHELL_CSS}${extraCss ? '\n' + extraCss : ''}
</style>
<script>
${LANG_RUNTIME}
</script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<main class="wrap">
${body}
</main>
<script>
${LANG_TOGGLE_JS}
(function(){
  var slot=document.getElementById('langslot');
  if(slot) slot.innerHTML=langBar();
  window.addEventListener('jlangchange',function(){ if(slot) slot.innerHTML=langBar(); });
})();${extraJs ? '\n' + extraJs : ''}
</script>
</body>
</html>
`;
}

/* ---------- landing page ---------- */

const cards = enabled.length
  ? enabled.map((a) => {
      const t = Object.fromEntries(LANGS.map((l) => [l, pick(a.meta.title, l, `${a.slug}.title`)]));
      const d = Object.fromEntries(LANGS.map((l) => [l, pick(a.meta.description, l, `${a.slug}.description`)]));
      return `  <a class="card" href="/${a.slug}/">
    <img class="ic" src="/${a.slug}/icon-192.png" alt="" width="38" height="38" loading="lazy">
    <span class="body">${ml('span', t, ' class="t"')}${ml('span', d, ' class="d"')}</span>
    <span class="arrow" aria-hidden="true">→</span>
  </a>`;
    }).join('\n')
  : '  <div class="empty">' + ml('span', Object.fromEntries(LANGS.map((l) => [l, l === 'fr' ? 'Rien de publié pour le moment.' : 'Nothing published yet.']))) + '</div>';

const NOTE = { en: 'Everything here runs entirely in your browser. Nothing you type leaves the device. Add a game to your Home Screen and it works with no signal.',
               fr: 'Tout fonctionne entièrement dans votre navigateur. Rien de ce que vous tapez ne quitte l’appareil. Ajoutez un jeu à l’écran d’accueil et il marche sans réseau.' };

const landing = page({
  title: SITE_TITLE[DEFAULT_LANG],
  description: SITE_TAGLINE[DEFAULT_LANG],
  body: `<div class="head">
  <h1 class="disp">${ml('span', SITE_TITLE)}</h1>
  <div id="langslot"></div>
</div>
<p class="tagline">${ml('span', SITE_TAGLINE)}</p>
<div class="sheet">
${cards}
</div>
<p class="note">${ml('span', NOTE)}</p>`,
});

const mini = (titles, bodies, link) => page({
  title: titles[DEFAULT_LANG],
  description: bodies[DEFAULT_LANG],
  body: `<div class="mid">
  <h1 class="disp">${ml('span', titles)}</h1>
  <p>${ml('span', bodies)}</p>
  <a class="back" href="/">${ml('span', link)}</a>
</div>`,
});

const BACK = { en: 'Back to all games', fr: 'Retour aux jeux' };

const unavailable = mini(
  { en: 'Not right now', fr: 'Pas maintenant' },
  { en: 'This game is switched off. It is not gone — it will come back when it is turned on again.',
    fr: 'Ce jeu est désactivé. Il n’a pas disparu : il reviendra quand il sera réactivé.' },
  BACK);

const notFound = mini(
  { en: 'Nothing here', fr: 'Rien ici' },
  { en: 'There is no game at this address.', fr: 'Il n’y a aucun jeu à cette adresse.' },
  BACK);

const offline = mini(
  { en: 'Offline', fr: 'Hors ligne' },
  { en: 'You are offline and this page was never cached. Games you have opened before still work.',
    fr: 'Vous êtes hors ligne et cette page n’a jamais été mise en cache. Les jeux déjà ouverts fonctionnent toujours.' },
  BACK);

const headers = `/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/sw.js
  Cache-Control: public, max-age=0, must-revalidate

/*.png
  Cache-Control: public, max-age=31536000, immutable
`;

if (CHECK_ONLY) {
  warnings.forEach((w) => console.warn('  ! ' + w));
  console.log(`✓ ${apps.length} app(s) valid — ${enabled.length} enabled, ${disabled.length} disabled. Nothing written (--check).`);
  process.exit(0);
}

/* ---------- PWA plumbing, injected on the way into dist/ ---------- */

function manifest(name, shortName, slug, start) {
  return JSON.stringify({
    name, short_name: shortName, start_url: start, scope: start,
    display: 'standalone', orientation: 'portrait',
    background_color: '#FBFBF6', theme_color: themeColor(slug),
    icons: [
      { src: start + 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: start + 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: start + 'icon-mask.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2);
}

// Registration is deliberately silent and non-fatal: opening the file straight
// from a git clone (file://) throws here, and the app must not care.
const SW_REGISTER = `
<script>
if('serviceWorker' in navigator) window.addEventListener('load',function(){
  navigator.serviceWorker.register('/sw.js').catch(function(){});
});
</script>`;

function injectPwa(html, slug, base) {
  const head = `<link rel="manifest" href="${base}manifest.webmanifest">
<link rel="apple-touch-icon" href="${base}icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="${themeColor(slug)}">
`;
  return html
    .replace(/<\/head>/i, head + '</head>')
    .replace(/<\/body>/i, SW_REGISTER + '\n</body>');
}

/* ---------- write ---------- */

writeFileSync(join(ROOT, 'site', 'index.html'), landing);

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const written = [];
const put = (rel, data) => { mkdirSync(dirname(join(dist, rel)), { recursive: true }); writeFileSync(join(dist, rel), data); written.push(rel); };

put('index.html', injectPwa(landing, 'games', '/'));
put('404.html', injectPwa(notFound, 'games', '/'));
put('offline.html', injectPwa(offline, 'games', '/'));
put('_headers', headers);
put('manifest.webmanifest', manifest(SITE_TITLE[DEFAULT_LANG], SITE_TITLE[DEFAULT_LANG], 'games', '/'));
for (const [n, s, m] of [['icon-180.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-mask.png', 512, true]]) {
  put(n, appIcon('games', s, m));
}

for (const a of apps) {
  const base = `/${a.slug}/`;
  // A disabled app's source is never uploaded, so "off" means genuinely absent
  // from the deploy rather than merely unlinked. The slug still resolves, with
  // an explanation, instead of a 404.
  put(`${a.slug}/index.html`, injectPwa(a.enabled ? a.source : unavailable, a.slug, base));
  if (!a.enabled) continue;
  put(`${a.slug}/manifest.webmanifest`, manifest(
    pick(a.meta.title, DEFAULT_LANG, a.slug), pick(a.meta.title, DEFAULT_LANG, a.slug), a.slug, base));
  for (const [n, s, m] of [['icon-180.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-mask.png', 512, true]]) {
    put(`${a.slug}/${n}`, appIcon(a.slug, s, m));
  }
}

// The cache name is derived from the deployed bytes, so a deploy that changes
// nothing does not churn caches, and one that changes anything invalidates all
// of them.
const version = createHash('sha256')
  .update(written.filter((f) => f !== '_headers').sort().map((f) => f + ':' + createHash('sha256').update(readFileSync(join(dist, f))).digest('hex')).join('\n'))
  .digest('hex').slice(0, 12);

// Deduplicated: Cache.addAll rejects outright if the list contains the same
// URL twice, which fails the whole install and leaves the site uncacheable.
const precache = [...new Set([
  '/', '/offline.html',
  ...written.filter((f) => f !== '_headers' && f !== 'index.html' && !f.endsWith('404.html')).map((f) => '/' + f),
])];

// Network-first for pages, cache-first for immutable assets. Deliberately not
// stale-while-revalidate for HTML: a bad cached page on a phone is very hard to
// clear, so being online always means being current, and the cache only ever
// rescues a request the network could not answer.
const sw = `// Generated by scripts/build.mjs. Do not edit.
const CACHE = 'games-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const FONTS = /^https:\\/\\/fonts\\.(googleapis|gstatic)\\.com\\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !FONTS.test(req.url)) return;

  // Fonts and icons never change under a given URL: serve them from the cache
  // and only go to the network on a miss.
  if (!sameOrigin || /\\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Pages: always prefer the network so a deploy is live immediately, and fall
  // back to the cache only when the network cannot answer at all.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline.html')))
  );
});
`;
put('sw.js', sw);

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
warnings.forEach((w) => console.warn('  ! ' + w));
console.log(`\nBuilt dist/ for https://${site.domain}  [sw cache games-${version}]`);
for (const a of apps) {
  console.log(`  ${a.enabled ? '● on ' : '○ off'}  /${a.slug}/`.padEnd(24) + (a.enabled ? `${kb(a.bytes)}  ${a.langs.join('/')}` : 'unavailable page'));
}
console.log(`\n${enabled.length} enabled, ${disabled.length} disabled, ${written.length} files, languages ${LANGS.join('/')}.\n`);
