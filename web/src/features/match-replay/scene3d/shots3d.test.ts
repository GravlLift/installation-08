import { describe, expect, it } from 'vitest'

import { BEAM_GLOW_DIM, BEAM_GLOW_MULT, BEAM_RADIUS, BEAM_SECONDS, BOLT_SPEED, IMPACT_SECONDS, TRACER_LENGTH, TRACER_SPEED, beamFade, formeVol, impactAge, lunetteSansGerbe, shotLineShown, tracerSpan } from './shots3d'

describe('le tir par défaut ressemble au jeu', () => {
  it('une balle vit le temps de son vol, jamais suspendue dans l air', () => {
    // 80 u (portée) à 300 u/s : moins d'un tiers de seconde de la bouche au mur.
    expect(tracerSpan(80, 0.27)).not.toBeNull()
    expect(tracerSpan(80, (80 + TRACER_LENGTH) / TRACER_SPEED)).toBeNull()
    const span = tracerSpan(80, 0.1)
    expect(span && span.head - span.tail).toBeCloseTo(TRACER_LENGTH)
  })

  it('un projectile d énergie est un point qui file plus lentement, sans trait', () => {
    const speed = BOLT_SPEED.plasma ?? 0
    expect(speed).toBeLessThan(TRACER_SPEED)
    const span = tracerSpan(30, 0.2, speed, 0)
    expect(span).toEqual({ tail: 0.2 * speed, head: 0.2 * speed })
    expect(impactAge(30, 30 / speed + 0.01, speed)).toBeCloseTo(0.01)
  })

  it('la ligne de tir entière ne se montre que demandée, le temps de la rémanence', () => {
    expect(shotLineShown(0.3, -1)).toBe(false)
    expect(shotLineShown(0.3, 0.6)).toBe(true)
    expect(shotLineShown(0.7, 0.6)).toBe(false)
  })
})

describe('tracerSpan', () => {
  it('fait avancer un trait court à la vitesse de la balle', () => {
    const t = 10 / TRACER_SPEED
    expect(tracerSpan(30, t)).toEqual({ tail: 10 - TRACER_LENGTH, head: 10 })
  })

  it('part de la bouche : la queue ne recule jamais derrière elle', () => {
    expect(tracerSpan(30, 0)).toEqual({ tail: 0, head: 0 })
  })

  it('rentre dans le point d impact puis s éteint', () => {
    const arrived = tracerSpan(30, 30.5 / TRACER_SPEED)
    expect(arrived?.head).toBe(30)
    expect(arrived?.tail).toBeCloseTo(30.5 - TRACER_LENGTH)
    expect(tracerSpan(30, (30 + TRACER_LENGTH) / TRACER_SPEED)).toBeNull()
  })

  it('un vol court vit moins longtemps qu un vol long', () => {
    expect(tracerSpan(2, 0.05)).toBeNull()
    expect(tracerSpan(30, 0.05)).not.toBeNull()
  })
})

describe('impactAge', () => {
  it('ne jette l étincelle qu à l arrivée de la balle, et brièvement', () => {
    const arrival = 30 / TRACER_SPEED
    expect(impactAge(30, arrival - 0.01)).toBeNull()
    expect(impactAge(30, arrival + 0.01)).toBeCloseTo(0.01)
    expect(impactAge(30, arrival + IMPACT_SECONDS)).toBeNull()
  })

  it('un vol de distance nulle (faisceau) jette l étincelle à l instant du tir', () => {
    expect(impactAge(0, 0)).toBe(0)
    expect(impactAge(0, IMPACT_SECONDS / 2)).toBeCloseTo(IMPACT_SECONDS / 2)
    expect(impactAge(0, IMPACT_SECONDS)).toBeNull()
  })
})

describe('formeVol', () => {
  it('le tir de choc est un faisceau instantané, pas une balle ni un point', () => {
    expect(formeVol('shock')).toBe('beam')
  })

  it('les projectiles d énergie sont des points de feu', () => {
    expect(formeVol('plasma')).toBe('bolt')
    expect(formeVol('needles')).toBe('bolt')
  })

  it('les autres familles tirent un trait court à la vitesse de la balle', () => {
    expect(formeVol('ballistic')).toBe('tracer')
    expect(formeVol('light')).toBe('tracer')
    expect(formeVol('explosive')).toBe('tracer')
    expect(formeVol('plain')).toBe('tracer')
  })
})

describe('beamFade', () => {
  it('le faisceau est plein à l instant du tir', () => {
    expect(beamFade(0)).toBe(1)
    expect(beamFade(-0.1)).toBe(0)
  })

  it('il fond linéairement et est éteint après sa durée', () => {
    expect(beamFade(BEAM_SECONDS / 2)).toBeCloseTo(0.5)
    expect(beamFade(BEAM_SECONDS)).toBe(0)
    expect(beamFade(BEAM_SECONDS + 0.05)).toBe(0)
  })
})

describe('la lueur du faisceau', () => {
  it('le rayon est un multiple nommé du cœur et l intensité une fraction nommée', () => {
    expect(BEAM_GLOW_MULT).toBe(4)
    expect(BEAM_GLOW_MULT * BEAM_RADIUS).toBeGreaterThan(BEAM_RADIUS)
    expect(BEAM_GLOW_DIM).toBeCloseTo(0.25)
    expect(BEAM_GLOW_DIM).toBeLessThan(1)
  })
})


describe('lunetteSansGerbe', () => {
  it('un tir de la vue 1re personne n a pas de gerbe quand la lunette est montée', () => {
    expect(lunetteSansGerbe(true, true)).toBe(true)
  })

  it('la gerbe de la vue 1re personne reste sans lunette', () => {
    expect(lunetteSansGerbe(true, false)).toBe(false)
  })

  it('la lunette du joueur suivi ne retire pas la gerbe d un tir vu de 3e personne', () => {
    expect(lunetteSansGerbe(false, true)).toBe(false)
  })
})
