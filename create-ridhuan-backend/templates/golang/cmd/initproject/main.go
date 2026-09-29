package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
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
	port := ask(reader, "HTTP port", "3000")
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return errors.New("invalid HTTP port")
	}
	dbName := ask(reader, "PostgreSQL database name", strings.ReplaceAll(filepath.Base(name), "-", "_"))
	dbUser := ask(reader, "PostgreSQL username", "backend")
	dbPassword := ask(reader, "PostgreSQL password", "backend")
	if !sqlIdentifier.MatchString(dbName) || !sqlIdentifier.MatchString(dbUser) || strings.ContainsAny(dbPassword, "\r\n$") {
		return errors.New("database name/user must be SQL identifiers; password cannot contain newline or dollar sign")
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
	env := fmt.Sprintf(`NODE_ENV=development
PORT=%s
APP_PORT=%s
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
DATABASE_URL=postgres://%s:%s@localhost:5432/%s?sslmode=disable
JWT_SECRET=%s
POSTGRES_USER=%s
POSTGRES_PASSWORD=%s
POSTGRES_DB=%s
POSTGRES_PORT=5432
CACHE_ENABLED=%t
RATE_LIMIT_STORE=%s
REDIS_URL=redis://localhost:6379
APP_INSTANCE_COUNT=1
TRUST_PROXY_HOPS=0
ENDPOINT_POLICIES_JSON={}
UPLOAD_ENABLED=true
UPLOAD_STORAGE=%s
UPLOAD_LOCAL_DIR=./uploads
UPLOAD_MAX_BYTES=10485760
UPLOAD_ALLOWED_MIME=image/png,image/jpeg,application/pdf
`, port, port, url.QueryEscape(dbUser), url.QueryEscape(dbPassword), url.PathEscape(dbName), base64.RawURLEncoding.EncodeToString(secret), dbUser, dbPassword, dbName, redisEnabled, rateStore, storageChoice)
	profiles := []string{}
	if redisEnabled {
		profiles = append(profiles, "redis")
	}
	if storageChoice == "s3" {
		profiles = append(profiles, "minio")
	}
	env += "COMPOSE_PROFILES=" + strings.Join(profiles, ",") + "\n"
	if storageChoice == "s3" {
		env += `S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=uploads
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
`
	}
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
	allowed := map[string]struct{}{".github": {}, "cmd": {}, "contracts": {}, "internal": {}, ".dockerignore": {}, ".env.example": {}, ".gitignore": {}, "Dockerfile": {}, "compose.yaml": {}, "compose.override.yaml.example": {}, "go.mod": {}, "go.sum": {}, "README.md": {}, "sqlc.yaml": {}, "CONTRIBUTING.md": {}, "SECURITY.md": {}, "CHANGELOG.md": {}}
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
