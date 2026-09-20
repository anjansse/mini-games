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

Copy `.claude/skills/new-app/boilerplate.html` to `apps/<slug>/index.html` and
build the app inside it. The boilerplate already carries the light/dark tokens,
the phone-width layout, the guarded `localStorage` helpers and the link home —
keep that structure and replace the demo content.

Write `apps/<slug>/meta.json`:

```json
{
  "title": "Tip splitter",
  "description": "One line, plain, no marketing. It shows on the landing page.",
  "lang": "en",
  "created": "YYYY-MM-DD",
  "icon": "£"
}
```

`icon` is a single character — an emoji or a symbol. It sits next to the title
on the landing page.

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
`scripts/build.mjs` to get past it. Then confirm by eye that the generated
`site/index.html` is what you expect.

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
