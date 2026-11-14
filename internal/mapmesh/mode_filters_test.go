package mapmesh

import (
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TestModeFilters: each ranked mode activates its own labels; Slayer and an unknown name none.
func TestModeFilters(t *testing.T) {
	h := mapvar.LabelHash
	cases := []struct {
		mode     string
		includes []int32
		excludes []int32
	}{
		{"Ranked:Slayer", nil, nil},
		{"", nil, nil},
		{"Ranked:CTF 5 Captures", []int32{h("ctf_include")}, []int32{h("ctf_exclude")}},
		{"Quick Play:Neutral Flag", []int32{h("ctf_include"), h("ctf_neutral_include")}, []int32{h("ctf_exclude"), h("ctf_neutral_exclude")}},
		{"Ranked:Strongholds", []int32{h("strongholds_include")}, []int32{h("strongholds_exclude")}},
		{"Ranked:Oddball", []int32{h("oddball_include")}, []int32{h("oddball_exclude")}},
		{"Ranked:King of the Hill", []int32{mapvar.LabelHashHillInclude}, nil},
	}
	for _, c := range cases {
		f := ModeFilters(c.mode)
		if len(f.Inclus) != len(c.includes) || len(f.Exclus) != len(c.excludes) {
			t.Errorf("%q: includes %v excludes %v", c.mode, f.Inclus, f.Exclus)
			continue
		}
		for _, l := range c.includes {
			if !f.Inclus[l] {
				t.Errorf("%q: include %d missing", c.mode, l)
			}
		}
		for _, l := range c.excludes {
			if !f.Exclus[l] {
				t.Errorf("%q: exclude %d missing", c.mode, l)
			}
		}
	}
}
