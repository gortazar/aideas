# On-disk state

Defined by `src/lib/task.js` and read/written by `src/lib/taskStore.js`. The tests in
`tests/unit/task.test.js` and `tests/unit/taskStore.test.js` are the executable version of this
document; if the two disagree, the tests are right.

## Layout

```
~/.local/share/gnome-tasks/
├── state.json              which task is current
└── tasks/
    ├── <uuid>.json         one document per task
    └── <uuid>.json
```

One file per task, rather than one file for all of them, so that a corrupt or half-written
document costs the user exactly one task. `TaskStore.load()` skips a file it cannot parse and
returns the problem as a string for the caller to log — it neither dies nor stays silent.

The directory is created with mode `0700`: a task list is a record of what the user works on.

`GNOME_TASKS_DATA_DIR` overrides the whole directory, which is how the tests (and a second
development daemon) stay away from real data.

## A task document

```json
{
  "version": 1,
  "uuid": "6f8b2c1e-0a4d-4f1b-9c3a-1d2e3f4a5b6c",
  "name": "Client work",
  "icon": "folder-documents-symbolic",
  "description": "invoices, the tracker and the staging tunnel",
  "deactivatePolicy": "hide",
  "apps": [],
  "commands": []
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `version` | integer | schema version of *this document*, not of gnome-tasks |
| `uuid` | string | v4 UUID, also the file name; never changes, not user-settable |
| `name` | string | required, trimmed, must be non-empty |
| `icon` | string | icon name, may be empty |
| `description` | string | may be empty |
| `deactivatePolicy` | `"hide"` \| `"close"` \| `"leave"` | what happens to the windows on switch-away |
| `apps` | array | the captured layout; shape defined in M2/M3 |
| `commands` | array | per-task commands; shape defined in M5 |

`state.json` is deliberately tiny:

```json
{ "current": "6f8b2c1e-0a4d-4f1b-9c3a-1d2e3f4a5b6c" }
```

`""` (or a uuid that no longer exists) means no task is current.

### What is *not* persisted

`TaskState` (stopped / active / running) is runtime-only and stripped on write. A task that was
active when the machine was shut down is not "running" after a reboot — its windows are gone — so
persisting the state would make the switcher lie. `state.json` records only which task the user
was *in*, which is a preference, not an observation.

## Writing

Every write goes through `Gio.File.replace_contents()`, which writes a temporary file and renames
it into place. A crash therefore leaves either the old document or the new one, never a truncated
one — `tests/unit/taskStore.test.js` asserts both that the visible file always parses and that no
temporary files are left behind.

Documents are pretty-printed with two-space indentation and a trailing newline. This costs a few
bytes and makes the files diffable, greppable and hand-editable, which matters for a format users
will end up looking at when a restore goes wrong.

## Versioning and migration

`SCHEMA_VERSION` in `src/lib/task.js` is bumped only when older documents cannot be read as-is.

* Reading a document with `version` **lower** than current runs it through the migration chain in
  `migrate()`: each step goes from version N to N+1, so any older release migrates by composition.
* Reading a document with `version` **higher** than current is refused with an error naming both
  versions. Downgrading gnome-tasks must not silently drop fields it does not understand — losing
  a user's captured layout is worse than failing to load one task.
* An absent `version` is treated as 1.

`tests/unit/task.test.js` asserts that every version below `SCHEMA_VERSION` has a migration step,
so bumping the constant without writing the migration fails CI rather than corrupting data.

Migrations run in memory on load; nothing is rewritten to disk until the task is next changed.
