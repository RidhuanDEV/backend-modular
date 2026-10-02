package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/jobs"
	"github.com/google/uuid"

	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	apply := flag.Bool("apply", false, "delete orphan objects; default only lists them")
	dryRun := flag.Bool("dry-run", false, "list candidates without deletion")
	flag.Parse()
	if *dryRun && *apply {
		return fmt.Errorf("--apply and --dry-run are mutually exclusive")
	}
	if err := config.LoadEnvironment(".env"); err != nil {
		return err
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	shutdown, err := telemetry.Setup(ctx, c)
	if err != nil {
		return err
	}
	defer func() {
		end, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		_ = shutdown(end)
	}()
	pool, err := db.ConnectProvider(ctx, c.DatabaseProvider, c.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err = jobs.Cleanup(ctx, pool, c.Operations, *apply); err != nil {
		return err
	}
	before := time.Now().Add(-time.Duration(c.UploadOrphanGraceHours) * time.Hour)
	var keys []string
	var store storage.Storage
	if c.UploadStorage == "s3" {
		s3store, e := storage.NewS3(ctx, c)
		if e != nil {
			return e
		}
		store = s3store
		keys, err = s3store.ListOlder(ctx, before)
		if err != nil {
			return err
		}
	} else {
		local, e := storage.NewLocal(c.UploadLocalDir)
		if e != nil {
			return e
		}
		store = local
		entries, e := os.ReadDir(c.UploadLocalDir)
		if e != nil {
			return e
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			info, e := entry.Info()
			if e != nil {
				if os.IsNotExist(e) {
					continue
				}
				return e
			}
			if info.ModTime().Before(before) {
				keys = append(keys, entry.Name())
			}
		}
	}
	candidates := 0
	for _, key := range keys {
		if candidates >= c.Operations.BatchSize {
			break
		}
		if len(key) != 36 || uuid.Validate(key) != nil {
			continue
		}
		exists, queryErr := pool.Queries().FileReferenced(ctx, sqlc.FileReferencedParams{ObjectKey: key, Storage: c.UploadStorage})
		if err = queryErr; err != nil {
			return err
		}
		if exists {
			continue
		}
		display := key
		if c.UploadStorage == "local" {
			display = filepath.Join(c.UploadLocalDir, key)
		}
		candidates++
		fmt.Println(display)
		if *apply {
			referenced, err := pool.Queries().FileReferenced(ctx, sqlc.FileReferencedParams{ObjectKey: key, Storage: c.UploadStorage})
			if err != nil {
				return err
			}
			if referenced {
				continue
			}
			if err = store.Delete(ctx, key); err != nil {
				return err
			}
			telemetry.Cleanup(ctx, "upload", 1, true)
		}
		if !*apply {
			telemetry.Cleanup(ctx, "upload", 1, false)
		}
	}
	return nil
}
