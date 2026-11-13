package filmcache

// source_from_file.go — [NewSource] et [ParseManifest] : une Source construite depuis un
// fichier de manifeste dont le chemin EST donne par l'appelant (pas la disposition cache
// racine/short8). C'est la porte des outils hors cache (le decodeur autonome du port
// infinite-theater-3d) qui recoivent `--manifest <fichier>` : [Open] et [OpenChunkDir]
// reconstituent le chemin depuis la disposition du cache, et une paire (racine, short8)
// inventee pour un chemin arbitraire etait exactement la copie de disposition que les
// garde-rails du paquet interdisent. Le format lu est le MEME manifestJSON de [Open] :
// une seule forme de manifeste, deux entrees de lecture.

import (
	"encoding/json"
	"fmt"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// ParseManifest rend les entrees d'un fichier de manifeste (format [Open]) sans ouvrir de
// chemin de cache. Une structure inattendue est une erreur, pas un manifeste vide : un
// manifeste present mais illisible n'est pas le meme fait qu'un film absent du cache.
func ParseManifest(raw []byte) ([]types.ChunkMeta, error) {
	var mf manifestJSON
	if err := json.Unmarshal(raw, &mf); err != nil {
		return nil, fmt.Errorf("manifeste de film invalide : %w", err)
	}
	out := make([]types.ChunkMeta, 0, len(mf.Chunks))
	for _, c := range mf.Chunks {
		out = append(out, types.ChunkMeta{Index: c.Index, ChunkType: c.ChunkType, StartMS: c.StartMS})
	}
	return out, nil
}

// NewSource construit une [Source] dont les chunks se lisent dans `chunkDir` (l'index des
// entrees vient de `chunks` : `Meta()[i]` decrit le chunk d'indice `i`, et porte son numero
// de fichier dans [types.ChunkMeta.Index], comme pour une source de cache). La validation
// par taille n'est pas applicable : un manifeste lu par chemin arbitraire ne declare pas de
// `size_bytes` ici, et [Chunk] lit donc sans controle de troncature.
func NewSource(chunks []types.ChunkMeta, chunkDir string) *Source {
	return &Source{root: chunkDir, short: "", chunks: chunks, tailles: nil, direct: chunkDir}
}
