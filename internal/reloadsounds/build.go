// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package reloadsounds

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/soundtags"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
	"github.com/llampwall/infinite-theater-3d/internal/wwvorbis"
)

// Stances are the animation modes a reload is read in: standing, and crouched (the game has a
// crouched reload per weapon type, a few frames off the standing one).
var Stances = []string{"combat", "crouch"}

// reloadAction is the reload's action name in the Spartan's third-person graph. A weapon type
// whose graph has no such animation (the battery weapons vent instead, the melee weapons have
// none) gets no entry, and the viewer stays silent on its reloads.
const reloadAction = "reload_1"

// The heat weapons' vent actions, in the order the game plays them: enter, a held loop, and exit.
// They live in the same Spartan third-person graph as the reloads; the enter and exit post sound
// events, the loop posts none (measured on the installed game, 2026-11-15).
const (
	ventEnter = "vent_enter"
	ventLoop  = "vent_loop"
	ventExit  = "vent_exit"
)

// Reasons a weapon tag with an animation class gets no reload, counted in Result.Silent.
const (
	SilentNoType      = "no_type"          // the weapon has an animation class but no type
	SilentTypeUnnamed = "type_unnamed"     // its type's text is not in the label vocabulary
	SilentNoAnimation = "no_reload_1"      // the graph has no reload for its type
	SilentNoSounds    = "no_sounds"        // the reload animation posts no readable sound
	SkippedNotRandom  = "event_not_random" // a sound event plays a layer or switch container
	SkippedNotVorbis  = "media_not_vorbis" // a media is not Wwise Vorbis
)

// Options says where the game is and where the takes go.
type Options struct {
	// GameRoot is the deploy root; Module a map module whose index covers the game's globals
	// (firstperson.ResolveModule).
	GameRoot, Module string
	OutDir           string
}

// Result summarizes a build.
type Result struct {
	Manifest *Manifest
	Files    int
	Bytes    int64
	Removed  int
	// Silent lists, by reason, the weapon tags (8 hex digits) left without a reload, and the
	// sound tags skipped.
	Silent map[string][]string
}

// builder holds what one build reads: the Spartan's graphs, the tag index and the media.
type builder struct {
	graphs  *himap.GraphesAnimation
	tags    soundtags.TagSource
	media   *soundtags.Media
	out     string
	parsed  map[uint32]*announcer.Tag
	takes   map[uint32][]Take // by sound tag
	written map[uint32]Take   // by media id: a media two sound tags share is written once
	res     *Result
	// arsenal and ctx read the weapons' first-person graphs (staged); fpTakes caches the takes of
	// a sound tag's first-person event, as takes does its third-person one.
	arsenal *himap.Arsenal
	ctx     context.Context
	fpTakes map[uint32][]Take
}

// Build extracts every weapon's reload sounds into opts.OutDir and writes the manifest there,
// then removes the take files of an earlier build the manifest does not list.
func Build(ctx context.Context, opts Options) (*Result, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	a, err := himap.OuvreArsenal(opts.GameRoot, opts.Module)
	if err != nil {
		return nil, fmt.Errorf("reloadsounds: %w", err)
	}
	defer closeLogged(ctx, "arsenal", a.Close)
	paths, err := himap.GeometrySearchPathMonde(opts.GameRoot, opts.Module)
	if err != nil {
		return nil, fmt.Errorf("reloadsounds: %w", err)
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("reloadsounds: %w", err)
	}
	defer closeLogged(ctx, "module index", ix.Close)
	gs, err := a.GraphesDuSpartan(ctx)
	if err != nil {
		return nil, fmt.Errorf("reloadsounds: %w", err)
	}
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Weapons: map[string]map[string]Reload{}, Vents: map[string]map[string]Vent{}}, Silent: map[string][]string{}}
	b := &builder{graphs: gs, tags: ix, media: soundtags.NewMedia(ix, opts.GameRoot), out: opts.OutDir,
		parsed: map[uint32]*announcer.Tag{}, takes: map[uint32][]Take{}, written: map[uint32]Take{}, res: res,
		arsenal: a, ctx: ctx, fpTakes: map[uint32][]Take{}}
	weapons := ix.EntreesDuGroupe("weap")
	sort.Slice(weapons, func(i, j int) bool { return weapons[i] < weapons[j] })
	for _, id := range weapons {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		labels, err := a.EtiquettesAnimationArme(id, gs)
		if err != nil {
			continue // not a weapon a Spartan holds (vehicle and turret weapons, props)
		}
		if err := b.weapon(id, labels); err != nil {
			return nil, err
		}
	}
	if err := writeManifest(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	if res.Removed, err = removeStaleTakes(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "reload sounds extracted", "weapons", len(res.Manifest.Weapons), "vents", len(res.Manifest.Vents), "files", res.Files, "removed", res.Removed)
	return res, nil
}

// weapon reads one weapon tag's reload in every stance and records it, or the reason it has none.
func (b *builder) weapon(id uint32, labels himap.EtiquettesArme) error {
	key := fmt.Sprintf("%08x", id)
	class, typ := himap.NomEtiquette(labels.Classe), himap.NomEtiquette(labels.Type)
	switch {
	case labels.Type == 0:
		return b.silent(SilentNoType, key)
	case strings.HasPrefix(class, "#") || strings.HasPrefix(typ, "#"):
		return b.silent(SilentTypeUnnamed, key)
	}
	stances := map[string]Reload{}
	animated := false
	for _, stance := range Stances {
		name := stance + ":" + class + ":" + typ + ":" + reloadAction
		g, rang, err := b.graphs.Nommee(name)
		if err != nil {
			return fmt.Errorf("reloadsounds: %w", err)
		}
		if g == nil {
			continue
		}
		animated = true
		r, err := b.reload(g, rang, name)
		if err != nil {
			return fmt.Errorf("reloadsounds: %s: %w", name, err)
		}
		if len(r.Sounds) > 0 {
			stances[stance] = r
		}
	}
	switch {
	case !animated:
		b.silent(SilentNoAnimation, key)
	case len(stances) == 0:
		b.silent(SilentNoSounds, key)
	}
	if len(stances) > 0 {
		// The film plays a weapon's reload whenever it has one, vent clip or not: no vent entry.
		b.res.Manifest.Weapons[key] = stances
		return b.staged(id, key)
	}
	// The heat weapons vent where the others reload: read their vent clips, if they have any.
	vents, err := b.vent(key, class, typ)
	if err != nil {
		return err
	}
	if len(vents) > 0 {
		b.res.Manifest.Vents[key] = vents
	}
	return nil
}

// vent reads one heat weapon's vent clips (enter, loop, exit) in every stance, or none. A clip
// the graph does not carry is left empty; a stance with no vent clip at all gets no entry.
func (b *builder) vent(key, class, typ string) (map[string]Vent, error) {
	vents := map[string]Vent{}
	for _, stance := range Stances {
		v := Vent{}
		any := false
		for _, action := range []struct {
			name string
			clip *VentClip
		}{
			{ventEnter, &v.Enter},
			{ventLoop, &v.Loop},
			{ventExit, &v.Exit},
		} {
			name := stance + ":" + class + ":" + typ + ":" + action.name
			g, rang, err := b.graphs.Nommee(name)
			if err != nil {
				return nil, fmt.Errorf("reloadsounds: %w", err)
			}
			if g == nil {
				continue
			}
			any = true
			r, err := b.reload(g, rang, name)
			if err != nil {
				return nil, fmt.Errorf("reloadsounds: %s: %w", name, err)
			}
			*action.clip = VentClip{Animation: r.Animation, DurationMs: r.DurationMs, Sounds: r.Sounds}
		}
		if any {
			vents[stance] = v
		}
	}
	return vents, nil
}

// silent records a weapon tag left without a reload.
func (b *builder) silent(reason, key string) error {
	b.res.Silent[reason] = append(b.res.Silent[reason], key)
	return nil
}

// reload reads one reload animation: its length and each sound it posts, with the takes.
func (b *builder) reload(g *himap.GrapheAnimation, rang int, name string) (Reload, error) {
	return b.reloadOf(g, rang, name, nil, false)
}

// reloadOf is reload keeping only the sound tags `keep` accepts (nil: all), their takes from the
// first-person event when `firstPerson`.
func (b *builder) reloadOf(g *himap.GrapheAnimation, rang int, name string, keep func(uint32) bool, firstPerson bool) (Reload, error) {
	if rang < 0 || rang >= len(g.Animations) || g.Animations[rang].Rang != rang {
		return Reload{}, fmt.Errorf("animation %d not at its rank in graph %08x", rang, g.ID)
	}
	an := g.Animations[rang]
	fps := himap.CadenceAnimation(an)
	if fps <= 0 {
		return Reload{}, fmt.Errorf("animation rate %d", fps)
	}
	tag, err := b.tag(g.ID)
	if err != nil {
		return Reload{}, err
	}
	posted, err := animationSounds(tag, an.Groupe, an.Membre)
	if err != nil {
		return Reload{}, err
	}
	r := Reload{Animation: name, DurationMs: framesToMs(an.Images, fps)}
	for _, p := range posted {
		var takes []Take
		for _, s := range p.Sounds {
			if keep != nil && !keep(s) {
				continue
			}
			t, err := b.takesOf(s, firstPerson)
			if err != nil {
				return Reload{}, err
			}
			takes = append(takes, t...)
		}
		if len(takes) > 0 {
			r.Sounds = append(r.Sounds, Sound{AtMs: framesToMs(p.Frame, fps), Takes: takes})
		}
	}
	sort.SliceStable(r.Sounds, func(i, j int) bool { return r.Sounds[i].AtMs < r.Sounds[j].AtMs })
	return r, nil
}

// soundTakes returns the takes of a sound tag's third-person event, extracting each media once.
func (b *builder) soundTakes(snd uint32) ([]Take, error) { return b.takesOf(snd, false) }

// takesOf returns the takes of a sound tag's third-person event, or of its first-person one when
// `firstPerson`, extracting each media once.
func (b *builder) takesOf(snd uint32, firstPerson bool) ([]Take, error) {
	cache, eventOf := b.takes, soundtags.Event
	if firstPerson {
		cache, eventOf = b.fpTakes, soundtags.FirstPersonEvent
	}
	if t, ok := cache[snd]; ok {
		return t, nil
	}
	tag, err := b.tag(snd)
	if err != nil {
		return nil, err
	}
	cache[snd] = nil
	event, bankTag, ok := eventOf(tag)
	if !ok {
		return nil, nil
	}
	bk, err := b.media.Bank(bankTag)
	if err != nil {
		return nil, err
	}
	for _, typ := range bk.EventTargetTypes(event) {
		if typ != wwise.HircRandomSeq && typ != wwise.HircSound {
			b.res.Silent[SkippedNotRandom] = append(b.res.Silent[SkippedNotRandom], fmt.Sprintf("%08x", snd))
			return nil, nil
		}
	}
	var takes []Take
	for _, id := range bk.EventMedia(event) {
		t, ok, err := b.extract(bk, id)
		if err != nil {
			return nil, err
		}
		if ok {
			takes = append(takes, t)
		}
	}
	cache[snd] = takes
	return takes, nil
}

// extract writes one media as an Ogg take; false (and recorded) when it is not Wwise Vorbis.
func (b *builder) extract(bk *wwise.Bank, id uint32) (Take, bool, error) {
	if t, ok := b.written[id]; ok {
		return t, true, nil
	}
	raw, err := b.media.Bytes(bk, id)
	if err != nil {
		return Take{}, false, err
	}
	if f, err := wwise.ParseMediaFormat(raw); err != nil || f.Codec != wwise.CodecVorbis {
		b.res.Silent[SkippedNotVorbis] = append(b.res.Silent[SkippedNotVorbis], fmt.Sprintf("%d", id))
		return Take{}, false, nil
	}
	s, err := wwvorbis.Repack(raw)
	if err != nil {
		return Take{}, false, fmt.Errorf("media %d: %w", id, err)
	}
	name := takeName(id)
	if err := os.WriteFile(filepath.Join(b.out, name), s.Ogg, 0o644); err != nil {
		return Take{}, false, err
	}
	b.res.Files++
	b.res.Bytes += int64(len(s.Ogg))
	t := Take{File: name, Media: id, DurationMs: s.DurationMs()}
	b.written[id] = t
	return t, true, nil
}

// tag reads and parses a tag once.
func (b *builder) tag(id uint32) (*announcer.Tag, error) {
	if t, ok := b.parsed[id]; ok {
		return t, nil
	}
	raw, err := b.tags.Extract(id)
	if err != nil {
		return nil, fmt.Errorf("tag %08x: %w", id, err)
	}
	t, err := announcer.ParseTag(raw)
	if err != nil {
		return nil, fmt.Errorf("tag %08x: %w", id, err)
	}
	b.parsed[id] = t
	return t, nil
}

// framesToMs converts an animation frame count at fps frames per second to milliseconds.
func framesToMs(frames, fps int) int {
	return int(math.Round(float64(frames) * 1000 / float64(fps)))
}

// closeLogged closes a resource at the end of a build and logs a failure.
func closeLogged(ctx context.Context, what string, closeFn func() error) {
	if err := closeFn(); err != nil {
		slog.WarnContext(ctx, "reloadsounds: closing "+what, "err", err)
	}
}

// The first-person clips of a staged reload, by their action names in the rig's graph.
const (
	stagedEnter      = "reload_enter"
	stagedRound      = "reload_continue_full"
	stagedRoundEmpty = "reload_continue_empty"
	stagedClosing    = "chamber_1"
	modeAny          = "any"
)

// staged reads the first-person sounds of a weapon whose first-person rig reloads in stages (its
// graph names a reload_enter in mode any): each clip's sounds that no other animation of the graph
// posts (the handling sounds every clip shares are left to the third-person reload), from their
// first-person events. A weapon without a first-person rig or a staged reload gets no entry.
func (b *builder) staged(id uint32, key string) error {
	src, err := b.arsenal.SourcesArme(id)
	if err != nil {
		return nil //nolint:nilerr // a weapon without a first-person block has no first-person reload
	}
	gs, err := b.arsenal.GraphesDepuis(b.ctx, src.Graphe)
	if err != nil {
		return fmt.Errorf("reloadsounds: first-person graph %08x: %w", src.Graphe, err)
	}
	g := gs.Propre
	actions := map[uint32]string{}
	for _, a := range []string{stagedEnter, stagedRound, stagedRoundEmpty, stagedClosing} {
		actions[himap.NomAnimation(a)] = a
	}
	anyMode := himap.NomAnimation(modeAny)
	ranks := map[string]int{}
	reloadRanks := map[int]bool{}
	for _, e := range g.Entrees {
		a, ok := actions[e.Etiquettes[himap.NiveauxModes-1]]
		if !ok || e.Graphe != -1 {
			continue
		}
		reloadRanks[e.Animation] = true
		if _, seen := ranks[a]; !seen && e.Etiquettes[0] == anyMode {
			ranks[a] = e.Animation
		}
	}
	if _, ok := ranks[stagedEnter]; !ok {
		return nil
	}
	tag, err := b.tag(g.ID)
	if err != nil {
		return err
	}
	shared := map[uint32]bool{}
	for _, an := range g.Animations {
		if reloadRanks[an.Rang] {
			continue
		}
		posted, err := animationSounds(tag, an.Groupe, an.Membre)
		if err != nil {
			return fmt.Errorf("reloadsounds: first-person graph %08x animation %d: %w", g.ID, an.Rang, err)
		}
		for _, p := range posted {
			for _, s := range p.Sounds {
				shared[s] = true
			}
		}
	}
	keep := func(s uint32) bool { return !shared[s] }
	var st Staged
	for _, c := range []struct {
		action string
		clip   *VentClip
	}{{stagedEnter, &st.Enter}, {stagedRound, &st.Round}, {stagedRoundEmpty, &st.RoundEmpty}, {stagedClosing, &st.Closing}} {
		rang, ok := ranks[c.action]
		if !ok {
			continue
		}
		r, err := b.reloadOf(g, rang, "first_person:"+c.action, keep, true)
		if err != nil {
			return fmt.Errorf("reloadsounds: %s %s: %w", key, c.action, err)
		}
		*c.clip = VentClip{Animation: r.Animation, DurationMs: r.DurationMs, Sounds: r.Sounds}
	}
	if b.res.Manifest.Staged == nil {
		b.res.Manifest.Staged = map[string]Staged{}
	}
	b.res.Manifest.Staged[key] = st
	return nil
}
