package config

import (
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// LoadEnvironment preserves process overrides and Compose-compatible literal credentials.
func LoadEnvironment(path string) error {
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errors.New("unable to read environment file")
	}
	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	literals := make(map[string]string)
	for i, line := range lines {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, raw := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		if len(raw) >= 2 && strings.HasPrefix(raw, "\"") && strings.HasSuffix(raw, "\"") {
			var decoded string
			if json.Unmarshal([]byte(strings.ReplaceAll(raw, "\\$", "$")), &decoded) != nil {
				return errors.New("invalid quoted environment assignment")
			}
			literals[key] = decoded
			// Validate assignment names with godotenv without interpreting literal dollars or backslashes.
			lines[i] = key + "=CLI_LITERAL_VALUE"
		} else if len(raw) >= 2 && strings.HasPrefix(raw, "'") && strings.HasSuffix(raw, "'") {
			literals[key] = strings.ReplaceAll(raw[1:len(raw)-1], "\\'", "'")
			lines[i] = key + "=CLI_LITERAL_VALUE"
		}
	}
	values, err := godotenv.Unmarshal(strings.Join(lines, "\n"))
	if err != nil {
		return errors.New("invalid environment file")
	}
	for key, literal := range literals {
		if _, exists := values[key]; exists {
			values[key] = literal
		}
	}
	for key, value := range values {
		if _, exists := os.LookupEnv(key); !exists {
			if err = os.Setenv(key, value); err != nil {
				return errors.New("invalid environment assignment")
			}
		}
	}
	return nil
}
