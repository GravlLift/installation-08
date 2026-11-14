package himap

import (
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"testing"
)

func TestObjetsVisibles(t *testing.T) {
	rep := int32(42)
	objets := []mapvar.Object{{TypeID: 1, RepresentationID: &rep}, {TypeID: 1}, {TypeID: 2, RepresentationID: &rep}}
	invisibles := map[CleObjetVariante]bool{{TypeID: 1, RepresentationID: 42}: true}
	var b BilanVariante
	visibles := objetsVisibles(objets, invisibles, &b)
	if b.Invisibles != 1 || len(visibles) != 2 || visibles[0].RepresentationID != nil {
		t.Fatalf("bilan=%+v visibles=%+v", b, visibles)
	}
	var m MaillageMonde
	var pose BilanVariante
	m.poseVarianteTeinte(OptionsVariante{Objets: objets, Invisibles: invisibles}, nil, nil, &pose)
	if pose.SansModele != 2 {
		t.Fatalf("placement filtré: %+v", pose)
	}
}
