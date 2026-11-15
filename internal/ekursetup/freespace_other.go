//go:build !windows

package ekursetup

import "errors"

// freeBytes is not measured off Windows (the dumper is a Windows program); Run skips the
// check when it cannot measure.
func freeBytes(string) (uint64, error) {
	return 0, errors.New("free space not measured on this platform")
}
