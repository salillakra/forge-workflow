package db

import (
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

// Options holds database connection pool settings.
type Options struct {
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
}

// Connect opens and validates a Postgres connection pool.
func Connect(dsn string, opts Options) (*sqlx.DB, error) {
	db, err := sqlx.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(opts.MaxOpenConns)
	db.SetMaxIdleConns(opts.MaxIdleConns)
	db.SetConnMaxLifetime(opts.ConnMaxLifetime)

	if err := db.Ping(); err != nil {
		return nil, err
	}

	return db, nil
}

// MustConnect panics if the database connection fails. Safe for main().
func MustConnect(dsn string, opts Options) *sqlx.DB {
	db, err := Connect(dsn, opts)
	if err != nil {
		panic("failed to connect to database: " + err.Error())
	}
	return db
}
