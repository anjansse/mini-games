# Contributing a game

Every game here is **one HTML file** that runs in the browser with no backend,
no build step of its own and no framework. Open it from the site, from a git
clone, or from a USB stick on a plane and it behaves the same.

That constraint is what keeps a few hundred games cheap to host, fast to load
and possible to maintain from a phone. Everything below exists to protect it.

## Quick start

```sh
git clone https://github.com/anjansse/mini-games
cd mini-games
cp .claude/skills/new-app/boilerplate.html apps/<slug>/index.html
```

Then write `apps/<slug>/meta.json`, add the slug to `config/apps.json` with
`"enabled": false`, and run:

```sh
node scripts/build.mjs          # builds, and fails loudly on any violation
node scripts/build.mjs --check  # validate only
```

No dependencies to install. If the build is green, the deploy will be.

Easier still: ask Claude for a new game in a session and the `new-app` skill
does all of this for you.

## The rules the build enforces

A violation fails the build rather than shipping a broken page.

| Rule | Why |
| --- | --- |
| One `index.html`, plus `meta.json`. No other files. | A single file is what makes offline, local-clone and simple caching all work at once. |
| No `window.claude`, `claude.use()`, `window.storage`, `api.anthropic.com`. | Claude-runtime APIs only exist inside a Claude artifact. Here they are dead code that throws. |
| External hosts limited to `cdnjs.cloudflare.com` and Google Fonts. | Anything else is a third party that can disappear, track your players, or break offline. |
| A `viewport` meta tag. | Most players are on a phone. |
| `prefers-color-scheme` support. | Half of them are in dark mode. |
| Literal `</head>` and `</body>`. | The build injects the manifest, icons, service worker and install prompt there. |
| `index.html` under **250 kB** (warns past 120 kB). | It is served on mobile data and cached whole. |
| Multilingual apps must use the shared `jnssn-lang` runtime. | Otherwise the site-wide language toggle cannot reach them. |
| `icon` must name a known mark. | The build rasterises it; an arbitrary emoji cannot be rendered without a font engine. |

## meta.json

```json
{
  "title":       { "en": "Tip splitter", "fr": "Partage d'addition" },
  "description": { "en": "One plain line. It shows on the landing page.",
                   "fr": "Une ligne simple." },
  "languages":   ["en", "fr"],
  "created":     "2026-09-20",
  "icon":        "calc"
}
```

Any user-facing string is a plain string or an object keyed by language. A
missing translation warns and falls back to the default language.

`icon` names one of the marks in `scripts/icon.mjs` — currently `spade`,
`heart`, `diamond`, `club`, `cards`, `dice`, `star`, `clock`, `list`, `grid`,
`target`, `bolt`, `flag`, `trophy`, `pencil`, `book`, `note`, `mark`. The build
rasterises it into PNG icons, tinted by a hue derived from the slug. Adding a
new mark means adding a filled 24×24 SVG path to `GLYPHS`; prefer reusing one,
so the set stays coherent.

## Writing an efficient app

**Ship nothing you do not need.** No jQuery for a click handler, no React for a
counter, no icon font for three glyphs. Inline SVG is almost always smaller than
a dependency. The budget is 250 kB, and most games should be nowhere near it.

**Re-render from state.** Rebuilding the whole view on every change is fine at
this size and removes a class of bugs. Two things keep it safe: escape anything
the user typed before it reaches `innerHTML`, and delegate events from
`document` so a re-render never orphans a listener.

**Do the expensive thing once.** If a value depends only on inputs that have not
changed, cache it. The build does exactly this for icons: they are memoised on
appearance rather than on app, so its cost scales with how many *different*
icons exist, not with how many games.

**Never precache what nobody asked for.** The service worker caches a game the
first time it is opened. Do not add your game to the precache list — at 150
games that turned a first visit into a 6.7 MB download.

**Guard every `localStorage` access.** It throws in private browsing and returns
`null` once site data is cleared. The app must still work.

```js
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
```

**Keep the main thread free.** No layout thrash in a loop, no `setInterval` that
runs when nothing is moving, and respect `prefers-reduced-motion`.

## Translations

The site is English and French. Strings live in one dictionary in the app, never
inline in the markup.

**Use `Intl.PluralRules` for anything counted.** It implements the Unicode CLDR
plural rules and is built into every browser at zero cost. Do not hand-roll
`n > 1`: French counts 0 and 1 as singular (*0 carte*, *1 carte*, *2 cartes*)
while English counts only 1 (*0 cards*, *1 card*), and other languages have up
to six categories.

```js
var forms = { one:'carte', other:'cartes' };
var cat = new Intl.PluralRules('fr').select(n);
return n + ' ' + (forms[cat] || forms.other);
```

Use `Intl.NumberFormat` and `Intl.DateTimeFormat` for numbers and dates rather
than formatting them by hand.

The full standard for message formatting is **ICU MessageFormat**, and Mozilla's
**Fluent** is the modern alternative. Both need a runtime library, which would
break the single-file rule, so we use the part of the standard the platform
already gives us — CLDR plural categories via `Intl` — with a plain dictionary
on top. If an app ever genuinely needs gender, ordinals or nested selects, that
is the moment to reconsider, not before.

Translate meaning, not words. If you are not fluent, say so in the pull request
so a native speaker can check it — especially domain jargon, where a literal
translation is usually wrong.

## Before you open a pull request

- 390px wide: no horizontal scroll.
- Both colour schemes.
- Both languages, switching **mid-task** — state must survive.
- Reload: state restored.
- Offline, after one online visit.
- Console clean.
- `node scripts/build.mjs` green.

## Commits

Conventional Commits, imperative, lowercase subject:

```
feat(apps): add tip-split
fix(rikiki): dealer could bid the forbidden number
build: memoise icon rendering
docs: ...
```

New games are registered **disabled**. They go live when Antoine enables them.
