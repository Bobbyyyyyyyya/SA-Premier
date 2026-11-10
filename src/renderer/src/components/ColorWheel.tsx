import { useEffect, useRef, useState } from 'react'

/** De hue-ring begint op deze fractie van de halve wieldiameter. */
const RING = 0.74

/** #rrggbb (of #rgb) → hsv, zodat het wiel in hue/saturatie kan rekenen. */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const c = hex.trim().replace('#', '')
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c
  const n = /^[0-9a-f]{6}$/i.test(full) ? parseInt(full, 16) : 0
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex(h: number, s: number, v: number): string {
  const channel = (n: number): string => {
    const k = (n + h / 60) % 6
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}

/**
 * Kleurenwiel dat meteen in de Inspector staat: buitenring = hue, de schijf
 * erbinnen = saturatie van die hue, de schuif eronder = helderheid. Slepen op
 * het wiel werkt direct, dus er hoeft geen native kleurkiezer meer open.
 */
export default function ColorWheel({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}): JSX.Element {
  const [hs, setHs] = useState(() => hexToHsv(value))
  const hsRef = useRef(hs)
  hsRef.current = hs
  const wheelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const next = hexToHsv(value)
    setHs((prev) => {
      // Kwam deze hex uit dit wiel, dan kloppen hue/sat al; zwart of wit
      // verklapt ze niet, dus bewaren we wat de gebruiker koos.
      const same = hsvToHex(prev.h, prev.s, next.v) === value.trim().toLowerCase()
      return same ? { h: prev.h, s: prev.s, v: next.v } : next
    })
  }, [value])

  const emit = (h: number, s: number, v: number): void => {
    const next = { h, s, v }
    hsRef.current = next
    setHs(next)
    onChange(hsvToHex(h, s, v))
  }

  const pick = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = wheelRef.current?.getBoundingClientRect()
    if (!rect) return
    const half = rect.width / 2
    const dx = e.clientX - rect.left - half
    const dy = e.clientY - rect.top - half
    const norm = Math.min(1, Math.hypot(dx, dy) / half)
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360
    const cur = hsRef.current
    const s = norm >= RING ? cur.s : Math.min(1, norm / RING)
    // Schaduw en midden staan standaard op zwart; zonder deze lift zou het
    // wiel niets lijken te doen. Buiten het midden kiezen = volle helderheid.
    const v = s > 0.02 && cur.v < 0.15 ? 1 : cur.v
    emit(hue, s, v)
  }

  const { h, s, v } = hs
  const l = v * 50
  const disc = `radial-gradient(circle at 50% 50%, hsl(${h} 0% ${l}%) 0%, hsl(${h} 100% ${l}%) 100%)`
  const ang = ((h - 90) * Math.PI) / 180
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)

  return (
    <div className="cw">
      <div
        className="cw-wheel"
        ref={wheelRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} kleur`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(h)}
        aria-valuetext={value}
        title={`${label}: sleep op het wiel voor kleur, schuif eronder voor helderheid`}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 0 && e.currentTarget.hasPointerCapture(e.pointerId)) pick(e)
        }}
        onKeyDown={(e) => {
          const cur = hsRef.current
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            emit((cur.h + 355) % 360, cur.s, cur.v)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            emit((cur.h + 5) % 360, cur.s, cur.v)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            emit(cur.h, Math.min(1, cur.s + 0.05), cur.v)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            emit(cur.h, Math.max(0, cur.s - 0.05), cur.v)
          }
        }}
      >
        <div className="cw-disc" style={{ background: disc }} />
        <div className="cw-ring-mark" style={{ left: `${50 + cos * 42}%`, top: `${50 + sin * 42}%` }} />
        <div
          className="cw-marker"
          style={{
            left: `${50 + cos * 50 * RING * s}%`,
            top: `${50 + sin * 50 * RING * s}%`,
            background: value
          }}
        />
      </div>
      <div className="cw-info">
        <div className="cw-head">
          <span className="cw-label">{label}</span>
          <span className="cw-hex">{value.toUpperCase()}</span>
        </div>
        <input
          className="cw-luma"
          type="range"
          min={0}
          max={100}
          value={Math.round(v * 100)}
          aria-label={`${label} helderheid`}
          title="Helderheid"
          onChange={(e) => emit(hsRef.current.h, hsRef.current.s, +e.target.value / 100)}
        />
      </div>
    </div>
  )
}
