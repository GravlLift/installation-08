// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package haloapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProgressionFile(t *testing.T) {
	var gotPath, gotAuth string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("x-343-authorization-spartan")
		fmt.Fprint(w, "file-bytes")
	}))
	defer s.Close()
	api := New(s.Client(), Endpoints{GameCMS: s.URL}, "spartan-token", "clearance")
	raw, err := api.ProgressionFile(context.Background(), "/infinite/customization/armor/cores/core/theme.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "file-bytes" {
		t.Fatalf("body: %q", raw)
	}
	if gotPath != "/progression/file/infinite/customization/armor/cores/core/theme.json" {
		t.Fatalf("path: %q", gotPath)
	}
	if gotAuth != "spartan-token" {
		t.Fatalf("auth header: %q", gotAuth)
	}
	if _, err = api.ProgressionFile(context.Background(), "  "); err == nil {
		t.Fatal("empty path accepted")
	}
}

func TestDecodeArmorCustomization(t *testing.T) {
	body := []byte(`{"ArmorCores":{"ArmorCores":[
		{"CoreId":"other","CorePath":"other.json","IsEquipped":false},
		{"CoreId":"core","CorePath":"core.json","IsEquipped":true,"Themes":[
			{"IsEquipped":false},
			{"IsEquipped":true,"ThemePath":"theme.json","HelmetPath":"helmet.json","CoatingPath":"coating.json",
			 "Emblems":[{"Path":"emblem","LocationId":1,"ConfigurationId":2}]}]}
	]},"SpartanBody":{"BodyType":"Large","LeftArm":"Transfemoral"}}`)
	c, err := DecodeArmorCustomization(body)
	if err != nil {
		t.Fatal(err)
	}
	if c.CoreID != "core" || c.ThemePath != "theme.json" || c.HelmetPath != "helmet.json" ||
		c.CoatingPath != "coating.json" || c.GlovesPath != "" ||
		len(c.Emblems) != 1 || c.Emblems[0].LocationID != 1 ||
		c.Body.BodyType != "Large" || c.Body.LeftArm != "Transfemoral" {
		t.Fatalf("customization: %+v", c)
	}
	paths := ArmorItemPaths(c)
	want := []string{"helmet.json", "coating.json"}
	if len(paths) != len(want) {
		t.Fatalf("item paths: %v", paths)
	}
	for i, p := range want {
		if paths[i] != p {
			t.Fatalf("item paths: %v", paths)
		}
	}
	no, err := DecodeArmorCustomization([]byte(`{"ArmorCores":{"ArmorCores":[]},"SpartanBody":{}}`))
	if !errors.Is(err, ErrNoEquippedArmor) || no != nil {
		t.Fatalf("expected ErrNoEquippedArmor, got %v, %+v", err, no)
	}
}

func TestDecodeArmorTheme(t *testing.T) {
	body := []byte(`{"CommonData":{"Id":"t1","Type":"ArmorTheme"},"TagId":42,"VariantId":{"m_identifier":-436735957},"IsKit":true,
		"CoreRegionData":{"BaseRegionData":[{"RegionId":{"m_identifier":1},"PermutationId":{"m_identifier":2}}],
		"BodyTypeLargeOverrides":[{"RegionId":{"m_identifier":3},"PermutationId":{"m_identifier":4}}],
		"ProstheticLeftArmOverrides":{"Full":[{"RegionId":{"m_identifier":5},"PermutationId":{"m_identifier":6}}]}}}`)
	th, err := DecodeArmorTheme(body)
	if err != nil {
		t.Fatal(err)
	}
	if th.ID != "t1" || th.TagID != 42 || !th.IsKit || len(th.Base) != 1 || len(th.BodyLarge) != 1 ||
		th.Base[0].RegionID != 1 || th.LeftArm.Full[0].PermutationID != 6 ||
		th.VariantID != StringID(-436735957) {
		t.Fatalf("theme: %+v", th)
	}
	if _, err = DecodeArmorTheme([]byte(`{"CommonData":{"Id":"x"}}`)); !errors.Is(err, ErrNoCoreRegionData) {
		t.Fatalf("expected ErrNoCoreRegionData, got %v", err)
	}
}

func TestDecodeArmorItem(t *testing.T) {
	body := []byte(`{"CommonData":{"Id":"coat","Type":"ArmorCoating"},"StyleId":{"m_identifier":42},
		"MarkerLocation":{"MarkerName":{"m_identifier":7},"VariantId":{"m_identifier":8}},"MeshIndex":3}`)
	item, err := DecodeArmorItem(body)
	if err != nil {
		t.Fatal(err)
	}
	if item.ID != "coat" || item.Type != "ArmorCoating" || item.StyleID == nil || *item.StyleID != 42 ||
		item.Marker == nil || item.Marker.MarkerName != 7 || item.MeshIndex == nil || *item.MeshIndex != 3 {
		t.Fatalf("item: %+v", item)
	}
}

func TestStringIDHex(t *testing.T) {
	if StringID(-1).Hex() != "ffffffff" {
		t.Fatalf("hex of -1: %q", StringID(-1).Hex())
	}
	if StringID(65).Hex() != "00000041" {
		t.Fatalf("hex of 65: %q", StringID(65).Hex())
	}
	var s StringID
	if err := s.UnmarshalJSON([]byte("null")); err != nil {
		t.Fatal(err)
	}
	if s != 0 {
		t.Fatalf("null StringID: %v", s)
	}
}
