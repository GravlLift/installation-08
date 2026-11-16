package grammar

// projectile_attaches_test.go — LOCAL-CHANGE (infinite-theater-3d): the ti=41 i3 width and the i10
// attached read, on two records captured from match d01ba030 by the frame walk
// (stick_marche_research_test.go, TestStickRecordCapture): each fixture is the record's bits from its
// first component to the walk's FinBit, MSB first.

import (
	"encoding/hex"
	"testing"
)

func lecteurDeFixture(t *testing.T, h string) *Lecteur {
	t.Helper()
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	return LecteurSur(b)
}

// TestProjectileI3WidthOnCapturedRecord: slot 1024, chunk 2 pk 1084, components i0 i1 i2 i3 i13 i14
// i15 i20 (209 bits). i3 starts at +114 with its leading bit 0: the dispatch's deser (R(1), R(19),
// R(8)) takes 28 bits, and the four components after it then end exactly at the record's end.
func TestProjectileI3WidthOnCapturedRecord(t *testing.T) {
	br := lecteurDeFixture(t, "0bd3a403a702d469cfc6b91f0a5fca420774734028000000208000")
	const i3At, i13At, fin = 114, 142, 209
	br.SetBitPos(i3At)
	if !consumeOK(br, "object-angular-velocity-component") {
		t.Fatal("i3 not ported")
	}
	if br.BitPos() != i13At {
		t.Fatalf("i3 took %d bits, want 28 (R(1) gate 0 + R(19) + R(8))", br.BitPos()-i3At)
	}
	for _, name := range []string{compObjectMaximumVitalities, compObjectDissolver, compObjectLowFrequency,
		"projectile-command_tick"} {
		if !consumeOK(br, name) {
			t.Fatalf("%s not ported", name)
		}
	}
	if br.BitPos() != fin {
		t.Fatalf("record ends at +%d, the walk's next record starts at +%d", br.BitPos(), fin)
	}
}

// TestProjectileAttachedI10OnCapturedRecord: d01ba030 proj 107 (slot 1133, chunk 14 pk 1906), the
// record that sticks it to l DesTroy l (track slot 561): components i1 i3 i10 i18 (134 bits), no i0.
func TestProjectileAttachedI10OnCapturedRecord(t *testing.T) {
	br := lecteurDeFixture(t, "f18a002c1f75a12420445e4404f0732b20")
	const i10At, i18At, fin = 2, 113, 134
	for _, name := range []string{"object-translational-velocity-component", "object-angular-velocity-component"} {
		if !consumeOK(br, name) {
			t.Fatalf("%s not ported", name)
		}
	}
	if br.BitPos() != i10At {
		t.Fatalf("i10 starts at +%d, want +%d", br.BitPos(), i10At)
	}
	// recordStateParam 3: the level the walk read this component under.
	st := decodeObjectParentState(br, 3, ProjectileTypeIndex)
	if br.BitPos() != i18At {
		t.Fatalf("i10 ends at +%d, want +%d", br.BitPos(), i18At)
	}
	if !st.Attached {
		t.Fatal("i10 attached gate closed")
	}
	if got := (st.Quant16 & parentHandleValueMask) + parentHandleBase; got != 561 || st.Quant16>>30 != 1 {
		t.Fatalf("parent = slot %d gen %d, want 561 gen 1", got, st.Quant16>>30)
	}
	if st.Word16 != 22 || st.Mtx != [3]uint32{32214, 33936, 33041} || !st.HasVel || st.Vel != 0x79101 || st.Byte8 != 0x3c {
		t.Fatalf("attached branch = node %d pose %v vel %v/%#x byte8 %#x", st.Word16, st.Mtx, st.HasVel, st.Vel, st.Byte8)
	}
	if !consumeOK(br, "projectile-at-rest-state") {
		t.Fatal("i18 not ported")
	}
	if br.BitPos() != fin {
		t.Fatalf("record ends at +%d, want +%d", br.BitPos(), fin)
	}
}

// consumeOK consumes one ti=41 component through the production dispatch.
func consumeOK(br *Lecteur, name string) bool {
	_, _, _, ported := consumeByNameCapturing(br, name, ProjectileTypeIndex, 0)
	consumeCorruptionCheck(br)
	return ported
}
