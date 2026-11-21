// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// decodechild.go — the app decodes a fetched match's film in a child process of its own
// executable (the hidden `build-replay` command). The decoder's memory guard stops its
// process with os.Exit when a decode crosses its ceiling, and it measures the whole process:
// run inside the server, a large map build running beside the decode counted against it and
// the guard closed the app (2026-11-18: the Breaker map build, then an Empyrean fetch). In a
// child, only the decode is measured and only the child stops; the parent reads the child's
// output and turns its exit into the error the fetch state route reports.

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// decodeChildEnv marks a process started as a decode child: main leaves its standard streams
// alone (they are the parent's pipes) instead of taking a console or the server log.
const decodeChildEnv = "INSTALLATION08_DECODE_CHILD"

const (
	// childTailLines is how many of the child's last output lines the parent keeps.
	childTailLines = 20
	// childMaxLine bounds one kept line, so output with no newline cannot grow without limit.
	childMaxLine = 4 << 10
)

// peakBytesRE reads the peak footprint from the memory guard's stop line.
var peakBytesRE = regexp.MustCompile(`peak_bytes=(\d+)`)

// runBuildReplay is the hidden `build-replay <match-id> [--data <dir>] [--recode]` command,
// the child side: it builds the stored match's replay exactly as an in-process build would.
// --recode marks a re-decode of a match whose document is behind the decoder (serve_recode.go):
// the film is decoded by the current decoder, but the match summary's ImportedAt is preserved
// (buildStored's rebuild flag leaves the summary untouched), and the child reports its progress
// as `progress=<frac>` lines on its output (the parent forwards them to the build runner).
func runBuildReplay(args []string) error {
	if len(args) == 0 || !store.MatchIDValid(args[0]) {
		return fmt.Errorf("build-replay requires a valid match id")
	}
	id := args[0]
	fs := flag.NewFlagSet("build-replay", flag.ContinueOnError)
	data := fs.String("data", "", dataDirHelp)
	recode := fs.Bool("recode", false, "")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", fs.Args())
	}
	dir, err := dataDirFor(*data)
	if err != nil {
		return err
	}
	root, err := store.New(dir)
	if err != nil {
		return err
	}
	if *recode {
		meta, err := root.MatchMeta(id)
		if err != nil {
			return err
		}
		// A re-decode is one decode with two bookkeeping steps around it: report the decode
		// starting, decode (rebuild true leaves the summary's ImportedAt in place), then report
		// the document written. The parent forwards these to the runner's progress reporter.
		fmt.Println("progress=0.05")
		err = buildStored(root, id, importFlags{mapName: meta.MapName, rebuild: true})
		if err != nil {
			return err
		}
		fmt.Println("progress=0.9")
		return nil
	}
	return buildStored(root, id, importFlags{})
}

// buildStoredInChild builds a stored match's replay in a child process (see the file comment).
func buildStoredInChild(ctx context.Context, root *store.Root, id string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find the app executable: %w", err)
	}
	return runDecodeChild(ctx, exe, []string{"build-replay", id, "--data", root.Dir()}, nil)
}

// recodeInChild re-decodes a stored match's film in a child process: the decode runs on the
// current decoder, the match summary's ImportedAt is preserved (the child's --recode flag), and
// the child's `progress=<frac>` lines are forwarded to report (the runner's reporter, so the
// viewer's Optimizing assets banner shows the re-decode, like a map build). The memory guard
// stops the child, never the server (the file comment). After the child succeeds, the parent
// re-derives the summary's players from the new document (refreshMatchSummaryAfterRecode keeps
// every other field, including the preserved ImportedAt).
func recodeInChild(ctx context.Context, root *store.Root, id string, report func(frac float64, stage string)) error {
	meta, err := root.MatchMeta(id)
	if err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find the app executable: %w", err)
	}
	out := &childOutput{log: os.Stderr}
	out.progressLine = func(line string) {
		if frac, ok := parseProgressLine(line); ok && report != nil {
			report(frac, stageOfProgress(frac))
		}
	}
	err = runDecodeChildWithOut(ctx, exe, []string{"build-replay", id, "--recode", "--data", root.Dir()}, nil, out)
	if err == nil {
		if rerr := refreshMatchSummaryAfterRecode(root, id, meta); rerr != nil {
			return rerr
		}
	}
	return err
}

// runDecodeChildWithOut is runDecodeChild with the parent's choice of output receiver (the
// re-code child reports progress through it; a fetch's child uses the plain childOutput).
func runDecodeChildWithOut(ctx context.Context, exe string, args, extraEnv []string, out *childOutput) error {
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Env = append(append(os.Environ(), decodeChildEnv+"=1"), extraEnv...)
	hideChildConsole(cmd)
	cmd.Stdout = out
	cmd.Stderr = out
	err := cmd.Run()
	out.flush()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		return fmt.Errorf("start the film decoder: %w", err)
	}
	return out.failure(exit.ExitCode())
}

// parseProgressLine reads a `progress=<frac>` line into a 0..1 fraction (ok false otherwise).
func parseProgressLine(line string) (float64, bool) {
	v, ok := strings.CutPrefix(line, "progress=")
	if !ok {
		return 0, false
	}
	frac, err := strconv.ParseFloat(v, 64)
	if err != nil || frac < 0 || frac > 1 {
		return 0, false
	}
	return frac, true
}

// stageOfProgress names the stage a fraction is in (the banner shows the stage, not the number).
func stageOfProgress(frac float64) string {
	if frac < 0.9 {
		return "decoding"
	}
	return "writing"
}

// runDecodeChild runs exe with args (and extraEnv) as a decode child with no console window,
// copies its output into this process's log, and turns a failed exit into an error that says
// what happened.
func runDecodeChild(ctx context.Context, exe string, args, extraEnv []string) error {
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Env = append(append(os.Environ(), decodeChildEnv+"=1"), extraEnv...)
	hideChildConsole(cmd)
	out := &childOutput{log: os.Stderr}
	cmd.Stdout = out
	cmd.Stderr = out
	err := cmd.Run()
	out.flush()
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		return fmt.Errorf("start the film decoder: %w", err)
	}
	return out.failure(exit.ExitCode())
}

// childOutput receives a decode child's stdout and stderr: it copies them to the log and keeps
// what explains a failure (the last lines, the first line of a crash, the memory stop line).
type childOutput struct {
	mu      sync.Mutex
	log     io.Writer
	partial []byte
	last    []string
	crash   string
	memory  string
	// progressLine, when set, receives each output line: the re-code child's
	// `progress=<frac>` lines are parsed from it (serve_recode.go) and no others.
	progressLine func(string)
}

// Write copies p to the log (a failing log never fails the child) and records its lines.
func (o *childOutput) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.log != nil {
		_, _ = o.log.Write(p)
	}
	o.partial = append(o.partial, p...)
	for {
		i := bytes.IndexByte(o.partial, '\n')
		if i < 0 {
			break
		}
		o.note(string(o.partial[:i]))
		o.partial = o.partial[i+1:]
	}
	if len(o.partial) > childMaxLine {
		o.note(string(o.partial))
		o.partial = nil
	}
	return len(p), nil
}

// flush records a last line the child left without a newline.
func (o *childOutput) flush() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.partial) > 0 {
		o.note(string(o.partial))
		o.partial = nil
	}
}

// note records one line of output.
func (o *childOutput) note(line string) {
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	if len(line) > childMaxLine {
		line = line[:childMaxLine]
	}
	// A Go panic or runtime fatal error prints its cause first, then every goroutine's stack:
	// the first such line is kept wherever the tail ends.
	if o.crash == "" && (strings.HasPrefix(line, "panic: ") || strings.HasPrefix(line, "fatal error: ")) {
		o.crash = line
	}
	if strings.Contains(line, build.MemoryExceededMessage) {
		o.memory = line
	}
	if o.progressLine != nil {
		o.progressLine(line)
	}
	o.last = append(o.last, line)
	if len(o.last) > childTailLines {
		o.last = o.last[len(o.last)-childTailLines:]
	}
}

// failure is the error for a child that exited with code: the memory guard's stop, a crash,
// the child's own error (main prints it last and exits 1), or an unexpected stop.
func (o *childOutput) failure(code int) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.memory != "" {
		if m := peakBytesRE.FindStringSubmatch(o.memory); m != nil {
			if peak, err := strconv.ParseUint(m[1], 10, 64); err == nil {
				return fmt.Errorf("the film decoder ran out of memory (%s used, the limit is %s)",
					gigabytes(peak), gigabytes(build.MemoryLimitBytes))
			}
		}
		return fmt.Errorf("the film decoder ran out of memory (the limit is %s)", gigabytes(build.MemoryLimitBytes))
	}
	if o.crash != "" {
		return fmt.Errorf("the film decoder crashed: %s", o.crash)
	}
	last := ""
	if len(o.last) > 0 {
		last = o.last[len(o.last)-1]
	}
	if code == 1 && last != "" {
		return errors.New(last)
	}
	msg := "the film decoder stopped unexpectedly (exit code " + exitCodeText(code) + ")"
	if last != "" {
		msg += ": " + last
	}
	return errors.New(msg)
}

// gigabytes formats a byte count for a person.
func gigabytes(b uint64) string { return fmt.Sprintf("%.2f GB", float64(b)/1e9) }

// exitCodeText formats an exit code; a Windows NTSTATUS (0xC0000005, an access violation)
// reads in hex.
func exitCodeText(code int) string {
	if code > 255 || code < -1 {
		return fmt.Sprintf("0x%X", uint32(code))
	}
	return strconv.Itoa(code)
}
