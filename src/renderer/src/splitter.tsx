import './theme/global.css'

/**
 * The draggable divider between the page and the docked DevTools.
 *
 * Why this is its own native view: the page and DevTools are WebContentsViews
 * composited over the chrome, so a DOM divider in the chrome would be painted
 * underneath them and never see a click. And once a drag starts the pointer
 * leaves the thin divider — native views only receive events inside their own
 * bounds — so main *expands this view to cover the whole content area* for the
 * duration of the drag. It's transparent, so all the user sees is the handle.
 */
const api = window.sheaf
const root = document.getElementById('root')!
root.className = 'split-handle'

let dragging = false

root.addEventListener('mousedown', (e) => {
  e.preventDefault()
  dragging = true
  document.body.classList.add('dragging')
  void api.invoke('devtools:dragStart')
})

window.addEventListener('mousemove', (e) => {
  if (!dragging) return
  // Coordinates are relative to this view; main knows where the view sits.
  void api.invoke('devtools:dragMove', e.clientX, e.clientY)
})

window.addEventListener('mouseup', () => {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('dragging')
  void api.invoke('devtools:dragEnd')
})
