package logger

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Logger wraps zap.Logger to provide structured logging.
type Logger = zap.Logger

// New builds a production or development zap logger.
func New(isDev bool) (*zap.Logger, error) {
	var cfg zap.Config
	if isDev {
		cfg = zap.NewDevelopmentConfig()
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	} else {
		cfg = zap.NewProductionConfig()
	}
	return cfg.Build()
}

// Must panics if logger construction fails. Safe for main().
func Must(isDev bool) *zap.Logger {
	log, err := New(isDev)
	if err != nil {
		panic(err)
	}
	return log
}

// With returns a child logger with additional fields.
func With(log *zap.Logger, fields ...zap.Field) *zap.Logger {
	return log.With(fields...)
}
