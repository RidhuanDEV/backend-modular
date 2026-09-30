package main

import (
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"log"
	"os"

	"github.com/RidhuanDEV/golang-backend/internal/db"
)

func main() {
	if err := config.LoadEnvironment(".env"); err != nil {
		log.Fatal(err)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if err := db.Migrate(url); err != nil {
		log.Fatal(err)
	}
}
