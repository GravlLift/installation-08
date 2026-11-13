package build

import (
	"context"
	"log/slog"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/finalise"
	"github.com/JGtm/halo-infinite-film-decoder/highlightevent"
)

func filmEvents(ctx context.Context, id string, film *decfilm.Film) []highlightevent.HighlightEvent {
	nums := decfilm.FilmChunkNumbers(film)
	if len(nums) == 0 {
		return nil
	}
	n, typed, found := nums[len(nums)-1], false, false
	for _, m := range film.Meta() {
		if m.ChunkType != 0 {
			typed = true
		}
		if finalise.EstTempsForts(m.ChunkType) {
			n, found = m.Index, true
		}
	}
	if typed && !found {
		slog.WarnContext(ctx, "highlight chunk absent", "match_id", id)
		return nil
	}
	raw, _, ok := decfilm.FilmChunkAt(film, n)
	if !ok {
		slog.WarnContext(ctx, "highlight chunk unreadable", "match_id", id)
		return nil
	}
	version, _ := decfilm.FilmMajorVersionFromHeader(film.Chunk(0))
	events, err := decfilm.ParseHighlightEvents(raw, version)
	if err != nil {
		slog.WarnContext(ctx, "highlight events unreadable", "match_id", id, "err", err)
		return nil
	}
	return events
}
