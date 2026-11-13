// Package himap — animations_noms.go : le nom en clair des etiquettes de l'arbre des modes d'un
// graphe d'animation (modes, classes et types d'arme, jeux, actions).
//
// Comme les noms d'os (noms_os.go), une etiquette n'est que le murmur3 de son texte
// (`mapvar.LabelHash`) ; le texte se retrouve en hachant un vocabulaire. Un mot n'est retenu que
// si son hachage est celui du tag, jamais devine ; une etiquette hors vocabulaire garde la forme
// `#<StringID>`. Le nom d'une animation est le hachage de `mode:classe:action` (niveaux `any`
// omis) : un chemin dont le joint retombe sur le nom de son animation confirme ses etiquettes.
//
// Vocabulaire : mots simples des graphes de Halo ; locomotion `locomote_<allure>_<direction>`
// (allure walk / run / walkslow, direction en huit secteurs ou sur place) ; places de vehicule
// `<vehicule>[_b]_<place>[_<cote>]` ; mots du texte du jeu dont le hachage est une etiquette (types
// d'arme, modes de menu).
package himap

import (
	"fmt"
	"sync"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// Vocabulaire des etiquettes.
var (
	etiquettesSimples = []string{
		"any", "none", "default", "combat", "crouch", "sprint", "stand", "stance", "patrol", "alert",
		"flee", "panic", "climb", "airborne", "jump", "slide", "clamber", "vehicle", "seat", "driver",
		"passenger", "gunner", "rifle", "pistol", "missile", "hammer", "sword", "ball", "turret",
		"unarmed", "flag", "bomb", "grenade", "support", "melee", "idle", "locomote", "enter", "exit",
		"board", "ejection", "throw_grenade", "turn_left", "turn_right", "turn_left_slow",
		"turn_left_fast", "turn_right_slow", "turn_right_fast", "clamber_enter", "clamber_exit",
		"h_kill", "land_hard", "land_soft", "land", "fire_1", "fire_2", "reload_1", "reload_2",
		"melee_strike_1", "melee_strike_2", "put_away", "ready", "first_ready", "taunt", "posing",
		"jump_forward", "jump_backward", "jump_left", "jump_right", "jump_start", "jump_up",
		"airborne_up", "airborne_down", "airborne_forward", "fall", "falling", "thrust", "evade",
		"evade_left", "evade_right", "dive_front", "dive_back", "dive_left", "dive_right",
		"slide_enter", "slide_exit", "sprint_enter", "sprint_exit", "crouch_enter", "crouch_exit",
		"stand_enter", "stand_exit", "aim_still", "aim_move", "look", "pain", "death", "dead",
		// actions et classes dont le StringID porte le texte dans la table des chaines d'Ekur
		"neutral", "airborne_arc", "clamber_arc", "turn_left_composite", "turn_right_composite",
		"idle_reset", "bind_pose", "action_sack", "enter_a", "exit_a", "ejection_a", "exit_and_detach",
		"enter_b", "exit_b", "gas_can", "i_see_you", "clamber_exit_front", "clamber_exit_left",
		"clamber_exit_right", "airborne_dead", "airborne_dead_back", "landing_dead", "landing_dead_back",
		"front", "back", "left", "right", "flag_idle", "flag_relaxed", "sword_ready", "drop_shield_enter",
		"drop_shield_exit", "aim_turn_up", "heropose", "unarmed_combat",
		// actions confirmees par le hachage de `mode:classe[:type]:action` sur plusieurs classes
		"dodge_front", "dodge_back", "dodge_left", "dodge_right", "dodge_front_fast", "dodge_back_fast",
		"dodge_left_fast", "dodge_right_fast", "melee_lunge", "aim_still_up", "aim_still_down",
		"aim_move_front_up", "grapple_deploy", "charged_overlay", "fire_overlay", "vent_enter", "vent_exit",
		"vent_loop", "intro_emote",
		// types d'arme du champ d'animation des `weap` (EtiquettesAnimationArme), confirmes par le hachage
		// de `combat:<classe>:<type>:reload_1` ou `fire_1`
		"ar", "br", "comri", "comsh", "bandit", "mang", "cindr", "arc", "skwr", "spnker", "eb", "gh",
		// mots du texte du jeu
		"carter", "chuckle", "coatings", "common", "ctf", "customization", "emile", "epic", "fc",
		"firewall", "gc", "gs", "halo5", "hcs", "hw", "insert", "jorge", "jun", "kat", "legendary",
		"lobby", "menu", "mlrs", "mp", "mutilator", "ne", "olympus", "pc", "pgt", "player1", "player2",
		"player3", "player4", "pp", "precision", "pv", "rare", "reach", "reaction", "rosenda",
		"samurai", "sb", "seed", "six", "skewered", "spi", "sr", "stalker", "strk", "trophy", "va", "ww",
	}
	verbesLocomotion     = []string{"move", "walk", "run", "jog", "strafe", "sprint", "locomote"}
	directionsLocomotion = []string{"front", "back", "left", "right", "front_left", "front_right",
		"back_left", "back_right", "forward", "backward"}
	alluresLocomotion = []string{"", "_slow", "_fast", "_walk", "_run", "_jog", "_sprint"}

	alluresLocomote     = []string{"walk", "run", "walkslow"}
	directionsLocomote  = []string{"front", "back", "left", "right", "frontleft", "frontright", "backleft", "backright", "inplace"}
	vehiculesPlaces     = []string{"warthog", "mongoose", "ghost", "banshee", "falcon", "scorpion", "wraith", "shade", "chopper"}
	placesVehicule      = []string{"d", "p", "g", "b"}
	cotesPlaceVehicule  = []string{"", "_l", "_r", "_b"}
	prefixesPlaceArrive = []string{"_", "_b_"}
)

var (
	etiquettesUneFois sync.Once
	etiquettes        map[uint32]string
)

// NomAnimation rend le StringID d'un nom d'animation du jeu (`mode:classe[:type]:action`, niveaux
// `any` omis) : le hachage de son texte, comme pour une etiquette.
func NomAnimation(texte string) uint32 { return uint32(mapvar.LabelHash(texte)) }

// NomEtiquette rend le nom en clair d'une etiquette, ou `#<StringID>` hors vocabulaire.
func NomEtiquette(id uint32) string {
	etiquettesUneFois.Do(func() { etiquettes = vocabulaireEtiquettes() })
	if n, ok := etiquettes[id]; ok {
		return n
	}
	return fmt.Sprintf("#%08x", id)
}

// vocabulaireEtiquettes hache chaque mot du vocabulaire.
func vocabulaireEtiquettes() map[uint32]string {
	out := map[uint32]string{}
	ajoute := func(m string) { out[uint32(mapvar.LabelHash(m))] = m }
	for _, m := range etiquettesSimples {
		ajoute(m)
	}
	for _, v := range verbesLocomotion {
		for _, d := range directionsLocomotion {
			for _, a := range alluresLocomotion {
				ajoute(v + "_" + d + a)
			}
		}
	}
	for _, a := range alluresLocomote {
		for _, d := range directionsLocomote {
			ajoute("locomote_" + a + "_" + d)
		}
	}
	for _, v := range vehiculesPlaces {
		for _, p := range prefixesPlaceArrive {
			for _, pl := range placesVehicule {
				for _, c := range cotesPlaceVehicule {
					ajoute(v + p + pl + c)
				}
			}
		}
	}
	return out
}
