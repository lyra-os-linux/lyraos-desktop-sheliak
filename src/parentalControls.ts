import type Gio from 'gi://Gio';
import type Shell from 'gi://Shell';
import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';

/**
 * GNOME Shell's own malcontent wrapper, the one the app grid, dash and search
 * use. It also applies `should_show()`, hides every app until the account's
 * parental controls are loaded, and emits `app-filter-changed` when they load
 * or change, so every list built with it must be rebuilt on that signal.
 */
export function parentalControls() {
    return ParentalControlsManager.getDefault();
}

/** Accepts the app infos of Shell.AppSystem and Gio, whose typings differ. */
export function shouldShowApp(appInfo: object): boolean {
    return parentalControls().shouldShowApp(appInfo as Gio.DesktopAppInfo);
}

/** Pinned apps: keep window-backed apps without an app info visible. */
export function shouldShowPinnedApp(app: Shell.App): boolean {
    const appInfo = app.get_app_info();
    return !appInfo || shouldShowApp(appInfo);
}
