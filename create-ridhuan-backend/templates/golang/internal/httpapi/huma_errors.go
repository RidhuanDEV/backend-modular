package httpapi

import (
	"github.com/danielgtaylor/huma/v2"
)

// Huma's factory is process-global; set it once during package initialization,
// never during requests or per-server construction.
func init() {
	huma.NewError = func(status int, message string, errs ...error) huma.StatusError {
		if status == 422 {
			status = 400
		}
		details := []string{}
		for _, err := range errs {
			if detail, ok := err.(*huma.ErrorDetail); ok {
				details = append(details, detail.Location+": "+detail.Message)
			}
		}
		return &APIError{Status: status, Message: message, Errors: details}
	}
}
