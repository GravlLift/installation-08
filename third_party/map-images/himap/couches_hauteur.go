package himap

// Les noms sont les haches murmur3 des parametres de hauteur declares par le shader.
type nomsHauteurCouche struct{ echelle, plage, accumulation uint32 }

var nomsHauteur = [4]nomsHauteurCouche{
	{0x01891e57, 0, 0x3f7411c9},
	{0x8d0a204b, 0xf0cf6a61, 0x0bc74775},
	{0x0199de50, 0x3c31e1a8, 0xbd628ce7},
	{0xa8dd0ce4, 0x16211a83, 0},
}

// HauteurCouche porte les constantes lineaires du melange par hauteur.
type HauteurCouche struct{ Echelle, Plage, Accumulation float32 }

func litHauteur(n nomsHauteurCouche, params ParametresShader, c lecteurConstantes, premiere bool) *HauteurCouche {
	e, ok := octetParam(params, n.echelle)
	if !ok {
		return nil
	}
	h := &HauteurCouche{Echelle: c.f(e)}
	if !premiere {
		p, ok := octetParam(params, n.plage)
		if !ok {
			return nil
		}
		h.Plage = c.f(p)
	}
	if a, ok := octetParam(params, n.accumulation); ok {
		h.Accumulation = c.f(a)
	}
	return h
}

// MatiereCouche porte le reglage de rugosite et de metal d'un degrade.
type MatiereCouche struct{ Blanc, Noir, Metal float32 }

var nomsMatiere = [4][3]uint32{
	{}, {0x29dfeec4, 0x6b06bdf0, 0xb95cd1c1}, {0x6bc1b270, 0x4e25e2ea, 0xe4e2bbe2}, {0xa700a865, 0xb43430cd, 0x9ea02f0b},
}

func litMatiere(n [3]uint32, params ParametresShader, c lecteurConstantes) *MatiereCouche {
	a, ok := octetParam(params, n[0])
	if !ok {
		return nil
	}
	b, ok := octetParam(params, n[1])
	if !ok {
		return nil
	}
	m, ok := octetParam(params, n[2])
	if !ok {
		return nil
	}
	return &MatiereCouche{c.f(a), c.f(b), c.f(m)}
}
