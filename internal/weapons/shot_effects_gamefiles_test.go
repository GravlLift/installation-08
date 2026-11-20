// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weapons

// shot_effects_gamefiles_test.go — the Shock Rifle's shot, read from the installed game into the
// library entry the view draws.

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestShockShotEffectsFromGame — the barrel's projectile (5000 u/s, 500 u), its firing effect at
// the weapon's markers, the electric sprite its projectile carries, and the default-material
// impact; a weapon whose projectile is not in scope (the flag) has none.
func TestShockShotEffectsFromGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	module := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	if _, err := os.Stat(module); err != nil {
		t.Skip(err)
	}
	a, err := himap.OuvreArsenal(root, module)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	dir := t.TempDir()
	got, err := readShotEffects(context.Background(), a, root, module, dir, []string{shockKey, "9ee5ff15", flagKey})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got.Weapons[flagKey]; ok {
		t.Error("the flag read as a shot")
	}
	w, ok := got.Weapons[shockKey]
	if !ok {
		t.Fatalf("shock rifle: no shot (%+v)", got.Weapons)
	}
	if w.Projectile != "96555d72" || w.InitialVelocity != 5000 || w.FinalVelocity != 5000 || w.MaxRange != 500 ||
		w.ShotsPerFire != [2]int{3, 3} || w.RoundsPerSecond != [2]float32{60, 60} || w.ProjectilesPerShot != 1 {
		t.Errorf("projectile %+v", w)
	}
	if w.Firing != "136580d8" || len(w.Flight) != 1 || w.Flight[0] != "9f69be2d" || w.Impact != "3b3d55b3" || w.ImpactFrom != "material effects" {
		t.Errorf("effects: firing %s flight %v impact %s (%s)", w.Firing, w.Flight, w.Impact, w.ImpactFrom)
	}
	// primary_trigger has three instances on the third-person model, the others one.
	for m, n := range map[string]int{"ee18be86": 3, "55990be4": 1, "af9ed4c5": 1} {
		if len(w.Markers[m]) != n || len(w.MarkerRotations[m]) != n {
			t.Errorf("firing marker %s = %v", m, w.Markers[m])
		}
	}
	if v := got.Weapons["9ee5ff15"]; v.Projectile != "e9536695" || v.Impact != "3b3d55b3" {
		t.Errorf("9ee5ff15: %+v", v)
	}
	flight := got.Effects["9f69be2d"]
	if len(flight.Systems) != 3 || flight.DeathDelay < 0.0999 || flight.DeathDelay > 0.1001 || flight.CameraRange != [2]float32{1, 120} {
		t.Fatalf("flight effect: %d systems, death delay %v, range %v", len(flight.Systems), flight.DeathDelay, flight.CameraRange)
	}
	// The electric sprite: one particle, parallel to the projectile's direction, its size a jitter.
	s := flight.Systems[0]
	if s.Particle != "0f7addc5" || s.Emitter.Billboard != 2 || s.Location != "b9820a92" || len(s.Emitter.Properties["size"].Periodic) != 1 {
		t.Errorf("flight system 0 = %+v", s)
	}
	if n := len(got.Effects["136580d8"].Systems); n != 11 {
		t.Errorf("firing effect: %d systems", n)
	}
	if n := len(got.Effects["3b3d55b3"].Systems); n != 9 {
		t.Errorf("impact effect: %d systems", n)
	}
	for _, name := range []string{"fx-262e7dba.png", "fx-98bd509b.png", "fx-c775c73f.png"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}
