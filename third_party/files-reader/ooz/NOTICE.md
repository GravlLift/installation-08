# NOTICE — provenance & licence du package `ooz`

Ce package vendorise un **décodeur Oodle clean-room** pour décompresser les blocs
Kraken/Mermaid/Selkie/Leviathan des archives `.module` Halo Infinite.

## Origine

- `kraken.cpp`, `bitknit.cpp`, `lzna.cpp` proviennent de **ooz** par *Powzix*
  (https://github.com/powzix/ooz), **licence GPLv3**.
- Modifications locales :
  - `#include "stdafx.h"` (MSVC/Windows.h) remplacé par `ooz_compat.h` (shim mingw-w64).
  - Troncature de `kraken.cpp` après `Kraken_Decompress` (suppression du `main()` et du
    loader DLL Oodle propriétaire).
- `ooz_compat.h`, `wrap.cpp`, `ooz.go` sont des fichiers de liaison écrits pour ce projet.

## ⚠️ Implication licence (GPLv3)

Le code dérivé d'ooz est **GPLv3** (texte : `LICENSE`, à côté). Le **serveur ne linke
jamais ce package** (garde-rail `apps/go-api/cmd/server/licence_gplv3_test.go`). Il sert :

- à l'outillage hors ligne (extraction de géométrie, génération d'assets) ;
- à `levelup-mapmesh.exe` (`apps/go-api/cmd/mapmesh-build`), PROGRAMME À PART livré par
  l'installeur de l'application de bureau, distribué sous GPLv3 avec ce texte (`LICENSE.GPL`) et
  une mention dans `apps/desktop/THIRD_PARTY_NOTICES.md` ; le serveur le lance comme un processus
  séparé, comme ffmpeg, pour construire le maillage 3D d'une carte sur le poste.

La géométrie extraite (données : contours, maillages) n'est pas du code. Un décodage Kraken
DANS le serveur demanderait une implémentation sous licence compatible (ou un
`oo2core_*.dll` sous licence Oodle).

## Build

CGO requis (`CGO_ENABLED=1`) + toolchain C++ mingw-w64 (ucrt64 g++). Voir `ooz.go`
(`#cgo CXXFLAGS -msse4.1 -std=c++14`, `-static-libstdc++`).
