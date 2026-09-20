# mini-games

Small self-contained browser apps, published to **https://games.jnssn.io**.

One directory per app under `apps/`, each a single HTML file that runs entirely
in the browser with no backend and no build step of its own. Cloudflare Pages
deploys on every push to `main`. Apps can be switched on and off from
`config/apps.json` without deleting anything.

Everything here is driven from a phone by messaging Claude in a remote session:
new apps, edits, toggles. Each game also works with no network: a service worker
caches it, and Add to Home Screen from Safari turns it into a real offline app.
Or clone the repo and open any `apps/<slug>/index.html` directly — which is the
point of keeping each app to one file.

| | |
| --- | --- |
| Live | https://games.jnssn.io |
| Conventions, DNS, troubleshooting | [`CLAUDE.md`](CLAUDE.md) |
| Adding a game | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Routing and on/off flags | [`config/apps.json`](config/apps.json) |
| Build | `node scripts/build.mjs` |

## Apps

| Slug | What it is |
| --- | --- |
| [`rikiki`](apps/rikiki/) | Score sheet for the card game Rikiki — bids, tricks, points, game history. English and French. |
