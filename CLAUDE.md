# mini-games — a phone-driven static app platform

Small self-contained browser apps, one directory each, published to
**https://apps.jnssn.io/&lt;slug&gt;/** by Cloudflare Pages on every push to `main`.

Antoine works from an iPhone. Every routine operation here must be doable by
sending a message in a remote session — never assume a laptop, a terminal, or a
local checkout.

---

## Repo layout

```
apps/<slug>/index.html     one self-contained app, single file, no siblings
apps/<slug>/meta.json      title, description, created date, icon
config/apps.json           single source of truth for routing and flags
site/index.html            GENERATED landing page — never hand-edit
scripts/build.mjs          generates site/index.html and dist/
dist/                      GENERATED deploy output — git-ignored
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

## App conventions

Every app is validated by the build; a violation fails the build rather than
shipping a broken page. An app must:

1. Be **one file**, `apps/<slug>/index.html`. No sibling assets — inline CSS,
   JS, SVG and small images (data URIs). `meta.json` is the only other file.
2. Use **no Claude-runtime APIs**: `window.claude`, `claude.use(...)`,
   `window.storage`, `api.anthropic.com`. They only exist inside a Claude
   artifact and are dead code here.
3. Reference **no external hosts** except `cdnjs.cloudflare.com` (scripts) and
   `fonts.googleapis.com` / `fonts.gstatic.com` (stylesheets). Prefer inlining.
4. Be **responsive** — a `viewport` meta tag, a phone-width layout, tap targets
   ~44px or larger.
5. Respect **`prefers-color-scheme`**, with the light/dark token pattern used in
   `apps/rikiki/index.html`.
6. Keep state in **`localStorage` only**, every access wrapped in `try`/`catch`.
   It can throw or return empty in private browsing or with site data cleared;
   the app must still work. State is per-device and never syncs.
7. Have a `<a href="/">` link back to the index.

Slugs: lowercase, digits, single hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`).
`index`, `assets`, `404`, `_headers`, `_redirects` are reserved.

## config/apps.json

```json
{
  "site": { "title": "...", "tagline": "...", "domain": "apps.jnssn.io" },
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

## Deploy

Cloudflare Pages project `mini-games`, connected to this repo.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `node scripts/build.mjs` |
| Build output directory | `dist` |
| Root directory | *(blank)* |
| Custom domain | `apps.jnssn.io` |

Push to `main` → Pages builds and deploys. **Roughly 30–60 seconds** from push
to live, plus a few seconds of CDN propagation. Pushes to any other branch get a
preview URL and do not touch production.

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
and a Function bug takes the whole site down rather than one app. Not worth it
until toggling becomes frequent and latency-sensitive. Revisit if that happens.

## Commits

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

The only record this project needs:

| Name | Type | Value | Proxy |
| --- | --- | --- | --- |
| `apps` | CNAME | `mini-games.pages.dev` | Proxied |

`apps` is its own label and cannot collide with the mail records: the MX and SPF
records sit at the zone apex (`jnssn.io`), and DKIM sits at
`sig1._domainkey`. A CNAME at `apps` does not shadow the apex and does not
affect mail routing. Adding `apps.jnssn.io` as a Pages custom domain normally
creates this record automatically, since the zone is in the same Cloudflare
account.

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

**Deploy succeeds but the page is stale** — hard-refresh; HTML is sent
`must-revalidate` but iOS Safari caches aggressively. Add `?v=2` to confirm.

**`apps.jnssn.io` does not resolve / SSL error** — the custom domain is not
attached, or the certificate is still issuing (up to ~15 minutes on first
setup). Check Pages → `mini-games` → Custom domains.

**Never** "fix" a deploy by touching DNS records other than `apps`.
