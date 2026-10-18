package upload

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"github.com/RidhuanDEV/golang-backend/internal/role"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/google/uuid"
	"io"
	"log/slog"
	"strings"
	"time"
)

type Service struct {
	Queries sqlc.Querier
	Audit   *audit.Writer
	Storage storage.Storage
	Kind    string
	Log     *slog.Logger
}
type Input struct {
	Source     io.ReaderAt
	Name, MIME string
	Size       int64
}

// Get returns a file to its uploader or a root user; others get 404 so
// existence is not revealed.
func (s *Service) Get(ctx context.Context, actor *audit.Actor, id string) (model.StoredFile, error) {
	if err := fault.UUID(id); err != nil {
		return model.StoredFile{}, err
	}
	row, err := s.Queries.FindFile(ctx, id)
	if err != nil {
		return model.StoredFile{}, fault.DB(err)
	}
	if actor == nil {
		return model.StoredFile{}, fault.New(fault.Missing, "Not found")
	}
	if row.UploaderID == nil || *row.UploaderID != actor.ID {
		root, err := role.IsRootRole(ctx, s.Queries, actor.RoleID)
		if err != nil {
			return model.StoredFile{}, err
		}
		if !root {
			return model.StoredFile{}, fault.New(fault.Missing, "Not found")
		}
	}
	return projection.File(row), nil
}

// cleanName keeps only the final path segment of a client file name and caps
// it to the 255-character column, so a long or path-like name cannot fail the
// insert after the object is already stored.
func cleanName(name string) string {
	name = strings.TrimSpace(name[strings.LastIndexAny(name, `/\`)+1:])
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	if runes := []rune(name); len(runes) > 255 {
		return string(runes[:255])
	}
	return name
}
func (s *Service) Create(ctx context.Context, p audit.Policy, actor *audit.Actor, input Input) (model.StoredFile, error) {
	if s.Storage == nil {
		return model.StoredFile{}, fault.New(fault.Unavailable, "Upload disabled")
	}
	key := uuid.NewString()
	if err := s.Storage.Put(ctx, key, io.NewSectionReader(input.Source, 0, input.Size)); err != nil {
		s.Log.Error("upload storage write failed", "storage", s.Kind, "error", err)
		return model.StoredFile{}, fault.DB(err)
	}
	out, err := audit.Mutate(ctx, s.Audit, p, actor, "CREATE", func(q sqlc.Querier) (model.StoredFile, audit.Change, error) {
		var uploader *string
		if actor != nil {
			value := actor.ID
			uploader = &value
		}
		row, err := q.CreateFile(ctx, sqlc.CreateFileParams{Storage: s.Kind, ObjectKey: key, OriginalName: cleanName(input.Name), MimeType: input.MIME, Size: input.Size, UploaderID: uploader})
		if err != nil {
			return model.StoredFile{}, audit.Change{}, fault.DB(err)
		}
		out := projection.File(row)
		change, err := audit.Capture(out.ID, (*model.StoredFile)(nil), &out)
		return out, change, err
	})
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if failure := s.Storage.Delete(cleanup, key); failure != nil {
			s.Log.Warn("upload cleanup failed", "key", key, "storage", s.Kind, "error", failure)
		}
	}
	return out, err
}
func (s *Service) Referenced(ctx context.Context, key string) (bool, error) {
	return s.Queries.FileReferenced(ctx, sqlc.FileReferencedParams{ObjectKey: key, Storage: s.Kind})
}
