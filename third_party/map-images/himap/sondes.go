// Package himap — sondes.go : la lumiere cuite d'une carte, une grille de sondes d'irradiance.
//
// Le jeu n'a pas de lightmaps : sa lumiere indirecte (rebonds, ciel) est echantillonnee sur des
// grilles de sondes, region par region, une texture d'irradiance par region (schema DDGI).
//
// SOURCE : le tag `stlm` que le scenario donne a la structure jouee (niveau.go), dans le module
// `pc` de sa geometrie (definition `stlm.xml` du depot
// Z-15/Halo-Infinite-Tag-Editor, egale a la build courante ; verifiee sur Recharge : pas
// d'enregistrement fois nombre egal a la taille de chaque bloc) :
//
//	racine +0x10 : bloc « Probe regions », 0x5C o par region :
//	  +0x04 6 x f32 : bornes en axes Halo, par paires (xmin, xmax, ymin, ymax, zmin, zmax)
//	  +0x1C / +0x20 / +0x24 : nombre de sondes en X, Y, Z
//	  +0x28 : priorite (les regions emboitees, plus petites, ont la plus haute)
//	  +0x2C / +0x30 : rayon de fondu horizontal / vertical
//	  +0x34 : rang de la premiere texture de la region dans le `bitm` des sondes
//	racine +0x24 : reference du `bitm` des sondes (GlobalID a +8 de la reference)
//
// Le `bitm` des sondes porte trois textures 3D par region ; seule la premiere, l'irradiance, est
// lue : flottants R11G11B10, (nx * TuileSonde) x (ny * TuileSonde) x nz texels, une tuile carree
// par sonde rangee X d'abord, chaque tranche Z a la suite. Une tuile est un octaedre de
// TuileSonde-2 texels bordes d'un texel qui recopie le bord interieur ; une sonde enfouie dans un
// mur vaut zero partout.
//
// REPERE DE L'OCTAEDRE : le codage usuel, AXES MONDE HALO. Le texel (i, j) de l'interieur, en
// (u, v) = ((i + 0,5) / 6, (j + 0,5) / 6) * 2 - 1, est la direction (u, v, 1 - |u| - |v|),
// repliee sous l'equateur ((1 - |v|) sgn u, (1 - |u|) sgn v) : le centre de la tuile regarde +Z
// (le haut), i croissant +X, j croissant +Y. Mesure, pas suppose : TestSondesOrientation
// (sondes_gamefiles_test.go).
//
// PLACE DES SONDES : au centre des cellules d'une boite decoupee en n par axe, la sonde i a
// min + (i + 0,5) (max - min) / n. Mesure : TestSondesEspacement.
package himap

import (
	"fmt"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// GroupeLumiereStatique : le groupe de tag de la lumiere cuite d'une structure.
const GroupeLumiereStatique = "stlm"

const (
	stlmOffRegions  = 0x10
	stlmOffBitmaps  = 0x24 // reference de tag : GlobalID a refOffGlobalID
	regionTaille    = 0x5C
	regionOffBornes = 0x04
	regionOffNombre = 0x1C
	regionOffPrio   = 0x28
	regionOffFondu  = 0x2C
	regionOffTex    = 0x34
	bitmapOffProf   = 0x04

	// TuileSonde : le cote, en texels, de la tuile d'une sonde (octaedre de 6 et sa bordure).
	TuileSonde = 8
	// octetsIrradiance : un texel R11G11B10 flottant.
	octetsIrradiance = 4
)

// RegionSondes : une grille de sondes et son irradiance.
type RegionSondes struct {
	// Min, Max : la boite de la region, axes monde Halo ; les sondes sont au centre de ses
	// cellules (cf. l'en-tete).
	Min, Max [3]float64
	// Nombre : sondes par axe (X, Y, Z).
	Nombre   [3]int
	Priorite int
	// FonduXY, FonduZ : la largeur, depuis le bord, ou la region cede a celle de dessous.
	FonduXY, FonduZ float64
	// Irradiance : les texels R11G11B10 de la region, tels que le jeu les stocke (cf. en-tete).
	Irradiance []byte
}

// SondesLumiere : les regions de sondes d'une carte, dans l'ordre du tag.
type SondesLumiere struct {
	Regions []RegionSondes
}

// LitSondes rend les sondes du `stlm` de la structure jouee (SourcesLumiereDe). ok=false si la
// structure n'a pas de `stlm` ou si le tag n'a aucune region ; erreur si le tag est absent du
// module, si la lecture echoue ou si une texture ne tombe pas a la taille de sa grille.
func LitSondes(s SourcesLumiere) (SondesLumiere, bool, error) {
	if s.LumiereStatique == 0 {
		return SondesLumiere{}, false, nil
	}
	m, err := himodule.Open(s.ModuleStructure)
	if err != nil {
		return SondesLumiere{}, false, err
	}
	defer func() { _ = m.Close() }()
	ti, err := tagLumiereStatique(m, s.LumiereStatique)
	if err != nil {
		return SondesLumiere{}, false, err
	}
	regions, debuts, idBitmap, err := litRegionsSondes(ti)
	if err != nil || len(regions) == 0 {
		return SondesLumiere{}, false, err
	}
	if err := litIrradiances(m, idBitmap, regions, debuts); err != nil {
		return SondesLumiere{}, false, err
	}
	return SondesLumiere{Regions: regions}, true, nil
}

// tagLumiereStatique rend le `stlm` `id` du module.
func tagLumiereStatique(m *himodule.Module, id uint32) (tagInfo, error) {
	f, ok := entreeParID(m, GroupeLumiereStatique, id)
	if !ok {
		return tagInfo{}, fmt.Errorf("himap: %s %#x absent du module", GroupeLumiereStatique, id)
	}
	ti, err := tagDeEntree(m, f)
	if err != nil {
		return tagInfo{}, fmt.Errorf("himap: %s %#x : %w", GroupeLumiereStatique, id, err)
	}
	return ti, nil
}

// tagDeEntree extrait une entree et rend son tag, sans les donnees en ligne qui le suivent.
func tagDeEntree(m *himodule.Module, f himodule.File) (tagInfo, error) {
	brut, err := m.Extract(f)
	if err != nil {
		return tagInfo{}, err
	}
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(brut) {
		brut = brut[:n]
	}
	return meilleurTagInfo(brut)
}

// litRegionsSondes decode le bloc des regions ; rend aussi, par region, le rang de sa premiere
// texture, et le GlobalID du `bitm` des sondes.
func litRegionsSondes(ti tagInfo) ([]RegionSondes, []int, uint32, error) {
	tag := ti.tag
	racine, err := ti.rootBlockIndex()
	if err != nil {
		return nil, nil, 0, err
	}
	rabs, rtaille := ti.blockAbs(racine)
	if stlmOffBitmaps+refOffGlobalID+4 > rtaille {
		return nil, nil, 0, fmt.Errorf("himap: %s : bloc racine de %#x o", GroupeLumiereStatique, rtaille)
	}
	n := u32(tag, rabs+stlmOffRegions+compteTagBlock)
	cible := ti.subBlockTarget(racine, stlmOffRegions)
	if n == 0 || cible < 0 {
		return nil, nil, 0, nil
	}
	abs, taille := ti.blockAbs(cible)
	if taille != n*regionTaille || abs+taille > len(tag) {
		return nil, nil, 0, fmt.Errorf("himap: %s : %d regions sur %#x o, attendu %#x o chacune",
			GroupeLumiereStatique, n, taille, regionTaille)
	}
	regions := make([]RegionSondes, n)
	debuts := make([]int, n)
	for i := range regions {
		o := abs + i*regionTaille
		r := &regions[i]
		for k := 0; k < 3; k++ {
			r.Min[k] = f32(tag, o+regionOffBornes+8*k)
			r.Max[k] = f32(tag, o+regionOffBornes+8*k+4)
			r.Nombre[k] = i32(tag, o+regionOffNombre+4*k)
			if r.Nombre[k] <= 0 || r.Max[k] < r.Min[k] {
				return nil, nil, 0, fmt.Errorf("himap: %s : region %d incoherente (%v sondes, %v..%v)",
					GroupeLumiereStatique, i, r.Nombre, r.Min, r.Max)
			}
		}
		r.Priorite = i32(tag, o+regionOffPrio)
		r.FonduXY, r.FonduZ = f32(tag, o+regionOffFondu), f32(tag, o+regionOffFondu+4)
		debuts[i] = i32(tag, o+regionOffTex)
	}
	return regions, debuts, uint32(u32(tag, rabs+stlmOffBitmaps+refOffGlobalID)), nil
}

// litIrradiances lit, pour chaque region, sa premiere texture dans le `bitm` des sondes (rang
// `debuts[i]`) et verifie ses dimensions contre la grille.
func litIrradiances(m *himodule.Module, id uint32, regions []RegionSondes, debuts []int) error {
	f, ok := entreeParID(m, GroupeBitmap, id)
	if !ok {
		return fmt.Errorf("himap: bitmap des sondes %#x absent du module", id)
	}
	ti, err := tagDeEntree(m, f)
	if err != nil {
		return fmt.Errorf("himap: bitmap des sondes : %w", err)
	}
	racine, err := ti.rootBlockIndex()
	if err != nil {
		return err
	}
	c := ti.subBlockTarget(racine, bitmOffBitmaps)
	if c < 0 {
		return fmt.Errorf("himap: bitmap des sondes sans bloc de textures")
	}
	babs, btaille := ti.blockAbs(c)
	res, err := m.Ressources(f)
	if err != nil {
		return err
	}
	if len(res) != btaille/bitmapStride {
		return fmt.Errorf("himap: bitmap des sondes : %d textures, %d ressources", btaille/bitmapStride, len(res))
	}
	for i := range regions {
		r := &regions[i]
		k := debuts[i]
		if k < 0 || k >= len(res) {
			return fmt.Errorf("himap: region %d : texture %d hors des %d du bitmap", i, k, len(res))
		}
		o := babs + k*bitmapStride
		l, h, p := int(u16(ti.tag, o+bitmapOffLarg)), int(u16(ti.tag, o+bitmapOffHaut)), int(u16(ti.tag, o+bitmapOffProf))
		if l != r.Nombre[0]*TuileSonde || h != r.Nombre[1]*TuileSonde || p != r.Nombre[2] {
			return fmt.Errorf("himap: region %d : texture %dx%dx%d pour %v sondes", i, l, h, p, r.Nombre)
		}
		brut, err := m.Extract(res[k])
		if err != nil {
			return fmt.Errorf("himap: region %d : %w", i, err)
		}
		d := res[k].Donnees(brut)
		if len(d) != l*h*p*octetsIrradiance {
			return fmt.Errorf("himap: region %d : %d o d'irradiance, attendu %d", i, len(d), l*h*p*octetsIrradiance)
		}
		r.Irradiance = d
	}
	return nil
}

// entreeParID cherche l'entree d'un groupe par son GlobalID.
func entreeParID(m *himodule.Module, groupe string, id uint32) (himodule.File, bool) {
	for _, f := range m.Files(groupe) {
		if f.GlobalID == id {
			return f, true
		}
	}
	return himodule.File{}, false
}
