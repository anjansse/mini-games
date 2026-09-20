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
import { iconSet, themeColor, GLYPHS, GLYPH_NAMES, defaultGlyph } from './icon.mjs';
import { syncSource, isCurrent, uiVersion, tokens, UI_CSS, FONT_LINK } from './ui.mjs';

// The kit's own chevron, so the index points the same way a game does.
const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const SYNC_UI = process.argv.includes('--sync-ui');

/* ---------- --sync-ui ----------
   Writes the UI kit from scripts/ui.mjs into every app and into the scaffold
   boilerplate, then stops. This is the only thing that should ever edit the
   fenced blocks; a normal build only checks they are current.

   It runs before validation on purpose: an app whose copy is stale should be
   fixable with one command rather than having to satisfy the validator first. */
if (SYNC_UI) {
  const targets = [];
  const appsDir = join(ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const d of readdirSync(appsDir)) {
      const f = join(appsDir, d, 'index.html');
      if (existsSync(f)) targets.push({ file: f, slug: d, label: `apps/${d}/index.html` });
    }
  }
  // The scaffold carries the kit too, so a new app starts current rather than
  // stale on its first build. Its hue is a placeholder — the real one is
  // written when the file is copied to apps/<slug>/.
  const boiler = join(ROOT, '.claude', 'skills', 'new-app', 'boilerplate.html');
  if (existsSync(boiler)) targets.push({ file: boiler, slug: null, label: '.claude/skills/new-app/boilerplate.html' });

  let wrote = 0, skipped = 0;
  for (const t of targets) {
    const before = readFileSync(t.file, 'utf8');
    const after = syncSource(before, t.slug);
    if (after === null) {
      console.warn(`  ! ${t.label}: no jnssn-ui sentinels; nothing to sync. Scaffold it from the boilerplate.`);
      skipped++;
      continue;
    }
    if (after === before) { skipped++; continue; }
    writeFileSync(t.file, after);
    console.log(`  ✓ ${t.label}`);
    wrote++;
  }
  console.log(`\nUI kit ${uiVersion(null)} — ${wrote} file(s) updated, ${skipped} already current or unscaffolded.`);
  process.exit(0);
}

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
  if (meta.icon && !GLYPHS[meta.icon]) {
    fail(`${slug}: meta.json icon "${meta.icon}" is not a known mark. Pick one of: ${GLYPH_NAMES.join(', ')}.`);
  }
  // Budget: these are served to phones on mobile data and precached whole.
  const KB = Buffer.byteLength(source) / 1024;
  if (KB > 250) fail(`${slug}: index.html is ${KB.toFixed(0)} kB, over the 250 kB budget. Inline less, or split the work.`);
  else if (KB > 120) warnings.push(`${slug}: index.html is ${KB.toFixed(0)} kB; the 250 kB budget is close.`);

  // The UI kit is inlined per app, which is what keeps the single-file rule and
  // a bare `open apps/<slug>/index.html` both working — but it also means a
  // hand-edit would silently fork the design system. This is the check that
  // stops that. Absence is only a warning while apps are still being migrated;
  // once every app carries the kit it becomes an error like the rest.
  if (/jnssn-ui css/.test(source)) {
    if (!isCurrent(source, slug)) {
      fail(`${slug}: its copy of the UI kit has drifted from scripts/ui.mjs. Run \`node scripts/build.mjs --sync-ui\`, and put app-specific CSS outside the fenced block.`);
    }
  } else {
    warnings.push(`${slug}: does not carry the shared UI kit. It will not pick up design changes; see CONTRIBUTING.md.`);
  }

  const appLangs = meta.languages || [DEFAULT_LANG];
  if (appLangs.length > 1 && !/jnssn-lang/.test(source)) {
    fail(`${slug}: meta.json declares ${appLangs.length} languages but the app does not use the shared 'jnssn-lang' runtime.`);
  }

  apps.push({ slug, enabled: entry.enabled === true, meta, html, source, langs: appLangs,
              glyph: meta.icon || defaultGlyph(slug), bytes: Buffer.byteLength(source) });
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

// The language toggle is the kit's segmented control, so it is the same object
// here and inside every game.
const LANG_TOGGLE_JS = `
function langBar(){
  var l=window.JLang; if(!l||l.langs.length<2) return '';
  return l.langs.map(function(c){
    return '<button type="button" data-lang="'+c+'" aria-pressed="'+(c===l.get())+'">'+c+'</button>';
  }).join('');
}
document.addEventListener('click',function(e){
  var b=e.target.closest&&e.target.closest('[data-lang]');
  if(b&&window.JLang) window.JLang.set(b.getAttribute('data-lang'));
});`.trim();

// The shell runs on the same kit as the games, so the index and the game it
// opens are visibly one product. It carries no slug, so it takes the default
// hue; each game's own accent comes from its own slug.
const SHELL_CSS = `
${tokens(null)}
${UI_CSS}

/* --- the shell's own additions, all from the tokens above --- */
.head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
h1{font-size:34px}
.tagline{color:var(--dim);font-size:15.5px;margin:8px 2px 22px;max-width:36ch}

/* One app per row. A whole row is the tap target, not just the title. */
a.applink{display:flex;align-items:center;gap:13px;padding:13px 14px;text-decoration:none;color:inherit;
  min-height:var(--tap);transition:background var(--fast) linear}
a.applink:active{background:var(--inset)}
a.applink[hidden]{display:none}
.ic{width:40px;height:40px;border-radius:10px;flex:none;box-shadow:var(--edge)}
.t{display:block;font-weight:600;font-size:16.5px;line-height:1.25}
.d{display:block;font-size:13.5px;color:var(--dim);margin-top:2px;line-height:1.35}
.arrow{color:var(--faint);flex:none;display:grid;place-items:center}

.note{margin:22px 2px 0;font-size:13px;color:var(--faint);line-height:1.5}
.find{margin-bottom:12px}

/* 404, offline and the switched-off page. */
.mid{text-align:center;padding-top:10vh}
.mid h1{font-size:30px}
.mid p{margin:12px auto 0;max-width:34ch;color:var(--dim)}
.back{display:inline-flex;align-items:center;justify-content:center;gap:8px;margin-top:26px;
  min-height:54px;padding:0 22px;border-radius:var(--r);background:var(--accent);color:var(--accent-ink);
  text-decoration:none;font-weight:600;box-shadow:var(--lift);
  transition:transform var(--fast) var(--spring)}
.back:active{transform:scale(.972)}

/* Hide only the variants that do NOT match the current language. Revealing a
   match with display:revert would reset it to the UA default and discard the
   author's own display rule, e.g. .t{display:block}. */
${LANGS.map((l) => `html[lang="${l}"] [data-l]:not([data-l="${l}"]){display:none}`).join('\n')}
`.trim();

const FONTS = FONT_LINK;

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
      return `  <a class="applink" href="/${a.slug}/">
    <img class="ic" src="/${a.slug}/icon-192.png" alt="" width="40" height="40" loading="lazy">
    <span class="grow">${ml('span', t, ' class="t"')}${ml('span', d, ' class="d"')}</span>
    <span class="arrow" aria-hidden="true">${ARROW}</span>
  </a>`;
    }).join('\n')
  : '  <div class="empty">' + ml('span', Object.fromEntries(LANGS.map((l) => [l, l === 'fr' ? 'Rien de publié pour le moment.' : 'Nothing published yet.']))) + '</div>';

const NOTE = { en: 'Everything here runs entirely in your browser. Nothing you type leaves the device. Add a game to your Home Screen and it works with no signal.',
               fr: 'Tout fonctionne entièrement dans votre navigateur. Rien de ce que vous tapez ne quitte l’appareil. Ajoutez un jeu à l’écran d’accueil et il marche sans réseau.' };

// A flat list stops being usable somewhere around a screenful. The filter is
// plain DOM over already-rendered cards: no index to build, no data to ship
// twice, and it still works if the catalogue grows by an order of magnitude.
const FILTER_ON = enabled.length >= 12;
const FIND = { en: 'Search games', fr: 'Rechercher un jeu' };
const NONE = { en: 'Nothing matches that.', fr: 'Aucun résultat.' };

const filterMarkup = FILTER_ON
  ? `<input class="field find" id="find" type="search" autocomplete="off" autocapitalize="none" spellcheck="false"
    aria-label="${esc(FIND[DEFAULT_LANG])}" placeholder="${esc(FIND[DEFAULT_LANG])}">\n`
  : '';

const filterJs = FILTER_ON ? `
(function(){
  var box=document.getElementById('find'), list=document.getElementById('list');
  if(!box||!list) return;
  var cards=[].slice.call(list.querySelectorAll('a.applink'));
  var none=document.getElementById('none');
  var FIND=${JSON.stringify(FIND)}, NONE=${JSON.stringify(NONE)};
  function lang(){ return (window.JLang&&window.JLang.get())||document.documentElement.lang||'${DEFAULT_LANG}'; }
  function label(){
    var p=FIND[lang()]||FIND['${DEFAULT_LANG}'];
    box.placeholder=p; box.setAttribute('aria-label',p);
    none.textContent=NONE[lang()]||NONE['${DEFAULT_LANG}'];
  }
  // Match against the visible language only, so a French search does not hit
  // English text the reader cannot see.
  function norm(s){ return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
  function apply(){
    var q=norm(box.value.trim()), shown=0, l=lang();
    for(var i=0;i<cards.length;i++){
      var c=cards[i];
      if(!c.__k || c.__l!==l){
        c.__l=l;
        c.__k=norm([].slice.call(c.querySelectorAll('[data-l="'+l+'"]')).map(function(n){return n.textContent;}).join(' ')+' '+c.getAttribute('href'));
      }
      var hit=!q||c.__k.indexOf(q)>-1;
      c.hidden=!hit; if(hit) shown++;
    }
    none.hidden=shown>0;
  }
  box.addEventListener('input',apply);
  window.addEventListener('jlangchange',function(){ label(); apply(); });
  label();
})();` : '';

const landing = page({
  title: SITE_TITLE[DEFAULT_LANG],
  description: SITE_TAGLINE[DEFAULT_LANG],
  extraJs: filterJs,
  body: `<div class="head">
  <h1>${ml('span', SITE_TITLE)}</h1>
  <div class="seg" id="langslot" role="group" aria-label="Language"></div>
</div>
<p class="tagline">${ml('span', SITE_TAGLINE)}</p>
${filterMarkup}<div class="card list" id="list">
${cards}
</div>
<p class="empty" id="none" hidden>${esc(NONE[DEFAULT_LANG])}</p>
<p class="note">${ml('span', NOTE)}</p>`,
});

const mini = (titles, bodies, link) => page({
  title: titles[DEFAULT_LANG],
  description: bodies[DEFAULT_LANG],
  body: `<div class="mid">
  <h1>${ml('span', titles)}</h1>
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

// Add to Home Screen is the whole offline story, and nothing in Safari hints
// that it exists. iOS has no beforeinstallprompt, so the only thing that works
// there is showing the user the Share glyph they are looking for and where it
// is. Asks once, remembers a dismissal, and never appears once installed.
// Built from the kit's tokens, because this is injected into every page and a
// prompt on last year's palette on top of this year's page is exactly the kind
// of seam a player notices. The fallbacks only ever apply to a page that
// somehow has no kit at all.
const INSTALL_CSS = `
.jpwa{position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:0 12px calc(12px + env(safe-area-inset-bottom,0px));
  transform:translateY(130%);transition:transform var(--slow,340ms) var(--ease,cubic-bezier(.16,1,.3,1))}
.jpwa.on{transform:translateY(0)}
.jpwa-in{max-width:480px;margin:0 auto;display:flex;gap:12px;align-items:flex-start;
  background:var(--raised,#1A1D25);color:var(--text,#ECEEF3);border:1px solid var(--line,#262A34);
  border-radius:var(--r,14px);padding:14px;
  box-shadow:var(--lift-hi,0 18px 44px #0009),var(--edge,inset 0 1px 0 hsl(0 0% 100%/.06))}
.jpwa-ic{width:44px;height:44px;border-radius:10px;flex:none;box-shadow:var(--edge,none)}
.jpwa-tx{flex:1;min-width:0;font:400 14.5px/1.45 inherit}
.jpwa-tx b{display:block;font-size:16px;font-weight:600;color:var(--text,#ECEEF3);margin-bottom:3px;letter-spacing:-.01em}
.jpwa-sh{display:inline-block;width:1em;height:1em;vertical-align:-.16em;margin:0 .12em}
.jpwa-go{margin-top:10px;width:100%;border:0;background:var(--accent,#6E8BFF);
  color:var(--accent-ink,#0B0C10);border-radius:var(--r-sm,9px);min-height:var(--tap,48px);padding:0 14px;
  font:600 15px/1 inherit;cursor:pointer;transition:transform var(--fast,130ms) var(--spring,ease)}
.jpwa-go:active{transform:scale(.972)}
.jpwa-x{flex:none;width:40px;height:40px;border:0;background:transparent;color:var(--faint,#6B7286);
  font:400 24px/1 inherit;cursor:pointer;border-radius:50%;margin:-4px -4px 0 0}
.jpwa-x:focus-visible,.jpwa-go:focus-visible{outline:2px solid var(--accent,#6E8BFF);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.jpwa{transition:none}}
`.trim();

const INSTALL_STRINGS = {
  en: { title: 'Keep this on your phone',
        ios: 'Tap the Share button {share} at the bottom of the screen, then choose \u201cAdd to Home Screen\u201d. It will work without internet.',
        gen: 'Add it to your Home Screen and it will work without internet.',
        add: 'Add to Home Screen', close: 'Not now' },
  fr: { title: 'Gardez-le sur votre téléphone',
        ios: 'Touchez le bouton Partager {share} en bas de l\u2019écran, puis choisissez «\u00a0Sur l\u2019écran d\u2019accueil\u00a0». Il fonctionnera sans internet.',
        gen: 'Ajoutez-le à votre écran d\u2019accueil et il fonctionnera sans internet.',
        add: 'Ajouter à l\u2019écran d\u2019accueil', close: 'Plus tard' },
};

function installJs(iconHref, nameByLang) {
  return `
<script>
(function(){
  var KEY='jnssn-a2hs', S=${JSON.stringify(INSTALL_STRINGS)}, NAME=${JSON.stringify(nameByLang)};
  function lang(){ return (window.JLang && window.JLang.get()) || document.documentElement.lang || 'en'; }
  function tx(k){ return (S[lang()]||S.en)[k]; }
  // Already installed, or previously dismissed: never ask again.
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if(standalone) return;
  try{ if(localStorage.getItem(KEY)==='no') return; }catch(e){}

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
           || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  var deferred=null, el=null;
  var SHARE='<svg class="jpwa-sh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"/></svg>';

  function dismiss(){
    if(!el) return;
    el.classList.remove('on');
    try{ localStorage.setItem(KEY,'no'); }catch(e){}
    setTimeout(function(){ if(el&&el.parentNode) el.parentNode.removeChild(el); el=null; },350);
  }
  function paint(){
    if(!el) return;
    var body = isIOS ? tx('ios').replace('{share}',SHARE) : tx('gen');
    el.querySelector('.jpwa-tx').innerHTML='<b>'+tx('title')+'</b>'+body+
      (deferred?'<button class="jpwa-go" type="button">'+tx('add')+'</button>':'');
    el.querySelector('.jpwa-x').setAttribute('aria-label',tx('close'));
  }
  function show(){
    if(el) return;
    el=document.createElement('div');
    el.className='jpwa'; el.setAttribute('role','dialog'); el.setAttribute('aria-live','polite');
    el.innerHTML='<div class="jpwa-in"><img class="jpwa-ic" src="${iconHref}" alt="" width="44" height="44">'+
      '<div class="jpwa-tx"></div><button class="jpwa-x" type="button">\u00d7</button></div>';
    document.body.appendChild(el);
    paint();
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('on'); }); });
    el.addEventListener('click',function(e){
      if(e.target.closest('.jpwa-x')) return dismiss();
      if(e.target.closest('.jpwa-go') && deferred){
        var d=deferred; deferred=null; d.prompt();
        d.userChoice.then(function(){ dismiss(); }, function(){ dismiss(); });
      }
    });
    window.addEventListener('jlangchange', paint);
  }

  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); deferred=e; show(); });
  window.addEventListener('appinstalled', dismiss);
  // Let the page settle first, so this never competes with first paint.
  if(isIOS) setTimeout(show, 2500);
})();
</script>`;
}

function injectPwa(html, slug, base, nameByLang) {
  const head = `<link rel="manifest" href="${base}manifest.webmanifest">
<link rel="apple-touch-icon" href="${base}icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="${themeColor(slug)}">
<style>${INSTALL_CSS}</style>
`;
  return html
    .replace(/<\/head>/i, head + '</head>')
    .replace(/<\/body>/i, SW_REGISTER + installJs(base + 'icon-192.png', nameByLang) + '\n</body>');
}

/* ---------- write ---------- */

writeFileSync(join(ROOT, 'site', 'index.html'), landing);

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const written = [];
const put = (rel, data) => { mkdirSync(dirname(join(dist, rel)), { recursive: true }); writeFileSync(join(dist, rel), data); written.push(rel); };

put('index.html', injectPwa(landing, 'games', '/', SITE_TITLE));
put('404.html', injectPwa(notFound, 'games', '/', SITE_TITLE));
put('offline.html', injectPwa(offline, 'games', '/', SITE_TITLE));
put('_headers', headers);
put('manifest.webmanifest', manifest(SITE_TITLE[DEFAULT_LANG], SITE_TITLE[DEFAULT_LANG], 'games', '/'));
{
  const set = iconSet('games', 'grid', [180, 192, 512], [512]);
  put('icon-180.png', set.get('180'));
  put('icon-192.png', set.get('192'));
  put('icon-512.png', set.get('512'));
  put('icon-mask.png', set.get('512m'));
}

for (const a of apps) {
  const base = `/${a.slug}/`;
  // A disabled app's source is never uploaded, so "off" means genuinely absent
  // from the deploy rather than merely unlinked. The slug still resolves, with
  // an explanation, instead of a 404.
  const appName = Object.fromEntries(LANGS.map((l) => [l, pick(a.meta.title, l, `${a.slug}.title`)]));
  put(`${a.slug}/index.html`, injectPwa(a.enabled ? a.source : unavailable, a.slug, base, appName));
  if (!a.enabled) continue;
  put(`${a.slug}/manifest.webmanifest`, manifest(
    pick(a.meta.title, DEFAULT_LANG, a.slug), pick(a.meta.title, DEFAULT_LANG, a.slug), a.slug, base));
  const set = iconSet(a.slug, a.glyph, [180, 192, 512], [512]);
  put(`${a.slug}/icon-180.png`, set.get('180'));
  put(`${a.slug}/icon-192.png`, set.get('192'));
  put(`${a.slug}/icon-512.png`, set.get('512'));
  put(`${a.slug}/icon-mask.png`, set.get('512m'));
}

// The cache name is derived from the deployed bytes, so a deploy that changes
// nothing does not churn caches, and one that changes anything invalidates all
// of them.
const version = createHash('sha256')
  .update(written.filter((f) => f !== '_headers').sort().map((f) => f + ':' + createHash('sha256').update(readFileSync(join(dist, f))).digest('hex')).join('\n'))
  .digest('hex').slice(0, 12);

// Precache the SHELL ONLY — never the games.
//
// Precaching every app made a first visit download the whole catalogue: at 150
// games that was 6.7 MB before the landing page had settled, and it grows
// linearly. A game is cached by the fetch handler the first time it is opened,
// which is the only way anyone plays it anyway, so offline still works for
// everything you have actually used and costs nothing for what you have not.
//
// Deduplicated: Cache.addAll rejects outright if the list contains the same URL
// twice, and that one duplicate fails the whole install, leaving the site
// permanently uncacheable.
const SHELL = ['index.html', 'offline.html', 'manifest.webmanifest',
               'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-mask.png'];
const precache = [...new Set([
  '/', '/offline.html',
  ...SHELL.filter((f) => f !== 'index.html' && f !== 'offline.html' && written.includes(f)).map((f) => '/' + f),
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
