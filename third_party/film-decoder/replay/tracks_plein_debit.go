package replay

// tracks_plein_debit.go — LA VIE AU DEBIT DU FILM : chaque position et chaque visee que le film
// replique pour une vie, a SON instant, a cote des points de la grille de frames.
//
// # POURQUOI A COTE ET PAS A LA PLACE DES POINTS
//
// `Track.Points` garde UN echantillon par frame (le premier observe, cf. `decimateTracks`) : c est
// l axe sur lequel tous les evenements du document sont indexes et que le rejeu 2D interpole. Le
// film, lui, replique la position et la visee a chaque tick serveur (60 ou 30 par seconde selon le
// film), a l instant du paquet. La 3D a besoin de ce debit : une visee interpolee entre deux
// echantillons distants de 100 ms, pris a un decalage inconnu dans leur frame, est en retard et
// fausse des que le joueur tourne. `FullRate` publie donc TOUT ce que la vie porte, sans rien
// reechantillonner : les positions a leurs instants, les visees aux leurs (la visee n arrive pas
// sur chaque record de position).
//
// # L ENCODAGE : DES COLONNES DIFFERENTIELLES D ENTIERS
//
// Un objet par echantillon couterait les noms de champ a chaque ligne, sur des centaines de
// milliers d echantillons. Chaque grandeur est donc une colonne, et chaque colonne est
// DIFFERENTIELLE : sa premiere valeur est absolue, chacune des suivantes est l ecart a la
// precedente. Le lecteur reconstruit par somme cumulee, sans perte : les valeurs sont des
// entiers, aucune erreur ne s accumule.
//
//	t, aimT  instants en MILLISECONDES depuis l ORIGINE DE LA GRILLE, celle de `Point.T` (tronques,
//	         cf. `fullRateTimeUnitUS`) : l image fractionnaire d un echantillon vaut
//	         t / frameIntervalMs, et sa partie entiere est EXACTEMENT l index de frame que la
//	         decimation lui donne (le pas de grille est un multiple de la milliseconde, donc les deux
//	         divisions entieres s emboitent).
//	x, y, z  centiemes d unite monde, entiers : les memes valeurs que `Point.X/Y/Z` (arrondi au
//	         centieme), donc rien de plus fin ni de plus grossier que le contrat existant.
//	h, p     QUANTA BRUTS du composant i21 : cap sur 12 bits (degres = (h + 0,5) * 360 / 4096),
//	         elevation sur 11 bits (degres = (p + 0,5) * 360 / 2048 - 180). C est la precision
//	         reelle du film ; l arrondi au dixieme de degre de `Point.H` fusionne des quanta voisins.
//	         Le cap n est pas replie au tour : un passage 4095 -> 0 s ecrit -4095, et le lecteur
//	         reconstruit le quantum exact.
//	gaps     les INDICES (dans t, x, y, z) des echantillons qu une LACUNE precede : la meme regle
//	         que `Point.G` (silence de replication de plus de `lifeGapUS` DANS une vie). Le lecteur
//	         tient la position jusqu a eux, il n interpole pas au travers.

import (
	"math"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// fullRateTimeUnitUS est l unite de temps des colonnes `t` et `aimT`, en microsecondes.
//
// LA MILLISECONDE : seize fois plus fine que l ecart le plus court entre deux ticks (16,3 ms a
// 60 Hz), et un diviseur du pas de grille, ce qui rend la conversion vers l image fractionnaire
// exacte. Le microseconde du paquet est une horloge murale gigotee autour du tick : ses trois
// derniers chiffres ne servent ni au rendu ni a l analyse, et ils pesaient. Mesure sur 512155b9 :
// 1,86 Mo gzip a 0,1 ms contre 1,64 Mo a 1 ms, pour un document qui en fait 0,83 sans plein debit.
const fullRateTimeUnitUS = 1000

// FullRateTrack porte, pour UNE vie, tous les echantillons que le film replique (cf. l en-tete).
//
// Les colonnes t, x, y, z ont la meme longueur ; aimT, h, p aussi, et sont absentes quand la vie
// ne porte aucune visee repliquee ; stickT, sx, sy aussi (le stick de deplacement de la commande,
// stick_de_deplacement.go), absentes quand la commande de la vie n est pas lue.
type FullRateTrack struct {
	T      []int64 `json:"t"`
	X      []int32 `json:"x"`
	Y      []int32 `json:"y"`
	Z      []int32 `json:"z"`
	Gaps   []int   `json:"gaps,omitempty"`
	AimT   []int64 `json:"aimT,omitempty"`
	H      []int32 `json:"h,omitempty"`
	P      []int32 `json:"p,omitempty"`
	StickT []int64 `json:"stickT,omitempty"`
	SX     []int32 `json:"sx,omitempty"`
	SY     []int32 `json:"sy,omitempty"`
}

// pleinDebit accumule les echantillons d une vie et en tient les derniers absolus, pour ecrire
// les ecarts.
type pleinDebit struct {
	piste       FullRateTrack
	t, aimT     int64
	x, y, z     int32
	h, p        int32
	n, visees   int
	origineGrid uint64
	// vie : l indice, dans les bornes du slot, de la vie que ce plein debit porte.
	vie int
	// seules : les visees sans position que la vie recoit (tracks_visees_seules.go), fusionnees au rendu.
	seules []grammar.BipedAim
}

// ajouter pose un record de position, et sa visee quand il la porte. `lacune` dit que le record
// rouvre la vie apres un silence de replication (cf. `Point.G`).
func (d *pleinDebit) ajouter(p grammar.BipedPosition, lacune bool) {
	t := int64((p.TimestampUS - d.origineGrid) / fullRateTimeUnitUS)
	x, y, z := centiemes(p.X), centiemes(p.Y), centiemes(p.Z)
	if lacune {
		d.piste.Gaps = append(d.piste.Gaps, d.n)
	}
	d.piste.T = append(d.piste.T, t-d.t)
	d.piste.X = append(d.piste.X, x-d.x)
	d.piste.Y = append(d.piste.Y, y-d.y)
	d.piste.Z = append(d.piste.Z, z-d.z)
	d.t, d.x, d.y, d.z = t, x, y, z
	d.n++
	if !p.HasYaw {
		return
	}
	h, pi := int32(p.YawRaw), int32(p.PitchRaw) //nolint:gosec // quanta de 12 et 11 bits
	d.piste.AimT = append(d.piste.AimT, t-d.aimT)
	d.piste.H = append(d.piste.H, h-d.h)
	d.piste.P = append(d.piste.P, pi-d.p)
	d.aimT, d.h, d.p = t, h, pi
	d.visees++
}

// rendre rend la piste au plein debit, nil quand la vie n a recu aucun echantillon.
func (d *pleinDebit) rendre() *FullRateTrack {
	if d == nil || d.n == 0 {
		return nil
	}
	out := d.piste
	if len(d.seules) > 0 {
		out.AimT, out.H, out.P = fusionnerLesVisees(d.piste, d.seules, d.origineGrid)
	}
	return &out
}

// centiemes rend la coordonnee en centiemes d unite monde, entiers : la valeur de `round2`, multipliee.
func centiemes(v float32) int32 {
	return int32(math.Round(float64(v) * coordScale))
}
