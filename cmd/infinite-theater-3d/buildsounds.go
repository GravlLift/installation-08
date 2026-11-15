package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
	"github.com/llampwall/infinite-theater-3d/internal/reloadsounds"
	"github.com/llampwall/infinite-theater-3d/internal/uisounds"
)

// announcerLanguages maps the viewer's language codes to the game's sound language folders.
var announcerLanguages = map[string]string{"en": "English(US)", "fr": "French(France)"}

// runBuildSounds extracts the multiplayer announcer's voice lines, the weapons' reload sounds and
// the interface sounds (the pre-game countdown tick) and the maps' ambient beds from the installed
// game into the replay sound folder (<data>/assets/sounds/halo_infinite), with the announcer.json,
// reloads.json, ui.json and ambience.json manifests the server and the viewer read. The game stores them as
// Wwise Vorbis, which is repacked into the Ogg Vorbis files the viewer plays without decoding
// (internal/wwvorbis): no other program runs.
func runBuildSounds(args []string) error {
	fs := flag.NewFlagSet("build-sounds", flag.ContinueOnError)
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (Steam, Xbox)")
	dataDir := fs.String("data", "", dataDirHelp)
	lang := fs.String("lang", "en", "announcer language: en or fr (falls back to en when the game has no fr announcer)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*dataDir)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	res, folder, err := buildAnnouncerSounds(context.Background(), *gameRoot, dir, *lang)
	if err != nil {
		return err
	}
	fmt.Printf("announcer (%s) built into %s: %d lines, %d files, %d bytes; %d names not in the game; %d old take files removed\n",
		filepath.Base(folder), soundsDir(dir), len(res.Manifest.Lines), res.Files, res.Bytes, len(res.Missing), res.Removed)
	reloads, err := buildReloadSounds(context.Background(), *gameRoot, dir)
	if err != nil {
		return err
	}
	fmt.Printf("reloads built into %s: %d weapons, %d files, %d bytes; %d old take files removed\n",
		soundsDir(dir), len(reloads.Manifest.Weapons), reloads.Files, reloads.Bytes, reloads.Removed)
	ui, err := buildUISounds(context.Background(), *gameRoot, dir)
	if err != nil {
		return err
	}
	fmt.Printf("interface sounds built into %s: %d files, %d bytes; missing %v\n", soundsDir(dir), ui.Files, ui.Bytes, ui.Missing)
	beds, err := buildAmbienceSounds(context.Background(), *gameRoot, dir)
	if err != nil {
		return err
	}
	fmt.Printf("ambience built into %s: %d maps, %d files, %d bytes; %d old take files removed; skipped %v\n",
		soundsDir(dir), len(beds.Manifest.Maps), beds.Files, beds.Bytes, beds.Removed, beds.Skipped)
	return nil
}

// buildUISounds is the interface sound extraction both build-sounds and the server's sound job
// run: the sounds the viewer plays outside the replay track (the pre-game countdown tick).
func buildUISounds(ctx context.Context, gameRoot, dataDir string) (*uisounds.Result, error) {
	root, err := deployRootFor(gameRoot)
	if err != nil {
		return nil, err
	}
	res, err := uisounds.Build(ctx, uisounds.Options{DeployRoot: root, OutDir: soundsDir(dataDir)})
	if err != nil {
		return nil, fmt.Errorf("build-sounds: %w", err)
	}
	return res, nil
}

// buildAmbienceSounds is the ambience extraction both build-sounds and the server's sound job
// run: every multiplayer map's main ambient bed, into the data directory's sound folder.
func buildAmbienceSounds(ctx context.Context, gameRoot, dataDir string) (*ambience.Result, error) {
	root, err := deployRootFor(gameRoot)
	if err != nil {
		return nil, err
	}
	res, err := ambience.Build(ctx, ambience.Options{GameRoot: root, OutDir: soundsDir(dataDir)})
	if err != nil {
		return nil, fmt.Errorf("build-sounds: %w", err)
	}
	return res, nil
}

// buildReloadSounds is the reload extraction both build-sounds and the server's sound job run:
// every weapon's third-person reload sounds, into the data directory's sound folder.
func buildReloadSounds(ctx context.Context, gameRoot, dataDir string) (*reloadsounds.Result, error) {
	root, module, err := firstperson.ResolveModule(ctx, firstperson.Options{GameRoot: gameRoot})
	if err != nil {
		return nil, fmt.Errorf("build-sounds: %w", err)
	}
	res, err := reloadsounds.Build(ctx, reloadsounds.Options{GameRoot: root, Module: module, OutDir: soundsDir(dataDir)})
	if err != nil {
		return nil, fmt.Errorf("build-sounds: %w", err)
	}
	return res, nil
}

// buildAnnouncerSounds is the announcer extraction both build-sounds and the server's announcer
// job run: it resolves the game's announcer folder for lang, and extracts every line the viewer
// calls into the data directory's sound folder. It returns the game folder read.
func buildAnnouncerSounds(ctx context.Context, gameRoot, dataDir, lang string) (*announcer.ExtractResult, string, error) {
	root, err := deployRootFor(gameRoot)
	if err != nil {
		return nil, "", err
	}
	code, folder, err := announcerFolder(root, lang)
	if err != nil {
		return nil, "", err
	}
	catalog, err := announcer.Discover(ctx, root, folder)
	if err != nil {
		return nil, "", fmt.Errorf("build-sounds: %w", err)
	}
	res, err := announcer.Extract(ctx, catalog, announcer.ExtractOptions{
		Names: announcer.CallNames(build.MedalNames()), OutDir: soundsDir(dataDir),
		Language: code, GameLanguage: filepath.Base(folder),
	})
	if err != nil {
		return nil, "", fmt.Errorf("build-sounds: %w", err)
	}
	return res, folder, nil
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
		slog.Info("the game install has no announcer in this language; using English", "language", name, "folder", folder)
		return announcerFolder(deployRoot, "en")
	}
	return lang, folder, nil
}
