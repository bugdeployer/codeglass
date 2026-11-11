import { animate } from 'animejs'

/**
 * Flash every on-screen element tagged `data-file="<path>"` (or a folder that contains it,
 * tagged `data-folder`) — used when Claude or the file system touches a file.
 */
export function pulseFile(path: string, color = '#fbbf24') {
  const esc = (s: string) => s.replace(/["\\]/g, '\\$&')
  const parts = path.split('/')
  const sel = [`[data-file="${esc(path)}"]`]
  for (let i = 1; i < parts.length; i++) sel.push(`[data-folder="${esc(parts.slice(0, i).join('/'))}"]`)
  const nodes = document.querySelectorAll<HTMLElement | SVGElement>(sel.join(','))
  nodes.forEach((el) => {
    const isFile = el.hasAttribute('data-file')
    if (el instanceof SVGElement) {
      animate(el, {
        opacity: [{ to: 1, duration: 60 }, { to: isFile ? 1 : 0.9, duration: 900 }],
        strokeWidth: [{ to: isFile ? 5 : 3, duration: 120 }, { to: isFile ? 1 : 1, duration: 1100 }],
        stroke: [{ to: color, duration: 120 }],
        ease: 'outExpo',
      })
    } else {
      animate(el, {
        boxShadow: [`0 0 0 0 ${color}00`, `0 0 22px 4px ${color}aa`, `0 0 0 0 ${color}00`],
        duration: 1400,
        ease: 'outQuad',
      })
    }
  })
}
