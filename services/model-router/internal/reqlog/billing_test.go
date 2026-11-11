package reqlog

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteInsertMaintainsBillingHourly(t *testing.T) {
	store := openTestSQLite(t)
	ctx := context.Background()
	hour := time.Date(2026, 10, 1, 23, 0, 0, 0, time.UTC)

	for _, r := range []Record{
		{RequestID: "a", Timestamp: hour.Add(time.Minute), APIKey: "alice", Model: "gpt-5", StatusCode: 502, Outcome: OutcomeError, Retried: true},
		{RequestID: "a", Timestamp: hour.Add(2 * time.Minute), APIKey: "alice", Model: "gpt-5", StatusCode: 200, Outcome: OutcomeCompleted,
			InputTokens: 100, OutputTokens: 10, CachedTokens: 40, UsageComplete: true, CostMicros: 500},
		// Cost on an incomplete row must not be billed.
		{RequestID: "b", Timestamp: hour.Add(3 * time.Minute), APIKey: "alice", Model: "gpt-5", StatusCode: 200, Outcome: OutcomeClientCanceled, CostMicros: 999},
		{RequestID: "c", Timestamp: hour.Add(61 * time.Minute), APIKey: "bob", Model: "claude", StatusCode: 200, Outcome: OutcomeCompleted,
			InputTokens: 5, OutputTokens: 1, UsageComplete: true, CostMicros: 2_000_000},
	} {
		if err := store.Insert(ctx, r); err != nil {
			t.Fatal(err)
		}
	}

	all, err := store.Billing(ctx, hour, hour.Add(2*time.Hour), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("buckets=%+v", all)
	}
	a := all[0]
	if a.APIKey != "alice" || a.Requests != 2 || a.Success != 1 || a.InputTokens != 100 || a.CostMicros != 500 {
		t.Fatalf("alice bucket %+v", a)
	}
	only, err := store.Billing(ctx, hour, hour.Add(2*time.Hour), "bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(only) != 1 || only[0].APIKey != "bob" {
		t.Fatalf("bob filter %+v", only)
	}

	// UTC+8 puts 23:xx and 00:xx UTC on the same local day.
	items, totals := AggregateBilling(all, 8*3600)
	if len(items) != 2 || items[0].Day != "2026-10-02" || items[1].Day != "2026-10-02" {
		t.Fatalf("items %+v", items)
	}
	if len(totals) != 2 || totals[0].APIKey != "bob" || totals[0].CostUSD != 2 || totals[1].CostUSD != 0.0005 {
		t.Fatalf("totals %+v", totals)
	}
}

func TestBillingHourlyBackfillsExistingRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "requests.db")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	ts := time.Date(2026, 10, 1, 10, 30, 0, 0, time.UTC)
	if err := store.Insert(ctx, Record{RequestID: "x", Timestamp: ts, APIKey: "alice", Model: "m", StatusCode: 200,
		Outcome: OutcomeCompleted, InputTokens: 7, OutputTokens: 3, UsageComplete: true, CostMicros: 42}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(`DROP TABLE billing_hourly`); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()

	store = openAt(t, path)
	got, err := store.Billing(ctx, ts.Add(-time.Hour), ts.Add(time.Hour), "alice")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Requests != 1 || got[0].InputTokens != 7 || got[0].CostMicros != 42 {
		t.Fatalf("backfilled %+v", got)
	}
}

func openAt(t *testing.T, path string) *SQLiteStore {
	t.Helper()
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestUsageHourlyCarriesCostAndMigrates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "requests.db")
	store, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	ts := time.Date(2026, 10, 1, 10, 30, 0, 0, time.UTC)
	for _, r := range []Record{
		{RequestID: "a", Timestamp: ts, UserAgent: "pi", Model: "m", StatusCode: 200, Outcome: OutcomeCompleted, InputTokens: 7, UsageComplete: true, CostMicros: 40},
		{RequestID: "b", Timestamp: ts, UserAgent: "pi", Model: "m", StatusCode: 200, Outcome: OutcomeClientCanceled, CostMicros: 999},
	} {
		if err := store.Insert(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.Usage(ctx, ts.Add(-time.Hour), ts.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].CostMicros != 40 {
		t.Fatalf("usage cost %+v", got)
	}

	// A rollup created before billing has no cost column; reopening must add and refill it.
	if _, err := store.db.Exec(`ALTER TABLE usage_hourly DROP COLUMN cost_micros`); err != nil {
		t.Fatal(err)
	}
	_ = store.Close()
	store = openAt(t, path)
	got, err = store.Usage(ctx, ts.Add(-time.Hour), ts.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].CostMicros != 40 || got[0].Requests != 2 {
		t.Fatalf("migrated usage %+v", got)
	}
}
