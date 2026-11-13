package replay

// filmfacts_schema23.go — le commentaire du SCHEMA DES FAITS 23 (port de LevelUp feat/replay-3d
// sur le v1.3.2 amont, 2026-11-13), extrait de `filmfacts_fichier.go` pour tenir ce dernier
// sous le plafond de 500 lignes. La constante `SchemaDesFaits` reste dans son fichier d origine ;
// ce fichier porte uniquement la documentation du saut de schema.
//
// SCHEMA 23 (2026-11-13, port : actions, entrees de controle, visees seules, munitions portees) :
// le complement de la section 1 porte, sur le schema 22 de l amont, les lectures du jeu d armes
// desire du bipede (`FilmInputs.DrawnWeapons`, `DrawnWeaponStats`) et les messages d action de la
// vue A (`FilmInputs.Actions`, `encodeActionsDuJoueur`), puis les changements des boutons de
// controle et du couple analogique (`FilmInputs.ControlInputs`, `encodeBoutonsDeControle`), puis
// les visees des records sans position sur TOUT film (`VehicleScan.Aims`, sens change sans format),
// puis les munitions portees sur l inventaire des deltas (`types.InventoryDelta`, valeurs et
// presence dans chaque delta, publiees en `AmmoReads` par `buildAmmoReads`). Un fichier du schema 22
// ne porte aucun de ces canaux : refuse sur son en-tete, et par la magie du blob (`REPLAYINPUTS30`
// contre `REPLAYINPUTS29`) comme par la montee de `grammar.Rev` du meme port.
