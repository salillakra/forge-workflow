package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config holds all configuration for the application.
type Config struct {
	// Server
	AppEnv     string
	ServerPort string
	ServerHost string

	// Database
	DatabaseURL         string
	DBMaxOpenConns      int
	DBMaxIdleConns      int
	DBConnMaxLifetime   time.Duration

	// Redis
	RedisURL string

	// NATS
	NatsURL string

	// JWT
	JWTSecret              string
	JWTAccessTokenTTL      time.Duration
	JWTRefreshTokenTTL     time.Duration

	// Worker
	WorkerConcurrency int
	WorkerID          string

	// Observability
	OtelServiceName  string
	PrometheusPort   string
}

// Load reads configuration from environment variables (and optional .env file).
func Load() (*Config, error) {
	// Try to load .env — ignore error if not present (production uses real env vars)
	_ = godotenv.Load()

	cfg := &Config{
		AppEnv:     getEnv("APP_ENV", "development"),
		ServerPort: getEnv("SERVER_PORT", "8080"),
		ServerHost: getEnv("SERVER_HOST", "0.0.0.0"),

		DatabaseURL:       requireEnv("DATABASE_URL"),
		DBMaxOpenConns:    getEnvInt("DB_MAX_OPEN_CONNS", 25),
		DBMaxIdleConns:    getEnvInt("DB_MAX_IDLE_CONNS", 5),
		DBConnMaxLifetime: getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute),

		RedisURL: getEnv("REDIS_URL", "redis://localhost:6379/0"),
		NatsURL:  getEnv("NATS_URL", "nats://localhost:4222"),

		JWTSecret:          requireEnv("JWT_SECRET"),
		JWTAccessTokenTTL:  getEnvDuration("JWT_ACCESS_TOKEN_TTL", 15*time.Minute),
		JWTRefreshTokenTTL: getEnvDuration("JWT_REFRESH_TOKEN_TTL", 7*24*time.Hour),

		WorkerConcurrency: getEnvInt("WORKER_CONCURRENCY", 10),
		WorkerID:          getEnv("WORKER_ID", "worker-1"),

		OtelServiceName: getEnv("OTEL_SERVICE_NAME", "forge-api"),
		PrometheusPort:  getEnv("PROMETHEUS_PORT", "9090"),
	}

	return cfg, nil
}

func (c *Config) IsDevelopment() bool {
	return strings.EqualFold(c.AppEnv, "development")
}

func (c *Config) ServerAddr() string {
	return fmt.Sprintf("%s:%s", c.ServerHost, c.ServerPort)
}

// helpers 

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		// Return empty — caller can handle startup failure gracefully
		return ""
	}
	return v
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
