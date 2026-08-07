# The gnome-tasks browser extension

Tier-2 support (see [../docs/app-adapters.md](../docs/app-adapters.md)): a browser's open tabs exist
nowhere on disk, so the browser has to report them itself.

One `background.js` serves both browsers; only the manifest differs. Per the answered open question
in `PLAN.md`, these are loaded locally and unsigned — there is no addons.mozilla.org or Chrome Web
Store release.

## Install

```console
$ make install-browser-host          # the native-messaging host, for both browsers
```

Then load the extension:

* **Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick
  `manifest-firefox.json`. Temporary add-ons are forgotten on restart; a permanent unsigned install
  needs Developer Edition or ESR with `xpinstall.signatures.required=false`.
* **Chrome / Chromium** — `chrome://extensions` → *Developer mode* → *Load unpacked* → pick this
  directory. Copy `manifest-chrome.json` to `manifest.json` first, since Chrome insists on that name.

The extension's id matters: the native-messaging host manifest lists which extensions may talk to it.
`make install-browser-host` writes the Firefox id `gnome-tasks@patxi.gortazar`; for Chrome, take the
id that `chrome://extensions` shows after loading and add it to
`~/.config/google-chrome/NativeMessagingHosts/org.gnome.tasks.browser_host.json`.

## What it does

* Reports every normal (non-private) window's tabs — URL, title, pinned, active — debounced 2.5 s.
* Rebuilds those windows when a task is activated, skipping any window that already shows exactly
  those URLs, so re-activating a task does not duplicate tabs.
* Nothing else. It holds the `tabs` permission, which is broad trust, so there is deliberately no
  other behaviour in it.

Private windows are dropped twice over: here, and again in the daemon.
