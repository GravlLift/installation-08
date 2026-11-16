//go:build research

package grammar

// stick_packet_research_test.go — sanity check: does DecodeFrameRecords read packet (chunk=14,
// pk.Index=1906, match d01ba030) cleanly at all, and does it see slot 1133 (the sticking
// projectile)? Disambiguates whether the single `idx=[1 3 10 18]` record the raw bit-scan found
// (TestStickInvestigation) is a real record the production decoder also reaches (just without
// surfacing it through the i10 hook for some other reason) or sits in a packet the clean decoder
// desyncs on before reaching it.

import (
	"os"
	"testing"
)

func TestStickPacketClean(t *testing.T) {
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
	cfg := DefaultFrameConfig()
	data, err := ReadFilmChunk(dir, 14)
	if err != nil {
		t.Fatalf("chunk 14 illisible : %v", err)
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
		if pk.Index != 1906 || pk.Type != PacketTypeDelta {
			continue
		}
		pay := pk.Payload(data)
		t.Logf("paquet 1906 : type=%d taille=%d octets t=%dus premier octet=0x%02x", pk.Type, pk.Size, pk.TimestampUS, pay[0])
		if pay[0]&0x40 != 0 {
			t.Logf("  pay[0]&0x40 != 0 : ce paquet n'est PAS un paquet delta plein-record (forme %%40), DecodeFrameRecords ne le lit pas sous cette forme.")
			continue
		}
		br := lecteurDInstrument(pay)
		recs, err := DecodeFrameRecords(br, w, cfg)
		t.Logf("  DecodeFrameRecords : %d records, err=%v", len(recs), err)
		found1133 := false
		for _, r := range recs {
			if r.Slot == 1133 {
				found1133 = true
				t.Logf("  record slot=1133 : TypeIndex=%d DesyncAt=%d composants=%d EndBit=%d", r.TypeIndex, r.DesyncAt, len(r.Trace.Comps), r.Trace.EndBit)
				for _, c := range r.Trace.Comps {
					t.Logf("    comp idx=%d name=%q ported=%v startBit=%d", c.Index, c.Name, c.Ported, c.StartBit)
				}
			}
			if r.DesyncAt != -1 {
				t.Logf("  record slot=%d TypeIndex=%d DESYNC a bit %d", r.Slot, r.TypeIndex, r.DesyncAt)
			}
		}
		if !found1133 {
			t.Logf("  slot 1133 ABSENT des records decodes proprement sur ce paquet.")
		}
	}
}
