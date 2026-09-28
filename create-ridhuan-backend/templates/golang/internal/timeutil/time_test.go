package timeutil

import (
	"testing"
	"time"
)

func TestUTCInstantAndIndonesianZone(t *testing.T) {
	instant, err := ParseInstant("2026-09-23T12:00:00+08:00")
	if err != nil {
		t.Fatal(err)
	}
	if got := instant.Format("2006-01-02T15:04:05Z07:00"); got != "2026-09-23T04:00:00Z" {
		t.Fatalf("UTC = %s", got)
	}
	jakarta, err := InZone(instant, "Asia/Jakarta")
	if err != nil {
		t.Fatal(err)
	}
	if got := jakarta.Format("15:04"); got != "11:00" {
		t.Fatalf("Jakarta = %s", got)
	}
}
func TestOffsetRequiredAndWorldZones(t *testing.T) {
	if _, err := ParseInstant("2026-09-26"); err == nil {
		t.Fatal("business date implicitly converted to an instant")
	}
	if _, err := ParseInstant("2026-09-26T10:00:00"); err == nil {
		t.Fatal("instant without offset accepted")
	}
	instant, err := ParseInstant("2026-07-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	for zone, hour := range map[string]int{"Asia/Jakarta": 7, "Asia/Makassar": 8, "Asia/Jayapura": 9, "America/New_York": 20} {
		value, err := InZone(instant, zone)
		if err != nil || value.Hour() != hour {
			t.Fatal(zone, value, err)
		}
	}
	winter, err := ParseInstant("2026-01-01T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	value, err := InZone(winter, "America/New_York")
	if err != nil || value.Hour() != 19 {
		t.Fatal("DST", value, err)
	}
	if _, err = InZone(time.Now(), "not/a-zone"); err == nil {
		t.Fatal("invalid zone accepted")
	}
}
