// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import {
  DECALEMENT_CHANGEMENT_ARME,
  nouvellePosePremierePersonne,
  phaseChangementArme,
  posePremierePersonne,
  type ChangementArme,
  type EvenementsPremierePersonne,
} from './firstPersonActions3d'
import type { RigPremierePersonne } from './premierePersonne3d'
import type { EpisodeRechargement } from './firstPersonReload3d'

function rigAvec(...noms: string[]): RigPremierePersonne {
  return { file: '', bones: 0, triangles: 0, bytes: 0, missingActions: [],
    clips: noms.map((nom) => ({ name: nom, action: nom, variant: 0, type: 'base', overlay: false, frameCount: 30, frameRate: 30, durationSeconds: 1 })),
    actions: noms.map((nom) => ({ action: nom, variant: 0, clip: nom })) }
}
const rig = rigAvec('reload_full', 'reload_empty', 'reload_enter', 'melee_strike_1', 'fire_1')
/** A one-message reload episode starting at frame 	. */
const ep = (t: number, vide: boolean | null = null): EpisodeRechargement => ({ etapes: [{ t, coupe: false }], vide })
function evenements(): EvenementsPremierePersonne {
  return { rechargements: [ep(10)], coups: [], tirs: [], grenades: [], changements: [], sprints: [], slides: [], accroupis: [], sauts: [], escalades: [], usages: [], frame: 12, fps: 10, rechargementValide: () => true }
}
function change(frame: number, avant: string | null = 'a', apres: string | null = 'b'): ChangementArme {
  return { frame, avant, apres }
}
const lire = (r: RigPremierePersonne, e: EvenementsPremierePersonne) => posePremierePersonne(r, e, nouvellePosePremierePersonne())

describe('actions première personne', () => {
  it('joue le rechargement puis le termine', () => {
    const e = evenements()
    expect(lire(rig, e).base?.action).toBe('reload_full')
    expect(lire(rig, e).tempsBase).toBeCloseTo(0.2)
    e.frame = 20
    expect(lire(rig, e).base).toBeNull()
  })
  it('annule le rechargement après un changement ou un tir', () => {
    const e = evenements()
    e.rechargementValide = () => false
    expect(lire(rig, e).base).toBeNull()
    e.rechargementValide = () => true
    e.tirs = [11]
    expect(lire(rig, e).base).toBeNull()
  })
  it('plays the repulsor use clip from its activation frame, over the reload, under a melee strike', () => {
    const r = rigAvec('reload_full', 'melee_strike_1', 'knockback:equipment_activate')
    const e = evenements(); e.usages = [{ frame: 11, action: 'knockback:equipment_activate' }]
    let pose = lire(r, e)
    expect(pose.base?.action).toBe('knockback:equipment_activate')
    expect(pose.tempsBase).toBeCloseTo(0.1)
    e.frame = 10.5
    expect(lire(r, e).base?.action).toBe('reload_full')
    e.frame = 21.5
    expect(lire(r, e).base).toBeNull()
    e.frame = 12; e.coups = [11.5]
    pose = lire(r, e)
    expect(pose.base?.action).toBe('melee_strike_1')
  })
  it('plays nothing for a use whose clip the rig lacks (library built before the clip existed)', () => {
    const e = evenements(); e.rechargements = []; e.usages = [{ frame: 11, action: 'knockback:equipment_activate' }]
    expect(lire(rig, e).base).toBeNull()
  })
  it('donne la priorité au coup de mêlée', () => {
    const e = evenements(); e.coups = [11]
    expect(lire(rig, e).base?.action).toBe('melee_strike_1')
  })
  it('le coup part à plein poids et coupe le tir qui le précède', () => {
    const e = evenements(); e.rechargements = []; e.tirs = [10]; e.coups = [11.5]
    const pose = lire(rig, e)
    expect(pose.base?.action).toBe('melee_strike_1')
    expect(pose.poidsBase).toBe(1)
    expect(pose.tir).toBeNull()
  })
  it('un tir donné après le coup rejoue par-dessus', () => {
    const e = evenements(); e.rechargements = []; e.coups = [10]; e.tirs = [11]
    const pose = lire(rig, e)
    expect(pose.base?.action).toBe('melee_strike_1')
    expect(pose.tir?.action).toBe('fire_1')
  })
  it('redémarre le tir au dernier événement', () => {
    const e = evenements(); e.tirs = [10, 11]
    expect(lire(rig, e).tempsTir).toBeCloseTo(0.1)
    e.frame = 10.5
    expect(lire(rig, e).tempsTir).toBeCloseTo(0.05)
  })
  it('choisit full puis empty puis enter', () => {
    const e = evenements()
    for (const [noms, attendu] of [
      [['reload_full', 'reload_empty', 'reload_enter'], 'reload_full'],
      [['reload_empty', 'reload_enter'], 'reload_empty'], [['reload_enter'], 'reload_enter'],
    ] as const) expect(lire(rigAvec(...noms), e).base?.action).toBe(attendu)
  })
  it('rend la même pose en reculant', () => {
    const e = evenements(); const pose = nouvellePosePremierePersonne()
    const avant = { ...posePremierePersonne(rig, e, pose) }
    e.frame = 25; posePremierePersonne(rig, e, pose)
    e.frame = 12
    expect(posePremierePersonne(rig, e, pose)).toEqual(avant)
  })
  it('ignore les actions absentes', () => {
    const e = evenements(); e.coups = [11]; e.tirs = [11]
    expect(lire(rigAvec(), e)).toEqual(nouvellePosePremierePersonne())
  })
  it('joue grenade et changement aux instants attendus, dans les deux sens', () => {
    const r = rigAvec('throw_grenade', 'ready')
    const e = evenements(); e.rechargements = []; e.grenades = [20]; e.changements = [change(10)]
    e.frame = 12
    const avant = lire(r, e)
    expect(avant.base?.action).toBe('ready'); expect(avant.tempsBase).toBeCloseTo(0.2)
    e.frame = 20
    expect(lire(r, e).base?.action).toBe('throw_grenade'); expect(lire(r, e).tempsBase).toBeCloseTo(0.25)
    e.frame = 30; expect(lire(r, e).base).toBeNull()
    e.frame = 12; expect(lire(r, e)).toEqual(avant)
    e.frame = 7; expect(lire(r, e).base).toBeNull()
    e.frame = 20; expect(lire(rigAvec(), e).base).toBeNull()
  })

  describe('changement d arme en main : mise puis tirage', () => {
    // Rig de l'arme qui part (A) : rangement 1 s ; rig de celle qui arrive (B) : tirage 1 s.
    const rigA = rigAvec('put_away', 'ready', 'fire_1', 'throw_grenade', 'reload_full', 'melee_strike_1')
    const rigB = rigAvec('ready', 'fire_1')
    const eChange = () => { const e = evenements(); e.rechargements = []; e.changements = [change(100)]; return e }
    it('joue le rangement de l arme avant le changement, le tirage apres', () => {
      const e = eChange()
      e.frame = 89.99; expect(lire(rigA, e).base).toBeNull()
      e.frame = 90; expect(lire(rigA, e).base?.action).toBe('put_away'); expect(lire(rigA, e).tempsBase).toBe(0)
      e.frame = 95; expect(lire(rigA, e).base?.action).toBe('put_away'); expect(lire(rigA, e).tempsBase).toBeCloseTo(0.5)
      e.frame = 100; expect(lire(rigB, e).base?.action).toBe('ready'); expect(lire(rigB, e).tempsBase).toBe(0)
      e.frame = 105; expect(lire(rigB, e).base?.action).toBe('ready'); expect(lire(rigB, e).tempsBase).toBeCloseTo(0.5)
      e.frame = 110; expect(lire(rigB, e).base).toBeNull()
      // Reculer redonne la meme image.
      e.frame = 95; const avant = lire(rigA, e)
      e.frame = 105; lire(rigB, e); e.frame = 95
      expect(lire(rigA, e)).toEqual(avant)
    })
    it('fond la mise au debut et le tirage a sa fin', () => {
      const e = eChange()
      e.frame = 90; expect(lire(rigA, e).poidsBase).toBe(0)
      e.frame = 90.5; expect(lire(rigA, e).poidsBase).toBeCloseTo(0.5)
      e.frame = 95; expect(lire(rigA, e).poidsBase).toBe(1)
      e.frame = 99.95; expect(lire(rigA, e).poidsBase).toBe(1)
      e.frame = 100; expect(lire(rigB, e).poidsBase).toBe(1)
      e.frame = 100.5; expect(lire(rigB, e).poidsBase).toBe(1)
      e.frame = 101; expect(lire(rigB, e).poidsBase).toBe(1)
      e.frame = 101.95; expect(lire(rigB, e).poidsBase).toBe(1)
      e.frame = 109.5; expect(lire(rigB, e).poidsBase).toBeCloseTo(0.5)
    })
    it('garde le tir par dessus le rangement', () => {
      const e = eChange(); e.frame = 95; e.tirs = [95]
      const pose = lire(rigA, e)
      expect(pose.base?.action).toBe('put_away')
      expect(pose.tir?.action).toBe('fire_1'); expect(pose.tempsTir).toBe(0); expect(pose.poidsTir).toBe(1)
    })
    it('garde les priorites des autres actions pendant le rangement', () => {
      const e = eChange(); e.frame = 95
      e.coups = [94]; expect(lire(rigA, e).base?.action).toBe('melee_strike_1')
      e.coups = []; e.rechargements = [ep(94)]; expect(lire(rigA, e).base?.action).toBe('reload_full')
      e.rechargements = []; e.grenades = [95]; expect(lire(rigA, e).base?.action).toBe('throw_grenade')
      e.grenades = []; expect(lire(rigA, e).base?.action).toBe('put_away')
    })
    it('ne range pas sans arme avant ni sans clip, et tire rien sans ready', () => {
      const eSpawn = eChange(); eSpawn.changements = [change(100, null, 'b')]; eSpawn.frame = 95
      expect(lire(rigA, eSpawn).base).toBeNull()
      const eSansClip = eChange(); eSansClip.frame = 95
      expect(lire(rigAvec('ready'), eSansClip).base).toBeNull()
      const eB = eChange(); eB.frame = 95
      expect(lire(rigA, eB).base?.action).toBe('put_away')
      eB.frame = 100.5
      expect(lire(rigAvec('fire_1'), eB).base).toBeNull()
    })
    it('ne range pas si le tirage de l arme avant n a pas fini', () => {
      const eRecent = eChange(); eRecent.changements = [change(99, 'c', 'a'), change(100, 'a', 'b')]; eRecent.frame = 99.5
      expect(lire(rigA, eRecent).base?.action).toBe('ready')
      const eFini = eChange(); eFini.changements = [change(90, 'c', 'a'), change(100, 'a', 'b')]; eFini.frame = 99.5
      expect(lire(rigA, eFini).base?.action).toBe('put_away')
      const eAutre = eChange(); eAutre.changements = [change(99, 'c', 'd'), change(100, 'a', 'b')]; eAutre.frame = 99.5
      expect(lire(rigA, eAutre).base?.action).toBe('put_away')
    })
    it('decale les deux phases du changement de leur decalage', () => {
      const r = rigAvec('put_away', 'ready')
      const changements = [change(100)]
      expect(phaseChangementArme(r, changements, 95, 10)?.phase).toBe('mise')
      expect(phaseChangementArme(r, changements, 91, 10, 0.2)).toBeNull()
      const miseDecalee = phaseChangementArme(r, changements, 95, 10, 0.2)
      expect(miseDecalee?.phase).toBe('mise'); expect(miseDecalee?.temps).toBeCloseTo(0.3); expect(miseDecalee?.poids).toBe(1)
      const pretDecale = phaseChangementArme(r, changements, 105, 10, 0.2)
      expect(pretDecale?.phase).toBe('pret'); expect(pretDecale?.temps).toBeCloseTo(0.3); expect(pretDecale?.poids).toBe(1)
      const miseTardive = phaseChangementArme(r, changements, 100.5, 10, 0.2)
      expect(miseTardive?.phase).toBe('mise'); expect(miseTardive?.temps).toBeCloseTo(0.85); expect(miseTardive?.poids).toBe(1)
      expect(phaseChangementArme(r, changements, 102, 10, 0.2)).toEqual({ phase: 'pret', temps: 0, poids: 1 })
      expect(phaseChangementArme(r, changements, 100.5, 10)).toEqual({ phase: 'pret', temps: 0.05, poids: 1 })
      expect(phaseChangementArme(r, changements, 95, 10, DECALEMENT_CHANGEMENT_ARME)).toEqual({ phase: 'mise', temps: 0.5, poids: 1 })
    })
    it('ne joue pas sur l arme qui arrive un tir ou un rechargement de l arme rangee', () => {
      const e = eChange(); e.tirs = [99]; e.rechargements = [ep(98)]; e.frame = 103
      const pose = lire(rigB, e)
      expect(pose.base?.action).toBe('ready'); expect(pose.poidsBase).toBe(1); expect(pose.tir).toBeNull()
      e.tirs = [99, 102]
      expect(lire(rigB, e).tir?.action).toBe('fire_1')
    })
    it('reste une fonction pure de l image', () => {
      const e = eChange(); const pose = nouvellePosePremierePersonne()
      e.frame = 95; const avant = { ...posePremierePersonne(rigA, e, pose) }
      e.frame = 120; posePremierePersonne(rigB, e, pose)
      e.frame = 95; expect(posePremierePersonne(rigA, e, pose)).toEqual(avant)
    })
  })
  it('boucle le sprint, respecte les tirs et reste déterministe', () => {
    const r = rigAvec('sprint_loop'); const e = evenements()
    e.rechargements = []; e.sprints = [{ t0: 10, t1: 40 }]; e.frame = 23
    const avant = lire(r, e)
    expect(avant.base?.action).toBe('sprint_loop'); expect(avant.tempsBase).toBeCloseTo(0.3)
    e.frame = 41; expect(lire(r, e).base).toBeNull()
    e.frame = 23; expect(lire(r, e)).toEqual(avant)
    e.tirs = [21]; expect(lire(r, e).base).toBeNull()
    e.tirs = []; expect(lire(rigAvec(), e).base).toBeNull()
    e.frame = 9; expect(lire(r, e).base).toBeNull()
  })
  it('joue les transitions de sprint selon les images, même en reculant', () => {
    const r = rigAvec('sprint_enter', 'sprint_loop', 'sprint_exit'); const e = evenements()
    e.rechargements = []; e.sprints = [{ t0: 10, t1: 40 }]
    e.frame = 10; expect(lire(r, e).base?.action).toBe('sprint_enter'); expect(lire(r, e).tempsBase).toBe(0)
    e.frame = 15; const milieu = lire(r, e); expect(milieu.tempsBase).toBeCloseTo(0.5)
    e.frame = 20; expect(lire(r, e).base?.action).toBe('sprint_loop')
    e.frame = 41; expect(lire(r, e).base?.action).toBe('sprint_exit'); expect(lire(r, e).tempsBase).toBe(0)
    e.frame = 46; expect(lire(r, e).tempsBase).toBeCloseTo(0.5)
    e.frame = 51; expect(lire(r, e).base).toBeNull()
    e.frame = 15; expect(lire(r, e)).toEqual(milieu)
  })
  it('fond une entrée interrompue vers le repos puis la sortie', () => {
    const r = rigAvec('sprint_enter', 'sprint_loop', 'sprint_exit'); const e = evenements()
    e.rechargements = []; e.sprints = [{ t0: 10, t1: 12 }]
    e.frame = 12.5; expect(lire(r, e).base?.action).toBe('sprint_enter'); expect(lire(r, e).poidsBase).toBeLessThan(0.5)
    e.frame = 13; expect(lire(r, e).base?.action).toBe('sprint_exit'); expect(lire(r, e).poidsBase).toBe(0)
    e.frame = 13.75; expect(lire(r, e).poidsBase).toBeCloseTo(0.5)
  })
  it('conserve les priorités des actions pendant les transitions', () => {
    const r = rigAvec('sprint_enter', 'sprint_loop', 'sprint_exit', 'reload_full', 'melee_strike_1', 'fire_1')
    const e = evenements(); e.sprints = [{ t0: 10, t1: 40 }]; e.frame = 12
    expect(lire(r, e).base?.action).toBe('reload_full')
    e.coups = [11]; expect(lire(r, e).base?.action).toBe('melee_strike_1')
    e.rechargements = []; e.coups = []; e.tirs = [11]; expect(lire(r, e).base).toBeNull()
  })
  it('joue la glissade : entree, boucle, sortie, puis rien', () => {
    const r = rigAvec('slide_enter', 'slide_loop', 'slide_exit')
    const e = evenements(); e.rechargements = []; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 11
    let pose = lire(r, e)
    expect(pose.base?.action).toBe('slide_enter'); expect(pose.tempsBase).toBeCloseTo(0.1); expect(pose.poidsBase).toBe(1)
    e.frame = 25
    pose = lire(r, e)
    expect(pose.base?.action).toBe('slide_loop'); expect(pose.tempsBase).toBeCloseTo(0.5); expect(pose.poidsBase).toBe(1)
    e.frame = 42
    pose = lire(r, e)
    expect(pose.base?.action).toBe('slide_exit'); expect(pose.tempsBase).toBeCloseTo(0.2); expect(pose.poidsBase).toBe(1)
    e.frame = 50.5
    expect(lire(r, e).base).toBeNull()
    e.frame = 49.99
    expect(lire(r, e).poidsBase).toBeLessThan(0.1)
  })
  it('fond la boucle de glissade sur 0.15 s sans entree ni sortie', () => {
    const r = rigAvec('slide_loop')
    const e = evenements(); e.rechargements = []; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 11.5
    expect(lire(r, e).poidsBase).toBeCloseTo(0.15 / 0.15)
    e.frame = 10.15
    expect(lire(r, e).poidsBase).toBeCloseTo(0.015 / 0.15)
    e.frame = 39.85
    expect(lire(r, e).poidsBase).toBeCloseTo(0.015 / 0.15)
    e.frame = 41
    expect(lire(r, e).base).toBeNull()
  })
  it('la glissade l emporte sur le sprint et se coupe au tir', () => {
    const r = rigAvec('sprint_loop', 'slide_enter', 'slide_loop', 'slide_exit')
    const e = evenements(); e.rechargements = []; e.sprints = [{ t0: 0, t1: 50 }]; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 23
    expect(lire(r, e).base?.action).toBe('slide_loop')
    e.tirs = [22]
    expect(lire(r, e).base).toBeNull()
    e.tirs = []; e.frame = 42
    expect(lire(r, e).base?.action).toBe('slide_exit')
  })
  it('sans slide_loop, la glissade laisse le comportement en place', () => {
    const r = rigAvec('sprint_loop', 'slide_enter', 'slide_exit')
    const e = evenements(); e.rechargements = []; e.sprints = [{ t0: 0, t1: 50 }]; e.slides = [{ t0: 10, t1: 40 }]
    e.frame = 23
    expect(lire(r, e).base?.action).toBe('sprint_loop')
    const e2 = evenements(); e2.rechargements = []; e2.slides = [{ t0: 10, t1: 40 }]
    e2.frame = 23
    expect(lire(r, e2).base).toBeNull()
  })
  it('la melee couvre la glissade', () => {
    const r = rigAvec('melee_strike_1', 'slide_enter', 'slide_loop', 'slide_exit')
    const e = evenements(); e.rechargements = []; e.slides = [{ t0: 10, t1: 40 }]; e.coups = [22]; e.frame = 23
    expect(lire(r, e).base?.action).toBe('melee_strike_1')
  })
  it('respecte la priorité mêlée, recharge, grenade, changement, sprint', () => {
    const r = rigAvec('melee_strike_1', 'reload_full', 'throw_grenade', 'ready', 'sprint_loop')
    const e = evenements(); e.frame = 12; e.coups = [10]; e.grenades = [12]; e.changements = [change(10)]; e.sprints = [{ t0: 0, t1: 40 }]
    expect(lire(r, e).base?.action).toBe('melee_strike_1')
    e.coups = []; expect(lire(r, e).base?.action).toBe('reload_full')
    e.rechargements = []; expect(lire(r, e).base?.action).toBe('throw_grenade')
    e.grenades = []; expect(lire(r, e).base?.action).toBe('ready')
    e.changements = []; expect(lire(r, e).base?.action).toBe('sprint_loop')
  })

  it('joue saut et réceptions aux bornes', () => {
    const r = rigAvec('jump', 'land_soft', 'land_hard'); const e = evenements()
    e.rechargements = []; e.sauts = [{ t0: 10, t1: 15 }]
    for (const [f, action, temps] of [[10, 'jump', 0], [13, 'jump', 0.3], [16, 'land_soft', 0], [21, 'land_soft', 0.5], [26, null, 0]] as const) {
      e.frame = f; expect(lire(r, e).base?.action ?? null).toBe(action); expect(lire(r, e).tempsBase).toBeCloseTo(temps)
    }
    e.sauts = [{ t0: 10, t1: 24 }]
    for (const [f, action] of [[25, 'land_hard'], [30, 'land_hard'], [35, null]] as const) {
      e.frame = f; expect(lire(r, e).base?.action ?? null).toBe(action)
    }
  })
  it('joue une escalade une fois pendant son intervalle', () => {
    const r = rigAvec('clamber'); const e = evenements(); e.rechargements = []; e.escalades = [{ t0: 10, t1: 40 }]
    for (const [f, action] of [[10, 'clamber'], [15, 'clamber'], [20, null], [41, null]] as const) {
      e.frame = f; expect(lire(r, e).base?.action ?? null).toBe(action)
    }
  })
  it('boucle ou maintient accroupi avec les fondus du sprint', () => {
    const r = rigAvec('crouch'); const e = evenements(); e.rechargements = []; e.accroupis = [{ t0: 10, t1: 40 }]
    for (const [f, action] of [[10, 'crouch'], [25, 'crouch'], [41, null]] as const) {
      e.frame = f; expect(lire(r, e).base?.action ?? null).toBe(action)
    }
    e.frame = 10.75; expect(lire(r, e).poidsBase).toBeCloseTo(0.5)
    e.frame = 39.25; expect(lire(r, e).poidsBase).toBeCloseTo(0.5)
    e.frame = 25; expect(lire(r, e).tempsBase).toBeCloseTo(0.5)
    const pose = rigAvec('crouch'); pose.clips[0].frameCount = 2; expect(lire(pose, e).tempsBase).toBe(0)
  })
  it('respecte la priorité des mouvements et du rechargement', () => {
    const r = rigAvec('crouch', 'sprint_loop', 'slide_loop', 'jump', 'clamber', 'reload_full')
    const e = evenements(); e.frame = 12; e.rechargements = []; e.accroupis = [{ t0: 0, t1: 40 }]; e.sprints = [{ t0: 0, t1: 40 }]
    expect(lire(r, e).base?.action).toBe('sprint_loop')
    e.sprints = []; e.slides = [{ t0: 10, t1: 40 }]; expect(lire(r, e).base?.action).toBe('slide_loop')
    e.slides = []; e.sprints = [{ t0: 0, t1: 40 }]; e.sauts = [{ t0: 10, t1: 20 }]; expect(lire(r, e).base?.action).toBe('jump')
    e.escalades = [{ t0: 10, t1: 20 }]; expect(lire(r, e).base?.action).toBe('clamber')
    e.rechargements = [ep(10)]; expect(lire(r, e).base?.action).toBe('reload_full')
  })
  it('coupe chaque mouvement au tir et garde le repli sans clip', () => {
    for (const [action, champ, intervalle, frame] of [
      ['crouch', 'accroupis', { t0: 10, t1: 40 }, 12], ['jump', 'sauts', { t0: 10, t1: 15 }, 12],
      ['land_soft', 'sauts', { t0: 10, t1: 15 }, 17], ['land_hard', 'sauts', { t0: 0, t1: 15 }, 17],
      ['clamber', 'escalades', { t0: 10, t1: 40 }, 12],
    ] as const) {
      const e = evenements(); e.rechargements = []; e[champ] = [intervalle]; e.frame = frame
      expect(lire(rigAvec(action), e).base?.action).toBe(action); expect(lire(rigAvec(), e).base).toBeNull()
      e.tirs = [frame - 1]; expect(lire(rigAvec(action), e).base).toBeNull()
      e.tirs = [frame - 3]; expect(lire(rigAvec(action), e).base?.action).toBe(action)
    }
  })
  it('utilise le sprint aérien puis reprend le sprint au sol', () => {
    const r = rigAvec('sprint_loop', 'sprint_loop_airborne'); const e = evenements()
    e.rechargements = []; e.sprints = [{ t0: 0, t1: 40 }]; e.sauts = [{ t0: 10, t1: 15 }]; e.frame = 12
    expect(lire(r, e).base?.action).toBe('sprint_loop_airborne'); expect(lire(rigAvec('sprint_loop'), e).base?.action).toBe('sprint_loop')
    e.frame = 16; expect(lire(r, e).base?.action).toBe('sprint_loop')
  })

})
