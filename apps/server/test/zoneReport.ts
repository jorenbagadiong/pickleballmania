/** Prints the TEZUKA ZONE interception table: `yarn workspace @pickleball/server zone:report`. */
import { ZONE_PRESETS } from '../src/simulation/zone'
import { FAST, ORDINARY, allTrials, runTrial, tally } from './zoneLab'

const SEEDS = [11, 22, 33]
const pct = (hit: number, n: number) => (n ? ((100 * hit) / n).toFixed(1) : '-').padStart(5)
const presets = [['none', null], ...Object.entries(ZONE_PRESETS)] as const
const started = performance.now()
for (const [name, preset] of presets) {
  const results = allTrials(preset, SEEDS).map((trial) => ({ trial, outcome: runTrial(trial) }))
  const rows = tally(results)
  const sum = (cats: readonly string[]) => {
    const r = rows.filter((x) => cats.includes(x.category))
    return [r.reduce((a, x) => a + x.hit, 0), r.reduce((a, x) => a + x.trials, 0)] as const
  }
  const [oh, on] = sum(ORDINARY)
  const [fh, fn] = sum(FAST)
  console.log(
    `\n== ${name}: ordinary ${pct(oh, on)}% (${oh}/${on}), fast ${pct(fh, fn)}% (${fh}/${fn})`,
  )
  for (const r of rows)
    console.log(`  ${r.category.padEnd(11)} ${pct(r.hit, r.trials)}%  ${r.hit}/${r.trials}`)
  const o = results.map((r) => r.outcome)
  console.log(
    `  maxSteer ${Math.max(...o.map((x) => x.maxSteer)).toFixed(2)}  maxChange ${Math.max(...o.map((x) => x.maxSteerChange)).toFixed(2)}  maxExcess ${Math.max(...o.map((x) => x.maxExcess)).toExponential(2)}  reversed ${o.filter((x) => x.reversed).length}  leaked ${o.filter((x) => x.leaked).length}  nonFinite ${o.filter((x) => !x.finite).length}`,
  )
}
console.log(`\n${((performance.now() - started) / 1000).toFixed(1)} s for all presets`)

// Cost on the server: one simulation tick with and without the zone steering a shot.
import { FIXED_DT, sideOf } from '@pickleball/shared'
import type { SimPlayer } from '../src/simulation/GameSimulation'
import { Lab, seeded, shotFor } from './zoneLab'
for (const withZone of [false, true]) {
  const times: number[] = []
  for (const category of ORDINARY) {
    for (let rep = 0; rep < 20; rep++) {
      const sim = new Lab(1, seeded(rep + 1))
      for (const id of ['z', 'o']) sim.addPlayer(id, id)
      for (const id of ['z', 'o']) sim.setReady(id, true)
      if (withZone) sim.zoneIds = new Set(['z'])
      const z = sim.players.get('z') as SimPlayer
      const o = sim.players.get('o') as SimPlayer
      const s = shotFor(category, sideOf(z.slot), z.x, seeded(rep + 7))
      sim.fire(o, z, 'rally', s.from, s.target, s.power, s.boost, s.spin)
      for (let i = 0; i < 300 && sim.phase === 'rally'; i++) {
        const t0 = performance.now()
        sim.step(FIXED_DT)
        times.push(performance.now() - t0)
      }
    }
  }
  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.floor(q * (times.length - 1))]!.toFixed(4)
  console.log(
    `tick ${withZone ? 'with zone   ' : 'without zone'}: median ${at(0.5)} ms, p99 ${at(0.99)} ms, max ${at(1)} ms (${times.length} ticks; budget ${(1000 * FIXED_DT).toFixed(1)} ms)`,
  )
}
