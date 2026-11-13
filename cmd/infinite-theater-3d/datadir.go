package main

// datadir.go — where the data directory is: --data, then IT3D_DATA_DIR, then the `data`
// folder of the repo checkout the program runs from (gitignored, so built assets and
// fetched matches sit next to the code but are never committed), then
// %LOCALAPPDATA%\infinite-theater-3d\data for a binary run outside any checkout.

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// dataDirHelp is the --data flag's help text, shared by every subcommand.
const dataDirHelp = "data directory (default: IT3D_DATA_DIR, else the repo checkout's data folder, else %LOCALAPPDATA%/infinite-theater-3d/data)"

const modulePath = "github.com/llampwall/infinite-theater-3d"

// dataDirFor resolves the data directory from the flag, the environment, the working
// directory and the executable's location.
func dataDirFor(flagVal string) (string, error) {
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	return dataDirFrom(flagVal, starts)
}

// dataDirFrom is dataDirFor with the directories to search for a repo checkout given.
func dataDirFrom(flagVal string, starts []string) (string, error) {
	if flagVal != "" {
		return flagVal, nil
	}
	if env := os.Getenv("IT3D_DATA_DIR"); env != "" {
		return env, nil
	}
	for _, start := range starts {
		if root := repoRoot(start); root != "" {
			return filepath.Join(root, "data"), nil
		}
	}
	la := os.Getenv("LOCALAPPDATA")
	if la == "" {
		return "", fmt.Errorf("no data directory: pass --data or set IT3D_DATA_DIR")
	}
	return filepath.Join(la, "infinite-theater-3d", "data"), nil
}

// repoRoot walks up from start to the first directory whose go.mod declares this module.
// A worktree under the checkout's `.worktrees` folder resolves to the main checkout, so
// every worktree shares one data folder. No checkout found yields "".
func repoRoot(start string) string {
	for dir := filepath.Clean(start); ; {
		if declaresModule(filepath.Join(dir, "go.mod")) {
			parent := filepath.Dir(filepath.Dir(dir))
			if strings.EqualFold(filepath.Base(filepath.Dir(dir)), ".worktrees") && declaresModule(filepath.Join(parent, "go.mod")) {
				return parent
			}
			return dir
		}
		up := filepath.Dir(dir)
		if up == dir {
			return ""
		}
		dir = up
	}
}

// declaresModule reports whether the go.mod at path declares this repo's module.
func declaresModule(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if fields := strings.Fields(sc.Text()); len(fields) == 2 && fields[0] == "module" {
			return fields[1] == modulePath
		}
	}
	return false
}
