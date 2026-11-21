//go:build gamefiles

package himap

// empreinte_himodule_gamefiles_test.go — LE HARNAIS D'EMPREINTES DU LECTEUR DE MODULES.
//
// POURQUOI IL EXISTE. `libs/gamefiles/himodule` n'avait AUCUN test (constat du 2026-09-05) alors
// qu'il est la porte d'entree de toutes les donnees du jeu : geometrie de rendu, tags de
// scenario, sons, icones. Changer sa facon de lire un `.module` — par exemple passer de
// `os.ReadFile` a une projection memoire — sans empreinte, c'est changer la source de TOUT
// sans pouvoir montrer que rien n'a bouge.
//
// CE QU'IL FIGE, ET POURQUOI CES TROIS NIVEAUX. Une empreinte qui ne couvre que l'en-tete
// laisserait passer une erreur de decompression ; une qui ne couvre que quelques tags
// laisserait passer une table d'entrees decalee. Les trois niveaux se rattrapent :
//
//  1. LA TABLE DES ENTREES — index, groupe, premier bloc, nombre de blocs, offset 48 bits,
//     drapeaux, tailles, GlobalID. Elle atteste que le module est INDEXE pareil.
//  2. LES OCTETS DECOMPRESSES de chaque entree, jusqu'a un plafond. C'est le seul niveau qui
//     atteste que la chaine blocs -> Kraken -> assemblage rend les MEMES octets.
//  3. LES BLOBS DE RESSOURCES — la concatenation qui porte sommets et indices. Elle passe par
//     la table des slots, un chemin que les deux premiers niveaux ne touchent pas.
//
// LE CHOIX DES MODULES N'EST PAS ESTHETIQUE. `academy_weapon_drills` et `fo05_desert` portent
// un compagnon `.module_hd1` du meme ordre de taille que l'archive : ils exercent la
// lecture des entrees hd1 (offset `data_offset - hd1Delta` dans le compagnon). `chasm` porte un compagnon
// marginal (6 Mo pour 83 Mo) : il exerce le chemin ordinaire. Trois petits modules valent mieux
// qu'un gros — le harnais doit rester jouable en quelques secondes, sinon on ne le joue pas.
//
// PLAFONDS : l'empreinte s'arrete a `maxEntrees` entrees et `maxOctets` octets decompresses
// par module. Les deux bornes sont DETERMINISTES (parcours dans l'ordre des index), donc
// l'empreinte est reproductible ; elles evitent qu'un module de plusieurs Go rende le harnais
// aussi couteux que le corpus qu'il doit garder.

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

const (
	// maxEntrees / maxOctets : bornes deterministes de l'empreinte (cf. en-tete).
	maxEntrees = 400
	maxOctets  = 256 << 20
)

// modulesEmpreinte : les archives figees, par dossier de `pc/levels/multi`.
var modulesEmpreinte = []string{"academy_weapon_drills", "fo05_desert", "chasm"}

// empreintesAttendues : valeurs relevees le 2026-09-05 sur l'implementation `os.ReadFile`,
// AVANT le passage a la projection memoire. Elles sont la reference du « avant/apres ».
//
// Si l'une change, ce n'est PAS a mettre a jour a la legere : cela veut dire que le lecteur
// rend d'autres octets, donc que la geometrie, les tags et les sons ont bouge. La mise a jour
// se justifie par ecrit, avec la raison du changement.
//
// Mise a jour du 2026-11-21 (academy_weapon_drills, fo05_desert ; chasm inchange) : le lecteur
// lit desormais les entrees hd1 a `data_offset - hd1Delta` dans le compagnon (cf. en-tete de
// filesreader/himodule/module.go) au lieu de rendre une erreur. Avant ce changement, le lecteur
// de main rendait deja d'autres empreintes que celles du 2026-09-05 (3faf3e09... et 66a9a300...,
// hd1 en erreur) ; une empreinte recalculee en remplacant chaque entree hd1 par l'ancienne erreur
// redonne exactement ces deux valeurs, donc seules les entrees hd1 ont change.
var empreintesAttendues = map[string]string{
	"academy_weapon_drills": "aee95b2ba2998bea0bf12be68ef026c23419ca6ffe2670d9da70da5cdea93de8",
	"fo05_desert":           "310c4e4354c4e8d09badb4aae6225bed3ea65258af3a9d8a9019f1b5239e373d",
	"chasm":                 "f097593a0827f8f33957e79e2f61c255beecb1b3f0ed266a901f80675e55539a",
}

// TestEmpreinteLecteurDeModules — les octets rendus par himodule ne bougent pas.
//
// Mutation qui doit le faire rougir : decaler d'un octet la base de donnees d'un module, ou
// la base du compagnon hd1.
func TestEmpreinteLecteurDeModules(t *testing.T) {
	dir, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	for _, nom := range modulesEmpreinte {
		t.Run(nom, func(t *testing.T) {
			chemin := filepath.Join(dir, nom, nom+"-rtx-new.module")
			if _, err := os.Stat(chemin); err != nil {
				t.Skipf("module absent de l'installation : %v", err)
			}
			got, detail := empreinteModule(t, chemin)
			t.Logf("%s : %s (%s)", nom, got, detail)
			attendu := empreintesAttendues[nom]
			if attendu == "" {
				t.Errorf("%s : aucune empreinte de reference figee — relever %s", nom, got)
				return
			}
			if got != attendu {
				t.Errorf("%s : empreinte %s, attendue %s — le lecteur rend d'AUTRES octets "+
					"(geometrie, tags et sons en dependent)", nom, got, attendu)
			}
		})
	}
}

// empreinteModule rend l'empreinte d'une archive et un resume lisible de ce qu'elle a couvert.
func empreinteModule(t *testing.T, chemin string) (string, string) {
	t.Helper()
	m, err := himodule.Open(chemin)
	if err != nil {
		t.Fatalf("ouverture : %v", err)
	}
	h := sha256.New()
	fichiers := m.Files("")
	var nEntrees, nExtraits, nBlobs, octets int
	for _, f := range fichiers {
		hacheEntree(h, f)
		nEntrees++
	}
	for _, f := range fichiers {
		if nExtraits >= maxEntrees || octets >= maxOctets {
			break
		}
		if f.UncompSize <= 0 {
			continue
		}
		buf, err := m.Extract(f)
		if err != nil {
			// Une entree illisible est une DONNEE de l'empreinte, pas un echec : certaines
			// entrees d'un module renvoient a un compagnon non calibre, et ce comportement
			// doit rester le meme avant et apres.
			h.Write([]byte("ERR:" + err.Error()))
			nExtraits++
			continue
		}
		h.Write(buf)
		octets += len(buf)
		nExtraits++
	}
	for _, f := range fichiers {
		if nBlobs >= 32 {
			break
		}
		blob, err := m.ResourceBlob(f)
		if err != nil {
			h.Write([]byte("BLOBERR:" + err.Error()))
			nBlobs++
			continue
		}
		if len(blob) == 0 {
			continue
		}
		h.Write(blob)
		nBlobs++
	}
	return hex.EncodeToString(h.Sum(nil)),
		fmt.Sprintf("%d entrees · %d extraites (%.1f Mo) · %d blobs",
			nEntrees, nExtraits, float64(octets)/(1<<20), nBlobs)
}

// hacheEntree verse dans l'empreinte tous les champs indexes d'une entree.
func hacheEntree(h interface{ Write([]byte) (int, error) }, f himodule.File) {
	var buf [8]byte
	ecrit := func(v uint64) {
		binary.LittleEndian.PutUint64(buf[:], v)
		h.Write(buf[:])
	}
	h.Write([]byte(f.Group))
	ecrit(uint64(f.Index))
	ecrit(uint64(f.FirstBlock))
	ecrit(uint64(f.BlockCount))
	ecrit(uint64(f.DataOffset))
	ecrit(uint64(f.Flags))
	ecrit(uint64(f.CompSize))
	ecrit(uint64(f.UncompSize))
	ecrit(uint64(f.GlobalID))
}
