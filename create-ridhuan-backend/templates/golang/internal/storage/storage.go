package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Storage interface {
	Put(context.Context, string, io.Reader) error
	Delete(context.Context, string) error
}
type Local struct{ root string }

func NewLocal(root string) (*Local, error) {
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(absolute, 0700); err != nil {
		return nil, err
	}
	return &Local{root: absolute}, nil
}
func (l *Local) path(key string) (string, error) {
	if key == "" || strings.ContainsAny(key, "/\\") || key == "." || key == ".." {
		return "", errors.New("invalid object key")
	}
	return filepath.Join(l.root, key), nil
}
func (l *Local) Put(_ context.Context, key string, source io.Reader) error {
	path, err := l.path(key)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, source)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(path)
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	}
	return nil
}
func (l *Local) Delete(_ context.Context, key string) error {
	path, err := l.path(key)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

type S3 struct {
	client *s3.Client
	bucket string
}

func (s *S3) ListOlder(ctx context.Context, before time.Time) ([]string, error) {
	paginator := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket)})
	keys := []string{}
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, object := range page.Contents {
			if object.Key != nil && object.LastModified != nil && object.LastModified.Before(before) {
				keys = append(keys, *object.Key)
			}
		}
	}
	return keys, nil
}

func NewS3(ctx context.Context, c config.Config) (*S3, error) {
	options := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(c.S3Region), awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(c.S3AccessKey, c.S3SecretKey, ""))}
	if c.S3Endpoint != "" {
		options = append(options, awsconfig.WithBaseEndpoint(c.S3Endpoint))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, options...)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) { o.UsePathStyle = c.S3PathStyle })
	return &S3{client: client, bucket: c.S3Bucket}, nil
}
func (s *S3) Put(ctx context.Context, key string, source io.Reader) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key), Body: source})
	return err
}
func (s *S3) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	return err
}
