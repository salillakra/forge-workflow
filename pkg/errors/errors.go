package errors

import (
	"fmt"
	"net/http"
)

// APIError is a structured error returned by the API.
type APIError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

func (e *APIError) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("[%d] %s: %s", e.Code, e.Message, e.Detail)
	}
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

// Common constructor helpers

func BadRequest(msg string) *APIError {
	return &APIError{Code: http.StatusBadRequest, Message: msg}
}

func Unauthorized(msg string) *APIError {
	return &APIError{Code: http.StatusUnauthorized, Message: msg}
}

func Forbidden(msg string) *APIError {
	return &APIError{Code: http.StatusForbidden, Message: msg}
}

func NotFound(resource string) *APIError {
	return &APIError{Code: http.StatusNotFound, Message: fmt.Sprintf("%s not found", resource)}
}

func Conflict(msg string) *APIError {
	return &APIError{Code: http.StatusConflict, Message: msg}
}

func Internal(msg string) *APIError {
	return &APIError{Code: http.StatusInternalServerError, Message: msg}
}

func Unprocessable(msg string) *APIError {
	return &APIError{Code: http.StatusUnprocessableEntity, Message: msg}
}

func WithDetail(err *APIError, detail string) *APIError {
	return &APIError{Code: err.Code, Message: err.Message, Detail: detail}
}
