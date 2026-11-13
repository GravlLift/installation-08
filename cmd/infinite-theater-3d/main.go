package main

import (
	"fmt"
	"os"
)

const usage = "usage: infinite-theater-3d version | decode-info <chunk-dir> | import --chunks <dir> --map <name> [--manifest <file>] [--stats <file>] [--match <id>] [--catalog <file>] [--data <dir>] | serve [--addr <host:port>] [--web <dir>]"

func run(args []string) error {
	if len(args) == 1 && args[0] == "version" {
		fmt.Println("infinite-theater-3d: early skeleton")
		return nil
	}
	switch args[0] {
	case "decode-info":
		return runDecodeInfo(args[1:])
	case "decode":
		return runDecode(args[1:])
	case "import":
		return runImport(args[1:])
	default:
		return fmt.Errorf(usage)
	}
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
