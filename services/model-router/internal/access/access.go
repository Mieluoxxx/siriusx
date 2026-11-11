package access

import (
	"context"
	"net/http"
	"strings"
	"sync"

	"github.com/Mieluoxxx/lite-cpa/internal/config"
)

// Identity is the authenticated gateway key behind a request.
type Identity struct {
	Name  string
	Admin bool
}

type ctxKey struct{}

// FromContext returns the identity the middleware attached to the request.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(ctxKey{}).(Identity)
	return id, ok
}

// WithIdentity attaches an identity to ctx.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

type Checker struct {
	mu   sync.RWMutex
	keys map[string]Identity
}

func New(keys []config.GatewayKey) *Checker {
	return &Checker{keys: keySet(keys)}
}

// Replace swaps the accepted gateway API keys.
func (c *Checker) Replace(keys []config.GatewayKey) {
	m := keySet(keys)
	c.mu.Lock()
	c.keys = m
	c.mu.Unlock()
}

// keySet treats every key as admin when none is marked, so configs written
// before admin existed keep full access to the monitor API.
func keySet(keys []config.GatewayKey) map[string]Identity {
	anyAdmin := false
	for _, k := range keys {
		anyAdmin = anyAdmin || k.Admin
	}
	m := make(map[string]Identity, len(keys))
	for _, k := range keys {
		key := strings.TrimSpace(k.Key)
		if key != "" {
			m[key] = Identity{Name: k.ResolvedName(), Admin: k.Admin || !anyAdmin}
		}
	}
	return m
}

func (c *Checker) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Public: health, root, and embedded monitor assets. /api/logs* still
		// require a gateway key (the browser prompts once and stores it locally).
		if r.URL.Path == "/healthz" || r.URL.Path == "/" || r.URL.Path == "/dashboard" || r.URL.Path == "/dashboard.html" || strings.HasPrefix(r.URL.Path, "/dashboard/") {
			next.ServeHTTP(w, r)
			return
		}
		key := extractKey(r)
		if key == "" {
			writeUnauthorized(w, "missing api key")
			return
		}
		c.mu.RLock()
		id, ok := c.keys[key]
		c.mu.RUnlock()
		if !ok {
			writeUnauthorized(w, "invalid api key")
			return
		}
		if !id.Admin && strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/billing" {
			writeForbidden(w, "this api key is not allowed to access the monitor api")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithIdentity(r.Context(), id)))
	})
}

func extractKey(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); auth != "" {
		const prefix = "Bearer "
		if strings.HasPrefix(auth, prefix) {
			return strings.TrimSpace(auth[len(prefix):])
		}
		return strings.TrimSpace(auth)
	}
	if k := r.Header.Get("x-api-key"); k != "" {
		return strings.TrimSpace(k)
	}
	if k := r.Header.Get("api-key"); k != "" {
		return strings.TrimSpace(k)
	}
	return ""
}

func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":{"message":"` + msg + `","type":"authentication_error","code":"invalid_api_key"}}`))
}

func writeForbidden(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(`{"error":{"message":"` + msg + `","type":"permission_error"}}`))
}
