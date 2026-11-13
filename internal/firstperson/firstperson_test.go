package firstperson

// firstperson_test.go — the index contract against the fixture the web viewer's own test
// expects (web/src/features/match-replay/scene3d/premierePersonne3d.test.ts), the library
// file-name rules the route enforces, and the resumability of the file writes (an
// interrupted build must not clobber the files it already wrote).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// indexFixture mirrors the index of the viewer's test: one weapon, one rig whose idle clip
// the viewer looks up through the rig's actions. Marshaled, it must carry exactly the JSON
// fields the viewer's IndexPremierePersonne reads.
type indexFixture struct {
	Schema    int      `json:"schema"`
	Generator string   `json:"generator"`
	Weapons   []Arme   `json:"weapons"`
	Rigs      []Rig    `json:"rigs"`
	Failures  []Echec  `json:"failures"`
	Textures  Textures `json:"textures"`
}

// TestIndexShapeMatchesViewer — the JSON a built library writes is the shape the viewer
// reads: the top-level keys, the weapon entry the viewer matches on (weapon, file), the rig
// entry (file, bones, triangles, bytes, clips, actions, missingActions), and the clip fields
// the viewer drives its mixer with (name, action, variant, type, overlay, frameCount,
// frameRate, durationSeconds).
func TestIndexShapeMatchesViewer(t *testing.T) {
	idx := Index{
		Schema:    SchemaFirstPerson,
		Generator: generatorLibrary,
		Weapons:   []Arme{{Weapon: "abcdef12", File: "rig-0123456789abcdef.glb"}},
		Rigs: []Rig{{
			File:        "rig-0123456789abcdef.glb",
			Bones:       80,
			Triangles:   1234,
			Bytes:       5678,
			IdleWeapon:  &Pose{Position: [3]float32{1, 2, 3}, Forward: [3]float32{0, 0, 1}},
			Clips:       []Clip{{Name: "attente", Action: "idle", Variant: 0, Type: "base", Overlay: false, FrameCount: 30, FrameRate: 30, DurationSeconds: 1}},
			Actions:     []Action{{Action: "idle", Variant: 0, Clip: "attente"}},
			MissingActs: []string{},
		}},
		Failures: []Echec{},
		Textures: Textures{},
	}
	raw, err := json.Marshal(idx)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"schema", "generator", "weapons", "rigs", "failures", "textures"} {
		if _, ok := got[k]; !ok {
			t.Fatalf("index JSON missing key %q: %s", k, raw)
		}
	}
	var weapon []Arme
	if err := json.Unmarshal(got["weapons"], &weapon); err != nil {
		t.Fatal(err)
	}
	if len(weapon) != 1 || weapon[0].Weapon != "abcdef12" || weapon[0].File != "rig-0123456789abcdef.glb" {
		t.Fatalf("weapon entry = %+v", weapon)
	}
	var rigs []Rig
	if err := json.Unmarshal(got["rigs"], &rigs); err != nil {
		t.Fatal(err)
	}
	if len(rigs) != 1 {
		t.Fatalf("rig entries = %+v", rigs)
	}
	rig := rigs[0]
	if rig.File != "rig-0123456789abcdef.glb" || rig.Bones != 80 || rig.Triangles != 1234 || rig.Bytes != 5678 {
		t.Fatalf("rig entry = %+v", rig)
	}
	if len(rig.Clips) != 1 || rig.Clips[0].Name != "attente" || rig.Clips[0].FrameCount != 30 || rig.Clips[0].FrameRate != 30 || rig.Clips[0].DurationSeconds != 1 {
		t.Fatalf("clip entry = %+v", rig.Clips)
	}
	if len(rig.Actions) != 1 || rig.Actions[0].Action != "idle" || rig.Actions[0].Clip != "attente" {
		t.Fatalf("action entry = %+v", rig.Actions)
	}
	if rig.IdleWeapon == nil || rig.IdleWeapon.Position[0] != 1 || rig.IdleWeapon.Forward[2] != 1 {
		t.Fatalf("idleWeapon = %+v", rig.IdleWeapon)
	}
	// A rig without an idle clip omits idleWeapon entirely (the viewer tolerates both).
	var noIdle Rig
	raw2, _ := json.Marshal(Index{Schema: 1, Rigs: []Rig{{File: "rig-x", Clips: []Clip{}, Actions: []Action{}, MissingActs: []string{}}}})
	_ = json.Unmarshal(raw2, &noIdle)
	if strings.Contains(string(raw2), "idleWeapon") {
		t.Fatalf("idleWeapon must be omitted when absent: %s", raw2)
	}
}

// TestFichierRig — a rig's file name is the content digest of its written bytes: the same
// rig content gives the same name (two weapons share a file), different content a different
// one.
func TestFichierRig(t *testing.T) {
	a := FichierRig([]byte("rig content A"))
	b := FichierRig([]byte("rig content A"))
	c := FichierRig([]byte("rig content B"))
	if a != b || a == c {
		t.Fatalf("FichierRig: A=%q A2=%q B=%q", a, b, c)
	}
	if !strings.HasPrefix(a, "rig-") || !strings.HasSuffix(a, ".glb") || len(a) != len("rig-")+16+4 {
		t.Fatalf("rig file name shape = %q", a)
	}
	if !NomFichierPremierePersonne(a) {
		t.Fatalf("FichierRig output %q is not a library file name", a)
	}
}

// TestNomFichierPremierePersonne — the library's file names, and the look-alikes the route
// must refuse.
func TestNomFichierPremierePersonne(t *testing.T) {
	ok := []string{
		"index.json",
		"bras.json",
		"rig-0123456789abcdef.glb",
		"texture-" + strings.Repeat("0", 64) + ".png",
		"texture-" + strings.Repeat("a", 64) + ".jpg",
	}
	for _, nom := range ok {
		if !NomFichierPremierePersonne(nom) {
			t.Errorf("%q should be a library file name", nom)
		}
	}
	bad := []string{
		"index",
		"index.jsonx",
		"rig-0123456789abcde.glb",                     // 15 hex
		"rig-0123456789abcdefg.glb",                   // 17 hex
		"rig-0123456789abcdef",                        // no extension
		"rig_0123456789abcdef.glb",                    // wrong separator
		"texture-" + strings.Repeat("0", 63) + ".png", // 63 hex
		"texture-" + strings.Repeat("0", 64) + ".gif", // wrong extension
		"weap-2b1824d5.glb",
		"../index.json",
		"",
	}
	for _, nom := range bad {
		if NomFichierPremierePersonne(nom) {
			t.Errorf("%q should not be a library file name", nom)
		}
	}
}

// TestWriteFileIfAbsentResume — a file from a previous build is kept untouched (a resumed
// build does not re-write or clobber it), a missing file is written, and a torn .tmp file
// left by an interrupted write never leaks into the served name.
func TestWriteFileIfAbsentResume(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "rig-0123456789abcdef.glb")
	if _, err := writeFile(existing, func(w ioWriter) error {
		_, err := w.Write([]byte("bytes from the previous run"))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	ecrit, err := writeFileIfAbsent(existing, []byte("new bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if ecrit {
		t.Fatal("an existing file must not be rewritten")
	}
	raw, err := readAll(existing)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "bytes from the previous run" {
		t.Fatalf("existing file changed: %q", raw)
	}
	manquant := filepath.Join(dir, "rig-fedcba9876543210.glb")
	ecrit2, err := writeFileIfAbsent(manquant, []byte("fresh"))
	if err != nil || !ecrit2 {
		t.Fatalf("missing file: ecrit=%v err=%v, want written", ecrit2, err)
	}
	raw2, err := readAll(manquant)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw2) != "fresh" {
		t.Fatalf("written file = %q", raw2)
	}
	if _, err := readAll(manquant + ".tmp"); err == nil {
		t.Fatal("a .tmp file must not remain after a successful write")
	}
}

// TestDepotDedup — two references of the same image store one file, named by the content
// digest; a different image gets its own file.
func TestDepotDedup(t *testing.T) {
	dir := t.TempDir()
	d := &depot{dir: dir, vues: map[string]bool{}}
	nom1, err := d.depose([]byte("same image"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	nom2, err := d.depose([]byte("same image"), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if nom1 != nom2 {
		t.Fatalf("same content must give the same name: %q vs %q", nom1, nom2)
	}
	if d.fichiers != 1 || d.references != 2 {
		t.Fatalf("depot = %d files / %d references, want 1/2", d.fichiers, d.references)
	}
	nom3, err := d.depose([]byte("other image"), "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if nom3 == nom1 {
		t.Fatal("different content must give a different name")
	}
	if d.fichiers != 2 || d.references != 3 {
		t.Fatalf("depot = %d files / %d references, want 2/3", d.fichiers, d.references)
	}
	if !NomFichierPremierePersonne(nom1) || !NomFichierPremierePersonne(nom3) {
		t.Fatalf("depot names are not library file names: %q %q", nom1, nom3)
	}
	if _, err = d.depose([]byte("x"), "image/webp"); err == nil {
		t.Fatal("an unsupported mime type must be refused")
	}
}

// readAll reads a whole file (test helper).
func readAll(path string) ([]byte, error) { return os.ReadFile(path) }
