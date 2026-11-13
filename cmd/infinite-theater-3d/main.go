package main

import (
	"encoding/binary"
	"fmt"
	"os"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

const usage = "usage: infinite-theater-3d version | decode-info <chunk-dir> | build-mesh --map <key> [--game <root>] --out <file.glb> | build-variant --map <key> --mvar <file.mvar> [--game <root>] --out <file.glb> | build-weapon --weapon <hex-id> --map <key> [--game <root>] --out <file.glb>"

func run(args []string) error {
	if len(args) == 1 && args[0] == "version" {
		fmt.Println("infinite-theater-3d: early skeleton")
		return nil
	}
	if len(args) >= 1 && args[0] == "build-mesh" {
		return runBuildMesh(args[1:])
	}
	if len(args) >= 1 && args[0] == "build-variant" {
		return runBuildVariant(args[1:])
	}
	if len(args) >= 1 && args[0] == "build-weapon" {
		return runBuildWeapon(args[1:])
	}
	if len(args) != 2 || args[0] != "decode-info" {
		return fmt.Errorf("%s", usage)
	}
	film, err := decfilm.LoadDir(args[1], nil)
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

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
