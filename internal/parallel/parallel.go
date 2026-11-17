// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package parallel runs a bounded worker pool over an ordered list of items. It is the one
// place the startup library builds (first-person, weapons, Spartan pieces) get their
// concurrency from, so every one of them is bounded, cancellable and tested the same way.
package parallel

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
)

// Workers is the default worker count for a bounded pool: every logical core, at least 1.
// The startup library builds use this unless a measurement shows a smaller pool is needed to
// keep memory in check on a typical machine (none has, so far: see the benchmark in
// internal/firstperson's CHANGELOG entry).
func Workers() int {
	n := runtime.NumCPU()
	if n < 1 {
		n = 1
	}
	return n
}

// Run runs fn(ctx, order[k]) for k in [0, len(order)) on up to workers goroutines (Workers()
// when workers <= 0, len(order) when that is smaller). order is the dispatch sequence: items
// earlier in it are started first, which is how a caller prioritizes a few items (the keys a
// just-opened match needs) without changing where their result lands — the caller indexes its
// own result slice by order[k], not by k, so the build's output never depends on dispatch
// order or on which goroutine finished first.
//
// fn's own error is fatal: the first one cancels ctx (so other workers notice and should stop
// promptly) and is returned once every worker has exited; Run still waits for every launched
// fn to return. progress, when non-nil, is called once per completed item (success or error),
// with the number done so far (always increasing, 1-based) — a caller after a go/no-go signal
// for individual items (a skip that isn't a Run-level error) should fold that into progress
// itself, not into fn's return.
func Run(ctx context.Context, order []int, workers int, progress func(done int), fn func(ctx context.Context, i int) error) error {
	n := len(order)
	if n == 0 {
		return nil
	}
	if workers <= 0 {
		workers = Workers()
	}
	if workers > n {
		workers = n
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	next := make(chan int)
	go func() {
		defer close(next)
		for _, i := range order {
			select {
			case next <- i:
			case <-ctx.Done():
				return
			}
		}
	}()

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
		done     atomic.Int64
	)
	fail := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		if firstErr == nil {
			firstErr = err
			cancel()
		}
	}
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				if err := fn(ctx, i); err != nil {
					fail(err)
				}
				if progress != nil {
					progress(int(done.Add(1)))
				}
			}
		}()
	}
	wg.Wait()
	return firstErr
}

// Sequence is the dispatch order [0, n), the plain pool with no priority: Run(ctx,
// Sequence(n), ...) behaves like a sequential for-loop except for concurrency.
func Sequence(n int) []int {
	order := make([]int, n)
	for i := range order {
		order[i] = i
	}
	return order
}

// PriorityOrder returns the dispatch order for n items (0..n-1) where keyOf(i) names item i:
// every i whose key is in priority, in priority's own order (a key with no matching item is
// skipped, a repeated key only moves its item once), then every remaining i in its original
// order. It never drops or duplicates an index: the result is always a permutation of
// [0, n).
func PriorityOrder(n int, keyOf func(i int) string, priority []string) []int {
	if len(priority) == 0 {
		return Sequence(n)
	}
	byKey := make(map[string][]int, n)
	for i := 0; i < n; i++ {
		byKey[keyOf(i)] = append(byKey[keyOf(i)], i)
	}
	used := make([]bool, n)
	order := make([]int, 0, n)
	for _, key := range priority {
		for _, i := range byKey[key] {
			if used[i] {
				continue
			}
			used[i] = true
			order = append(order, i)
		}
	}
	for i := 0; i < n; i++ {
		if !used[i] {
			order = append(order, i)
		}
	}
	return order
}
