// Package cli parses recap's command line and drives the readers and renderer.
package cli

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gortazar/recap/internal/claude"
	"github.com/gortazar/recap/internal/opencode"
	"github.com/gortazar/recap/internal/proc"
	"github.com/gortazar/recap/internal/render"
	"github.com/gortazar/recap/internal/report"
	"github.com/gortazar/recap/internal/session"
)

const usage = `recap — what were my coding agents doing?

Usage: recap [flags]

Prints one line per project with the status of its most recent agent session.

Flags:
`

// Env is everything recap reads from the machine, gathered in one place so the whole command
// can be run against a fixture tree in tests.
type Env struct {
	// ClaudeProjects is Claude Code's store, ~/.claude/projects by default.
	ClaudeProjects string
	// OpencodeStore is opencode's SQLite store.
	OpencodeStore string
	// ProcRoot is the process table, /proc by default.
	ProcRoot string
	// Roots limits which projects are reported. Empty means the user's home directory.
	Roots []string
	// Now is the clock.
	Now func() time.Time
}

// DefaultEnv reads the real machine.
func DefaultEnv() Env {
	var roots []string
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		roots = []string{home}
	}
	return Env{
		ClaudeProjects: claude.DefaultProjectsDir(),
		OpencodeStore:  opencode.DefaultStore(),
		ProcRoot:       proc.DefaultRoot,
		Roots:          roots,
		Now:            time.Now,
	}
}

// Run executes recap with the given arguments and returns the process exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	return RunWith(args, stdout, stderr, DefaultEnv())
}

// RunWith is Run against a supplied environment.
func RunWith(args []string, stdout, stderr io.Writer, env Env) int {
	fs := flag.NewFlagSet("recap", flag.ContinueOnError)
	fs.SetOutput(stderr)
	fs.Usage = func() {
		fmt.Fprint(stderr, usage)
		fs.PrintDefaults()
	}

	var (
		since    = fs.String("since", "24h", "hide sessions untouched for longer than this (e.g. 90m, 2d)")
		all      = fs.Bool("all", false, "ignore the time window")
		agent    = fs.String("agent", "", "only this agent: claude or opencode")
		project  = fs.String("project", "", "only this project, by name")
		running  = fs.Bool("running", false, "only projects with something running right now")
		root     = newRepeatable(fs, "root", "only report projects under this directory (repeatable)")
		noIcons  = fs.Bool("no-icons", false, "print status words instead of emoji")
		legend   = fs.Bool("legend", false, "explain the status vocabulary and exit")
		asJSON   = fs.Bool("json", false, "print the report as JSON (a versioned public interface)")
		verbose  = fs.Bool("v", false, "add a line per session under each project")
		verbose2 = fs.Bool("verbose", false, "add a line per session under each project")
	)

	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			fmt.Fprint(stdout, usage)
			fs.SetOutput(stdout)
			fs.PrintDefaults()
			return 0
		}
		return 2
	}

	opts := render.Options{
		Now:     env.Now(),
		NoIcons: *noIcons,
		Verbose: *verbose || *verbose2,
	}

	if *legend {
		if err := render.Legend(stdout, opts); err != nil {
			fmt.Fprintln(stderr, "recap:", err)
			return 1
		}
		return 0
	}

	filters := report.Filters{
		Project:     *project,
		RunningOnly: *running,
		Roots:       env.Roots,
	}
	if len(*root) > 0 {
		filters.Roots = *root
	}
	if !*all {
		d, err := parseDuration(*since)
		if err != nil {
			fmt.Fprintf(stderr, "recap: --since %q: %v\n", *since, err)
			return 2
		}
		filters.Since = d
	}
	if *agent != "" {
		a, err := parseAgent(*agent)
		if err != nil {
			fmt.Fprintf(stderr, "recap: %v\n", err)
			return 2
		}
		filters.Agent = a
	}

	// One agent's store being unreadable must not cost you the other's sessions, so each
	// failure is reported and the report is built from whatever was readable.
	var sessions []*session.Session
	claudeSessions, err := claude.Discover(env.ClaudeProjects)
	if err != nil {
		fmt.Fprintln(stderr, "recap: reading Claude Code sessions:", err)
	}
	sessions = append(sessions, claudeSessions...)

	opencodeSessions, err := opencode.Discover(env.OpencodeStore)
	if err != nil {
		fmt.Fprintln(stderr, "recap: reading opencode sessions:", err)
	}
	sessions = append(sessions, opencodeSessions...)

	procs, supported := proc.Scan(env.ProcRoot)
	live := proc.NewIndex(procs, supported)

	projects := report.Build(report.FilterSessions(sessions, filters, opts.Now), live, opts.Now)
	projects = report.FilterProjects(projects, filters)

	if *asJSON {
		// Always a document, even with nothing to report: a consumer should not have to
		// tell "no sessions" apart from "recap failed" by parsing stderr.
		if err := render.JSON(stdout, projects, opts, render.LivenessSource(live.Supported())); err != nil {
			fmt.Fprintln(stderr, "recap:", err)
			return 1
		}
		return 0
	}

	if len(projects) == 0 {
		fmt.Fprintln(stderr, "recap: nothing to report")
		return 0
	}
	if err := render.Text(stdout, projects, opts); err != nil {
		fmt.Fprintln(stderr, "recap:", err)
		return 1
	}
	return 0
}

func parseAgent(name string) (session.Agent, error) {
	switch strings.ToLower(name) {
	case "claude", "claude-code", "claudecode":
		return session.AgentClaude, nil
	case "opencode":
		return session.AgentOpencode, nil
	default:
		return "", fmt.Errorf("--agent %q: expected claude or opencode", name)
	}
}

// parseDuration is time.ParseDuration plus days, which is the unit you actually reach for
// when asking what happened while you were away.
func parseDuration(s string) (time.Duration, error) {
	if rest, ok := strings.CutSuffix(strings.TrimSpace(s), "d"); ok {
		days, err := strconv.ParseFloat(rest, 64)
		if err != nil {
			return 0, fmt.Errorf("not a duration")
		}
		return time.Duration(days * float64(24*time.Hour)), nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("not a duration")
	}
	return d, nil
}

// repeatable collects a flag that may be given more than once.
type repeatable []string

func (r *repeatable) String() string { return strings.Join(*r, ", ") }

func (r *repeatable) Set(v string) error {
	*r = append(*r, v)
	return nil
}

func newRepeatable(fs *flag.FlagSet, name, help string) *repeatable {
	var r repeatable
	fs.Var(&r, name, help)
	return &r
}
