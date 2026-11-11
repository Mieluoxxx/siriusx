package access

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Mieluoxxx/lite-cpa/internal/config"
)

func serve(c *Checker, key, path string) (int, Identity) {
	var got Identity
	h := c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = FromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code, got
}

func TestNoAdminConfiguredMeansEveryoneIsAdmin(t *testing.T) {
	c := New(config.KeysOf("sk-one-0123456789"))
	code, id := serve(c, "sk-one-0123456789", "/api/logs")
	if code != http.StatusOK || !id.Admin || id.Name != "sk-o…6789" {
		t.Fatalf("code=%d id=%+v", code, id)
	}
}

func TestNonAdminLimitedToBillingAndProxy(t *testing.T) {
	c := New([]config.GatewayKey{
		{Key: "sk-ops", Name: "ops", Admin: true},
		{Key: "sk-alice", Name: "alice"},
	})
	for path, want := range map[string]int{
		"/api/logs":            http.StatusForbidden,
		"/api/usage":           http.StatusForbidden,
		"/api/billing":         http.StatusOK,
		"/v1/chat/completions": http.StatusOK,
	} {
		if code, _ := serve(c, "sk-alice", path); code != want {
			t.Fatalf("alice %s: code=%d want %d", path, code, want)
		}
	}
	if code, id := serve(c, "sk-ops", "/api/logs"); code != http.StatusOK || id.Name != "ops" || !id.Admin {
		t.Fatalf("ops code=%d id=%+v", code, id)
	}
	if code, _ := serve(c, "sk-bogus", "/v1/models"); code != http.StatusUnauthorized {
		t.Fatalf("bogus code=%d", code)
	}
}
