package reloadsounds

import (
	"reflect"
	"testing"
)

// testGraph builds a graph tag with two sound references (the first naming sound A1 and a bank,
// which is not a sound, the second naming sound A2) and one resource group of two members:
// member 0 posts nothing, member 1 posts A2 at frame 30 and A1 at frame 5. The group's resource
// root also owns a block that is not a whole number of members, which must be passed over.
func testGraph(t *testing.T) (tt *testTag, resource int) {
	t.Helper()
	tt = &testTag{deps: []testDep{{"snd!", 0xA1}, {"snd!", 0xA2}, {"sbnk", 0xC1}}}
	root := tt.block(make([]byte, graphOffGroups+groupStride))
	tt.link(0, root, -1, 0)
	refs := tt.block(make([]byte, 2*soundRefStride))
	tt.link(structTagBlock, refs, root, graphOffSounds)
	tt.link(structTagBlock, tt.block(soundEntries(0xA1, 0xC1)), refs, soundRefOffBlock)
	tt.link(structTagBlock, tt.block(soundEntries(0xA2)), refs, soundRefStride+soundRefOffBlock)
	groups := tt.block(make([]byte, groupStride))
	tt.link(structTagBlock, groups, root, graphOffGroups)
	resource = tt.block(make([]byte, 16))
	tt.link(structResource, resource, groups, groupOffResource)
	tt.link(structTagBlock, tt.block(make([]byte, 10)), resource, 8)
	members := tt.block(make([]byte, 2*memberStride))
	tt.link(structTagBlock, members, resource, 0)
	tt.link(structTagBlock, tt.block(soundEvents([2]int{1, 30}, [2]int{0, 5})), members, memberStride+memberOffSounds)
	return tt, resource
}

func TestAnimationSoundsReadsEventsInGraphOrder(t *testing.T) {
	tt, _ := testGraph(t)
	tag := tt.parse(t)
	got, err := animationSounds(tag, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	want := []postedSound{{Frame: 30, Sounds: []uint32{0xA2}}, {Frame: 5, Sounds: []uint32{0xA1}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("member 1 posts %+v, want %+v", got, want)
	}
	if got, err := animationSounds(tag, 0, 0); err != nil || len(got) != 0 {
		t.Fatalf("member 0 posts %+v (%v), want nothing", got, err)
	}
}

func TestAnimationSoundsRefusesWhatTheGraphDoesNotHold(t *testing.T) {
	tt, _ := testGraph(t)
	tag := tt.parse(t)
	if _, err := animationSounds(tag, 1, 0); err == nil {
		t.Fatal("a group the graph does not have was read")
	}
	if _, err := animationSounds(tag, 0, 2); err == nil {
		t.Fatal("a member outside its group was read")
	}
	tt.data[len(tt.data)-2*soundEventStride] = 7 // the first event's reference index, past the two references
	if _, err := animationSounds(tt.parse(t), 0, 1); err == nil {
		t.Fatal("an event naming a missing reference was read")
	}
}

func TestMembersBlockRefusesTwoCandidates(t *testing.T) {
	tt, resource := testGraph(t)
	tt.link(structTagBlock, tt.block(make([]byte, memberStride)), resource, 12)
	if _, err := membersBlock(tt.parse(t), 0, 0); err == nil {
		t.Fatal("a resource with two members blocks was accepted")
	}
}
