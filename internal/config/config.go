package config

import "os"

type Config struct {
	DBURL string
	Port  string
}

func Load() Config {
	return Config{
		DBURL: getenv("DB_URL", "postgres://postgres:postgres@localhost:5433/stayfair?sslmode=disable"),
		Port:  getenv("PORT", "8080"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
