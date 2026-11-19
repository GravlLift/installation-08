// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwise

// attenuation.go reads a v135 attenuation (HIRC type 14): the curves that set a sound's level,
// reverb send and filtering by its distance to the listener. A node names its attenuation with
// property 0x46 (PropAttenuationID); EventMediaMix finds the one each media plays with.
//
// Layout (probed on Halo Infinite's banks, 2026-11-19):
//
//	u8   cone enabled; when set, five float32 follow (inside angle, outside angle, outside
//	     volume, outside low-pass, outside high-pass)
//	i8×7 the curve each parameter uses, an index into the curves or -1 (none): dry volume,
//	     game-defined aux send, user-defined aux send, low-pass, high-pass, spread, focus
//	u8   curve count, then per curve: u8 scaling, u16 point count, points of
//	     (float32 distance, float32 value, u32 interpolation to the next point)
//
// A volume curve (scaling 2) stores its value as linear amplitude minus one: 0 is 0 dB, -1 is
// silence. Measured, not assumed: the stored values land on round dB figures that way
// (-0.43765867 is -5.0 dB, -0.74881136 is -12.0 dB, -0.85874623 is -17.0 dB, -0.99 is -40 dB).

import (
	"encoding/binary"
	"fmt"
	"math"
)

// HircAttenuation is the HIRC type of an attenuation.
const HircAttenuation = 14

// The parameters an attenuation can drive, in the order of its curve map.
const (
	AttenVolumeDry = iota
	AttenAuxGame
	AttenAuxUser
	AttenLowPass
	AttenHighPass
	AttenSpread
	AttenFocus
	attenParams
)

// Curve scalings.
const (
	ScalingNone = 0
	ScalingDB   = 2
)

// CurvePoint is one point of a curve: at Distance the parameter is Value, and Interp shapes the
// segment to the next point (Wwise AkCurveInterpolation: 0 log3, 1 sine, 2 log1, 3 inverted
// S-curve, 4 linear, 5 S-curve, 6 exp1, 7 reciprocal sine, 8 exp3, 9 constant).
type CurvePoint struct {
	Distance float32
	Value    float32
	Interp   uint32
}

// Curve is one attenuation curve.
type Curve struct {
	Scaling byte
	Points  []CurvePoint
}

// Attenuation is a parsed attenuation: Uses[p] is the index in Curves of the curve parameter p
// follows, or -1.
type Attenuation struct {
	ID     uint32
	Cone   bool
	Uses   [attenParams]int
	Curves []Curve
}

// Curve returns the curve parameter p follows, if any.
func (a Attenuation) Curve(p int) (Curve, bool) {
	if p < 0 || p >= attenParams {
		return Curve{}, false
	}
	i := a.Uses[p]
	if i < 0 || i >= len(a.Curves) {
		return Curve{}, false
	}
	return a.Curves[i], true
}

// MaxDistance is the last distance of the dry volume curve: beyond it the curve holds its last
// value. 0 when the attenuation has no volume curve.
func (a Attenuation) MaxDistance() float32 {
	c, ok := a.Curve(AttenVolumeDry)
	if !ok || len(c.Points) == 0 {
		return 0
	}
	return c.Points[len(c.Points)-1].Distance
}

// maxCurvePoints bounds a curve's point count; the game's have a handful.
const maxCurvePoints = 256

// ParseAttenuation reads an attenuation object.
func ParseAttenuation(o HircObject) (Attenuation, error) {
	if o.Type != HircAttenuation {
		return Attenuation{}, fmt.Errorf("wwise: object %08x is type %d, not an attenuation", o.ID, o.Type)
	}
	b := o.Body
	a := Attenuation{ID: o.ID}
	if len(b) < 1 {
		return Attenuation{}, fmt.Errorf("wwise: attenuation %08x is empty", o.ID)
	}
	off := 1
	if b[0]&1 != 0 {
		a.Cone = true
		off += 5 * 4
	}
	if len(b) < off+attenParams+1 {
		return Attenuation{}, fmt.Errorf("wwise: attenuation %08x: %d bytes", o.ID, len(b))
	}
	for p := 0; p < attenParams; p++ {
		a.Uses[p] = int(int8(b[off+p]))
	}
	off += attenParams
	n := int(b[off])
	off++
	for c := 0; c < n; c++ {
		if len(b) < off+3 {
			return Attenuation{}, fmt.Errorf("wwise: attenuation %08x: curve %d truncated", o.ID, c)
		}
		cv := Curve{Scaling: b[off]}
		np := int(binary.LittleEndian.Uint16(b[off+1:]))
		off += 3
		if np > maxCurvePoints || len(b) < off+12*np {
			return Attenuation{}, fmt.Errorf("wwise: attenuation %08x: curve %d of %d points", o.ID, c, np)
		}
		for i := 0; i < np; i++ {
			p := CurvePoint{
				Distance: math.Float32frombits(binary.LittleEndian.Uint32(b[off:])),
				Value:    math.Float32frombits(binary.LittleEndian.Uint32(b[off+4:])),
				Interp:   binary.LittleEndian.Uint32(b[off+8:]),
			}
			if i > 0 && p.Distance < cv.Points[i-1].Distance {
				return Attenuation{}, fmt.Errorf("wwise: attenuation %08x: curve %d goes back in distance", o.ID, c)
			}
			cv.Points = append(cv.Points, p)
			off += 12
		}
		a.Curves = append(a.Curves, cv)
	}
	for p, i := range a.Uses {
		if i >= len(a.Curves) {
			return Attenuation{}, fmt.Errorf("wwise: attenuation %08x: parameter %d uses curve %d of %d", o.ID, p, i, len(a.Curves))
		}
	}
	return a, nil
}
