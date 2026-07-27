/**
 * Curates the raw screenshots into the documented set, and builds the
 * walkthrough GIF + the self-contained slider.
 *
 *     npm run screenshots     # runs scripts/screenshots.mjs, then this
 *
 * Source images come from driving the real app, so the docs can't drift from
 * what Sheaf renders. This script owns the slide order and captions.
 *
 * Outputs:
 *   screenshots/NN-name.png       stills referenced by the README
 *   screenshots/walkthrough.gif   auto-playing, captions burnt in
 *   screenshots/index.html        interactive slider (GitHub strips <script>
 *                                 from READMEs, so this is for Pages / local)
 *
 * Maintainer tool. The GIF needs ImageMagick (`brew install imagemagick`); if
 * it's missing the stills and slider are still produced. Outputs are committed,
 * so contributors never need to run it.
 */
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'screenshots', 'raw')
const OUT = path.join(ROOT, 'screenshots')
const TMP = path.join(ROOT, '.walk-tmp')

/** (raw name, output name, caption) — order defines the walkthrough. */
const SLIDES = [
  ['letterhead', '01-letterhead', 'Letterhead — add, replace or remove HTTP headers, scoped by URL'],
  ['home-dark', '02-home-dark', 'Home — a greeting and a sky drawn from your system clock. No network.'],
  ['home-light', '03-home-light', 'Light theme — one click in the toolbar, the whole app follows'],
  ['folio', '04-folio', 'Folio — any JSON becomes a searchable tree, with copy-path on every key'],
  ['imprint', '05-imprint', 'Imprint — read and edit cookies, localStorage and sessionStorage'],
  ['mailroom', '06-mailroom', 'Mailroom — stub, redirect, block or delay requests; record a HAR'],
  ['devtools', '07-devtools', 'DevTools — the real Chrome panels, docked and resizable'],
  ['device', '08-device', 'Device simulation — presets resize the viewport and swap the user agent'],
  ['omnibox', '09-omnibox', 'Omnibox — suggestions from your own history and bookmarks'],
  ['folio-scratchpad', '10-folio-scratchpad', 'Folio scratchpad — paste JSON from anywhere and read it as a tree'],
  ['extensions', '11-extensions', 'Extensions — load unpacked Chrome extensions or .crx files'],
  ['devices', '12-devices', 'Devices — add your own simulation profiles'],
  ['help', '13-help', 'Help — how to use every tool, plus honest security notes'],
  ['about', '14-about', 'About — versions, platform and where your data lives'],
  ['welcome', '15-welcome', 'First launch — it asks what to call you, and nothing else']
]

const has = (cmd) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const magick = has('magick') ? 'magick' : has('convert') ? 'convert' : null

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

// ---- 1. curated stills ----
const made = []
for (const [src, out, caption] of SLIDES) {
  const from = path.join(RAW, `${src}.png`)
  if (!fs.existsSync(from)) {
    console.warn('missing raw shot, skipping:', src)
    continue
  }
  fs.copyFileSync(from, path.join(OUT, `${out}.png`))
  made.push({ file: `${out}.png`, caption })
}
console.log(`stills: ${made.length}`)

// ---- 2. slider (self-contained, no external assets) ----
const slider = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sheaf — walkthrough</title>
<style>
  :root { --bg:#0b0d10; --fg:#e8eaed; --muted:#9aa0a6; --line:#22262c; --accent:#0070f3; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .wrap { max-width:1040px; margin:0 auto; padding:28px 20px 56px; }
  h1 { font-size:22px; margin:0 0 2px; letter-spacing:-.02em; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 20px; }
  .stage { position:relative; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#000; }
  .stage img { display:block; width:100%; }
  .cap { display:flex; gap:10px; align-items:baseline; padding:14px 4px 0; min-height:52px; }
  .num { color:var(--muted); font-variant-numeric:tabular-nums; font-size:13px; }
  .txt { font-size:15px; }
  .bar { display:flex; gap:10px; align-items:center; margin-top:12px; }
  button { height:34px; min-width:38px; padding:0 12px; border:1px solid var(--line); border-radius:8px;
           background:#14171c; color:var(--fg); font:inherit; cursor:pointer; }
  button:hover { background:#1b1f26; }
  input[type=range] { flex:1; accent-color:var(--accent); }
  .dots { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
  .dot { width:9px; height:9px; border-radius:50%; background:#2a2f37; border:none; padding:0; min-width:0; cursor:pointer; }
  .dot.on { background:var(--accent); }
  .hint { color:var(--muted); font-size:12px; margin-top:14px; }
</style></head>
<body><div class="wrap">
  <h1>Sheaf — walkthrough</h1>
  <p class="sub">Every screen, captured from the running app. ← → to move, Space to play/pause.</p>
  <div class="stage"><img id="img" alt=""/></div>
  <div class="cap"><span class="num" id="num"></span><span class="txt" id="txt"></span></div>
  <div class="bar">
    <button id="prev" aria-label="Previous">←</button>
    <button id="play" aria-label="Play/pause">Pause</button>
    <button id="next" aria-label="Next">→</button>
    <input type="range" id="scrub" min="0" value="0"/>
  </div>
  <div class="dots" id="dots"></div>
  <p class="hint">Generated by <code>npm run screenshots</code> — the docs can't drift from the app.</p>
</div>
<script>
  const SLIDES = ${JSON.stringify(made)};
  let i = 0, playing = true, timer = null;
  const img=document.getElementById('img'), num=document.getElementById('num'),
        txt=document.getElementById('txt'), scrub=document.getElementById('scrub'),
        dots=document.getElementById('dots'), play=document.getElementById('play');
  scrub.max = SLIDES.length - 1;
  SLIDES.forEach((_, n) => {
    const b = document.createElement('button');
    b.className = 'dot'; b.setAttribute('aria-label', 'Slide ' + (n+1));
    b.onclick = () => { go(n); pause(); };
    dots.append(b);
  });
  function render(){
    const s = SLIDES[i];
    img.src = s.file; img.alt = s.caption;
    num.textContent = (i+1) + '/' + SLIDES.length;
    txt.textContent = s.caption;
    scrub.value = i;
    [...dots.children].forEach((d,n)=>d.classList.toggle('on', n===i));
  }
  function go(n){ i = (n + SLIDES.length) % SLIDES.length; render(); }
  function pause(){ playing=false; play.textContent='Play'; clearInterval(timer); }
  function start(){ playing=true; play.textContent='Pause'; clearInterval(timer); timer=setInterval(()=>go(i+1), 3200); }
  document.getElementById('next').onclick=()=>{go(i+1);pause()};
  document.getElementById('prev').onclick=()=>{go(i-1);pause()};
  play.onclick=()=> playing?pause():start();
  scrub.oninput=()=>{go(+scrub.value);pause()};
  addEventListener('keydown', e=>{
    if(e.key==='ArrowRight'){go(i+1);pause()}
    else if(e.key==='ArrowLeft'){go(i-1);pause()}
    else if(e.key===' '){e.preventDefault(); playing?pause():start()}
  });
  render(); start();
</script>
</body></html>`
fs.writeFileSync(path.join(OUT, 'index.html'), slider)
console.log('slider: screenshots/index.html')

// ---- 3. GIF with burnt-in captions ----
if (!magick) {
  console.warn('\nImageMagick not found — skipping walkthrough.gif (stills + slider are done).')
  console.warn('  brew install imagemagick')
} else {
  const frames = []
  made.forEach((s, n) => {
    const f = path.join(TMP, `f${String(n).padStart(2, '0')}.png`)
    // Resize to a GitHub-friendly width, then append a caption strip so the GIF
    // reads on its own in the README.
    execFileSync(magick, [
      path.join(OUT, s.file),
      '-resize', '900x',
      '-background', '#0b0d10',
      '-fill', '#e8eaed',
      '-pointsize', '17',
      '-size', '860x',
      `caption:${n + 1}/${made.length}  ${s.caption}`,
      '-gravity', 'west',
      '-splice', '20x0',
      '-background', '#0b0d10',
      '-append',
      f
    ])
    frames.push(f)
  })
  // Pad every frame to the tallest, or the GIF jitters between slides.
  execFileSync(magick, [
    '-delay', '320',
    '-loop', '0',
    ...frames,
    '-background', '#0b0d10',
    '-gravity', 'north',
    '-extent', '900x0',
    '-layers', 'OptimizePlus',
    path.join(OUT, 'walkthrough.gif')
  ])
  const kb = Math.round(fs.statSync(path.join(OUT, 'walkthrough.gif')).size / 1024)
  console.log(`gif: screenshots/walkthrough.gif (${kb} KB)`)
}

fs.rmSync(TMP, { recursive: true, force: true })
