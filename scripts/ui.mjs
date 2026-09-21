// The shared UI kit: one set of tokens, one set of primitives, one motion
// vocabulary, for every app in /apps.
//
// Apps do NOT link this file — they carry a copy of it inline, between the
// sentinel comments below, exactly the way each one carries its own copy of the
// language runtime. That keeps the single-file rule intact and keeps
// `open apps/<slug>/index.html` from a bare clone working. This module is the
// source of truth; `node scripts/build.mjs --sync-ui` writes it into every app,
// and a normal build fails if an app's copy has drifted.
//
//   scripts/ui.mjs  --sync-ui-->  apps/*/index.html  --build-->  dist/
//
// Change a token here, run --sync-ui, commit. Never hand-edit the block inside
// an app: the next build will tell you it is stale, and the next sync will
// overwrite it.

import { hueFor } from './icon.mjs';
import { createHash } from 'node:crypto';




/* ---------- theme runtime ----------
   This must run in <head>, before first paint. Applied any later and a phone
   set to dark with the site set to light paints dark, then flips — the flash
   is worse than not offering the choice at all.

   Three states, not two: "auto" has to stay the default and stay reachable, or
   a player who once tapped light is stuck there when their phone goes dark at
   sunset. The key is origin-wide, like jnssn-lang, so the choice carries from
   the index into every game and back. */
export const THEME_RUNTIME = `
(function(){
  var K='jnssn-theme', MODES=['auto','light','dark'];
  function stored(){ try{ return localStorage.getItem(K); }catch(e){ return null; } }
  var s=stored(), cur = MODES.indexOf(s)>-1 ? s : 'auto';
  function apply(m){
    var r=document.documentElement;
    if(m==='auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', m);
  }
  apply(cur);
  window.JTheme={
    modes:MODES,
    get:function(){ return cur; },
    // What the page actually renders as, once "auto" is resolved.
    resolved:function(){
      if(cur!=='auto') return cur;
      return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    },
    set:function(m){
      if(MODES.indexOf(m)<0 || m===cur) return;
      cur=m; apply(m);
      try{ localStorage.setItem(K,m); }catch(e){}
      window.dispatchEvent(new CustomEvent('jthemechange',{detail:m}));
    },
    cycle:function(){ this.set(MODES[(MODES.indexOf(cur)+1)%MODES.length]); }
  };
})();`.trim();

/* ---------- fonts ----------
   One family, not two. Hierarchy comes from weight and optical size, which is
   what a native app does; it also halves the font round-trips on a cold cache,
   and fonts are the single biggest thing standing between a tap on the icon and
   a readable screen on mobile data. */
export const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`;

/* ---------- tokens ----------
   Light is defined on bare :root, dark overrides only the values. A colour
   whose only definition sits inside a media query never applies in the
   un-stamped state, which renders one theme's text on the other theme's ground.

   The accent is derived from the app's hue, the same hue that colours its icon
   and its theme-colour, so a game looks like the tile the player tapped. */
export function tokens(slug) {
  const h = slug == null ? 222 : hueFor(slug);
  return `
:root{
  color-scheme:light dark;
  --h:${h};

  /* surfaces — neutrals carry a slight cool bias so they read as chosen */
  --bg:#F4F5F8; --surface:#FFFFFF; --raised:#FFFFFF; --inset:#EDEFF4;
  --line:#DFE3EC; --line-soft:#EAEDF3;

  /* ink */
  --text:#14161C; --dim:#5C6376; --faint:#8C93A6;

  /* accent, from the app's own hue */
  --accent:hsl(var(--h) 64% 42%);
  --accent-ink:#FFFFFF;
  --accent-wash:hsl(var(--h) 72% 96%);
  --accent-edge:hsl(var(--h) 52% 84%);

  /* semantic — separate from the accent on purpose */
  --pos:hsl(152 58% 32%); --neg:hsl(356 68% 46%);
  --pos-wash:hsl(152 52% 95%); --neg-wash:hsl(356 82% 96%);

  /* elevation. The inner top highlight is what makes a panel read as a
     physical object instead of a flat rectangle; it matters most in dark. */
  --lift:0 1px 2px hsl(var(--h) 24% 12% / .06), 0 4px 14px hsl(var(--h) 24% 12% / .05);
  --lift-hi:0 2px 4px hsl(var(--h) 24% 12% / .08), 0 12px 32px hsl(var(--h) 24% 12% / .10);
  --edge:inset 0 1px 0 hsl(0 0% 100% / .7);

  /* geometry */
  --r-sm:9px; --r:14px; --r-lg:20px; --r-full:999px;
  --tap:48px;

  /* motion. Expo-out for movement, a slight overshoot for presses. Both are
     applied to transform and opacity only, so they stay on the compositor. */
  --fast:130ms; --mid:220ms; --slow:340ms;
  --ease:cubic-bezier(.16,1,.3,1);
  --spring:cubic-bezier(.34,1.42,.64,1);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
`.trim();
}

const DARK = `
  --bg:#0B0C10; --surface:#14161C; --raised:#1A1D25; --inset:#0E1015;
  --line:#262A34; --line-soft:#1E212A;
  --text:#ECEEF3; --dim:#959CAF; --faint:#6B7286;
  --accent:hsl(var(--h) 76% 64%);
  --accent-ink:#0B0C10;
  --accent-wash:hsl(var(--h) 40% 16%);
  --accent-edge:hsl(var(--h) 40% 28%);
  --pos:hsl(152 62% 56%); --neg:hsl(356 92% 70%);
  --pos-wash:hsl(152 36% 14%); --neg-wash:hsl(356 42% 16%);
  --lift:0 1px 2px #0006, 0 6px 18px #0007;
  --lift-hi:0 2px 6px #0007, 0 18px 44px #0009;
  --edge:inset 0 1px 0 hsl(0 0% 100% / .06);
`.trim();

/* ---------- primitives ---------- */
export const UI_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;height:100%}
body{
  font-family:"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:16px;line-height:1.45;color:var(--text);background:var(--bg);
  min-height:100%;-webkit-tap-highlight-color:transparent;
  text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;
  overscroll-behavior-y:none;
}
.wrap{max-width:480px;margin:0 auto;padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(28px + env(safe-area-inset-bottom,0px))}
h1,h2,h3{line-height:1.15;text-wrap:balance;font-weight:700;letter-spacing:-.02em}
h1{font-size:28px}
h2{font-size:19px;letter-spacing:-.01em}
h3{font-size:15px}
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;letter-spacing:-.02em}
.eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.dim{color:var(--dim)}.faint{color:var(--faint)}
.pos{color:var(--pos)}.neg{color:var(--neg)}
.stack{display:flex;flex-direction:column;gap:10px}
.stack-lg{display:flex;flex-direction:column;gap:22px}
hr{border:0;border-top:1px solid var(--line);margin:18px 0}

/* --- surfaces --------------------------------------------------------- */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--lift),var(--edge)}
.card.flat{box-shadow:none}
.card.quiet{background:transparent;box-shadow:none;border-color:var(--line-soft)}
.pad{padding:14px 16px}
.list>*{border-top:1px solid var(--line-soft)}
.list>*:first-child{border-top:0}

.row{display:flex;align-items:center;gap:12px;padding:12px 14px;min-height:var(--tap)}
.grow{min-width:0;flex:1}
/* display:block so these read the same whether the app emits div or span.
   Wrapping is the default: a settings label like "Points lost per trick off"
   is longer than its track and clipping it to "Points lost per tric…" hides
   the thing being set. Add .one where a single line is genuinely wanted and
   the text is known to be short, such as a player's name. */
.row .title{display:block;font-weight:600}
.row .title.one{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .sub{display:block;font-size:13px;color:var(--dim);margin-top:1px}
/* Neutral, not accent-washed. An app whose hue is in the red band — rikiki is
   352 — otherwise gets a red row, and a red row reads as "you did something
   wrong" rather than "this is the one to look at". Say WHY a row is marked in
   words; do not make the colour carry it. */
.row.lead{background:var(--inset)}

/* --- controls ---------------------------------------------------------- */
button,input,select{font:inherit;color:inherit}
/* touch-action:manipulation removes the double-tap-to-zoom gesture, so tapping
   + four times in a second counts four times instead of zooming the page.
   user-select stops the same rapid tapping from selecting the label. */
button,a,.tile,summary{touch-action:manipulation}
button,.seg,.stepper,.toggle,.tabs,.dots,.appbar{-webkit-user-select:none;user-select:none}
.btn{
  display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
  min-height:54px;padding:0 20px;border:1px solid transparent;border-radius:var(--r);
  background:var(--accent);color:var(--accent-ink);font-weight:600;font-size:16.5px;
  letter-spacing:-.01em;cursor:pointer;box-shadow:var(--lift);
  transition:transform var(--fast) var(--spring),opacity var(--fast) linear,background var(--fast) linear;
}
.btn:active:not(:disabled){transform:scale(.972)}
.btn:disabled{opacity:.38;cursor:default;box-shadow:none}
.btn.ghost{background:var(--surface);color:var(--text);border-color:var(--line);box-shadow:var(--lift),var(--edge)}
.btn.quiet{background:transparent;color:var(--dim);border-color:transparent;box-shadow:none;min-height:var(--tap);font-size:15px}
.btn.danger{background:transparent;color:var(--neg);border-color:var(--line);box-shadow:none}
.btn.sm{min-height:40px;font-size:14.5px;padding:0 14px;border-radius:var(--r-full);width:auto}
.btns{display:grid;gap:10px}
.btns.two{grid-template-columns:1fr 1fr}

/* Stepper. The value is the biggest thing in the row because it is the thing
   being read back; the buttons are quiet until touched. */
.stepper{display:flex;align-items:center;gap:2px;flex:none;background:var(--inset);border-radius:var(--r-full);padding:3px}
.stepper button{
  width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:50%;
  background:transparent;color:var(--accent);cursor:pointer;
  transition:transform var(--fast) var(--spring),background var(--fast) linear;
}
.stepper button:active:not(:disabled){transform:scale(.86);background:var(--accent-wash)}
.stepper button:disabled{opacity:.22;cursor:default}
.stepper .val{min-width:40px;text-align:center;font-size:22px;font-weight:700}

.toggle{
  width:52px;height:32px;flex:none;border-radius:var(--r-full);border:0;cursor:pointer;
  background:var(--inset);position:relative;box-shadow:inset 0 0 0 1px var(--line);
  transition:background var(--mid) var(--ease),box-shadow var(--mid) var(--ease);
}
.toggle::after{
  content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;
  background:var(--surface);box-shadow:0 1px 3px #0003;
  transition:transform var(--mid) var(--spring);
}
.toggle[aria-pressed="true"]{background:var(--accent);box-shadow:none}
.toggle[aria-pressed="true"]::after{transform:translateX(20px)}

/* Segmented control — the language bar and any 2-3 way choice. */
.seg{display:flex;background:var(--inset);border-radius:var(--r-full);padding:3px;gap:2px;flex:none}
.seg button{
  border:0;background:transparent;color:var(--dim);cursor:pointer;border-radius:var(--r-full);
  padding:7px 13px;min-height:36px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
  transition:color var(--fast) linear,background var(--mid) var(--ease);
}
.seg button[aria-pressed="true"]{background:var(--surface);color:var(--text);box-shadow:var(--lift)}

.field{
  width:100%;min-height:var(--tap);padding:12px 14px;border-radius:var(--r-sm);
  border:1px solid var(--line);background:var(--inset);color:var(--text);
  font-size:16px;-webkit-appearance:none;
  transition:border-color var(--fast) linear,background var(--fast) linear;
}
.field::placeholder{color:var(--faint)}
.field:focus{outline:none;border-color:var(--accent);background:var(--surface)}

.chip{
  display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:var(--r-full);
  background:var(--inset);color:var(--dim);font-size:12.5px;font-weight:600;white-space:nowrap;
}
/* Outlined, not filled. Red/green are reserved for good/bad, and an app whose
   own hue lands in the red band (rikiki is 352) would otherwise have its
   accent chip read as a failure. Semantic colour stays semantic. */
.chip.on{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent-edge)}
.chip.bad{background:var(--neg-wash);color:var(--neg)}
.chip.good{background:var(--pos-wash);color:var(--pos)}

:where(a,button,input,select,summary):focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--r-sm)}

/* --- progress ----------------------------------------------------------
   Dots, not a bar: a game has a countable number of rounds, and the count is
   information the player wants. Past 14 it falls back to a bar. */
.dots{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.dots i{width:7px;height:7px;border-radius:50%;background:var(--line);transition:transform var(--mid) var(--spring),background var(--mid) linear}
.dots i.done{background:var(--accent);opacity:.45}
.dots i.now{background:var(--accent);transform:scale(1.62)}
.bar{height:5px;border-radius:var(--r-full);background:var(--line);overflow:hidden}
.bar>i{display:block;height:100%;background:var(--accent);border-radius:inherit;transition:width var(--slow) var(--ease)}

/* --- table -------------------------------------------------------------- */
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:9px 10px;text-align:center;white-space:nowrap;border-top:1px solid var(--line-soft)}
thead th{position:sticky;top:0;background:var(--surface);font-size:13px;font-weight:600;border-top:0;border-bottom:1px solid var(--line);vertical-align:bottom}
tbody th{position:sticky;left:0;background:var(--surface);color:var(--faint);font-size:12.5px;font-weight:500;text-align:left;width:1%}

/* --- feedback ----------------------------------------------------------- */
.empty{padding:26px 18px;text-align:center;color:var(--dim);font-size:14.5px}
#toast{position:fixed;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;justify-content:center;pointer-events:none;z-index:40;padding:0 14px}
#toast .t{
  display:flex;align-items:center;gap:14px;max-width:440px;width:100%;
  background:var(--raised);color:var(--text);border:1px solid var(--line);
  border-radius:var(--r);padding:12px 14px;box-shadow:var(--lift-hi),var(--edge);
  pointer-events:auto;font-size:14.5px;
  animation:toast-in var(--slow) var(--ease) both;
}
#toast .t.out{animation:toast-out var(--mid) var(--ease) both}
#toast .t span{flex:1;min-width:0}
#toast .t button{border:0;background:transparent;color:var(--accent);font-weight:700;font-size:14.5px;cursor:pointer;padding:6px 2px;flex:none}
@keyframes toast-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
@keyframes toast-out{to{opacity:0;transform:translateY(8px) scale(.98)}}

/* --- motion ------------------------------------------------------------- */
@keyframes rise{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.rise{animation:rise var(--slow) var(--ease) both}
.rise:nth-child(2){animation-delay:40ms}
.rise:nth-child(3){animation-delay:80ms}
.rise:nth-child(4){animation-delay:120ms}
.rise:nth-child(5){animation-delay:160ms}

/* --- app shell ----------------------------------------------------------
   Every app has a bar and a stack of screens, whatever it is a game of. An
   app that hand-rolls these is the first step towards five design systems. */
.appbar{
  position:sticky;top:0;z-index:20;
  display:flex;align-items:center;gap:10px;
  padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;
  background:color-mix(in srgb,var(--bg) 82%,transparent);
  backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);
  border-bottom:1px solid transparent;
  transition:border-color var(--mid) var(--ease);
}
.appbar.stuck{border-bottom-color:var(--line)}
.appbar h1{font-size:19px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Not scoped to .appbar: the index and the 404 page want the same icon button
   without pretending to have an app bar. */
.act{
  width:40px;height:40px;flex:none;display:grid;place-items:center;border:0;border-radius:50%;
  background:transparent;color:var(--dim);cursor:pointer;text-decoration:none;
  transition:transform var(--fast) var(--spring),background var(--fast) linear,color var(--fast) linear;
}
.act:active{transform:scale(.88);background:var(--inset)}
.act:hover{color:var(--text)}
/* Chrome controls that sit together — the language toggle and the theme
   button — so they read as one group rather than two loose objects. */
.chrome{display:flex;align-items:center;gap:4px;flex:none}

/* Screens are siblings; exactly one is visible. Toggle with el.hidden, never
   style.display, so assistive tech follows along. */
.screen[hidden]{display:none}
.screen:focus{outline:none}
.screen{animation:rise var(--slow) var(--ease) both}

/* --- dialog -------------------------------------------------------------
   Native <dialog>: focus trapping, Esc to close and inertness come free and
   correct. Hand-rolled modals get all three wrong. */
/* The dialog IS the viewport, and the sheet is bounded by the dialog.

   It used to be sized with 88svh. A viewport unit is the browser's idea of
   the viewport, not the area actually on screen, and on iOS those disagree
   while the URL bar is settling. A bottom-anchored sheet taller than the
   visible area has its TOP cut off, so it opens showing its last rows, and
   snaps to its heading when the viewport settles — which reads exactly like
   the content having been scrolled, and is why every scrollTop fix missed it.

   inset:0 with height:100% makes the dialog the real viewport box for a
   top-layer element, and max-height:100% of that can never exceed the screen
   however the URL bar behaves. No vh unit is involved any more. */
dialog.sheet{
  border:0;padding:0;background:transparent;margin:0;
  position:fixed;top:0;left:0;right:0;bottom:auto;
  width:100%;max-width:none;
  /* 100svh, not inset:0. A fixed element with inset:0 covers the LAYOUT
     viewport, which on iOS is taller than the area actually on screen while
     the URL bar is showing — so a bottom-anchored sheet sat partly below the
     screen and shifted every time the bar animated. svh is the SMALL
     viewport: the smallest the visible area ever gets, so a box that size
     anchored at the top is always fully on screen and never moves when the
     bar does. Stable beats exact here; a strip of page below the sheet when
     the bar is hidden is far better than a sheet that jumps. */
  height:100svh;max-height:100svh;
  overflow:hidden;
}
/* Scoped to [open] so the UA's display:none for a closed dialog still wins.
   display:block, NOT flex. The sheet is placed with position:absolute rather
   than align-items:flex-end, because WebKit mis-places a flex item that is
   aligned to flex-end AND transformed: measured on an iPhone, the slide ran
   from +639 (one height below) straight past zero to -639 (one height ABOVE
   its resting place), so the sheet shot up past where it belonged and came
   back. An absolutely positioned box transforms predictably. */
dialog.sheet[open]{display:block}
/* The sheet is focused programmatically on open, for the keyboard and to keep
   the browser from scrolling a control into view. That is not a navigation, so
   it must not draw a focus ring — Safari puts its blue UA outline on any
   tabindex element that takes focus, which framed the whole dialog. */
dialog.sheet>.body:focus,dialog.sheet>.body:focus-visible{outline:none}
dialog.sheet::backdrop{background:#0009;backdrop-filter:blur(3px);animation:fade var(--mid) var(--ease) both}
dialog.sheet>.body{
  position:absolute;left:0;right:0;bottom:0;margin:0 auto;
  width:100%;max-width:480px;
  background:var(--raised);border:1px solid var(--line);border-bottom:0;
  border-radius:var(--r-lg) var(--r-lg) 0 0;box-shadow:var(--lift-hi),var(--edge);
  padding:8px 16px calc(20px + env(safe-area-inset-bottom,0px));
  /* 88% OF THE DIALOG, which is exactly the viewport — the same proportion
     88svh was reaching for, but measured against the real box rather than the
     browser's idea of the viewport, so it shrinks with the screen instead of
     overflowing it. Leaves a strip of backdrop above, so the page behind is
     still visible and the sheet reads as sitting on top of it. */
  max-height:88%;overflow-y:auto;overscroll-behavior:contain;
  /* Opening and closing FADE; they do not slide.

     A transformed sheet is mis-placed by WebKit mid-transition — measured on
     an iPhone, the slide ran from one height below its resting place to one
     height above it before settling — and that transient is the jump. Six
     attempts at making the slide behave failed; a fade cannot be mis-placed
     because nothing moves. The transform transition stays only for the drag,
     which is driven by the finger and has never misbehaved.

     A transition, never an animation: a CSS animation with fill-mode:both
     outranks inline styles, so a keyframe here would discard every transform
     the drag sets. */
  transition:opacity var(--mid) var(--ease),transform var(--mid) var(--ease);
}
dialog.sheet>.body::before{
  content:"";display:block;width:36px;height:4px;border-radius:2px;
  background:var(--line);margin:6px auto 14px;
}
dialog.sheet h2{margin-bottom:12px}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media (min-width:520px){
  /* Still bottom-anchored on a wide screen, just lifted off the edge. Centring
     it would need a second translate, and stacking another transform on the
     one that animates is exactly what went wrong on the phone. */
  dialog.sheet>.body{bottom:24px;border-radius:var(--r-lg);border-bottom:1px solid var(--line)}
  dialog.sheet>.body::before{display:none}
}

/* --- tabs ---------------------------------------------------------------- */
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tabs button{
  border:0;background:transparent;color:var(--dim);cursor:pointer;white-space:nowrap;
  padding:12px 14px;min-height:var(--tap);font-size:14.5px;font-weight:600;
  border-bottom:2px solid transparent;margin-bottom:-1px;
  transition:color var(--fast) linear,border-color var(--mid) var(--ease);
}
.tabs button[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--accent)}

/* --- board --------------------------------------------------------------
   A square grid, for anything played on tiles: words, memory, puzzles,
   minesweeper. Set --cols; the cells size themselves. */
.board{display:grid;grid-template-columns:repeat(var(--cols,4),1fr);gap:var(--gap,8px)}
.tile{
  aspect-ratio:1;display:grid;place-items:center;border:1px solid var(--line);
  border-radius:var(--r-sm);background:var(--surface);box-shadow:var(--edge);
  font-size:min(7vw,22px);font-weight:700;cursor:pointer;color:var(--text);
  transition:transform var(--fast) var(--spring),background var(--fast) linear,border-color var(--fast) linear;
}
.tile:active:not(:disabled){transform:scale(.94)}
.tile[aria-pressed="true"],.tile.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.tile:disabled{opacity:.4;cursor:default}
.tile.flat{background:var(--inset);box-shadow:none}

/* --- stat ---------------------------------------------------------------
   For the one or two figures that ARE the point of the screen. Used for
   everything, it flattens the hierarchy instead of creating one. */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px}
.stat{padding:14px;border-radius:var(--r);background:var(--surface);border:1px solid var(--line);box-shadow:var(--edge)}
.stat .k{font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.stat .v{display:block;font-size:30px;font-weight:700;letter-spacing:-.03em;margin-top:3px;font-variant-numeric:tabular-nums}

/* Anything a screen reader must hear but nobody should see. */
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Installed to the Home Screen: no browser chrome, so the bar carries more. */
@media (display-mode:standalone){.appbar{padding-top:calc(14px + env(safe-area-inset-top,0px))}}

/* Cross-screen transitions. Supported browsers animate; the rest just swap. */
::view-transition-old(root){animation:vt-out var(--mid) var(--ease) both}
::view-transition-new(root){animation:vt-in var(--slow) var(--ease) both}
@keyframes vt-out{to{opacity:0;transform:translateY(-6px)}}
@keyframes vt-in{from{opacity:0;transform:translateY(10px)}}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:1ms!important;animation-delay:0ms!important;transition-duration:1ms!important}
  ::view-transition-old(root),::view-transition-new(root){animation:none}
}
`.trim();

/* ---------- runtime ----------
   Small on purpose. Everything here is something every app needs and nobody
   should re-derive: a toast with undo, a view swap that animates, and a patch
   helper that updates text in place instead of rebuilding the screen. */
export const UI_JS = `
(function(){
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');

  /* Swap a view with a transition where the browser has one. Safari 18+,
     Chrome 111+; everywhere else the callback simply runs. */
  function swap(fn){
    if(reduce.matches || !document.startViewTransition){ fn(); return; }
    document.startViewTransition(fn);
  }

  /* Update in place. Rebuilding a screen with innerHTML on every tap throws
     away focus, scroll position and screen-reader context, and makes animation
     impossible — so text that changes goes through here instead. */
  function setText(el, v){
    if(!el) return;
    v = String(v);
    if(el.textContent === v) return;
    el.textContent = v;
  }
  function setAttr(el, k, v){
    if(!el) return;
    if(v === false || v == null) el.removeAttribute(k);
    else if(el.getAttribute(k) !== String(v)) el.setAttribute(k, v);
  }

  /* One toast at a time, with an optional undo. Undo beats a confirmation
     dialog: it costs one tap instead of two and never blocks the screen. */
  var host, timer, cur;
  function toast(msg, opts){
    opts = opts || {};
    if(!host){ host = document.createElement('div'); host.id = 'toast'; document.body.appendChild(host); }
    clearTimeout(timer);
    host.textContent = '';
    var box = document.createElement('div');
    box.className = 't'; box.setAttribute('role','status');
    var text = document.createElement('span'); text.textContent = msg; box.appendChild(text);
    if(opts.undo){
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = opts.undoLabel || 'Undo';
      b.addEventListener('click', function(){ hide(); opts.undo(); });
      box.appendChild(b);
    }
    host.appendChild(box); cur = box;
    timer = setTimeout(hide, opts.ms || (opts.undo ? 6000 : 3200));
  }
  function hide(){
    clearTimeout(timer);
    if(!cur) return;
    var box = cur; cur = null;
    box.classList.add('out');
    setTimeout(function(){ if(box.parentNode) box.parentNode.removeChild(box); }, 220);
  }

  /* Show one .screen, hide its siblings. Focus moves to the new screen and
     scroll returns to the top — what a native app does on a push, and what a
     hand-rolled swap always forgets, leaving the keyboard user stranded where
     the old screen used to be. */
  function screen(id){
    var next = typeof id === 'string' ? document.getElementById(id) : id;
    if(!next || next.dataset.cur === '1') return;
    swap(function(){
      var all = document.querySelectorAll('.screen');
      for(var i=0;i<all.length;i++){ all[i].hidden = all[i] !== next; delete all[i].dataset.cur; }
      next.dataset.cur = '1';
      if(!next.hasAttribute('tabindex')) next.setAttribute('tabindex','-1');
      next.focus({preventScroll:true});
      window.scrollTo({top:0, behavior: reduce.matches ? 'auto' : 'smooth'});
    });
  }

  /* Open a <dialog> as a bottom sheet. Native dialog gives focus trapping,
     Esc and inert background for free; this only adds the exit animation and
     a tap-outside-to-close that matches what a phone user expects. */
  function openSheet(el){
    el = typeof el === 'string' ? document.getElementById(el) : el;
    if(!el || el.open) return;
    el.showModal();
    var body = el.querySelector('.body');
    if(body){
      /* Focus the sheet itself, not whatever control happens to be first.

         showModal() autofocuses, and the browser then scrolls that control
         into view. Safari resolves this a frame LATE — by which time the
         sheet is sitting at translateY(100%), off the bottom of the screen —
         so it scrolls the sheet's own content to the end trying to reveal it,
         and the sheet opens showing its last row instead of its heading.
         Focusing the container with preventScroll removes the reason to
         scroll at all, and is better for a keyboard user anyway: focus starts
         at the sheet and Tab moves into it. */
      if(!body.hasAttribute('tabindex')) body.setAttribute('tabindex','-1');
      body.focus({preventScroll:true});

      // A sheet opens at the top, never where it was left. This must run
      // AFTER showModal: a closed <dialog> is display:none, and scrollTop on
      // a display:none element does nothing.
      body.scrollTop = 0;
      body.style.animation = '';
      body.style.transform = '';                 // never mid-slide any more
      body.style.transition = 'none';
      body.style.opacity = '0';
      void body.offsetHeight;                    // flush, so the start sticks
      if(reduce.matches){ body.style.transition = ''; body.style.opacity = ''; }
      else requestAnimationFrame(function(){
        body.style.transition = '';              // back to the CSS transition
        body.style.opacity = '';
      });

      /* Hold the scroll at the top while the sheet settles.

         Cheap insurance against the browser scrolling something into view
         as the sheet appears, which once left it opening on its last row.
         rAF runs before paint, so a correction here lands in the same frame;
         a scroll listener fires a frame late and the wrong frame is seen.
         Do NOT reach for overflow:clip instead — WebKit mis-places a clipped
         box and that cure was worse than the disease. */
      (function(){
        var until = performance.now() + 420;
        (function pin(){
          if(!el.open || performance.now() > until) return;
          if(body.scrollTop !== 0) body.scrollTop = 0;
          requestAnimationFrame(pin);
        })();
      })();

    }
    el.addEventListener('click', function(e){ if(e.target === el) closeSheet(el); }, {once:true});
    dragSheet(el);
  }

  /* Drag the sheet down to dismiss it.

     Dragging a sheet downwards is what a phone user tries first, and without
     this the gesture falls through to the page behind and pulls it to refresh
     — losing the game instead of closing the sheet. touchmove is therefore
     non-passive and preventDefault()s while the drag is live, which is what
     actually stops the refresh; overscroll-behavior alone does not.

     The drag only starts when the sheet's own content is already scrolled to
     the top, so a long settings list still scrolls normally. */
  function dragSheet(el){
    var body = el.querySelector('.body');
    if(!body || body.dataset.drag === '1') return;
    body.dataset.drag = '1';
    var y0 = 0, dy = 0, live = false;

    body.addEventListener('touchstart', function(e){
      if(e.touches.length !== 1 || body.scrollTop > 0) return;
      y0 = e.touches[0].clientY; dy = 0; live = true;
      body.style.transition = 'none';
    }, {passive:true});

    body.addEventListener('touchmove', function(e){
      if(!live) return;
      dy = e.touches[0].clientY - y0;
      if(dy <= 0){
        // Dragging up again: hand the gesture back to normal scrolling.
        if(body.scrollTop > 0){ live = false; body.style.transition = ''; body.style.transform = ''; }
        return;
      }
      e.preventDefault();
      // Past the threshold it tracks the finger 1:1; before it, a little
      // resistance so a stray few pixels do not look like the sheet is loose.
      body.style.transform = 'translateY(' + (dy < 24 ? dy * 0.5 : dy - 12) + 'px)';
    }, {passive:false});

    function end(){
      if(!live) return;
      live = false;
      // Past the threshold, hand straight over to closeSheet, which carries on
      // downwards from the current offset. Snapping back to 0 first is what
      // produced the down-up-down stutter.
      if(dy > 96){ closeSheet(el); return; }
      body.style.transition = 'transform var(--mid) var(--ease)';
      body.style.transform = '';
    }
    body.addEventListener('touchend', end);
    body.addEventListener('touchcancel', end);
  }
  function closeSheet(el){
    el = typeof el === 'string' ? document.getElementById(el) : el;
    if(!el || !el.open) return;
    var body = el.querySelector('.body');
    if(reduce.matches || !body){ if(body){ body.style.transform=''; body.style.transition=''; } el.close(); return; }
    if(body.dataset.closing === '1') return;      // one close, not one per tap
    body.dataset.closing = '1';
    // Fades from wherever it is, including part-way through a drag, so a
    // dragged sheet finishes rather than snapping back first.
    body.style.transition = 'opacity var(--fast) var(--ease)';
    body.style.opacity = '0';
    setTimeout(function(){
      delete body.dataset.closing;
      body.style.transition = ''; body.style.opacity = ''; body.style.transform = '';
      el.close();
    }, 160);
  }

  /* Announce something to a screen reader without showing it. A score that
     only changes visually is a score a blind player never hears. */
  var liveEl;
  function live(msg){
    if(!liveEl){
      liveEl = document.createElement('p');
      liveEl.className = 'sr'; liveEl.setAttribute('role','status'); liveEl.setAttribute('aria-live','polite');
      document.body.appendChild(liveEl);
    }
    liveEl.textContent = '';
    setTimeout(function(){ liveEl.textContent = msg; }, 60);
  }

  /* One icon set, so no app hand-writes another plus sign. 24x24, currentColor. */
  var P = {
    plus:'M12 5v14M5 12h14', minus:'M5 12h14', check:'M4 12.5l5.5 5.5L20 7',
    x:'M6 6l12 12M18 6L6 18', back:'M15 5l-7 7 7 7', next:'M9 5l7 7-7 7',
    up:'M5 15l7-7 7 7', down:'M5 9l7 7 7-7',
    undo:'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
    cog:'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3.9a2 2 0 110-4h.2a1.6 1.6 0 001.1-2.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H10a1.6 1.6 0 001-1.5V4a2 2 0 114 0v.2a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V10a1.6 1.6 0 001.5 1h.3a2 2 0 110 4H20a1.6 1.6 0 00-1.5 1z',
    trash:'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    play:'M7 4l13 8-13 8z', pause:'M8 5v14M16 5v14', again:'M20 11a8 8 0 10-2.3 6M20 5v6h-6',
    home:'M4 11l8-7 8 7M7 10v10h10V10', info:'M12 10v7M12 7h.01',
    sun:'M12 4V2M12 22v-2M4 12H2M22 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M16 12a4 4 0 11-8 0 4 4 0 018 0z',
    moon:'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z',
    auto:'M12 3a9 9 0 000 18zM12 3a9 9 0 010 18',
    trophy:'M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M9 20h6M12 14v6'
  };
  function icon(name, size){
    var d = P[name]; if(!d) return '';
    return '<svg viewBox="0 0 24 24" width="' + (size||22) + '" height="' + (size||22) + '" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="' + d + '"/></svg>';
  }

  /* Wire a button to cycle auto -> light -> dark. One button rather than three
     because the bar has no room for a segmented control next to the language
     one; the glyph shows the CURRENT state and the label names it, so nothing
     depends on the player guessing what a half-filled circle means. */
  var THEME_LABEL = {
    en:{auto:'Theme: follow the phone', light:'Theme: light', dark:'Theme: dark'},
    fr:{auto:'Thème : selon le téléphone', light:'Thème : clair', dark:'Thème : sombre'}
  };
  function themeButton(el){
    if(!el || !window.JTheme) return;
    function lang(){ return (window.JLang && window.JLang.get()) || document.documentElement.lang || 'en'; }
    function paint(){
      var m = JTheme.get();
      el.innerHTML = icon(m === 'auto' ? 'auto' : m === 'light' ? 'sun' : 'moon', 20);
      var label = (THEME_LABEL[lang()] || THEME_LABEL.en)[m];
      el.setAttribute('aria-label', label);
      el.setAttribute('title', label);
    }
    el.addEventListener('click', function(){
      JTheme.cycle();
      live((THEME_LABEL[lang()] || THEME_LABEL.en)[JTheme.get()]);
    });
    addEventListener('jthemechange', paint);
    addEventListener('jlangchange', paint);
    paint();
  }

  /* The app bar gains its rule only once the page is actually scrolled. */
  function bar(){
    var b = document.querySelector('.appbar'); if(!b) return;
    var on = false;
    addEventListener('scroll', function(){
      var next = scrollY > 4;
      if(next !== on){ on = next; b.classList.toggle('stuck', on); }
    }, {passive:true});
  }
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', bar) : bar();

  window.UI = {
    swap:swap, setText:setText, setAttr:setAttr,
    toast:toast, hideToast:hide,
    screen:screen, openSheet:openSheet, closeSheet:closeSheet,
    live:live, icon:icon, icons:P, themeButton:themeButton,
    reduced:function(){ return reduce.matches; }
  };
})();`.trim();

/* ---------- assembly ----------
   Two blocks go into every app, each fenced by a sentinel pair the sync and
   the drift check both match on. The fences are the contract: everything
   between them belongs to this file, everything outside belongs to the app. */

const NOTE = 'generated by scripts/ui.mjs — do not edit by hand, run `node scripts/build.mjs --sync-ui`';

export const CSS_OPEN = `/* ==== jnssn-ui css: ${NOTE} ==== */`;
export const CSS_CLOSE = '/* ==== /jnssn-ui css ==== */';
export const JS_OPEN = `// ==== jnssn-ui js: ${NOTE} ====`;
export const JS_CLOSE = '// ==== /jnssn-ui js ====';

// Matches a fenced block including its sentinels, so a sync can replace one
// wholesale. [\s\S] rather than the s flag: this has to run on old node too.
// The header text after the name is optional, so an empty pair of fences in a
// freshly scaffolded file is a valid sync target.
export const CSS_RE = /\/\* ==== jnssn-ui css[\s\S]*?\/\* ==== \/jnssn-ui css ==== \*\//;
export const JS_RE = /\/\/ ==== jnssn-ui js[\s\S]*?\/\/ ==== \/jnssn-ui js ====/;

// The exact CSS block an app carries. Slug-specific only in its hue.
export function cssBlock(slug) {
  return `${CSS_OPEN}\n${tokens(slug)}\n${UI_CSS}\n${CSS_CLOSE}`;
}

// The exact JS block an app carries. Identical in every app.
export function jsBlock() {
  return `${JS_OPEN}\n${UI_JS}\n${JS_CLOSE}`;
}

// Drift check. An app's copy is stale when this does not match what is in the
// file, which is the only thing standing between one design system and five.
export function uiVersion(slug) {
  return createHash('sha256').update(cssBlock(slug) + jsBlock()).digest('hex').slice(0, 12);
}

// Rewrite both blocks in a source file. Returns null when the file carries no
// sentinels at all — that is a scaffolding problem, not a drift problem, and
// the caller reports it differently.
export function syncSource(source, slug) {
  if (!CSS_RE.test(source) || !JS_RE.test(source)) return null;
  return source
    .replace(CSS_RE, () => cssBlock(slug))
    .replace(JS_RE, () => jsBlock());
}

// True when the file's blocks already match what this module would write.
export function isCurrent(source, slug) {
  return source.includes(cssBlock(slug)) && source.includes(jsBlock());
}
