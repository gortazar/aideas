"""install.sh: installing from a release tarball, with no clone of this repository.

Before 1.6 the installer derived everything from its own location: it died unless it sat
inside a git clone that already contained `orchestrator/orchestrator.py`, which a tarball
install never does. Two things are separated now:

    the code    where orchestrator.py and heartbeat_server.py are, which is next to the
                installer itself, whether that is a clone or an unpacked tarball
    --repo      which clone to run cycles against, because the orchestrator genuinely does
                need one to commit and push to; when it is absent the installer clones the
                ideas repository itself

Only the resolution of those two is exercised here, through the documented dry run: the rest
of the script writes systemd units and starts services, which no test may do to the machine
it runs on.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from tests import support

INSTALL_SH = Path(__file__).resolve().parent.parent / "install.sh"


class InstallScriptTests(support.GitSandbox):
    def setUp(self) -> None:
        super().setUp()
        self.assertTrue(INSTALL_SH.is_file(), f"{INSTALL_SH} is missing")

    # -- fixtures ---------------------------------------------------------------------

    def unpacked_tarball(self) -> Path:
        """What `tar xf orchestrator-1.6.tar.gz` leaves: the code, and no repository."""
        code = self.path("opt", "orchestrator")
        code.mkdir(parents=True)
        for name in ("orchestrator.py", "heartbeat_server.py", "install.sh"):
            (code / name).write_text((INSTALL_SH.parent / name).read_text())
        return code

    def clone_source(self) -> Path:
        """A stand-in for github.com/gortazar/aideas that `git clone` can reach."""
        origin = self.path("aideas-origin")
        support.init_repo(origin, "README.md", "# Ideas\n\n## Ideas\n")
        support.write(origin / "orchestrator" / "orchestrator.py", "# code\n")
        support.commit_all(origin, "orchestrator")
        return origin

    def run_install(self, script: Path, *args: str, clone_url: Path | None = None,
                    expect_ok: bool = True) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["ORCHESTRATOR_INSTALL_DRY_RUN"] = "1"
        if clone_url is not None:
            env["AIDEAS_CLONE_URL"] = str(clone_url)
        result = subprocess.run(["bash", str(script), *args],
                                capture_output=True, text=True, env=env, timeout=120)
        if expect_ok and result.returncode != 0:
            self.fail(f"install.sh {' '.join(args)} failed ({result.returncode}):\n"
                      f"{result.stdout}\n{result.stderr}")
        return result

    @staticmethod
    def reported(output: str, label: str) -> str:
        for line in output.splitlines():
            if line.startswith(f"{label}="):
                return line.split("=", 1)[1]
        raise AssertionError(f"no {label}= line in:\n{output}")

    # -- help -------------------------------------------------------------------------

    def test_help_documents_repo_and_exits_zero(self) -> None:
        result = subprocess.run(["bash", str(INSTALL_SH), "--help"],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--repo", result.stdout)

    def test_script_parses(self) -> None:
        self.assertEqual(subprocess.run(["bash", "-n", str(INSTALL_SH)]).returncode, 0)

    # -- a tarball install ------------------------------------------------------------

    def test_tarball_install_uses_its_own_directory_for_the_code(self) -> None:
        code = self.unpacked_tarball()
        clone = self.clone_source()

        result = self.run_install(code / "install.sh", "--repo", str(clone))

        self.assertEqual(self.reported(result.stdout, "code"), str(code))
        self.assertEqual(self.reported(result.stdout, "repo"), str(clone))

    def test_tarball_install_does_not_need_a_clone_around_the_code(self) -> None:
        """The 1.5 failure: `is not an aideas clone (no orchestrator/orchestrator.py)`."""
        code = self.unpacked_tarball()
        clone = self.clone_source()
        self.assertFalse((code.parent / ".git").exists())
        self.assertFalse((code / "orchestrator").exists())

        result = self.run_install(code / "install.sh", "--repo", str(clone))

        self.assertNotIn("is not an aideas clone", result.stderr)

    def test_repo_that_is_not_a_clone_is_refused_by_name(self) -> None:
        code = self.unpacked_tarball()
        plain = self.path("not-a-clone")
        plain.mkdir()

        result = self.run_install(code / "install.sh", "--repo", str(plain), expect_ok=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--repo", result.stderr)
        self.assertIn(str(plain), result.stderr)

    # -- no --repo: clone the ideas repository ----------------------------------------

    def test_without_repo_it_clones_the_ideas_repository(self) -> None:
        code = self.unpacked_tarball()
        origin = self.clone_source()

        result = self.run_install(code / "install.sh", clone_url=origin)

        cloned = Path(self.reported(result.stdout, "repo"))
        self.assertTrue((cloned / ".git").is_dir(), f"{cloned} is not a clone")
        self.assertTrue((cloned / "README.md").is_file())
        self.assertEqual(cloned.parent, Path(os.environ["HOME"]),
                         "the default clone belongs somewhere the user can find and edit it")
        self.assertIn("clon", result.stdout.lower())

    def test_an_existing_default_clone_is_reused_not_re_cloned(self) -> None:
        code = self.unpacked_tarball()
        origin = self.clone_source()
        first = self.run_install(code / "install.sh", clone_url=origin)
        cloned = Path(self.reported(first.stdout, "repo"))
        support.write(cloned / "README.md", "# edited by the user\n")

        second = self.run_install(code / "install.sh", clone_url=origin)

        self.assertEqual(self.reported(second.stdout, "repo"), str(cloned))
        self.assertEqual((cloned / "README.md").read_text(), "# edited by the user\n",
                         "a re-run must not overwrite the queue the user steers with")

    # -- the real tarball, packed the way the release workflow packs it -----------------

    def test_installs_from_a_tarball_of_the_orchestrator_directory(self) -> None:
        """The published shape end to end: tar czf orchestrator/, unpack, run install.sh."""
        source_root = INSTALL_SH.resolve().parent.parent
        tarball = self.path("orchestrator-test.tar.gz")
        subprocess.run(["tar", "--sort=name", "--owner=0", "--group=0", "--numeric-owner",
                        "--mtime=@0", "--exclude=__pycache__", "--exclude=*.pyc",
                        "-czf", str(tarball), "orchestrator"],
                       cwd=source_root, check=True, timeout=120)
        unpacked = self.path("unpacked")
        unpacked.mkdir()
        subprocess.run(["tar", "xzf", str(tarball)], cwd=unpacked, check=True, timeout=120)

        installer = unpacked / "orchestrator" / "install.sh"
        self.assertTrue(installer.is_file(), "the tarball must carry its own installer")
        self.assertTrue((unpacked / "orchestrator" / "orchestrator.py").is_file())
        self.assertFalse((unpacked / ".git").exists(), "a tarball brings no repository")

        clone = self.clone_source()
        result = self.run_install(installer, "--repo", str(clone))

        self.assertEqual(self.reported(result.stdout, "code"),
                         str(unpacked / "orchestrator"))
        self.assertEqual(self.reported(result.stdout, "repo"), str(clone))

    # -- the clone case, which SETUP.md documents --------------------------------------

    def test_inside_a_clone_it_still_defaults_to_that_clone(self) -> None:
        clone = self.clone_source()
        installer = clone / "orchestrator" / "install.sh"
        support.write(installer, INSTALL_SH.read_text())
        support.write(clone / "orchestrator" / "heartbeat_server.py", "# hb\n")
        support.commit_all(clone, "installer")

        result = self.run_install(installer)

        self.assertEqual(self.reported(result.stdout, "repo"), str(clone))
        self.assertEqual(self.reported(result.stdout, "code"), str(clone / "orchestrator"))
        self.assertFalse((Path(os.environ["HOME"]) / "aideas").exists(),
                         "nothing should have been cloned")
