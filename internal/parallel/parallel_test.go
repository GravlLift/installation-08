// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package parallel

import (
	"context"
	"errors"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRun_SameOutputAsSequential(t *testing.T) {
	const n = 50
	results := make([]int, n)
	var mu sync.Mutex
	var seen []int
	err := Run(context.Background(), Sequence(n), 8, nil, func(_ context.Context, i int) error {
		results[i] = i * i
		mu.Lock()
		seen = append(seen, i)
		mu.Unlock()
		return nil
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	for i := 0; i < n; i++ {
		if results[i] != i*i {
			t.Fatalf("results[%d] = %d, want %d", i, results[i], i*i)
		}
	}
	if len(seen) != n {
		t.Fatalf("saw %d items, want %d", len(seen), n)
	}
	sort.Ints(seen)
	for i, v := range seen {
		if v != i {
			t.Fatalf("seen is not every index once: at %d got %d", i, v)
		}
	}
}

func TestRun_ErrorsPropagate(t *testing.T) {
	wantErr := errors.New("boom")
	var attempts atomic.Int64
	err := Run(context.Background(), Sequence(20), 4, nil, func(_ context.Context, i int) error {
		attempts.Add(1)
		if i == 5 {
			return wantErr
		}
		return nil
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Run error = %v, want %v", err, wantErr)
	}
}

func TestRun_CancellationStopsWorkers(t *testing.T) {
	var started atomic.Int64
	var completed atomic.Int64
	err := Run(context.Background(), Sequence(200), 4, nil, func(ctx context.Context, i int) error {
		started.Add(1)
		if i == 0 {
			return errors.New("stop")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
		completed.Add(1)
		return nil
	})
	if err == nil {
		t.Fatalf("Run: want an error")
	}
	// The pool must not have run every item to completion once one failed: cancellation
	// should have cut most of the 200-item queue short well before it drained.
	if completed.Load() >= 190 {
		t.Fatalf("completed %d of 200 after a fatal error; cancellation did not stop the workers", completed.Load())
	}
}

func TestRun_ProgressCountsEveryItem(t *testing.T) {
	const n = 30
	var last atomic.Int64
	var calls atomic.Int64
	err := Run(context.Background(), Sequence(n), 6, func(done int) {
		calls.Add(1)
		last.Store(int64(done))
	}, func(_ context.Context, _ int) error { return nil })
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if calls.Load() != n {
		t.Fatalf("progress called %d times, want %d", calls.Load(), n)
	}
	if last.Load() != n {
		t.Fatalf("final progress count = %d, want %d", last.Load(), n)
	}
}

func TestPriorityOrder(t *testing.T) {
	keys := []string{"a", "b", "c", "d", "e"}
	keyOf := func(i int) string { return keys[i] }
	order := PriorityOrder(len(keys), keyOf, []string{"d", "b", "d", "z"})
	got := make([]string, len(order))
	for k, i := range order {
		got[k] = keys[i]
	}
	want := []string{"d", "b", "a", "c", "e"}
	if len(got) != len(want) {
		t.Fatalf("order = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestPriorityOrder_NoPriorityIsSequential(t *testing.T) {
	order := PriorityOrder(5, func(i int) string { return "" }, nil)
	for i, v := range order {
		if v != i {
			t.Fatalf("order = %v, want 0..4", order)
		}
	}
}
