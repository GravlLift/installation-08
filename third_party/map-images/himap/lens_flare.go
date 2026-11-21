// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// LOCAL-CHANGE (infinite-theater-3d): lens_flare.go reads an effect's lens flares (`lens`) and
// cheap lights (`gldf`), the parts of the equipment pad's effect (`effe cf098056`) that make its
// blue glow. Offsets follow the community tag layouts (Z-15 Halo-Infinite-Tag-Editor
// `lens.xml`, `gldf.xml`), checked against the pad's tags: both lens flares carry falloff 65 /
// cutoff 80 degrees, far fade 10 to 20, five reflections of 300 bytes (the last two flagged
// "do not render"), and the ADS radius multiplier 1 lands at root +0x138.

package himap

import (
	"fmt"
	"sort"
)

const (
	lensOffAngles     = 0x10 // falloff, cutoff (radians)
	lensOffFondus     = 0x44 // near fade begin, end, far fade begin, end
	lensOffBitmap     = 0x54 // tag reference, GlobalID at +8
	lensOffDrapeaux   = 0x70 // u16
	lensOffReflets    = 0x80 // tag block
	lensOffExposure   = 0x28 // exposure amount (f32)
	lensOffOcclusion  = 0x30 // occlusion offset distance (f32), then its direction (u16: 0 toward viewer, 1 marker forward, 2 none)
	lensTailleReflet  = 300
	refletOffDrapeaux = 0x04 // u32
	refletOffBitmap   = 0x08 // tag reference (override), GlobalID at +8
	refletOffAngles   = 0x54
	refletOffFondus   = 0x6c
	refletOffRotation = 0x7c // degrees
	refletOffAxe      = 0x80
	refletOffRayon    = 0x94 // curve: 4 input bytes, then the mapping data reference
	refletOffEchelleX = 0xb0
	refletOffEchelleY = 0xcc
	refletOffIntens   = 0xe8
	refletOffCouleur  = 0x108
	refletOffModul    = 0x124
	refletOffTeinte   = 0x128

	// LensReflectionNoRender is a reflection's "do not render" flag (bit 15).
	LensReflectionNoRender = 1 << 15
	// LensReflectionScaledByDistance is a reflection's "radius scaled by distance" flag (bit 1);
	// without it the radius is a share of the screen.
	LensReflectionScaledByDistance = 1 << 1
	// LensReflectionWorldSpace is a reflection's "draw in world space instead of screen space"
	// flag (bit 11).
	LensReflectionWorldSpace = 1 << 11
)

// LensReflection is one drawn reflection of a lens flare.
type LensReflection struct {
	Flags  uint32 `json:"flags"`
	Bitmap uint32 `json:"-"`
	// FalloffAngle / CutoffAngle (radians); NearFade / FarFade: begin and end distances.
	FalloffAngle   float32           `json:"falloffAngle"`
	CutoffAngle    float32           `json:"cutoffAngle"`
	NearFade       [2]float32        `json:"nearFade"`
	FarFade        [2]float32        `json:"farFade"`
	RotationOffset float32           `json:"rotationOffset"`
	AxisOffset     float32           `json:"axisOffset"`
	Radius         FonctionParticule `json:"radius"`
	ScaleX         FonctionParticule `json:"scaleX"`
	ScaleY         FonctionParticule `json:"scaleY"`
	Intensity      FonctionParticule `json:"intensity"`
	Color          FonctionParticule `json:"color"`
	Modulation     float32           `json:"modulation"`
	TintPower      float32           `json:"tintPower"`
}

// LensFlare is a lens flare's root settings and its reflections.
type LensFlare struct {
	ID           uint32     `json:"-"`
	Flags        uint16     `json:"flags"`
	FalloffAngle float32    `json:"falloffAngle"`
	CutoffAngle  float32    `json:"cutoffAngle"`
	NearFade     [2]float32 `json:"nearFade"`
	FarFade      [2]float32 `json:"farFade"`
	Bitmap       uint32     `json:"-"`
	Exposure     float32    `json:"exposure"`
	// OcclusionOffset: how far the occlusion test point moves from the source, in the direction
	// OcclusionDirection names (0 toward the viewer, 1 the marker's forward, 2 none).
	OcclusionOffset    float32          `json:"occlusionOffset"`
	OcclusionDirection uint16           `json:"occlusionDirection"`
	Reflections        []LensReflection `json:"reflections"`
}

// LensFlareTag reads the lens flare `id`.
func (a *Arsenal) LensFlareTag(id uint32) (*LensFlare, error) {
	raw, err := a.geo.Extract(id)
	if err != nil {
		return nil, err
	}
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return nil, err
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	r, rTaille := ti.blockAbs(rb)
	if r < 0 || rTaille < lensOffReflets+20 || r+rTaille > len(ti.tag) {
		return nil, fmt.Errorf("lens %08x: root of %d bytes", id, rTaille)
	}
	paire := func(o int) [2]float32 { return [2]float32{f32Brut(ti.tag, o), f32Brut(ti.tag, o+4)} }
	out := &LensFlare{
		ID:                 id,
		Flags:              u16(ti.tag, r+lensOffDrapeaux),
		FalloffAngle:       f32Brut(ti.tag, r+lensOffAngles),
		CutoffAngle:        f32Brut(ti.tag, r+lensOffAngles+4),
		NearFade:           paire(r + lensOffFondus),
		FarFade:            paire(r + lensOffFondus + 8),
		Bitmap:             uint32(u32(ti.tag, r+lensOffBitmap+8)),
		Exposure:           f32Brut(ti.tag, r+lensOffExposure),
		OcclusionOffset:    f32Brut(ti.tag, r+lensOffOcclusion),
		OcclusionDirection: u16(ti.tag, r+lensOffOcclusion+4),
	}
	blk := ti.subBlockTarget(rb, lensOffReflets)
	bAbs, bTaille := ti.blockAbs(blk)
	if blk < 0 || bTaille%lensTailleReflet != 0 {
		return nil, fmt.Errorf("lens %08x: reflections of %d bytes", id, bTaille)
	}
	donnees := ti.donneesDuChamp(blk)
	for k := 0; k < bTaille/lensTailleReflet; k++ {
		e := bAbs + k*lensTailleReflet
		courbe := func(off int) (FonctionParticule, error) {
			return litProprieteParticule(ti.tag[e+off:e+off+4], donnees[k*lensTailleReflet+off+4])
		}
		rf := LensReflection{
			Flags:          uint32(u32(ti.tag, e+refletOffDrapeaux)),
			Bitmap:         uint32(u32(ti.tag, e+refletOffBitmap+8)),
			FalloffAngle:   f32Brut(ti.tag, e+refletOffAngles),
			CutoffAngle:    f32Brut(ti.tag, e+refletOffAngles+4),
			NearFade:       paire(e + refletOffFondus),
			FarFade:        paire(e + refletOffFondus + 8),
			RotationOffset: f32Brut(ti.tag, e+refletOffRotation),
			AxisOffset:     f32Brut(ti.tag, e+refletOffAxe),
			Modulation:     f32Brut(ti.tag, e+refletOffModul),
			TintPower:      f32Brut(ti.tag, e+refletOffTeinte),
		}
		for _, c := range []struct {
			off int
			dst *FonctionParticule
			nom string
		}{
			{refletOffRayon, &rf.Radius, "radius"}, {refletOffEchelleX, &rf.ScaleX, "scale X"},
			{refletOffEchelleY, &rf.ScaleY, "scale Y"}, {refletOffIntens, &rf.Intensity, "intensity"},
			{refletOffCouleur, &rf.Color, "color"},
		} {
			f, err := courbe(c.off)
			if err != nil {
				return nil, fmt.Errorf("lens %08x reflection %d %s: %w", id, k, c.nom, err)
			}
			*c.dst = f
		}
		if rf.Bitmap == 0 || rf.Bitmap == 0xffffffff {
			rf.Bitmap = out.Bitmap
		}
		out.Reflections = append(out.Reflections, rf)
	}
	return out, nil
}

// Layout of an effect's events and parts (Z-15 `effe.xml`, checked on the pad effect cf098056:
// two events of 3 and 4 parts, the lens and cheap light types at the part's +0x38).
const (
	evtOffDelai        = 0x0c // event: delay bounds (2 x f32, seconds)
	evtOffParties      = 0x20 // event: parts (tag block)
	partieTaille       = 0x8c // a part
	partieOffType      = 0x38 // part: its type's GlobalID (tag reference at +0x30)
	partieOffGroupe    = 0x44 // part: its type's group (fourCC, little-endian)
	partieOffRayon     = 0x60 // part: radius modifier bounds (2 x f32)
	effeDrapeauBoucle  = 1 << 6
	effeOffDrapeauxRac = 0x24 // root: flags (u32; bit 6 force looping)
	groupeLens         = 0x6c656e73
	groupeGldf         = 0x676c6466
	groupeEfge         = 0x65666765
)

// EffectEvent is one event of an effect's first rendering level: when it plays and the lens flares
// and cheap lights it creates (with each part's radius modifier).
type EffectEvent struct {
	Delay      [2]float32   `json:"delay"`
	Duration   [2]float32   `json:"duration"`
	Lenses     []EffectPart `json:"lenses"`
	Lights     []EffectPart `json:"lights"`
	Generators []EffectPart `json:"generators"` // effect generators (`efge`)
}

// TagGenerateur returns the decompressed effect generator (`efge`) tag `id`.
func (a *Arsenal) TagGenerateur(id uint32) ([]byte, error) {
	if g, _, ok := a.geo.Lookup(id); !ok || g != "efge" {
		return nil, fmt.Errorf("himap: %08x is not an efge", id)
	}
	return a.geo.Extract(id)
}

// EffectPart is a part's type and its radius modifier bounds.
type EffectPart struct {
	Type   uint32     `json:"-"`
	Radius [2]float32 `json:"radiusModifier"`
}

// EffectEventsOf reads the effect `id`'s first rendering level: its events in play order, and
// whether the effect loops (root flag "force looping"). Events of a level whose "events in
// parallel" flag is unset play one after the other.
func (a *Arsenal) EffectEventsOf(id uint32) (events []EffectEvent, looping, parallel bool, err error) {
	raw, err := a.geo.Extract(id)
	if err != nil {
		return nil, false, false, err
	}
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return nil, false, false, err
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return nil, false, false, err
	}
	r, _ := ti.blockAbs(rb)
	looping = u32(ti.tag, r+effeOffDrapeauxRac)&effeDrapeauBoucle != 0
	lv := ti.subBlockTarget(rb, effeOffNiveaux)
	lAbs, lTaille := ti.blockAbs(lv)
	if lv < 0 || lTaille < effeTailleNiveau {
		return nil, false, false, fmt.Errorf("effe %08x: no level", id)
	}
	niveau := -1
	for k := 0; k < lTaille/effeTailleNiveau; k++ {
		if u16(ti.tag, lAbs+k*effeTailleNiveau+effeOffNiveauDrapeaux)&1 == 0 { // bit 0: non-rendering
			niveau = k
			break
		}
	}
	if niveau < 0 {
		return nil, false, false, fmt.Errorf("effe %08x: no rendering level", id)
	}
	parallel = u16(ti.tag, lAbs+niveau*effeTailleNiveau+effeOffNiveauDrapeaux)&2 != 0
	eb := ti.subBlockTarget(lv, niveau*effeTailleNiveau+effeOffEvenements)
	eAbs, eTaille := ti.blockAbs(eb)
	if eb < 0 {
		return nil, looping, parallel, nil
	}
	paire := func(o int) [2]float32 { return [2]float32{f32Brut(ti.tag, o), f32Brut(ti.tag, o+4)} }
	for j := 0; j < eTaille/effeTailleEvenement; j++ {
		e := eAbs + j*effeTailleEvenement
		ev := EffectEvent{Delay: paire(e + evtOffDelai), Duration: paire(e + evtOffDuree)}
		pb := ti.subBlockTarget(eb, j*effeTailleEvenement+evtOffParties)
		pAbs, pTaille := ti.blockAbs(pb)
		for p := 0; pb >= 0 && p < pTaille/partieTaille; p++ {
			o := pAbs + p*partieTaille
			part := EffectPart{Type: uint32(u32(ti.tag, o+partieOffType)), Radius: paire(o + partieOffRayon)}
			switch u32(ti.tag, o+partieOffGroupe) {
			case groupeLens:
				ev.Lenses = append(ev.Lenses, part)
			case groupeGldf:
				ev.Lights = append(ev.Lights, part)
			case groupeEfge:
				ev.Generators = append(ev.Generators, part)
			}
		}
		events = append(events, ev)
	}
	return events, looping, parallel, nil
}

// CheapLight is a cheap light (`gldf`): its color, intensity and far attenuation functions (in
// that field order) and its scalars.
type CheapLight struct {
	ID               uint32            `json:"-"`
	Color            FonctionParticule `json:"color"`
	Intensity        FonctionParticule `json:"intensity"`
	FarAttenuation   FonctionParticule `json:"farAttenuation"`
	FalloffBegin     float32           `json:"falloffBeginRatio"`
	NearFade         float32           `json:"nearFadeDistance"`
	CameraFade       [2]float32        `json:"cameraFade"`
	Diffuse          float32           `json:"diffuse"`
	Specular         float32           `json:"specular"`
	IntensityBalance float32           `json:"intensityBalancing"`
}

const (
	gldfOffCouleur  = 0x18 // function struct: input byte at +0, the mapping data reference at +0x10
	gldfOffIntens   = 0x40
	gldfOffAttenue  = 0x68
	gldfOffScalaire = 0x8c // falloff begin ratio, near fade, camera fade start, end, diffuse, specular, fog, particle, minimum roughness, intensity balancing, area radius
)

// CheapLightTag reads the cheap light `id`.
func (a *Arsenal) CheapLightTag(id uint32) (*CheapLight, error) {
	raw, err := a.geo.Extract(id)
	if err != nil {
		return nil, err
	}
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return nil, err
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	r, rTaille := ti.blockAbs(rb)
	if r < 0 || rTaille < gldfOffScalaire+44 || r+rTaille > len(ti.tag) {
		return nil, fmt.Errorf("gldf %08x: root of %d bytes", id, rTaille)
	}
	// The three functions' data, in field order (their offsets inside the root).
	donnees := ti.donneesDuChamp(rb)
	offs := make([]int, 0, len(donnees))
	for o := range donnees {
		offs = append(offs, o)
	}
	sort.Ints(offs)
	if len(offs) < 3 {
		return nil, fmt.Errorf("gldf %08x: %d functions", id, len(offs))
	}
	lit := func(entree, k int) (FonctionParticule, error) {
		return litProprieteParticule(ti.tag[r+entree:r+entree+4], donnees[offs[k]])
	}
	out := &CheapLight{ID: id}
	for k, c := range []struct {
		off int
		dst *FonctionParticule
	}{{gldfOffCouleur, &out.Color}, {gldfOffIntens, &out.Intensity}, {gldfOffAttenue, &out.FarAttenuation}} {
		f, err := lit(c.off, k)
		if err != nil {
			return nil, fmt.Errorf("gldf %08x function %d: %w", id, k, err)
		}
		*c.dst = f
	}
	s := r + gldfOffScalaire
	out.FalloffBegin = f32Brut(ti.tag, s)
	out.NearFade = f32Brut(ti.tag, s+4)
	out.CameraFade = [2]float32{f32Brut(ti.tag, s+8), f32Brut(ti.tag, s+12)}
	out.Diffuse = f32Brut(ti.tag, s+16)
	out.Specular = f32Brut(ti.tag, s+20)
	out.IntensityBalance = f32Brut(ti.tag, s+36)
	return out, nil
}
