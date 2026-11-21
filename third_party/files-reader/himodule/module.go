// Package himodule lit les archives .module Halo Infinite (mohd v53) et extrait
// les tags (décompression Kraken via libs/gamefiles/ooz). Offline-pur, universel.
//
// Layout VÉRIFIÉ (hand-decode catalyst/ds, cross-checké table des blocs) :
//
//	header 0x48 ; entrée fichier stride 0x58 :
//	  +0x0A blockCount u16 | +0x0C firstBlockIndex u32 | +0x14 group fourCC u32 LE
//	  +0x18 data_offset u32 | +0x20 compressedSize u32 | +0x24 uncompressedSize u32
//	bloc (20o) : +0 compOff +4 compSize +8 decompOff +12 decompSize +16 bCompressed
//	  compOff RELATIF au data_offset du fichier.
//
// En-tête (0x48 o) : 0x10 fileCount | 0x20 resourceIndex | 0x24 stringsSize
//
//	0x28 resourceCount | 0x2C blockCount | 0x38 hd1Delta (u64) | 0x40 dataSize (u64).
//
// dataBase (début de la section données) : `tailleFichier - dataSize` quand dataSize
// est renseigné, sinon fin des tables alignée sur 4 Ko. L'ancienne règle
// `tailleFichier - max(data_offset+compressedSize)` est FAUSSE dès qu'un module a un
// compagnon `_hd1` ou du remplissage final (mesuré : 1965/2047 entrées en échec sur
// any/levels/multi/catalyst, 100 % sur pc/levels/multi/ridgeline).
//
// COMPAGNON `.module_hd1` (le fichier haute resolution installe a cote d'une archive : les plus
// grands niveaux de mip des bitmaps, 5,4 Go pour forge_objects). C'est un fichier SANS en-tete :
// la suite de la section de donnees de l'archive. Une entree dont le bit 0 des drapeaux (+0x18,
// 16 bits de poids fort) est arme y vit, a l'offset `data_offset - hd1Delta` (+0x38 de
// l'en-tete) ; ses blocs se lisent ensuite comme ceux de l'archive (compOff relatif au debut de
// l'entree, Kraken ou brut selon bCompressed). Regle deterministe, pas de calibration.
//
// Mesure le 2026-11-21 sur les 38 compagnons de l'installation PC (toutes archives mohd v53,
// 6 962 entrees hd1) : sur chacun, la premiere entree hd1 a data_offset == hd1Delta (offset 0
// du compagnon), chaque entree tient dans le fichier, et la derniere finit EXACTEMENT a la fin
// du fichier. Le premier octet d'une entree est un en-tete Kraken (0x8C) sur 6 635 entrees, un
// bloc brut sur les 327 autres ; les 6 962 se decompressent a leur taille declaree. hd1Delta est
// un multiple de 4 Ko. Meme regle que infinite-rs (Surasia,
// https://github.com/Surasia/infinite-rs, `module/loader.rs` et `module/file.rs` :
// `data_offset - hd1_delta` au-dela de la version 52, CampaignFlight). Les candidats d'avant
// (0, hd1Delta, taille - hd1Delta, hd1Delta aligne) n'etaient bons sur aucun des 38 : le
// compagnon n'etait jamais ouvert, et 6 930 bitmaps se dessinaient a la moitie de leur taille.
package himodule

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"

	"github.com/JGtm/halo-infinite-files-reader/ooz"
)

const (
	headerSize     = 0x48
	entryStride    = 0x58
	blockEntrySize = 20

	offBlockCount = 0x0A
	offFirstBlock = 0x0C
	offGroup      = 0x14
	offDataOffset = 0x18
	offGlobalID   = 0x28
	offCompSize   = 0x20
	offUncompSize = 0x24
	// Decoupage des octets decompresses d'une entree : en-tete de tag, donnees de tag, puis
	// donnees de ressource « actuelles » (les pixels d'un bitmap qui les porte en ligne). Une
	// ressource brute (sans en-tete) a les trois a zero.
	offHeaderSize    = 0x2C
	offTagDataSize   = 0x30
	offActualResSize = 0x38

	offHdrStringsSize = 0x24
	offHdrResCount    = 0x28
	offHdrDataSize    = 0x40
	offHdrHd1Delta    = 0x38

	// maxOffset : plus grand data_offset d'une entree (48 bits, cf. File.DataOffset).
	maxOffset = 1<<48 - 1

	// dataAlign : la section données commence sur une frontière de 4 Ko.
	dataAlign = 0x1000
)

// Module est une archive .module mappée en mémoire.
type Module struct {
	data      []byte
	fileCount int
	numBlocks int
	blockOff  int
	dataBase  int
	// hd1 est le compagnon `.module_hd1`, ouvert quand l'archive en annonce un et qu'il contient
	// toutes ses entrees hd1 (cf. loadHd1), nil sinon. hd1Base s'ajoute au data_offset d'une
	// entree hd1 pour donner sa position dans le fichier.
	hd1     *os.File
	hd1Base int
	// projData : la projection qui porte `data`. Elle n'est pas fusionnee avec la tranche parce
	// qu'une projection se RELACHE (cf. Close) alors qu'une tranche ne fait que la designer.
	projData *projection
}

// File décrit une entrée fichier (tag ou ressource).
type File struct {
	Index      int
	Group      string // fourCC (ex. "sbsp", "mode"), ou "" si non imprimable
	FirstBlock int
	BlockCount int
	// DataOffset est un entier 48 BITS, pas un u32 : les deux octets de poids fort du
	// mot de 64 bits a +0x18 sont des DRAPEAUX. Lire un u32 casse toute archive de plus
	// de 4 Go (globals-rtx-new fait 7,78 Go) -- symptome : ooz retourne -1 partout.
	DataOffset int64
	// Flags : bit 0 = UseHd1, la donnee vit dans le compagnon `.module_hd1`.
	Flags      uint16
	CompSize   int
	UncompSize int
	// GlobalID est l'identifiant global de tag (+0x28). C'est la cle de jointure avec les
	// references de tag d'un autre tag.
	GlobalID uint32
	// HeaderSize + TagDataSize + ActualResourceSize = UncompSize quand l'entree porte un tag ;
	// les trois valent zero pour une ressource brute (tout UncompSize est de la donnee).
	HeaderSize         int
	TagDataSize        int
	ActualResourceSize int
}

// Donnees rend la partie « ressource » d'octets deja decompresses par Extract : ce qui suit
// l'en-tete et les donnees de tag, ou tout pour une ressource brute.
func (f File) Donnees(octets []byte) []byte {
	debut := f.HeaderSize + f.TagDataSize
	if debut <= 0 || debut > len(octets) {
		return octets
	}
	return octets[debut:]
}

// UseHd1 dit si la donnee de cette entree vit dans le fichier compagnon `.module_hd1`.
func (f File) UseHd1() bool { return f.Flags&1 != 0 }

func u16(b []byte, o int) uint16 { return binary.LittleEndian.Uint16(b[o:]) }
func u32(b []byte, o int) uint32 { return binary.LittleEndian.Uint32(b[o:]) }
func u64(b []byte, o int) uint64 { return binary.LittleEndian.Uint64(b[o:]) }

func fourCC(v uint32) string {
	b := []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
	for _, c := range b {
		if c < 0x20 || c > 0x7e {
			return ""
		}
	}
	return string(b)
}

// Open indexe un .module. L'archive est PROJETEE en memoire, pas copiee dans le tas
// (cf. projection.go) : le lecteur n'en touche que les tables et les blocs demandes.
func Open(path string) (*Module, error) {
	proj, err := projette(path)
	if err != nil {
		return nil, err
	}
	data := proj.octets
	if len(data) < headerSize || string(data[:4]) != "mohd" {
		_ = proj.ferme()
		return nil, fmt.Errorf("himodule: missing mohd magic (%s)", path)
	}
	m := &Module{
		data:      data,
		projData:  proj,
		fileCount: int(u32(data, 0x10)),
		numBlocks: int(u32(data, 0x2C)),
	}
	m.dataBase = dataBase(data, m.fileCount, m.numBlocks)
	m.blockOff = lockBlockTable(data, m.numBlocks, m.dataBase, headerSize+m.fileCount*entryStride)
	if m.blockOff < 0 {
		_ = m.Close()
		return nil, fmt.Errorf("himodule: block table not found")
	}
	m.loadHd1(path)
	return m, nil
}

// Close relache la projection de l'archive et ferme son compagnon.
//
// APPELER Close EST SUR PARCE QU'AUCUN OCTET RENDU N'ALIASE LA PROJECTION : `Extract`
// decompresse dans un tampon neuf ou fait `copy`, `ResourceBlob` concatene par `append`,
// `Files`/`fourCC` rendent des valeurs. Un module ferme ne doit plus etre lu — c'est la
// SEULE regle nouvelle, et elle ne concerne que les appelants qui ferment.
//
// Ne pas fermer n'est pas une fuite de memoire vive : une projection en lecture seule est
// adossee au fichier, le systeme en reprend les pages quand il en a besoin, et tout est
// relache a la fin du processus. Fermer sert aux boucles qui ouvrent beaucoup d'archives —
// c'est le cas de `himap.ModuleIndex`, une par carte.
func (m *Module) Close() error {
	errData := m.projData.ferme()
	var errHd1 error
	if m.hd1 != nil {
		errHd1 = m.hd1.Close()
	}
	m.data, m.hd1 = nil, nil
	if errData != nil {
		return errData
	}
	return errHd1
}

// loadHd1 ouvre le compagnon `.module_hd1` quand l'archive en annonce un (hd1Delta non nul) et
// porte des entrees hd1. La base est `-hd1Delta` (cf. en-tete du paquet). Le compagnon n'est
// PAS projete : il fait jusqu'a 5,4 Go, et une projection garderait dans la memoire du processus
// chaque page lue ; srcFor lit a la demande les octets compresses d'une seule entree (ReadAt).
// Un compagnon absent, vide, ou qui ne contient pas TOUTES les entrees hd1 n'est pas ouvert :
// ses entrees rendent alors une erreur plutot que des octets pris ailleurs.
func (m *Module) loadHd1(path string) {
	delta := u64(m.data, offHdrHd1Delta)
	ents := m.hd1Entries()
	if delta == 0 || len(ents) == 0 {
		return
	}
	f, err := os.Open(path + "_hd1")
	if err != nil {
		return
	}
	if st, err := f.Stat(); err == nil {
		if base, err := hd1Base(delta, st.Size(), ents); err == nil {
			m.hd1, m.hd1Base = f, base
			return
		}
	}
	_ = f.Close()
}

// hd1Entries rend les entrees dont le drapeau UseHd1 est arme.
func (m *Module) hd1Entries() []File {
	var ents []File
	for i := 0; i < m.fileCount; i++ {
		if f := m.file(i); f.UseHd1() {
			ents = append(ents, f)
		}
	}
	return ents
}

// hd1Base rend la base du compagnon, `-hd1Delta`, apres avoir verifie que chaque entree hd1 tient
// dans ses hd1Len octets. Une seule entree hors du fichier refuse le compagnon : c'est le signe
// d'une autre disposition, que la regle mesuree ne couvre pas.
func hd1Base(delta uint64, hd1Len int64, ents []File) (int, error) {
	if delta == 0 || delta > maxOffset {
		return 0, fmt.Errorf("himodule: hd1Delta %d outside the range of a companion", delta)
	}
	if hd1Len <= 0 {
		return 0, errors.New("himodule: empty hd1 companion")
	}
	base := -int64(delta)
	for _, f := range ents {
		off := base + f.DataOffset
		if off < 0 || f.CompSize < 0 || off+int64(f.CompSize) > hd1Len {
			return 0, fmt.Errorf("himodule: hd1 entry %d outside the companion (offset %d, %d bytes, file of %d)",
				f.Index, off, f.CompSize, hd1Len)
		}
	}
	return int(base), nil
}

// srcFor rend le tampon ou lire une entree et la base a laquelle s'ajoute son data_offset : la
// section de donnees de l'archive, ou, pour une entree hd1, ses seuls octets compresses lus dans
// le compagnon, avec la base `-data_offset` (l'entree commence a l'octet 0 du tampon).
func (m *Module) srcFor(f File) ([]byte, int, error) {
	if !f.UseHd1() {
		return m.data, m.dataBase, nil
	}
	if m.hd1 == nil {
		return nil, 0, errors.New("himodule: entry in hd1 but companion missing or refused")
	}
	buf := make([]byte, f.CompSize)
	if _, err := m.hd1.ReadAt(buf, int64(m.hd1Base)+f.DataOffset); err != nil {
		return nil, 0, fmt.Errorf("himodule: reading hd1 entry %d: %w", f.Index, err)
	}
	return buf, -int(f.DataOffset), nil
}

// dataBase : début de la section données. `tailleFichier - dataSize` quand l'en-tête
// renseigne dataSize ; sinon fin des tables (entrées + strings + resources + blocs)
// alignée sur 4 Ko. Les deux règles coïncident quand les deux sont applicables.
func dataBase(data []byte, fileCount, numBlocks int) int {
	if ds := int(u64(data, offHdrDataSize)); ds > 0 && ds <= len(data) {
		return len(data) - ds
	}
	end := headerSize + fileCount*entryStride +
		int(u32(data, offHdrStringsSize)) + int(u32(data, offHdrResCount))*4 +
		numBlocks*blockEntrySize
	return (end + dataAlign - 1) &^ (dataAlign - 1)
}

// lockBlockTable : la table des blocs précède immédiatement la section données. On part
// donc de (dataBase - numBlocks*20) et on descend par pas de 4 jusqu'à la fin de la
// table des entrées fichier, en validant bCompressed∈{0,1} et compSize plausible.
func lockBlockTable(data []byte, numBlocks, base, floor int) int {
	if numBlocks <= 0 {
		return floor
	}
	start := base - numBlocks*blockEntrySize
	if start > len(data)-numBlocks*blockEntrySize {
		start = len(data) - numBlocks*blockEntrySize
	}
	for off := start; off >= floor; off -= 4 {
		if plausibleBlockTable(data, numBlocks, off) {
			return off
		}
	}
	return -1
}

func plausibleBlockTable(data []byte, numBlocks, off int) bool {
	if off < 0 || off+numBlocks*blockEntrySize > len(data) {
		return false
	}
	for i := 0; i < numBlocks; i++ {
		b := off + i*blockEntrySize
		if u32(data, b+16) > 1 {
			return false
		}
		if cs := u32(data, b+4); cs == 0 || cs > 0x4000000 {
			return false
		}
	}
	return true
}

func (m *Module) file(i int) File {
	e := headerSize + i*entryStride
	return File{
		Index:      i,
		Group:      fourCC(u32(m.data, e+offGroup)),
		FirstBlock: int(u32(m.data, e+offFirstBlock)),
		BlockCount: int(u16(m.data, e+offBlockCount)),
		DataOffset: int64(u64(m.data, e+offDataOffset) & 0x0000FFFFFFFFFFFF),
		Flags:      uint16(u64(m.data, e+offDataOffset) >> 48),
		CompSize:   int(u32(m.data, e+offCompSize)),
		UncompSize: int(u32(m.data, e+offUncompSize)),
		GlobalID:   u32(m.data, e+offGlobalID),

		HeaderSize:         int(u32(m.data, e+offHeaderSize)),
		TagDataSize:        int(u32(m.data, e+offTagDataSize)),
		ActualResourceSize: int(u32(m.data, e+offActualResSize)),
	}
}

// Files renvoie toutes les entrées d'un groupe (ex. "sbsp"). Group="" → toutes.
func (m *Module) Files(group string) []File {
	var out []File
	for i := 0; i < m.fileCount; i++ {
		f := m.file(i)
		if group == "" || f.Group == group {
			out = append(out, f)
		}
	}
	return out
}

// Extract décompresse le contenu d'un fichier (assemblage de ses blocs, ou blob
// unique pour les resources à blockCount==0).
func (m *Module) Extract(f File) ([]byte, error) {
	// Resource : pas de blocs → un seul blob compressé à data_offset.
	buf, dbase, err := m.srcFor(f)
	if err != nil {
		return nil, err
	}
	if f.BlockCount == 0 {
		base := dbase + int(f.DataOffset)
		if base < 0 || base+f.CompSize > len(buf) {
			return nil, fmt.Errorf("himodule: resource out of bounds")
		}
		src := buf[base : base+f.CompSize]
		if f.CompSize == f.UncompSize {
			out := make([]byte, f.UncompSize)
			copy(out, src)
			return out, nil
		}
		return ooz.Decompress(src, f.UncompSize)
	}
	out := make([]byte, f.UncompSize)
	for i := f.FirstBlock; i < f.FirstBlock+f.BlockCount; i++ {
		b := m.blockOff + i*blockEntrySize
		co, cs := int(u32(m.data, b)), int(u32(m.data, b+4))
		dorel, ds := int(u32(m.data, b+8)), int(u32(m.data, b+12))
		comp := u32(m.data, b+16)
		base := dbase + int(f.DataOffset) + co
		if base < 0 || base+cs > len(buf) || dorel+ds > len(out) {
			return nil, fmt.Errorf("himodule: block %d out of bounds", i)
		}
		src := buf[base : base+cs]
		if comp == 0 {
			copy(out[dorel:dorel+ds], src)
			continue
		}
		dec, err := ooz.Decompress(src, ds)
		if err != nil {
			return nil, fmt.Errorf("himodule: bloc %d: %w", i, err)
		}
		copy(out[dorel:dorel+ds], dec)
	}
	return out, nil
}
