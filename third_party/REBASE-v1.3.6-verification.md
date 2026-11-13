# v1.3.6 verification

The old executable was built from integration `9b9ba17` and the new executable from the port, with the offline Go environment. Each rebuilt match `7d798138-77d2-41be-b1a3-bdf9fa38395c` in a separate copied scratch data directory. The original data was not modified. All first array entries compare equal; counts are old -> new:

```text
abilities: 32 -> 32; first equal: true
actions: 2296 -> 2296; first equal: true
ammoReads: 3416 -> 3416; first equal: true
carriedEquipment: 28 -> 28; first equal: true
damages: 1239 -> 1239; first equal: true
drawnWeapons: 610 -> 610; first equal: true
equipmentChanges: 35 -> 35; first equal: true
equipmentEpisodes: 9 -> 9; first equal: true
equipmentPlacements: 242 -> 242; first equal: true
grenadeLabels: 4 -> 4; first equal: true
grenadeReads: 615 -> 615; first equal: true
grenades: 259 -> 259; first equal: true
groundWeapons: 192 -> 192; first equal: true
inventory: 313 -> 313; first equal: true
killCauses: 165 -> 165; first equal: true
knockbacks: 2 -> 2; first equal: true
loadouts: 408 -> 408; first equal: true
objectiveObjects: 93 -> 93; first equal: true
padPickups: 37 -> 37; first equal: true
pickups: 278 -> 278; first equal: true
projectiles: 539 -> 539; first equal: true
riftPoses: 6 -> 6; first equal: true
roster: 8 -> 8; first equal: true
shots: 1636 -> 1636; first equal: true
skullCarries: 46 -> 46; first equal: true
stances: 3266 -> 3266; first equal: true
tracks: 177 -> 177; first equal: true
translocations: 8 -> 8; first equal: true
weaponChanges: 206 -> 206; first equal: true
weaponPads: 8 -> 8; first equal: true
differences: 3810
```

There are 3,810 field-level differences when arrays are compared by index. The complete paths and old/new values are in `scratchpad/decoder-140/differences.txt`; the comparison program and the two documents are in the same scratch directory. Differences comprise schema 122 -> 125, grammar revision labels, four aim coverage counters, and full-rate aim columns in tracks 13 and 19. Two aim samples disappear; indexing after an omission accounts for many scalar differences. Upstream's v115 chronicle states that frame-walk scanning removes aim readings outside valid records. That explains the direction of the observed reduction, but this single match does not independently establish the validity of every removed sample.

The document-shape fingerprint itself remains unchanged; its schema marker moved from 122 to 125. Revision fingerprints below are SHA-256, compared with the integration tree:

| Guard / revision | Before | After | Reason |
| --- | --- | --- | --- |
| source-2026-09-16.2 | `a16d7bf7d19e3dcd0d9c76976c45c968d6334b8b7bff987037658ff32d43290c` | `42d44bbaf0535f0825ba5fb8bf1985d457bf1064e50962497ae66ca50270bc58` | Upstream source search implementation and its dependency closure changed. |
| grammar-2026-11-12.4 | `c4692f7d33dd0900e39e49a62e6e115245a2dd498782b6243dbacbdc726153e7` | `4946c86ee880d5a381e2304fcf1b267d6607e7f9d72728d0d2b5833d341d20b8` | Retained upstream's historical fingerprint for its history. |
| grammar-2026-11-13 | `0d33ea82fc8c989f0ccd8348000330801c72c335efdef6285693bd387ad667e6` | `96b0d8dc7911671d60897dd66dca8cc182c48c9a99565de0343f166f7ce79cb7` | The upstream and local revisions collided; this entry now records upstream. |
| grammar-2026-11-13.2 | none | `0edbcf7da549052bc46f954493a10a7b7951295c69e30ad2104f3d897784d7f1` | New merged grammar revision. |
| killsource-2026-11-10 | `16f879f31c564dd316c60c57596f16b67ddc620073484f9da2458b52877978c3` | `99e2a81772c8857f75a2a4ddab0a1fbe3ae0df467ba956e9084c2389958071bf` | Upstream kill matching and the grammar revision in its dependency closure changed. |
| objectives-2026-10-17 | `a1b53e751a3fe9dd2ef769232b67978341de4951d2ce2ab62dc85b62538d64f0` | `076ddff82b9bbebbb272505f5b50ca12a29e4ec32c1071414879d426c4451740` | The grammar revision in its dependency closure changed. |

The required `gofmt -l cmd internal`, `go build ./...`, `go vet ./...`, `go test -p 4 ./...`, and the decoder `internal/depottest` and `internal/profile` tests passed. The decoder replay suite and the source, grammar, kill-source, and objective revision tests also passed. Revision fixture update commands intentionally fail after rewriting; their subsequent ordinary tests passed.

Existing artifacts made by the older decoder retain its schema and revision labels. Rebuild them to obtain the new grammar and schema; schema numbers 113–122 previously meant different local steps.