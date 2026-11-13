package build

import "strconv"

// formatXUID renders a film xuid in the decimal form the document and the statborg lines
// share (the only form the pairing and the bridge accept).
func formatXUID(x uint64) string { return strconv.FormatUint(x, 10) }
