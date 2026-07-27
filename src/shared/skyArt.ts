/**
 * The home page's sky: an icon, a gradient scene and ambient motion, chosen
 * purely from the **system clock**.
 *
 * No network, ever. This replaced a live-weather feature that called ipapi.co
 * (IP → city) and open-meteo.com — both of which forbid this kind of use on
 * their free tiers, and the first of which meant sending every user's IP to a
 * commercial third party just to decorate a new tab. Local time gives us dawn /
 * day / dusk / night, which is most of the charm at none of the cost.
 *
 * All art is original geometry (SVG + CSS keyframes), so there's nothing to
 * license and nothing to download.
 */

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night'

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Scene background for the time of day. Pure CSS gradients. */
export function sceneGradient(tod: TimeOfDay): string {
  const scenes: Record<TimeOfDay, string> = {
    dawn: 'linear-gradient(170deg,#f6b17a 0%,#7b6a9e 55%,#2b2f4a 100%)',
    day: 'linear-gradient(170deg,#5aa0d8 0%,#2b5876 60%,#16263a 100%)',
    dusk: 'linear-gradient(170deg,#e9714f 0%,#7b4a72 50%,#231d3a 100%)',
    night: 'linear-gradient(170deg,#1b2a4a 0%,#111827 60%,#080b12 100%)'
  }
  return scenes[tod]
}

/**
 * Sun / sunrise / sunset / moon for the time of day.
 *
 * `variant` matters: `scene` colours are light because they sit on the dark
 * gradient. Reusing those in UI chrome makes a near-white moon invisible on a
 * light toolbar — so `ui` inherits `currentColor` and reads in both themes.
 */
export function skyIcon(tod: TimeOfDay, size = 64, variant: 'scene' | 'ui' = 'scene'): string {
  const s = `width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true"`
  const ui = variant === 'ui'
  const sun = ui ? 'currentColor' : '#ffd166'
  const warm = ui ? 'currentColor' : '#ff9e6b'
  const moon = ui ? 'currentColor' : '#e8eaf0'

  if (tod === 'night') {
    return `<svg ${s}>
      <path fill="${moon}" d="M40 12a20 20 0 1 0 12 36A22 22 0 0 1 40 12z"/>
      ${ui ? '' : '<circle cx="17" cy="16" r="1.4" fill="#e8eaf0" opacity=".9"/><circle cx="52" cy="20" r="1" fill="#e8eaf0" opacity=".7"/><circle cx="24" cy="49" r="1.2" fill="#e8eaf0" opacity=".6"/>'}
    </svg>`
  }

  if (tod === 'dawn' || tod === 'dusk') {
    // Sun on the horizon, with a horizon line — reads as sunrise/sunset.
    const c = tod === 'dawn' ? sun : warm
    return `<svg ${s}>
      <circle cx="32" cy="38" r="11" fill="${c}"/>
      <g stroke="${c}" stroke-width="2.6" stroke-linecap="round" opacity=".9">
        <path d="M32 17v6M13 38h-5M56 38h-5M18 24l3.5 3.5M46 24l-3.5 3.5"/>
      </g>
      <path d="M6 48h52" stroke="${c}" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>
      <path d="M14 54h36" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".3"/>
    </svg>`
  }

  return `<svg ${s}>
    <circle cx="32" cy="32" r="12" fill="${sun}"/>
    <g stroke="${sun}" stroke-width="3" stroke-linecap="round">
      <path d="M32 8v6M32 50v6M8 32h6M50 32h6M15 15l4 4M45 45l4 4M49 15l-4 4M19 45l-4 4"/>
    </g></svg>`
}

/**
 * Ambient motion for the scene: birds and drifting clouds by day, a wind gust,
 * twinkling stars at night. Returns markup to drop into the page; pair with
 * SKY_FX_CSS. Honors prefers-reduced-motion.
 */
export function sceneAnimation(tod: TimeOfDay): string {
  const parts: string[] = []

  // Birds while it's light. None at night — they'd be invisible anyway.
  if (tod !== 'night') {
    const bird = (delay: number, top: number, dur: number) =>
      `<svg class="fx-bird" style="top:${top}%;animation-delay:${delay}s;animation-duration:${dur}s" width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden="true">
         <path d="M1 7c3-5 6-5 8 0 2-5 5-5 8 0" stroke="rgba(20,20,30,.5)" stroke-width="1.6" stroke-linecap="round"/>
       </svg>`
    parts.push(`<div class="fx-birds">${bird(0, 22, 26)}${bird(5, 30, 32)}${bird(11, 17, 29)}</div>`)
  }

  if (tod === 'night') {
    const stars = Array.from({ length: 40 }, (_, i) => {
      const left = (i * 7.3 + (i % 5) * 4) % 100
      const top = (i * 4.7 + (i % 7) * 3) % 62
      return `<i style="left:${left}%;top:${top}%;animation-delay:${(i % 9) * 0.7}s"></i>`
    }).join('')
    parts.push(`<div class="fx-stars">${stars}</div>`)
  } else {
    parts.push(
      `<div class="fx-clouds">
         <div class="fx-cloud" style="top:14%;--dur:70s;--scale:1.1"></div>
         <div class="fx-cloud" style="top:26%;--dur:95s;--scale:.8;animation-delay:-30s"></div>
         <div class="fx-cloud" style="top:8%;--dur:120s;--scale:1.4;animation-delay:-60s"></div>
       </div>`
    )
  }

  parts.push('<div class="fx-gust"></div>')
  return parts.join('')
}

/** Keyframes for sceneAnimation. Injected once into the home page. */
export const SKY_FX_CSS = `
  .fx-birds, .fx-clouds, .fx-stars { position:fixed; inset:0; z-index:-1; pointer-events:none; overflow:hidden; }
  .fx-bird { position:absolute; left:-40px; opacity:.55; animation-name:fx-fly; animation-timing-function:linear; animation-iteration-count:infinite; }
  @keyframes fx-fly {
    0% { transform:translateX(-6vw) translateY(0) scale(.9); }
    50% { transform:translateX(52vw) translateY(-22px) scale(1); }
    100% { transform:translateX(112vw) translateY(6px) scale(.9); }
  }
  .fx-cloud { position:absolute; left:-30vw; width:34vw; height:9vh; border-radius:50%;
    background:radial-gradient(closest-side, rgba(255,255,255,.30), rgba(255,255,255,0));
    transform:scale(var(--scale,1)); animation:fx-drift var(--dur,80s) linear infinite; }
  @keyframes fx-drift { 0% { left:-40vw; } 100% { left:120vw; } }
  .fx-stars i { position:absolute; width:2px; height:2px; border-radius:50%; background:#fff;
    animation:fx-twinkle 4s ease-in-out infinite; }
  @keyframes fx-twinkle { 0%,100% { opacity:.15; } 50% { opacity:.95; } }
  .fx-gust { position:fixed; inset:0; z-index:-1; pointer-events:none;
    background:linear-gradient(100deg, transparent 40%, rgba(255,255,255,.06) 50%, transparent 60%);
    background-size:220% 100%; animation:fx-gust 14s ease-in-out infinite; }
  @keyframes fx-gust { 0%,100% { background-position:120% 0; } 50% { background-position:-20% 0; } }
  /* Motion is decoration — never fight a user who asked for stillness. */
  @media (prefers-reduced-motion: reduce) {
    .fx-bird, .fx-cloud, .fx-stars i, .fx-gust { animation: none; }
    .fx-birds, .fx-stars, .fx-gust { display: none; }
  }
`
