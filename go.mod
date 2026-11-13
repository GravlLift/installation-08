module github.com/llampwall/infinite-theater-3d

go 1.26.11

require (
	github.com/JGtm/halo-api v1.0.1
	github.com/JGtm/halo-infinite-files-reader v1.0.1
	github.com/JGtm/halo-infinite-film-decoder v1.3.2
	github.com/JGtm/halo-infinite-map-images v1.0.1
)

require (
	github.com/klauspost/compress v1.20.2 // indirect
	github.com/woozymasta/bcn v0.7.0 // indirect
	golang.org/x/sys v0.49.0 // indirect
)

replace github.com/JGtm/halo-infinite-film-decoder => ./third_party/film-decoder

replace github.com/JGtm/halo-infinite-map-images => ./third_party/map-images

replace github.com/JGtm/halo-infinite-files-reader => ./third_party/files-reader
