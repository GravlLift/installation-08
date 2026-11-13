package haloapi

import "testing"

func TestDecodeWeaponCores(t *testing.T) {
	body := []byte(`{"WeaponCores":{"WeaponCores":[
		{"CoreId":"a","CorePath":"a.json","CoreType":"WeaponBR","Themes":[
			{"IsEquipped":false,"ThemePath":"skip.json"},
			{"IsEquipped":true,"ThemePath":"theme-a.json","CoatingPath":"coat-a.json"}]},
		{"CoreId":"b","CorePath":"b.json","CoreType":"WeaponAR","Themes":[
			{"IsEquipped":false}]},
		{"CoreId":"c","CorePath":"c.json","CoreType":"WeaponSidekick","Themes":[
			{"IsEquipped":true,"ThemePath":"theme-c.json","CoatingPath":"coat-c.json"},
			{"IsEquipped":true,"ThemePath":"second-ignored.json"}]}
	]}}`)
	cores, err := DecodeWeaponCores(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(cores) != 2 {
		t.Fatalf("cores: %+v", cores)
	}
	if cores[0].CoreID != "a" || cores[0].CoreType != "WeaponBR" ||
		cores[0].ThemePath != "theme-a.json" || cores[0].CoatingPath != "coat-a.json" {
		t.Fatalf("core a: %+v", cores[0])
	}
	if cores[1].CoreID != "c" || cores[1].CorePath != "c.json" || cores[1].ThemePath != "theme-c.json" {
		t.Fatalf("core c: %+v", cores[1])
	}
	paths := WeaponItemPaths(&cores[0])
	if len(paths) != 2 || paths[0] != "coat-a.json" || paths[1] != "theme-a.json" {
		t.Fatalf("item paths: %v", paths)
	}
	none, err := DecodeWeaponCores([]byte(`{"WeaponCores":{"WeaponCores":[]}}`))
	if err != nil || none != nil {
		t.Fatalf("empty: %v, %v", none, err)
	}
}

func TestDecodeWeaponCoating(t *testing.T) {
	body := []byte(`{"CommonData":{"Id":"c1","Type":"WeaponCoating"},"StyleId":{"m_identifier":-139792058}}`)
	c, err := DecodeWeaponCoating(body)
	if err != nil {
		t.Fatal(err)
	}
	if c.ID != "c1" || c.Type != "WeaponCoating" || c.StyleID == nil || *c.StyleID != -139792058 {
		t.Fatalf("coating: %+v", c)
	}
	plain, err := DecodeWeaponCoating([]byte(`{"CommonData":{"Id":"c2","Type":"WeaponCoating"}}`))
	if err != nil || plain.StyleID != nil {
		t.Fatalf("coating without style: %+v, %v", plain, err)
	}
}
