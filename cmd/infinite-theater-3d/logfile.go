package main

// logfile.go — the file a launch with no console (a double-click of the packaged GUI
// build) writes its output to, beside the data it serves.

import (
	"os"
	"path/filepath"
)

// serverLogName is the log file a console-less launch writes; the previous run's file is
// kept beside it as server.log.1.
const serverLogName = "server.log"

// openServerLog opens <data dir>\logs\server.log for append, rotating the previous run's
// file to server.log.1.
func openServerLog(dataDir string) (*os.File, error) {
	dir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	cur := filepath.Join(dir, serverLogName)
	_ = os.Remove(cur + ".1")
	if err := os.Rename(cur, cur+".1"); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return os.OpenFile(cur, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
}
