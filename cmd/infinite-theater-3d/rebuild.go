// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"flag"
	"fmt"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

func runRebuild(args []string) error {
	if len(args) == 0 || !store.MatchIDValid(args[0]) {
		return fmt.Errorf("rebuild requires a valid match id")
	}
	id := args[0]
	fs := flag.NewFlagSet("rebuild", flag.ContinueOnError)
	data := fs.String("data", "", dataDirHelp)
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
	meta, err := root.MatchMeta(id)
	if err != nil {
		return err
	}
	return buildStored(root, id, importFlags{mapName: meta.MapName, rebuild: true})
}
