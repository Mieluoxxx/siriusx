package reqlog

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"time"
)

// BillingBucket is one billing_hourly row: totals for a UTC hour, gateway key
// name and model. Request counters follow UsageBucket: only final rows count.
type BillingBucket struct {
	Hour         int64  `json:"hour,omitempty"`
	APIKey       string `json:"api_key"`
	Model        string `json:"model,omitempty"`
	Requests     int64  `json:"requests"`
	Success      int64  `json:"success"`
	Errors       int64  `json:"errors"`
	InputTokens  int64  `json:"input_tokens"`
	OutputTokens int64  `json:"output_tokens"`
	CachedTokens int64  `json:"cached_tokens"`
	CostMicros   int64  `json:"-"`
	LastSeenMS   int64  `json:"last_seen_ms"`
}

func billingDelta(r Record) BillingBucket {
	u := usageDelta(r)
	b := BillingBucket{
		Hour:         u.Hour,
		APIKey:       r.APIKey,
		Model:        r.Model,
		Requests:     u.Requests,
		Success:      u.Success,
		Errors:       u.Errors,
		InputTokens:  u.InputTokens,
		OutputTokens: u.OutputTokens,
		CachedTokens: u.CachedTokens,
		LastSeenMS:   u.LastSeenMS,
	}
	if r.UsageComplete {
		b.CostMicros = r.CostMicros
	}
	return b
}

func (b *BillingBucket) add(o BillingBucket) {
	b.Requests += o.Requests
	b.Success += o.Success
	b.Errors += o.Errors
	b.InputTokens += o.InputTokens
	b.OutputTokens += o.OutputTokens
	b.CachedTokens += o.CachedTokens
	b.CostMicros += o.CostMicros
	if o.LastSeenMS > b.LastSeenMS {
		b.LastSeenMS = o.LastSeenMS
	}
}

// DailyBilling is billing for one local day, gateway key and model.
type DailyBilling struct {
	Day string `json:"day"`
	BillingBucket
	CostUSD float64 `json:"cost_usd"`
}

// BillingTotal is billing for one gateway key over the whole window.
type BillingTotal struct {
	BillingBucket
	CostUSD float64 `json:"cost_usd"`
}

func microsToUSD(m int64) float64 { return float64(m) / 1e6 }

// AggregateBilling folds hourly buckets into local days per key and model,
// plus per-key totals sorted by cost descending.
func AggregateBilling(buckets []BillingBucket, offsetSeconds int64) ([]DailyBilling, []BillingTotal) {
	type dayKey struct {
		day           int64
		apiKey, model string
	}
	days := make(map[dayKey]*DailyBilling)
	totals := make(map[string]*BillingTotal)
	for _, b := range buckets {
		k := dayKey{floorDiv(b.Hour+offsetSeconds, 86400), b.APIKey, b.Model}
		d, ok := days[k]
		if !ok {
			d = &DailyBilling{Day: dayLabel(k.day)}
			d.APIKey, d.Model = b.APIKey, b.Model
			days[k] = d
		}
		d.add(b)
		t, ok := totals[b.APIKey]
		if !ok {
			t = &BillingTotal{}
			t.APIKey = b.APIKey
			totals[b.APIKey] = t
		}
		t.add(b)
	}
	items := make([]DailyBilling, 0, len(days))
	for _, d := range days {
		d.Hour = 0
		d.CostUSD = microsToUSD(d.CostMicros)
		items = append(items, *d)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Day != items[j].Day {
			return items[i].Day < items[j].Day
		}
		if items[i].APIKey != items[j].APIKey {
			return items[i].APIKey < items[j].APIKey
		}
		return items[i].Model < items[j].Model
	})
	out := make([]BillingTotal, 0, len(totals))
	for _, t := range totals {
		t.CostUSD = microsToUSD(t.CostMicros)
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CostMicros != out[j].CostMicros {
			return out[i].CostMicros > out[j].CostMicros
		}
		return out[i].APIKey < out[j].APIKey
	})
	return items, out
}

// Billing returns hourly billing buckets when logging is enabled.
func (l *Logger) Billing(ctx context.Context, from, to time.Time, apiKey string) ([]BillingBucket, error) {
	if l == nil || !l.Enabled() {
		return []BillingBucket{}, nil
	}
	return l.store.Billing(ctx, from, to, apiKey)
}

// ensureBillingHourly mirrors ensureUsageHourly: create once and backfill from
// existing rows in the same transaction.
func (s *SQLiteStore) ensureBillingHourly() error {
	var exists int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'billing_hourly'`).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`
CREATE TABLE billing_hourly (
  hour INTEGER NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  last_seen_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, api_key, model)
) WITHOUT ROWID`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
INSERT INTO billing_hourly (hour, api_key, model, requests, success, errors,
  input_tokens, output_tokens, cached_tokens, cost_micros, last_seen_ms)
SELECT ts / 1000000000 / 3600 * 3600, api_key, model,
  SUM(CASE WHEN retried THEN 0 ELSE 1 END),
  SUM(CASE WHEN NOT retried AND outcome = 'completed' THEN 1 ELSE 0 END),
  SUM(CASE WHEN NOT retried AND outcome = 'error' THEN 1 ELSE 0 END),
  SUM(CASE WHEN usage_complete THEN input_tokens ELSE 0 END),
  SUM(CASE WHEN usage_complete THEN output_tokens ELSE 0 END),
  SUM(CASE WHEN usage_complete THEN cached_tokens ELSE 0 END),
  SUM(CASE WHEN usage_complete THEN cost_micros ELSE 0 END),
  MAX(ts) / 1000000
FROM request_logs
GROUP BY 1, 2, 3`); err != nil {
		return fmt.Errorf("backfill billing_hourly: %w", err)
	}
	return tx.Commit()
}

func upsertBilling(ctx context.Context, tx *sql.Tx, d BillingBucket) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO billing_hourly (hour, api_key, model, requests, success, errors,
  input_tokens, output_tokens, cached_tokens, cost_micros, last_seen_ms)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (hour, api_key, model) DO UPDATE SET
  requests = requests + excluded.requests,
  success = success + excluded.success,
  errors = errors + excluded.errors,
  input_tokens = input_tokens + excluded.input_tokens,
  output_tokens = output_tokens + excluded.output_tokens,
  cached_tokens = cached_tokens + excluded.cached_tokens,
  cost_micros = cost_micros + excluded.cost_micros,
  last_seen_ms = MAX(last_seen_ms, excluded.last_seen_ms)`,
		d.Hour, d.APIKey, d.Model, d.Requests, d.Success, d.Errors,
		d.InputTokens, d.OutputTokens, d.CachedTokens, d.CostMicros, d.LastSeenMS)
	return err
}

func (s *SQLiteStore) Billing(ctx context.Context, from, to time.Time, apiKey string) ([]BillingBucket, error) {
	q := `
SELECT hour, api_key, model, requests, success, errors,
  input_tokens, output_tokens, cached_tokens, cost_micros, last_seen_ms
FROM billing_hourly WHERE hour >= ? AND hour < ?`
	args := []any{from.Unix(), to.Unix()}
	if apiKey != "" {
		q += ` AND api_key = ?`
		args = append(args, apiKey)
	}
	rows, err := s.db.QueryContext(ctx, q+` ORDER BY hour`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BillingBucket{}
	for rows.Next() {
		var b BillingBucket
		if err := rows.Scan(&b.Hour, &b.APIKey, &b.Model, &b.Requests, &b.Success, &b.Errors,
			&b.InputTokens, &b.OutputTokens, &b.CachedTokens, &b.CostMicros, &b.LastSeenMS); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
