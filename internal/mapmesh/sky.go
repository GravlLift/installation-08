// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

import (
	"context"
	"log/slog"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// skyOf reads the sky named by the scenario, when it is readable.
func skyOf(ctx context.Context, gameRoot string, t Target, m *himap.MaillageMonde) *himap.Ciel {
	src, err := himap.SourcesLumiereDe(t.MapModule, t.Module, m.BSP)
	var sky *himap.Ciel
	if err == nil {
		sky, err = himap.LitCiel(src, gameRoot, t.MapModule)
	}
	if err != nil {
		slog.WarnContext(ctx, "sky unreadable", "map", t.Key, "err", err)
	}
	return sky
}
