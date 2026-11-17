// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

// coatings.go — the weapon coating files of the library: the same file contract as the
// Spartan piece library (spartanpieces) — coatings.json (the common table), one
// coating-<style>.json per style list the weapon materials name, swatch-<gradient>.png
// per gradient image — written by spartanpieces.CoatingWork.Finish into the weapons
// folder next to the GLBs.

import "regexp"

// coatingFileNames are the coating file names the weapons route serves beside the model GLBs
// and index.json (the spartanpieces naming, LevelUp's contract).
var coatingFileNames = regexp.MustCompile(`^(coatings\.json|coating-[0-9a-f]{8}\.json|swatch-[0-9a-f]{8}\.png)$`)

// CoatingFile says whether name is one of the library's coating file names.
func CoatingFile(name string) bool { return coatingFileNames.MatchString(name) }
