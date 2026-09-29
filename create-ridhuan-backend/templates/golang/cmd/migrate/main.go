package main

import (
	"log"
	"os"

	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if err := db.Migrate(url); err != nil {
		log.Fatal(err)
	}
}
