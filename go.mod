module github.com/llampwall/infinite-theater-3d

go 1.26.11

require (
	github.com/JGtm/halo-infinite-files-reader v1.0.1
	github.com/JGtm/halo-infinite-film-decoder v1.3.6
	github.com/JGtm/halo-infinite-map-images v1.0.1
	github.com/jchv/go-webview2 v0.0.0-20260205173254-56598839c808
	golang.org/x/sys v0.49.0
)

require (
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	github.com/klauspost/compress v1.20.2 // indirect
	github.com/woozymasta/bcn v0.7.0 // indirect
)

replace github.com/JGtm/halo-infinite-film-decoder => ./third_party/film-decoder

replace github.com/JGtm/halo-infinite-map-images => ./third_party/map-images

replace github.com/JGtm/halo-infinite-files-reader => ./third_party/files-reader
