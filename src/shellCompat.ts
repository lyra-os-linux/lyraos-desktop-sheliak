import type Clutter from 'gi://Clutter';
import type St from 'gi://St';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {OwnedValue} from './ownedState.js';

// Keep private Shell fields in this adapter. A missing optional capability
// must not abort the basic Dock/Panel or leave a half-applied layout behind.
const reported = new Set<string>();
export function unavailable(feature: string): null {
    if (!reported.has(feature)) {
        reported.add(feature);
        console.warn(`Lyra: ${feature} unavailable; preserving the native fallback`);
    }
    return null;
}

function hasMethods(value: unknown, methods: string[]): boolean {
    if (!value || typeof value !== 'object') return false;
    const object = value as Record<string, unknown>;
    return methods.every(name => typeof object[name] === 'function');
}

export function shellIsStartingUp(): boolean {
    const layout = Main.layoutManager as unknown as Record<string, unknown> | undefined;
    return layout?._startingUp === true;
}

export type PanelSide = 'left' | 'center' | 'right';
export function panelBox(side: PanelSide): St.BoxLayout | null {
    const panel = Main.panel as unknown as Record<string, unknown> | undefined;
    const box = panel?.[`_${side}Box`];
    return hasMethods(box, ['get_children', 'connect', 'disconnect'])
        ? box as St.BoxLayout : unavailable(`panel ${side} box`);
}

export function panelBoxes(): {left: St.BoxLayout; center: St.BoxLayout; right: St.BoxLayout} | null {
    const left = panelBox('left'), center = panelBox('center'), right = panelBox('right');
    return left && center && right && [left, center, right].every(box =>
        hasMethods(box, ['get_preferred_width'])) ? {left, center, right} : null;
}

/** Destroy only an owned indicator, then release the native panel's menu hook.
 * GNOME 48 attaches open-state-changed with connectObject(..., Main.panel).
 * The pure-JS menu's destroy event does not remove that long-lived owner.
 * Keep the hook through close/destroy so banner blocking is restored first.
 */
export function destroyPanelIndicator(indicator: {destroy(): void; menu?: unknown}): void {
    const menu = indicator.menu as {disconnectObject?(owner: unknown): void} | undefined;
    try {
        indicator.destroy();
    } finally {
        menu?.disconnectObject?.(Main.panel);
    }
}

/** Release the parent binding of an owned submenu on removeAll or destroy.
 * Both menus are JS emitters, so GNOME 48's GObject lifetime tracking does
 * not disconnect child.connectObject(..., parent) automatically.
 */
export function trackOwnedSubmenu(parent: unknown, submenu: unknown): void {
    if (!hasMethods(submenu, ['connect', 'disconnect', 'disconnectObject'])) return;
    const child = submenu as {connect(signal: string, callback: () => void): number;
        disconnect(id: number): void; disconnectObject(owner: unknown): void};
    const id = child.connect('destroy', () => {
        child.disconnect(id);
        child.disconnectObject(parent);
    });
}

export function nativeDash(): Clutter.Actor | null {
    const dash = Main.overview?.dash;
    return hasMethods(dash, ['hide', 'show']) && typeof dash.visible === 'boolean'
        ? dash : unavailable('overview dash');
}

export function showApplications(): void {
    if (typeof Main.overview?.showApps === 'function') Main.overview.showApps();
    else {
        unavailable('overview application grid');
        Main.overview?.show?.();
    }
}

/** Connect before changing session state; return ownership-aware restoration. */
export function suppressStartupOverview(): () => void {
    const layout = Main.layoutManager;
    const mode = Main.sessionMode;
    if (!shellIsStartingUp()) return () => {};
    if (!hasMethods(layout, ['connect', 'disconnect']) || typeof mode?.hasOverview !== 'boolean') {
        unavailable('startup overview suppression');
        return () => {};
    }
    const previous = mode.hasOverview;
    let id = 0;
    const restore = () => {
        if (!id) return;
        layout.disconnect(id);
        id = 0;
        if (mode.hasOverview === false) mode.hasOverview = previous;
    };
    try {
        id = layout.connect('startup-complete', restore);
        mode.hasOverview = false;
    } catch (error) {
        restore();
        unavailable(`startup overview suppression: ${error}`);
    }
    return restore;
}

export type PopupArrow = St.Widget & {updateArrowSide(side: St.Side): void; readonly arrowSide: St.Side};
export function popupArrow(menu: unknown): PopupArrow | null {
    const pointer = (menu as {_boxPointer?: PopupArrow} | null)?._boxPointer;
    return hasMethods(pointer, ['updateArrowSide', 'connect', 'disconnect'])
        && typeof pointer?.arrowSide === 'number' ? pointer! : unavailable('popup arrow');
}

export function extensionManager(): typeof Main.extensionManager | null {
    return hasMethods(Main.extensionManager, ['lookup', 'connect', 'disconnect'])
        ? Main.extensionManager : unavailable('extension manager discovery');
}

type ChromeParams = {affectsInputRegion: boolean; affectsStruts: boolean; trackFullscreen: boolean};
type PanelLayout = Omit<typeof Main.layoutManager, '_trackedActors'> & {
    _trackedActors: Array<ChromeParams & {actor: Clutter.Actor}>;
    _updatePanelBarrier(): void;
    _destroyPanelBarrier(): void;
};

/** Preflight every private dependency before connecting or moving actors. */
export function bottomPanelCapabilities() {
    const boxes = panelBoxes();
    const layout = Main.layoutManager as unknown as PanelLayout;
    if (!boxes || !hasMethods(layout, ['trackChrome', 'untrackChrome',
        '_updatePanelBarrier', '_destroyPanelBarrier']) || !Array.isArray(layout._trackedActors)
        || !hasMethods(layout.panelBox, ['connect', 'disconnect', 'show', 'set_position', 'set_width'])
        || typeof layout.panelBox.visible !== 'boolean'
        || !hasMethods(boxes.center, ['add_child', 'remove_child'])
        || !hasMethods(boxes.right, ['add_child', 'contains']))
        return unavailable('bottom panel layout');
    const tracked = layout._trackedActors.find(item => item?.actor === layout.panelBox);
    if (!tracked || ['affectsInputRegion', 'affectsStruts', 'trackFullscreen'].some(key =>
        typeof tracked[key as keyof ChromeParams] !== 'boolean'))
        return unavailable('bottom panel chrome tracking');
    const params: ChromeParams = {affectsInputRegion: tracked.affectsInputRegion,
        affectsStruts: tracked.affectsStruts, trackFullscreen: tracked.trackFullscreen};
    return {
        ...boxes,
        acquire(): (() => void) | null {
            const original = layout._updatePanelBarrier;
            const override = () => layout._destroyPanelBarrier();
            const ownedParams = {...params, trackFullscreen: false};
            let ownedChrome: typeof tracked | undefined;
            let chromeChanged = false;
            let acquiring = true;
            let released = false;
            const visibility = new OwnedValue(() => layout.panelBox.visible,
                value => { layout.panelBox.visible = value; });
            let visibilityId = 0;
            const release = () => {
                if (released) return;
                released = true;
                if (visibilityId) layout.panelBox.disconnect(visibilityId);
                visibility.restore();
                const restoredVisibility = layout.panelBox.visible;
                try {
                    const current = layout._trackedActors.find(item => item?.actor === layout.panelBox);
                    const stillOwned = current && current === ownedChrome
                        && (Object.keys(ownedParams) as Array<keyof ChromeParams>)
                            .every(key => current[key] === ownedParams[key]);
                    if (chromeChanged && (acquiring || stillOwned)) {
                        layout.untrackChrome(layout.panelBox);
                        layout.trackChrome(layout.panelBox, params);
                    }
                } finally {
                    try {
                        if (layout._updatePanelBarrier === override) {
                            layout._updatePanelBarrier = original;
                            original.call(layout);
                        }
                    } finally {
                        // trackChrome synchronously recalculates visibility.
                        // Apply the resolved state after that native update.
                        layout.panelBox.visible = restoredVisibility;
                    }
                }
            };
            try {
                visibilityId = layout.panelBox.connect('notify::visible', () => visibility.observe());
                visibility.set(true);
                layout._updatePanelBarrier = override;
                chromeChanged = true;
                layout.untrackChrome(layout.panelBox);
                layout.trackChrome(layout.panelBox, ownedParams);
                ownedChrome = layout._trackedActors.find(item => item?.actor === layout.panelBox);
                layout._destroyPanelBarrier();
                visibility.set(true);
                acquiring = false;
                return release;
            } catch (error) {
                try { release(); }
                catch (rollback) { console.error(`Lyra: bottom panel restoration failed: ${rollback}`); }
                return unavailable(`bottom panel activation: ${error}`);
            }
        },
    };
}

/** Capability checks only. Exact ownership of compositor handlers is #9. */
export function animationCapabilities() {
    const shellwm = global.window_manager;
    if (!hasMethods(shellwm, ['completed_minimize', 'completed_unminimize',
        'block_signal_handler', 'unblock_signal_handler', 'connect', 'disconnect'])
        || typeof GObject.signal_handler_find !== 'function'
        || typeof GObject.signal_handler_is_connected !== 'function')
        return unavailable('compositor animation bridge');
    try {
        const ids = ['minimize', 'unminimize'].map(signalId => Number(
            GObject.signal_handler_find(shellwm as never, {signalId} as never)));
        if (ids.some(id => !id || !GObject.signal_handler_is_connected(shellwm as never, id))
            || new Set(ids).size !== ids.length)
            return unavailable('compositor animation handlers');
        return {shellwm, ids};
    } catch (error) {
        return unavailable(`compositor animation handlers: ${error}`);
    }
}
