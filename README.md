# aideas — ranked idea list

This file is the orchestrator's work queue. It builds the **topmost eligible** idea below,
one at a time, only while no Claude Code session is active on the laptop. See
[SETUP.md](SETUP.md) for how the machinery is installed and [AGENTS.md](AGENTS.md) for the
rules every idea is built under.

## Format (the orchestrator parses this — keep it)

Each idea is a numbered entry whose first line links to its folder as `ideas/<slug>/`,
where `<slug>` is lowercase letters, digits and hyphens only. The trailing slash is
optional — `ideas/recap` and `ideas/recap/` both work. Lines immediately after the link,
up to the next blank line, are passed to the planner as the idea description — so don't
leave a blank line between the link and its description.

The link *text* is ignored; the folder in the URL is what identifies the idea.

Each idea is developed in **its own GitHub repository**, included here as a submodule at
`ideas/<slug>/upstream`; this repo holds the queue, the plans and the status. Every
completed entry ships a release with built artefacts from that repository, and every idea
provides a way to install it without compiling anything. See [AGENTS.md](AGENTS.md).

Reorder entries to reprioritise: position in this list *is* the priority.

### Adding work to an idea that already exists

List the same folder again, with a description of the new work. An idea folder may appear
as many times as you like, and the entries are done **one at a time, in list order** — two
agents never work on the same folder at once. Each entry gets its own plan: when one is
finished the previous `PLAN.md` is archived under `ideas/<slug>/plans/` and a fresh one is
drafted for the next entry, while the agent keeps its session, so it still remembers the
code it wrote.

This works whether the idea is still in progress or already finished — adding an entry for
a finished idea simply starts it again on the new work.

**Say whether it is a `minor` or a `major` update.** Every idea carries a version, held in
its `STATUS.md` and starting at `0.1`, which its first piece of work delivers. Each later
entry bumps it — `minor` moves `0.1` → `0.2`, `major` moves `0.1` → `1.0` — and the
version is recorded against the entry in `## Finished`. Write the word anywhere in the
entry; if you leave it out the entry is treated as `minor`.

### `## Finished`

When an entry is complete the orchestrator moves it out of `## Ideas` into `## Finished`
at the end of this file, stamped with the date. Only `## Ideas` is the work queue —
anything under `## Finished` is a record and is never scheduled again. That is also what
makes position a safe identity: the active list only ever holds work still to do.

## Ideas

1. [vacas](ideas/vacas/) - A Firefox extension that is activated on demand by user, and tracks user's requests for Rentalia's holidays rental site. It will store locally which 
   places were asked for availability, on which dates, and if the same place appears again in a new search with the same dates, it alerts the user that it was already contacted.
   The extension will store as well the text that was sent. In order to build vacas, the Rentalia web must be researched in search of placeholders to use for detecting the contact form of
   each place contacted, extract the dates, the text and detect when the send button of the contact form has been pushed, to store the info. If the button is not pressed, we
   can't assume the place has been contacted and no info is stored for that place.

2. [wg](ideas/wg) - wg is a game where each player chooses a country and controls the armed forces of that country. For each country, the following information is available: all armed forces, army budget,
   percentage of the budget that is dedicated to maintain the army itself (salaries, vehicle maintenance, ...), allies (countries with which alliances exist), population, PIB, % of PIB dedicated to army budget. 
   Each player (playing as a country), can spend the remaining budget as they see fit to either by new vehicles, ships, planes, or to run operations, even wars. Each player will know where their forces
   are, and can see them displayed on a map. We will use openstreetmap for this (other options can be suggested). The player can choose to move troops, ships or whatever other army forces from one point
   to another. The player can as well choose to start a war with another country. When at war, a player chooses which of its forces attack which of the opponent. When there is no player driving
   the country being attacked, a simulation will run to behave like a player would do: defending and trying to win the fights. The player may choose to attack by sea, air or land. The game will be played
   by creating a repo from this repo (which will be a template repo). All players need to be added to the repo, because each player will push their movements and decisions to their own branch. Each
   player will run a referee that will fetch changes from the other branches and integrate them with the player's ones, so that the player has a clear picture of what is going on. Each movement will take some
   time to being accomplished, so not all players need to be online all the time. Indeed, the game is offline: each player gives orders to its armed forces, and the referee commits them to the player's branch and pushes them. Note that some movements may remain hidden from other players (but not from the referee), such as submarines sailing in secret underwater. We need to think carefully how we get movements out
   of sight for other players, which can inspect the branch of another player. Movements from other players will only be visible if
   the country either have satellites to spy on other countries, or the movement is happening at the range of radars or at a distance that is noticeable. 
   Some details about the UI: for now a TUI is enough, and maps can be rendered as ascii art. As the referee is a process running 
   on the player's computer, it can later on provide a GUI. Think about the implications of using openstreetmaps in terms of API usage, and recommend alternatives if 
   you feel that is a problem.
   This idea needs to be carefully planned first, and the plan must contain a workflow so that several agents can progress on parallel. 

3. [orchestrator](ideas/orchestrator) - A quality gate on `main` will reject the orchestrator's own end-of-cycle pushes, and the rescue path it falls back to keeps the work only on this
   laptop. `settle_submodules` pushes an agent's submodule commits straight to the submodule's default branch; on a repository whose ruleset requires a pull request that push is
   refused, and the fallback merely fetches the objects into `.git/modules/<path>` under a `refs/aideas/rescued/...` ref — local, ignored by git, gone with the clone. Rescued work
   would silently stop reaching any gated repository. Fix it: when the direct push is refused, push to a branch the ruleset does not protect (`agent/<slug>-sweep` or similar) and
   say so loudly enough that the next cycle, or a person, can turn it into a pull request; only fall back to the local rescue when even that fails. Keep the change inside
   `orchestrator/`. This entry also needs somewhere for its test to live: establish `orchestrator/tests/` with a plain `python3 -m unittest`-able suite and a root CI workflow that
   runs it, then port the throwaway suites that already exist for the repo-lock, the push retry, the worktree setup, the gitlink sweep and the release check — five real regressions
   were each verified once against temporary repositories and then thrown away, which is why three of them recurred. Version 1.6, matching `ORCHESTRATOR_VERSION`. The orchestrator
   has no upstream repository and must not get one: it is the thing that runs the cycles, so it lives here. Its release is a `orchestrator-v1.6` tag on this repo carrying a tarball
   of `orchestrator/` that `orchestrator/install.sh` can install without a clone.

4. [quality-gate](ideas/quality-gate) - Make the gate blocking, using the baseline from the previous entry to choose the conditions. Major update. Each supported idea repository
   gets a branch ruleset on `main` requiring a pull request and requiring the SonarQube Cloud check to pass, which is the only combination that reliably stops a change landing —
   required checks alone do not clearly block a direct push. This changes how every agent works, so it also rewrites the workflow rules in AGENTS.md: an agent stops pushing its
   idea's `main` directly and instead pushes a branch, opens a pull request, waits for CI and the gate, and merges when green. Address the three things this breaks: the wait costs
   turns and wall-clock inside a 45-minute cycle; a red gate mid-cycle leaves an entry unfinishable, so define what an agent does then rather than letting it stall; and releases
   are cut from `main`, so the release path moves behind the pull request too. Where the baseline shows a condition no idea can meet — 80% coverage on GJS or LibreOffice UNO code
   is the likely one — set a custom gate at a number that is honest, and say in the plan why.
   **First, publish the missing `quality-gate-v0.1` release.** The previous entry was retired as done
   without one, through no fault of its agent: the orchestrator overwrote `status: done` in the same
   commit that carried it, so `release-quality-gate.yml` read `not_started` and published nothing.
   Orchestrator 1.5 fixed that for future entries, but 0.1 still has no release and `AGENTS.md` says
   an entry without one is not done. The workflow takes a `force` input for exactly this case:
   `gh workflow run "Release - quality-gate" --repo gortazar/aideas -f force=true`. Verify the
   release and its assets exist before starting on the blocking work, and record it in `STATUS.md`.

## Finished

1. [pwgen](ideas/pwgen/) — Gnome Shell extension to generate secure passwords and copy them to the clipboard (finished 2026-08-06)
   Pwgen is a small Gnome Shell extension that generates a secure password by calling the command pwgen and 
   copies it to the clipboard automatically. This extension already exists and its code is hosted at
   [github.com/gortazar/pwgen](https://github.com/gortazar/gnome-shell-pwgen). To comply with strict [review
   rules from the Gnome Shell portal](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
   we need to replace the call to pwgen with our own code to generate the secure passwords. When doing this change
   ensure that: CI is run on the branch this change is done, CI is green, changes conform with the review rules.

2. [gnome-tasks](ideas/gnome-tasks/) — KDE Activities port to Gnome (finished 2026-08-09)
   KDE Activities is a Plasma app that allows users to combine apps under a specific task, and change between
   tasks effortlessly. When the user switch to a task, all the applications that were open the last time the task 
   was used are opened in their respective monitors/workspaces. KDE Activities is documented in several pages,
   [here](https://docs.kde.org/trunk_kf6/en/plasma-desktop/plasma-desktop/activities-interface.html), 
   [here](https://docs.kde.org/trunk_kf6/en/plasma-desktop/kcontrol/kcmactivities/index.html), 
   [and here in the wiki](https://community.kde.org/KDE_Visual_Design_Group/Plasma_Activities). This idea brings
   this concept to Gnome. This is a complex project, and some things may be worth pointed out: it must be a
   task switcher in the gnome shell top bar; for each app opened, the project must keep not just the name of the app
   but also the file it opened; if there are commands running (like docker compose up), they must be launched as well,
   some apps supporting multiple windows/tabs may require specific plugins: for instance, firefox may need a plugin
   to tell Gnome Activities which tabs are opened in that firefox window so that they can be restored when the task is
   deactivated and reactivated later. The gnome-tasks idea requires a deep understanding on how Gnome works, events that are
   fired when apps are launched (like DBus), and where is the necessary info that needs to be kept for an activity. All this knowledge
   must be clearly documented within the idea folder. 

3. [Recap](ideas/recap) - recap is a command line tool that provides quick info (a very brief report) about what your agents were doing when you left it, and what's the status right now. (finished 2026-08-10)
   It should work with claude code and opencode. The info shown must be something like this (each item must provide at the beginning some icon or emoticon stating if the task is running, awaiting for input, finished): 
      * aideas (Claude Code) -> Was running the orchestrator against ideas 6 and 8. Idea 7 stopped and requested further info. It is not running at the moment.
      * ov-blog (Claude Code) -> Was implementing utm support but was interrupted mid-task by laptop suspension and is now resuming work. Not finished yet.
      * ov-marketing (Claude Code) -> Already implemented GA4 support.
      * ollama (opencode) -> Still downloading instance files. 

4. [Recap.gs](ideas/recap-gs) - A gnome shell plugin for recap (can't be started until recap has a clear API). It shows a list of AI tasks, and their statuses. When a task is clicked, (finished 2026-08-13, v0.1)
   its session is restored (by running claude -r on claude or the equivalent command on opencode). Important: it must be restored from the same folder it was running when the process 
   stopped or was killed.

5. [recap](ideas/recap/) - Add specific installation instructions. Add an action to build and publish the binary. And add a script to install it via curl. Add documentation on (finished 2026-08-13, v0.2)
   how to install via curl to the readme. Minor change.

6. [recap](ideas/recap/) - Add below each claude session a one paragraph report of what was done the last 24 hours. It must be indented for clarity. Minor change. (finished 2026-08-13, v0.3)

7. [recap-gs](ideas/recap-gs/) - Change appearance when a session asked something or finishes its task. Make a plan for this, as detecting this would preferably not require a monitor (finished 2026-08-14, v0.2)
   running and inspecting internal details, but rather detect notifications or the like. Minor. 

8. [aideas](ideas/aideas/) - Build a gnome shell extension that shows a button when aideas is running, and when clicked it shows which ideas are running, which are ready (could be run), which blocked (finished 2026-08-14, v0.1)
   with questions. The gnome shell extension will call `http://<box-vpn-ip>:8787/state` on the orchestrator to read the live status. 
   This project must be done within this repo. Do not create an external repo for this. The gnome shell extension must install along with the orchestrator.

9. [recap](ideas/recap/) - Add an option to ask for the sessions in the last n hours or n days: --since 6h --since 7d. Minor. (finished 2026-08-14, v0.4)

10. [title-slides](ideas/title-slides) - A quarto extension that when activated with `title-slides: true` in the frontmatter uses the first h2 title as the default title for that slide (finished 2026-08-16, v0.1)
   and any consecutive ones until a new h2 title found. So the following sample: 
   ```markdown
   ---
   type: pdf
   title-slides: true
   ---
   # About Quarto
   ---
   ## Introduction

11. [lo-pert](ideas/lo-pert) - A LibreOffice plugin to build Pert diagrams. It must provide states (circles with two numbers on the upper half, and one (finished 2026-08-17, v0.1)
   on the lower one), and actions (links that start on a state and end on another state and have a label). The plugin must support building
   automatically a pert diagram out of a precedence table, calculating the early and late times for each state. 

12. [Restore workspaces](ideas/restore-wss/) - The goal of this tool is to restore all the workspaces as they were before the system powered off or rebooted. (finished 2026-08-17, v0.1)
   The tool needs to record which apps were open on which workspace, and restore all of them. The restoration must left the different workspaces as they
   were before the power off or reboot. If needed, the user can be asked about information that cannot be collected automatically, or
   that cannot be collected with confidence. A config file must be stored in the home folder of the user in a dedicated hidden folder (such as .restore-wss)
   and it must contain all the information needed to restore the workspaces. First, an in-depth study of similar tools must be done and reported as a markdown
   file in the idea folder. The tool must support:
   * Restoring apps opened and which file or folder are they working on. For instance, libreoffice with a "Thesis" document opened, or a Codium instance
     with a my-app folder opened.
   * Restoring command line apps and the commands with which they were started and from where. For instance, a terminal running an ssh session with a my-host node, or a claude session 
     started with claude -r or claude -n from a my-repo folder.
   * Restoring which vpn was active if any 

13. [aideas](ideas/aideas/) - Build a release workflow to run every time changes are made to aideas gnome shell extension that publishes the extension as required (finished 2026-08-17, v0.2)
   by the install script. As a result of this change a new release of the extension must be made available in this repo. Minor version.

14. [Restore workspaces](ideas/restore-wss) - Support for restoring browsers and the tabs that were open inside them (may require a browser extension). First, an in-depth research (finished 2026-08-17, v0.2)
   must be done to find similar extensions that could be used as-is, and this report is to be written in the idea folder as "browser-extensions-research.md".

15. [aideas](ideas/aideas) - the icon for the gnome extension must be a bulb 💡 but in grey colors, to match gnome shell appearance.  The extension must show the unanswered questions of each idea when it's blocked. When all ideas are blocked, show the bulb in a way it clearly state it. Minor change. (finished 2026-08-18, v0.3)

16. [title-slides](ideas/title-slides/) - Add an optional show-index value for the frontmatter for title-slides that when true, injects an index of the sections of the document (finished 2026-08-24, v0.2)
   before each section, using as title the title of the slides, and highlightning in bold the section that comes next. Minor version.

17. [recap](ideas/recap/) - If the default 1 day value for --since doesn't produce any result, make it 2d, then 3d, and so on, always specifying in the output the value considered. Minor version. (finished 2026-08-24, v0.5)

18. [title-slides](ideas/title-slides/) The preview of a qmd document with this extension configured in the frontmatter fails with an error. I added the qmd file that failed (finished 2026-08-24, v0.3)
   to the ideas/title-slides/tests folder within this repo. Build a test in the title-slides repo that uses this document (it's license is CC-By-SA-4.0 so it can be shared 
   in title-slides' own repo) to ensure the extension works as expected. It must render it properly. The error lines are provided below:
   FATAL (/opt/quarto/share/filters/main.lua:3757) An error occurred:
   Could not run /home/patxi/Insync/francisco.gortazar@urjc.es/OneDrive Biz/Asignaturas/LP/Módulo II - Python/Material/title-slides as a JSON filter.
   Please make sure the file exists and is executable.
   Did you intend 'title-slides' as a Lua filter in an extension?
   If so, make sure you've spelled the name of the extension correctly.
   The original Pandoc error follows below.
   Error running filter /home/patxi/Insync/francisco.gortazar@urjc.es/OneDrive Biz/Asignaturas/LP/Módulo II - Python/Material/title-slides:
   Could not find executable /home/patxi/Insync/francisco.gortazar@urjc.es/OneDrive Biz/Asignaturas/LP/Módulo II - Python/Material/title-slides
   Error running filter /opt/quarto/share/filters/main.lua:
   /opt/quarto/share/filters/main.lua:586: FATAL QUARTO ERROR
   stack traceback:
        /opt/quarto/share/filters/main.lua:2619: in function 'fatal'
        /opt/quarto/share/filters/main.lua:2199: in function 'fail'
        /opt/quarto/share/filters/main.lua:3757: in field 'Pandoc'
        /opt/quarto/share/filters/main.lua:586: in function 'run_emulated_filter'
        /opt/quarto/share/filters/main.lua:1314: in local 'callback'
        /opt/quarto/share/filters/main.lua:1332: in upvalue 'run_emulated_filter_chain'
        /opt/quarto/share/filters/main.lua:1368: in function </opt/quarto/share/filters/main.lua:1365>
   WARN: Error encountered when rendering files

19. [aideas](ideas/aideas/) - Add two buttons to aideas gnome shell extension: one to re-check the status on demand, and another to run a cycle. Minor version. (finished 2026-08-25, v0.4)

20. [title-slides](ideas/title-slides/) - The index is never shown despite the show-index:true variable is set in frontmatter. Patch version (0.3 -> 0.3.1) (finished 2026-08-25, v0.4)

21. [title-slides](ideas/title-slides/) - The index must be extracted from level 2 titles ("##"), not from level 1 ("#"). Level 1 is reserved for the title slide. Sections use level 2 instead. Minor version. (finished 2026-08-25, v0.5)

22. [quality-gate](ideas/quality-gate) - Roll SonarQube Cloud analysis out across every idea repository whose language it supports, advisory at first. Sonar is free for public (finished 2026-08-25, v0.1)
   repositories with no line-of-code limit, and all of these are public. Deliver a reusable workflow in this repository at `.github/workflows/sonar.yml`, tagged so ideas can pin it
   as `@v1`, which runs the analysis on push and on pull request; wire each supported idea repository up to call it; and add the project badge to each idea's README. The default
   `Sonar way` gate judges new code only — no new bugs, no new vulnerabilities, maintainability A, hotspots reviewed, 80% coverage on new code, 3% duplication. Do **not** make it
   blocking in this entry. Instead produce `ideas/quality-gate/baseline.md`: for every repository, what the gate says today and how far each condition is from passing, with the
   numbers, so the next entry can choose its conditions from evidence rather than from the defaults. `title-slides` is Lua, which Sonar does not analyse — record that as out of
   scope rather than substituting a different tool. This project must be done within this repo. Do not create an external repo for this.
