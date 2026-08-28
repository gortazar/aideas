#!/usr/bin/env python3
"""The `/state` contract, asserted against fixture repositories.

`docs/state-contract.md` specifies what the aideas panel indicator reads. This test is what
makes that document true: it drives `orchestrator.queue_rows()` and
`heartbeat_server.orchestrator_state()` over repositories built on disk, and asserts the
keys, the types and the `state` vocabulary the extension depends on.

It lives here, in the idea folder, rather than beside the orchestrator, because it exists
for this idea's benefit: the extension and the endpoint are in one repository, and this is
what stops them drifting apart. Run it with `python3 -m unittest discover -s tests` or
through `nix flake check`.
"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "orchestrator"))

import orchestrator  # noqa: E402


VOCABULARY = {"running", "ready", "blocked", "queued", "to be planned"}
ALWAYS = {"position", "slug", "version", "state", "note", "will_run_next"}
CONDITIONAL = {"open_questions", "open_question_texts", "target_version"}

CONFIG = "parallel_agents: 2\nmax_cycle_minutes: 45\n"


def readme(ideas, finished=()):
    """A README.md the queue parser accepts: numbered entries linking to idea folders."""
    def section(entries, start=1):
        return "\n\n".join(
            f"{number}. [{slug}](ideas/{slug}/) - {text}"
            for number, (slug, text) in enumerate(entries, start))

    return ("# aideas — ranked idea list\n\n## Ideas\n\n"
            + section(ideas)
            + "\n\n## Finished\n\n"
            + section(finished)
            + "\n")


class Fixture:
    """A repository on disk: a README queue, per-idea STATUS.md/PLAN.md, and a lock."""

    def __init__(self, root, ideas, finished=()):
        self.root = Path(root)
        (self.root / ".agent-config.yml").write_text(CONFIG)
        (self.root / "README.md").write_text(readme(ideas, finished))

    def idea(self, slug, status=None, version=None, plan=None, questions=0):
        """Write an idea folder. `plan=None` means no PLAN.md at all — "to be planned"."""
        folder = self.root / "ideas" / slug
        folder.mkdir(parents=True, exist_ok=True)
        lines = []
        if status is not None:
            lines.append(f"status: {status}")
        if version is not None:
            lines.append(f"version: {version}")
        if lines:
            (folder / "STATUS.md").write_text("\n".join(lines) + "\n")
        if plan is not None or questions:
            body = plan or f"# Plan: {slug}\n\n## Open Questions\n"
            if questions:
                body += "".join(f"- [ ] question {n}\n" for n in range(1, questions + 1))
            (folder / "PLAN.md").write_text(body)
        return self

    def lock(self, agents, renewed_ago=0, ttl_minutes=5, acquired_ago=None):
        """Write the cycle lock's metadata, as a live cycle rewrites it periodically."""
        lock_dir = self.root / ".orchestrator" / "lock"
        lock_dir.mkdir(parents=True, exist_ok=True)
        now = time.time()
        (lock_dir / "meta.json").write_text(json.dumps({
            "acquired_at": now - (acquired_ago if acquired_ago is not None else renewed_ago),
            "renewed_at": now - renewed_ago,
            "ttl_minutes": ttl_minutes,
            "agents": list(agents),
        }))
        return self

    def rows(self, running=()):
        return orchestrator.queue_rows(self.root, tuple(running))

    def state(self):
        """The endpoint's own body, with IDEAS_REPO_PATH pointed at this fixture."""
        return endpoint_state(str(self.root))


def endpoint_state(repo_path):
    """Call heartbeat_server.orchestrator_state() with IDEAS_REPO_PATH set (or unset).

    Imported lazily and with the environment restored, because the module reads process
    environment at call time and configures a server at import time.
    """
    sys.path.insert(0, str(REPO_ROOT / "orchestrator"))
    import heartbeat_server

    previous = os.environ.get("IDEAS_REPO_PATH")
    if repo_path is None:
        os.environ.pop("IDEAS_REPO_PATH", None)
    else:
        os.environ["IDEAS_REPO_PATH"] = repo_path
    try:
        return json.loads(json.dumps(heartbeat_server.orchestrator_state()))
    finally:
        if previous is None:
            os.environ.pop("IDEAS_REPO_PATH", None)
        else:
            os.environ["IDEAS_REPO_PATH"] = previous


class ContractTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def fixture(self, ideas, finished=()):
        return Fixture(self.tmp, ideas, finished)

    def assertRowShape(self, row):
        """Every row carries the always-present keys, correctly typed, and nothing unknown."""
        self.assertLessEqual(ALWAYS, set(row), f"missing required keys: {row}")
        self.assertLessEqual(set(row) - ALWAYS, CONDITIONAL, f"unspecified key in {row}")
        self.assertIsInstance(row["position"], int)
        self.assertGreaterEqual(row["position"], 1)
        self.assertIsInstance(row["slug"], str)
        self.assertRegex(row["slug"], r"^[a-z0-9-]+$")
        self.assertIsInstance(row["version"], str)
        self.assertRegex(row["version"], r"^\d+\.\d+$")
        self.assertIn(row["state"], VOCABULARY)
        self.assertIsInstance(row["note"], str)
        self.assertIsInstance(row["will_run_next"], bool)
        if "open_questions" in row:
            self.assertEqual(row["state"], "blocked")
            self.assertIsInstance(row["open_questions"], int)
            self.assertGreaterEqual(row["open_questions"], 1)
            # The texts travel with the count, always both or neither.
            self.assertIn("open_question_texts", row)
            texts = row["open_question_texts"]
            self.assertIsInstance(texts, list)
            self.assertLessEqual(len(texts), orchestrator.OPEN_QUESTION_MAX_SENT)
            self.assertLessEqual(len(texts), row["open_questions"])
            for text in texts:
                self.assertIsInstance(text, str)
                self.assertTrue(text.strip(), "a question is never blank")
                self.assertLessEqual(len(text), orchestrator.OPEN_QUESTION_MAX_CHARS)
                self.assertNotIn("\n", text, "a question is folded to one line")
                self.assertFalse(text.startswith("- ["), "the checkbox is stripped")
        else:
            self.assertNotIn("open_question_texts", row,
                             "texts without a count would be a shape nobody agreed to")
        if "target_version" in row:
            self.assertEqual(row["state"], "ready")
            self.assertRegex(row["target_version"], r"^\d+\.\d+$")


class QueueRowsTest(ContractTestCase):
    """The row vocabulary and the invariants the extension keys its rendering on."""

    def test_ready_idea_is_ready_and_will_run_next(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="not_started", version="0.1", plan="# Plan\n").rows()

        self.assertEqual(len(rows), 1)
        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "ready")
        self.assertEqual(rows[0]["note"], "not started")
        self.assertTrue(rows[0]["will_run_next"])
        self.assertEqual(rows[0]["target_version"], "0.1")
        self.assertNotIn("open_questions", rows[0])

    def test_in_progress_idea_is_ready_and_says_so(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.1", plan="# Plan\n").rows()

        self.assertEqual(rows[0]["state"], "ready")
        self.assertEqual(rows[0]["note"], "in progress")

    def test_running_slug_is_running_whatever_its_files_say(self):
        fixture = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="not_started", version="0.1", plan="# Plan\n")

        rows = fixture.rows(running=["alpha"])

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "running")
        self.assertEqual(rows[0]["note"], "an agent is working on it now")
        # A running cycle means nothing is up next, and running is not a ready row.
        self.assertFalse(rows[0]["will_run_next"])
        self.assertNotIn("target_version", rows[0])

    def test_a_blocked_idea_reports_how_many_questions(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", questions=2).rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "blocked")
        self.assertEqual(rows[0]["open_questions"], 2)
        self.assertEqual(rows[0]["note"], "2 unanswered questions")
        self.assertFalse(rows[0]["will_run_next"],
                         "a blocked idea must never be advertised as next")

    def test_one_question_is_singular(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.1", questions=1).rows()

        self.assertEqual(rows[0]["open_questions"], 1)
        self.assertEqual(rows[0]["note"], "1 unanswered question")

    def test_a_blocked_idea_carries_the_questions_themselves(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", questions=2).rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["open_question_texts"], ["question 1", "question 2"],
                         "in file order, checkbox stripped")

    def test_a_question_wrapped_over_several_lines_is_folded_into_one(self):
        # How the questions in this repo's PLAN.md files are actually written.
        plan = (
            "# Plan: alpha\n\n## Open Questions\n"
            "- [ ] **Should the panel button appear when every idea is blocked**, even\n"
            "      though no cycle is running? The alternative is to keep the rule\n"
            "      strictly.\n"
        )
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", plan=plan).rows()

        self.assertEqual(rows[0]["open_questions"], 1)
        self.assertEqual(rows[0]["open_question_texts"], [
            "Should the panel button appear when every idea is blocked, even though no cycle "
            "is running? The alternative is to keep the rule strictly.",
        ])

    def test_markdown_emphasis_goes_but_identifiers_survive(self):
        plan = (
            "# Plan: alpha\n\n## Open Questions\n"
            "- [ ] Does the unit have `IDEAS_REPO_PATH` in its *environment*, or is\n"
            "      **HEARTBEAT_BIND_IP** the one that matters?\n"
        )
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", plan=plan).rows()

        self.assertEqual(rows[0]["open_question_texts"], [
            "Does the unit have IDEAS_REPO_PATH in its environment, or is "
            "HEARTBEAT_BIND_IP the one that matters?",
        ], "asterisks and backticks are markup for a file; underscores are part of a name")

    def test_a_question_longer_than_the_cap_is_cut_with_an_ellipsis(self):
        long_question = " ".join(["word"] * 200)
        plan = f"# Plan: alpha\n\n## Open Questions\n- [ ] {long_question}\n"
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", plan=plan).rows()

        [text] = rows[0]["open_question_texts"]
        self.assertLessEqual(len(text), orchestrator.OPEN_QUESTION_MAX_CHARS)
        self.assertTrue(text.endswith("…"))
        self.assertFalse(text.endswith("wor…"), "cut at a word boundary, not mid-word")

    def test_more_questions_than_the_cap_are_counted_but_not_all_sent(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2",
            questions=orchestrator.OPEN_QUESTION_MAX_SENT + 3).rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["open_questions"], orchestrator.OPEN_QUESTION_MAX_SENT + 3,
                         "the count is whole, so a UI can say how many are not shown")
        self.assertEqual(len(rows[0]["open_question_texts"]),
                         orchestrator.OPEN_QUESTION_MAX_SENT)
        self.assertEqual(rows[0]["open_question_texts"][0], "question 1",
                         "the first questions are the ones sent")

    def test_ticked_and_unticked_questions_mixed(self):
        plan = (
            "# Plan: alpha\n\n## Open Questions\n"
            "- [x] This one was answered, and its answer runs on\n"
            "      to a second line.\n"
            "- [ ] This one is still open.\n"
            "- [x] Answered as well.\n"
            "- [ ] So is this one.\n"
        )
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", plan=plan).rows()

        self.assertEqual(rows[0]["open_questions"], 2)
        self.assertEqual(rows[0]["open_question_texts"],
                         ["This one is still open.", "So is this one."],
                         "an answered question's prose never leaks into an open one")

    def test_questions_end_at_the_next_heading(self):
        plan = (
            "# Plan: alpha\n\n## Open Questions\n"
            "- [ ] The open one.\n\n"
            "## Current status\n"
            "- [ ] not a question at all, just a checklist somewhere else\n"
        )
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="in_progress", version="0.2", plan=plan).rows()

        self.assertEqual(rows[0]["open_questions"], 1)
        self.assertEqual(rows[0]["open_question_texts"], ["The open one."])

    def test_the_count_and_the_texts_come_from_one_reader(self):
        """Whatever the file looks like, the count is the length of the unbounded list."""
        plans = [
            "# Plan\n\n## Open Questions\n",
            "# Plan\n\n## Open Questions\n- [ ] one\n",
            "# Plan\n\n## Open Questions\n- [ ] one\n- [x] two\n- [ ] three\n",
            "# Plan\n\n## Open Questions\n- [ ]\n- [ ] real\n",
            "# Plan\n\n## Open Questions\n- [ ] a\n  continued\n\n- [ ] b\n",
        ]
        for body in plans:
            fixture = self.fixture([("alpha", "an idea")])
            fixture.idea("alpha", status="in_progress", version="0.2", plan=body)
            plan_path = fixture.root / "ideas" / "alpha" / "PLAN.md"

            lines = orchestrator.open_question_lines(plan_path)
            self.assertEqual(orchestrator.count_open_questions(plan_path), len(lines),
                             f"disagreement for {body!r}")

    def test_status_blocked_with_no_questions_left_is_ready(self):
        """A blocked STATUS.md whose questions have all been answered is a stale flag.

        Nothing ever cleared `status: blocked`, so answering the question that caused it
        left the idea unbuildable forever and the table reported "STATUS.md says blocked"
        as though it were a fact. Orchestrator 1.4 treats the questions as the source of
        truth; this pins that, and the test below pins the case it must not swallow.
        """
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="blocked", version="0.1", plan="# Plan\n").rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "ready")
        self.assertEqual(rows[0]["note"], "questions answered; unblocks next cycle")
        self.assertNotIn("open_questions", rows[0],
                         "open_questions is only present when questions were counted")

    def test_status_blocked_with_an_open_question_is_still_blocked(self):
        plan = "# Plan\n\n## Open Questions\n- [ ] which colour?\n"
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="blocked", version="0.1", plan=plan).rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "blocked")
        self.assertEqual(rows[0]["note"], "1 unanswered question")
        self.assertEqual(rows[0]["open_questions"], 1)

    def test_an_idea_with_no_plan_is_to_be_planned(self):
        rows = self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="not_started", version="0.1", plan=None).rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "to be planned")
        self.assertEqual(rows[0]["note"], "no PLAN.md yet")

    def test_an_idea_with_no_status_file_defaults_to_version_0_1(self):
        fixture = self.fixture([("alpha", "an idea")])
        (fixture.root / "ideas" / "alpha").mkdir(parents=True)
        (fixture.root / "ideas" / "alpha" / "PLAN.md").write_text("# Plan\n")

        rows = fixture.rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["version"], "0.1")
        self.assertEqual(rows[0]["state"], "ready")

    def test_duplicate_slugs_queue_behind_the_first(self):
        """slug is not a key: position is. The extension must key rows by position."""
        fixture = self.fixture([
            ("alpha", "first piece of work"),
            ("beta", "another idea"),
            ("alpha", "a second piece of work. Minor."),
        ])
        fixture.idea("alpha", status="not_started", version="0.1", plan="# Plan\n")
        fixture.idea("beta", status="not_started", version="0.1", plan="# Plan\n")

        rows = fixture.rows()

        for row in rows:
            self.assertRowShape(row)
        self.assertEqual([r["position"] for r in rows], [1, 2, 3])
        self.assertEqual([r["slug"] for r in rows], ["alpha", "beta", "alpha"])
        self.assertEqual(rows[2]["state"], "queued")
        self.assertEqual(rows[2]["note"], "behind #1")
        self.assertFalse(rows[2]["will_run_next"])
        self.assertNotIn("target_version", rows[2])
        # Two slots, two ready rows at the head: both are picked next.
        self.assertEqual([r["will_run_next"] for r in rows], [True, True, False])

    def test_will_run_next_is_capped_by_parallel_agents(self):
        fixture = self.fixture([(slug, "an idea") for slug in ("a", "b", "c")])
        for slug in ("a", "b", "c"):
            fixture.idea(slug, status="not_started", version="0.1", plan="# Plan\n")

        rows = fixture.rows()

        self.assertEqual([r["will_run_next"] for r in rows], [True, True, False])

    def test_nothing_will_run_next_while_a_cycle_is_running(self):
        fixture = self.fixture([("alpha", "an idea"), ("beta", "another")])
        fixture.idea("alpha", status="not_started", version="0.1", plan="# Plan\n")
        fixture.idea("beta", status="not_started", version="0.1", plan="# Plan\n")

        rows = fixture.rows(running=["alpha"])

        self.assertEqual([r["state"] for r in rows], ["running", "ready"])
        self.assertEqual([r["will_run_next"] for r in rows], [False, False])

    def test_a_finished_entry_reopening_targets_the_bumped_version(self):
        fixture = self.fixture(
            [("alpha", "a further piece of work. Minor.")],
            finished=[("alpha", "the original work (finished 2026-01-01)")])
        fixture.idea("alpha", status="done", version="0.2", plan="# Plan\n")

        rows = fixture.rows()

        self.assertRowShape(rows[0])
        self.assertEqual(rows[0]["state"], "ready")
        self.assertEqual(rows[0]["note"], "finished before — reopens for this entry")
        self.assertEqual(rows[0]["version"], "0.2")

    def test_a_major_update_declares_its_target_version(self):
        fixture = self.fixture(
            [("alpha", "a rewrite. Major.")],
            finished=[("alpha", "the original work (finished 2026-01-01)")])
        fixture.idea("alpha", status="in_progress", version="1.4", plan="# Plan\n")

        rows = fixture.rows()

        self.assertEqual(rows[0]["state"], "ready")
        self.assertEqual(rows[0]["note"], "major update -> v2.0")
        self.assertEqual(rows[0]["target_version"], "2.0")

    def test_an_empty_queue_is_an_empty_list(self):
        rows = self.fixture([]).rows()

        self.assertEqual(rows, [])

    def test_every_entry_of_a_running_slug_is_running(self):
        """A running slug's later entries are `running` too, not `queued`.

        `queue_rows` checks the agent list before the duplicate check and does not add a
        running slug to the seen set, so both entries report running. A UI must therefore
        expect the same slug more than once inside the Running section.
        """
        fixture = self.fixture([
            ("alpha", "first piece of work"),
            ("alpha", "a second piece of work. Minor."),
        ])
        fixture.idea("alpha", status="in_progress", version="0.1", plan="# Plan\n")

        rows = fixture.rows(running=["alpha"])

        for row in rows:
            self.assertRowShape(row)
        self.assertEqual([r["state"] for r in rows], ["running", "running"])
        self.assertEqual([r["position"] for r in rows], [1, 2])

    def test_the_whole_vocabulary_is_reachable_in_one_queue(self):
        """One queue exercising all five words, in queue order."""
        fixture = self.fixture([
            ("runner", "being built"),
            ("asker", "has questions"),
            ("fresh", "ready to go"),
            ("fresh", "a second entry, behind the first"),
            ("unplanned", "no plan yet"),
        ])
        fixture.idea("runner", status="in_progress", version="0.1", plan="# Plan\n")
        fixture.idea("asker", status="in_progress", version="0.1", questions=3)
        fixture.idea("fresh", status="not_started", version="0.1", plan="# Plan\n")
        fixture.idea("unplanned", status="not_started", version="0.1", plan=None)

        rows = fixture.rows(running=["runner"])

        for row in rows:
            self.assertRowShape(row)
        self.assertEqual([r["state"] for r in rows],
                         ["running", "blocked", "ready", "queued", "to be planned"])
        self.assertEqual({r["state"] for r in rows}, VOCABULARY,
                         "the fixture must cover the documented vocabulary exactly")


class EndpointTest(ContractTestCase):
    """The body `GET /state` actually returns, including its failure shape."""

    def ready_fixture(self):
        return self.fixture([("alpha", "an idea")]).idea(
            "alpha", status="not_started", version="0.1", plan="# Plan\n")

    def test_unset_repo_path_is_unavailable_with_a_reason(self):
        body = endpoint_state(None)

        self.assertEqual(body["available"], False)
        self.assertEqual(body["reason"], "IDEAS_REPO_PATH is not set")

    def test_an_unparseable_queue_is_unavailable_with_a_reason(self):
        fixture = self.ready_fixture()
        (fixture.root / "README.md").unlink()

        body = fixture.state()

        self.assertEqual(body["available"], False)
        self.assertIn("could not read the queue", body["reason"])
        self.assertNotIn("ideas", body,
                         "an unavailable body promises nothing but a reason")

    def test_an_idle_box_is_available_and_not_running(self):
        body = self.ready_fixture().state()

        self.assertEqual(body["available"], True)
        self.assertEqual(body["running"], False)
        self.assertEqual(body["agents"], [])
        self.assertIsNone(body["cycle_started_at"])
        self.assertIsNone(body["lock_age_seconds"],
                          "no lock at all means the age is unknown, not zero")
        self.assertEqual([r["state"] for r in body["ideas"]], ["ready"])

    def test_a_live_lock_reports_running_with_its_agents_and_age(self):
        fixture = self.ready_fixture().lock(["alpha"], renewed_ago=30, acquired_ago=600)

        body = fixture.state()

        self.assertEqual(body["available"], True)
        self.assertEqual(body["running"], True)
        self.assertEqual(body["agents"], ["alpha"])
        self.assertIsInstance(body["cycle_started_at"], float)
        self.assertLess(body["cycle_started_at"], time.time())
        self.assertIsInstance(body["lock_age_seconds"], int)
        self.assertLessEqual(abs(body["lock_age_seconds"] - 30), 2)
        self.assertEqual(body["ideas"][0]["state"], "running",
                         "the lock's agent list is what makes a row running")

    def test_a_stale_lock_is_not_running_but_still_reports_its_age(self):
        """A killed cycle leaves a lock behind; the climbing age is the visible symptom."""
        fixture = self.ready_fixture().lock(["alpha"], renewed_ago=3600, ttl_minutes=5)

        body = fixture.state()

        self.assertEqual(body["running"], False)
        self.assertEqual(body["agents"], [], "a dead cycle holds nothing")
        self.assertIsNone(body["cycle_started_at"])
        self.assertGreater(body["lock_age_seconds"], 300)
        self.assertEqual(body["ideas"][0]["state"], "ready",
                         "a stale lock must not keep an idea looking busy")

    def test_a_corrupt_lock_degrades_to_idle(self):
        fixture = self.ready_fixture()
        lock_dir = fixture.root / ".orchestrator" / "lock"
        lock_dir.mkdir(parents=True)
        (lock_dir / "meta.json").write_text("{not json")

        body = fixture.state()

        self.assertEqual(body["available"], True)
        self.assertEqual(body["running"], False)
        self.assertIsNone(body["lock_age_seconds"])

    def test_the_available_body_carries_exactly_the_documented_keys(self):
        body = self.ready_fixture().lock(["alpha"], renewed_ago=5).state()

        self.assertEqual(set(body), {"available", "running", "agents", "cycle_started_at",
                                     "lock_age_seconds", "ideas"})

    def test_the_body_is_json_serialisable(self):
        """The endpoint json.dumps() this; a non-serialisable value would 500 the request."""
        body = self.ready_fixture().lock(["alpha"], renewed_ago=5).state()

        self.assertIsInstance(json.dumps(body), str)


if __name__ == "__main__":
    unittest.main()
