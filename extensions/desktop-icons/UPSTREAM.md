# Upstream provenance

Imported from https://gitlab.com/rastersoft/desktop-icons-ng, tag 49.0.5,
commit `c32667693d0831c29e3ab3f7bfeb675ea1531a00`.

The original COPYING and per-file copyright/license notices are retained.
HISTORY.md is upstream history. The Lyra fork preserves the GJS desktop helper
and Nautilus integration; changes add Lyra identity, completed Portuguese
translations and integration with the Sheliak suite.

Lyra's compatibility patches use the shared startup adapter and validate
optional methods before interception in `gnomeShellOverride.js`. Original
callbacks are captured per instance; disable preserves later overrides and
retained wrappers delegate safely after release. Preserve these changes when
updating upstream. See `docs/shell-compatibility.md` at repository root.

For updates, compare the next upstream tag against this commit, then apply and
review the diff in this directory, preserving Lyra identity and rerunning
gettext, schema, desktop file-operation and private GNOME tests. Do not replace
the directory blindly. Public source is distributed in the Sheliak repository.
