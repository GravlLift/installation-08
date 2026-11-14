package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/build"
)

// announcerLanguages maps the viewer's language codes to the game's sound language folders.
var announcerLanguages = map[string]string{"en": "English(US)", "fr": "French(France)"}

// runBuildSounds extracts the multiplayer announcer's voice lines from the installed game into
// the replay sound folder (<data>/assets/sounds/halo_infinite), with the announcer.json manifest
// the viewer reads. The game stores the voice as Wwise Vorbis: --decoder names a vgmstream-cli
// executable, and the lines are re-encoded to Ogg Vorbis with ffmpeg (--encoder).
func runBuildSounds(args []string) error {
	fs := flag.NewFlagSet("build-sounds", flag.ContinueOnError)
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (Steam, Xbox)")
	dataDir := fs.String("data", "", dataDirHelp)
	lang := fs.String("lang", "en", "announcer language: en or fr (falls back to en when the game has no fr announcer)")
	decoder := fs.String("decoder", "", "path to vgmstream-cli (required: decodes the game's Wwise Vorbis)")
	encoder := fs.String("encoder", "ffmpeg", "ffmpeg executable with libvorbis (re-encodes to Ogg Vorbis)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *decoder == "" {
		return errors.New("build-sounds: --decoder <path to vgmstream-cli> is required")
	}
	tools, err := soundTools(*decoder, *encoder)
	if err != nil {
		return err
	}
	dir, err := dataDirFor(*dataDir)
	if err != nil {
		return err
	}
	root, err := deployRootFor(*gameRoot)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	code, folder, err := announcerFolder(root, *lang)
	if err != nil {
		return err
	}
	catalog, err := announcer.Discover(ctx, root, folder)
	if err != nil {
		return fmt.Errorf("build-sounds: %w", err)
	}
	res, err := announcer.Extract(ctx, catalog, announcer.ExtractOptions{
		Names: announcer.CallNames(build.MedalNames()), Tools: tools, OutDir: soundsDir(dir),
		Language: code, GameLanguage: filepath.Base(folder),
	})
	if err != nil {
		return fmt.Errorf("build-sounds: %w", err)
	}
	fmt.Printf("announcer (%s) built into %s: %d lines, %d files, %d bytes; %d names not in the game\n",
		filepath.Base(folder), soundsDir(dir), len(res.Manifest.Lines), res.Files, res.Bytes, len(res.Missing))
	return nil
}

// soundTools resolves the two programs extraction runs.
func soundTools(decoder, encoder string) (announcer.Tools, error) {
	if _, err := os.Stat(decoder); err != nil {
		return announcer.Tools{}, fmt.Errorf("build-sounds: decoder: %w", err)
	}
	enc, err := exec.LookPath(encoder)
	if err != nil {
		return announcer.Tools{}, fmt.Errorf("build-sounds: encoder %q not found: %w", encoder, err)
	}
	return announcer.Tools{Decoder: decoder, Encoder: enc}, nil
}

// deployRootFor returns the game's deploy root: the flag, or the detected install.
func deployRootFor(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	root, err := himap.DeployRoot()
	if err != nil {
		return "", fmt.Errorf("build-sounds: game install: %w", err)
	}
	return root, nil
}

// announcerFolder returns the language code and the game's sound folder to read. A language
// whose folder holds no announcer package falls back to English, and says so.
func announcerFolder(deployRoot, lang string) (string, string, error) {
	name, ok := announcerLanguages[lang]
	if !ok {
		return "", "", fmt.Errorf("build-sounds: --lang %q: want en or fr", lang)
	}
	folder := filepath.Join(announcer.SoundRoot(deployRoot), name)
	if lang != "en" && !announcer.HasPackages(folder) {
		fmt.Printf("The game install has no %s announcer (no announcer package in %s); using English.\n", name, folder)
		return announcerFolder(deployRoot, "en")
	}
	return lang, folder, nil
}
