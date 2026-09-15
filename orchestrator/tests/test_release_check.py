"""verify_release: say loudly when `status: done` has no release behind it (orchestrator 1.5).

The regression this guards: three entries reached `## Finished` with no release for their
version and nothing noticed. The matching rules matter too — a guessed tag produced a false
warning for aideas on the first try, and quality-gate 0.4 must not be satisfied by
aideas-shell-v0.4 just because both release from the same repository.

`gh` is not run: the one call to it is intercepted, and everything else goes to the real
subprocess.run, so the git side of release_repo is exercised for real.
"""

from __future__ import annotations

import contextlib
import io
import subprocess
from unittest import mock

import orchestrator as orch
from tests import support


class ReleaseCheckTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.repo = support.init_repo(self.path("repo"), ".gitignore", ".orchestrator/\n")
        support.write(self.repo / ".agent-config.yml", support.AGENT_CONFIG)
        support.write(self.repo / "README.md", "# x\n\n## Ideas\n\n1. [qg](ideas/quality-gate)\n")
        for slug in ("quality-gate", "orchestrator", "recap"):
            support.write(self.repo / "ideas" / slug / "STATUS.md",
                          f"status: done\nversion: 0.4\n\n## Log\n\n# {slug}\n")
        support.git("config", "-f", ".gitmodules", "submodule.ideas/recap/upstream.path",
                    "ideas/recap/upstream", cwd=self.repo)
        support.git("config", "-f", ".gitmodules", "submodule.ideas/recap/upstream.url",
                    "https://github.com/gortazar/recap.git", cwd=self.repo)
        support.commit_all(self.repo, "ideas")
        support.git("remote", "add", "origin", "git@github.com:gortazar/aideas.git", cwd=self.repo)
        self.orch = self.orchestrator(self.repo)
        self.gh_calls: list[list[str]] = []

    def verify(self, slug: str, version, tags: list[str]) -> str:
        real_run = subprocess.run

        def fake_run(argv, *args, **kwargs):
            if argv and argv[0] == "gh":
                self.gh_calls.append(list(argv))
                return subprocess.CompletedProcess(argv, 0, "\n".join(tags) + "\n", "")
            return real_run(argv, *args, **kwargs)

        out = io.StringIO()
        with mock.patch.object(orch.subprocess, "run", fake_run), contextlib.redirect_stdout(out):
            self.orch.verify_release(slug, version)
        return out.getvalue()

    def status_text(self, slug: str) -> str:
        return (self.repo / "ideas" / slug / "STATUS.md").read_text()

    def test_release_repo_prefers_the_upstream_url(self) -> None:
        self.assertEqual(self.orch.release_repo("recap"), ("gortazar/recap", False))
        self.assertEqual(self.orch.release_repo("quality-gate"), ("gortazar/aideas", True))

    def test_tag_ending_in_the_version_satisfies_an_upstream_idea(self) -> None:
        output = self.verify("recap", "0.4", ["v0.3", "v0.4"])
        self.assertIn("release v0.4 is published in gortazar/recap", output)
        self.assertNotIn("WARNING", output)
        self.assertEqual(self.gh_calls[0][:4], ["gh", "release", "list", "--repo"])
        self.assertEqual(self.gh_calls[0][4], "gortazar/recap")

    def test_version_without_v_prefix_also_satisfies(self) -> None:
        output = self.verify("recap", "0.4", ["0.4"])
        self.assertIn("release 0.4 is published", output)

    def test_another_ideas_tag_in_the_same_repo_does_not_satisfy(self) -> None:
        output = self.verify("quality-gate", "0.4", ["aideas-shell-v0.4", "quality-gate-v0.3"])
        self.assertIn("WARNING", output)
        self.assertIn("no release whose tag ends in v0.4", output)
        self.assertIn("no v0.4 release in gortazar/aideas", self.status_text("quality-gate"))

    def test_own_tag_in_the_shared_repo_satisfies(self) -> None:
        output = self.verify("quality-gate", "0.4", ["aideas-shell-v0.4", "quality-gate-v0.4"])
        self.assertIn("release quality-gate-v0.4 is published in gortazar/aideas", output)
        self.assertNotIn("orchestrator:", self.status_text("quality-gate"))

    def test_orchestrator_releases_from_this_repo_under_its_own_prefix(self) -> None:
        self.assertEqual(self.orch.release_repo("orchestrator"), ("gortazar/aideas", True))
        output = self.verify("orchestrator", "1.6", ["quality-gate-v1.0", "orchestrator-v1.6"])
        self.assertIn("release orchestrator-v1.6 is published", output)
        # ...and a shell release at the same number would not do.
        self.gh_calls.clear()
        output = self.verify("orchestrator", "1.6", ["aideas-shell-v1.6"])
        self.assertIn("WARNING", output)

    def test_no_version_is_silence(self) -> None:
        output = self.verify("recap", None, ["v0.4"])
        self.assertEqual(output, "")
        self.assertEqual(self.gh_calls, [], "nothing to check means gh is never run")
        self.assertNotIn("orchestrator:", self.status_text("recap"))

    def test_gh_failure_is_reported_not_treated_as_missing(self) -> None:
        real_run = subprocess.run  # orch.subprocess *is* this module; patching it patches both

        def failing_run(argv, *args, **kwargs):
            if argv and argv[0] == "gh":
                return subprocess.CompletedProcess(argv, 1, "", "gh: not logged in\n")
            return real_run(argv, *args, **kwargs)

        out = io.StringIO()
        with mock.patch.object(orch.subprocess, "run", failing_run), \
                contextlib.redirect_stdout(out):
            self.orch.verify_release("recap", "0.4")
        self.assertIn("not verified", out.getvalue())
        self.assertNotIn("WARNING", out.getvalue())
