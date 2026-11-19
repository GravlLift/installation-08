// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwise

import (
	"encoding/binary"
	"math"
	"testing"
)

// attenBody encodes an attenuation body: cone flag (and five cone floats when set), the curve
// map, then the curves.
func attenBody(cone bool, uses [attenParams]int8, curves []Curve) []byte {
	var b []byte
	if cone {
		b = append(b, 1)
		for _, v := range []float32{115, 260, -4, 25, 0} {
			b = binary.LittleEndian.AppendUint32(b, math.Float32bits(v))
		}
	} else {
		b = append(b, 0)
	}
	for _, u := range uses {
		b = append(b, byte(u))
	}
	b = append(b, byte(len(curves)))
	for _, c := range curves {
		b = append(b, c.Scaling)
		b = binary.LittleEndian.AppendUint16(b, uint16(len(c.Points)))
		for _, p := range c.Points {
			b = binary.LittleEndian.AppendUint32(b, math.Float32bits(p.Distance))
			b = binary.LittleEndian.AppendUint32(b, math.Float32bits(p.Value))
			b = binary.LittleEndian.AppendUint32(b, p.Interp)
		}
	}
	// An RTPC count follows in the game's objects; the reader stops before it.
	return append(b, 0, 0)
}

// The shape of the game's run foot step attenuation (1b9ccf03): five curves, the dry volume
// silent at 12.
var footCurves = []Curve{
	{ScalingDB, []CurvePoint{{0, 0, 9}, {1, 0, 8}, {7, -0.74881136, 1}, {12, -0.9999847, 4}}},
	{ScalingDB, []CurvePoint{{0, -0.43765867, 9}, {3.3333333, -0.43765867, 4}, {10.00732, -0.66537875, 4}, {12, -0.99, 4}}},
	{ScalingNone, []CurvePoint{{0, 0, 9}, {0.49468, 0, 4}, {2.66968, 37, 4}, {12, 60, 4}}},
	{ScalingNone, []CurvePoint{{0, 0, 9}, {0.470744, 0, 4}, {2.6923933, 35, 4}, {12, 43, 4}}},
	{ScalingNone, []CurvePoint{{0, 50, 4}, {1.6, 0, 9}, {12, 0, 4}}},
}

func TestParseAttenuationReadsTheCurves(t *testing.T) {
	o := HircObject{Type: HircAttenuation, ID: 0x1b9ccf03, Body: attenBody(false, [attenParams]int8{0, 1, 0, 2, 3, 4, -1}, footCurves)}
	a, err := ParseAttenuation(o)
	if err != nil {
		t.Fatal(err)
	}
	if a.Cone || len(a.Curves) != 5 || a.Uses[AttenFocus] != -1 || a.Uses[AttenAuxGame] != 1 {
		t.Fatalf("attenuation %+v", a)
	}
	dry, ok := a.Curve(AttenVolumeDry)
	if !ok || len(dry.Points) != 4 || dry.Points[2].Value != float32(-0.74881136) || dry.Points[1].Interp != 8 {
		t.Fatalf("dry curve %+v", dry)
	}
	if _, ok := a.Curve(AttenFocus); ok {
		t.Fatal("focus has no curve")
	}
	if a.MaxDistance() != 12 {
		t.Fatalf("max distance %v", a.MaxDistance())
	}
}

func TestParseAttenuationSkipsTheCone(t *testing.T) {
	o := HircObject{Type: HircAttenuation, ID: 7, Body: attenBody(true, [attenParams]int8{0, -1, 0, -1, -1, -1, -1}, footCurves[:1])}
	a, err := ParseAttenuation(o)
	if err != nil {
		t.Fatal(err)
	}
	if !a.Cone || a.MaxDistance() != 12 {
		t.Fatalf("attenuation %+v", a)
	}
}

func TestParseAttenuationRefusesBadBodies(t *testing.T) {
	good := attenBody(false, [attenParams]int8{0, 1, 0, 2, 3, 4, -1}, footCurves)
	for _, n := range []int{0, 5, 12, 40} {
		if _, err := ParseAttenuation(HircObject{Type: HircAttenuation, Body: good[:n]}); err == nil {
			t.Fatalf("a body cut at %d parsed", n)
		}
	}
	if _, err := ParseAttenuation(HircObject{Type: HircSound, Body: good}); err == nil {
		t.Fatal("a sound parsed as an attenuation")
	}
	bad := attenBody(false, [attenParams]int8{0, 9, 0, 2, 3, 4, -1}, footCurves)
	if _, err := ParseAttenuation(HircObject{Type: HircAttenuation, Body: bad}); err == nil {
		t.Fatal("a map naming a missing curve parsed")
	}
}

func TestEventMediaMixTakesTheNearestAttenuation(t *testing.T) {
	props := func(parent uint32, ids []byte, vals []uint32) []byte {
		// fx flags, fx count 0, then override bus (u8) + bus id (u32) + parent (u32) + misc (u8),
		// then the prop bundle.
		b := []byte{0, 0, 0, 0, 0, 0, 0}
		b = binary.LittleEndian.AppendUint32(b, parent)
		b = append(b, 0, byte(len(ids)))
		b = append(b, ids...)
		for _, v := range vals {
			b = binary.LittleEndian.AppendUint32(b, v)
		}
		return append(b, 0)
	}
	vol := func(db float32) uint32 { return math.Float32bits(db) }
	// sound 401 (media 9001) -> container 300 (atten 0xA, -6 dB) -> mixer 500 (atten 0xB, +2 dB)
	sound := append(soundBody(9001)[:9], 0, 0, 0, 0, 0)
	sound = append(sound, props(300, nil, nil)...)
	container := props(500, []byte{PropVolume, PropAttenuationID, PropGameAuxSend}, []uint32{vol(-6), 0xA, vol(-30)})
	mixer := props(0, []byte{PropVolume, PropAttenuationID, PropGameAuxSend}, []uint32{vol(2), 0xB, vol(5)})
	bk := &Bank{Objects: map[uint32]HircObject{
		100: {Type: HircEvent, ID: 100, Body: append([]byte{1}, le32(nil, 200)...)},
		200: {Type: HircAction, ID: 200, Body: le32(binary.LittleEndian.AppendUint16(nil, 0x0403), 401)},
		401: {Type: HircSound, ID: 401, Body: sound},
		300: {Type: HircRandomSeq, ID: 300, Body: container},
		500: {Type: HircActorMix, ID: 500, Body: mixer},
	}}
	got := bk.EventMediaMix(100)[9001]
	if got.GainDB != -4 || got.Attenuation != 0xA || got.GameAuxSendDB != -25 {
		t.Fatalf("mix %+v", got)
	}
}
