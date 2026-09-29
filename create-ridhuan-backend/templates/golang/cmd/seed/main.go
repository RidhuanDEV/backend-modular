package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	_ = godotenv.Load()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	q := sqlc.New(pool)
	for _, name := range []string{"admin", "user"} {
		if err = q.SeedRole(ctx, name); err != nil {
			log.Fatal(err)
		}
	}
	for _, name := range []string{"manage_users", "manage_roles", "manage_permissions", "manage_uploads", "manage_notifications"} {
		if err = q.SeedPermission(ctx, name); err != nil {
			log.Fatal(err)
		}
	}
	err = q.SeedAdminPermissions(ctx)
	if err != nil {
		log.Fatal(err)
	}
	for _, entry := range []struct{ email, password, role string }{{os.Getenv("ADMIN_EMAIL"), os.Getenv("ADMIN_PASSWORD"), "admin"}, {os.Getenv("USER_EMAIL"), os.Getenv("USER_PASSWORD"), "user"}} {
		if entry.email == "" || entry.password == "" {
			continue
		}
		if len(entry.password) < 6 {
			log.Fatal("bootstrap password must contain at least six characters")
		}
		// Template placeholders are public; never let them become a production login.
		if os.Getenv("NODE_ENV") == "production" && (len(entry.password) < 12 || strings.Contains(strings.ToLower(entry.password), "replace")) {
			log.Fatal("bootstrap passwords must be generated values of at least 12 characters in production")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(entry.password), 12)
		if err != nil {
			log.Fatal(err)
		}
		err = q.SeedUser(ctx, sqlc.SeedUserParams{Lower: strings.TrimSpace(entry.email), Password: string(hash), Name: entry.role})
		if err != nil {
			log.Fatal(err)
		}
	}
	log.Println("seed completed")
}
