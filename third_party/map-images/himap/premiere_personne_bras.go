package himap

// OuvreBrasPremierePersonne ouvre le modele des bras pour lire ses pieces et son squelette.
func (a *Arsenal) OuvreBrasPremierePersonne() (*Armurerie, error) {
	sources, err := a.SourcesBras()
	if err != nil {
		return nil, err
	}
	return a.OuvreArmurerie(sources.Mode)
}
