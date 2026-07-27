/**
 * Renders the product site's scroll sequence — every frame drawn from scratch.
 *
 *     npm run site:frames        # -> site/frames/frame-000.jpg …
 *
 * The story is the name: a sheaf binds separate papers into one volume. Four
 * sheets — Letterhead, Folio, Imprint, Mailroom — drift in the void, converge,
 * stack, and resolve into a single browser window whose toolbar lights up.
 *
 * Every pixel is geometry we author here (rounded rects, arcs, text), rendered
 * to a canvas by a real Chromium and screenshotted. Nothing is traced, stocked
 * or downloaded, so the whole sequence is ours to license under MIT.
 */
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'site', 'frames')
const W = 1280
const H = 800
const FRAMES = 150

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

/** The scene. Runs inside the page; `t` is 0..1 across the whole sequence. */
const SCENE = `
const C = document.getElementById('c')
const x = C.getContext('2d')
const W = ${W}, H = ${H}

const TOOLS = [
  { name:'Letterhead', sub:'HTTP headers',      color:'#0070f3', glyph:'H' },
  { name:'Folio',      sub:'JSON',              color:'#16a34a', glyph:'{}' },
  { name:'Imprint',    sub:'Cookies & storage', color:'#7c3aed', glyph:'\\u25CF' },
  { name:'Mailroom',   sub:'Mock & record',     color:'#f59e0b', glyph:'\\u2709' }
]

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v))
const lerp=(a,b,p)=>a+(b-a)*p
// Normalised progress of a sub-phase within [s,e], eased.
const seg=(t,s,e)=>clamp((t-s)/(e-s),0,1)
const easeInOut=p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2
const easeOut=p=>1-Math.pow(1-p,3)

function rr(ctx,X,Y,w,h,r){
  // Guard: a negative width/height yields a negative radius, and arcTo throws
  // IndexSizeError. Callers scale rather than lerp sizes, but be defensive.
  if(w<=0||h<=0){ ctx.beginPath(); return }
  const rad=Math.max(0,Math.min(r,w/2,h/2))
  ctx.beginPath(); ctx.moveTo(X+rad,Y)
  ctx.arcTo(X+w,Y,X+w,Y+h,rad); ctx.arcTo(X+w,Y+h,X,Y+h,rad)
  ctx.arcTo(X,Y+h,X,Y,rad);     ctx.arcTo(X,Y,X+w,Y,rad)
  ctx.closePath()
}

/** One tool's sheet: a page with a coloured header, glyph and ruled lines. */
function sheet(ctx,w,h,tool,alpha,detail){
  ctx.save(); ctx.globalAlpha=alpha
  ctx.shadowColor='rgba(10,15,30,.28)'; ctx.shadowBlur=48; ctx.shadowOffsetY=18
  ctx.fillStyle='#fff'; rr(ctx,-w/2,-h/2,w,h,14); ctx.fill()
  ctx.shadowColor='transparent'

  // header band
  ctx.fillStyle=tool.color; rr(ctx,-w/2,-h/2,w,34,14); ctx.fill()
  ctx.fillRect(-w/2,-h/2+20,w,14)

  if(detail>0.02){
    ctx.globalAlpha=alpha*detail
    ctx.fillStyle='#fff'; ctx.font='600 15px -apple-system,Segoe UI,Roboto,sans-serif'
    ctx.textBaseline='middle'; ctx.fillText(tool.name,-w/2+14,-h/2+17)
    // glyph
    ctx.fillStyle=tool.color; ctx.globalAlpha=alpha*detail*.16
    ctx.beginPath(); ctx.arc(0,6,Math.min(w,h)*.19,0,Math.PI*2); ctx.fill()
    ctx.globalAlpha=alpha*detail
    ctx.fillStyle=tool.color; ctx.textAlign='center'
    ctx.font='700 '+Math.round(Math.min(w,h)*.2)+'px -apple-system,Segoe UI,Roboto,sans-serif'
    ctx.fillText(tool.glyph,0,8)
    ctx.textAlign='left'
    // ruled lines
    ctx.fillStyle='#e6e9ef'
    for(let i=0;i<4;i++){
      const lw=(i%2?0.52:0.72)*w
      ctx.fillRect(-w/2+14, h/2-58+i*13, lw, 5)
    }
  }
  ctx.strokeStyle='rgba(15,23,42,.10)'; ctx.lineWidth=1
  ctx.globalAlpha=alpha; rr(ctx,-w/2,-h/2,w,h,14); ctx.stroke()
  ctx.restore()
}

/** The assembled browser window. \`lit\` = how many toolbar buttons glow. */
function browser(ctx,w,h,alpha,lit){
  ctx.save(); ctx.globalAlpha=alpha
  ctx.shadowColor='rgba(10,15,30,.30)'; ctx.shadowBlur=60; ctx.shadowOffsetY=22
  ctx.fillStyle='#fff'; rr(ctx,-w/2,-h/2,w,h,16); ctx.fill()
  ctx.shadowColor='transparent'

  // tab strip
  ctx.fillStyle='#f6f7f9'; rr(ctx,-w/2,-h/2,w,74,16); ctx.fill()
  ctx.fillRect(-w/2,-h/2+40,w,34)
  ;['#ff5f57','#febc2e','#28c840'].forEach((c,i)=>{
    ctx.fillStyle=c; ctx.beginPath(); ctx.arc(-w/2+22+i*18,-h/2+20,5.5,0,Math.PI*2); ctx.fill()
  })
  // active tab
  ctx.fillStyle='#fff'; rr(ctx,-w/2+96,-h/2+8,190,32,7); ctx.fill()
  ctx.fillStyle='#0070f3'; ctx.fillRect(-w/2+96,-h/2+8,190,2.5)
  ctx.fillStyle='#c9ced8'; rr(ctx,-w/2+110,-h/2+21,120,5,2.5); ctx.fill()

  // toolbar + omnibox
  ctx.fillStyle='#dfe3ea'
  ;[0,1,2].forEach(i=>{ ctx.beginPath(); ctx.arc(-w/2+26+i*26,-h/2+57,5,0,Math.PI*2); ctx.fill() })
  ctx.fillStyle='#f1f3f6'; rr(ctx,-w/2+104,-h/2+43,w-104-150,28,14); ctx.fill()
  ctx.fillStyle='#c9ced8'; rr(ctx,-w/2+120,-h/2+55,150,4,2); ctx.fill()

  // the four tool buttons — the sheets, now bound in
  TOOLS.forEach((tl,i)=>{
    const bx=w/2-124+i*30, by=-h/2+57
    const on=lit>i
    ctx.globalAlpha=alpha*(on?1:.32)
    ctx.fillStyle=on?tl.color:'#c9ced8'
    ctx.beginPath(); ctx.arc(bx,by,9,0,Math.PI*2); ctx.fill()
    if(on){ // live pulse ring
      ctx.globalAlpha=alpha*.22
      ctx.beginPath(); ctx.arc(bx,by,9+ (lit-i>1?0:6),0,Math.PI*2); ctx.fill()
    }
  })
  ctx.globalAlpha=alpha

  // page body
  ctx.fillStyle='#fbfcfd'; ctx.fillRect(-w/2+1,-h/2+74,w-2,h-76)
  ctx.fillStyle='#eef1f5'
  for(let i=0;i<7;i++) rr(ctx,-w/2+34,-h/2+108+i*26,(i%3===0?.58:i%3===1?.86:.42)*(w-68),9,4.5), ctx.fill()
  ctx.strokeStyle='rgba(15,23,42,.10)'; ctx.lineWidth=1; rr(ctx,-w/2,-h/2,w,h,16); ctx.stroke()
  ctx.restore()
}

// Where each sheet starts (scattered) — deterministic, not random.
const START = [
  { x:-0.33, y:-0.21, r:-0.28, s:1.00 },
  { x: 0.35, y:-0.17, r: 0.24, s:0.92 },
  { x:-0.31, y: 0.21, r: 0.20, s:0.96 },
  { x: 0.33, y: 0.19, r:-0.22, s:0.88 }
]

window.drawScene = function(t){
  // backdrop: a soft cool wash, brightening as things come together
  const g=x.createLinearGradient(0,0,0,H)
  const warm=easeInOut(seg(t,.55,1))
  g.addColorStop(0, warm>.5?'#eef4ff':'#e8edf7')
  g.addColorStop(1, '#dfe6f2')
  x.fillStyle=g; x.fillRect(0,0,W,H)

  // vignette
  const rg=x.createRadialGradient(W/2,H*.45,80,W/2,H*.45,W*.72)
  rg.addColorStop(0,'rgba(255,255,255,.55)'); rg.addColorStop(1,'rgba(255,255,255,0)')
  x.fillStyle=rg; x.fillRect(0,0,W,H)

  x.save(); x.translate(W/2,H/2)

  const converge = easeInOut(seg(t,.06,.46))   // scattered -> aligned stack
  const bind     = easeInOut(seg(t,.46,.72))   // stack -> single volume
  const become   = easeInOut(seg(t,.68,.88))   // volume -> browser window
  const lightUp  = seg(t,.86,1)                // toolbar buttons switch on

  const SW=300, SH=380

  // Sheets: scatter -> stack -> collapse into the window
  if(become<1){
    TOOLS.forEach((tool,i)=>{
      const s=START[i]
      // stacked position: a slight sheaf fan
      const stackX=lerp(0,(i-1.5)*10,1-bind)
      const stackY=(i-1.5)*14*(1-bind*0.75)
      const px=lerp(s.x*W, stackX, converge)
      const py=lerp(s.y*H, stackY, converge)
      const rot=lerp(s.r, (i-1.5)*0.012*(1-bind), converge)
      const sc=lerp(s.s, lerp(1,0.62,become), converge)
      const alpha=(1-become)*clamp(seg(t,.02+i*.012,.14+i*.012),0,1)
      if(alpha<=0.01) return
      x.save(); x.translate(px,py); x.rotate(rot); x.scale(sc,sc)
      sheet(x,SW,SH,tool,alpha,easeOut(seg(t,.03,.22)))
      x.restore()
    })
  }

  // The bound volume becomes the browser. Drawn at a fixed design size and
  // scaled into place — lerping the width made inner elements (the omnibox)
  // compute negative widths early in the transition.
  if(become>0.01){
    const s=lerp(0.30,1,become)
    x.save(); x.scale(s,s)
    browser(x,980,600,easeOut(become),Math.floor(lightUp*4.2))
    x.restore()
  }

  x.restore()
}
`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff}
  canvas{display:block}
</style></head><body>
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>${SCENE}<\/script>
</body></html>`

const tmpHtml = path.join(ROOT, '.frames-scene.html')
fs.writeFileSync(tmpHtml, html)

const electronBin =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(ROOT, 'node_modules/electron/dist/electron')

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, SHEAF_USER_DATA: path.join(ROOT, '.frames-profile') },
  timeout: 40_000
})
await app.firstWindow()

// Render in a purpose-made window, NOT the app's own chrome: that one has a
// preload, contextIsolation and a strict CSP that blocks the inline scene.
await app.evaluate(async ({ BrowserWindow }, { file, w, h }) => {
  globalThis.__render = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    useContentSize: true,
    webPreferences: { contextIsolation: false, offscreen: false }
  })
  await globalThis.__render.loadFile(file)
}, { file: tmpHtml, w: W, h: H })

for (let i = 0; i < FRAMES; i++) {
  const t = i / (FRAMES - 1)
  const b64 = await app.evaluate(async (_e, tt) => {
    const win = globalThis.__render
    await win.webContents.executeJavaScript(`window.drawScene(${tt});true`)
    const img = await win.webContents.capturePage()
    return img.toJPEG(82).toString('base64')
  }, t)
  fs.writeFileSync(path.join(OUT, `frame-${String(i).padStart(3, '0')}.jpg`), Buffer.from(b64, 'base64'))
  if (i % 25 === 0) console.log(`frame ${i}/${FRAMES}`)
}

await app.evaluate(() => globalThis.__render?.destroy()).catch(() => {})
await app.close().catch(() => {})
fs.rmSync(tmpHtml, { force: true })
fs.rmSync(path.join(ROOT, '.frames-profile'), { recursive: true, force: true })

const bytes = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0)
console.log(`\n${FRAMES} frames -> site/frames (${(bytes / 1e6).toFixed(1)} MB)`)
