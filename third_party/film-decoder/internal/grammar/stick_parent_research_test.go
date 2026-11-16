//go:build research

package grammar

// stick_parent_research_test.go — DECODE the ONE `object-parent-state-component` (i10) record
// found on the sticking projectile (slot 1133, match d01ba030, proj 107) and checks whether its
// Quant16 parent handle resolves to the known victim slot (561, confirmed from the stored
// replay.json.gz: track slot 561 is "l DesTroy l", dies at frame 8289 = detoT). Also dumps the
// raw Mtx/Vel fields: THEIR DEQUANTIZATION IS NOT ESTABLISHED ANYWHERE IN THIS CODEBASE
// (components_object_state.go calls them "BRUTS et NON INTERPRÉTÉS"), so this instrument reports
// the raw values for the record, not a computed offset — inventing a scale would be a guess, not
// a reading.
//
// VERDICT : zero i10 readings on ANY ti=41 record in this whole match (see the TOTAL log line).
// stick_packet_research_test.go explains why: the one record this entity's attach transition
// carries (chunk=14, pk=1906, idx=[1 3 10 18], see stick_investigation_research_test.go) sits in
// a packet whose form byte (pay[0]&0x40 != 0) the clean full-record walker (DecodeFrameRecords,
// which is what wires decodeObjectParentState's result to this hook) refuses outright. Reading
// Quant16/Mtx for this specific record would need a hand-rolled bit walk starting at rec.After
// (available from the low-level scan), consuming i1 and i3 at their own widths first — and i3
// (object-angular-velocity-component) has no width established anywhere in this codebase
// (testdata/ecs_table.tsv marks it "aucun" for ti=41). That, plus Mtx's unestablished
// dequantization, is where this investigation stops without new reverse-engineering.

import (
	"os"
	"testing"
)

const stickTargetSlotEnv = "IT3D_STICK_SLOT"

func TestStickParentState(t *testing.T) {
	dir := os.Getenv(stickDirEnv)
	if dir == "" {
		t.Skipf("%s absent : instrument saute", stickDirEnv)
	}
	raw, err := ReadFilmChunk(dir, 0)
	if err != nil {
		t.Fatalf("registre illisible : %v", err)
	}
	reg, err := ParseRegistryChunk(raw)
	if err != nil {
		t.Fatalf("registre illisible : %v", err)
	}

	var targetSlot uint32 = 1133 // found by TestStickInvestigation for d01ba030 proj 107
	if v := os.Getenv(stickTargetSlotEnv); v != "" {
		var p uint32
		for _, c := range v {
			p = p*10 + uint32(c-'0')
		}
		targetSlot = p
	}

	type seen struct {
		ts          uint64
		curBR       *Lecteur
		st          ObjectParentState
		haveReading bool
	}
	var s seen
	var anyTi41 int
	var attachedTi41 int
	prev := observateur.ObjectParentStateHook
	SetObjectParentStateHook(func(st ObjectParentState) {
		if st.TypeIndex != ProjectileTypeIndex || s.curBR == nil {
			return
		}
		anyTi41++
		if st.Attached {
			attachedTi41++
			t.Logf("  [tout ti=41 attache] slot=%d t=%dus Quant16=0x%x", s.curBR.cap.accumSlot, s.ts, st.Quant16)
		}
		if s.curBR.cap.accumSlot != targetSlot {
			return
		}
		s.st, s.haveReading = st, true
	})
	defer SetObjectParentStateHook(prev)
	defer func() { t.Logf("TOTAL lectures i10 sur ti=41 : %d (dont attachees : %d)", anyTi41, attachedTi41) }()

	cfg := DefaultFrameConfig()
	n := CountFilmChunks(dir)
	for c := 1; c <= n; c++ {
		data, err := ReadFilmChunk(dir, c)
		if err != nil {
			continue
		}
		pks := WalkPackets(data)
		w := NewWorld(reg)
		for _, pk := range pks {
			if pk.Type != PacketTypeKeyframe {
				continue
			}
			for _, r := range WalkKeyframeWorld(pk.Payload(data)) {
				w.BindFull(uint32((r.Gen<<30)|r.Slot), uint32(r.TI))
			}
		}
		for _, pk := range pks {
			if pk.Type != PacketTypeDelta || pk.Size < 1 {
				continue
			}
			pay := pk.Payload(data)
			if pay[0]&0x40 != 0 {
				continue
			}
			br := lecteurDInstrument(pay)
			s.curBR, s.ts = br, pk.TimestampUS
			_, _ = DecodeFrameRecords(br, w, cfg)
			if s.haveReading {
				t.Logf("LECTURE i10 sur slot %d, t=%dus : Attached=%v", targetSlot, s.ts, s.st.Attached)
				if s.st.Attached {
					t.Logf("  Quant16 (handle du parent, brut, espace dom1) = 0x%x (%d)", s.st.Quant16, s.st.Quant16)
					for _, base := range lot1chBases {
						slot := uint32(base) + (s.st.Quant16 & parentHandleValueMask)
						mark := ""
						if slot == 561 {
							mark = "  <-- EGALE LE SLOT VICTIME CONNU (561)"
						}
						t.Logf("    base=%4d -> slot candidat=%d%s", base, slot, mark)
					}
					t.Logf("  Word16=0x%x HasOpt16=%v Opt16=0x%x FlagA=%v FlagB=%v Mtx=%v HasVel=%v Vel=0x%x Byte8=0x%x FlagC=%v",
						s.st.Word16, s.st.HasOpt16, s.st.Opt16, s.st.FlagA, s.st.FlagB, s.st.Mtx, s.st.HasVel, s.st.Vel, s.st.Byte8, s.st.FlagC)
					t.Logf("  Mtx/Vel sont BRUTS, NON INTERPRETES par ce depot (aucune largeur de dequantification etablie) :" +
						" aucun offset n'est calcule ici, seulement rapporte.")
				} else {
					t.Logf("  branche LIBRE : FreeRead=%v HasFreeID=%v FreeID=%d HasAlt11=%v Alt11=%d",
						s.st.FreeRead, s.st.HasFreeID, s.st.FreeID, s.st.HasAlt11, s.st.Alt11)
				}
				s.haveReading = false
			}
		}
	}
}
