package replay

// LOCAL-CHANGE (infinite-theater-3d) — LE PROJETILE GARDE SES ECHANTILLONS NATIFS.
//
// LA REGLE : la grille du rejeu retient UN point par frame (le film repique a ~60 Hz, la grille
// est a 33 ms), et c est `p`/`z` — la vue que tous les lecteurs existants dessinent. `fullRate`
// porte la MEME trajectoire au debit du film : chaque echantillon lu avant le premier pas
// impossible, a son instant, en colonnes differentielles d entiers (le jumeau projectile de
// `tracks[].fullRate`, schema 118). Ce test tient les deux proprietes : la decimation ne touche
// plus la serie native, et la coupure au pas impossible borne les DEUX series.

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// proj60Hz fabrique une piste de projectile a son debit reel : un point toutes les 16,7 ms
// (l ecart d un record a 60 Hz), positions en unites monde (metres) comme la dequantification.
// `xs` porte les abscisses, `zs` les hauteurs (une longueur chacune).
func proj60Hz(origine uint64, repos bool, xs []float32, zs []float32) types.ProjectileTrack {
	if len(xs) != len(zs) {
		panic("proj60Hz : xs et zs de longueurs differentes")
	}
	pts := make([]types.ProjectileSample, len(xs))
	for i := range xs {
		pts[i] = types.ProjectileSample{
			TimestampUS: origine + uint64(i)*16_700, X: xs[i], Y: 0, Z: zs[i],
		}
	}
	pts[len(pts)-1].AtRest = repos
	return types.ProjectileTrack{Slot: 4096, Gen: 1, Pts: pts}
}

// cumul est la somme cumulee d une colonne differentielle : la lecture que fait le client.
func cumul(col []int32) []int32 {
	out := make([]int32, len(col))
	for i, v := range col {
		if i > 0 {
			out[i] = out[i-1] + v
		} else {
			out[i] = v
		}
	}
	return out
}

// xsMonte120 est une abscisse a 2 m par record (120 m/s, la vitesse des grenades mesurees,
// sous la coupure de 200 m/s) : un vol lisible sur toute la duree.
func xsMonte120(n int) []float32 {
	xs := make([]float32, n)
	for i := range xs {
		xs[i] = float32(i) * 2
	}
	return xs
}

// zsArcMonte est une hauteur qui monte (arc de parabole) : z[i] = 10 + i*0,5, l ecart par
// record restant dans le pas (la hauteur n entre pas dans le plan XY de la coupure).
func zsArcMonte(n int) []float32 {
	zs := make([]float32, n)
	for i := range zs {
		zs[i] = 10 + float32(i)*0.5
	}
	return zs
}

func TestVolGardeSesEchantillonsAuDebitDuFilm(t *testing.T) {
	// Quinze echantillons a ~60 Hz (250 ms) : la grille de 33 ms y retient 8 points (frames 0 a 7),
	// la serie native en garde QUINZE — le point de chaque record, a son instant. La decimation
	// publiee ne doit donc pas toucher la serie native : 8 points sur 15 echantillons.
	const n = 15
	xs := xsMonte120(n)
	zs := zsArcMonte(n)
	tracks := []types.ProjectileTrack{proj60Hz(1_000_000, true, xs, zs)}
	out, _, tronquees := buildProjectiles(tracks, 1_000_000, 33_400, nil, nil)
	if len(out) != 1 {
		t.Fatalf("une trajectoire attendue, obtenu %d", len(out))
	}
	p := out[0]
	// La vue grille : un point par frame. Frames 0..7 (le dernier echantillon tombe a la frame 7,
	// 249,55 ms). Le point de la frame i est le PREMIER echantillon dont (t/33,4) = i.
	if nGrid := len(p.P); nGrid != 8 {
		t.Fatalf("la vue grille retient un point par frame (8), obtenu %d : %+v", nGrid, p.P)
	}
	fr := p.FullRate
	if fr == nil {
		t.Fatal("la serie au debit du film doit etre publiee (projectiles[].fullRate)")
	}
	if n := len(fr.T); n != 15 {
		t.Fatalf("la serie native porte les 15 echantillons lus, obtenu %d", n)
	}
	for _, col := range [][]int32{fr.X, fr.Y, fr.Z} {
		if len(col) != 15 {
			t.Fatalf("les colonnes t/x/y/z ont la meme longueur (15), obtenu %d", len(col))
		}
	}
	// Les instants ABSOLUS, depuis l origine de la grille, en millisecondes (tronquees).
	tAbs := make([]int64, len(fr.T))
	acc := int64(0)
	for i, d := range fr.T {
		acc += int64(d)
		tAbs[i] = acc
	}
	// i*16,7 ms tronque : 0, 16, 33, 50, 66, 83, 100, 116, 133, 150, 167, 183, 200, 217, 233.
	wantT := []int64{0, 16, 33, 50, 66, 83, 100, 116, 133, 150, 167, 183, 200, 217, 233}
	for i, w := range wantT {
		if tAbs[i] != w {
			t.Fatalf("instant %d : %d ms attendu, obtenu %d", i, w, tAbs[i])
		}
	}
	// Chaque sample du film se retrouve a son centieme : les colonnes differentielles se relisent
	// sans perte. x = 2*i u -> centiemes 200*i ; z = 10+0,5*i u -> centiemes 1000+50*i.
	xAbs := cumul(fr.X)
	for i := 0; i < n; i++ {
		want := 200 * int32(i) // x = 2*i u -> 200*i centiemes
		if xAbs[i] != want {
			t.Fatalf("x[%d] : %d attendu, obtenu %d", i, want, xAbs[i])
		}
	}
	zAbs := cumul(fr.Z)
	for i := range n {
		want := int32(1000 + 50*i)
		if zAbs[i] != want {
			t.Fatalf("z[%d] : %d attendu, obtenu %d", i, want, zAbs[i])
		}
	}
	// Le point de la grille reste le PREMIER echantillon de sa frame : frame 0 = echantillon 0
	// (x=0), frame 1 = echantillon 2 (x=4, car t=33,4 ms), frame 2 = echantillon 4 (x=8), etc.
	for i, pt := range p.P {
		// echantillon de debut de la frame i : la grille utilise la division ENTIERE
		// f = int(µs/step), donc la frame i couvre [i*step, (i+1)*step) µs. Le premier
		// echantillon dedans (t_j = j*16700 µs) est j = floor(i*33400/16700) = i*334/167
		// (division entiere).
		j := i * 334 / 167
		wantX := 200 * int32(j) // le premier echantillon de la frame a x = 2*j u -> 200*j centiemes
		if int32(pt[1]*100) != wantX {
			t.Fatalf("p[%d] : x=%d attendu (premier echantillon de la frame %d, j=%d), obtenu %v", i, wantX, i, j, pt)
		}
	}
	if !p.Rest {
		t.Error("le dernier echantillon porte AtRest=true et le vol n est pas coupe : Rest doit valoir true")
	}
	if tronquees != 0 {
		t.Errorf("aucune coupure attendue, obtenu %d", tronquees)
	}
}

func TestVolCoupeCoupeAussiSesEchantillonsNatifs(t *testing.T) {
	// Cinq echantillons lisibles a 1 m par record (60 m/s), puis un saut de 40 u en un record
	// (2400 m/s) : le vol s arrete au cinquieme point, et la serie native s arrete AVEC LUI.
	const n = 10
	xs := make([]float32, n)
	for i := 0; i < 5; i++ {
		xs[i] = float32(i) // 0, 1, 2, 3, 4 — 1 m par record
	}
	// Saut : de x=4 a x=44 en un record = 40 m / 16,7 ms = 2400 m/s, bien au-dela de 200 m/s.
	for i := 5; i < n; i++ {
		xs[i] = 44 + float32(i-5)
	}
	zs := make([]float32, n) // hauteur plate, hors du plan de la coupure
	for i := range zs {
		zs[i] = 10
	}
	pts := make([]types.ProjectileSample, n)
	for i := range xs {
		pts[i] = types.ProjectileSample{TimestampUS: 1_000_000 + uint64(i)*16_700, X: xs[i], Y: 0, Z: zs[i]}
	}
	pts[n-1].AtRest = true
	out, _, tronquees := buildProjectiles([]types.ProjectileTrack{{Slot: 4096, Gen: 1, Pts: pts}}, 1_000_000, 33_400, nil, nil)
	if len(out) != 1 {
		t.Fatalf("une trajectoire attendue, obtenu %d", len(out))
	}
	// La coupure borne la serie native : 5 echantillons attendus (les 5 lisibles avant le saut).
	if nfr := len(out[0].FullRate.T); nfr != 5 {
		t.Fatalf("la coupure borne la serie native : 5 echantillons attendus, obtenu %d", nfr)
	}
	if out[0].Rest {
		t.Error("un vol coupe ne CERTIFIE aucune fin : Rest doit valoir false")
	}
	if tronquees != 1 {
		t.Errorf("la coupure doit etre comptee : 1 attendue, obtenu %d", tronquees)
	}
}
