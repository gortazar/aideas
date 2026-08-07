// The D-Bus contract between the three gnome-tasks processes.
//
// Shell-free on purpose: this module is imported by the daemon, by the Shell extension and by
// the unit tests, so it must not touch Meta/St/Shell or anything else that only exists inside
// gnome-shell.
//
// There are two interfaces, pointing in opposite directions:
//
//   org.gnome.Tasks        — owned by gnome-tasks-daemon. The public API (see docs). Clients are
//                            the extension, the preferences window, tier-2 app plugins and any
//                            script the user cares to write. Deliberately echoes
//                            org.kde.ActivityManager so the concepts map across.
//   org.gnome.Tasks.Shell  — owned by the *extension*, i.e. living inside the compositor. The
//                            daemon calls this for the things only in-process code can do:
//                            enumerating windows, placing them, closing them, and launching apps
//                            with an activation token that lets the new window be matched back.
//
// Payload style: simple arguments are typed; whole task documents cross the bus as JSON strings,
// because they are already a versioned JSON schema on disk (docs/state-schema.md) and mirroring
// that schema into D-Bus types would mean two things to migrate instead of one.

/** Bumped when a change to either interface is not backwards compatible. */
export const API_VERSION = 1;

export const DAEMON_NAME = 'org.gnome.Tasks';
export const DAEMON_OBJECT_PATH = '/org/gnome/Tasks';

export const SHELL_NAME = 'org.gnome.Tasks.Shell';
export const SHELL_OBJECT_PATH = '/org/gnome/Tasks/Shell';

/**
 * Task lifecycle, following KDE's model: a task that is STOPPED still exists (its definition and
 * saved layout are on disk), it simply has no windows. Deleting is a separate, destructive act.
 */
export const TaskState = {
    STOPPED: 0,
    ACTIVE: 1,
    RUNNING: 2, // started, has windows, but is not the current task
};

/** What happens to a task's windows when the user switches away from it. */
export const DeactivatePolicy = {
    /**
     * Leave the apps running, parked out of sight. Fast, memory-hungry — and not implemented yet:
     * parking needs a workspace policy that does not exist, so the daemon says so rather than
     * silently doing nothing. See docs/limitations.md.
     */
    HIDE: 'hide',
    /** Ask the apps to quit politely, reopen on return. Slow, may prompt about unsaved work. */
    CLOSE: 'close',
    /** Leave everything exactly where it is — for tasks that are meant to always run. */
    LEAVE: 'leave',
};

export const DAEMON_IFACE_XML = `
<node>
  <interface name="org.gnome.Tasks">
    <!-- Liveness/handshake check. Returns the message it was given, prefixed with the daemon
         version, so a client can verify it is talking to a daemon it understands. -->
    <method name="Ping">
      <arg type="s" name="message" direction="in"/>
      <arg type="s" name="reply" direction="out"/>
    </method>

    <!-- Task summaries: uuid, name, icon, description, state (see TaskState). -->
    <method name="ListTasks">
      <arg type="aa{sv}" name="tasks" direction="out"/>
    </method>

    <!-- The full task document as JSON, per docs/state-schema.md. -->
    <method name="GetTask">
      <arg type="s" name="uuid" direction="in"/>
      <arg type="s" name="json" direction="out"/>
    </method>

    <method name="CreateTask">
      <arg type="s" name="name" direction="in"/>
      <arg type="s" name="icon" direction="in"/>
      <arg type="s" name="uuid" direction="out"/>
    </method>

    <!-- Only the keys present are changed. Recognised: name, icon, description,
         deactivate-policy, commands. -->
    <method name="SetTaskProperties">
      <arg type="s" name="uuid" direction="in"/>
      <arg type="a{sv}" name="properties" direction="in"/>
    </method>

    <!-- Destructive: forgets the definition and the saved layout. -->
    <method name="DeleteTask">
      <arg type="s" name="uuid" direction="in"/>
    </method>

    <!-- Make this the current task: save the outgoing task's layout, apply the outgoing task's
         deactivation policy, then restore this one. -->
    <method name="ActivateTask">
      <arg type="s" name="uuid" direction="in"/>
    </method>

    <!-- Close the task's windows and stop its commands, keeping its definition and layout. -->
    <method name="StopTask">
      <arg type="s" name="uuid" direction="in"/>
    </method>

    <!-- Force a layout capture now, rather than waiting for the debounce. Mostly for tests and
         for the "save layout" affordance in the preferences window. -->
    <method name="CaptureNow">
      <arg type="s" name="uuid" direction="in"/>
    </method>

    <!-- A task's commands never run until the user has confirmed them, so the daemon has to be able
         to ask: CommandsAwaitingConfirmation carries the ones it refused to start, and this is the
         answer. Setting confirmed to false again re-arms the question. -->
    <method name="ConfirmCommand">
      <arg type="s" name="taskUuid" direction="in"/>
      <arg type="s" name="commandId" direction="in"/>
      <arg type="b" name="confirmed" direction="in"/>
    </method>

    <!-- The commands the daemon currently has running for this task, as JSON: unit name, pid, and
         whether systemd adopted the process into a scope. -->
    <method name="ListRunningCommands">
      <arg type="s" name="taskUuid" direction="in"/>
      <arg type="s" name="json" direction="out"/>
    </method>

    <!-- Tier-2 entry point: a cooperating app or browser plugin pushes its own inner state
         (browser tabs, editor project, terminal cwd) as JSON, keyed by adapter id. Recorded against
         whichever task is current, because that is the only context in which it means anything. -->
    <method name="ReportAppState">
      <arg type="s" name="adapterId" direction="in"/>
      <arg type="s" name="json" direction="in"/>
    </method>

    <!-- What a tier-2 adapter last reported for a task, as JSON; '{}' when there is nothing. -->
    <method name="GetAppState">
      <arg type="s" name="uuid" direction="in"/>
      <arg type="s" name="adapterId" direction="in"/>
      <arg type="s" name="json" direction="out"/>
    </method>

    <signal name="TaskAdded">
      <arg type="s" name="uuid"/>
    </signal>
    <signal name="TaskRemoved">
      <arg type="s" name="uuid"/>
    </signal>
    <signal name="TaskChanged">
      <arg type="s" name="uuid"/>
    </signal>
    <signal name="TaskStateChanged">
      <arg type="s" name="uuid"/>
      <arg type="u" name="state"/>
    </signal>
    <signal name="CurrentTaskChanged">
      <arg type="s" name="uuid"/>
    </signal>
    <signal name="CommandsAwaitingConfirmation">
      <arg type="s" name="uuid"/>
      <arg type="s" name="json"/>
    </signal>

    <!-- Tier 2 in the other direction: on activation the daemon hands each adapter back the state it
         reported last time, and the adapter (a browser extension, through its native-messaging host)
         rebuilds it. Nothing else can do this — the tabs were never on disk. -->
    <signal name="RestoreAppState">
      <arg type="s" name="adapterId"/>
      <arg type="s" name="json"/>
    </signal>

    <property name="ApiVersion" type="u" access="read"/>
    <!-- Empty string when no task is current. -->
    <property name="CurrentTask" type="s" access="read"/>
    <!-- Global kill switch for session capture; nothing is recorded while false. Persisted, so
         pausing capture survives a daemon restart. -->
    <property name="CaptureEnabled" type="b" access="readwrite"/>
    <!-- Desktop ids never recorded into a layout, whatever is on screen. -->
    <property name="ExcludedApps" type="as" access="readwrite"/>
  </interface>
</node>`;

export const SHELL_IFACE_XML = `
<node>
  <interface name="org.gnome.Tasks.Shell">
    <method name="Ping">
      <arg type="s" name="message" direction="in"/>
      <arg type="s" name="reply" direction="out"/>
    </method>

    <!-- Every window the compositor knows about, as JSON: app id, title, pid, workspace,
         monitor connector, frame geometry, maximised/fullscreen flags, gtk application id and
         window object path where available. -->
    <method name="ListWindows">
      <arg type="s" name="json" direction="out"/>
    </method>

    <!-- Launch a desktop app with documents, on a given workspace/monitor, carrying an
         activation token. Returns the launch id the extension will report window matches
         against. -->
    <method name="LaunchApp">
      <arg type="s" name="desktopId" direction="in"/>
      <arg type="as" name="uris" direction="in"/>
      <arg type="a{sv}" name="placement" direction="in"/>
      <arg type="s" name="launchId" direction="out"/>
    </method>

    <method name="PlaceWindow">
      <arg type="s" name="windowId" direction="in"/>
      <arg type="a{sv}" name="placement" direction="in"/>
      <arg type="b" name="applied" direction="out"/>
    </method>

    <!-- Politely ask a window to close, so unsaved-work dialogs still get their say. -->
    <method name="CloseWindow">
      <arg type="s" name="windowId" direction="in"/>
    </method>

    <!-- What the compositor actually did with the last placement for this window, as JSON:
         {workspace, geometry: {requested, applied, honoured}, maximized, fullscreen}. Placement is
         a request, not a command — this is how the daemon finds out whether it was honoured. -->
    <method name="GetPlacementReport">
      <arg type="s" name="windowId" direction="in"/>
      <arg type="s" name="json" direction="out"/>
    </method>

    <signal name="WindowsChanged">
      <arg type="s" name="json"/>
    </signal>
    <!-- A window appeared and was matched back to a LaunchApp call. -->
    <signal name="LaunchMatched">
      <arg type="s" name="launchId"/>
      <arg type="s" name="windowId"/>
    </signal>

    <property name="ApiVersion" type="u" access="read"/>
    <property name="ShellVersion" type="s" access="read"/>
  </interface>
</node>`;
