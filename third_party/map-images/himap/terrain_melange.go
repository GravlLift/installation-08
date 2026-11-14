// Package himap — terrain_melange.go : which palette material shows where on an `rtrn` terrain.
//
// LOCAL-CHANGE (infinite-theater-3d): the upstream reader published one palette color for the
// whole terrain. This file reads the blend the game computes and maps it onto the layered
// material the viewer already draws (couches.go, glb_couches.go).
//
// What the tag says (Live Fire, rtrn 42df53c4, checked against the game's look):
//
//   - Palette, root block @0xAC, 40 bytes per entry: string id, then three (bitmap index u32,
//     UV scale 2 x f32) for color (BC1, may be absent: index -1), normal (BC5S) and a packed map.
//     Bitmap indices point into the bitmap block @0xC8 (32 bytes, tag reference at +4).
//   - Material Layer Data, a data reference @0x12C: 208 bytes per palette entry; the linear tint
//     at +160 multiplies the color map, and is the whole color of an entry without one (the
//     grass of Live Fire).
//   - Shared layers @0x104, 44 bytes: string id, palette index (+4), program index (+8).
//   - Programs @0xF0, 32 bytes: a hash and a block of u32. The first word is the instruction
//     count; each instruction is opcode (high byte) and operand (low 16 bits). A program is a
//     small stack machine that computes one shared layer's weight from the node's inputs.
//   - Per node (112 bytes): material layers @0 (shared layer indices), texture remap @40 (8 bytes:
//     texture int16, channel mask u8, flags u8, solid value f32), input texture data @88 (24 bytes:
//     output id, bitmap resource index, four channel names). Input textures are 132 x 132 (two
//     texels of border around the node's 128 cells), BC1 (8712 bytes) or BC3 (17424 bytes) in the
//     heightmap bitmap's resource pool. A remap texture past the node's inputs names a shared
//     interpreter bitmap (root @0xDC, 36 bytes: reference, UV scale) sampled in world space.
//
// The viewer draws at most four layers; the palette entries are grouped by color into four,
// and the baked mask carries the sequential blend weights of groups 2 to 4.
package himap

import (
	"image"
	"math"
	"math/bits"

	"github.com/woozymasta/bcn"
)

const (
	terrainChampPalette     = 0xac
	terrainPasPalette       = 40
	terrainChampBitmaps     = 0xc8
	terrainPasBitmap        = 32
	terrainChampBitmapsGPU  = 0xdc
	terrainPasBitmapGPU     = 36
	terrainChampProgrammes  = 0xf0
	terrainPasProgramme     = 32
	terrainChampPartages    = 0x104
	terrainPasPartage       = 44
	terrainChampDonnees     = 0x12c
	terrainPasDonneesCouche = 208

	noeudChampRemap           = 40
	noeudPasRemap             = 8
	noeudChampEntrees         = 88
	noeudPasEntree            = 24
	terrainCoteEntree         = 132
	terrainBordEntree         = 2
	terrainCellules           = 128
	terrainGroupesMax         = 4
	terrainEcartCouleurGroupe = 0.02
)

// terrainOffCouleursCouche : offsets of the three colors in a Material Layer Data record.
var terrainOffCouleursCouche = [3]int{96, 112, 160}

// paletteTerrain is one palette entry: its bitmaps (0: absent), their UV scale, and its colors
// from the Material Layer Data: degrade[2] (+160) is the tint of a color map; an entry without
// one draws a three-color gradient (+96, +112, +160) indexed by the alpha of its packed map.
type paletteTerrain struct {
	couleur, normale, paquet uint32
	echelle                  [2]float32
	teinte                   [3]float32
	degrade                  [3][3]float32
}

// partageTerrain is a shared node layer: its palette entry and its weight program.
type partageTerrain struct{ palette, programme int }

// melangeTerrain is what a terrain's blend needs, read once per terrain.
type melangeTerrain struct {
	palette     []paletteTerrain
	partages    []partageTerrain
	programmes  [][]uint32
	partagesGPU []bitmapGPU
}

type bitmapGPU struct {
	id      uint32
	echelle [2]float32
}

// litMelangeTerrain reads the palette, shared layers, programs and shared bitmaps of a terrain.
func litMelangeTerrain(s sourceTerrain) (melangeTerrain, bool) {
	var m melangeTerrain
	ti, tag := s.info, s.info.tag
	root, err := ti.rootBlockIndex()
	if err != nil {
		return m, false
	}
	bloc := func(champ, pas int) (int, int, bool) {
		b := ti.subBlockTarget(root, champ)
		if b < 0 {
			return 0, 0, false
		}
		a, n := ti.blockAbs(b)
		if a < 0 || a+n > len(tag) || n%pas != 0 {
			return 0, 0, false
		}
		return a, n / pas, true
	}
	pa, np, ok1 := bloc(terrainChampPalette, terrainPasPalette)
	ia, ni, ok2 := bloc(terrainChampBitmaps, terrainPasBitmap)
	sa, ns, ok3 := bloc(terrainChampPartages, terrainPasPartage)
	if !ok1 || !ok2 || !ok3 || np == 0 {
		return m, false
	}
	bitmap := func(i int) uint32 {
		if i < 0 || i >= ni {
			return 0
		}
		return idReference(tag, ia+i*terrainPasBitmap+4)
	}
	teintes := ti.donneesCouches(root, np)
	for i := 0; i < np; i++ {
		o := pa + i*terrainPasPalette
		p := paletteTerrain{
			couleur: bitmap(i32(tag, o+4)),
			normale: bitmap(i32(tag, o+16)),
			paquet:  bitmap(i32(tag, o+28)),
			echelle: [2]float32{float32(f32(tag, o+8)), float32(f32(tag, o+12))},
			teinte:  [3]float32{1, 1, 1},
		}
		if p.couleur == 0 {
			p.echelle = [2]float32{float32(f32(tag, o+20)), float32(f32(tag, o+24))}
		}
		for k, v := range p.echelle {
			if v <= 0 || math.IsNaN(float64(v)) {
				p.echelle[k] = 1
			}
		}
		if teintes != nil {
			p.degrade = teintes[i]
			p.teinte = teintes[i][2]
		}
		m.palette = append(m.palette, p)
	}
	for i := 0; i < ns; i++ {
		o := sa + i*terrainPasPartage
		m.partages = append(m.partages, partageTerrain{palette: u32(tag, o+4), programme: u32(tag, o+8)})
	}
	if b := ti.subBlockTarget(root, terrainChampProgrammes); b >= 0 {
		xa, xn := ti.blockAbs(b)
		for i := 0; (i+1)*terrainPasProgramme <= xn; i++ {
			var prog []uint32
			if c := ti.subBlockTarget(b, i*terrainPasProgramme+8); c >= 0 {
				a, n := ti.blockAbs(c)
				if a >= 0 && a+n <= len(tag) && n >= 4 {
					cnt := u32(tag, a)
					for k := 4; k+4 <= n && len(prog) < cnt; k += 4 {
						prog = append(prog, uint32(u32(tag, a+k)))
					}
				}
			}
			_ = xa
			m.programmes = append(m.programmes, prog)
		}
	}
	if ga, ng, ok := bloc(terrainChampBitmapsGPU, terrainPasBitmapGPU); ok {
		for i := 0; i < ng; i++ {
			o := ga + i*terrainPasBitmapGPU
			m.partagesGPU = append(m.partagesGPU, bitmapGPU{id: idReference(tag, o), echelle: [2]float32{float32(f32(tag, o+28)), float32(f32(tag, o+32))}})
		}
	}
	return m, true
}

// donneesCouches reads the three colors of each palette entry from the Material Layer Data
// reference; nil when the data reference is absent or too short.
func (ti tagInfo) donneesCouches(root, n int) [][3][3]float32 {
	b := ti.cibleDonnees(root, terrainChampDonnees)
	if b < 0 {
		return nil
	}
	a, size := ti.blockAbs(b)
	if a < 0 || a+size > len(ti.tag) || size < n*terrainPasDonneesCouche {
		return nil
	}
	out := make([][3][3]float32, n)
	for i := range out {
		for k, off := range terrainOffCouleursCouche {
			for c := 0; c < 3; c++ {
				v := float32(f32(ti.tag, a+i*terrainPasDonneesCouche+off+4*c))
				if math.IsNaN(float64(v)) {
					v = 0
				}
				out[i][k][c] = min(max(v, 0), 1)
			}
		}
	}
	return out
}

// cibleDonnees resolves a data reference field to its data block: the header's data reference
// table follows the struct table, 20 bytes per entry (parent struct, unknown, target block,
// field block, field offset), its count at H-0x14 next to the block and struct counts.
func (ti tagInfo) cibleDonnees(bloc, champ int) int {
	h := ti.blockTab - 0x18 - ti.deps*depEntrySize
	if h < 0x14 {
		return -1
	}
	n := u32(ti.tag, h-0x14)
	t0 := ti.structTab + ti.structs*structEntrySize
	if n < 0 || t0+n*0x14 > len(ti.tag) {
		return -1
	}
	for i := 0; i < n; i++ {
		o := t0 + i*0x14
		if i32(ti.tag, o+12) == bloc && u32(ti.tag, o+16) == champ {
			if c := i32(ti.tag, o+8); c >= 0 && c < ti.dataBlocks {
				return c
			}
		}
	}
	return -1
}

// Program inputs: each input register holds a fixed number of channels; together they make the
// node's eleven remap slots.
var registresEntree = map[int][2]int{4: {0, 4}, 5: {4, 2}, 6: {6, 4}, 7: {10, 1}}

// emplacementEntree maps a load (register, channel) to its remap slot.
func emplacementEntree(registre, canal int) (int, bool) {
	r, ok := registresEntree[registre]
	if !ok || canal < 0 || canal >= r[1] {
		return 0, false
	}
	return r[0] + canal, true
}

// evalueProgramme runs a weight program. Opcodes: 0x01..0x04 load channel R..A of an input
// register, 0x0A push a half float, 0x0D multiply, 0x0F add, 0x12 one minus, 0x14
// smoothstep(a, b, x), 0x17 band(x, low, high, fade below, fade above), 0x19 lerp(a, b, t).
// The result is clamped to [0, 1]; ok=false for an unknown opcode or a malformed stack.
func evalueProgramme(prog []uint32, entree func(slot int) float32) (float32, bool) {
	pile := make([]float32, 0, 8)
	pop := func(n int) []float32 {
		if len(pile) < n {
			return nil
		}
		v := pile[len(pile)-n:]
		pile = pile[:len(pile)-n]
		return v
	}
	for _, ins := range prog {
		op, arg := ins>>24, int(ins&0xffff)
		var v []float32
		switch op {
		case 0x01, 0x02, 0x03, 0x04:
			slot, ok := emplacementEntree(arg, int(op)-1)
			if !ok {
				return 0, false
			}
			pile = append(pile, entree(slot))
			continue
		case 0x0a:
			pile = append(pile, demiFlottant(uint16(arg)))
			continue
		case 0x12:
			if v = pop(1); v != nil {
				pile = append(pile, 1-v[0])
			}
		case 0x0d, 0x0f:
			if v = pop(2); v != nil {
				if op == 0x0d {
					pile = append(pile, v[0]*v[1])
				} else {
					pile = append(pile, v[0]+v[1])
				}
			}
		case 0x14:
			if v = pop(3); v != nil {
				pile = append(pile, lisse(v[0], v[1], v[2]))
			}
		case 0x19:
			if v = pop(3); v != nil {
				pile = append(pile, v[0]+(v[1]-v[0])*v[2])
			}
		case 0x17:
			if v = pop(5); v != nil {
				pile = append(pile, bande(v[0], v[1], v[2], v[3], v[4]))
			}
		default:
			return 0, false
		}
		if v == nil {
			return 0, false
		}
	}
	if len(pile) != 1 {
		return 0, false
	}
	return min(max(pile[0], 0), 1), true
}

// lisse is smoothstep(a, b, x); a step when a == b.
func lisse(a, b, x float32) float32 {
	if b == a {
		if x >= a {
			return 1
		}
		return 0
	}
	t := min(max((x-a)/(b-a), 0), 1)
	return t * t * (3 - 2*t)
}

// bande is 1 on [bas, haut], fading out over `sous` below and `sur` above.
func bande(x, bas, haut, sous, sur float32) float32 {
	return lisse(bas-sous, bas, x) * (1 - lisse(haut, haut+sur, x))
}

// demiFlottant decodes an IEEE half float.
func demiFlottant(h uint16) float32 {
	signe := uint32(h>>15) << 31
	exp := int(h>>10) & 0x1f
	man := uint32(h & 0x3ff)
	switch {
	case exp == 0:
		v := float32(man) / 1024 / 16384
		if signe != 0 {
			return -v
		}
		return v
	case exp == 31:
		return math.Float32frombits(signe | 0x7f800000 | man<<13)
	}
	return math.Float32frombits(signe | uint32(exp-15+127)<<23 | man<<13)
}

// entreeNoeud samples one remap slot of a node at a cell (x right, y down from the node's top
// row) and world position.
type entreeNoeud func(x, y int, wx, wy float64) float32

// entreesNoeud builds the eleven remap slots of a node. lit decodes a bitmap resource of the
// heightmap's pool; gpu samples a shared interpreter bitmap channel in world space.
func entreesNoeud(s sourceTerrain, node int, lit func(ressource int, canaux int) *image.NRGBA, gpu func(i, canal int, wx, wy float64) float32) []entreeNoeud {
	ti, tag := s.info, s.info.tag
	sub := func(off, pas int) (int, int) {
		b := ti.subBlockTarget(s.blocNoeuds, node*terrainPasNoeud+off)
		if b < 0 {
			return -1, 0
		}
		a, n := ti.blockAbs(b)
		if a < 0 || a+n > len(tag) {
			return -1, 0
		}
		return a, n / pas
	}
	ea, ne := sub(noeudChampEntrees, noeudPasEntree)
	type entree struct{ ressource, canaux int }
	parSortie := map[int]entree{}
	for k := 0; k < ne; k++ {
		o := ea + k*noeudPasEntree
		canaux := 0
		for c := 0; c < 4; c++ {
			if u32(tag, o+8+4*c) != 0 {
				canaux = c + 1
			}
		}
		parSortie[u32(tag, o)] = entree{u32(tag, o+4), canaux}
	}
	ra, nr := sub(noeudChampRemap, noeudPasRemap)
	out := make([]entreeNoeud, 0, nr)
	for k := 0; k < nr; k++ {
		o := ra + k*noeudPasRemap
		tex := int(int16(u16(tag, o)))
		masque := int(tag[o+2]) & 0x0f
		solide := float32(f32(tag, o+4))
		canal := bits.TrailingZeros8(uint8(masque))
		constante := func(_, _ int, _, _ float64) float32 { return solide }
		switch {
		case tex < 0 || masque == 0 || canal > 3:
			out = append(out, constante)
		case tex < ne:
			e, ok := parSortie[tex]
			img := (*image.NRGBA)(nil)
			if ok {
				img = lit(e.ressource, e.canaux)
			}
			if img == nil {
				out = append(out, constante)
				continue
			}
			out = append(out, func(x, y int, _, _ float64) float32 {
				o := (y+terrainBordEntree)*img.Stride + (x+terrainBordEntree)*4 + canal
				return float32(img.Pix[o]) / 255
			})
		default:
			i := tex - ne
			out = append(out, func(_, _ int, wx, wy float64) float32 { return gpu(i, canal, wx, wy) })
		}
	}
	return out
}

// decodeEntree decodes a 132 x 132 input texture: BC1 at 8 bytes per block, BC3 at 16 for a
// texture with more than one named channel, else one byte per texel.
func decodeEntree(d []byte, canaux int) *image.NRGBA {
	blocs := (terrainCoteEntree / 4) * (terrainCoteEntree / 4)
	var f bcn.Format
	switch {
	case len(d) == blocs*8:
		f = bcn.FormatBC1
	case len(d) == blocs*16 && canaux > 1:
		f = bcn.FormatBC3
	case len(d) == terrainCoteEntree*terrainCoteEntree:
		img := image.NewNRGBA(image.Rect(0, 0, terrainCoteEntree, terrainCoteEntree))
		for i, v := range d {
			img.Pix[i*4], img.Pix[i*4+3] = v, 255
		}
		return img
	default:
		return nil
	}
	img, err := bcn.DecodeImage(d, terrainCoteEntree, terrainCoteEntree, f)
	if err != nil {
		return nil
	}
	return img
}

// poidsNoeud computes, for each palette entry, its weight over the node's 128 x 128 cells
// (row 0 at the node's top, its largest y). origine is the world position of the node's corner
// at its smallest x and y, pas the world size of a cell. Nil when the node has no material layer.
func (m melangeTerrain) poidsNoeud(s sourceTerrain, node int, entrees []entreeNoeud, origine [2]float64, pas [2]float64) [][]float32 {
	ti, tag := s.info, s.info.tag
	b := ti.subBlockTarget(s.blocNoeuds, node*terrainPasNoeud)
	if b < 0 {
		return nil
	}
	a, n := ti.blockAbs(b)
	if a < 0 || a+n > len(tag) || n < 4 {
		return nil
	}
	out := make([][]float32, len(m.palette))
	valeur := make([]float32, len(entrees))
	lu := make([]bool, len(entrees))
	for k := 0; k+4 <= n; k += 4 {
		sh := u32(tag, a+k)
		if sh < 0 || sh >= len(m.partages) {
			continue
		}
		p, pr := m.partages[sh].palette, m.partages[sh].programme
		if p < 0 || p >= len(m.palette) || pr < 0 || pr >= len(m.programmes) || len(m.programmes[pr]) == 0 {
			continue
		}
		if out[p] == nil {
			out[p] = make([]float32, terrainCellules*terrainCellules)
		}
		for y := 0; y < terrainCellules; y++ {
			wy := origine[1] + (float64(terrainCellules-1-y)+0.5)*pas[1]
			for x := 0; x < terrainCellules; x++ {
				wx := origine[0] + (float64(x)+0.5)*pas[0]
				clear(lu)
				w, ok := evalueProgramme(m.programmes[pr], func(slot int) float32 {
					if slot >= len(entrees) {
						return 0
					}
					if !lu[slot] {
						valeur[slot], lu[slot] = entrees[slot](x, y, wx, wy), true
					}
					return valeur[slot]
				})
				if ok {
					out[p][y*terrainCellules+x] += w
				}
			}
		}
	}
	return out
}

// groupesPalette groups palette entries into at most four looks: the entries are taken by
// decreasing area, an entry whose color is far enough from every chosen one starts a group, and
// every entry joins the group with the closest color. Returns the group of each entry and the
// representative entry of each group, the largest group first.
func groupesPalette(aire []float64, couleur [][3]float32) ([]int, []int) {
	ordre := make([]int, len(aire))
	for i := range ordre {
		ordre[i] = i
	}
	for i := 1; i < len(ordre); i++ {
		for j := i; j > 0 && aire[ordre[j]] > aire[ordre[j-1]]; j-- {
			ordre[j], ordre[j-1] = ordre[j-1], ordre[j]
		}
	}
	ecart := func(a, b [3]float32) float32 {
		d := float32(0)
		for c := 0; c < 3; c++ {
			d += (a[c] - b[c]) * (a[c] - b[c])
		}
		return float32(math.Sqrt(float64(d)))
	}
	var reps []int
	for _, i := range ordre {
		if len(reps) == terrainGroupesMax || aire[i] <= 0 {
			break
		}
		loin := true
		for _, r := range reps {
			if ecart(couleur[i], couleur[r]) < terrainEcartCouleurGroupe {
				loin = false
			}
		}
		if loin {
			reps = append(reps, i)
		}
	}
	if len(reps) == 0 && len(aire) > 0 {
		reps = []int{ordre[0]}
	}
	groupe := make([]int, len(aire))
	for i := range aire {
		best := 0
		for g, r := range reps {
			if ecart(couleur[i], couleur[r]) < ecart(couleur[i], couleur[reps[best]]) {
				best = g
			}
		}
		groupe[i] = best
	}
	return groupe, reps
}

// masqueSequentiel turns normalized group weights into the layered material's sequential
// blend: couleur = g1, then mix toward g2, g3, g4 by the returned m2, m3, m4.
func masqueSequentiel(g [terrainGroupesMax]float32) [3]float32 {
	var m [3]float32
	cumul := g[0]
	for k := 1; k < terrainGroupesMax; k++ {
		cumul += g[k]
		if cumul > 0 {
			m[k-1] = g[k] / cumul
		}
	}
	return m
}
