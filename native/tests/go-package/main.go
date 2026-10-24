// Test helper: create a standard Go module proxy archive; not an SDK runtime dependency.
package main

import (
	"golang.org/x/mod/module"
	"golang.org/x/mod/zip"
	"os"
	"path/filepath"
)

func main() {
	source, proxy := os.Args[1], os.Args[2]
	const name = "github.com/Mininglamp-OSS/octo-runtime/native/go"
	const version = "v0.0.0-native.test"
	escaped, err := module.EscapePath(name)
	must(err)
	directory := filepath.Join(proxy, escaped, "@v")
	must(os.MkdirAll(directory, 0700))
	manifest, err := os.ReadFile(filepath.Join(source, "go.mod"))
	must(err)
	must(os.WriteFile(filepath.Join(directory, version+".mod"), manifest, 0600))
	must(os.WriteFile(filepath.Join(directory, version+".info"), []byte(`{"Version":"v0.0.0-native.test","Time":"2026-10-24T00:00:00Z"}`), 0600))
	must(os.WriteFile(filepath.Join(directory, "list"), []byte(version+"\n"), 0600))
	output, err := os.Create(filepath.Join(directory, version+".zip"))
	must(err)
	must(zip.CreateFromDir(output, module.Version{Path: name, Version: version}, source))
	must(output.Close())
}
func must(err error) {
	if err != nil {
		panic(err)
	}
}
