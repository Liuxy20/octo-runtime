package octo

import "github.com/Microsoft/go-winio"

// Go selects this file automatically; callers use the same Client on every platform.
func init() {
	dialWindows = winio.DialPipeContext
}
