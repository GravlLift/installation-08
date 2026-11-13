/**
 * L'état de chargement de la carte 3D. `materials` et `index` portent une progression `done` /
 * `total` (images décodées, index de rayons bâtis) : la barre avance au fil des unités, pas en un
 * seul saut. Sans compte, la fraction est le début de leur bande.
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
