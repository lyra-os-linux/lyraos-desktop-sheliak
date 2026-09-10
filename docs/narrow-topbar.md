# Narrow topbar qualification

The panel menus measure their translated content, the native clock and status
areas, theme scale and available panel width. When the expanded content cannot
fit its GNOME panel box, menu labels collapse to their existing icons and Search
becomes a button. Accessible button names remain available. Once space returns,
the labels and inline search return with a small hysteresis margin.

The same search entry moves into the results popup. Query text and keyboard focus
survive a layout transition. Enter, Space or Down on the search button focuses
the entry; typing searches, Enter opens the first result, and Escape closes the
popup and returns focus. Clearing text keeps the entry usable. Search owns its
nonmodal popup instead of letting the native dummy menu grab the panel button.

Layout work is coalesced in one idle source, removed on disable. Measurements do
not temporarily expand actors and therefore do not continually invalidate their
own preferred sizes. Recreated right-side menu wrappers are excluded from native
indicator visibility management, and destroyed native indicators are forgotten.

## Native regression

Build with `npm test`, then run on a machine with GNOME Shell 48 and PyGObject:

```sh
python3 tests/native-topbar/run.py --width 800 --output /tmp/sheliak-topbar-check
python3 tests/native-topbar/matrix.py --output /tmp/sheliak-topbar-matrix
```

The harness starts one disposable headless Wayland compositor at a time with
software rendering, private D-Bus and temporary XDG directories. It never changes
the running desktop's settings. The matrix covers logical widths 800, 1024, 1280
and 1920, integer scales 1 and 2, and en_US, pt_BR and es_ES. It also exercises
125% text size, left/center/right placement, profile transitions, and narrow/wide
resizing while searching. A real desktop entry writes a marker in the temporary
directory to verify launching. Virtual input verifies typing and menu activation.

Each run records actual painted-content geometry, assertions, shell logs, and
screenshots (`left.png`, `search.png`). The old merged source 8ee8233 reproduces
the overlap at 800 logical pixels using the same harness. Results and before/after
captures are retained in `analysis/2026-09-10/sheliak-narrow` in the Lyra workspace.

This checks GNOME 48 allocation and interaction, not a physical GDM login, spoken
Orca output, fractional display scaling, arbitrary third-party panel extensions,
or an installed RPM. Ubuntu/Windows checks apply their no-top-menu preferences as
Vega does; the Welcome profile picker is tracked separately in Welcome #3.
