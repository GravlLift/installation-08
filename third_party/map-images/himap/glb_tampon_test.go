package himap

import (
	"bytes"
	"testing"
)

// TestTamponGLB : des écritures qui chevauchent les blocs rendent, à la relecture, exactement la
// suite des octets écrits, et Len suit l'offset.
func TestTamponGLB(t *testing.T) {
	var tp tamponGLB
	var attendu bytes.Buffer
	gros := make([]byte, tailleBlocGLB+123)
	for i := range gros {
		gros[i] = byte(i * 7)
	}
	for _, p := range [][]byte{{1, 2, 3}, gros, {}, gros[:tailleBlocGLB-5], {9}} {
		if _, err := tp.Write(p); err != nil {
			t.Fatal(err)
		}
		attendu.Write(p)
		if tp.Len() != attendu.Len() {
			t.Fatalf("Len %d, attendu %d", tp.Len(), attendu.Len())
		}
	}
	if err := tp.WriteByte(42); err != nil {
		t.Fatal(err)
	}
	attendu.WriteByte(42)
	var lu bytes.Buffer
	n, err := tp.WriteTo(&lu)
	if err != nil || n != int64(attendu.Len()) || !bytes.Equal(lu.Bytes(), attendu.Bytes()) {
		t.Fatalf("relecture : %d octets, err %v, identique %v", n, err, bytes.Equal(lu.Bytes(), attendu.Bytes()))
	}
	for i, b := range tp.blocs {
		if cap(b) != tailleBlocGLB {
			t.Errorf("bloc %d : capacité %d, un bloc a été réalloué", i, cap(b))
		}
	}
}
