package main

import (
	"flag"
	"log"
	"os"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
)

func main() {
	version := flag.Int64("to-version", 0, "apply up to a revision (0 applies all migrations)")
	flag.Parse()
	if *version < 0 {
		log.Fatal("to-version must not be negative")
	}
	if err := config.LoadEnvironment(".env"); err != nil {
		log.Fatal(err)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if err := db.MigrateProvider(os.Getenv("DB_PROVIDER"), url, *version); err != nil {
		log.Fatal(err)
	}
}
