# Notice

This project is licensed under the GNU Affero General Public License, version 3. It builds on JGtm's LevelUp project and published halo-infinite-film-decoder, halo-infinite-map-images, halo-infinite-files-reader, and halo-api modules. See `third_party/README.md` and the upstream license and notice files for provenance.

The files-reader module includes the GPL-3.0 `ooz` decompressor; see `third_party/files-reader/ooz/NOTICE.md`. No game assets are distributed. Game-derived assets (map meshes) are built from the user's own installation.

`internal/mapmesh`, `internal/meshbuild` and `internal/mapref` are adapted from LevelUp's `internal/mapmesh` and `cmd/mapmesh-build` (AGPL-3.0, JGtm), rewritten to resolve and build a map mesh in-process instead of through a child process and its own wire protocol. `internal/mapref` additionally embeds reference data copied unmodified from LevelUp's `data/titles/halo_infinite/reference/` (the objectives catalog, the per-map background sidecars, and the per-map geometry settings): measurements and a catalog built from publicly downloadable UGC map variants, not extracted from a local game installation.
