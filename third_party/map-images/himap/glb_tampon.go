package himap

import "io"

// tailleBlocGLB : la taille d'un bloc du tampon binaire du GLB.
const tailleBlocGLB = 64 << 20

// tamponGLB est le bloc binaire d'un GLB en cours d'ecriture, tenu par blocs de taille fixe.
//
// Un tampon contigu grandi par doublements tient, a chaque agrandissement, l'ancienne et la
// nouvelle copie : sur une carte d'un Go de geometrie, c'est le pic de memoire de la
// construction. Ici rien n'est recopie en grandissant, et le tampon part vers le fichier bloc
// par bloc.
type tamponGLB struct {
	blocs [][]byte
	n     int
}

// Len rend le nombre d'octets ecrits : l'offset du prochain octet dans le bloc binaire.
func (t *tamponGLB) Len() int { return t.n }

// ajoute copie p a la suite ; l'ecriture en memoire n'echoue jamais.
func (t *tamponGLB) ajoute(p []byte) {
	t.n += len(p)
	for len(p) > 0 {
		if len(t.blocs) == 0 || len(t.blocs[len(t.blocs)-1]) == tailleBlocGLB {
			t.blocs = append(t.blocs, make([]byte, 0, tailleBlocGLB))
		}
		dernier := &t.blocs[len(t.blocs)-1]
		k := min(len(p), tailleBlocGLB-len(*dernier))
		*dernier = append(*dernier, p[:k]...)
		p = p[k:]
	}
}

// aligne4 complete par des zeros jusqu'au prochain multiple de 4 octets (alignement des vues
// glTF).
func (t *tamponGLB) aligne4() {
	t.ajoute(make([]byte, (4-t.n%4)%4))
}

// Write copie p a la suite (io.Writer) ; ne rend jamais d'erreur.
func (t *tamponGLB) Write(p []byte) (int, error) {
	t.ajoute(p)
	return len(p), nil
}

// WriteByte ecrit un octet (io.ByteWriter) ; ne rend jamais d'erreur.
func (t *tamponGLB) WriteByte(c byte) error {
	t.ajoute([]byte{c})
	return nil
}

// WriteTo ecrit le contenu vers w, bloc par bloc.
func (t *tamponGLB) WriteTo(w io.Writer) (int64, error) {
	var total int64
	for _, b := range t.blocs {
		n, err := w.Write(b)
		total += int64(n)
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

// aLecture rend les octets [off, off+len) du tampon ; nil si hors bornes.
func (t *tamponGLB) aLecture(off, n int) []byte {
	if off < 0 || n < 0 || off+n > t.n {
		return nil
	}
	out := make([]byte, n)
	pos := off
	copied := 0
	for copied < n {
		k := t.bloc(pos)
		if k < 0 {
			return nil
		}
		blk := t.blocs[k]
		b := pos - k*tailleBlocGLB
		if b < 0 || b >= len(blk) {
			return nil
		}
		j := min(n-copied, len(blk)-b)
		if j <= 0 {
			return nil
		}
		copy(out[copied:], blk[b:b+j])
		pos += j
		copied += j
	}
	return out
}

func (t *tamponGLB) bloc(off int) int {
	if off >= t.n {
		return -1
	}
	k := off / tailleBlocGLB
	if k >= len(t.blocs) {
		return -1
	}
	return k
}
