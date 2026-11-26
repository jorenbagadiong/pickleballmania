/** Tiny synthesized sound effects (WebAudio, no asset files). */
let ctx: AudioContext | null = null

/** Browsers only allow audio after a user gesture; call from click/key handlers. */
export function unlockAudio(): void {
  if (!ctx) {
    try {
      ctx = new AudioContext()
    } catch {
      return
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
}

function blip(freq: number, duration: number, volume: number, type: OscillatorType = 'sine'): void {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + duration)
  gain.gain.setValueAtTime(volume, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

export function playHit(power: number): void {
  blip(950 + power * 300, 0.07, 0.35, 'triangle')
}

export function playSmash(): void {
  blip(140, 0.22, 0.45)
}

export function playIgnite(): void {
  blip(110, 0.5, 0.25, 'sawtooth')
  blip(520, 0.35, 0.12, 'triangle')
}

export function playPerfect(): void {
  blip(1320, 0.18, 0.22, 'triangle')
  blip(1980, 0.25, 0.12)
}

export function playHeartbeat(): void {
  blip(70, 0.14, 0.5)
  setTimeout(() => blip(58, 0.18, 0.4), 180)
}

/** Crowd noise: filtered noise that swells and fades. */
export function playCheer(strength: number): void {
  if (!ctx || ctx.state !== 'running') return
  const seconds = 1.2 + strength
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1100
  filter.Q.value = 0.7
  const gain = ctx.createGain()
  const t = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.12 * Math.min(strength, 1.5), t + 0.15)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
  src.connect(filter).connect(gain).connect(ctx.destination)
  src.start(t)
}

export function playBounce(): void {
  blip(420, 0.06, 0.18)
}

export function playNet(): void {
  blip(180, 0.15, 0.2, 'sawtooth')
}

export function playSwish(power: number): void {
  blip(260 + power * 120, 0.12, 0.04, 'sawtooth')
}
