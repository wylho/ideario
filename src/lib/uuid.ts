/** UUID v7 (RFC 9562): 48 bits de timestamp em ms seguidos de bits aleatórios. Ordena por criação. */
export function uuidv7(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  const ts = Date.now()
  const hi = Math.floor(ts / 2 ** 16)
  b[0] = (hi >>> 24) & 0xff
  b[1] = (hi >>> 16) & 0xff
  b[2] = (hi >>> 8) & 0xff
  b[3] = hi & 0xff
  b[4] = (ts >>> 8) & 0xff
  b[5] = ts & 0xff
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
