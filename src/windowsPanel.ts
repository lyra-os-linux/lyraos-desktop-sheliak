import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type {DockPanelIntegration} from './contracts/dockIntegration.js';
import {windowsProfile, type WindowsProfile} from './desktopProfile.js';
import {SignalTracker} from './signals.js';
import {bottomPanelCapabilities, popupArrow, type PopupArrow} from './shellCompat.js';
import {OwnedValue} from './ownedState.js';
import {PanelStyleClass} from './panelState.js';
import {Scope} from './core/provider.js';

type Indicator = {container: St.Widget; menu?: PopupMenu.PopupMenu};

/** Move the native panel to the bottom and host the app strip inside it.
 * Reusing the actual clock/status actors preserves menus, accessibility and
 * extensions' indicators. panelBox's existing strut follows its new position.
 */
export class WindowsPanel {
    private _signals = new SignalTracker();
    private _active: WindowsProfile | null = null;
    private _panel = bottomPanelCapabilities();
    private _arrows = new Set<PopupArrow>();
    private _layout = new Scope();
    private _layoutSignals = new SignalTracker();
    private _centerShift: OwnedValue<number> | null = null;
    private _positionValue: OwnedValue<[number, number]> | null = null;
    private _width: OwnedValue<number> | null = null;
    private _positioning = false;
    private _entering = false;

    constructor(private _settings: Gio.Settings,
        private _dock: DockPanelIntegration | null = null,
        private _changed: () => void = () => {}) {
        if (!this._panel) return;
        try {
            this._signals.connect(_settings, 'changed::desktop-profile', () => this._sync());
            this._signals.connect(Main.layoutManager, 'monitors-changed', () => this._position());
            for (const property of ['x', 'y', 'width', 'height'])
                this._signals.connect(Main.layoutManager.panelBox, `notify::${property}`, () => this._position());
            this._signals.connect(Main.panel, 'notify::height', () => this._position());
            this._signals.connect(this._panel!.center, 'notify::allocation', () => this._align());
            this._signals.connect(this._panel!.right, 'child-added', () => {
                if (!this._entering) this._syncMenus();
            });
            this._signals.connect(this._panel!.right, 'notify::allocation', () => this._align());
            this._sync();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    get active(): boolean { return this._active !== null; }
    get anchor(): St.BoxLayout { return this._panel!.center; }

    attachDock(dock: DockPanelIntegration): () => void {
        if (!this._active) return () => {};
        this._dock?.setPanelHost(null);
        this._dock = dock;
        dock.setPanelHost(this._panel!.center);
        this._align();
        return () => {
            if (this._dock !== dock) return;
            this._dock = null;
            dock.setPanelHost(null);
            this._align();
        };
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
        const capabilities = bottomPanelCapabilities();
        if (!capabilities || !this._panel || capabilities.center !== this._panel.center
            || capabilities.right !== this._panel.right) return;
        const release = capabilities.acquire();
        if (!release) return;
        this._layout.add(release);
        this._active = profile;
        this._entering = true;
        try {
            this._centerShift = new OwnedValue(() => capabilities.center.translation_x,
                value => { capabilities.center.translation_x = value; });
            this._layout.add(() => this._centerShift?.restore());
            this._layoutSignals.connect(capabilities.center, 'notify::translation-x',
                () => this._centerShift?.observe());
            const box = Main.layoutManager.panelBox;
            this._positionValue = new OwnedValue(() => [box.x, box.y],
                ([x, y]) => box.set_position(x, y), (a, b) => a[0] === b[0] && a[1] === b[1]);
            this._width = new OwnedValue(() => box.width, value => box.set_width(value));
            this._layout.add(() => this._positionValue?.restore());
            this._layout.add(() => this._width?.restore());
            for (const style of ['sheliak-windows-panel', profile])
                this._layout.own(new PanelStyleClass(Main.panel, style)).set(true);
            const date = (Main.panel.statusArea as unknown as Record<string, Indicator>).dateMenu;
            const clock = date?.container;
            const parent = clock?.get_parent();
            if (clock && parent) {
                const index = parent.get_children().indexOf(clock);
                const placement = new OwnedValue<Clutter.Actor | null>(() => clock.get_parent(), value => {
                    const previous = clock.get_parent();
                    const previousIndex = previous?.get_children().indexOf(clock) ?? 0;
                    previous?.remove_child(clock);
                    try {
                        if (value === parent) value.insert_child_at_index(clock, index);
                        else value?.add_child(clock);
                    } catch (error) {
                        clock.get_parent()?.remove_child(clock);
                        previous?.insert_child_at_index(clock, previousIndex);
                        throw error;
                    }
                });
                this._layout.add(() => placement.restore());
                for (const actor of [clock, parent]) {
                    this._layoutSignals.connect(actor, 'destroy', () => {
                        placement.abandon();
                        this._layoutSignals.forget(actor);
                    });
                }
                placement.set(capabilities.right);
            }
            this._entering = false;
            this._dock?.setPanelHost(this._panel!.center);
            this._syncMenus();
            this._position();
            this._changed();
        } catch (error) {
            this._entering = false;
            this._leave();
            throw error;
        }
    }

    private _syncMenus(): void {
        if (!this._active) return;
        for (const indicator of Object.values(Main.panel.statusArea) as unknown as Indicator[]) {
            if (!indicator.container || !this._panel!.right.contains(indicator.container)) continue;
            const pointer = popupArrow(indicator.menu);
            if (pointer && !this._arrows.has(pointer)) {
                const side = new OwnedValue(() => pointer.arrowSide, value => pointer.updateArrowSide(value));
                this._layout.add(() => side.restore());
                this._layoutSignals.connect(pointer, 'destroy', () => {
                    side.abandon();
                    this._arrows.delete(pointer);
                    this._layoutSignals.forget(pointer);
                });
                this._arrows.add(pointer);
                side.set(St.Side.BOTTOM);
            }
        }
    }

    private _position(): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._active || !monitor || this._positioning) return;
        this._positioning = true;
        try {
            this._positionValue?.set([monitor.x, monitor.y + monitor.height - Main.panel.height]);
            this._width?.set(monitor.width);
            this._align();
        } finally { this._positioning = false; }
    }

    private _align(): void {
        if (!this._active) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._dock?.limitPanelWidth(Math.max(80, monitor.width - 2 * this._panel!.right.width - 32));
        const offset = this._active === 'windows10'
            ? -Math.ceil((monitor.width - this._panel!.center.width) / 2) : 0;
        this._centerShift?.set(offset);
    }

    private _leave(): void {
        if (!this._active) return;
        this._active = null;
        try {
            this._changed(); // Consumers release borrowed anchors first.
        } finally {
            try { this._dock?.setPanelHost(null); }
            finally {
                this._dock = null;
                this._layoutSignals.destroy();
                this._layout.destroy();
                this._arrows.clear();
                this._centerShift = null;
                this._positionValue = null;
                this._width = null;
            }
        }
    }
}
