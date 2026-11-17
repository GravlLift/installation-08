// idle_frames.go — the frames an idle effect is emitted in (its markers' model-space position and
// rotation) and the animation functions a weapon's reloads set.
package weapons

import (
	"context"
	"fmt"
	"log/slog"
	"math"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// markerFrame is the marker frame `t` (model space, Halo axes) in GLB axes: its origin and its
// rotation as a quaternion (x, y, z, w). The axis change P maps (x, y, z) to (x, z, -y); a rotation R
// becomes P R P^T.
func markerFrame(t himap.Transforme) ([3]float64, [4]float64) {
	r := t.Rot
	// P R P^T, row-major: rows/columns (x, z, -y) of R.
	idx := [3]int{0, 2, 1}
	sgn := [3]float64{1, 1, -1}
	var g [9]float64
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			g[i*3+j] = sgn[i] * sgn[j] * r[idx[i]*3+idx[j]]
		}
	}
	return gltfOf(t.Trans), quatOfRotation(g)
}

// quatOfRotation is the unit quaternion (x, y, z, w) of the row-major rotation matrix m.
func quatOfRotation(m [9]float64) [4]float64 {
	tr := m[0] + m[4] + m[8]
	var q [4]float64
	switch {
	case tr > 0:
		s := math.Sqrt(tr+1) * 2
		q = [4]float64{(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4}
	case m[0] > m[4] && m[0] > m[8]:
		s := math.Sqrt(1+m[0]-m[4]-m[8]) * 2
		q = [4]float64{s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s}
	case m[4] > m[8]:
		s := math.Sqrt(1+m[4]-m[0]-m[8]) * 2
		q = [4]float64{(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s}
	default:
		s := math.Sqrt(1+m[8]-m[0]-m[4]) * 2
		q = [4]float64{(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s}
	}
	for k := range q {
		q[k] = roundRange(q[k]) + 0
	}
	return q
}

// reloadFunctionTolerance: two values of a reload function closer than this are one value.
const reloadFunctionTolerance = 1e-6

// reloadFunctions reads the animation functions the weapon's reload animations set, keeping those
// that hold one value over every frame of every reload animation (logged otherwise). Nil without one.
func (w effectWriter) reloadFunctions(ctx context.Context, weap uint32) map[string]float64 {
	fs, err := w.a.FonctionsDuRechargement(ctx, weap)
	if err != nil {
		slog.WarnContext(ctx, "weapon reload animation functions unreadable", "weapon", fmt.Sprintf("%08x", weap), "err", err)
		return nil
	}
	values := map[string]float64{}
	varying := map[string]bool{}
	for _, f := range fs {
		name := functionName(f.Nom)
		for _, v := range f.Valeurs {
			if prev, ok := values[name]; ok && math.Abs(prev-v) > reloadFunctionTolerance {
				varying[name] = true
			}
			values[name] = v
		}
	}
	for name := range varying {
		slog.WarnContext(ctx, "weapon reload animation function varies, left out", "weapon", fmt.Sprintf("%08x", weap), "function", name)
		delete(values, name)
	}
	if len(values) == 0 {
		return nil
	}
	return values
}
