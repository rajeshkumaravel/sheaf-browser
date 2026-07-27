/**
 * Renders the Sheaf application icon — original generated geometry, no stock
 * assets — and writes the master PNG. Platform formats (.icns/.ico/favicon)
 * are derived from it by `npm run icons` (see package.json).
 *
 *     node scripts/make-icons.mjs        # -> resources/icon-1024.png
 *
 * The mark tells the product story in one glyph: four tool sheets —
 * Letterhead (blue), Folio (green), Imprint (purple), Mailroom (amber) —
 * fanned like held papers and bound into a single sheaf.
 */
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'resources')
fs.mkdirSync(OUT, { recursive: true })

const S = 1024

const SCENE = `
const C = document.getElementById('c')
const x = C.getContext('2d')
const S = ${S}

function rr(a, b, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2))
  x.beginPath()
  x.moveTo(a + rad, b)
  x.arcTo(a + w, b, a + w, b + h, rad)
  x.arcTo(a + w, b + h, a, b + h, rad)
  x.arcTo(a, b + h, a, b, rad)
  x.arcTo(a, b, a + w, b, rad)
  x.closePath()
}

// ---- tile ----------------------------------------------------------------
// macOS-style rounded square, dark slate so the sheets pop in light and dark
// docks alike.
const g = x.createLinearGradient(0, 0, 0, S)
g.addColorStop(0, '#1b2233')
g.addColorStop(1, '#0d111e')
rr(0, 0, S, S, 232)
x.fillStyle = g
x.fill()

// faint vignette ring for depth
rr(6, 6, S - 12, S - 12, 226)
x.strokeStyle = 'rgba(255,255,255,0.06)'
x.lineWidth = 12
x.stroke()

// ---- sheets --------------------------------------------------------------
// Four sheets fanned around a pivot below the tile, like papers held in a
// hand. Outer pair first, inner pair on top.
const SHEET_W = 330
const SHEET_H = 470
const PIVOT_Y = 950 // pivot below the tile => gentle fan, centered composition
const COLORS = ['#0070f3', '#16a34a', '#7c3aed', '#f59e0b']
const ANGLES = [-24, -8, 8, 24] // degrees, left to right
const ORDER = [0, 3, 1, 2] // blue, amber behind; green, purple in front

function sheet(angleDeg, color) {
  x.save()
  x.translate(S / 2, PIVOT_Y)
  x.rotate((angleDeg * Math.PI) / 180)
  x.translate(-SHEET_W / 2, -700) // sheet sits above the pivot

  // drop shadow
  x.shadowColor = 'rgba(0,0,0,0.45)'
  x.shadowBlur = 34
  x.shadowOffsetY = 10

  // body
  rr(0, 0, SHEET_W, SHEET_H, 34)
  x.fillStyle = '#ffffff'
  x.fill()
  x.shadowColor = 'transparent'

  // colored header band (clip to the sheet's rounded top)
  rr(0, 0, SHEET_W, SHEET_H, 34)
  x.save()
  x.clip()
  x.fillStyle = color
  x.fillRect(0, 0, SHEET_W, 100)
  x.restore()

  // faint text lines so it reads as a document at large sizes
  x.fillStyle = 'rgba(15,20,35,0.12)'
  const lines = [
    [44, 160, 195], [44, 208, 240], [44, 256, 165],
    [44, 304, 225], [44, 352, 130]
  ]
  for (const [lx, ly, lw] of lines) {
    rr(lx, ly, lw, 18, 9)
    x.fill()
  }

  x.restore()
}

for (const i of ORDER) sheet(ANGLES[i], COLORS[i])

// ---- binding -------------------------------------------------------------
// The band that makes four sheets a sheaf. Drawn across the fan's waist,
// clipped to the tile.
rr(0, 0, S, S, 232)
x.save()
x.clip()
const band = x.createLinearGradient(0, 712, 0, 806)
band.addColorStop(0, '#2a3550')
band.addColorStop(1, '#1a2338')
rr(287, 712, 450, 94, 47)
x.fillStyle = band
x.fill()
rr(287, 712, 450, 94, 47)
x.strokeStyle = 'rgba(255,255,255,0.14)'
x.lineWidth = 6
x.stroke()
x.restore()

window.__done = true
`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:transparent}
  canvas{display:block}
</style></head><body>
<canvas id="c" width="${S}" height="${S}"></canvas>
<script>${SCENE}<\/script>
</body></html>`

const tmpHtml = path.join(ROOT, '.icon-scene.html')
fs.writeFileSync(tmpHtml, html)

const electronBin =
  process.platform === 'darwin'
    ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(ROOT, 'node_modules/electron/dist/electron')

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, SHEAF_USER_DATA: path.join(ROOT, '.icon-profile') },
  timeout: 40_000
})
await app.firstWindow()

const b64 = await app.evaluate(async ({ BrowserWindow }, { file, s }) => {
  const win = new BrowserWindow({
    width: s,
    height: s,
    show: false,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { contextIsolation: false }
  })
  await win.loadFile(file)
  await win.webContents.executeJavaScript('window.__done')
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: s, height: s })
  win.destroy()
  return img.toPNG().toString('base64')
}, { file: tmpHtml, s: S })

fs.writeFileSync(path.join(OUT, 'icon-1024.png'), Buffer.from(b64, 'base64'))
await app.close().catch(() => {})
fs.rmSync(tmpHtml, { force: true })
fs.rmSync(path.join(ROOT, '.icon-profile'), { recursive: true, force: true })
console.log('wrote resources/icon-1024.png')
