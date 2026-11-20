// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package spartanpieces builds and lays out the standalone's Spartan armor piece
// library: one skinned GLB per piece (a region's permutation of the Spartan's
// `mode`), one rigid GLB per attachment entry (an `ocad` entry posed on one of the
// Spartan's markers), the shared texture depot, the coating table distilled from the
// community Ekur reference (when given), and the index.json the 3D view reads.
//
// Ported from LevelUp's apps/go-api internal/mapmesh pieces_armure.go,
// pieces_accessoires.go and the meshproto pieces index and coatings shapes (AGPL-3.0,
// JGtm). The file names and the index shape are LevelUp's, so the web viewer's
// armor library loader (armorLibrary3d.ts) reads them unchanged. Without an Ekur
// reference the library has no coatings section and the painted materials stay in
// their neutral render (LevelUp's own documented behavior).
//
// The library lands in <data dir>/spartan-pieces; its files are written atomically
// (temp name then rename) and index.json is written last, so its presence says the
// build is complete.
package spartanpieces

import (
	"fmt"
	"regexp"
	"strings"
)

// SchemaPieces is the version of the index format (Index) and the files it names,
// the same version LevelUp's index carries (raw piece surfaces in
// extras.surfaceBrute, material styles in extras.style, coatings and swatches).
// Bumped when the build output changes the way the view reads it (the view's
// ARMOR_INDEX_SCHEMA must accept it). 3: the pieces and attachments carry the
// game's vertex normals (himap geometry_normales.go), the index unchanged: the
// view reads 2 and 3 alike (ARMOR_INDEX_SCHEMAS).
const SchemaPieces = 3

// FileIndex is the library's index file; its presence says the build is complete.
const FileIndex = "index.json"

// RegionCommon is the style region that holds for every region (Ekur ANY_REGION).
const RegionCommon = "0b7e328b"

// RegionVisor is the style region of the visor (Ekur MP_VISOR).
const RegionVisor = "54ad0a58"

// ExtrasStyleKey is the extras key of a painted GLB material that carries its
// coating style (ExtrasStyleMaterial).
const ExtrasStyleKey = "style"

// EkurEnv is the environment variable naming the full path of the Ekur reference
// folder, in front of the <data dir>/ekur fallback.
const EkurEnv = "IT3D_EKUR_DIR"

// FileCoatings is the common coating table (CoatingsTable).
const FileCoatings = "coatings.json"

// filePrefixPiece prefixes a piece GLB file name with its key.
const filePrefixPiece = "piece-"

// filePrefixAttachment prefixes an attachment GLB file name with its key.
const filePrefixAttachment = "attachment-"

// filePrefixTexture prefixes a shared image file name with its content digest.
const filePrefixTexture = "texture-"

// filePrefixCoating prefixes a coating file name with its style key.
const filePrefixCoating = "coating-"

// filePrefixSwatch prefixes a swatch image file name with its gradient bitmap key.
const filePrefixSwatch = "swatch-"

// fileExtensionGLB is the extension of every model file of the library.
const fileExtensionGLB = ".glb"

// digestLength is the hex digits of the content digest in a texture file name.
const digestLength = 16

// keySeparator joins the two halves of a piece key.
const keySeparator = "-"

// idFormat is the hex form of a game identifier (8 digits, unsigned 32 bits).
const idFormat = "%08x"

// libraryFileNames are the only file names the library folder holds, the ones the
// library route serves: LevelUp's whitelist.
// LOCAL-CHANGE (infinite-theater-3d): depot textures may also be KTX2 (the KTX2 pass output).
var libraryFileNames = regexp.MustCompile(`^(index\.json|coatings\.json|piece-[0-9a-f]{8}-[0-9a-f]{8}\.glb|attachment-[0-9a-f]{8}(-[0-9]+)?\.glb|` +
	`texture-[0-9a-f]{16}\.(png|jpg|ktx2)|coating-[0-9a-f]{8}\.json|swatch-[0-9a-f]{8}\.png)$`)

// LibraryFile says whether name is one of the library's own file names (index,
// coating table, piece, attachment, shared image, coating file, swatch).
func LibraryFile(name string) bool { return libraryFileNames.MatchString(name) }

// FileType is the content type served for a library file name.
func FileType(name string) string {
	switch {
	case strings.HasSuffix(name, fileExtensionGLB):
		return "model/gltf-binary"
	case strings.HasSuffix(name, ".json"):
		return "application/json"
	case strings.HasSuffix(name, ".png"):
		return "image/png"
	case strings.HasSuffix(name, ".ktx2"):
		// LOCAL-CHANGE (infinite-theater-3d): KTX2 textures.
		return "image/ktx2"
	default:
		return "image/jpeg"
	}
}

// Identifier is the hex form of a game identifier (StringID or GlobalID), the one
// the index and the manifests use: 8 lowercase digits of the unsigned 32 bits.
func Identifier(id uint32) string { return fmt.Sprintf(idFormat, id) }

// PieceKey is one piece's key: its region key then its permutation key.
func PieceKey(regionKey, permutationKey string) string {
	return regionKey + keySeparator + permutationKey
}

// AttachmentKey is one attachment entry's key: its tag key, followed by the entry
// number when the accessory has several (entry 0: the bare key).
func AttachmentKey(tagKey string, entry int) string {
	if entry == 0 {
		return tagKey
	}
	return fmt.Sprintf("%s%s%d", tagKey, keySeparator, entry)
}

// FilePiece is the GLB file name of the piece key (PieceKey).
func FilePiece(key string) string { return filePrefixPiece + key + fileExtensionGLB }

// FileAttachment is the GLB file name of the attachment key (AttachmentKey).
func FileAttachment(key string) string { return filePrefixAttachment + key + fileExtensionGLB }

// FileCoating is the file name of the coating of style key (Identifier).
func FileCoating(key string) string { return filePrefixCoating + key + ".json" }

// FileSwatch is the image file name of the swatch bitmap key (Identifier).
func FileSwatch(key string) string { return filePrefixSwatch + key + ".png" }

// Index is the whole library (index.json), written last. Everything is in glTF
// axes (x, z, -y of the Halo frame), game units, at-rest pose.
//
// Assembling a player, the viewer's contract:
//  1. Skeleton: any piece's (every one carries Skeleton.Bones in the same order,
//     with the same inverse bind matrices as the `spartan` model); one skeleton per
//     player, each piece's SkinnedMesh is bound to it as is.
//  2. Pieces: for each manifest region, the piece of key PieceKey(region_key,
//     permutation_key); a key absent from Pieces draws nothing.
//  3. Attachments: for each resolved manifest accessory, the entries of
//     Attachments whose Tag is its tag_key; each entry is posed on the marker
//     Marker: the instance chosen in Markers (the first whose region and
//     permutation the player's selection wears, else the first region-less one),
//     a child of bone Bone at the instance's pose, then the attachment at its
//     Offset in that frame.
//  4. A core's default armor: the Base of the theme whose Permutation is the
//     manifest variant_id (in hex).
//  5. Paint: each piece material with extras.surfaceBrute is painted with the
//     player's coating (contract in the header of coating.go); without a Coatings
//     section the material stays in its neutral render.
type Index struct {
	Schema int `json:"schema"`
	// Mode: the Spartan `mode` (GlobalID); Generator: the tool that wrote the library.
	Mode      string `json:"mode"`
	Generator string `json:"generator"`
	// EkurStamp: the digest of the Ekur export this build read (EkurStamp), ""
	// when the build ran without an export: the server compares it with the
	// current export and rebuilds the library when the two differ.
	EkurStamp   string            `json:"ekur_stamp"`
	Skeleton    SkeletonIndex     `json:"skeleton"`
	Pieces      []PieceIndex      `json:"pieces"`
	Attachments []AttachmentIndex `json:"attachments"`
	Markers     []MarkerIndex     `json:"markers"`
	Themes      []ThemeIndex      `json:"themes"`
	Textures    TexturesIndex     `json:"textures"`
	// Coatings: the coating table (coating.go); nil when the build had no Ekur
	// reference: the pieces then stay in their neutral paint.
	Coatings *CoatingsIndex `json:"coatings,omitempty"`
	// Failures: the pieces and attachment entries the build could not write, and why.
	Failures []FailureIndex `json:"failures"`
}

// SkeletonIndex is the bones every piece carries, in skin order.
type SkeletonIndex struct {
	Bones []string `json:"bones"`
	// Root: the index of the root bone in Bones.
	Root int `json:"root"`
}

// BBox is a bounding box, glTF axes.
type BBox struct {
	Min [3]float32 `json:"min"`
	Max [3]float32 `json:"max"`
}

// Pose is a translation and a rotation (quaternion x, y, z, w), glTF axes.
type Pose struct {
	Translation [3]float32 `json:"translation"`
	Rotation    [4]float32 `json:"rotation"`
}

// PieceIndex is one skinned piece.
type PieceIndex struct {
	Key         string `json:"key"`
	Region      string `json:"region"`
	Permutation string `json:"permutation"`
	File        string `json:"file"`
	Triangles   int    `json:"triangles"`
	Box         BBox   `json:"bbox"`
	Bytes       int64  `json:"bytes"`
}

// AttachmentIndex is one rigid attachment entry, in its model's frame.
type AttachmentIndex struct {
	Key string `json:"key"`
	// Tag: the `ocad` (the manifest tag_key); Entry: the entry number; Model: its `hlmt`.
	Tag       string `json:"tag"`
	Entry     int    `json:"entry"`
	Model     string `json:"model"`
	File      string `json:"file"`
	Triangles int    `json:"triangles"`
	Box       BBox   `json:"bbox"`
	Bytes     int64  `json:"bytes"`
	// Marker: the Spartan marker group (Markers); Offset: the attachment's pose in
	// the frame of an instance of that marker.
	Marker string `json:"marker"`
	Offset Pose   `json:"offset"`
}

// MarkerIndex is one Spartan marker group and its instances.
type MarkerIndex struct {
	Name      string          `json:"name"`
	Instances []InstanceIndex `json:"instances"`
}

// InstanceIndex is one marker pose, in the frame of bone Bone. Region and
// Permutation empty: the instance holds whatever piece is worn; Permutation
// alone empty: whatever permutation of the region.
type InstanceIndex struct {
	Region      string `json:"region"`
	Permutation string `json:"permutation"`
	// Bone: the parent bone's name (empty: the model frame); Node: its rank in
	// Skeleton.Bones.
	Bone string `json:"bone"`
	Node int    `json:"node"`
	Pose
}

// ThemeIndex is one armor core and its base.
type ThemeIndex struct {
	Name string `json:"name"`
	// Ocur: the theme's tag; Permutation: the core's own permutation (the manifest
	// variant_id); Read false: tag absent or unreadable, Base empty.
	Ocur        string        `json:"ocur"`
	Permutation string        `json:"permutation"`
	Read        bool          `json:"read"`
	Base        []RegionIndex `json:"base_regions"`
}

// RegionIndex is one region permutation.
type RegionIndex struct {
	Region      string `json:"region"`
	Permutation string `json:"permutation"`
}

// TexturesIndex is the shared images.
type TexturesIndex struct {
	Files int   `json:"files"`
	Bytes int64 `json:"bytes"`
	// References: the images named by the whole set of GLBs (before sharing).
	References int `json:"references"`
}

// FailureIndex is one piece or attachment entry the build did not write.
type FailureIndex struct {
	Key    string `json:"key"`
	Reason string `json:"reason"`
}
