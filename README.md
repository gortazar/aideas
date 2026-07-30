# aideas — ranked idea list

This file is the orchestrator's work queue. It builds the **topmost eligible** idea below,
one at a time, only while no Claude Code session is active on the laptop. See
[SETUP.md](SETUP.md) for how the machinery is installed and [AGENTS.md](AGENTS.md) for the
rules every idea is built under.

## Format (the orchestrator parses this — keep it)

Each idea is a numbered entry whose first line links to its folder as `ideas/<slug>/`,
where `<slug>` is lowercase letters, digits and hyphens only. Lines immediately after the
link, up to the next blank line, are passed to the planner as the idea description — so
don't leave a blank line between the link and its description.

Reorder entries to reprioritise: position in this list *is* the priority.

## Ideas

1. [markdown-toc](ideas/markdown-toc/) — table-of-contents generator for Markdown files
   A small CLI that reads one or more Markdown files and inserts (or refreshes) a
   table of contents between `<!-- toc -->` / `<!-- /toc -->` markers. Should handle
   nested headings, skip fenced code blocks, generate GitHub-compatible anchor slugs,
   and support `--check` mode that exits non-zero if the TOC is out of date so it can
   run in CI. Throwaway idea, seeded to exercise the orchestrator end to end.

2. [unit-convert](ideas/unit-convert/) — command-line unit converter
   A CLI that converts between units of length, mass, temperature and data size, e.g.
   `unit-convert 3.5 mi km`. Should parse common unit aliases, keep a reasonable
   precision, print a clear error for incompatible dimensions, and expose the
   conversion table as data rather than hardcoded branches. Throwaway idea, seeded to
   exercise the orchestrator end to end.
