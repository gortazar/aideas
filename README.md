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

1. [pwgen](ideas/pwgen/) — Gnome Shell extension to generate secure passwords and copy them to the clipboard
   Pwgen is a small Gnome Shell extension that generates a secure password by calling the command pwgen and 
   copies it to the clipboard automatically. This extension already exists and its code is hosted at
   [github.com/gortazar/pwgen](https://github.com/gortazar/gnome-shell-pwgen). To comply with strict [review
   rules from the Gnome Shell portal](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
   we need to replace the call to pwgen with our own code to generate the secure passwords. When doing this change
   ensure that: CI is run on the branch this change is done, CI is green, changes conform with the review rules.

2. [gnome-tasks](ideas/gnome-tasks/) — KDE Activities port to Gnome
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

3. [Restore workspaces](ideas/restore-wss/) - The goal of this tool is to restore all the workspaces as they were before the system powered off or rebooted.
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

4. [Restore workspaces](ideas/restore-wss) - Support for restoring browsers and the tabs that were open inside them (may require a browser extension). First, an in-depth research
   must be done to find similar extensions that could be used as-is, and this report is to be written in the idea folder as "browser-extensions-research.md".
   