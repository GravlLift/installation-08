// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipmentKeys3d.ts — THE MODEL KEY OF AN EQUIPMENT FAMILY, read from the weapon library index
 * (`equipment`, written by the server from the title's equipment manifest: each family whose pickup
 * `eqip` objects share one model maps to the GlobalID of one of them, the key of its model in the
 * library; the two grapples, walls, sensors and thrusters each share one).
 *
 * A power-up or equipment pad publishes its item by family (`powerup_camo`, `wall`, `weaponPads[].weapon`), not by a
 * tag identifier: this table is how the view finds the game's model of that item. A family absent
 * from it has no model. While the index cannot be read (`indexField3d`) no family has one.
 */
import { IndexField, type FetchJson } from './indexField3d'

export type EquipmentKeyTable = Readonly<Record<string, string>>

/** A library model key of a tag: 8 lowercase hex digits. */
const TAG_KEY = /^[0-9a-f]{8}$/

/** parseEquipmentKeys reads the table out of an index document; null when the field is absent. */
export function parseEquipmentKeys(doc: unknown): EquipmentKeyTable | null {
  const raw = (doc as { equipment?: unknown } | null)?.equipment
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, string> = {}
  for (const [family, key] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && TAG_KEY.test(key)) out[family] = key
  }
  return out
}

/** EquipmentKeys — the table of the library served at `indexUrl`, read on first use. */
export class EquipmentKeys {
  private readonly table: IndexField<EquipmentKeyTable>

  constructor(indexUrl: string, fetchJson?: FetchJson) {
    this.table = new IndexField(indexUrl, parseEquipmentKeys, fetchJson)
  }

  /** key is the model key of the equipment family `family`, null when it has none (yet). */
  key(family: string): string | null {
    const table = this.table.get()
    return table && Object.prototype.hasOwnProperty.call(table, family) ? table[family] : null
  }

  dispose(): void {
    this.table.dispose()
  }
}
