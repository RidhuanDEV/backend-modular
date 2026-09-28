package httpapi

import (
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/upload"
	"io"
	"net/http"
)

func (s *Server) mountUploads() {
	register[UploadInput, StoredFile](s, "upload.create", func(ctx context.Context, input *UploadInput, actor *Actor) (Success[StoredFile], error) {
		var zero Success[StoredFile]
		if !s.Config.UploadEnabled {
			return zero, &APIError{Status: 503, Message: "Upload disabled", Errors: []string{}}
		}
		defer input.RawBody.Form.RemoveAll()
		header := input.RawBody.Data().File
		source := header.File
		defer source.Close()

		if header.Size > s.Config.UploadMaxBytes {
			return zero, &APIError{Status: 413, Message: "File too large", Errors: []string{}}
		}
		prefix := make([]byte, 512)
		n, err := io.ReadFull(source, prefix)
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			return zero, badRequest("Invalid file")
		}
		mime := http.DetectContentType(prefix[:n])
		if _, ok := s.Config.UploadAllowedMIME[mime]; !ok {
			return zero, badRequest("File type is not allowed")
		}
		if _, err := source.Seek(0, io.SeekStart); err != nil {
			return zero, internal()
		}
		file, err := s.Uploads.Create(ctx, s.policy(ctx, "upload.create"), actor, upload.Input{Source: source, Name: header.Filename, MIME: mime, Size: header.Size})
		if err != nil {
			return zero, err
		}
		return ok(file), nil
	})
	register[IDInput, StoredFile](s, "upload.get", func(ctx context.Context, input *IDInput, _ *Actor) (Success[StoredFile], error) {
		file, err := s.Uploads.Get(ctx, input.ID)
		return ok(file), err
	})

}
