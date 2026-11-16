// Package firstperson builds and lays out the standalone's first-person library: one
// animated rig GLB per weapon the game renders in first person, the shared texture depot,
// and the index.json the 3D view reads.
//
// The set is the game's own roster: every `weap` tag that carries a readable « first person »
// block (himap.Arsenal.ArmesPremierePersonne), so the library covers every weapon a match can
// name without a replay-specific selection. A weapon whose rig cannot be written is recorded
// in the index (failures) and marked on disk with an empty <key>.none file, and the build
// continues. The library lands in <data dir>/first-person; the view derives that folder from
// the weapons folder it is given (dossierPremierePersonne in the web viewer).
package firstperson

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

// SchemaFirstPerson is the version of the index.json and the GLBs it names, as the view
// reads it. Bumped when the build output changes (today: KTX2 textures and the texture
// read size), so a library built by an older version of the app is outdated and rebuilt
// by the normal build flow; an index without a schema (built before schema versioning)
// is outdated.
const SchemaFirstPerson = 2

// FichierIndex is the library's index file; its presence says the build is complete.
const FichierIndex = "index.json"

// FichierBras is the arm pieces catalog the view asks for at the library root.
const FichierBras = "bras.json"

// prefixeRig prefixes a rig file name with the first 16 hex digits of the sha256 of the rig's
// content: two weapons on the same rig share one file.
const prefixeRig = "rig-"

// LongueurEmpreinteRig is the hex length of the content digest in a rig file name.
const LongueurEmpreinteRig = 16

// FichierRig rend le nom du GLB d'un rig par l'empreinte de son contenu.
func FichierRig(glb []byte) string {
	e := sha256.Sum256(glb)
	return prefixeRig + hex.EncodeToString(e[:])[:LongueurEmpreinteRig] + ".glb"
}

// fichierTexture returns the depot file name of a shared image: texture-<32 hex>.<ext>, the
// content digest.
func fichierTexture(data []byte, ext string) string {
	e := sha256.Sum256(data)
	return "texture-" + hex.EncodeToString(e[:]) + "." + ext
}

// nomFichierPremierePersonne is the only file names the library folder holds: the index, the
// arm catalog, a rig, and a depot texture.
// LOCAL-CHANGE (infinite-theater-3d): depot textures may also be KTX2 (the KTX2 pass output).
var nomFichierPremierePersonne = regexp.MustCompile(`^(index\.json|bras\.json|rig-[0-9a-f]{16}\.glb|piece-[0-9a-f]{8}-[0-9a-f]{8}\.glb|texture-([0-9a-f]{16}|[0-9a-f]{64})\.(png|jpg|ktx2))$`)

// NomFichierPremierePersonne dit si `nom` est un fichier que la route des rigs sert.
func NomFichierPremierePersonne(nom string) bool { return nomFichierPremierePersonne.MatchString(nom) }

// Index is the first-person/index.json the view reads: the schema marker, the generator tag,
// the per-weapon rig entries, the per-file rig entries, the failures, and the texture depot
// summary. The JSON field names are the view's own (IndexPremierePersonne in
// web/src/features/match-replay/scene3d/premierePersonne3d.ts).
type Index struct {
	Schema    int    `json:"schema"`
	Generator string `json:"generator"`
	// EkurStamp: the digest of the Ekur export this build read (spartanpieces.EkurStamp),
	// "" when the build ran without an export: the server compares it with the current
	// export and rebuilds the library when the two differ.
	EkurStamp string   `json:"ekur_stamp"`
	Weapons   []Arme   `json:"weapons"`
	Rigs      []Rig    `json:"rigs"`
	Failures  []Echec  `json:"failures"`
	Textures  Textures `json:"textures"`
}

// Arme is one weapon and the file of its rig.
type Arme struct {
	Weapon string `json:"weapon"`
	File   string `json:"file"`
}

// Rig is one rig file.
type Rig struct {
	File        string   `json:"file"`
	Bones       int      `json:"bones"`
	Triangles   int      `json:"triangles"`
	Bytes       int64    `json:"bytes"`
	IdleWeapon  *Pose    `json:"idleWeapon,omitempty"`
	Clips       []Clip   `json:"clips"`
	Actions     []Action `json:"actions"`
	MissingActs []string `json:"missingActions"`
}

// Pose is the weapon's at-rest position and forward (barrel) axis, glTF axes, game units.
type Pose struct {
	Position [3]float32 `json:"position"`
	Forward  [3]float32 `json:"forward"`
}

// Clip is one baked animation of the rig.
type Clip struct {
	Name            string  `json:"name"`
	Action          string  `json:"action"`
	Variant         int     `json:"variant"`
	Type            string  `json:"type"`
	Overlay         bool    `json:"overlay"`
	FrameCount      int     `json:"frameCount"`
	FrameRate       int     `json:"frameRate"`
	DurationSeconds float64 `json:"durationSeconds"`
}

// Action is one game action, one variant, and the clip that plays it.
type Action struct {
	Action  string `json:"action"`
	Variant int    `json:"variant"`
	Clip    string `json:"clip"`
}

// Echec is one weapon whose rig could not be written.
type Echec struct {
	Weapon string `json:"weapon"`
	Reason string `json:"reason"`
}

// Textures summarizes the shared texture depot.
type Textures struct {
	Files      int   `json:"files"`
	Bytes      int64 `json:"bytes"`
	References int   `json:"references"`
}
