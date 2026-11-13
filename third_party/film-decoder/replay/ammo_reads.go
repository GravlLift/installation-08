package replay

import (
	"cmp"
	"github.com/JGtm/halo-infinite-film-decoder/types"
	"slices"
)

// AmmoRead est une lecture de munitions pour une vie et un emplacement d arme.
type AmmoRead struct {
	T    int     `json:"t"`
	Ms   int64   `json:"ms"`
	Slot uint32  `json:"slot"`
	W    int     `json:"w"`
	Mag  *uint32 `json:"mag,omitempty"`
	Res  *uint32 `json:"res,omitempty"`
	// Gauge est la fraction consommee, entre zero et un.
	Gauge *float32 `json:"gauge,omitempty"`
	Src   string   `json:"src"`
}
type lectureAmmoDatee struct {
	lecture   AmmoRead
	timestamp uint64
}

// buildAmmoReads publie les valeurs presentes, ordonnees sur l horloge du film.
func buildAmmoReads(kf []types.KeyframeInventory, deltas []types.InventoryDelta, origin, step uint64, refuse bool) []AmmoRead {
	if step == 0 {
		return nil
	}
	var dates []lectureAmmoDatee
	for _, r := range kf {
		if r.TimestampUS < origin || !r.AmmoRead {
			continue
		}
		for w, a := range ammoSlotsOf(r) {
			if a.Mag == nil && a.Res == nil && a.Gauge == nil {
				continue
			}
			dates = append(dates, lectureAmmoDatee{AmmoRead{T: int((r.TimestampUS - origin) / step), Ms: int64((r.TimestampUS - origin) / fullRateTimeUnitUS), Slot: r.Slot, W: w, Mag: a.Mag, Res: a.Res, Gauge: a.Gauge, Src: GrenadeSrcKeyframe}, r.TimestampUS})
		}
	}
	if !refuse {
		for _, d := range deltas {
			if d.TimestampUS < origin {
				continue
			}
			for _, a := range d.Ammo {
				if a.Mag == nil && a.Res == nil && a.FracQ == nil {
					continue
				}
				var gauge *float32
				if a.FracQ != nil {
					v := float32(float64(*a.FracQ) / 4095.0)
					gauge = &v
				}
				dates = append(dates, lectureAmmoDatee{AmmoRead{T: int((d.TimestampUS - origin) / step), Ms: int64((d.TimestampUS - origin) / fullRateTimeUnitUS), Slot: d.Slot, W: a.WeaponSlot, Mag: a.Mag, Res: a.Res, Gauge: gauge, Src: GrenadeSrcDelta}, d.TimestampUS})
			}
		}
	}
	slices.SortStableFunc(dates, func(a, b lectureAmmoDatee) int {
		return cmp.Or(cmp.Compare(a.timestamp, b.timestamp), cmp.Compare(b.lecture.Src, a.lecture.Src))
	})
	var out []AmmoRead
	precedent := make(map[[2]uint32]AmmoRead)
	for _, d := range dates {
		r := d.lecture
		cle := [2]uint32{r.Slot, uint32(r.W)}
		if p, ok := precedent[cle]; ok && egauxAmmo(p.Mag, r.Mag) && egauxAmmo(p.Res, r.Res) && egauxAmmo(p.Gauge, r.Gauge) {
			continue
		}
		precedent[cle] = r
		out = append(out, r)
	}
	return out
}
func egauxAmmo[T comparable](a, b *T) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func attachAmmoReadCoverage(doc *ReplayDocument, built []AmmoRead, refuse bool) {
	if doc.Coverage == nil || len(built) == 0 {
		return
	}
	cov := &GrenadeReadCoverage{Unpublished: countUnpublished(len(built), len(doc.AmmoReads)), AmmoRefused: refuse}
	for _, r := range doc.AmmoReads {
		if r.Src == GrenadeSrcDelta {
			cov.FromDelta++
		} else {
			cov.FromKeyframe++
		}
	}
	doc.Coverage.AmmoReads = cov
}
