package himap

import (
	"errors"
	"path/filepath"
	"testing"
)

// TestDeployRootPrendLEnvironnement — la variable prime, et un chemin illisible est une
// ERREUR, pas un repli silencieux sur une autre installation.
func TestDeployRootPrendLEnvironnement(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(DeployRootEnv, dir)
	got, err := DeployRoot()
	if err != nil {
		t.Fatalf("DeployRoot: %v", err)
	}
	if got != dir {
		t.Errorf("DeployRoot = %q, attendu %q", got, dir)
	}

	t.Setenv(DeployRootEnv, filepath.Join(dir, "inexistant"))
	if _, err := DeployRoot(); err == nil {
		t.Error("un chemin declare mais illisible doit echouer, pas retomber sur une autre installation")
	}
}

// TestLevelsDirCompose — la variante s'insere entre la racine et levels/multi.
func TestLevelsDirCompose(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(DeployRootEnv, dir)
	got, err := LevelsDir("pc")
	if err != nil {
		t.Fatalf("LevelsDir: %v", err)
	}
	if want := filepath.Join(dir, "pc", "levels", "multi"); got != want {
		t.Errorf("LevelsDir = %q, attendu %q", got, want)
	}
}

// fauxDisque est le double du disque pour [chercheDeployRoot] : aucun acces reseau ni
// disque reel, seulement les chemins declares.
type fauxDisque struct {
	existants map[string]bool
	fichiers  map[string][]byte
	lecteurs  []string
	env       string
}

// envSimule rend la valeur de la variable d'environnement pour le test.
func (f *fauxDisque) envSimule(nom string) string {
	if nom == DeployRootEnv {
		return f.env
	}
	return ""
}

// existeSimule rend true si le chemin est declare present.
func (f *fauxDisque) existeSimule(chemin string) bool { return f.existants[chemin] }

// lectureSimule rend le contenu declare du fichier, ou une erreur si le fichier est
// declare absent : le contrat du lecteur est « lire ou echouer », jamais « deviner ».
func (f *fauxDisque) lectureSimule(chemin string) ([]byte, error) {
	octets, ok := f.fichiers[chemin]
	if !ok {
		return nil, errors.New("fichier absent")
	}
	return octets, nil
}

// lecteursSimule rend les lecteurs declares.
func (f *fauxDisque) lecteursSimule() []string { return f.lecteurs }

// chercheSimule appelle [chercheDeployRoot] avec les coutes du faux disque.
func (f *fauxDisque) chercheSimule() (string, error) {
	return chercheDeployRoot(f.envSimule, f.existeSimule, f.lectureSimule, f.lecteursSimule)
}

// TestDeployRootBibliothequeSteamVdf — une bibliotheque declaree dans un
// `libraryfolders.vdf` (chemin a antislashs doubles) est trouvee, et son deploiement
// est construit avec les separateurs natifs.
func TestDeployRootBibliothequeSteamVdf(t *testing.T) {
	racineLecteur := `E:\BiblioJeu`
	cheminVdf := filepath.Join(racinesSteamParDefaut[0], vdfRelDepot)
	fichiersVdf := []byte("libraryfolders\n{\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"E:\\\\BiblioJeu\"\n\t}\n}\n")
	faux := &fauxDisque{
		existants: map[string]bool{
			filepath.Join(racineLecteur, deploySuffixSteam): true,
		},
		fichiers: map[string][]byte{cheminVdf: fichiersVdf},
		lecteurs: []string{`C:\`, `E:\`},
	}
	got, err := faux.chercheSimule()
	if err != nil {
		t.Fatalf("chercheDeployRoot: %v", err)
	}
	want := filepath.Join(racineLecteur, deploySuffixSteam)
	if got != want {
		t.Errorf("chercheDeployRoot = %q, attendu %q", got, want)
	}
}

// TestDeployRootBibliothequeSteamVdfMauvaisFormat — un `libraryfolders.vdf` mal forme est
// ignore sans erreur : la recherche continue sur les autres candidats, ou rend
// `ErrNoDeployRoot` si rien d'autre n'existe.
func TestDeployRootBibliothequeSteamVdfMauvaisFormat(t *testing.T) {
	cheminVdf := filepath.Join(racinesSteamParDefaut[0], vdfRelDepot)
	faux := &fauxDisque{
		existants: map[string]bool{},
		fichiers:  map[string][]byte{cheminVdf: []byte("path sans guillemets et mal forme")},
		lecteurs:  []string{`C:\`},
	}
	_, err := faux.chercheSimule()
	if !errors.Is(err, ErrNoDeployRoot) {
		t.Errorf("attendu ErrNoDeployRoot, obtenu %v", err)
	}
}

// TestDeployRootLecteurDepotSteam — un depot Steam sur un lecteur non-defaut (F) est
// trouve par le scan des lecteurs, meme sans `libraryfolders.vdf`.
func TestDeployRootLecteurDepotSteam(t *testing.T) {
	lecteur := `F:\`
	racineLecteur := filepath.Join(lecteur, nomDepotSteam)
	faux := &fauxDisque{
		existants: map[string]bool{
			filepath.Join(racineLecteur, deploySuffixSteam): true,
		},
		fichiers: map[string][]byte{},
		lecteurs: []string{`C:\`, `F:\`},
	}
	got, err := faux.chercheSimule()
	if err != nil {
		t.Fatalf("chercheDeployRoot: %v", err)
	}
	want := filepath.Join(racineLecteur, deploySuffixSteam)
	if got != want {
		t.Errorf("chercheDeployRoot = %q, attendu %q", got, want)
	}
}

// TestDeployRootLecteurXbox — une installation Xbox app sur un lecteur non-defaut (G) est
// trouvee par le scan des lecteurs. Le chemin candidat est `<lecteur>/<deploySuffixXbox>`
// (le `deploySuffixXbox` commence deja par le nom du depot Xbox).
func TestDeployRootLecteurXbox(t *testing.T) {
	lecteur := `G:\`
	faux := &fauxDisque{
		existants: map[string]bool{
			filepath.Join(lecteur, deploySuffixXbox): true,
		},
		fichiers: map[string][]byte{},
		lecteurs: []string{`C:\`, `G:\`},
	}
	got, err := faux.chercheSimule()
	if err != nil {
		t.Fatalf("chercheDeployRoot: %v", err)
	}
	want := filepath.Join(lecteur, deploySuffixXbox)
	if got != want {
		t.Errorf("chercheDeployRoot = %q, attendu %q", got, want)
	}
}

// TestDeployRootRienTrouve — aucun candidat existant rend `ErrNoDeployRoot`, sans erreur
// de lecture meme si aucun `libraryfolders.vdf` n'est declare present.
func TestDeployRootRienTrouve(t *testing.T) {
	faux := &fauxDisque{
		existants: map[string]bool{},
		fichiers:  map[string][]byte{},
		lecteurs:  []string{`C:\`},
	}
	_, err := faux.chercheSimule()
	if !errors.Is(err, ErrNoDeployRoot) {
		t.Errorf("attendu ErrNoDeployRoot, obtenu %v", err)
	}
}

// TestDeployRootOrdreDeRecherche — le `libraryfolders.vdf` prime sur le scan des lecteurs,
// qui prime sur le depot par defaut : le premier dossier EXISTANT gagne, dans l'ordre.
func TestDeployRootOrdreDeRecherche(t *testing.T) {
	racineBiblio := `E:\Biblio`
	cheminVdf := filepath.Join(racinesSteamParDefaut[0], vdfRelDepot)
	fichiersVdf := []byte(`"path"  "E:\\Biblio"`)
	// Les trois candidats existent ; le premier dans l'ordre (bibliothèque vdf) doit gagner.
	faux := &fauxDisque{
		existants: map[string]bool{
			filepath.Join(racineBiblio, deploySuffixSteam):             true,
			filepath.Join(`F:\`, nomDepotSteam, deploySuffixSteam):     true,
			filepath.Join(racinesSteamParDefaut[0], deploySuffixSteam): true,
		},
		fichiers: map[string][]byte{cheminVdf: fichiersVdf},
		lecteurs: []string{`C:\`, `E:\`, `F:\`},
	}
	got, err := faux.chercheSimule()
	if err != nil {
		t.Fatalf("chercheDeployRoot: %v", err)
	}
	want := filepath.Join(racineBiblio, deploySuffixSteam)
	if got != want {
		t.Errorf("le premier candidat de l'ordre (bibliothèque vdf) doit gagner, obtenu %q, attendu %q", got, want)
	}
}
