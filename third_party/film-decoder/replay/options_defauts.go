package replay

// options_defauts.go — LOCAL-CHANGE (infinite-theater-3d): the defaults of [Options], moved out of options.go
// unchanged to keep that file under its 500-line cap.

import "github.com/JGtm/halo-infinite-film-decoder/internal/facts/fallback"

func (o Options) frameIntervalMS() int {
	if o.FrameIntervalMS > 0 {
		return o.FrameIntervalMS
	}
	return DefaultFrameIntervalMS
}

// compteurDeReplis rend le compteur de la cuisson, en creant le sien quand l'appelant n'en a pas
// fourni. MEME PATRON QUE `frameIntervalMS` / `minPoints` : le defaut vit ici, une seule fois,
// et l'assemblage n'a pas a le connaitre.
func (o Options) compteurDeReplis() *fallback.Compteur {
	if o.Fallbacks != nil {
		return o.Fallbacks
	}
	return fallback.NouveauCompteur()
}

func (o Options) minPoints() int {
	if o.MinPoints > 0 {
		return o.MinPoints
	}
	return DefaultMinPoints
}
