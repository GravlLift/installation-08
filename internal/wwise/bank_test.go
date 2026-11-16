package wwise

import (
	"encoding/binary"
	"reflect"
	"testing"
)

// hircObject encodes one HIRC object: type, size, id, body.
func hircObject(typ byte, id uint32, body []byte) []byte {
	b := []byte{typ}
	b = le32(b, uint32(4+len(body)), id)
	return append(b, body...)
}

// soundBody is a Sound's body: plugin id, stream type, source id, then filler.
func soundBody(source uint32) []byte {
	b := le32(nil, 0x00040001)
	b = append(b, 2)
	return append(le32(b, source), 0, 0, 0, 0)
}

// testBank builds a v135 bank: event 100 -> play action 200 -> random container 300 holding
// sounds 401 (media 9001) and 402 (media 9002); event 101 -> a non-sound action, a 0x02 stop
// (no media); and one embedded media 9003.
func testBank() []byte {
	play := binary.LittleEndian.AppendUint16(nil, 0x0403)
	play = le32(play, 300)
	stop := binary.LittleEndian.AppendUint16(nil, 0x0203)
	stop = le32(stop, 300)
	container := append([]byte{0, 1, 2, 3}, le32(nil, 2, 401, 402)...)
	objects := [][]byte{
		hircObject(HircSound, 401, soundBody(9001)),
		hircObject(HircSound, 402, soundBody(9002)),
		hircObject(HircRandomSeq, 300, container),
		hircObject(HircAction, 200, play),
		hircObject(HircAction, 201, stop),
		hircObject(HircEvent, 100, append([]byte{1}, le32(nil, 200)...)),
		hircObject(HircEvent, 101, append([]byte{1}, le32(nil, 201)...)),
	}
	hirc := le32(nil, uint32(len(objects)))
	for _, o := range objects {
		hirc = append(hirc, o...)
	}
	chunk := func(magic string, body []byte) []byte {
		return append(le32([]byte(magic), uint32(len(body))), body...)
	}
	b := chunk("BKHD", le32(nil, 135, ID("sb_test_bank")))
	b = append(b, chunk("DIDX", le32(nil, 9003, 0, 3))...)
	b = append(b, chunk("DATA", []byte("xyz"))...)
	return append(b, chunk("HIRC", hirc)...)
}

func TestParseBankFollowsEventsToMedia(t *testing.T) {
	wrapped := append([]byte("tag header bytes"), testBank()...)
	at := IndexBKHD(wrapped)
	if at != 16 {
		t.Fatalf("BKHD at %d", at)
	}
	bk, err := ParseBank(wrapped[at:])
	if err != nil {
		t.Fatal(err)
	}
	if bk.Version != 135 || bk.ID != ID("sb_test_bank") || len(bk.Objects) != 7 {
		t.Fatalf("bank: version %d id %08x objects %d", bk.Version, bk.ID, len(bk.Objects))
	}
	if got := bk.EventMedia(100); !reflect.DeepEqual(got, []uint32{9001, 9002}) {
		t.Fatalf("event 100 plays %v", got)
	}
	if got := bk.EventMedia(101); len(got) != 0 {
		t.Fatalf("a stop action plays %v", got)
	}
	if got := bk.EventMedia(401); got != nil {
		t.Fatalf("a sound read as an event: %v", got)
	}
	if got := bk.EventTargetTypes(100); !reflect.DeepEqual(got, []byte{HircRandomSeq}) {
		t.Fatalf("event 100 targets %v", got)
	}
	if got := bk.EventTargetTypes(401); got != nil {
		t.Fatalf("a sound read as an event: %v", got)
	}
	if string(bk.Embedded[9003]) != "xyz" {
		t.Fatalf("embedded media: %q", bk.Embedded[9003])
	}
}

// buildBank assembles a v135 bank from its HIRC objects (no embedded media).
func buildBank(id uint32, objects [][]byte) []byte {
	hirc := le32(nil, uint32(len(objects)))
	for _, o := range objects {
		hirc = append(hirc, o...)
	}
	chunk := func(magic string, body []byte) []byte {
		return append(le32([]byte(magic), uint32(len(body))), body...)
	}
	b := chunk("BKHD", le32(nil, 135, id))
	return append(b, chunk("HIRC", hirc)...)
}

// TestEventFollowsSoundActionContainerAcrossBanks is the slide_outof shape: an event whose
// sound action targets a random sequence container that lives in a sibling bank, one bank per
// take. The container is resolved only after the sibling's objects are linked into the event's
// bank; both the 0x01 variant and the 0x04 Play action reach the same media.
func TestEventFollowsSoundActionContainerAcrossBanks(t *testing.T) {
	container := append([]byte{0, 1, 2, 3}, le32(nil, 2, 401, 402)...)
	sibling := buildBank(ID("sb_sibling"), [][]byte{
		hircObject(HircSound, 401, soundBody(9001)),
		hircObject(HircSound, 402, soundBody(9002)),
		hircObject(HircRandomSeq, 300, container),
	})
	eventBank := buildBank(ID("sb_event"), [][]byte{
		hircObject(HircAction, 200, le32(binary.LittleEndian.AppendUint16(nil, 0x0103), 300)),
		hircObject(HircEvent, 100, append([]byte{1}, le32(nil, 200)...)),
	})
	b, err := ParseBank(sibling)
	if err != nil {
		t.Fatal(err)
	}
	a, err := ParseBank(eventBank)
	if err != nil {
		t.Fatal(err)
	}
	if got := a.EventMedia(100); len(got) != 0 {
		t.Fatalf("before the link, the container is unresolvable: %v", got)
	}
	a.LinkObjects(b.Objects)
	if got := a.EventMedia(100); !reflect.DeepEqual(got, []uint32{9001, 9002}) {
		t.Fatalf("0x01 action after the link: %v", got)
	}
	if got := a.EventTargetTypes(100); !reflect.DeepEqual(got, []byte{HircRandomSeq}) {
		t.Fatalf("target types: %v", got)
	}
	// The 0x04 Play action, targeting the same sibling container, reaches the same media.
	playBank := buildBank(ID("sb_event2"), [][]byte{
		hircObject(HircAction, 201, le32(binary.LittleEndian.AppendUint16(nil, 0x0403), 300)),
		hircObject(HircEvent, 101, append([]byte{1}, le32(nil, 201)...)),
	})
	a2, err := ParseBank(playBank)
	if err != nil {
		t.Fatal(err)
	}
	a2.LinkObjects(b.Objects)
	if got := a2.EventMedia(101); !reflect.DeepEqual(got, []uint32{9001, 9002}) {
		t.Fatalf("0x04 Play action after the link: %v", got)
	}
}

func TestIDIsLowercaseFNV1(t *testing.T) {
	// FNV-1 32-bit of "" is the offset basis; Wwise ids ignore case.
	if ID("") != 2166136261 {
		t.Fatalf("ID(\"\") = %d", ID(""))
	}
	if ID("Play_Thing") != ID("play_thing") {
		t.Fatal("ID is case-sensitive")
	}
	// FNV-1 (multiply then xor) of "a": (2166136261 * 16777619) ^ 'a'.
	basis, prime := uint32(2166136261), uint32(16777619)
	if want := basis*prime ^ 'a'; ID("a") != want {
		t.Fatalf("ID(\"a\") = %08x, want %08x", ID("a"), want)
	}
}

func TestParseMediaFormatNamesTheCodec(t *testing.T) {
	fmtChunk := binary.LittleEndian.AppendUint16(nil, 0xFFFF)
	fmtChunk = binary.LittleEndian.AppendUint16(fmtChunk, 2)
	fmtChunk = le32(fmtChunk, 48000, 0)
	riff := append(le32([]byte("RIFF"), 0), []byte("WAVE")...)
	riff = append(riff, le32([]byte("JUNK"), 2)...)
	riff = append(riff, 0, 0)
	riff = append(riff, le32([]byte("fmt "), uint32(len(fmtChunk)))...)
	riff = append(riff, fmtChunk...)
	got, err := ParseMediaFormat(riff)
	if err != nil {
		t.Fatal(err)
	}
	if got.Codec != CodecVorbis || got.Channels != 2 || got.SampleRate != 48000 {
		t.Fatalf("format: %+v", got)
	}
	if _, err := ParseMediaFormat([]byte("OggS")); err == nil {
		t.Fatal("a non-RIFF media parsed")
	}
}
