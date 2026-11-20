// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
// is outdated. 3: the energy shader's self-light (the Sentinel Beam's energy parts) is read from
// its declared emissive_intensity and its tint map. 4: each weapon's idle-effect markers on the
// rig (effectMarkers, the Shock Rifle's electricity in first person). 5: their rotation (the
// Heatwave's fin markers turn a quarter about up: its vent points out of the fins). 6: an ammo
// counter's digits carry all their images (himap.ImagesEmissives: the BR75, Bandit and Commando).
// 7: each weapon's magazine size (WeaponEntry.Magazine), for the Shock Rifle's and Commando's gauges.
// 8: the rigs carry the game's vertex normals (himap geometry_normales.go): smooth shading.
// 9: the effect markers include those of the barrel's firing effect (the Shock Rifle's
// primary_trigger), where the shot's game effect plays in first person.
const SchemaFirstPerson = 9

// EffectMarker is a marker an idle effect emits at, on the rig: its name (StringID, hex), the bone
// that carries it (its glTF node name), and its position and rotation (quaternion x, y, z, w) in the
// bone's frame, GLB axes.
type EffectMarker struct {
	Marker   string     `json:"marker"`
	Bone     string     `json:"bone"`
	Position [3]float32 `json:"position"`
	Rotation [4]float32 `json:"rotation"`
}

// IndexFile is the library's index file; its presence says the build is complete.
const IndexFile = "index.json"

// ArmsFile is the arm pieces catalog the view asks for at the library root.
const ArmsFile = "bras.json"

// prefixeRig prefixes a rig file name with the first 16 hex digits of the sha256 of the rig's
// content: two weapons on the same rig share one file.
const prefixeRig = "rig-"

// LongueurEmpreinteRig is the hex length of the content digest in a rig file name.
const LongueurEmpreinteRig = 16

// RigFile returns the name of a rig's GLB from the digest of its content.
func RigFile(glb []byte) string {
	e := sha256.Sum256(glb)
	return prefixeRig + hex.EncodeToString(e[:])[:LongueurEmpreinteRig] + ".glb"
}

// textureFile returns the depot file name of a shared image: texture-<32 hex>.<ext>, the
// content digest.
func textureFile(data []byte, ext string) string {
	e := sha256.Sum256(data)
	return "texture-" + hex.EncodeToString(e[:]) + "." + ext
}

// libraryFileNamePattern is the only file names the library folder holds: the index, the
// arm catalog, a rig, and a depot texture.
// LOCAL-CHANGE (infinite-theater-3d): depot textures may also be KTX2 (the KTX2 pass output).
var libraryFileNamePattern = regexp.MustCompile(`^(index\.json|bras\.json|rig-[0-9a-f]{16}\.glb|piece-[0-9a-f]{8}-[0-9a-f]{8}\.glb|texture-([0-9a-f]{16}|[0-9a-f]{64})\.(png|jpg|ktx2))$`)

// IsLibraryFileName says whether `name` is a file the rigs route serves.
func IsLibraryFileName(name string) bool { return libraryFileNamePattern.MatchString(name) }

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
	EkurStamp string        `json:"ekur_stamp"`
	Weapons   []WeaponEntry `json:"weapons"`
	Rigs      []Rig         `json:"rigs"`
	Failures  []Failure     `json:"failures"`
	Textures  Textures      `json:"textures"`
}

// WeaponEntry is one weapon and the file of its rig.
type WeaponEntry struct {
	Weapon string `json:"weapon"`
	File   string `json:"file"`
	// EffectMarkers: the markers the weapon's idle particle effects emit at (the weapons library's
	// idle_effects), on the rig: the bone that carries each and its position in that bone's frame,
	// GLB axes. Empty for a weapon without an idle effect.
	EffectMarkers []EffectMarker `json:"effectMarkers"`
	// Magazine: the rounds the weapon's first magazine holds loaded (weaponicons.ReadMagazineSize,
	// the engine's primary_ammunition denominator); the viewer reads its ammo gauges (the Shock
	// Rifle's diamonds, the Commando's bar) as the rounds over it. Left out without a magazine.
	Magazine int `json:"magazine,omitempty"`
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

// Failure is one weapon whose rig could not be written.
type Failure struct {
	Weapon string `json:"weapon"`
	Reason string `json:"reason"`
}

// Textures summarizes the shared texture depot.
type Textures struct {
	Files      int   `json:"files"`
	Bytes      int64 `json:"bytes"`
	References int   `json:"references"`
}
