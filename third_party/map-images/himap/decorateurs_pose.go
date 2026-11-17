// Package himap — decorateurs_pose.go : scatters a terrain's decorators (grass clumps) where its
// placement layers put them (LOCAL-CHANGE (infinite-theater-3d)).
//
// What the tag says (Live Fire, rtrn 42df53c4):
//
//   - Shared Node Placement Layers, root block @0x118, 24 bytes: a block of placement
//     descriptions (+0) and a footprint radius (+20, world units).
//   - A placement description, 280 bytes: string id (+0), density program (+4) and scale program
//     (+8) indices into the shared GPU programs, the `dcrt` runtime tag reference (+12), the
//     editor content reference (+40, not shipped), then ranges (min, max): z offset (+68), scale
//     (+76), rotation about z in radians (+84), and orientation flags (+92).
//   - Each quadtree node lists its placement layers @20 (shared layer indices, u32).
//
// The density program runs on the same node inputs as the material weights (terrain_melange.go).
// A cell with density d expects d * cell area / footprint disc area clumps. The game draws them
// all near the camera and thins them with distance; a replay viewer shows the whole map at once,
// so the clumps are thinned uniformly to a budget.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
	"log/slog"
	"math"
)

const (
	terrainChampPoses     = 0x118
	terrainPasPose        = 24
	terrainPasDescription = 280
	noeudChampPoses       = 20
	// decorateursMax : clumps scattered per terrain, shared evenly between decorator kinds.
	decorateursMax = 180000
)

// TapisDecorateur is one decorator mesh scattered over a terrain: the mesh in its local frame
// (Indices by material GlobalID) and one transform per clump, in Halo world units.
type TapisDecorateur struct {
	Nom       string
	Maillage  GroupeMaillage
	Positions [][3]float32
	Lacets    []float32
	Echelles  []float32
}

type descriptionPose struct {
	densite    int
	decorateur uint32
	z, echelle [2]float32
	rotation   [2]float32
	empreinte  float32
}

// litPoses reads the shared placement layers: their descriptions, by layer.
func litPoses(s sourceTerrain) [][]descriptionPose {
	ti, tag := s.info, s.info.tag
	root, err := ti.rootBlockIndex()
	if err != nil {
		return nil
	}
	b := ti.subBlockTarget(root, terrainChampPoses)
	if b < 0 {
		return nil
	}
	a, n := ti.blockAbs(b)
	if a < 0 || a+n > len(tag) || n%terrainPasPose != 0 {
		return nil
	}
	out := make([][]descriptionPose, n/terrainPasPose)
	for i := range out {
		empreinte := float32(f32(tag, a+i*terrainPasPose+20))
		d := ti.subBlockTarget(b, i*terrainPasPose)
		if d < 0 {
			continue
		}
		da, dn := ti.blockAbs(d)
		if da < 0 || da+dn > len(tag) || dn%terrainPasDescription != 0 {
			continue
		}
		for k := 0; k < dn/terrainPasDescription; k++ {
			p := da + k*terrainPasDescription
			paire := func(o int) [2]float32 { return [2]float32{float32(f32(tag, p+o)), float32(f32(tag, p+o+4))} }
			out[i] = append(out[i], descriptionPose{densite: u32(tag, p+4), decorateur: idReference(tag, p+12),
				z: paire(68), echelle: paire(76), rotation: paire(84), empreinte: empreinte})
		}
	}
	return out
}

// hasard is a small deterministic generator (splitmix64) so a build is reproducible.
type hasard uint64

func (h *hasard) suivant() float64 {
	*h += 0x9e3779b97f4a7c15
	z := uint64(*h)
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return float64((z^(z>>31))>>11) / (1 << 53)
}

// hauteurTuile reads a tile's height at grid coordinates (0..resolution, y up) bilinearly.
func hauteurTuile(t tuileTerrain, res int, gx, gy float64) float64 {
	n := res + 1
	gx, gy = min(max(gx, 0), float64(res)), min(max(gy, 0), float64(res))
	x0, y0 := min(int(gx), res-1), min(int(gy), res-1)
	fx, fy := gx-float64(x0), gy-float64(y0)
	h := func(x, y int) float64 { return float64(u16(t.Hauteurs, 2*((res-y)*n+x))) / 65535 }
	return (h(x0, y0)*(1-fx)+h(x0+1, y0)*fx)*(1-fy) + (h(x0, y0+1)*(1-fx)+h(x0+1, y0+1)*fx)*fy
}

// noeudPose is a quadtree node under the tiles read: its index and its frame (corner, cell step).
type noeudPose struct {
	noeud int
	coin  [2]float64
	pas   [2]float64
}

// noeudsSousPlage lists the nodes of every level from the tiles' level down that cover the
// tiles' range. Live Fire hangs its card clumps on the tiles' level and its blade clumps one
// level finer.
func noeudsSousPlage(s sourceTerrain, p plageTerrain) []noeudPose {
	_, taille := s.info.blockAbs(s.blocNoeuds)
	count := taille / terrainPasNoeud
	var out []noeudPose
	for lv := p.niveau; lv < s.niveaux; lv++ {
		f := 1 << uint(lv-p.niveau)
		cote := 1 << uint(lv)
		premier := (cote*cote - 1) / 3
		cx, cy := s.taille[0]/float64(cote), s.taille[1]/float64(cote)
		for y := p.y0 * f; y < (p.y1+1)*f; y++ {
			for x := p.x0 * f; x < (p.x1+1)*f; x++ {
				node := premier + y*cote + x
				if node >= count {
					continue
				}
				out = append(out, noeudPose{noeud: node,
					coin: [2]float64{p.origine[0] + float64(x)*cx, p.origine[1] + float64(y)*cy},
					pas:  [2]float64{cx / terrainCellules, cy / terrainCellules}})
			}
		}
	}
	return out
}

// hauteurMonde reads the terrain height at a world position from the tiles read.
func hauteurMonde(tuiles map[[2]int]tuileTerrain, p plageTerrain, params parametresTerrain, wx, wy float64) float64 {
	gx, gy := (wx-p.origine[0])/p.pas[0], (wy-p.origine[1])/p.pas[1]
	tx, ty := int(math.Floor(gx/terrainCellules)), int(math.Floor(gy/terrainCellules))
	t, ok := tuiles[[2]int{tx, ty}]
	if !ok {
		return params.Origine[2]
	}
	return params.Origine[2] + params.Amplitude*hauteurTuile(t, params.Resolution, gx-float64(tx*terrainCellules), gy-float64(ty*terrainCellules))
}

// poseDecorateurs scatters the terrain's decorators over the tiles read. Returns one carpet per
// decorator mesh; none when the terrain declares no placement or no decorator decodes.
func poseDecorateurs(idx *ModuleIndex, s sourceTerrain, p plageTerrain, tuiles []tuileTerrain, params parametresTerrain, id uint32, caps TextureCaps) []TapisDecorateur {
	mel, ok := litMelangeTerrain(s)
	poses := litPoses(s)
	if !ok || len(poses) == 0 {
		return nil
	}
	mod, file, ok := idx.entree(s.bitmap)
	if !ok {
		return nil
	}
	ressources, err := mod.Ressources(file)
	if err != nil {
		return nil
	}
	cache := newDecodeCache(mod, ressources)
	gpu := echantillonneurGPU(idx, mel, caps)
	parTuile := map[[2]int]tuileTerrain{}
	for _, t := range tuiles {
		parTuile[[2]int{t.X, t.Y}] = t
	}
	// Pass 1: expected clumps per (node, description, cell).
	type attente struct {
		noeud noeudPose
		desc  descriptionPose
		par   []float32
	}
	var attentes []attente
	totalParDecorateur := map[uint32]float64{}
	for _, np := range noeudsSousPlage(s, p) {
		b := s.info.subBlockTarget(s.blocNoeuds, np.noeud*terrainPasNoeud+noeudChampPoses)
		if b < 0 {
			continue
		}
		a, n := s.info.blockAbs(b)
		if a < 0 || a+n > len(s.info.tag) {
			continue
		}
		entrees := entreesNoeud(s, np.noeud, cache.lit, gpu)
		aireCellule := np.pas[0] * np.pas[1]
		for k := 0; k+4 <= n; k += 4 {
			couche := u32(s.info.tag, a+k)
			if couche < 0 || couche >= len(poses) {
				continue
			}
			for _, d := range poses[couche] {
				if d.densite < 0 || d.densite >= len(mel.programmes) || d.empreinte <= 0 || d.decorateur == 0 {
					continue
				}
				par := make([]float32, terrainCellules*terrainCellules)
				disque := math.Pi * float64(d.empreinte) * float64(d.empreinte)
				somme := 0.0
				for y := 0; y < terrainCellules; y++ {
					wy := np.coin[1] + (float64(terrainCellules-1-y)+0.5)*np.pas[1]
					for x := 0; x < terrainCellules; x++ {
						wx := np.coin[0] + (float64(x)+0.5)*np.pas[0]
						v, ok := evalueProgramme(mel.programmes[d.densite], func(slot int) float32 {
							if slot >= len(entrees) {
								return 0
							}
							return entrees[slot](x, y, wx, wy)
						})
						if ok && v > 0 {
							e := float64(v) * aireCellule / disque
							par[y*terrainCellules+x] = float32(e)
							somme += e
						}
					}
				}
				if somme > 0 {
					attentes = append(attentes, attente{noeud: np, desc: d, par: par})
					totalParDecorateur[d.decorateur] += somme
				}
			}
		}
	}
	if len(totalParDecorateur) == 0 {
		return nil
	}
	// Each kind is thinned to its share of the budget on its own: the dense blade clumps would
	// otherwise thin the sparse card clumps out of sight.
	garde := map[uint32]float64{}
	part := float64(decorateursMax) / float64(len(totalParDecorateur))
	for dec, v := range totalParDecorateur {
		garde[dec] = min(1, part/v)
	}
	// Pass 2: the clumps, one carpet per decorator mesh.
	tapis := map[uint32][]*TapisDecorateur{}
	ordre := []uint32{}
	for i, at := range attentes {
		dec := at.desc.decorateur
		if _, vu := tapis[dec]; !vu {
			ms, err := LitDecorateur(idx, dec)
			if err != nil {
				slog.Warn("unreadable decorator", "id", fmt.Sprintf("%08x", dec), "error", err)
				tapis[dec] = nil
				continue
			}
			for k, m := range ms {
				tapis[dec] = append(tapis[dec], &TapisDecorateur{Nom: fmt.Sprintf("decorHerbe_%08x_%d", dec, k), Maillage: groupeDecorateur(m)})
			}
			ordre = append(ordre, dec)
		}
		variantes := tapis[dec]
		if len(variantes) == 0 {
			continue
		}
		np, d := at.noeud, at.desc
		h := hasard(uint64(id)<<32 ^ uint64(i)<<8 ^ uint64(dec))
		for y := 0; y < terrainCellules; y++ {
			for x := 0; x < terrainCellules; x++ {
				e := float64(at.par[y*terrainCellules+x]) * garde[dec]
				nb := int(e)
				if h.suivant() < e-float64(nb) {
					nb++
				}
				for c := 0; c < nb; c++ {
					wx := np.coin[0] + (float64(x)+h.suivant())*np.pas[0]
					wy := np.coin[1] + (float64(terrainCellules-1-y)+h.suivant())*np.pas[1]
					z := hauteurMonde(parTuile, p, params, wx, wy)
					v := variantes[int(h.suivant()*float64(len(variantes)))%len(variantes)]
					v.Positions = append(v.Positions, [3]float32{float32(wx), float32(wy), float32(z) + d.z[0] + float32(h.suivant())*(d.z[1]-d.z[0])})
					v.Lacets = append(v.Lacets, d.rotation[0]+float32(h.suivant())*(d.rotation[1]-d.rotation[0]))
					v.Echelles = append(v.Echelles, d.echelle[0]+float32(h.suivant())*(d.echelle[1]-d.echelle[0]))
				}
			}
		}
	}
	var out []TapisDecorateur
	compte := 0
	for _, dec := range ordre {
		for _, v := range tapis[dec] {
			if len(v.Positions) > 0 {
				out = append(out, *v)
				compte += len(v.Positions)
			}
		}
	}
	attendus := make([]string, 0, len(totalParDecorateur))
	for dec, v := range totalParDecorateur {
		attendus = append(attendus, fmt.Sprintf("%08x:%.0f", dec, v))
	}
	slog.Info("terrain decorators", "id", fmt.Sprintf("%08x", id), "expected", attendus, "placed", compte, "collected", len(out))
	return out
}

// groupeDecorateur turns a decorator mesh into a group: positions, normals facing up (a clump
// is lit like the ground under it), its first UV set on every set, triangles by material.
func groupeDecorateur(m MaillageDecorateur) GroupeMaillage {
	g := GroupeMaillage{Indices: map[uint32][]uint32{}}
	for i, v := range m.Maillage.Vertices {
		g.Sommets = append(g.Sommets, float32(v[0]), float32(v[1]), float32(v[2]))
		g.Normales = append(g.Normales, 0, 0, 1)
		var uv [2]float32
		if i < len(m.Maillage.UV[0]) {
			uv = m.Maillage.UV[0][i]
		}
		for j := range g.UV {
			g.UV[j] = append(g.UV[j], uv[0], uv[1])
		}
	}
	for _, part := range m.Maillage.Parts {
		mat := uint32(0)
		if part.Materiau >= 0 && part.Materiau < len(m.Materiaux) {
			mat = m.Materiaux[part.Materiau]
		}
		for _, t := range m.Maillage.Triangles[part.Debut : part.Debut+part.Compte] {
			g.Indices[mat] = append(g.Indices[mat], uint32(t[0]), uint32(t[1]), uint32(t[2]))
		}
	}
	g.Instances = 1
	return g
}
