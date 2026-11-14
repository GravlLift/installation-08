/**
 * The loading state of the 3D map. `materials` and `index` carry a `done` /
 * `total` progress (decoded images, built rays index): the bar advances as units complete, not in a
 * single jump. Without a count, the fraction is the beginning of their band.
 */
export type LoadState =
  | { kind: 'download'; loaded: number; total: number }
  | { kind: 'materials' | 'index'; done?: number; total?: number }
  | { kind: 'assets' | 'warmup' | 'ready' | 'error' }

const DOWNLOAD = 0
const MATERIALS = 0.15
const INDEX = 0.5
const ASSETS = 0.55
const WARMUP = 0.9
const READY = 1

function ratio(done: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
}

export function fractionChargement3d(load: LoadState, started = 0, finished = 0): number {
  switch (load.kind) {
    case 'download': return DOWNLOAD + (MATERIALS - DOWNLOAD) * ratio(load.loaded, load.total)
    case 'materials': return MATERIALS + (INDEX - MATERIALS) * ratio(load.done ?? 0, load.total ?? 0)
    case 'index': return INDEX + (ASSETS - INDEX) * ratio(load.done ?? 0, load.total ?? 0)
    case 'assets': return ASSETS + (WARMUP - ASSETS) * ratio(finished, started)
    case 'warmup': return WARMUP
    case 'ready': return READY
    case 'error': return DOWNLOAD
  }
}

export function monterSeulement(prev: number, next: number): number {
  return Math.max(prev, next)
}
