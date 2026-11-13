/** Une exécution à la fois ; les demandes concurrentes partagent la suivante. */
export function serialiser(travail: () => Promise<void>): () => Promise<void> {
  let active: Promise<void> | null = null
  let suivante: Promise<void> | null = null
  const lancer = (): Promise<void> => {
    if (active) {
      suivante ??= active.then(() => { suivante = null; return lancer() })
      return suivante
    }
    const cours = (async () => travail())()
    active = cours.finally(() => { active = null })
    return active
  }
  return lancer
}
