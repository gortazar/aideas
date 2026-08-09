// Package cli parses recap's command line and drives the readers and renderer.
package cli

import (
	"flag"
	"fmt"
	"io"
)

const usage = `recap — what were my coding agents doing?

Usage: recap [flags]

Prints one line per project with the status of its most recent agent session.
`

// Run executes recap with the given arguments and returns the process exit code.
// Everything is written to the supplied writers so the whole CLI is testable.
func Run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("recap", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprint(stderr, usage)
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			fmt.Fprint(stdout, usage)
			return 0
		}
		return 2
	}

	return 0
}
