package upload

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/projection"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/fault"
	"github.com/RidhuanDEV/golang-backend/internal/model"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/google/uuid"
	"io"
	"log/slog"
	"time"
)

type Service struct {
	Queries *sqlc.Queries
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

func (s *Service) Get(ctx context.Context, id string) (model.StoredFile, error) {
	if err := fault.UUID(id); err != nil {
		return model.StoredFile{}, err
	}
	row, err := s.Queries.FindFile(ctx, id)
	return projection.File(row), fault.DB(err)
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
	out, err := audit.Mutate(ctx, s.Audit, p, actor, "CREATE", func(q *sqlc.Queries) (model.StoredFile, audit.Change, error) {
		var uploader *string
		if actor != nil {
			value := actor.ID
			uploader = &value
		}
		row, err := q.CreateFile(ctx, sqlc.CreateFileParams{Storage: s.Kind, ObjectKey: key, OriginalName: input.Name, MimeType: input.MIME, Size: input.Size, UploaderID: uploader})
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
