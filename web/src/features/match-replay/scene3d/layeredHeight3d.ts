// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Les hauteurs de couches, selon Ekur `layer_blending`, `heightblend` et `heightaccum_l1`. */
export function hauteurInitiale(scale: number, controle: number, masque: number): number {
  return Math.max(0, Math.min(4, scale * (controle + masque - 1)))
}

type ReglageHauteur = { scale: number; rang: number; range: number; opacite: number; accumulation: number }
export function poidsHauteur(h: number, controle: number, masque: number, p: ReglageHauteur): { poids: number; hauteur: number } {
  const next = Math.max(0, Math.min(4, p.scale * (controle + masque - 1) + (p.rang - 1) * masque))
  const seuil = Math.min(p.rang - 1, h - 0.5 * p.range)
  const x = Math.max(0, Math.min(1, (next - seuil) / Math.max(p.range, 0.0001)))
  return { poids: (p.opacite < 0 ? 1 - x : x) * p.opacite, hauteur: h + p.accumulation * (Math.max(h, next) - h) }
}
