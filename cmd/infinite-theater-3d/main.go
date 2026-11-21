// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bufio"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"runtime/debug"
)

const usage = `usage: installation-08 <command> [flags]

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
  recode-all [--data <dir>]
  serve [--addr <host:port>] [--web <dir>] [--data <dir>]
  build-mesh --map <key> [--game <root>] --out <file.glb>
  build-variant --map <key> --mvar <file.mvar> [--game <root>] --out <file.glb>
  build-weapon --weapon <hex-id> --map <key> [--game <root>] --out <file.glb>
  build-weapons --map <key> [--game <root>] [--data <dir>]
  build-sounds [--lang en|fr] [--game <root>] [--data <dir>]
  build-spartan --map <key> [--game <root>] --out <file.glb>
  build-piece --region <hex-id> --permutation <hex-id> --map <key> [--game <root>] [--ekur <dir>] --out <file.glb>
  build-firstperson --weapon <hex-id> --map <key> [--game <root>] [--no-arms] [--ekur <dir>] --out <file.glb>
  build-firstperson-library [--game <root>] [--data <dir>] [--map <key>]
  build-icons [--data <dir>] [--game <root>]
  setup-coatings [--data <dir>] [--game <root>]`

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
	"recode-all":                runRecodeAll,
	"serve":                     runServe,
	"build-mesh":                runBuildMesh,
	"build-variant":             runBuildVariant,
	"build-weapon":              runBuildWeapon,
	"build-weapons":             runBuildWeapons,
	"build-sounds":              runBuildSounds,
	"build-spartan":             runBuildSpartan,
	"build-piece":               runBuildPiece,
	"build-firstperson":         runBuildFirstPerson,
	"build-firstperson-library": runBuildFirstPersonLibrary,
	"build-icons":               runBuildIcons,
	"setup-coatings":            runSetupCoatings,
	"window":                    runWindow,      // hidden developer command: the app window on a URL, no server
	"build-replay":              runBuildReplay, // hidden: the decode child a fetch starts (decodechild.go)
}

func run(args []string) error {
	// No arguments is the packaged double-click form: serve with the default address
	// and open the browser once the server is listening.
	if len(args) == 0 {
		return runServe([]string{"--open"})
	}
	if len(args) == 1 && args[0] == "version" {
		fmt.Println(Version)
		return nil
	}
	command, ok := commands[args[0]]
	if !ok {
		return errors.New(usage)
	}
	return command(args[1:])
}

func main() {
	// Before anything prints: a console-subsystem build (the development one) already has
	// its console; a GUI-subsystem build launched from a terminal takes the terminal's
	// over, and on a double-click (no parent console) the output goes to the server log
	// file beside the data instead.
	//
	// A decode child (decodechild.go) does neither: its streams are its parent's pipes, which
	// read its output and its exit. Its log lines keep the server log's format.
	hasConsole := false
	if os.Getenv(decodeChildEnv) != "" {
		slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	} else if hasConsole = attachConsole(); !hasConsole {
		if dataDir, err := dataDirFor(""); err == nil {
			if f, logErr := openServerLog(dataDir); logErr == nil {
				os.Stdout = f
				os.Stderr = f
				slog.SetDefault(slog.New(slog.NewTextHandler(f, nil)))
				// The runtime writes a panic to the process's standard error handle, which a
				// double-click launch does not have: point it at the log so a crash names itself.
				_ = debug.SetCrashOutput(f, debug.CrashOptions{})
			}
		}
	}
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if len(os.Args) == 1 && hasConsole {
			// A double-click launch owns its console window, which closes as soon as the
			// process exits: keep the reason on screen until the user has read it. With no
			// console input (redirected or closed) the read returns at once.
			fmt.Fprintln(os.Stderr, "\nPress Enter to close this window.")
			_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
		}
		os.Exit(1)
	}
}
