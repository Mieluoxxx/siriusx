package registry

import "testing"

func TestPricingCostMicros(t *testing.T) {
	p := Pricing{Input: 3, Output: 15, CacheRead: 0.3}
	// 600 uncached input * 3 + 400 cached * 0.3 + 100 output * 15
	if got := p.CostMicros(1000, 100, 400); got != 1800+120+1500 {
		t.Fatalf("cost=%d", got)
	}
	if got := (Pricing{}).CostMicros(1000, 100, 0); got != 0 {
		t.Fatalf("unpriced cost=%d", got)
	}
	// Cached beyond input is clamped so it cannot go negative on uncached.
	if got := p.CostMicros(10, 0, 50); got != 3 {
		t.Fatalf("clamped cost=%d", got)
	}
}
