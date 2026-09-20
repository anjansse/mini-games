---
name: new-app
description: Scaffold, register, commit and publish a new game or app in this repo. Use when Antoine asks for a new app, game, tool, calculator, tracker or page to live at games.jnssn.io — e.g. "make me a tip splitter", "new app: packing list", "build a dice roller". Also use when migrating an existing Claude artifact into this repo.
---

# new-app

Create one self-contained static app, register it disabled, push to `main`, and
hand back the URL plus the one-line command to switch it on.

Read `CLAUDE.md` first. It holds the app conventions, the commit format and the
protected DNS records. This skill does not repeat them.

For how to actually write the file — the single-file rule, guarded
`localStorage`, light/dark tokens, phone layout, i18n and plural rules — use the
`self-contained-html` skill from the `self-contained-web` plugin. This skill
covers only the repo mechanics around it.

## 1. Pick a slug

From what the app does, not from a brand name. Lowercase, digits, single
hyphens. Short: `tip-split`, `dice`, `packing`. Reject `index`, `assets`, `404`,
`_headers`, `_redirects`.

If the slug already exists in `config/apps.json`, do not overwrite it — pick a
different one, or ask whether to replace the existing app.

## 2. Scaffold

Copy `.claude/skills/new-app/boilerplate.html` to `apps/<slug>/index.html`, then
run `node scripts/build.mjs --sync-ui` so the kit picks up the slug's hue, and
build the app inside it.

The boilerplate already carries the shared UI kit, the app bar, two screens, a
settings sheet, the guarded `localStorage` helpers and the link home — keep that
structure and replace the demo content.

**Three things not to undo:**

- **Do not edit inside the `jnssn-ui` fences.** That block belongs to
  `scripts/ui.mjs`; the build fails on drift and `--sync-ui` overwrites it. App
  CSS goes below the fence, built from the tokens (`var(--accent)`,
  `var(--surface)`, `var(--r)`), never fresh hex values.
- **Do not rebuild screens with `innerHTML`.** Write the markup once in HTML and
  patch what changes with `UI.setText` / `UI.setAttr`, as `paint()` shows.
  Rebuilding loses focus, scroll and screen-reader context on every tap.
- **Do not hand-roll a top bar, a modal or an icon.** Use `.appbar`,
  `dialog.sheet` via `UI.openSheet`, and `UI.icon`. A game that invents its own
  is how the catalogue stops looking like one product.

The kit is documented in `CONTRIBUTING.md` under "The UI kit" — the component
list, the runtime API, and the conventions it already handles so you do not
re-solve them.

If the app genuinely needs a component the kit lacks, add it to
`scripts/ui.mjs` and run `--sync-ui`, so every app gets it.

Write `apps/<slug>/meta.json`. The schema and the full field table are in
`CONTRIBUTING.md`; the shape the build accepts is:

```json
{
  "title":       { "en": "Tip splitter", "fr": "Partage d'addition" },
  "description": { "en": "One line, plain, no marketing. It shows on the landing page.",
                   "fr": "Une ligne simple." },
  "languages":   ["en", "fr"],
  "created":     "YYYY-MM-DD",
  "icon":        "cards"
}
```

`title`, `description` and `created` are required. Each user-facing string is a
plain string or an object keyed by language code.

`icon` is a **named mark** from `GLYPHS` in `scripts/icon.mjs` — `spade`,
`heart`, `diamond`, `club`, `cards`, `dice`, `star`, `clock`, `list`, `grid`,
`target`, `bolt`, `flag`, `trophy`, `pencil`, `book`, `note`, `mark`. Not an
emoji, not an arbitrary character: the build rejects those, because rendering
one to PNG would need a font engine. Omit it and one is derived from the slug.

`languages` defaults to `["en"]`. Declaring more than one means the app must
keep the boilerplate's `jnssn-lang` runtime, or the build fails.

### Migrating a Claude artifact

Artifacts often use `window.claude.use('db')`, `window.claude.use('user')` or
`window.storage`. None of them exist on Pages. Strip the whole remote layer and
keep the `localStorage` path. Then tell Antoine, in the reply, exactly what
behaviour was lost — usually cross-device sync — rather than letting him find
out when a game vanishes.

## 3. Register it

Append to `apps` in `config/apps.json`:

```json
{ "slug": "<slug>", "enabled": false }
```

**Disabled by default, always.** It goes live only when Antoine asks.

Anything counted must use `Intl.PluralRules`, never a hand-rolled `n > 1`. See
`CONTRIBUTING.md`.

## 4. Validate

```sh
node scripts/build.mjs
```

Must exit 0. If it reports a violation, fix the app — never weaken the check in
`scripts/build.mjs` to get past it. `node scripts/build.mjs --check` validates
without writing, if you only want the verdict.

Then walk the test checklist in `CONTRIBUTING.md` — 390px, both colour schemes,
both languages switching mid-task, reload, offline, clean console. The build
checks conventions, not whether the game works.

A new app is disabled, so it will show as `○ off` and will not appear on the
landing page. That is correct.

## 5. Commit and push

```sh
git add apps/<slug> config/apps.json site/index.html
git commit -m "feat(apps): add <slug>"
git push -u origin main
```

`dist/` is git-ignored; Cloudflare Pages regenerates it.

One commit. Use the Conventional Commits format from `CLAUDE.md`, and end the
message with the attribution lines the session requires.

## 6. Reply

Keep it to four lines:

```
<Title> is live at https://games.jnssn.io/<slug>/ — currently off, so it shows
the "switched off" page.

To turn it on, send me: enable <slug>
```

Plus, if anything was lost in migration, one line naming it.

Do not claim it is deployed before the push succeeds. Pages takes roughly 30–60
seconds after the push.
