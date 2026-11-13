package main

import (
	"errors"
	"fmt"
	"os"
)

const usage = `usage: infinite-theater-3d <command> [flags]

  login [--client-id <id>] [--data <dir>]
  logout [--data <dir>]
  matches [--count N] [--data <dir>]
  fetch --match <id> [--data <dir>]
  version
  decode-info <chunk-dir>
  decode --chunks <dir> --map <name> --out <doc.json> [--manifest <file>] [--stats <file>] [--catalog <file>]
  import --chunks <dir> --map <name> [--manifest <file>] [--stats <file>] [--mvar <file>] [--match <id>] [--catalog <file>] [--data <dir>]
  import-sounds --from <dir> [--data <dir>]
  rebuild <match-id> [--data <dir>]
  serve [--addr <host:port>] [--web <dir>] [--data <dir>]
  build-mesh --map <key> [--game <root>] --out <file.glb>
  build-variant --map <key> --mvar <file.mvar> [--game <root>] --out <file.glb>
  build-weapon --weapon <hex-id> --map <key> [--game <root>] --out <file.glb>
  build-weapons --map <key> [--game <root>] [--data <dir>]
  build-spartan --map <key> [--game <root>] --out <file.glb>
  build-piece --region <hex-id> --permutation <hex-id> --map <key> [--game <root>] [--ekur <dir>] --out <file.glb>
  build-firstperson --weapon <hex-id> --map <key> [--game <root>] [--no-arms] [--ekur <dir>] --out <file.glb>
  build-firstperson-library [--game <root>] [--data <dir>] [--map <key>]
  build-icons [--data <dir>] [--game <root>]`

// commands maps each subcommand to its entry point; every entry takes the arguments that
// follow the subcommand name.
var commands = map[string]func([]string) error{
	"login":                     runLogin,
	"logout":                    runLogout,
	"matches":                   runMatches,
	"fetch":                     runFetch,
	"decode-info":               runDecodeInfo,
	"decode":                    runDecode,
	"import":                    runImport,
	"import-sounds":             runImportSounds,
	"rebuild":                   runRebuild,
	"serve":                     runServe,
	"build-mesh":                runBuildMesh,
	"build-variant":             runBuildVariant,
	"build-weapon":              runBuildWeapon,
	"build-weapons":             runBuildWeapons,
	"build-spartan":             runBuildSpartan,
	"build-piece":               runBuildPiece,
	"build-firstperson":         runBuildFirstPerson,
	"build-firstperson-library": runBuildFirstPersonLibrary,
	"build-icons":               runBuildIcons,
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New(usage)
	}
	if len(args) == 1 && args[0] == "version" {
		fmt.Println("infinite-theater-3d: early skeleton")
		return nil
	}
	command, ok := commands[args[0]]
	if !ok {
		return errors.New(usage)
	}
	return command(args[1:])
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
