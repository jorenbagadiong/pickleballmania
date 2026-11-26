import {
  type Bounds,
  FIXED_DT,
  type InputFrame,
  type MovingBody,
  type PlanarPosition,
  sanitizeIntent,
  stepPlayer,
} from '@pickleball/shared'

/** Errors larger than this (meters) are treated as a teleport (e.g. serve reset) and snapped. */
const SNAP_DISTANCE = 1.5
/** How quickly small corrections are blended away (1/s). */
const CORRECTION_RATE = 12
const MAX_PENDING = 240

/**
 * Client-side prediction for the local player only. It runs the same shared
 * `stepPlayer` the server runs, then reconciles to each authoritative position
 * by replaying inputs the server has not acknowledged yet. The ball is never
 * predicted, so there is only one physics simulation: the server's.
 */
export class LocalPrediction {
  readonly pos: MovingBody = { x: 0, z: 0, vx: 0, vz: 0 }
  private readonly correction = { x: 0, z: 0 }
  private pending: InputFrame[] = []
  private initialized = false
  private seq = 0

  reset(): void {
    this.pending = []
    this.initialized = false
    this.correction.x = 0
    this.correction.z = 0
  }

  nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  /** After a reconnect the server keeps the old lastSeq, so continue counting from it. */
  ensureSeqAtLeast(seq: number): void {
    if (this.seq < seq) this.seq = seq
  }

  get pendingCount(): number {
    return this.pending.length
  }

  applyLocal(frame: InputFrame, bounds: Bounds | null): void {
    this.pending.push(frame)
    if (this.pending.length > MAX_PENDING) this.pending.shift()
    if (bounds && this.initialized)
      stepPlayer(this.pos, sanitizeIntent(frame.mx, frame.mz), FIXED_DT, bounds)
  }

  reconcile(server: MovingBody, lastSeq: number, bounds: Bounds | null): void {
    this.ensureSeqAtLeast(lastSeq)
    this.pending = this.pending.filter((f) => f.seq > lastSeq)
    const p = { x: server.x, z: server.z, vx: server.vx, vz: server.vz }
    if (bounds)
      for (const f of this.pending) stepPlayer(p, sanitizeIntent(f.mx, f.mz), FIXED_DT, bounds)

    if (!this.initialized) {
      this.initialized = true
    } else {
      const ex = this.pos.x + this.correction.x - p.x
      const ez = this.pos.z + this.correction.z - p.z
      if (Math.hypot(ex, ez) > SNAP_DISTANCE) {
        this.correction.x = 0
        this.correction.z = 0
      } else {
        this.correction.x = ex
        this.correction.z = ez
      }
    }
    Object.assign(this.pos, p)
  }

  /** Smoothed position for rendering; small corrections fade out instead of popping. */
  display(dt: number, out: PlanarPosition): PlanarPosition {
    const k = Math.exp(-CORRECTION_RATE * dt)
    this.correction.x *= k
    this.correction.z *= k
    out.x = this.pos.x + this.correction.x
    out.z = this.pos.z + this.correction.z
    return out
  }

  /** How far the drawn position still is from the predicted one (meters). */
  get correctionSize(): number {
    return Math.hypot(this.correction.x, this.correction.z)
  }

  get ready(): boolean {
    return this.initialized
  }
}
