package main

import (
	"encoding/binary"
	"fmt"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

// runDecodeInfo prints the match information chunk_00 carries (map identity and build)
// from a folder of film chunks.
func runDecodeInfo(args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("usage: installation-08 decode-info <chunk-dir>")
	}
	film, err := decfilm.LoadDir(args[0], nil)
	if err != nil {
		return err
	}
	if len(film.Meta()) == 0 || film.Meta()[0].Index != 0 {
		return fmt.Errorf("chunk_00.bin is missing")
	}
	chunk := film.Chunk(0)
	info, err := decfilm.ReadMatchInfo(chunk)
	if err != nil {
		return err
	}
	guid := func(p *[16]byte) string {
		if p == nil {
			return "unknown"
		}
		return fmt.Sprintf("%08x-%04x-%04x-%x-%x", binary.LittleEndian.Uint32(p[:4]), binary.LittleEndian.Uint16(p[4:6]), binary.LittleEndian.Uint16(p[6:8]), p[8:10], p[10:])
	}
	name := "unknown"
	if info.Nom != nil {
		name = *info.Nom
	}
	build := replay.CleDeChunk0(chunk).Build
	if build == "" {
		build = "unknown"
	}
	fmt.Printf("Map asset ID: %s\nMap version ID: %s\nGame variant: %s\nBuild: %s\n", guid((*[16]byte)(info.CarteAssetID)), guid((*[16]byte)(info.CarteVersionID)), name, build)
	return nil
}
