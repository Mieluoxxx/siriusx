package config

import (
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func parseValidated(t *testing.T, raw string) (*Config, error) {
	t.Helper()
	var cfg Config
	if err := yaml.Unmarshal([]byte(raw), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg.applyDefaults()
	return &cfg, cfg.validate()
}

const providerTail = "openai-completions: [{name: x, base-url: http://x, api-key: a, models: [{name: m}]}]\n"

func TestGatewayKeysMixedForms(t *testing.T) {
	cfg, err := parseValidated(t, `
api-keys:
  - sk-legacy-0123456789
  - k
  - {key: sk-alice, name: alice}
  - {key: sk-ops, name: ops, admin: true}
`+providerTail)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.APIKeys) != 4 {
		t.Fatalf("keys=%+v", cfg.APIKeys)
	}
	if got := cfg.APIKeys[0].ResolvedName(); got != "sk-l…6789" {
		t.Fatalf("masked name %q", got)
	}
	if got := cfg.APIKeys[1].ResolvedName(); !strings.HasPrefix(got, "key-") || strings.Contains(got, "k…") || len(got) != len("key-")+8 {
		t.Fatalf("short key name %q", got)
	}
	if k := cfg.APIKeys[2]; k.Key != "sk-alice" || k.ResolvedName() != "alice" || k.Admin {
		t.Fatalf("alice %+v", k)
	}
	if k := cfg.APIKeys[3]; !k.Admin || k.ResolvedName() != "ops" {
		t.Fatalf("ops %+v", k)
	}
}

func TestGatewayKeysRejectDuplicates(t *testing.T) {
	for name, keys := range map[string]string{
		"dup key":  "api-keys: [a, a]\n",
		"dup name": "api-keys: [{key: a, name: x}, {key: b, name: x}]\n",
		"empty":    "api-keys: [{name: x}]\n",
	} {
		if _, err := parseValidated(t, keys+providerTail); err == nil {
			t.Fatalf("%s: expected validation error", name)
		}
	}
}

func TestModelPricingValidate(t *testing.T) {
	cfg, err := parseValidated(t, `
api-keys: [k]
openai-completions:
  - name: x
    base-url: http://x
    api-key: a
    models:
      - {name: m, pricing: {input: 3, output: 15, cache-read: 0.3}}
`)
	if err != nil {
		t.Fatal(err)
	}
	p := cfg.OpenAICompletions[0].Models[0].Pricing
	if p == nil || p.Input != 3 || p.Output != 15 || p.CacheRead == nil || *p.CacheRead != 0.3 {
		t.Fatalf("pricing %+v", p)
	}
	if _, err := parseValidated(t, `
api-keys: [k]
openai-completions:
  - {name: x, base-url: http://x, api-key: a, models: [{name: m, pricing: {input: -1}}]}
`); err == nil {
		t.Fatal("negative pricing accepted")
	}
}
