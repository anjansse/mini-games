#!/usr/bin/env node
// Generates site/index.html and the Cloudflare Pages deploy tree from
// config/apps.json. Zero dependencies: Pages runs it with a bare `node`.
//
//   node scripts/build.mjs          build site/index.html and dist/
//   node scripts/build.mjs --check  validate only, write nothing
//   node scripts/build.mjs --sync-ui  rewrite every app's UI kit block
//
// Anything that would ship a broken site is a hard error here. See CLAUDE.md.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { iconSet, themeColor, GLYPHS, GLYPH_NAMES, defaultGlyph } from './icon.mjs';
import { syncSource, isCurrent, uiVersion, tokens, UI_CSS, UI_JS, FONT_LINK, THEME_RUNTIME } from './ui.mjs';

const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const SYNC_UI = process.argv.includes('--sync-ui');

// Runs before validation on purpose: a stale copy should be fixable with one
// command rather than having to satisfy the validator first.
if (SYNC_UI) {
  const targets = [];
  const appsDir = join(ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const d of readdirSync(appsDir)) {
      const f = join(appsDir, d, 'index.html');
      if (existsSync(f)) targets.push({ file: f, slug: d, label: `apps/${d}/index.html` });
    }
  }
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

// A user-facing string is a plain string, or an object keyed by language code.
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
  // xmlns="http://www.w3.org/2000/svg" names a namespace and is never fetched,
  // so it is stripped before the host scan rather than failing the build.
  const fetched = source.replace(/xmlns(?::[\w-]+)?\s*=\s*(["'])[^"']*\1/gi, '');
  for (const host of new Set([...fetched.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))) {
    if (!ALLOWED_HOSTS.includes(host)) fail(`${slug}: references ${host}, which is not on the allowlist (${ALLOWED_HOSTS.join(', ')}).`);
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(source)) fail(`${slug}: no viewport meta tag; it will not be responsive on a phone.`);
  if (!/prefers-color-scheme/.test(source)) fail(`${slug}: does not respond to prefers-color-scheme.`);
  if (!/<\/head>/i.test(source) || !/<\/body>/i.test(source)) fail(`${slug}: needs literal </head> and </body> tags; the build injects the PWA plumbing there.`);
  if (meta.icon && !GLYPHS[meta.icon]) {
    fail(`${slug}: meta.json icon "${meta.icon}" is not a known mark. Pick one of: ${GLYPH_NAMES.join(', ')}.`);
  }
  const KB = Buffer.byteLength(source) / 1024;
  if (KB > 250) fail(`${slug}: index.html is ${KB.toFixed(0)} kB, over the 250 kB budget. Inline less, or split the work.`);
  else if (KB > 120) warnings.push(`${slug}: index.html is ${KB.toFixed(0)} kB; the 250 kB budget is close.`);

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
              glyph: meta.icon || defaultGlyph(slug), bareIcon: meta.bareIcon === true,
              bytes: Buffer.byteLength(source) });
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

// Language is chosen once for the whole origin; every page reads the same key.
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

const SHELL_CSS = `
${tokens(null)}
${UI_CSS}

.head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
h1{font-size:34px}
.tagline{color:var(--dim);font-size:15.5px;margin:8px 2px 22px;max-width:36ch}

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
.install{margin-top:18px}

.mid{text-align:center;padding-top:10vh}
.mid h1{font-size:30px}
.mid p{margin:12px auto 0;max-width:34ch;color:var(--dim)}
.back{display:inline-flex;align-items:center;justify-content:center;gap:8px;margin-top:26px;
  min-height:54px;padding:0 22px;border-radius:var(--r);background:var(--accent);color:var(--accent-ink);
  text-decoration:none;font-weight:600;box-shadow:var(--lift);
  transition:transform var(--fast) var(--spring)}
.back:active{transform:scale(.972)}

/* Hide the variants that do NOT match. Revealing the match with
   display:revert would reset it to the UA default and discard .t{display:block}. */
${LANGS.map((l) => `html[lang="${l}"] [data-l]:not([data-l="${l}"]){display:none}`).join('\n')}
`.trim();

const FONTS = FONT_LINK;

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

${THEME_RUNTIME}
</script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<main class="wrap">
${body}
</main>
<script>
${UI_JS}
${LANG_TOGGLE_JS}
(function(){
  var slot=document.getElementById('langslot');
  if(slot) slot.innerHTML=langBar();
  window.addEventListener('jlangchange',function(){ if(slot) slot.innerHTML=langBar(); });
  UI.themeButton(document.getElementById('theme'));
})();${extraJs ? '\n' + extraJs : ''}
</script>
</body>
</html>
`;
}

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

// Past a screenful a flat list stops being usable. Plain DOM over the cards
// already rendered: no index to build, no data shipped twice.
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

const installJsLanding = `
(function(){
  var b=document.getElementById('install'); if(!b) return;
  var S=${JSON.stringify(INSTALL_STRINGS)};
  function lang(){ return (window.JLang&&window.JLang.get())||document.documentElement.lang||'${DEFAULT_LANG}'; }
  function paint(){
    var ok = window.JInstall && window.JInstall.can();
    b.hidden = !ok;
    if(ok) b.textContent=(S[lang()]||S.en).add;
  }
  b.addEventListener('click',function(){ if(window.JInstall) window.JInstall.show(); });
  document.addEventListener('jinstallchange', paint);
  window.addEventListener('jlangchange', paint);
  paint();
})();`;

const landing = page({
  title: SITE_TITLE[DEFAULT_LANG],
  description: SITE_TAGLINE[DEFAULT_LANG],
  extraJs: filterJs + installJsLanding,
  body: `<div class="head">
  <h1>${ml('span', SITE_TITLE)}</h1>
  <div class="chrome">
    <div class="seg" id="langslot" role="group" aria-label="Language"></div>
    <button class="act" type="button" id="theme" aria-label="Theme"></button>
  </div>
</div>
<p class="tagline">${ml('span', SITE_TAGLINE)}</p>
${filterMarkup}<div class="card list" id="list">
${cards}
</div>
<p class="empty" id="none" hidden>${esc(NONE[DEFAULT_LANG])}</p>
<button class="btn ghost install" id="install" hidden></button>
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

// Silent and non-fatal: opening the file from a git clone (file://) throws here.
const SW_REGISTER = `
<script>
if('serviceWorker' in navigator) window.addEventListener('load',function(){
  navigator.serviceWorker.register('/sw.js').catch(function(){});
});
</script>`;

// iOS has no beforeinstallprompt, so there the most any UI can do is show the
// Share glyph and where it is. Never promise a one-tap install on iPhone.
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

function installJs(iconHref, nameByLang) {
  return `
<script>
(function(){
  var KEY='jnssn-a2hs', S=${JSON.stringify(INSTALL_STRINGS)}, NAME=${JSON.stringify(nameByLang)};
  function lang(){ return (window.JLang && window.JLang.get()) || document.documentElement.lang || 'en'; }
  function tx(k){ return (S[lang()]||S.en)[k]; }
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
           || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);

  function dismissed(){ try{ return localStorage.getItem(KEY)==='no'; }catch(e){ return false; } }
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

  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault(); deferred=e;
    announce();
    if(!standalone && !dismissed()) show();
  });
  window.addEventListener('appinstalled', function(){ standalone=true; dismiss(); announce(); });
  if(isIOS && !standalone && !dismissed()) setTimeout(show, 2500);

  function announce(){
    document.dispatchEvent(new CustomEvent('jinstallchange'));
  }
  window.JInstall = {
    installed: function(){ return standalone; },
    can: function(){ return !standalone && (!!deferred || isIOS); },
    show: function(){
      if(standalone) return;
      if(deferred){
        var d=deferred; deferred=null;
        d.prompt();
        d.userChoice.then(announce, announce);
        return;
      }
      if(el){ el.classList.add('on'); return; }
      show();
    }
  };
  announce();
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
  // A disabled app's source is never uploaded, so "off" is genuinely absent
  // from the deploy. The slug still resolves, to an explanation, not a 404.
  const base = `/${a.slug}/`;
  const appName = Object.fromEntries(LANGS.map((l) => [l, pick(a.meta.title, l, `${a.slug}.title`)]));
  put(`${a.slug}/index.html`, injectPwa(a.enabled ? a.source : unavailable, a.slug, base, appName));
  if (!a.enabled) continue;
  put(`${a.slug}/manifest.webmanifest`, manifest(
    pick(a.meta.title, DEFAULT_LANG, a.slug), pick(a.meta.title, DEFAULT_LANG, a.slug), a.slug, base));
  // 180 is apple-touch-icon and stays a solid tile: iOS fills transparency
  // with black, so bare there swaps our tile for the OS's rather than removing it.
  const set = iconSet(a.slug, a.glyph, [180, 192, 512], [512], a.bareIcon ? [192, 512] : []);
  put(`${a.slug}/icon-180.png`, set.get('180'));
  put(`${a.slug}/icon-192.png`, set.get('192'));
  put(`${a.slug}/icon-512.png`, set.get('512'));
  put(`${a.slug}/icon-mask.png`, set.get('512m'));
}

// The cache name is a hash of the deployed bytes: a deploy that changes nothing
// leaves caches alone, one that changes anything invalidates them all.
const version = createHash('sha256')
  .update(written.filter((f) => f !== '_headers').sort().map((f) => f + ':' + createHash('sha256').update(readFileSync(join(dist, f))).digest('hex')).join('\n'))
  .digest('hex').slice(0, 12);

// The SHELL ONLY — never the games. A game is cached by the fetch handler the
// first time it is opened. Deduplicated, because Cache.addAll rejects outright
// on a repeated URL and that one duplicate leaves the site uncached.
// See CLAUDE.md, "Offline and Add to Home Screen". Do not add apps back here.
const SHELL = ['index.html', 'offline.html', 'manifest.webmanifest',
               'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-mask.png'];
const precache = [...new Set([
  '/', '/offline.html',
  ...SHELL.filter((f) => f !== 'index.html' && f !== 'offline.html' && written.includes(f)).map((f) => '/' + f),
])];

// Network-first for pages so a deploy is live immediately; cache-first for
// icons, manifests and fonts, which never change under a given URL.
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

  if (!sameOrigin || /\\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

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
