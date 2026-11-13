// spartanpieces_test.go — the library's own shapes, file names and Ekur
// reference handling, driven by small fixtures in a temp directory (no game
// install, no network).

package spartanpieces

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestLibraryFileWhitelist — the route's whitelist admits only the library's
// own file names.
func TestLibraryFileWhitelist(t *testing.T) {
	good := []string{
		"index.json",
		"coatings.json",
		"piece-0b7e328b-13d24f1f.glb",
		"attachment-1a2b3c4d.glb",
		"attachment-1a2b3c4d-2.glb",
		"texture-0123456789abcdef.png",
		"texture-0123456789abcdef.jpg",
		"coating-f56ee213.json",
		"swatch-0b000001.png",
	}
	for _, name := range good {
		if !LibraryFile(name) {
			t.Errorf("LibraryFile(%q) = false, want true", name)
		}
	}
	bad := []string{
		"",
		"index.json.tmp",
		"piece-0b7e328b.glb",           // one key part
		"piece-0b7e328b-13d24f1f.json", // wrong extension
		"piece-0b7e328g-13d24f1f.glb",  // not hex
		"attachment-1a2b3c4d-glb",
		"texture-0123456789abcde.png",  // 15 hex digits
		"texture-0123456789abcdef.gif", // not png/jpg
		"coating-f56ee21.png",
		"swatch-f56ee213.jpg", // swatches are png
		"secret.txt",
		"../secret.txt",
		"sub/index.json",
		"index.JSON",
	}
	for _, name := range bad {
		if LibraryFile(name) {
			t.Errorf("LibraryFile(%q) = true, want false", name)
		}
	}
}

// TestFileTypes — the served content type of each file kind.
func TestFileTypes(t *testing.T) {
	cases := map[string]string{
		"piece-0b7e328b-13d24f1f.glb":  "model/gltf-binary",
		"attachment-1a2b3c4d.glb":      "model/gltf-binary",
		"index.json":                   "application/json",
		"coatings.json":                "application/json",
		"coating-f56ee213.json":        "application/json",
		"texture-0123456789abcdef.png": "image/png",
		"swatch-0b000001.png":          "image/png",
		"texture-0123456789abcdef.jpg": "image/jpeg",
	}
	for name, want := range cases {
		if got := FileType(name); got != want {
			t.Errorf("FileType(%q) = %q, want %q", name, got, want)
		}
	}
}

// TestIdentifierAndKeys — the hex identifiers and the key/file composition.
func TestIdentifierAndKeys(t *testing.T) {
	if got := Identifier(0x0b7e328b); got != "0b7e328b" {
		t.Errorf("Identifier(0x0b7e328b) = %q", got)
	}
	if got := Identifier(4294967295); got != "ffffffff" {
		t.Errorf("Identifier(max) = %q", got)
	}
	if got := PieceKey("0b7e328b", "13d24f1f"); got != "0b7e328b-13d24f1f" {
		t.Errorf("PieceKey = %q", got)
	}
	if got := FilePiece("0b7e328b-13d24f1f"); got != "piece-0b7e328b-13d24f1f.glb" {
		t.Errorf("FilePiece = %q", got)
	}
	if got := AttachmentKey("1a2b3c4d", 0); got != "1a2b3c4d" {
		t.Errorf("AttachmentKey entry 0 = %q", got)
	}
	if got := AttachmentKey("1a2b3c4d", 2); got != "1a2b3c4d-2" {
		t.Errorf("AttachmentKey entry 2 = %q", got)
	}
	if got := FileAttachment("1a2b3c4d-2"); got != "attachment-1a2b3c4d-2.glb" {
		t.Errorf("FileAttachment = %q", got)
	}
	if got := FileCoating("f56ee213"); got != "coating-f56ee213.json" {
		t.Errorf("FileCoating = %q", got)
	}
	if got := FileSwatch("f56ee213"); got != "swatch-f56ee213.png" {
		t.Errorf("FileSwatch = %q", got)
	}
}

// ekurFixture lays down the five contract entries of an Ekur reference in
// folder.
func ekurFixture(t *testing.T, folder string) {
	t.Helper()
	mustWrite := func(rel, body string) {
		t.Helper()
		p := filepath.Join(folder, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("materials/123.json", `{"textures":{"Asg":7},"style_info":{"texel_density":[4,4],"material_offset":[0,0],"stylelist":456,"region_name":789,"base_intention":1,"mask0_red_intention":2,"mask0_green_intention":3,"mask0_blue_intention":4,"mask1_red_intention":5,"mask1_green_intention":6,"mask1_blue_intention":7,"supported_layers":7}}`)
	mustWrite("stylelists/456.json", `{"default_style":{"reference":"-177284589","name":"default"},"styles":{"-177284589":{"reference":"-177284589","name":"s"}}}`)
	mustWrite("styles/-177284589.json", `{"grime_amount":0.5,"scratch_amount":0.25,"grime_swatch":{"index":0,"gradient_transform":[1,1],"roughness":4,"roughness_white":1,"roughness_black":3,"metallic":0.1,"emissive_amount":0,"top_color":[1,1,1],"mid_color":[0.5,0.5,0.5],"bot_color":[0,0,0],"scratch_roughness":1,"scratch_metallic":0,"scratch_color":[1,1,1]},"regions":{"789":{"layers":{"1":{"index":0,"gradient_transform":[2,2],"gradient_bitmap":99,"roughness":4,"top_color":[1,0,0],"mid_color":[0,1,0],"bot_color":[0,0,1]}}}}}`)
	mustWrite("globals.json", `{"entries":{"2":{"fallback":0,"layer":{"index":1,"roughness":4}}}}`)
	mustWrite("visor_data.json", `{"patterns":{"-5":{"color_and_roughness_transform":[1,1],"color_gradient_map":7,"roughness_white":1,"metallic":0.2,"scratch_color":[0.9,0.9,0.9]}},"colors":{"-9":{"top_color":[1,0,0],"mid_color":[0,1,0],"bot_color":[0,0,1]}}}`)
}

// TestEkurValid — the contract: the five entries, directories and files of
// the expected kind.
func TestEkurValid(t *testing.T) {
	folder := t.TempDir()
	if EkurValid(folder) {
		t.Fatal("empty folder is valid")
	}
	ekurFixture(t, folder)
	if !EkurValid(folder) {
		t.Fatal("fixture is not valid")
	}
	// A directory where a file is expected breaks the contract.
	if err := os.MkdirAll(filepath.Join(folder, "materials", "globals.json"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(filepath.Join(folder, "globals.json"))
	if EkurValid(folder) {
		t.Fatal("folder with globals.json as a directory is valid")
	}
	// A missing entry breaks the contract.
	ekurFixture(t, folder)
	if err := os.Remove(filepath.Join(folder, "visor_data.json")); err != nil {
		t.Fatal(err)
	}
	if EkurValid(folder) {
		t.Fatal("folder without visor_data.json is valid")
	}
}

// TestEkurDir — the environment variable wins over the data dir fallback, and
// an invalid candidate yields empty.
func TestEkurDir(t *testing.T) {
	data := t.TempDir()
	ekurFixture(t, filepath.Join(data, "ekur"))
	if got := EkurDir(data); got != filepath.Join(data, "ekur") {
		t.Fatalf("EkurDir fallback = %q", got)
	}
	envDir := t.TempDir()
	ekurFixture(t, envDir)
	t.Setenv(EkurEnv, envDir)
	if got := EkurDir(data); got != envDir {
		t.Fatalf("EkurDir with env = %q, want %q", got, envDir)
	}
	absent := filepath.Join(t.TempDir(), "absent")
	t.Setenv(EkurEnv, absent)
	if got := EkurDir(data); got != "" {
		t.Fatalf("EkurDir with invalid env = %q, want empty", got)
	}
}

// TestEkurStamp — the export digest: empty for an empty argument, stable for the same
// folder, changed by a material file added, by globals.json changing, and by a style file
// removed; unchanged by a content-only edit of a file in one of the three directories.
func TestEkurStamp(t *testing.T) {
	if got, err := EkurStamp(""); err != nil || got != "" {
		t.Fatalf("EkurStamp(\"\") = %q, %v; want empty, nil", got, err)
	}
	folder := t.TempDir()
	ekurFixture(t, folder)
	base, err := EkurStamp(folder)
	if err != nil || len(base) != 16 {
		t.Fatalf("EkurStamp = %q, %v; want a 16-hex digest", base, err)
	}
	if got, _ := EkurStamp(folder); got != base {
		t.Fatalf("second read = %q, want %q (stable)", got, base)
	}
	// A content-only change inside materials/ is not part of the digest.
	if err := os.WriteFile(filepath.Join(folder, "materials", "123.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, _ := EkurStamp(folder); got != base {
		t.Fatalf("content-only change changed the stamp: %q", got)
	}
	// A material file added changes it.
	if err := os.WriteFile(filepath.Join(folder, "materials", "999.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	added, err := EkurStamp(folder)
	if err != nil || added == base {
		t.Fatalf("added material: stamp = %q, %v; want different from %q", added, err, base)
	}
	// globals.json changing (size or mod time) changes it.
	if err := os.WriteFile(filepath.Join(folder, "globals.json"), []byte(`{"entries":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	globals, err := EkurStamp(folder)
	if err != nil || globals == added {
		t.Fatalf("changed globals.json: stamp = %q, %v; want different from %q", globals, err, added)
	}
	// A style file removed changes it.
	if err := os.Remove(filepath.Join(folder, "styles", "-177284589.json")); err != nil {
		t.Fatal(err)
	}
	removed, err := EkurStamp(folder)
	if err != nil || removed == globals {
		t.Fatalf("removed style: stamp = %q, %v; want different from %q", removed, err, globals)
	}
	// A file where a directory is expected (the styles entry is a file, not a folder)
	// yields an error, not a stamp.
	if err := removeDirTree(t, filepath.Join(folder, "styles")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "styles"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := EkurStamp(folder); err == nil {
		t.Fatal("file where a directory is expected: accepted")
	}
	if err := os.Remove(filepath.Join(folder, "globals.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := EkurStamp(folder); err == nil {
		t.Fatal("folder without globals.json accepted")
	}
}

// removeDirTree deletes dir and everything under it (test-only; the fixtures are small
// and never contain a symlink, so a plain recursive delete is safe here).
func removeDirTree(t *testing.T, dir string) error {
	t.Helper()
	// Files first, then directories deepest first (the fixtures never hold a symlink).
	if err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return os.Remove(p)
		}
		return nil
	}); err != nil {
		return err
	}
	var dirs []string
	if err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			dirs = append(dirs, p)
		}
		return nil
	}); err != nil {
		return err
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := os.Remove(dirs[i]); err != nil {
			return err
		}
	}
	return nil
}

// TestEkurShapesRoundTrip — the Ekur shapes read from the fixture distill to
// the index shapes the viewer reads.
func TestEkurShapesRoundTrip(t *testing.T) {
	folder := t.TempDir()
	ekurFixture(t, folder)
	ref := ekurRef{folder: folder}
	gradients := map[uint32]bool{}

	m, err := ref.material(123)
	if err != nil {
		t.Fatalf("material: %v", err)
	}
	si := styleOf(*m.StyleInfo)
	if si.List != Identifier(uint32(456)) || si.Region != Identifier(uint32(789)) || si.LayerCount != 7 {
		t.Fatalf("styleOf = %+v", si)
	}
	if si.Intentions[0] != Identifier(1) || si.Intentions[6] != Identifier(7) {
		t.Fatalf("intentions = %v", si.Intentions)
	}

	l, err := ref.list(Identifier(uint32(456)))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if l.DefaultStyle.Reference != "-177284589" {
		t.Fatalf("default style reference = %q", l.DefaultStyle.Reference)
	}

	key, old, err := referenceStyle("-177284589")
	if err != nil || old || key != "f56eda13" {
		t.Fatalf("referenceStyle = %q, old=%v, err=%v", key, old, err)
	}
	key, old, err = referenceStyle("-177284589_-100")
	if err != nil || !old || key != "f56eda13_ffffff9c" {
		t.Fatalf("old-system referenceStyle = %q, old=%v, err=%v", key, old, err)
	}
	if _, _, err = referenceStyle("a_b_c"); err == nil {
		t.Fatal("three-part reference accepted")
	}

	s, err := ref.style("-177284589")
	if err != nil {
		t.Fatalf("style: %v", err)
	}
	cs, err := coatingStyleOf(s, false, gradients)
	if err != nil {
		t.Fatalf("coatingStyleOf: %v", err)
	}
	if cs.Grime != 0.5 || cs.Scratches != 0.25 || cs.GrimeSwatch == nil {
		t.Fatalf("style = %+v", cs)
	}
	layer, ok := cs.Regions[Identifier(789)][Identifier(1)]
	if !ok {
		t.Fatalf("regions = %v", cs.Regions)
	}
	if layer.Gradient != Identifier(99) || !gradients[99] {
		t.Fatalf("layer gradient = %q, gradients = %v", layer.Gradient, gradients)
	}

	var ge ekurGlobals
	if err := ref.readJSON("globals.json", &ge); err != nil {
		t.Fatalf("globals: %v", err)
	}
	globals, err := globalsOf(ge, gradients)
	if err != nil {
		t.Fatalf("globalsOf: %v", err)
	}
	if _, ok := globals[Identifier(2)]; !ok {
		t.Fatalf("globals = %v", globals)
	}

	var ve ekurVisors
	if err := ref.readJSON("visor_data.json", &ve); err != nil {
		t.Fatalf("visors: %v", err)
	}
	visors, err := visorsOf(ve, gradients)
	if err != nil {
		t.Fatalf("visorsOf: %v", err)
	}
	negFive := int32(-5)
	p, ok := visors.Patterns[Identifier(uint32(negFive))]
	if !ok {
		t.Fatalf("visor patterns = %v", visors.Patterns)
	}
	if p.Gradient != Identifier(7) {
		t.Fatalf("visor gradient = %q", p.Gradient)
	}
}

// TestCoatingWorkFinishPerStyle — Finish writes one coating file per named
// style of the lists the materials name (the key the viewer asks for, the
// player's style key), its lists mapping each list to the style's reference
// and its styles carrying those references' data; no file keyed by a list key.
func TestCoatingWorkFinishPerStyle(t *testing.T) {
	refDir := t.TempDir()
	ekurFixture(t, refDir)
	// No gradient bitmaps anywhere: the test needs no arsenal to read them.
	if err := os.WriteFile(filepath.Join(refDir, "styles", "-177284589.json"),
		[]byte(`{"grime_amount":0,"scratch_amount":0,"grime_swatch":{"index":0,"disabled":true,"gradient_transform":[1,1],"roughness":4},`+
			`"regions":{"789":{"layers":{"1":{"index":0,"gradient_transform":[2,2],"roughness":4,"top_color":[1,0,0],"mid_color":[0,1,0],"bot_color":[0,0,1]}}}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(refDir, "visor_data.json"), []byte(`{"patterns":{},"colors":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	w, err := OpenCoatingWork(refDir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	// Material 123 names style list 456 (the fixture's).
	if !w.Annotate(ctx)(map[string]any{"id": json.Number("123"), himap.CleSurfaceBrute: map[string]any{}}) {
		t.Fatal("material 123 not annotated with a style")
	}
	out := t.TempDir()
	idx, err := w.Finish(ctx, nil, out)
	if err != nil {
		t.Fatalf("Finish: %v", err)
	}

	// The file is keyed by the style id (the coating StyleId), not the list key.
	raw, err := os.ReadFile(filepath.Join(out, FileCoating("f56eda13")))
	if err != nil {
		t.Fatalf("coating file of the style id absent: %v (the builder keys files by the list key)", err)
	}
	var c Coating
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	listKey := Identifier(uint32(456))
	if c.Style != "f56eda13" {
		t.Errorf("style = %q", c.Style)
	}
	if c.Lists[listKey] != "f56eda13" {
		t.Errorf("lists[%s] = %q, want the style reference f56eda13; got: %s", listKey, c.Lists[listKey], raw)
	}
	s, ok := c.Styles["f56eda13"]
	if !ok {
		t.Fatalf("styles missing f56eda13: %s", raw)
	}
	if layer, ok := s.Regions[Identifier(789)][Identifier(1)]; !ok || layer.Top != [3]float32{1, 0, 0} {
		t.Errorf("style region layer = %+v", s.Regions[Identifier(789)])
	}
	// No file keyed by the list key (that is the stub shape).
	if _, err := os.Stat(filepath.Join(out, FileCoating(listKey))); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("file %q keyed by the list key exists, want none", FileCoating(listKey))
	}
	// The common table still names each list's default style.
	raw, err = os.ReadFile(filepath.Join(out, FileCoatings))
	if err != nil {
		t.Fatal(err)
	}
	var tab CoatingTable
	if err := json.Unmarshal(raw, &tab); err != nil {
		t.Fatal(err)
	}
	if tab.Defaults[listKey] != "f56eda13" {
		t.Errorf("default_styles[%s] = %q", listKey, tab.Defaults[listKey])
	}
	if idx.Coatings != 1 || idx.Lists != 1 || idx.Styles != 1 {
		t.Errorf("index = %+v", idx)
	}
}

// TestIndexShape — the index marshals with the field names the viewer reads.
func TestIndexShape(t *testing.T) {
	idx := Index{Schema: SchemaPieces, Mode: Identifier(himap.ModeSpartan), Generator: "test",
		Pieces:      []PieceIndex{},
		Attachments: []AttachmentIndex{},
		Markers:     []MarkerIndex{},
		Themes:      []ThemeIndex{},
		Failures:    []FailureIndex{}}
	raw, err := json.Marshal(idx)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"schema", "mode", "generator", "skeleton", "pieces", "attachments", "markers", "themes", "textures", "failures"} {
		if _, ok := m[key]; !ok {
			t.Errorf("index JSON missing %q: %s", key, raw)
		}
	}
	if _, ok := m["coatings"]; ok {
		t.Errorf("index JSON carries coatings without a reference: %s", raw)
	}
}
