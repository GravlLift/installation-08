package ekursetup

// dump.go — running the dumper: a hidden child process (no console window, see
// hide_windows.go), its stdout and stderr copied into the run log, and its exit code
// turned into a clear error.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// runDumper runs exe with args in dir, its output copied to log. A non-zero exit, a launch
// failure or a timeout wraps ErrDumpFailed, with the last line the dumper printed.
func runDumper(ctx context.Context, exe string, args []string, dir string, log io.Writer) error {
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Dir = dir
	hideWindow(cmd)
	tail := &lastLine{}
	out := &lockedWriter{w: io.MultiWriter(log, tail)}
	cmd.Stdout = out
	cmd.Stderr = out
	fmt.Fprintf(log, "running %s %s\n", exe, strings.Join(args, " "))
	err := cmd.Run()
	if err == nil {
		return nil
	}
	last := tail.String()
	detail := ""
	if last != "" {
		detail = fmt.Sprintf(" (last output: %q)", last)
	}
	if ctx.Err() == context.DeadlineExceeded {
		return fmt.Errorf("%w: it did not finish within %s%s", ErrDumpFailed, DumpTimeout, detail)
	}
	if ctx.Err() != nil {
		return fmt.Errorf("%w: cancelled", ErrDumpFailed)
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return fmt.Errorf("%w: it exited with code %d%s; see %s in the data folder's tools\\ekur", ErrDumpFailed, exitErr.ExitCode(), detail, LogName)
	}
	return fmt.Errorf("%w: it could not be started: %v", ErrDumpFailed, err)
}

// lockedWriter serializes the two output streams into one writer.
type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

// lastLine keeps the last non-empty output line (cut to 200 bytes) for the error message.
type lastLine struct {
	partial []byte
	last    string
}

func (l *lastLine) Write(p []byte) (int, error) {
	l.partial = append(l.partial, p...)
	for {
		i := bytes.IndexByte(l.partial, '\n')
		if i < 0 {
			break
		}
		l.keep(l.partial[:i])
		l.partial = l.partial[i+1:]
	}
	if len(l.partial) > 4096 {
		l.keep(l.partial)
		l.partial = l.partial[:0]
	}
	return len(p), nil
}

func (l *lastLine) keep(line []byte) {
	s := strings.TrimSpace(string(line))
	if s == "" {
		return
	}
	if len(s) > 200 {
		s = s[:200]
	}
	l.last = s
}

func (l *lastLine) String() string {
	if len(bytes.TrimSpace(l.partial)) > 0 {
		l.keep(l.partial)
		l.partial = l.partial[:0]
	}
	return l.last
}
