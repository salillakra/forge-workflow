package utils

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/google/uuid"
)

// NewID generates a new UUID v4 string.
func NewID() string {
	return uuid.New().String()
}

// RandomHex generates n random hex-encoded bytes.
func RandomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Ptr returns a pointer to the given value.
func Ptr[T any](v T) *T {
	return &v
}

// Deref safely dereferences a pointer, returning zero value if nil.
func Deref[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}

// Contains reports whether slice s contains element e.
func Contains[T comparable](s []T, e T) bool {
	for _, v := range s {
		if v == e {
			return true
		}
	}
	return false
}
