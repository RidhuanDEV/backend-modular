package timeutil

import "time"

func Now() time.Time { return time.Now().UTC() }
func ParseInstant(value string) (time.Time, error) {
	valueTime, err := time.Parse(time.RFC3339Nano, value)
	return valueTime.UTC(), err
}
func InZone(value time.Time, zone string) (time.Time, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, err
	}
	return value.In(loc), nil
}
