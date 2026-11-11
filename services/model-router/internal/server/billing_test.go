package server_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Mieluoxxx/lite-cpa/internal/config"
	"github.com/Mieluoxxx/lite-cpa/internal/reqlog"
	"github.com/Mieluoxxx/lite-cpa/internal/server"
	"github.com/Mieluoxxx/lite-cpa/internal/translator"
)

type billingResp struct {
	Meta struct {
		Admin bool   `json:"admin"`
		Key   string `json:"key"`
	} `json:"meta"`
	Items []struct {
		APIKey string  `json:"api_key"`
		Model  string  `json:"model"`
		Cost   float64 `json:"cost_usd"`
	} `json:"items"`
	Totals []struct {
		APIKey       string  `json:"api_key"`
		Requests     int64   `json:"requests"`
		InputTokens  int64   `json:"input_tokens"`
		CachedTokens int64   `json:"cached_tokens"`
		Cost         float64 `json:"cost_usd"`
	} `json:"totals"`
}

func TestBillingPerGatewayKey(t *testing.T) {
	translator.RegisterBuiltin()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"c1","object":"chat.completion","created":1,"model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":100,"total_tokens":1100,"prompt_tokens_details":{"cached_tokens":400}}}`)
	}))
	t.Cleanup(up.Close)

	logger, err := reqlog.Open(config.RequestLogConfig{
		Enabled: true, Backend: "sqlite", Retention: "1h",
		SQLite: config.SQLiteLogConfig{Path: filepath.Join(t.TempDir(), "requests.db")},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = logger.Close() })

	cacheRead := 0.3
	port := freePort(t)
	srv := server.New(&config.Config{
		Host: "127.0.0.1", Port: port, MaxBodyBytes: 1 << 20,
		APIKeys: []config.GatewayKey{
			{Key: "sk-ops", Name: "ops", Admin: true},
			{Key: "sk-alice", Name: "alice"},
		},
		OpenAICompletions: []config.Provider{{
			Name: "up", BaseURL: up.URL + "/v1", APIKey: "sk-up",
			Models: []config.ModelAlias{
				{Name: "m", Pricing: &config.ModelPricing{Input: 3, Output: 15, CacheRead: &cacheRead}},
				{Name: "free"},
			},
		}},
	}, logger)
	go func() { _ = srv.ListenAndServe() }()
	t.Cleanup(func() { _ = srv.Shutdown(t.Context()) })
	baseURL := "http://127.0.0.1:" + strconv.Itoa(port)
	waitHTTP(t, baseURL+"/healthz")

	call := func(key, model string) {
		req, _ := http.NewRequest(http.MethodPost, baseURL+"/v1/chat/completions", strings.NewReader(`{"model":"`+model+`","messages":[{"role":"user","content":"hi"}]}`))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s %s: status %d %s", key, model, resp.StatusCode, body)
		}
	}
	call("sk-alice", "m")
	call("sk-alice", "free")
	call("sk-ops", "m")

	billing := func(key, query string) billingResp {
		req, _ := http.NewRequest(http.MethodGet, baseURL+"/api/billing?days=1"+query, nil)
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("billing status %d %s", resp.StatusCode, body)
		}
		var out billingResp
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	// Rows are written asynchronously.
	var all billingResp
	for deadline := time.Now().Add(2 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		all = billing("sk-ops", "")
		var n int64
		for _, tot := range all.Totals {
			n += tot.Requests
		}
		if n == 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("billing never reached 3 requests: %+v", all)
		}
	}
	// 600*3 + 400*0.3 + 100*15 = 3420 micro-USD per priced call.
	const priced = 0.00342
	if !all.Meta.Admin || len(all.Totals) != 2 {
		t.Fatalf("admin view %+v", all)
	}
	for _, tot := range all.Totals {
		if tot.Cost != priced {
			t.Fatalf("%s cost %v want %v", tot.APIKey, tot.Cost, priced)
		}
		if tot.APIKey == "alice" && (tot.Requests != 2 || tot.InputTokens != 2000 || tot.CachedTokens != 800) {
			t.Fatalf("alice total %+v", tot)
		}
	}

	own := billing("sk-alice", "&key=ops")
	if own.Meta.Admin || own.Meta.Key != "alice" || len(own.Totals) != 1 || own.Totals[0].APIKey != "alice" {
		t.Fatalf("non-admin saw other keys: %+v", own)
	}
	for _, it := range own.Items {
		if it.APIKey != "alice" {
			t.Fatalf("non-admin item %+v", it)
		}
	}

	req, _ := http.NewRequest(http.MethodGet, baseURL+"/api/logs", nil)
	req.Header.Set("Authorization", "Bearer sk-alice")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin /api/logs status %d", resp.StatusCode)
	}

	logs, err := logger.List(t.Context(), reqlog.ListFilter{Limit: 10, APIKey: "alice"})
	if err != nil {
		t.Fatal(err)
	}
	if logs.Total != 2 {
		t.Fatalf("alice log rows %d", logs.Total)
	}
}
