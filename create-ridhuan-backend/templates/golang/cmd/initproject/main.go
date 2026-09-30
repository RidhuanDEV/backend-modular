package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const originalModule = "github.com/RidhuanDEV/golang-backend"

var sqlIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	noInstall := flag.Bool("no-install", false, "skip go mod download")
	sourceFlag := flag.String("source", "", "template source directory (default current repository)")
	flag.Parse()
	reader := bufio.NewReader(os.Stdin)
	name := ""
	if flag.NArg() > 0 {
		name = flag.Arg(0)
	} else {
		name = ask(reader, "Project directory", "my-api")
	}
	if name == "" || name == "." || name == ".." {
		return errors.New("project directory name is required")
	}
	module := ask(reader, "Go module path", "example.com/"+filepath.Base(name))
	if strings.ContainsAny(module, " \t\r\n") || !strings.Contains(module, "/") || strings.Contains(module, "..") {
		return errors.New("invalid Go module path")
	}
	port := ask(reader, "HTTP port", "8080")
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return errors.New("invalid HTTP port")
	}
	dbName := ask(reader, "PostgreSQL database name", strings.ReplaceAll(filepath.Base(name), "-", "_"))
	dbUser := ask(reader, "PostgreSQL username", "backend")
	dbPassword := os.Getenv("RIDHUAN_DB_PASSWORD")
	if dbPassword == "" {
		dbPassword = randomSecret()
	}
	if !sqlIdentifier.MatchString(dbName) || !sqlIdentifier.MatchString(dbUser) || strings.ContainsAny(dbPassword, "\r\n\x00") {
		return errors.New("database name/user must be SQL identifiers; password cannot contain newline or NUL")
	}
	redisChoice := strings.ToLower(ask(reader, "Enable Redis cache and rate store? (y/N)", "n"))
	storageChoice := strings.ToLower(ask(reader, "Upload storage (local/s3)", "local"))
	if storageChoice != "local" && storageChoice != "s3" {
		return errors.New("upload storage must be local or s3")
	}
	source := *sourceFlag
	if source == "" {
		source, err = findRoot()
		if err != nil {
			return err
		}
	}
	source, err = filepath.Abs(source)
	if err != nil {
		return err
	}
	destination, err := filepath.Abs(name)
	if err != nil {
		return err
	}
	if destination == source || strings.HasPrefix(destination, source+string(os.PathSeparator)) {
		return errors.New("project destination must be outside template source")
	}
	if items, e := os.ReadDir(destination); e == nil {
		if len(items) > 0 {
			return errors.New("destination directory is not empty")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if err = os.MkdirAll(destination, 0755); err != nil {
		return err
	}
	if err = copyTemplate(source, destination, module); err != nil {
		return err
	}
	secret := make([]byte, 48)
	if _, err = rand.Read(secret); err != nil {
		return err
	}
	redisEnabled := redisChoice == "y" || redisChoice == "yes"
	rateStore := "memory"
	if redisEnabled {
		rateStore = "redis"
	}
	profiles := []string{}
	if redisEnabled {
		profiles = append(profiles, "redis")
	}
	if storageChoice == "s3" {
		profiles = append(profiles, "minio")
	}
	makeURL := func(host string) string {
		connection := &url.URL{Scheme: "postgresql", User: url.UserPassword(dbUser, dbPassword), Host: host + ":5432", Path: "/" + dbName, RawQuery: "sslmode=disable"}
		return connection.String()
	}
	replacements := map[string]string{
		"PORT": port, "APP_PORT": port, "POSTGRES_DB": dbName, "POSTGRES_USER": dbUser, "POSTGRES_PASSWORD": dbPassword,
		"DATABASE_URL": makeURL("127.0.0.1"), "DATABASE_URL_DOCKER": makeURL("postgres"),
		"JWT_SECRET": base64.RawURLEncoding.EncodeToString(secret), "ADMIN_PASSWORD": randomSecret(), "USER_PASSWORD": randomSecret(),
		"REDIS_NAMESPACE": strings.ToLower(filepath.Base(name)), "CACHE_ENABLED": strconv.FormatBool(redisEnabled), "RATE_LIMIT_STORE": rateStore, "UPLOAD_STORAGE": storageChoice,
		"COMPOSE_PROFILES": strings.Join(profiles, ","), "COMPOSE_PROJECT_NAME": strings.ToLower(filepath.Base(name)),
		"S3_ACCESS_KEY_ID": "development", "S3_SECRET_ACCESS_KEY": randomSecret(),
	}
	originalEnv, err := os.ReadFile(filepath.Join(source, ".env.example"))
	if err != nil {
		return err
	}
	lines := strings.Split(string(originalEnv), "\n")
	for i, line := range lines {
		key, _, exists := strings.Cut(line, "=")
		if value, found := replacements[key]; exists && found {
			lines[i] = key + "=" + serializeEnv(value)
			delete(replacements, key)
		}
	}
	if len(replacements) != 0 {
		return errors.New("template env is incomplete")
	}
	env := strings.Join(lines, "\n")
	if err = os.WriteFile(filepath.Join(destination, ".env"), []byte(env), 0600); err != nil {
		return err
	}
	if !*noInstall {
		command := exec.Command("go", "mod", "download")
		command.Dir = destination
		command.Env = append(os.Environ(), "GOWORK=off")
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if err = command.Run(); err != nil {
			return fmt.Errorf("go mod download: %w", err)
		}
	}
	fmt.Printf("Created %s\nNext: cd %s; go run ./cmd/migrate; go run ./cmd/seed; go run ./cmd/api\n", destination, name)
	return nil
}
func ask(reader *bufio.Reader, label, defaultValue string) string {
	fmt.Printf("%s [%s]: ", label, defaultValue)
	text, _ := reader.ReadString('\n')
	if value := strings.TrimSpace(text); value != "" {
		return value
	}
	return defaultValue
}
func findRoot() (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err = os.Stat(filepath.Join(directory, "go.mod")); err == nil {
			return directory, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", errors.New("template go.mod not found")
		}
		directory = parent
	}
}
func copyTemplate(source, destination, module string) error {
	allowed := map[string]struct{}{"LICENSE": {}, ".gitattributes": {}, ".github": {}, "cmd": {}, "contracts": {}, "internal": {}, ".dockerignore": {}, ".env.example": {}, ".gitignore": {}, "Dockerfile": {}, "compose.yaml": {}, "compose.override.yaml.example": {}, "go.mod": {}, "go.sum": {}, "README.md": {}, "sqlc.yaml": {}, "CONTRIBUTING.md": {}, "SECURITY.md": {}, "CHANGELOG.md": {}}
	allowed["scripts"] = struct{}{}
	allowed["Makefile"] = struct{}{}
	allowed["docs"] = struct{}{}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		rootPart := strings.SplitN(relative, string(os.PathSeparator), 2)[0]
		if _, ok := allowed[rootPart]; !ok {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if rootPart == "docs" && !entry.IsDir() && name != "OPERATIONS.md" && name != "module-guide.md" && name != "contract-parity.md" && name != "testing.md" {
			return nil
		}
		if entry.IsDir() && (name == ".git" || name == "uploads" || name == "bin") {
			return filepath.SkipDir
		}
		if name == ".env" || strings.HasPrefix(name, ".env.") && name != ".env.example" || name == "coverage.out" {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		defer input.Close()
		if strings.HasSuffix(name, ".go") || name == "go.mod" {
			data, err := io.ReadAll(input)
			if err != nil {
				return err
			}
			return os.WriteFile(target, []byte(strings.ReplaceAll(string(data), originalModule, module)), 0644)
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}

func randomSecret() string {
	data := make([]byte, 24)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(data)
}
func serializeEnv(value string) string {
	if strings.Contains(value, "\\") {
		encoded, _ := json.Marshal(value)
		return strings.ReplaceAll(string(encoded), "$", "\\$")
	}
	return "'" + strings.ReplaceAll(value, "'", "\\'") + "'"
}
