// Imagens de exemplo da Fase 0: composições SVG geradas a partir da paleta.
// Vêm do protótipo e somem quando o pipeline de mídia real (Fase 3) entrar.

export interface FakeImage {
  kind: 'landscape' | 'swatch' | 'arch' | 'type' | 'bottle' | 'waves' | 'blocks'
  w: number
  h: number
  pal: string[]
}

export function fakeImageSrc(i: FakeImage): string {
  const [a, b, c, d, e] = i.pal
  const { w, h } = i
  let body = ''
  switch (i.kind) {
    case 'landscape':
      body = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w * 0.68}" cy="${h * 0.42}" r="${w * 0.12}" fill="${b}"/>
      <path d="M0 ${h * 0.68} Q ${w * 0.25} ${h * 0.5} ${w * 0.5} ${h * 0.66} T ${w} ${h * 0.6} V ${h} H 0Z" fill="${d}"/>
      <path d="M0 ${h * 0.82} Q ${w * 0.3} ${h * 0.7} ${w * 0.62} ${h * 0.84} T ${w} ${h * 0.8} V ${h} H 0Z" fill="${e}"/>`
      break
    case 'swatch': {
      const cw = w / 5
      body = i.pal.map((p, k) => `<rect x="${k * cw}" y="0" width="${cw + 1}" height="${h}" fill="${p}"/>`).join('') +
        `<rect x="${w * 0.08}" y="${h * 0.62}" width="${w * 0.84}" height="${h * 0.26}" rx="6" fill="${d}"/>
        <rect x="${w * 0.12}" y="${h * 0.68}" width="${w * 0.5}" height="${h * 0.05}" fill="${a}"/>
        <rect x="${w * 0.12}" y="${h * 0.77}" width="${w * 0.32}" height="${h * 0.04}" fill="${b}"/>`
      break
    }
    case 'arch':
      body = `<rect width="${w}" height="${h}" fill="${a}"/>` +
        [0, 1, 2].map((k) => {
          const x = w * (0.1 + k * 0.29), aw = w * 0.22, top = h * 0.25
          return `<path d="M${x} ${h} V ${top + aw / 2} A ${aw / 2} ${aw / 2} 0 0 1 ${x + aw} ${top + aw / 2} V ${h}Z" fill="${[b, c, d][k]}"/>`
        }).join('') + `<rect y="${h * 0.9}" width="${w}" height="${h * 0.1}" fill="${e}"/>`
      break
    case 'type':
      body = `<rect width="${w}" height="${h}" fill="${a}"/>
      <text x="${w * 0.08}" y="${h * 0.62}" font-family="Georgia, serif" font-size="${h * 0.48}" fill="${b}">Ag</text>
      <rect x="${w * 0.08}" y="${h * 0.74}" width="${w * 0.6}" height="3" fill="${d}"/>
      <text x="${w * 0.08}" y="${h * 0.84}" font-family="monospace" font-size="${h * 0.045}" fill="${e}">ABCDEFGHIJ 0123456789</text>
      <circle cx="${w * 0.86}" cy="${h * 0.18}" r="${w * 0.05}" fill="${d}"/>`
      break
    case 'bottle':
      body = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <ellipse cx="${w / 2}" cy="${h * 0.86}" rx="${w * 0.26}" ry="${h * 0.025}" fill="${e}" opacity=".18"/>
      <rect x="${w * 0.3}" y="${h * 0.38}" width="${w * 0.4}" height="${h * 0.48}" rx="${w * 0.06}" fill="${b}"/>
      <rect x="${w * 0.42}" y="${h * 0.28}" width="${w * 0.16}" height="${h * 0.1}" rx="6" fill="${c}"/>
      <rect x="${w * 0.38}" y="${h * 0.56}" width="${w * 0.24}" height="${h * 0.1}" fill="${d}"/>
      <rect x="${w * 0.33}" y="${h * 0.4}" width="${w * 0.04}" height="${h * 0.42}" rx="6" fill="${d}" opacity=".35"/>`
      break
    case 'waves':
      body = `<rect width="${w}" height="${h}" fill="${a}"/>` +
        [b, e, c, d].map((p, k) => {
          const y = h * (0.3 + k * 0.17)
          return `<path d="M0 ${y} C ${w * 0.3} ${y - h * 0.12} ${w * 0.6} ${y + h * 0.12} ${w} ${y - h * 0.04} V ${h} H 0Z" fill="${p}"/>`
        }).join('')
      break
    case 'blocks':
      body = `<rect width="${w}" height="${h}" fill="${d}"/>
      <rect x="${w * 0.08}" y="${h * 0.1}" width="${w * 0.5}" height="${h * 0.5}" fill="${a}"/>
      <circle cx="${w * 0.66}" cy="${h * 0.56}" r="${w * 0.22}" fill="${b}"/>
      <rect x="${w * 0.2}" y="${h * 0.68}" width="${w * 0.3}" height="${h * 0.22}" fill="${c}"/>
      <rect x="${w * 0.72}" y="${h * 0.12}" width="${w * 0.14}" height="${w * 0.14}" fill="${e}"/>`
      break
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
