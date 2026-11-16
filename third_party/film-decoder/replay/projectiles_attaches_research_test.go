//go:build research

package replay

// projectiles_attaches_research_test.go — LOCAL-CHANGE (infinite-theater-3d): calibration of the
// attached projectile's pose (i10 attached branch) against ground truth, over every stored match.
//
// For each attach read ([grammar.ScanProjectileAttaches]): the projectile's last replicated
// position before it (its free flight ends there, on the parent), the detonation the film writes
// for that same projectile life (with its height), and the parent's decoded positions and aim yaw.
// The table logs the world offsets projectile - parent at the attach and at the detonation, in
// world axes and in the parent's yaw frame, beside the raw pose.
//
// VERDICT (2026-11-16, 17 stored matches, 28 biped-attached cases with a detonation and a parent
// track): NO SINGLE MAPPING OF THE RAW POSE FITS. The best per-axis affine map, fitted on the cases
// themselves, explains almost none of the observed offset (|r| = 0.10 / 0.32 / 0.00 on x / y / z;
// residual median 0.10 / 0.07 / 0.14 world units, max 0.22 / 0.18 / 0.54). Two poses as different as
// [-1390 -122 171] and [-791 852 -1060] give the same detonation offset (0.03 0.13 0.45) and
// (-0.06 0.09 0.45). The pose is relative to a NODE of the parent: the R(16) after the handle
// (`Node`) groups the detonation heights (node 26: 0.45, 0.45; node 95: 0.56, 0.54; node 41: 0.50,
// 0.53; node 22: -0.01, 0.14; node 18: 0.11, 0.11), i.e. a bone of the biped, and the grenade moves
// with that bone's animation: in the parent's yaw frame its offset changes between the attach and
// the detonation by median 0.19, max 1.10 world units. The bone's transform is not in the record,
// so the pose alone cannot place the grenade. Nothing is shipped from this; the reads stay raw.
//
// USAGE: IT3D_ATTACH_MATCHES=<...>\data\matches go test -tags research ./replay/ -run TestProjectileAttachCalibration -v
// (from third_party/film-decoder).

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// attachCase is one attach read with its ground truth.
type attachCase struct {
	match      string
	a          grammar.ProjectileAttach
	last       types.ProjectileSample // last replicated position of the projectile before the attach
	deto       types.ProjectileDetonation
	hasDeto    bool
	pAttach    [3]float64 // parent position at the attach
	pDeto      [3]float64 // parent position at the detonation
	yawAttach  float64    // parent aim yaw (deg) nearest the attach
	yawDeto    float64
	parentSeen bool
}

func catalogueDesBornes(t *testing.T) *profile.MapQuantCatalog {
	t.Helper()
	cat, err := profile.LoadMapQuantCatalog(filepath.Join("..", "..", "..", "internal", "refdata", "data",
		"map_quant_bounds.json"))
	if err != nil {
		t.Fatalf("catalogue : %v", err)
	}
	return cat
}

func entreeDeCarte(cat *profile.MapQuantCatalog, mapName string) (profile.MapQuantEntry, bool) {
	name := strings.ToLower(mapName)
	if i := strings.Index(name, " - "); i > 0 {
		name = name[:i]
	}
	e, err := cat.Lookup(name)
	return e, err == nil
}

// parentAt interpolates the parent's position at `us` from its sorted samples; ok is false when no
// sample lies within 200 ms on both sides.
func parentAt(ps []grammar.BipedPosition, us uint64) ([3]float64, bool) {
	i := sort.Search(len(ps), func(i int) bool { return ps[i].TimestampUS >= us })
	if i < len(ps) && ps[i].TimestampUS == us {
		p := ps[i]
		return [3]float64{float64(p.X), float64(p.Y), float64(p.Z)}, true
	}
	// One side only (the parent's track ends at a death, often this very detonation): the nearest
	// sample within 100 ms.
	if i == 0 || i == len(ps) {
		j := i
		if i == len(ps) {
			j = i - 1
		}
		if len(ps) == 0 {
			return [3]float64{}, false
		}
		p := ps[j]
		d := int64(p.TimestampUS) - int64(us)
		if d < -100_000 || d > 100_000 {
			return [3]float64{}, false
		}
		return [3]float64{float64(p.X), float64(p.Y), float64(p.Z)}, true
	}
	a, b := ps[i-1], ps[i]
	if us-a.TimestampUS > 200_000 || b.TimestampUS-us > 200_000 {
		return [3]float64{}, false
	}
	f := float64(us-a.TimestampUS) / float64(b.TimestampUS-a.TimestampUS)
	return [3]float64{
		float64(a.X) + f*float64(b.X-a.X), float64(a.Y) + f*float64(b.Y-a.Y), float64(a.Z) + f*float64(b.Z-a.Z),
	}, true
}

// yawNear returns the aim yaw (deg) of the parent sample nearest `us` that carries one.
func yawNear(ps []grammar.BipedPosition, us uint64) float64 {
	best, bestD := math.NaN(), uint64(math.MaxUint64)
	for _, p := range ps {
		if !p.HasYaw {
			continue
		}
		d := p.TimestampUS - us
		if p.TimestampUS < us {
			d = us - p.TimestampUS
		}
		if d < bestD {
			best, bestD = (float64(p.YawRaw)+0.5)*360/4096, d
		}
	}
	return best
}

func casDUnMatch(t *testing.T, cat *profile.MapQuantCatalog, dir string) []attachCase {
	t.Helper()
	var meta struct {
		MapName string `json:"mapName"`
	}
	raw, err := os.ReadFile(filepath.Join(dir, "match.json"))
	if err != nil || json.Unmarshal(raw, &meta) != nil {
		t.Logf("%s : match.json illisible", filepath.Base(dir))
		return nil
	}
	entry, ok := entreeDeCarte(cat, meta.MapName)
	if !ok {
		t.Logf("%s : carte %q absente du catalogue", filepath.Base(dir), meta.MapName)
		return nil
	}
	film, err := source.LoadDir(filepath.Join(dir, "chunks"), nil)
	if err != nil {
		t.Logf("%s : chunks illisibles : %v", filepath.Base(dir), err)
		return nil
	}
	var pos []grammar.BipedPosition
	var tracks []types.ProjectileTrack
	var detos []types.ProjectileDetonation
	opt := Options{MapQuant: &entry, Observe: func(step string, v any) {
		switch step {
		case "positions":
			pos, _ = v.([]grammar.BipedPosition)
		case "projectiles":
			tracks, _ = v.([]types.ProjectileTrack)
		case "detonations":
			detos, _ = v.([]types.ProjectileDetonation)
		}
	}}
	ctx := context.Background()
	if _, err := BuildFromFilm(ctx, filepath.Base(dir), "halo_infinite", film, opt); err != nil {
		t.Logf("%s : assemblage : %v", filepath.Base(dir), err)
		return nil
	}
	// The attach reads under a context opened the way the cook opens its own (map entry, then the
	// world-object widths of the catalog): without those widths the walk desyncs on ti=41.
	fc := grammar.NewFilmContextForMap(film, &entry, decoupageForce(opt))
	poserProfilPuisCarte(ctx, fc, filepath.Base(dir), opt)
	attaches, err := grammar.ScanProjectileAttaches(fc)
	if err != nil {
		t.Logf("%s : attaches : %v", filepath.Base(dir), err)
		return nil
	}
	bySlot := map[uint32][]grammar.BipedPosition{}
	for _, p := range pos {
		if p.HasWorld {
			bySlot[p.Slot] = append(bySlot[p.Slot], p)
		}
	}
	for s := range bySlot {
		sort.Slice(bySlot[s], func(i, j int) bool { return bySlot[s][i].TimestampUS < bySlot[s][j].TimestampUS })
	}
	var out []attachCase
	for _, a := range attaches {
		c := attachCase{match: filepath.Base(dir)[:8], a: a}
		for _, tr := range tracks {
			if tr.Slot != a.Life.Slot || tr.Gen != a.Life.Gen {
				continue
			}
			l := tr.Pts[len(tr.Pts)-1]
			if l.TimestampUS <= a.TimestampUS && a.TimestampUS-l.TimestampUS <= 250_000 {
				c.last = l
			}
		}
		// The detonation names its projectile WITHOUT the 0x400 base of the projectile band (measured:
		// d01ba030 slot 1133 <-> 109, 1206 <-> 182, 1040 <-> 16).
		for _, d := range detos {
			if d.HasProjectile && d.HasPosition && d.Projectile.Slot+0x400 == a.Life.Slot &&
				d.Projectile.Gen == a.Life.Gen && d.TimestampUS > a.TimestampUS &&
				d.TimestampUS < a.TimestampUS+6_000_000 {
				c.deto, c.hasDeto = d, true
				break
			}
		}
		ps := bySlot[a.Parent.Slot]
		var ok1, ok2 bool
		c.pAttach, ok1 = parentAt(ps, a.TimestampUS)
		if c.hasDeto {
			c.pDeto, ok2 = parentAt(ps, c.deto.TimestampUS)
		}
		c.parentSeen = ok1 && (ok2 || !c.hasDeto)
		c.yawAttach = yawNear(ps, a.TimestampUS)
		if c.hasDeto {
			c.yawDeto = yawNear(ps, c.deto.TimestampUS)
		}
		out = append(out, c)
	}
	return out
}

func sq(v float64) float64 { return v * v }

// local rotates a world offset into the frame of a parent facing `yawDeg`.
func local(o [3]float64, yawDeg float64) [3]float64 {
	r := -yawDeg * math.Pi / 180
	c, s := math.Cos(r), math.Sin(r)
	return [3]float64{c*o[0] - s*o[1], s*o[0] + c*o[1], o[2]}
}

func TestProjectileAttachCalibration(t *testing.T) {
	root := os.Getenv("IT3D_ATTACH_MATCHES")
	if root == "" {
		t.Skip("IT3D_ATTACH_MATCHES absent : instrument saute")
	}
	cat := catalogueDesBornes(t)
	ents, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	var all []attachCase
	for _, e := range ents {
		if e.IsDir() && strings.HasPrefix(e.Name(), os.Getenv("IT3D_ATTACH_ONLY")) {
			all = append(all, casDUnMatch(t, cat, filepath.Join(root, e.Name()))...)
		}
	}
	t.Logf("%d lectures attachees", len(all))
	var resRigide, resFixe []float64
	for _, c := range all {
		if !c.hasDeto || !c.parentSeen || c.last.TimestampUS == 0 || math.IsNaN(c.yawAttach) || math.IsNaN(c.yawDeto) {
			t.Logf("SKIP %s life=%d/%d parent=%d node=%d deto=%v parentSeen=%v lastFlight=%v yaw=%.0f/%.0f",
				c.match, c.a.Life.Slot, c.a.Life.Gen, c.a.Parent.Slot, c.a.Node, c.hasDeto, c.parentSeen,
				c.last.TimestampUS != 0, c.yawAttach, c.yawDeto)
			continue
		}
		s := [3]int{int(c.a.Pose[0]) - 32768, int(c.a.Pose[1]) - 32768, int(c.a.Pose[2]) - 32768}
		oA := [3]float64{float64(c.last.X) - c.pAttach[0], float64(c.last.Y) - c.pAttach[1], float64(c.last.Z) - c.pAttach[2]}
		oD := [3]float64{float64(c.deto.X) - c.pDeto[0], float64(c.deto.Y) - c.pDeto[1], float64(c.deto.Z) - c.pDeto[2]}
		lA, lD := local(oA, c.yawAttach), local(oD, c.yawDeto)
		dl := math.Sqrt(sq(lA[0]-lD[0]) + sq(lA[1]-lD[1]) + sq(lA[2]-lD[2]))
		dw := math.Sqrt(sq(oA[0]-oD[0]) + sq(oA[1]-oD[1]) + sq(oA[2]-oD[2]))
		resRigide, resFixe = append(resRigide, dl), append(resFixe, dw)
		mag := math.Sqrt(float64(s[0]*s[0] + s[1]*s[1] + s[2]*s[2]))
		t.Logf("TABLE %s life=%d/%d detoGen=%d parent=%d node=%d pose=%v |pose|=%.0f attach->deto=%dms | "+
			"lA=(%.2f %.2f %.2f) lD=(%.2f %.2f %.2f) |lA|=%.2f | rigid-in-yaw residual=%.2f world-fixed residual=%.2f",
			c.match, c.a.Life.Slot, c.a.Life.Gen, c.deto.Projectile.Gen, c.a.Parent.Slot, c.a.Node, s, mag,
			int64(c.deto.TimestampUS-c.a.TimestampUS)/1000, lA[0], lA[1], lA[2], lD[0], lD[1], lD[2],
			math.Sqrt(sq(lA[0])+sq(lA[1])+sq(lA[2])), dl, dw)
	}
	sort.Float64s(resRigide)
	sort.Float64s(resFixe)
	if n := len(resRigide); n > 0 {
		t.Logf("RESUME %d cas : residu rigide-en-cap mediane %.2f max %.2f ; residu fixe-monde mediane %.2f max %.2f",
			n, resRigide[n/2], resRigide[n-1], resFixe[n/2], resFixe[n-1])
	}
	// THE MAPPING TEST: the best affine map per axis, observed detonation offset (parent yaw frame)
	// = c + k * (pose - 32768), fitted by least squares on the cases themselves. A dequantization of
	// a parent-relative pose would be one such map (or a stricter one); its residuals bound any.
	var poses, offs [][3]float64
	for _, c := range all {
		if !c.hasDeto || !c.parentSeen || c.last.TimestampUS == 0 || math.IsNaN(c.yawAttach) || math.IsNaN(c.yawDeto) {
			continue
		}
		oD := [3]float64{float64(c.deto.X) - c.pDeto[0], float64(c.deto.Y) - c.pDeto[1], float64(c.deto.Z) - c.pDeto[2]}
		poses = append(poses, [3]float64{float64(c.a.Pose[0]) - 32768, float64(c.a.Pose[1]) - 32768, float64(c.a.Pose[2]) - 32768})
		offs = append(offs, local(oD, c.yawDeto))
	}
	for ax := range 3 {
		var p, d []float64
		for i := range poses {
			p, d = append(p, poses[i][ax]), append(d, offs[i][ax])
		}
		k, c0, r := ajustementAffine(p, d)
		res := make([]float64, len(p))
		for i := range p {
			res[i] = math.Abs(d[i] - (c0 + k*p[i]))
		}
		sort.Float64s(res)
		if n := len(res); n > 0 {
			t.Logf("AJUSTEMENT axe %d : k=%.3g c=%.3f r=%.2f | residu mediane %.3f max %.3f", ax, k, c0, r, res[n/2], res[n-1])
		}
	}
}

// ajustementAffine fits d = c + k*p by least squares and returns k, c and the correlation r.
func ajustementAffine(p, d []float64) (k, c, r float64) {
	n := float64(len(p))
	if n == 0 {
		return 0, 0, 0
	}
	var mp, md float64
	for i := range p {
		mp, md = mp+p[i]/n, md+d[i]/n
	}
	var sxy, sxx, syy float64
	for i := range p {
		sxy += (p[i] - mp) * (d[i] - md)
		sxx += (p[i] - mp) * (p[i] - mp)
		syy += (d[i] - md) * (d[i] - md)
	}
	if sxx == 0 || syy == 0 {
		return 0, md, 0
	}
	k = sxy / sxx
	return k, md - k*mp, sxy / math.Sqrt(sxx*syy)
}
