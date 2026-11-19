// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

// poses.go lists the Spartan's pose clips — intro emotes, Spartan ID stances and menu/lobby
// idles — from the Spartan's animation graphs, and writes any one of them as a small GLB the
// viewer can load and play on its Spartans (the body GLB carries only gameplay clips).
//
// The classification is a port of The Library's internal/viewer/server_armor_poses.go, on the
// readable Chemin() words instead of the level hashes (a word outside the vocabulary comes out
// as its "#xxxxxxxx" hash, and keeps its hex digits in the Pose.ID).

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"sync"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// The Pose.Kind values.
const (
	PoseKindIdle   = "idle"
	PoseKindStance = "stance"
	PoseKindEmote  = "emote"
)

// Pose is one pose clip of the Spartan's animation graphs.
type Pose struct {
	// ID: URL-safe and stable: the path's words joined by ":", lowercased, with every character
	// outside [a-z0-9_:-] dropped (a hash word keeps its hex digits); duplicate IDs get a -2,
	// -3 suffix in list order.
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Path   string `json:"path"` // the mode-tree path that designates the clip (Chemin()).
	Frames int    `json:"frames"`
	FPS    int    `json:"fps"`
}

// Mode-tree level words that select the poses.
const (
	wordMenu          = "menu"
	wordStance        = "stance"
	wordCustomization = "customization"
	wordIdle          = "idle"
	wordLobby         = "lobby"
	wordMP            = "mp"
	wordIntroEmote    = "intro_emote"
	wordAny           = "any"
)

// poseClass is the place a clip path gives a clip in the list.
type poseClass int

const (
	poseNone poseClass = iota
	poseCustomizationIdle
	poseLobbyIdle
	poseAnyIdle
	poseStance
	poseEmote
)

// classifyPosePath answers the place of one five-level path (mode, weapon class, weapon type,
// set, action), in readable words: `menu/stance/...` is a stance, `mp/intro_emote/...` an
// emote, and the three idles are `menu/customization/any/any/idle`, `lobby/.../idle` and
// `any/any/any/any/idle`. Everything else is not a pose.
func classifyPosePath(p [himap.NiveauxModes]string) poseClass {
	action := p[himap.NiveauxModes-1]
	switch {
	case p[0] == wordMenu && p[1] == wordStance:
		return poseStance
	case p[0] == wordMP && p[1] == wordIntroEmote:
		return poseEmote
	case action != wordIdle:
		return poseNone
	case p[0] == wordMenu && p[1] == wordCustomization && p[2] == wordAny && p[3] == wordAny:
		return poseCustomizationIdle
	case p[0] == wordLobby:
		return poseLobbyIdle
	case p[0] == wordAny && p[1] == wordAny && p[2] == wordAny && p[3] == wordAny:
		return poseAnyIdle
	}
	return poseNone
}

// poseName is the pose's display name: emotes, the action word with underscores as spaces;
// stances, `<set> <rarity> <action>` likewise; idles, the non-`any` words joined by spaces,
// the action word last.
func poseName(cls poseClass, p [himap.NiveauxModes]string) string {
	action := poseSpaceWord(p[himap.NiveauxModes-1])
	switch cls {
	case poseEmote:
		return action
	case poseStance:
		return strings.Join([]string{poseSpaceWord(p[2]), poseSpaceWord(p[3]), action}, " ")
	}
	var words []string
	for _, w := range p[:himap.NiveauxModes-1] {
		if w != wordAny {
			words = append(words, w)
		}
	}
	return strings.Join(append(words, action), " ")
}

func poseSpaceWord(w string) string { return strings.ReplaceAll(w, "_", " ") }

// poseWords is the level vocabulary The Library recovered by hashing a candidate list and
// matching the hashes against the graphs' level StringIDs (infinite-library's labels.go: the
// actions and classes of the Ekur string table, weapon types, words of the game's text, the
// intro emote actions and the Spartan ID stance sets and actions). Ported here; a word is
// used only when its hash (himap.NomAnimation) is the level's StringID, never guessed, and a
// level outside the list keeps the "#<StringID>" form.
var poseWords = []string{
	"neutral", "airborne_arc", "clamber_arc", "turn_left_composite", "turn_right_composite",
	"idle_reset", "bind_pose", "action_sack", "enter_a", "exit_a", "ejection_a", "exit_and_detach",
	"enter_b", "exit_b", "gas_can", "i_see_you", "clamber_exit_front", "clamber_exit_left",
	"clamber_exit_right", "airborne_dead", "airborne_dead_back", "landing_dead", "landing_dead_back",
	"front", "back", "left", "right", "flag_idle", "flag_relaxed", "sword_ready", "drop_shield_enter",
	"drop_shield_exit", "aim_turn_up", "heropose", "unarmed_combat",
	"dodge_front", "dodge_back", "dodge_left", "dodge_right", "dodge_front_fast", "dodge_back_fast",
	"dodge_left_fast", "dodge_right_fast", "melee_lunge", "aim_still_up", "aim_still_down",
	"aim_move_front_up", "grapple_deploy", "charged_overlay", "fire_overlay", "vent_enter", "vent_exit",
	"vent_loop", "intro_emote",
	"ar", "br", "comri", "comsh", "bandit", "mang", "cindr", "arc", "skwr", "spnker", "eb", "gh",
	"carter", "chuckle", "coatings", "common", "ctf", "customization", "emile", "epic", "fc",
	"firewall", "gc", "gs", "halo5", "hcs", "hw", "insert", "jorge", "jun", "kat", "legendary",
	"lobby", "menu", "mlrs", "mp", "mutilator", "ne", "olympus", "pc", "pgt", "player1", "player2",
	"player3", "player4", "pp", "precision", "pv", "rare", "reach", "reaction", "rosenda",
	"samurai", "sb", "seed", "six", "skewered", "spi", "sr", "stalker", "strk", "trophy", "va", "ww",
	"shadowboxing", "shadowboxing_ready", "shadowboxing_idle", "shadowboxing_waiting",
	"cross_arms", "cross_arms_ready", "cross_arms_idle", "cross_arms_waiting",
	"crack_knuckles", "crack_knuckles_ready", "crack_knuckles_idle", "crack_knuckles_waiting",
	"finger_guns", "finger_guns_ready", "finger_guns_idle", "finger_guns_waiting",
	"head_turn", "head_turn_ready", "head_turn_idle", "head_turn_waiting",
	"crack_neck", "crack_neck_ready", "crack_neck_idle", "crack_neck_waiting",
	"chuckle_ready", "chuckle_idle", "chuckle_waiting",
	"i_see_you_ready", "i_see_you_idle", "i_see_you_waiting",
	"bicep_reload", "bicep_reload_ready", "bicep_reload_idle", "bicep_reload_waiting",
	"comms_rally_up", "comms_rally_up_ready", "comms_rally_up_idle", "comms_rally_up_waiting",
	"haz", "lone_wolves", "117", "iron_eagle", "pop_culture", "sea_of_thieves",
	"ar_alert", "ar_infinite", "ar_relaxed", "ar_shoulder", "athletic_point", "bandit_aggressive",
	"bandit_cyber_anime", "br_celebration", "br_patrol", "br_reload", "br_take_cover", "bulldog_fire",
	"bulldog_point", "commando_rifle_fire", "commando_rifle_relax", "commando_rifle_relaxed",
	"commando_rifle_stoic", "disruptor_double_dollar", "fusion_coil_stoic", "halo4_cover",
	"hammer_shoulder", "hydra_shoulder", "infinite_cover", "legendary_supermodel", "mang_terminated",
	"missile_on_shoulder", "needler_relaxed", "rifle_hero", "sidearm_gunup", "sidearm_ready",
	"sidearm_stalk", "sidekick_bond", "sidekick_splinter", "skull_trophy", "sniper_honor", "sniper_scan",
	"sniper_seven", "spnkr_heroic", "spnkr_idle", "stalker_relaxed", "striker_stealth", "sword_barbarian",
	"sword_bravado", "sword_pirate", "unarmed_crossed_arms", "unarmed_fighter", "unarmed_parade_rest",
	"unarmed_podium", "unarmed_salute", "unarmed_sassypoint", "unarmed_success",
}

var (
	poseWordsOnce sync.Once
	poseWordsByID map[uint32]string
)

// poseWord is the readable word of one level StringID: himap's own vocabulary word, and when
// it comes out as a "#<StringID>" hash, a poseWords word whose hash is the id; the hash form
// is kept only when no word names the level.
func poseWord(id uint32) string {
	if w := himap.NomEtiquette(id); !strings.HasPrefix(w, "#") {
		return w
	}
	poseWordsOnce.Do(func() {
		poseWordsByID = make(map[uint32]string, len(poseWords))
		for _, w := range poseWords {
			poseWordsByID[himap.NomAnimation(w)] = w
		}
	})
	if w, ok := poseWordsByID[id]; ok {
		return w
	}
	return himap.NomEtiquette(id)
}

// entryPathWords is a mode-tree entry's path words, one per level, each through poseWord.
func entryPathWords(e himap.EntreeMode) [himap.NiveauxModes]string {
	var p [himap.NiveauxModes]string
	for i, id := range e.Etiquettes {
		p[i] = poseWord(id)
	}
	return p
}

// poseIDFromPath is the Pose.ID of a Chemin() path: the words joined by ":", each lowercased
// with every character outside [a-z0-9_:-] dropped (a hash word "#ABCD1234" keeps its digits).
func poseIDFromPath(path string) string {
	ids := make([]string, himap.NiveauxModes)
	for i, word := range pathWords(path) {
		var b strings.Builder
		for _, r := range strings.ToLower(word) {
			switch {
			case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == ':', r == '-':
				b.WriteRune(r)
			}
		}
		ids[i] = b.String()
	}
	return strings.Join(ids, ":")
}

// pathWords splits a Chemin() path into its five level words.
func pathWords(path string) [himap.NiveauxModes]string {
	var p [himap.NiveauxModes]string
	for i, w := range strings.Split(path, " / ") {
		if i < himap.NiveauxModes {
			p[i] = w
		}
	}
	return p
}

// poseCandidate is one mode-tree entry that designates a clip, with the deduplication key of
// that clip (source graph ID + rank) and the animation's header (frames, cadence).
type poseCandidate struct {
	key    string
	path   [himap.NiveauxModes]string
	frames int
	fps    int
}

// collectPoses lays the candidates out as the pose list, in The Library's order: idles (the
// first customization idle, every lobby idle by name, the first any idle), then stances by
// set, rarity and name, then emotes by name. A clip reached by several entries is listed once,
// by the first entry that classifies it. IDs are assigned in list order; duplicates get a -2,
// -3 suffix.
func collectPoses(candidates []poseCandidate) []Pose {
	var custom *Pose
	var anyIdle *Pose
	var lobby, stances, emotes []Pose
	seen := map[string]bool{}
	for _, c := range candidates {
		cls := classifyPosePath(c.path)
		if cls == poseNone || seen[c.key] {
			continue
		}
		seen[c.key] = true
		p := Pose{Kind: kindOf(cls), Name: poseName(cls, c.path),
			Path: strings.Join(c.path[:], " / "), Frames: c.frames, FPS: c.fps}
		switch cls {
		case poseCustomizationIdle:
			if custom == nil {
				custom = &p
			}
		case poseLobbyIdle:
			lobby = append(lobby, p)
		case poseAnyIdle:
			if anyIdle == nil {
				anyIdle = &p
			}
		case poseStance:
			stances = append(stances, p)
		case poseEmote:
			emotes = append(emotes, p)
		}
	}
	folded := func(x, y string) int { return strings.Compare(strings.ToLower(x), strings.ToLower(y)) }
	// namedBefore puts a pose whose Name names every level before one whose still carries a
	// hash level, as the Library orders stances and emotes; the stable sort then keeps the
	// unnamed ones in clip order.
	namedBefore := func(a, b Pose) int {
		switch {
		case !strings.Contains(a.Name, "#") && strings.Contains(b.Name, "#"):
			return -1
		case strings.Contains(a.Name, "#") && !strings.Contains(b.Name, "#"):
			return 1
		}
		return 0
	}
	slices.SortStableFunc(lobby, func(a, b Pose) int { return folded(a.Name, b.Name) })
	slices.SortStableFunc(stances, func(a, b Pose) int {
		if d := namedBefore(a, b); d != 0 {
			return d
		}
		aw, bw := pathWords(a.Path), pathWords(b.Path)
		for _, k := range [][2]string{{aw[2], bw[2]}, {aw[3], bw[3]}, {a.Name, b.Name}} {
			if d := folded(k[0], k[1]); d != 0 {
				return d
			}
		}
		return 0
	})
	slices.SortStableFunc(emotes, func(a, b Pose) int {
		if d := namedBefore(a, b); d != 0 {
			return d
		}
		if !strings.Contains(a.Name, "#") {
			return folded(a.Name, b.Name)
		}
		return 0
	})

	out := []Pose{}
	if custom != nil {
		out = append(out, *custom)
	}
	out = append(out, lobby...)
	if anyIdle != nil {
		out = append(out, *anyIdle)
	}
	out = append(out, stances...)
	out = append(out, emotes...)
	counts := map[string]int{}
	for i := range out {
		base := poseIDFromPath(out[i].Path)
		counts[base]++
		if counts[base] > 1 {
			out[i].ID = fmt.Sprintf("%s-%d", base, counts[base])
		} else {
			out[i].ID = base
		}
	}
	return out
}

// kindOf is the Pose.Kind of a poseClass.
func kindOf(cls poseClass) string {
	switch cls {
	case poseStance:
		return PoseKindStance
	case poseEmote:
		return PoseKindEmote
	}
	return PoseKindIdle
}

// ListSpartanPoses lists every pose clip of the Spartan's animation graph chain: each
// mode-tree entry that classifies (classifyPosePath), once per clip (key: source graph ID +
// rank), from a source graph whose skeleton matches the body (nodes; a mismatch is logged
// once per graph). Frames and FPS come from the animation's header, without decoding the
// clip. The order is collectPoses'.
func ListSpartanPoses(ctx context.Context, a *himap.Arsenal, nodes []himap.Noeud) ([]Pose, error) {
	gs, err := a.GraphesDuSpartan(ctx)
	if err != nil {
		return nil, err
	}
	announced := map[uint32]bool{}
	skeletonOK := func(g *himap.GrapheAnimation) bool {
		if g.MemeSquelette(nodes) == nil {
			return true
		}
		if !announced[g.ID] {
			announced[g.ID] = true
			slog.WarnContext(ctx, "spartan pose graph skipped: skeleton does not match the body", "graph", fmt.Sprintf("%08x", g.ID))
		}
		return false
	}
	var candidates []poseCandidate
	for _, g := range gs.Tous() {
		for _, entry := range g.Entrees {
			words := entryPathWords(entry)
			if classifyPosePath(words) == poseNone {
				continue
			}
			source, rank, rerr := gs.Resout(g, entry)
			if rerr != nil {
				slog.WarnContext(ctx, "spartan pose entry does not resolve", "path", strings.Join(words[:], " / "), "err", rerr)
				continue
			}
			if !skeletonOK(source) {
				continue
			}
			anim := source.Animations[rank]
			candidates = append(candidates, poseCandidate{
				key:    fmt.Sprintf("%08x:%d", source.ID, rank),
				path:   words,
				frames: anim.Images,
				fps:    himap.CadenceAnimation(anim),
			})
		}
	}
	return collectPoses(candidates), nil
}

// generatorPose tags name the chain that produced a pose GLB, in its extras.
const generatorPose = "cmd/infinite-theater-3d spartan poses (halo-infinite-map-images, spartan pose)"

// WritePoseGLB writes pose's clip to w as a GLB, through EcritGLBPeauAnime with a single
// ClipGLB (Nom = pose.ID, Chemin = pose.Path, the clip's own cadence). It first tries the
// model's mesh emptied (a shallow copy of m with an empty Maillage, so the file carries only
// the skeleton, skin and animation); when the writer refuses the empty mesh it falls back to
// the full model, and logs which form it wrote.
func WritePoseGLB(ctx context.Context, a *himap.Arsenal, m *himap.ModeleAPeau, pose Pose, w io.Writer) error {
	gs, err := a.GraphesDuSpartan(ctx)
	if err != nil {
		return err
	}
	var clip *himap.ClipAnimation
	for _, g := range gs.Tous() {
		for _, entry := range g.Entrees {
			if entryPathWords(entry) != pathWords(pose.Path) {
				continue
			}
			source, rank, rerr := gs.Resout(g, entry)
			if rerr != nil {
				continue
			}
			clip, rerr = source.Decode(rank)
			if rerr != nil {
				return fmt.Errorf("pose %s: %w", pose.ID, rerr)
			}
			break
		}
		if clip != nil {
			break
		}
	}
	if clip == nil {
		return fmt.Errorf("pose %s: path %s not in the Spartan's mode trees", pose.ID, pose.Path)
	}
	clips := []himap.ClipGLB{{Nom: pose.ID, Clip: clip, Chemin: pose.Path, Cadence: himap.CadenceAnimation(clip.Animation)}}
	extras := map[string]any{"model": "spartan-pose", "pose": pose.ID, axesGLBKey: axesGLB}
	var buf bytes.Buffer
	bare := *m
	bare.Maillage = &himap.MaillageMonde{}
	form := "skeleton-only"
	if err := himap.EcritGLBPeauAnime(&buf, &bare, clips, generatorPose, extras); err != nil || buf.Len() == 0 {
		form = "full mesh"
		buf.Reset()
		if err := himap.EcritGLBPeauAnime(&buf, m, clips, generatorPose, extras); err != nil {
			return err
		}
	}
	slog.InfoContext(ctx, "spartan pose GLB written", "pose", pose.ID, "form", form, "bytes", buf.Len())
	_, err = io.Copy(w, &buf)
	return err
}
