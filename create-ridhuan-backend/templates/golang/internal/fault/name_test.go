package fault

import (
	"strings"
	"testing"
)

func TestNameLimitCountsUnicodeCharacters(t *testing.T) {
	if err := Name(strings.Repeat("界", 64), 64); err != nil {
		t.Fatal(err)
	}
	if err := Name(strings.Repeat("界", 65), 64); err == nil {
		t.Fatal("name above schema length accepted")
	}
	if err := Name("   ", 64); err == nil {
		t.Fatal("blank name accepted")
	}
}
