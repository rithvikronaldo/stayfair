package ledger

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DemoTenantID is the fixed UUID seeded by migration 006_tenants.up.sql.
// The public dashboard reads under this tenant without auth; signup
// creates new ones.
var DemoTenantID = uuid.MustParse("00000000-0000-0000-0000-000000000010")

// Tenant is the public shape returned by signup / lookup.
type Tenant struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

var (
	ErrTenantNotFound = errors.New("ledger: tenant not found")
	ErrTenantExists   = errors.New("ledger: tenant email already exists")
)

// CreateTenant generates a fresh API key, stores its SHA-256 hash, and
// returns the tenant along with the raw key. The raw key is returned ONCE
// — caller MUST echo it to the end user and not log it. We never store
// the raw value, so it's unrecoverable after this call.
func CreateTenant(
	ctx context.Context,
	pool *pgxpool.Pool,
	email, name string,
) (*Tenant, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return nil, "", fmt.Errorf("ledger: email is required")
	}

	rawKey, err := generateAPIKey()
	if err != nil {
		return nil, "", fmt.Errorf("generate api key: %w", err)
	}
	hash := hashAPIKey(rawKey)

	var t Tenant
	t.Email = email
	t.Name = name
	err = pool.QueryRow(ctx, `
		INSERT INTO tenants (email, api_key_hash, name)
		VALUES ($1, $2, NULLIF($3, ''))
		RETURNING id, created_at
	`, email, hash, name).Scan(&t.ID, &t.CreatedAt)
	if err != nil {
		// 23505 is unique_violation; the column is tenants_email_key.
		if strings.Contains(err.Error(), "tenants_email_key") {
			return nil, "", fmt.Errorf("%w: %q", ErrTenantExists, email)
		}
		return nil, "", fmt.Errorf("insert tenant: %w", err)
	}
	return &t, rawKey, nil
}

// LookupTenantByAPIKey hashes the raw key and finds the matching tenant.
// Called by the auth middleware on every authenticated request — keep
// it allocation-light. Returns ErrTenantNotFound if no row matches.
func LookupTenantByAPIKey(
	ctx context.Context,
	pool *pgxpool.Pool,
	rawKey string,
) (*Tenant, error) {
	rawKey = strings.TrimSpace(rawKey)
	if rawKey == "" {
		return nil, ErrTenantNotFound
	}
	hash := hashAPIKey(rawKey)

	var t Tenant
	err := pool.QueryRow(ctx, `
		SELECT id, email, COALESCE(name, ''), created_at
		FROM tenants
		WHERE api_key_hash = $1
	`, hash).Scan(&t.ID, &t.Email, &t.Name, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTenantNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lookup tenant: %w", err)
	}
	return &t, nil
}

// IsDemoTenant returns true if id is the seeded demo tenant. Used by
// the public read paths.
func IsDemoTenant(id uuid.UUID) bool {
	return id == DemoTenantID
}

// generateAPIKey returns a 32-byte cryptographically-random key encoded
// as URL-safe base64 with a "sf_" prefix. ~46 chars total. Fits in an
// Authorization header without escaping; prefix makes leaked keys easier
// to grep for (a la GitHub's ghp_).
func generateAPIKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "sf_" + base64.RawURLEncoding.EncodeToString(b), nil
}

// hashAPIKey returns hex(sha256(rawKey)). Migration 006 seeds the demo
// tenant with hashAPIKey("stayfair-demo-public-key") — that hash is
// reproducible in psql so the seed insert is self-contained.
func hashAPIKey(rawKey string) string {
	h := sha256.Sum256([]byte(rawKey))
	return hex.EncodeToString(h[:])
}
