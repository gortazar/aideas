package cli

import (
	"bytes"
	"strings"
	"testing"
)

func run(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errb bytes.Buffer
	code = Run(args, &out, &errb)
	return code, out.String(), errb.String()
}

func TestNoArgsSucceedsQuietly(t *testing.T) {
	code, stdout, stderr := run(t)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stderr: %s)", code, stderr)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty", stdout)
	}
}

func TestHelpGoesToStdout(t *testing.T) {
	code, stdout, _ := run(t, "--help")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(stdout, "recap") {
		t.Errorf("--help output does not mention recap: %q", stdout)
	}
}

func TestUnknownFlagFails(t *testing.T) {
	code, _, stderr := run(t, "--nope")
	if code == 0 {
		t.Fatalf("exit code = 0, want non-zero for an unknown flag")
	}
	if stderr == "" {
		t.Errorf("unknown flag produced no message on stderr")
	}
}
