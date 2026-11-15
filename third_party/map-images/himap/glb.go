// Package himap — glb.go : ecriture glTF 2.0 binaire (GLB) du maillage monde d'une carte.
//
// AXES : le monde Halo est Z vers le haut, glTF est Y vers le haut. Le fichier porte
// (x, z, -y) du monde Halo ; un consommateur qui veut les coordonnees du rejeu applique
// l'inverse (x, -z, y). Blender et three.js lisent donc la carte debout sans reglage.
//
// Un noeud par groupe non vide (`structure`, `decor`, `ombre`) ; dans chaque groupe, une primitive par
// materiau du jeu, toutes sur le meme tampon de sommets. Chaque materiau glTF porte en
// `extras` le GlobalID du tag `mat `, son shader et son mode de melange ; un materiau non
// opaque est publie `BLEND` pour qu'un lecteur generique le montre translucide, un materiau a
// decoupe `MASK` avec son masque (glb_masques.go), un materiau de niveau en couches ses couches
// en `extras` (glb_couches.go), un materiau de surface dure (arme) sa couleur neutre cuite, sa
// matiere et sa normale (glb_surface.go). Chaque groupe porte les trois jeux de coordonnees lus,
// `TEXCOORD_0` a `TEXCOORD_2`.
//
// SOLEIL : quand `MaillageMonde.Soleil` est pose, `scenes[0].extras.levelupSun.dir` porte sa
// direction en AXES HALO (non convertis : c'est une donnee, pas un sommet), vers le soleil.
// SONDES : quand `MaillageMonde.Sondes` est pose, `scenes[0].extras.levelupProbes` (glb_sondes.go) ;
// LUMIERES posees : `scenes[0].extras.levelupLights` (glb_lumieres.go) ; OBJETS d'une couche de
// variante : `scenes[0].extras.levelupObjects` (glb_objets.go).
package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"slices"
)

const (
	glbMagic       = 0x46546C67 // "glTF"
	glbVersion     = 2
	glbChunkJSON   = 0x4E4F534A // "JSON"
	glbChunkBIN    = 0x004E4942 // "BIN\0"
	glComponentF32 = 5126
	glComponentU32 = 5125
	glComponentU16 = 5123
	glComponentI16 = 5122
	glArrayBuffer  = 34962
	glIndexBuffer  = 34963
	glTriangles    = 4
)

type gltfDoc struct {
	Asset       gltfAsset        `json:"asset"`
	Scene       int              `json:"scene"`
	Scenes      []gltfScene      `json:"scenes"`
	Nodes       []gltfNode       `json:"nodes"`
	Meshes      []gltfMesh       `json:"meshes"`
	Skins       []gltfSkin       `json:"skins,omitempty"`
	Animations  []gltfAnimation  `json:"animations,omitempty"`
	Materials   []gltfMaterial   `json:"materials,omitempty"`
	Textures    []gltfTexture    `json:"textures,omitempty"`
	Images      []gltfImage      `json:"images,omitempty"`
	Samplers    []gltfSampler    `json:"samplers,omitempty"`
	ExtUsed     []string         `json:"extensionsUsed,omitempty"`
	Accessors   []gltfAccessor   `json:"accessors"`
	BufferViews []gltfBufferView `json:"bufferViews"`
	Buffers     []gltfBuffer     `json:"buffers"`
}

type gltfAsset struct {
	Version   string         `json:"version"`
	Generator string         `json:"generator"`
	Extras    map[string]any `json:"extras,omitempty"`
}

type gltfScene struct {
	Nodes  []int          `json:"nodes"`
	Extras map[string]any `json:"extras,omitempty"`
}

// CleSoleilGLB : la cle de `scenes[0].extras` qui porte le soleil de la carte.
const CleSoleilGLB = "levelupSun"

// extrasSoleil rend `{"dir": [x, y, z]}` (axes Halo, vers le soleil), plus "color" et
// "intensity" quand le jeu les declare ; nil sans soleil.
func extrasSoleil(s *Soleil) map[string]any {
	if s == nil {
		return nil
	}
	v := map[string]any{"dir": s.Direction}
	if s.AvecCouleur {
		v["color"] = s.Couleur
	}
	if s.AvecIntensite {
		v["intensity"] = s.Intensite
	}
	return map[string]any{CleSoleilGLB: v}
}

// gltfNode : un noeud de maillage (Mesh pose) ou un os d'une peau (glb_peau.go : TRS locale, enfants).
type gltfNode struct {
	Name        string      `json:"name"`
	Mesh        *int        `json:"mesh,omitempty"`
	Skin        *int        `json:"skin,omitempty"`
	Children    []int       `json:"children,omitempty"`
	Translation *[3]float32 `json:"translation,omitempty"`
	Rotation    *[4]float32 `json:"rotation,omitempty"`
	Scale       *[3]float32 `json:"scale,omitempty"`
	// Matrix (LOCAL-CHANGE (infinite-theater-3d)): the placement of a variant object's shared
	// model, column-major, in glTF axes (glb_poses.go).
	Matrix *[16]float32 `json:"matrix,omitempty"`
	// Extensions (LOCAL-CHANGE (infinite-theater-3d)): EXT_mesh_gpu_instancing for scattered
	// decorators (glb_decorateurs.go).
	Extensions map[string]any `json:"extensions,omitempty"`
}

type gltfMesh struct {
	Name       string          `json:"name"`
	Primitives []gltfPrimitive `json:"primitives"`
}

type gltfPrimitive struct {
	Attributes map[string]int `json:"attributes"`
	Indices    int            `json:"indices"`
	Material   int            `json:"material"`
	Mode       int            `json:"mode"`
}

type gltfMaterial struct {
	Name        string   `json:"name"`
	AlphaMode   string   `json:"alphaMode"`
	AlphaCutoff *float32 `json:"alphaCutoff,omitempty"`
	DoubleSided bool     `json:"doubleSided"`
	PBR         gltfPBR  `json:"pbrMetallicRoughness"`
	// Emission : cf. glb_emissif.go.
	EmissiveFactor *[3]float32 `json:"emissiveFactor,omitempty"`
	// EmissiveTexture (LOCAL-CHANGE (infinite-theater-3d)): the mask of the light, cf. glb_emissif.go.
	EmissiveTexture *gltfTextureInfo `json:"emissiveTexture,omitempty"`
	// NormalTexture : cf. glb_surface.go.
	NormalTexture *gltfTextureInfo `json:"normalTexture,omitempty"`
	Extensions    map[string]any   `json:"extensions,omitempty"`
	Extras        map[string]any   `json:"extras"`
	// DecoupeApplique : le masque de decoupe est porte par l'alpha de la couleur de base
	// (materiau en couches a decoupe), pas par un materiau MASK a part. Le lecteur applique
	// un alpha test sur sa couleur de base.
	DecoupeApplique bool `json:"-"`
}

type gltfPBR struct {
	BaseColorFactor          [4]float32       `json:"baseColorFactor"`
	BaseColorTexture         *gltfTextureInfo `json:"baseColorTexture,omitempty"`
	MetallicFactor           float32          `json:"metallicFactor"`
	RoughnessFactor          float32          `json:"roughnessFactor"`
	MetallicRoughnessTexture *gltfTextureInfo `json:"metallicRoughnessTexture,omitempty"`
}

type gltfAccessor struct {
	BufferView    int       `json:"bufferView"`
	ComponentType int       `json:"componentType"`
	Count         int       `json:"count"`
	Type          string    `json:"type"`
	Min           []float32 `json:"min,omitempty"`
	Max           []float32 `json:"max,omitempty"`
	// Normalized : un entier lu comme une fraction de son etendue (rotations d'animation en i16).
	Normalized bool `json:"normalized,omitempty"`
}

type gltfBufferView struct {
	Buffer     int `json:"buffer"`
	ByteOffset int `json:"byteOffset"`
	ByteLength int `json:"byteLength"`
	Target     int `json:"target,omitempty"`
}

type gltfBuffer struct {
	ByteLength int `json:"byteLength"`
}

// ecritGLB ecrit le maillage monde en GLB. `extras` est publie tel quel dans `asset.extras`
// (module source, noms affiches).
func EcritGLB(w io.Writer, m *MaillageMonde, generateur string, extras map[string]any) error {
	doc, bin, err := documentGLB(m, generateur, extras)
	if err != nil {
		return err
	}
	return termineGLB(w, doc, bin, racinesGLB(doc.Nodes))
}

// racinesGLB rend les noeuds qu'aucun autre ne porte en enfant : les racines de la scene.
func racinesGLB(noeuds []gltfNode) []int {
	enfant := make([]bool, len(noeuds))
	for _, n := range noeuds {
		for _, c := range n.Children {
			enfant[c] = true
		}
	}
	racines := make([]int, 0, len(noeuds))
	for i := range noeuds {
		if !enfant[i] {
			racines = append(racines, i)
		}
	}
	return racines
}

// documentGLB assemble le document d'un maillage : un noeud par groupe non vide, les materiaux et
// leurs images, les extras de la scene. La liste des noeuds racines reste a poser (termineGLB).
func documentGLB(m *MaillageMonde, generateur string, extras map[string]any) (*gltfDoc, *tamponGLB, error) {
	doc := &gltfDoc{
		Asset: gltfAsset{Version: "2.0", Generator: generateur, Extras: extras},
	}
	groupes := []struct {
		nom string
		g   *GroupeMaillage
	}{{"structure", &m.Structure}, {"structureTerrain", &m.Terrain}, {"decor", &m.Decor}, {"ombre", &m.Ombre}}
	bin := &tamponGLB{}
	mats := ecrivainMateriaux{doc: doc, bin: bin, m: m, rangs: map[uint32]int{}}
	for _, gr := range groupes {
		if gr.g.Triangles() == 0 {
			continue
		}
		ajouteGroupe(doc, bin, gr.nom, gr.g, mats.rang)
	}
	ajouteDecorateurs(doc, bin, m.Decorateurs, mats.rang)
	ajoutePosesVariante(doc, bin, m.Poses, mats.rang)
	if mats.err != nil {
		return nil, nil, fmt.Errorf("textures des materiaux : %w", mats.err)
	}
	if len(doc.Nodes) == 0 {
		return nil, nil, fmt.Errorf("maillage vide")
	}
	scene := extrasSoleil(m.Soleil)
	if scene == nil {
		scene = map[string]any{}
	}
	if sondes := ajouteSondes(doc, bin, m.Sondes); sondes != nil {
		scene[CleSondesGLB] = sondes
	}
	if lumieres := extrasLumieres(m.Lumieres); lumieres != nil {
		scene[CleLumieresGLB] = lumieres
	}
	if objets := extrasObjets(m.Objets); objets != nil {
		scene[CleObjetsGLB] = objets
	}
	if len(scene) == 0 {
		scene = nil
	}
	doc.Scenes = []gltfScene{{Extras: scene}}
	return doc, bin, nil
}

// termineGLB pose les noeuds racines de la scene et ecrit le conteneur.
func termineGLB(w io.Writer, doc *gltfDoc, bin *tamponGLB, racines []int) error {
	doc.Scenes[0].Nodes = racines
	doc.Buffers = []gltfBuffer{{ByteLength: bin.Len()}}
	js, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("json glTF : %w", err)
	}
	return ecritConteneurGLB(w, js, bin)
}

// ecrivainMateriaux traduit les materiaux du jeu en materiaux glTF, un par GlobalID, avec leurs
// images (couches, surface dure, decoupe). La premiere erreur d'image est gardee dans `err`.
type ecrivainMateriaux struct {
	doc      *gltfDoc
	bin      *tamponGLB
	m        *MaillageMonde
	rangs    map[uint32]int
	masques  masquesGLB
	couches  couchesGLB
	surfaces surfacesGLB
	brutes   surfacesBrutesGLB
	err      error
}

// rang rend l'index glTF du materiau `id`, en l'ecrivant la premiere fois.
func (e *ecrivainMateriaux) rang(id uint32) int {
	if r, ok := e.rangs[id]; ok {
		return r
	}
	source := id
	if t, ok := e.m.teintesForge[id]; ok {
		source = t.source
	}
	g := materiauGLTF(source, e.m.Materiaux)
	if mat, connu := e.m.Materiaux[source]; connu {
		e.appliqueImages(&g, mat, e.m.SurfacesBrutes || e.m.SurfacesBrutesDe[source])
	}
	if t, ok := e.m.teintesForge[id]; ok {
		g.PBR.BaseColorFactor = [4]float32{t.teinte.Couleur[0], t.teinte.Couleur[1], t.teinte.Couleur[2], 1}
		g.PBR.RoughnessFactor, g.PBR.MetallicFactor = t.teinte.Rugosite, t.teinte.Metal
		g.Extras["teinte"] = t.teinte.Couleur
	}
	e.rangs[id] = len(e.doc.Materials)
	e.doc.Materials = append(e.doc.Materials, g)
	return e.rangs[id]
}

func (e *ecrivainMateriaux) appliqueImages(g *gltfMaterial, mat Materiau, brute bool) {
	garde := func(err error) {
		if err != nil && e.err == nil {
			e.err = err
		}
	}
	if mat.Emissif != nil {
		appliqueEmissif(e.doc, g, *mat.Emissif)
		// LOCAL-CHANGE (infinite-theater-3d): the light's mask, on the color map's coordinates.
		jeu := jeuUVDiffus
		if mat.Couches != nil {
			jeu = mat.Couches.JeuUV
		}
		tex, err := e.couches.texture(e.doc, e.bin, cleImage{mat.Emissif.Bitmap, imageCouleur}, e.m.TexturesCouches)
		garde(err)
		if tex != pasDeTexture && g.EmissiveFactor != nil {
			g.EmissiveTexture = &gltfTextureInfo{Index: tex, TexCoord: jeu}
		}
	}
	aDecoupe := mat.Decoupe != nil
	var masque *Texture
	if aDecoupe {
		if t, ok := e.m.Masques[mat.Decoupe.Bitmap]; ok {
			masque = &t
		}
	}
	if mat.Couches != nil && mat.Opaque() {
		garde(e.couches.applique(e.doc, e.bin, g, mat.Couches, e.m.TexturesCouches, nouveauDecoupe(masque, mat.Decoupe)))
		if aDecoupe && masque != nil {
			g.AlphaMode = "MASK"
			seuil := mat.Decoupe.Seuil
			g.AlphaCutoff = &seuil
			g.Extras["decoupe"] = map[string]any{"bitmap": mat.Decoupe.Bitmap, "seuil": mat.Decoupe.Seuil}
			g.DecoupeApplique = true
		}
	}
	switch {
	case mat.Surface != nil && mat.Opaque() && brute:
		garde(e.brutes.applique(e.doc, e.bin, g, mat.Surface, e.m.TexturesCouches))
	case mat.Surface != nil && mat.Opaque():
		garde(e.surfaces.applique(e.doc, e.bin, g, mat.Surface, e.m.TexturesCouches))
	}
	if aDecoupe && masque != nil && mat.Couches == nil {
		garde(e.masques.applique(e.doc, e.bin, g, mat.Decoupe, *masque))
	}
}

// materiauGLTF traduit un materiau du jeu sans ses textures : gris opaque, ou bleute
// translucide pour un melange non opaque ou une vitre (`extras.vitre`). Couches et decoupe s'y
// ajoutent ensuite.
func materiauGLTF(id uint32, table map[uint32]Materiau) gltfMaterial {
	mat, connu := table[id]
	g := gltfMaterial{
		Name: fmt.Sprintf("mat_%08x", id), AlphaMode: "OPAQUE", DoubleSided: true,
		PBR:    gltfPBR{BaseColorFactor: [4]float32{0.7, 0.7, 0.7, 1}, RoughnessFactor: 1},
		Extras: map[string]any{"id": id, "connu": connu},
	}
	if !connu {
		return g
	}
	g.Extras["shader"], g.Extras["melange"] = mat.Shader, mat.melangeEcrit() // LOCAL-CHANGE (infinite-theater-3d)
	if mat.Pochoir != nil {
		g.Extras["pochoir"] = mat.Pochoir
	}
	if mat.Vitre() {
		g.Extras["vitre"] = true
	}
	if !mat.Opaque() || mat.Vitre() {
		g.AlphaMode = "BLEND"
		g.PBR.BaseColorFactor = [4]float32{0.6, 0.8, 1, 0.25}
	}
	return g
}

// ajouteGroupe verse un groupe dans le tampon binaire : sommets convertis en axes glTF, puis
// les indices de chaque materiau, chacun aligne sur 4 octets.
func ajouteGroupe(doc *gltfDoc, bin *tamponGLB, nom string, g *GroupeMaillage, rangMateriau func(uint32) int) {
	attributs := ecritSommetsGroupe(doc, bin, g)
	ids, indices := ecritIndicesGroupe(doc, bin, g)
	mesh := gltfMesh{Name: nom}
	for k, id := range ids {
		mesh.Primitives = append(mesh.Primitives, gltfPrimitive{
			Attributes: attributs, Indices: indices[k],
			Material: rangMateriau(id), Mode: glTriangles,
		})
	}
	doc.Meshes = append(doc.Meshes, mesh)
	rangMesh := len(doc.Meshes) - 1
	doc.Nodes = append(doc.Nodes, gltfNode{Name: nom, Mesh: &rangMesh})
}

// ecritSommetsGroupe verse les sommets d'un groupe (convertis en axes glTF), ses normales et ses
// jeux de coordonnees, et rend les attributs de ses primitives.
func ecritSommetsGroupe(doc *gltfDoc, bin *tamponGLB, g *GroupeMaillage) map[string]int {
	lo := []float32{float32(math.Inf(1)), float32(math.Inf(1)), float32(math.Inf(1))}
	hi := []float32{float32(math.Inf(-1)), float32(math.Inf(-1)), float32(math.Inf(-1))}
	offSommets := bin.Len()
	for i := 0; i+2 < len(g.Sommets); i += 3 {
		v := [3]float32{g.Sommets[i], g.Sommets[i+2], -g.Sommets[i+1]}
		for k := 0; k < 3; k++ {
			lo[k], hi[k] = min(lo[k], v[k]), max(hi[k], v[k])
		}
		_ = binary.Write(bin, binary.LittleEndian, v)
	}
	doc.BufferViews = append(doc.BufferViews,
		gltfBufferView{ByteOffset: offSommets, ByteLength: bin.Len() - offSommets, Target: glArrayBuffer})
	position := len(doc.Accessors)
	doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1,
		ComponentType: glComponentF32, Count: len(g.Sommets) / 3, Type: "VEC3", Min: lo, Max: hi})
	attributs := map[string]int{"POSITION": position}
	ajouteNormalesGLB(doc, bin, g, attributs)
	for j, uv := range g.UV {
		if len(uv) != 2*(len(g.Sommets)/3) {
			continue
		}
		offUV := bin.Len()
		_ = binary.Write(bin, binary.LittleEndian, uv)
		doc.BufferViews = append(doc.BufferViews,
			gltfBufferView{ByteOffset: offUV, ByteLength: bin.Len() - offUV, Target: glArrayBuffer})
		attributs[fmt.Sprintf("TEXCOORD_%d", j)] = len(doc.Accessors)
		doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1,
			ComponentType: glComponentF32, Count: len(uv) / 2, Type: "VEC2"})
	}
	return attributs
}

// ecritIndicesGroupe verse les indices de chaque cle d'un groupe, chacun aligne sur 4 octets, dans
// l'ordre des cles, et rend les cles et l'accesseur de chacune.
func ecritIndicesGroupe(doc *gltfDoc, bin *tamponGLB, g *GroupeMaillage) ([]uint32, []int) {
	ids := make([]uint32, 0, len(g.Indices))
	for id, ix := range g.Indices {
		if len(ix) > 0 {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids) // ordre stable : deux exports de la meme carte rendent le meme fichier
	accesseurs := make([]int, 0, len(ids))
	for _, id := range ids {
		offIndices := bin.Len()
		_ = binary.Write(bin, binary.LittleEndian, g.Indices[id])
		doc.BufferViews = append(doc.BufferViews,
			gltfBufferView{ByteOffset: offIndices, ByteLength: bin.Len() - offIndices, Target: glIndexBuffer})
		doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1,
			ComponentType: glComponentU32, Count: len(g.Indices[id]), Type: "SCALAR"})
		accesseurs = append(accesseurs, len(doc.Accessors)-1)
	}
	return ids, accesseurs
}

// ecritConteneurGLB ecrit l'en-tete et les deux blocs, chacun complete a 4 octets (espaces
// pour le JSON, zeros pour le binaire, comme l'exige la specification). Le bloc binaire part
// vers `w` sans etre recopie : il pese l'essentiel du fichier.
func ecritConteneurGLB(w io.Writer, js []byte, bin *tamponGLB) error {
	js = completeA4(js, ' ')
	bourrage := make([]byte, (4-bin.Len()%4)%4)
	lenBin := bin.Len() + len(bourrage)
	total := 12 + 8 + len(js) + 8 + lenBin
	var tete bytes.Buffer
	for _, v := range []uint32{glbMagic, glbVersion, uint32(total), uint32(len(js)), glbChunkJSON} {
		_ = binary.Write(&tete, binary.LittleEndian, v)
	}
	tete.Write(js)
	_ = binary.Write(&tete, binary.LittleEndian, uint32(lenBin))
	_ = binary.Write(&tete, binary.LittleEndian, uint32(glbChunkBIN))
	if _, err := w.Write(tete.Bytes()); err != nil {
		return err
	}
	if _, err := bin.WriteTo(w); err != nil {
		return err
	}
	_, err := w.Write(bourrage)
	return err
}

func completeA4(b []byte, octet byte) []byte {
	for len(b)%4 != 0 {
		b = append(b, octet)
	}
	return b
}
