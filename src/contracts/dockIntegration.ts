import type St from 'gi://St';

/** The dock owns its actors, including the scroll view used inside a panel.
 * The host is borrowed: detaching must happen before the panel is destroyed.
 * This is the existing in-extension contract, not yet a cross-extension API.
 */
export interface DockPanelIntegration {
    setPanelHost(host: St.BoxLayout | null): void;
    limitPanelWidth(width: number): void;
}

/** Menus may borrow the launcher and its action, but must not destroy it.
 * Clear the action before destroying the menu or detaching the dock.
 */
export interface DockLauncherIntegration {
    readonly launcher: St.Button;
    setLauncherAction(action: (() => void) | null): void;
}
