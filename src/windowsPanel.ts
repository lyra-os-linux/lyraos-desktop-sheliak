import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {Dock} from './dock.js';
import {windowsProfile, type WindowsProfile} from './desktopProfile.js';
import {SignalTracker} from './signals.js';
import {StartMenu} from './startMenu.js';

type PanelBoxes = { _centerBox: St.BoxLayout; _rightBox: St.BoxLayout };
type Indicator = {container: St.Widget; menu?: PopupMenu.PopupMenu};
type Arrow = St.Widget & {updateArrowSide(side: St.Side): void; readonly arrowSide: St.Side};
type ChromeParams = {affectsInputRegion: boolean; affectsStruts: boolean; trackFullscreen: boolean};
type PanelLayout = {
    _trackedActors: Array<ChromeParams & {actor: Clutter.Actor}>;
    _updatePanelBarrier(): void;
    _destroyPanelBarrier(): void;
};

/** Move the native panel to the bottom and host the app strip inside it.
 * Reusing the actual clock/status actors preserves menus, accessibility and
 * extensions' indicators. panelBox's existing strut follows its new position.
 */
export class WindowsPanel {
    private _signals = new SignalTracker();
    private _active: WindowsProfile | null = null;
    private _panel = Main.panel as unknown as PanelBoxes;
    private _clock: St.Widget | null = null;
    private _clockParent: Clutter.Actor | null = null;
    private _clockIndex = 0;
    private _arrows = new Map<Arrow, {side: St.Side; destroyId: number}>();
    private _start: StartMenu | null = null;
    private _overlayHandler = 0;
    private _overlayOriginal = 0;
    private _centerTranslation = 0;
    private _chromeParams: ChromeParams | null = null;
    private _barrierOriginal: (() => void) | null = null;
    private _barrierOverride: (() => void) | null = null;

    constructor(private _settings: Gio.Settings, private _dock: Dock) {
        this._signals.connect(_settings, 'changed::desktop-profile', () => this._sync());
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => this._position());
        for (const property of ['x', 'y', 'width', 'height'])
            this._signals.connect(Main.layoutManager.panelBox, `notify::${property}`, () => this._position());
        this._signals.connect(Main.panel, 'notify::height', () => this._position());
        this._signals.connect(this._panel._centerBox, 'notify::allocation', () => this._align());
        this._signals.connect(this._panel._rightBox, 'child-added', () => this._syncMenus());
        this._signals.connect(this._panel._rightBox, 'notify::allocation', () => this._align());
        this._sync();
    }

    destroy(): void {
        this._signals.destroy();
        this._leave();
    }

    private _sync(): void {
        const profile = windowsProfile(this._settings);
        if (profile === this._active) return;
        this._leave();
        if (!profile) return;
        this._active = profile;
        const layout = Main.layoutManager as unknown as PanelLayout;
        const tracked = layout._trackedActors.find(item => item.actor === Main.layoutManager.panelBox);
        if (tracked) {
            this._chromeParams = {affectsInputRegion: tracked.affectsInputRegion,
                affectsStruts: tracked.affectsStruts, trackFullscreen: tracked.trackFullscreen};
            Main.layoutManager.untrackChrome(Main.layoutManager.panelBox);
            Main.layoutManager.trackChrome(Main.layoutManager.panelBox, {...this._chromeParams, trackFullscreen: false});
            Main.layoutManager.panelBox.show();
        }
        this._barrierOriginal = layout._updatePanelBarrier;
        this._barrierOverride = () => layout._destroyPanelBarrier();
        layout._updatePanelBarrier = this._barrierOverride;
        layout._destroyPanelBarrier();
        this._centerTranslation = this._panel._centerBox.translation_x;
        for (const style of ['sheliak-windows-panel', profile])
            Main.panel.add_style_class_name(style);
        const date = (Main.panel.statusArea as unknown as Record<string, Indicator>).dateMenu;
        this._clock = date?.container ?? null;
        this._clockParent = this._clock?.get_parent() ?? null;
        if (this._clock && this._clockParent) {
            this._clockIndex = this._clockParent.get_children().indexOf(this._clock);
            this._clockParent.remove_child(this._clock);
            this._panel._rightBox.add_child(this._clock);
        }
        this._dock.setPanelHost(this._panel._centerBox);
        this._start = new StartMenu(this._dock.launcher, this._panel._centerBox, profile);
        this._dock.setLauncherAction(() => this._start?.toggle());
        // Meta and GObject typings carry separately versioned GObject packages.
        this._overlayOriginal = Number(GObject.signal_handler_find(global.display as never, {signalId: 'overlay-key'} as never));
        if (this._overlayOriginal)
            GObject.signal_handler_block(global.display as never, this._overlayOriginal);
        this._overlayHandler = global.display.connect('overlay-key', () => {
            if (!Main.sessionMode.isLocked) this._start?.toggle();
        });
        this._syncMenus();
        this._position();
    }

    private _syncMenus(): void {
        if (!this._active) return;
        for (const indicator of Object.values(Main.panel.statusArea) as unknown as Indicator[]) {
            if (!indicator.container || !this._panel._rightBox.contains(indicator.container)) continue;
            const pointer = (indicator.menu as unknown as {_boxPointer?: Arrow})?._boxPointer;
            if (pointer && !this._arrows.has(pointer)) {
                const destroyId = this._signals.connect(pointer, 'destroy', () => {
                    this._arrows.delete(pointer);
                    this._signals.forget(pointer);
                });
                this._arrows.set(pointer, {side: pointer.arrowSide, destroyId});
                pointer.updateArrowSide(St.Side.BOTTOM);
            }
        }
    }

    private _position(): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._active || !monitor) return;
        const panel = Main.layoutManager.panelBox;
        const y = monitor.y + monitor.height - Main.panel.height;
        if (panel.x !== monitor.x || panel.y !== y) panel.set_position(monitor.x, y);
        if (panel.width !== monitor.width) panel.set_width(monitor.width);
        this._align();
    }

    private _align(): void {
        if (!this._active) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._dock.limitPanelWidth(Math.max(80, monitor.width - 2 * this._panel._rightBox.width - 32));
        const offset = this._active === 'windows10'
            ? -Math.ceil((monitor.width - this._panel._centerBox.width) / 2) : 0;
        if (this._panel._centerBox.translation_x !== offset)
            this._panel._centerBox.translation_x = offset;
    }

    private _leave(): void {
        if (!this._active) return;
        this._active = null;
        this._start?.destroy();
        this._start = null;
        if (this._overlayHandler) global.display.disconnect(this._overlayHandler);
        this._overlayHandler = 0;
        if (this._overlayOriginal && GObject.signal_handler_is_connected(global.display as never, this._overlayOriginal))
            GObject.signal_handler_unblock(global.display as never, this._overlayOriginal);
        this._overlayOriginal = 0;
        this._dock.setLauncherAction(null);
        this._dock.setPanelHost(null);
        this._panel._centerBox.translation_x = this._centerTranslation;
        if (this._clock && this._clockParent) {
            this._clock.get_parent()?.remove_child(this._clock);
            this._clockParent.insert_child_at_index(this._clock, this._clockIndex);
        }
        this._clock = null;
        this._clockParent = null;
        for (const [pointer, {side, destroyId}] of this._arrows) {
            this._signals.disconnect(pointer, destroyId);
            pointer.updateArrowSide(side);
        }
        this._arrows.clear();
        for (const style of ['sheliak-windows-panel', 'windows10', 'windows11'])
            Main.panel.remove_style_class_name(style);
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) Main.layoutManager.panelBox.set_position(monitor.x, monitor.y);
        if (this._chromeParams) {
            Main.layoutManager.untrackChrome(Main.layoutManager.panelBox);
            Main.layoutManager.trackChrome(Main.layoutManager.panelBox, this._chromeParams);
            this._chromeParams = null;
        }
        const layout = Main.layoutManager as unknown as PanelLayout;
        if (this._barrierOriginal && layout._updatePanelBarrier === this._barrierOverride) {
            layout._updatePanelBarrier = this._barrierOriginal;
            layout._updatePanelBarrier();
        }
        this._barrierOriginal = this._barrierOverride = null;
    }
}
