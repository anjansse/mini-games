# mini-games — a phone-driven static app platform

Small self-contained browser games, one directory each, published to
**https://games.jnssn.io/&lt;slug&gt;/** by Cloudflare Pages on every push to `main`.

Antoine works from an iPhone. Every routine operation here must be doable by
sending a message in a remote session — never assume a laptop, a terminal, or a
local checkout.

---

## Repo layout

```
apps/<slug>/index.html     one self-contained app, single file, no siblings
apps/<slug>/meta.json      title, description, languages, created date
config/apps.json           single source of truth for routing and flags
site/index.html            GENERATED landing page — never hand-edit
scripts/build.mjs          generates site/index.html and dist/
scripts/icon.mjs           rasterises home-screen icons to PNG, no dependencies
CONTRIBUTING.md            what contributors need; keep it in step with the build
dist/                      GENERATED deploy output — git-ignored
.claude/settings.json      points at the anjansse/claude-skills marketplace
.claude/skills/new-app/    skill that scaffolds a new app
```

`site/index.html` and `dist/` are build output. Change `config/apps.json` or a
`meta.json` and re-run the build; never edit the generated files by hand.

## How a URL resolves

`scripts/build.mjs` copies `apps/<slug>/index.html` to `dist/<slug>/index.html`.
There are no redirects and no rewrite rules — the deployed tree already has the
right shape. That is deliberate: redirect rules are the thing that silently
breaks and is hardest to debug from a phone.

A **disabled** app is not uploaded at all. Its slug still resolves, to a small
"switched off" page, so links never 404. The source stays in the repo.

Unknown paths get `dist/404.html`, which links back to the index.

## The UI kit

`scripts/ui.mjs` is the single source of truth for tokens, components, motion
and the small runtime (`UI.setText`, `UI.screen`, `UI.toast`, `UI.icon`...).

Apps **carry a copy inline**, between `jnssn-ui` fences, rather than linking it
— the same reasoning as the language runtime: the single-file rule holds, and
opening `apps/<slug>/index.html` from a bare clone still works.

```sh
node scripts/build.mjs --sync-ui   # rewrite the fenced blocks in every app
                                   # and in the scaffold boilerplate
```

Nothing else may write inside the fences. A normal build fails on drift, which
is the only thing standing between one design system and five. App-specific CSS
goes below the fence, built from the tokens.

`--accent` is derived from the slug's hue, the same one that colours the icon
and `theme-color`, so nobody picks a colour per app. Red and green stay reserved
for `--pos` / `--neg`; an app whose hue lands in the red band (rikiki is 352)
would otherwise have its accent read as a failure state.

**The render rule:** markup is written once in HTML and the nodes that change
are patched. Never `innerHTML` a whole screen on a tap — it throws away focus,
scroll position and screen-reader context, and makes animation impossible.

The contributor-facing version of all this is in `CONTRIBUTING.md`. Change one
and change the other.

## App conventions

How to write the file itself — the single-file rule, guarded `localStorage`,
light/dark tokens, phone layout, i18n, service workers — lives in the
**`self-contained-html`** skill, from the `self-contained-web` plugin in
[anjansse/claude-skills](https://github.com/anjansse/claude-skills). Read it
before writing an app. What follows is only what this repo enforces.

The build validates every app and fails rather than shipping a broken page:

1. **One file**, `apps/<slug>/index.html`. No sibling assets. `meta.json` is the
   only other file in the directory.
2. **No Claude-runtime APIs**: `window.claude`, `claude.use(...)`,
   `window.storage`, `api.anthropic.com`.
3. **No external hosts** except `cdnjs.cloudflare.com` and
   `fonts.googleapis.com` / `fonts.gstatic.com`.
4. A **`viewport`** meta tag.
5. **`prefers-color-scheme`** support.
6. Literal **`</head>` and `</body>`** tags — the build injects the PWA plumbing
   at those points.
7. If `meta.json` declares more than one language, the app must use the shared
   **`jnssn-lang`** runtime, or the site-wide toggle cannot reach it.
8. `index.html` under **250 kB**, with a warning past 120 kB.
9. `meta.json`'s `icon` must name a mark defined in `scripts/icon.mjs`.
10. The **UI kit block** must match `scripts/ui.mjs`. Drift is a hard error;
    absence is a warning until every app is migrated.

`CONTRIBUTING.md` is the contributor-facing version of this list. Change one and
change the other.

Slugs: lowercase, digits, single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`).
Reserved: `index`, `assets`, `404`, `sw`, `offline`, `manifest`, `icon`,
`_headers`, `_redirects`.

## Languages

The site is English and French. `config/apps.json` sets `site.languages` and
`site.defaultLanguage`; any user-facing string in `config/apps.json` or a
`meta.json` is either a plain string or an object keyed by language:

```json
"title": { "en": "Games", "fr": "Jeux" }
```

A missing translation warns and falls back to the default language.

The chosen language is stored under the origin-wide key **`jnssn-lang`**, so
switching it anywhere — the index or any game — applies everywhere. The initial
value comes from that key, then `navigator.languages`, then the default.

Anything **counted** must go through `Intl.PluralRules`, which implements the
Unicode CLDR plural rules natively. Never hand-roll `n > 1`: French counts 0 and
1 as singular, English counts only 1, and other languages have up to six
categories. The full standard is ICU MessageFormat, and Fluent is the modern
alternative, but both need a runtime library that would break the single-file
rule — so we use the part of the standard the platform already provides.

The landing page renders every language as sibling elements and hides the
non-matching ones in CSS. It hides `[data-l]:not([data-l="<lang>"])` rather than
hiding all and revealing the match, because `display:revert` would reset the
element to the UA default and discard rules like `.t{display:block}`.

Apps carry their own copy of the language runtime rather than having it
injected, so that opening `apps/<slug>/index.html` from a git clone still works.

Past 12 enabled games the landing page grows a search box. It filters
already-rendered cards against the **visible** language only, accent-insensitively,
so a French search never matches English text the reader cannot see.

## Offline and Add to Home Screen

Every page is covered by a service worker at `/sw.js`, generated by the build:

- **The shell only is precached** — never the games. Precaching every app made
  a first visit download the whole catalogue: at 150 games that was 6.7 MB
  before the landing page had settled, growing linearly. A game is cached by
  the fetch handler the first time it is opened, which is the only way anyone
  plays it, so offline works for everything actually used and costs nothing for
  everything else. Precache is now ~7 entries regardless of catalogue size.
  **Do not add apps back to it.**
- **Network-first for pages**, so a deploy is live immediately and the cache
  only rescues a request the network could not answer. A stale cached page on a
  phone is very hard to clear, which is why this is not stale-while-revalidate.
- **Cache-first for icons, manifests and fonts**, which never change under a
  given URL.
- The cache name is a hash of the deployed bytes. A deploy that changes nothing
  leaves caches alone; one that changes anything invalidates them, and
  `activate` deletes every other cache.
- `caches.addAll` **rejects if the precache list contains a duplicate URL**, and
  that one duplicate fails the whole install and leaves the site uncached. The
  build deduplicates the list. Do not remove that.

Each app also gets a web app manifest (`display: standalone`) and PNG icons.
The icons are PNG rather than SVG because **iOS ignores SVG for
`apple-touch-icon`** and falls back to a screenshot of the page.

`scripts/icon.mjs` fills a named 24x24 SVG path from `GLYPHS` over a tile tinted
by a hue derived from the slug. It rasterises **one 512px master per appearance**
and box-filters every smaller size down from it, and memoises on
`glyph|hue|maskable` rather than on slug — so build cost scales with the number
of *distinct* icons (at most `GLYPHS x HUES x 2`), not with the number of apps.
At 151 games that is the difference between 94 ms and 12 ms per app.

Every page carries a dismissible **Add to Home Screen** prompt, because nothing
in Safari hints that the feature exists and most players will not find it. iOS
has no `beforeinstallprompt`, so there it shows the Share glyph and where to
find it; on Android it captures the real prompt and offers a one-tap button. It
asks once, remembers a dismissal under `jnssn-a2hs`, and never appears once the
app is installed.

A dismissal suppresses the **banner**, not the feature. The build also exposes
`window.JInstall` — `can()`, `show()`, `installed()`, plus a `jinstallchange`
event — and the landing page carries a standing button built on it. Before that,
one tap on "Not now" removed the only route to installing, permanently, which is
the actual reason someone never ends up with the app on their phone.

**There is no way to install from a button on iOS.** Safari has never
implemented `beforeinstallprompt` or any programmatic install; `JInstall.show()`
can only display the Share instructions there. Do not write UI copy promising a
one-tap install — on Android it is true, on iPhone it is not, and iPhone is the
platform these are played on.

Add to Home Screen from Safari gives a real offline app. Installed web apps are
also exempt from iOS's 7-day storage eviction, so saved games survive there when
they would not in a plain tab.

There is **no way to import an HTML file into the Claude app as an artifact**.
Artifacts are created by Claude in a conversation, and re-creating one needs
network, which defeats the purpose. Add to Home Screen is the offline story.

## config/apps.json

```json
{
  "site": {
    "title": { "en": "Games", "fr": "Jeux" },
    "tagline": { "en": "...", "fr": "..." },
    "domain": "games.jnssn.io",
    "languages": ["en", "fr"],
    "defaultLanguage": "en"
  },
  "apps": [ { "slug": "rikiki", "enabled": true } ]
}
```

An app appears on the landing page only when `enabled` is `true`. Array order is
the order on the landing page.

## Build

```sh
node scripts/build.mjs          # write site/index.html and dist/
node scripts/build.mjs --check  # validate only, write nothing
```

No dependencies, no install step. Always run it before committing — a red build
locally is a red deploy on Pages.

### Measured at 151 games

| | Before the efficiency pass | Now |
| --- | --- | --- |
| Build | 12.1 s | 5.1 s |
| First-visit precache | 6.7 MB, grows per app | 93 kB, constant |
| Landing page | 62 kB raw | 72 kB raw, **5 kB brotli** |
| Icon cost | 94 ms/app | 12 ms/app |

Re-measure before assuming a change is cheap. Stage synthetic apps, build, and
read `PRECACHE` out of `dist/sw.js` — that number is the one that bites, because
every visitor pays it.

## Deploy

**Two** Cloudflare Pages projects, both connected to this repo, differing only
in which branch they treat as production.

| | Live | Dev |
| --- | --- | --- |
| Pages project | `mini-games` | `mini-games-dev` |
| Production branch | `main` | `dev` |
| Custom domain | `games.jnssn.io` | `games-dev.jnssn.io` |
| Build command | `node scripts/build.mjs` | `node scripts/build.mjs` |
| Build output directory | `dist` | `dist` |
| Root directory | *(blank)* | *(blank)* |
| Preview deployments | None | None |

Push to `dev` → `games-dev.jnssn.io` updates. Merge `dev` into `main` →
`games.jnssn.io` updates. **Roughly 30–60 seconds** from push to live, plus a
few seconds of CDN propagation.

Set **Preview deployments: None** on both projects. Otherwise every push to
every branch builds twice, once per project, for a URL nobody reads.

### Why two projects rather than one branch alias

The obvious approach — point `games-dev` at a branch alias like
`dev.mini-games.pages.dev` — **does not work**, and it is worth writing down so
nobody spends an evening on it.

Pages routes a preview deployment by the hostname in the request. A request
arriving at the alias with `Host: games-dev.jnssn.io` is a host that project
does not recognise, so it does not serve the branch build. Custom domains on
Pages attach to production, not to a preview branch; there is no dashboard
setting for it. The workarounds are a Worker that rewrites the `Host` header, or
Access-style routing — both are code that can break, in front of the whole site.

A second Pages project makes `dev` a *production* branch of its own. The custom
domain is then completely ordinary: Universal SSL, one DNS record, no Worker, no
header rewriting, and a bug in one project cannot take the other down. Both
projects fit the free tier.

The cost is that the two projects' settings must be kept identical apart from
the branch. They are both in the table above; change one and change the other.

## Turning an app on or off

Ask, in a session:

> Enable `rikiki`.  ·  Disable `rikiki`.

That flips `enabled` in `config/apps.json`, rebuilds, commits and pushes. Live
within about a minute. There is no dashboard step.

### Moving flags to Workers KV (not built — notes only)

Today a toggle costs a deploy, so it is ~60 seconds rather than instant. Making
it instant would need, all on free tiers:

- A KV namespace holding `enabled:<slug>` per app.
- A Pages Function at `functions/[slug]/index.js` that reads the KV value on
  request and serves either the app or the unavailable page. Requires the app
  HTML to be readable from the Function — either bundled in as a string at build
  time, or moved behind the Function via the ASSETS binding.
- A tiny authenticated admin route, or toggling via the Cloudflare dashboard's
  KV editor on the phone, or `wrangler kv key put` from a session.

Cost: £0 (KV free tier is 100k reads/day; Pages Functions 100k req/day). The
real cost is complexity — every request becomes dynamic, caching gets weaker,
the service worker's network-first story gets murkier, and a Function bug takes
the whole site down rather than one app. Not worth it until toggling becomes
frequent and latency-sensitive.

## Shared skills

Generic, repo-independent skills live in
[anjansse/claude-skills](https://github.com/anjansse/claude-skills), consumed as
a **plugin marketplace** and wired up in `.claude/settings.json`. Not a
submodule: there is no pointer to bump, nothing extra to clone, and nothing that
can fail a Pages build.

`new-app` stays here, because it is entirely about this repo — slugs,
`config/apps.json`, the build, the commit convention. Only the craft of writing
a single-file app is shared.

## Commits

Work lands on `dev` first, is checked at `games-dev.jnssn.io`, and reaches
players by merging `dev` into `main`. `dev` is never reset or force-pushed —
`main` is only ever behind it, never divergent.

```sh
git switch dev && git push -u origin dev     # -> games-dev.jnssn.io
git switch main && git merge dev && git push # -> games.jnssn.io
```

Conventional Commits, imperative, lowercase subject:

```
feat(apps): add <slug>
fix(<slug>): <what broke>
chore(config): enable <slug>
chore(config): disable <slug>
docs: <what>
build: <change to scripts/build.mjs>
```

Push to `main` directly (authorised by Antoine for this repo). One logical change
per commit.

---

## PROTECTED DNS RECORDS — do not touch

`jnssn.io` is registered with Cloudflare Registrar and carries **iCloud Mail**
via Apple's Custom Email Domain. These records are read-only. Never modify,
delete, re-order, or proxy them. Proxying any of them (orange cloud) breaks mail
delivery, because Cloudflare's proxy only handles HTTP.

| Name | Type | Value | Proxy |
| --- | --- | --- | --- |
| `jnssn.io` | MX | `mx01.mail.icloud.com` (priority 10) | n/a |
| `jnssn.io` | MX | `mx02.mail.icloud.com` (priority 10) | n/a |
| `jnssn.io` | TXT | `v=spf1 include:icloud.com ~all` | n/a |
| `jnssn.io` | TXT | `apple-domain=qg8zUWJCYHuroy7V` | n/a |
| `sig1._domainkey.jnssn.io` | CNAME | `sig1.dkim.jnssn.io.at.icloudmailadmin.com` | **DNS only** |

The only records this project needs:

| Name | Type | Value | Proxy |
| --- | --- | --- | --- |
| `games` | CNAME | `mini-games.pages.dev` | Proxied |
| `games-dev` | CNAME | `mini-games-dev.pages.dev` | Proxied |

Both are their own labels and cannot collide with the mail records: the MX and
SPF records sit at the zone apex (`jnssn.io`), and DKIM sits at
`sig1._domainkey`. A CNAME at `games` or `games-dev` does not shadow the apex
and does not affect mail routing. Adding the hostname as a Pages custom domain
normally creates the record automatically, since the zone is in the same
Cloudflare account.

The site previously lived at `apps.jnssn.io`. That custom domain and its DNS
record were retired; the same reasoning applies to any future label.

Verify mail records are intact at any time:

```sh
for q in "jnssn.io/MX" "jnssn.io/TXT" "sig1._domainkey.jnssn.io/CNAME"; do
  curl -s -H 'accept: application/dns-json' \
    "https://cloudflare-dns.com/dns-query?name=${q%/*}&type=${q#*/}"
done
```

---

## Troubleshooting a failed deploy

Check the Cloudflare dashboard → Workers & Pages → `mini-games` → Deployments,
and open the failed one's build log. From a phone, ask in a session instead and
the checks below can be run here.

**Build fails with `✗ <slug>: ...`** — the app broke a convention. The message
names the rule. Fix the app, re-run `node scripts/build.mjs`, push.

**Build fails with `config/apps.json is missing or has no "apps" array`** —
invalid JSON, usually a trailing comma. `node -e 'JSON.parse(require("fs").readFileSync("config/apps.json"))'`.

**"No build command" / site shows the repo file listing** — the Pages project
lost its build settings. Re-check the deploy table above; output directory must
be `dist`, not blank and not `/`.

**Deploy succeeds but the app 404s** — the slug is not in `config/apps.json`.
The build warns `apps/<slug>/ is not listed in config/apps.json`. Register it.

**Deploy succeeds but shows the "switched off" page** — `enabled` is `false`.

**Deploy succeeds but the page is stale** — pages are network-first, so this
should not happen once online. If it persists, the service worker is stuck:
Safari → Settings → Advanced → Website Data → remove `games.jnssn.io`, which
drops the cache and the registration. Saved games are removed with it, so only
do this when something is genuinely broken.

**An app works online but not offline** — the service worker failed to install.
Almost always `caches.addAll` rejecting: a precached URL 404s, or the list
contains a duplicate. Check `dist/sw.js`'s `PRECACHE` against `dist/`.

**`games.jnssn.io` does not resolve / SSL error** — the custom domain is not
attached, or the certificate is still issuing (up to ~15 minutes on first
setup). Check Pages → `mini-games` → Custom domains.

**Never** "fix" a deploy by touching DNS records other than `games`.
