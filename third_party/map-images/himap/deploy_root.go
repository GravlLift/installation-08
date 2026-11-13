// Package himap — deploy_root.go : ou trouver l'installation de Halo Infinite.
//
// POURQUOI CE FICHIER EXISTE. Le chemin `D:/SteamLibrary/.../deploy` etait ecrit en dur a
// TROIS endroits : les deux binaires de production d'assets et les tests `gamefiles` de ce
// package. Le 2026-08-08, ce disque n'est plus monte sur le poste de developpement — et
// rien ne l'a signale : les tests se declarent « module absent » et passent au vert, les
// binaires echouent sur un dossier introuvable. Un garde-rail qui saute en silence ne
// garde rien.
//
// La liste des emplacements du jeu vit ICI et nulle part ailleurs (garde-rail du depot hote :
// archlint.TestAucuneAutreCopieDuCheminDuJeu interdit le litteral partout ailleurs).
package himap

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DeployRootEnv prime sur toute detection : une installation ailleurs se declare par
// l'environnement, sans toucher au code.
const DeployRootEnv = "LEVELUP_HALO_DEPLOY"

// ErrNoDeployRoot signale qu'aucune installation n'a ete trouvee. Les appelants hors ligne
// (production d'assets, tests gamefiles) doivent s'ARRETER ou se declarer absents, jamais
// continuer sur un chemin devine.
var ErrNoDeployRoot = fmt.Errorf("himap: aucune installation de Halo Infinite trouvee "+
	"(definir %s, ou installer le jeu a l'un des emplacements connus)", DeployRootEnv)

// nomDepotSteam et nomDepotXbox : noms de dossier des deux depots, exposes pour que les
// tests construisent leurs chemins a partir des memes constantes que la recherche (le
// garde-rail archlint.TestAucuneAutreCopieDuCheminDuJeu interdit le litteral hors de ce
// fichier).
const (
	nomDepotSteam = "SteamLibrary"
	nomDepotXbox  = "XboxGames"
)

// deploySuffixSteam : sous-racine d'installation du jeu dans un depot Steam — meme pour le
// depot par defaut et pour chaque bibliotheque supplementaire.
const deploySuffixSteam = "steamapps" + string(os.PathSeparator) + "common" +
	string(os.PathSeparator) + "Halo Infinite" + string(os.PathSeparator) + "deploy"

// deploySuffixXbox : sous-racine d'installation du jeu dans un depot Xbox app.
const deploySuffixXbox = nomDepotXbox + string(os.PathSeparator) + "Halo Infinite" +
	string(os.PathSeparator) + "Content" + string(os.PathSeparator) + "deploy"

// racinesSteamParDefaut : emplacements du depot Steam par defaut, essayes dans cet ordre
// (l'installation par defaut est le premier, la derniere tentative de la recherche).
var racinesSteamParDefaut = []string{
	`C:/Program Files (x86)/Steam`,
	`C:/Program Files/Steam`,
}

// Chemins du dossier `libraryfolders.vdf` de Steam, relatifs a une racine Steam.
const (
	vdfRelDepot  = "steamapps" + string(os.PathSeparator) + "libraryfolders.vdf"
	vdfRelConfig = "config" + string(os.PathSeparator) + "libraryfolders.vdf"
)

// DeployRoot rend la racine `deploy` d'une installation de Halo Infinite.
//
// Contrat d'ordre : la variable d'environnement prime et reste une erreur si elle ne pointe
// sur rien. Sans elle, le premier dossier EXISTANT gagne, dans l'ordre :
//
//  1. chaque bibliotheque declaree par le `libraryfolders.vdf` de chaque racine Steam
//     par defaut (candidat `<racine>/steamapps/common/Halo Infinite/deploy`) ;
//  2. chaque lecteur C..Z existant, d'abord `<lecteur>/SteamLibrary/steamapps/common/...`,
//     puis `<lecteur>/XboxGames/Halo Infinite/Content/deploy` ;
//  3. le depot Steam par defaut du point 1 (meme chemin).
//
// Aucun resultat n'est suppose : `ErrNoDeployRoot` si rien n'existe.
func DeployRoot() (string, error) {
	return chercheDeployRoot(os.Getenv, cheminExiste, os.ReadFile, lecteursExistants)
}

// chercheDeployRoot est la recherche testee sans disque : les quatre entrees sont des coutures
// (environnement, existence d'un chemin, lecture d'un fichier, lecteurs existants).
//
// Contrat : meme ordre que [DeployRoot] ; un chemin absent du disque est ignore sans erreur,
// sauf la variable d'environnement qui reste une erreur (elle declare une installation).
func chercheDeployRoot(env func(string) string, existe func(string) bool,
	lecture func(string) ([]byte, error), lecteurs func() []string) (string, error) {
	if r := strings.TrimSpace(env(DeployRootEnv)); r != "" {
		if !existe(r) {
			return "", fmt.Errorf("himap: %s pointe sur %q, illisible", DeployRootEnv, r)
		}
		return r, nil
	}
	candidats := []string{}
	for _, vdf := range cheminsVdf() {
		octets, _ := lecture(vdf) // un fichier absent ou illisible est ignore (pas d'erreur)
		for _, r := range racinesBibliothequeSteam(octets) {
			candidats = append(candidats, filepath.Join(r, deploySuffixSteam))
		}
	}
	for _, lecteur := range lecteurs() {
		candidats = append(candidats,
			filepath.Join(lecteur, nomDepotSteam, deploySuffixSteam),
			filepath.Join(lecteur, deploySuffixXbox),
		)
	}
	candidats = append(candidats, filepath.Join(racinesSteamParDefaut[0], deploySuffixSteam))
	for _, c := range candidats {
		if existe(c) {
			return c, nil
		}
	}
	return "", ErrNoDeployRoot
}

// cheminsVdf rend tous les chemins du `libraryfolders.vdf` a essayer, dans l'ordre des
// racines Steam par defaut.
func cheminsVdf() []string {
	var chemins []string
	for _, racine := range racinesSteamParDefaut {
		chemins = append(chemins,
			filepath.Join(racine, vdfRelDepot),
			filepath.Join(racine, vdfRelConfig),
		)
	}
	return chemins
}

// racinesBibliothequeSteam rend, d'un `libraryfolders.vdf`, les racines des bibliotheques
// declarees, dedoublonnees dans l'ordre de declaration.
//
// Contrat : lecture tolérante — un octet illisible, une ligne mal formée ou un valeur
// vide sont ignorés, jamais une erreur. Chaque ligne `"path"  "<valeur>"` declare une
// bibliotheque ; la valeur utilise des antislashs doubles (doublés) qu'il faut defaire.
func racinesBibliothequeSteam(octets []byte) []string {
	if len(octets) == 0 {
		return nil
	}
	var racines []string
	vus := map[string]bool{}
	for _, ligne := range strings.Split(string(octets), "\n") {
		// Les champs sont entre guillemets et une valeur peut porter des espaces : on coupe sur
		// les guillemets, pas sur les blancs. `"path"  "E:\\Mes jeux"` rend 5 morceaux.
		parts := strings.Split(strings.TrimSpace(ligne), `"`)
		if len(parts) != 5 || parts[1] != "path" {
			continue
		}
		racine := strings.ReplaceAll(parts[3], `\\`, `\`)
		if racine == "" || vus[racine] {
			continue
		}
		vus[racine] = true
		racines = append(racines, racine)
	}
	return racines
}

// cheminExiste rend true si le chemin existe (fichier ou dossier), sans distinguer les deux :
// la recherche exige seulement que le dossier soit la.
func cheminExiste(chemin string) bool {
	_, err := os.Stat(chemin)
	return err == nil
}

// lecteursExistants rend les racines des lecteurs C..Z existants (`C:\`, `D:\`, ...),
// ordonnees. Un lecteur absent est ignore sans erreur.
func lecteursExistants() []string {
	var lecteurs []string
	for c := 'C'; c <= 'Z'; c++ {
		racine := string(c) + ":" + string(os.PathSeparator)
		if cheminExiste(racine) {
			lecteurs = append(lecteurs, racine)
		}
	}
	return lecteurs
}

// LevelsDir rend le dossier des cartes multijoueur d'une variante de depot.
//
// Les trois variantes ne portent PAS la meme chose : `pc` a la geometrie de rendu (c'est
// elle qu'il faut pour les instances), `ds` est le build serveur dedie — depouille du
// rendu, mais c'est lui qui porte les bornes monde du BSP — et `any` porte les materiaux
// et le tag de scenario (noms de zones).
func LevelsDir(variant string) (string, error) {
	root, err := DeployRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, variant, "levels", "multi"), nil
}

// modulesGeneriques : jetons de nom de carte qui ne designent aucun dossier.
var modulesGeneriques = map[string]bool{"map": true, "ranked": true, "": true, "-": true}

// ChercheModuleInstalle fait le pont entre le nom de module du CATALOGUE et le dossier de
// l'INSTALLATION.
//
// Ils ne coincident pas : le catalogue nomme « cliffhanger_ridgeline » ce que le jeu range sous
// « ridgeline ». Le jeu PREFIXE en outre ses dossiers par le mode d'origine de la carte —
// `ctf_bazaar`, `btb_highpower`, `sgh_interlock`, `va_behemoth` — quand le catalogue, lui, dit
// « bazaar_map ». On enumere donc l'installation et on apparie sur les JETONS, plutot que de
// deviner un prefixe.
//
// Un module introuvable est SIGNALE par `false`, jamais suppose absent : plusieurs cartes du
// catalogue ne sont pas installees localement, et les confondre avec une chaine cassee ferait
// passer une absence pour un echec.
func ChercheModuleInstalle(nom string) (string, bool) {
	dir, err := LevelsDir("pc")
	if err != nil {
		return "", false
	}
	dossiers, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	var jetons []string
	for _, j := range strings.FieldsFunc(nom, func(r rune) bool { return r == '_' || r == '-' }) {
		if !modulesGeneriques[j] {
			jetons = append(jetons, j)
		}
	}
	for _, d := range dossiers {
		if !d.IsDir() {
			continue
		}
		base := d.Name()
		p := filepath.Join(dir, base, base+"-rtx-new.module")
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if base == nom {
			return p, true
		}
		for _, j := range jetons {
			// Suffixe : `ctf_bazaar` porte `bazaar`. Egalite pour les dossiers sans prefixe.
			if base == j || strings.HasSuffix(base, "_"+j) {
				return p, true
			}
		}
	}
	return "", false
}
