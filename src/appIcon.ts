import Clutter from 'gi://Clutter';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {AppContextMenu} from './contextMenu.js';
import {SignalTracker} from './signals.js';
import {TooltipManager} from './tooltip.js';

const DEFAULT_ICON_SIZE = 40;

function toggleStyle(actor: St.Widget, name: string, enabled: boolean): void {
    if (enabled)
        actor.add_style_class_name(name);
    else
        actor.remove_style_class_name(name);
}

export class AppIcon {
    readonly actor: St.Button;
    readonly menu: AppContextMenu;
    readonly appId: string;
    readonly app: Shell.App;
    readonly favorite: boolean;
    private _signals = new SignalTracker();
    private _badge: St.Label;
    private _runningIndicator: St.Widget;
    private _windowCountIndicator: St.Label;

    constructor(
        app: Shell.App,
        menuManager: PopupMenu.PopupMenuManager,
        favorite: boolean,
        onMenuStateChanged?: (open: boolean) => void,
        iconSize = DEFAULT_ICON_SIZE,
        onDragEnd?: () => void,
        tooltip?: TooltipManager,
    ) {
        this.app = app;
        this.favorite = favorite;
        this.appId = app.get_id();
        this.actor = new St.Button({
            style_class: 'overview-tile sheliak-app-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: app.get_name(),
        });

        const iconContainer = new St.Widget({layout_manager: new Clutter.BinLayout()});
        iconContainer.add_child(app.create_icon_texture(iconSize));
        this._badge = new St.Label({
            style_class: 'dash-label sheliak-app-badge',
            text: '',
            visible: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        iconContainer.add_child(this._badge);

        this._runningIndicator = new St.Widget({
            style_class: 'app-grid-running-dot sheliak-running-indicator',
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._windowCountIndicator = new St.Label({
            style_class: 'dash-label sheliak-window-count',
            text: '',
            visible: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const indicatorRow = new St.Widget({
            style_class: 'sheliak-indicator-row',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        indicatorRow.add_child(this._runningIndicator);
        indicatorRow.add_child(this._windowCountIndicator);

        const content = new St.BoxLayout({
            style_class: 'overview-icon',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(iconContainer);
        content.add_child(indicatorRow);
        this.actor.set_child(content);

        this.menu = new AppContextMenu(this.actor, app);
        menuManager.addMenu(this.menu.menu);
        if (onMenuStateChanged) {
            this._signals.connect(this.menu.menu, 'open-state-changed',
                (_menu: unknown, open: boolean) => onMenuStateChanged(open));
        }

        this._signals.connect(this.actor, 'button-release-event',
            (_actor, event: Clutter.Event) => {
                const button = event.get_button();
                if (button === Clutter.BUTTON_SECONDARY) {
                    this.menu.toggle();
                    return Clutter.EVENT_STOP;
                }
                if (button === Clutter.BUTTON_PRIMARY) {
                    this.activate();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

        if (tooltip) {
            this._signals.connect(this.actor, 'enter-event', () => {
                tooltip.show(this.actor, app.get_name());
                return Clutter.EVENT_PROPAGATE;
            });
            this._signals.connect(this.actor, 'leave-event', () => {
                tooltip.hide();
                return Clutter.EVENT_PROPAGATE;
            });
            this._signals.connect(this.actor, 'button-press-event', () => {
                tooltip.hide();
                return Clutter.EVENT_PROPAGATE;
            });
        }

        if (favorite) {
            (this.actor as unknown as {_delegate?: unknown})._delegate = this;
            const draggable = DND.makeDraggable(this.actor, {timeoutThreshold: 200});
            this._signals.connect(draggable, 'drag-begin', () => {
                this.actor.add_style_class_name('dragging');
            });
            this._signals.connect(draggable, 'drag-end', () => {
                this.actor.remove_style_class_name('dragging');
                onDragEnd?.();
            });
        }

        // Mutter uses this geometry as the destination of minimize effects.
        // Keeping it on the application icon also lets deform effects such as
        // Magic Lamp pull the window into the corresponding Sheliak item.
        this._signals.connect(this.actor, 'notify::allocation',
            () => this.updateIconGeometry());
        this._signals.connect(this.actor, 'notify::mapped',
            () => this.updateIconGeometry());
        this._signals.connect(this.app, 'windows-changed',
            () => {
                this.setState(favorite);
                this.updateIconGeometry();
            });

        this.setState(favorite);
    }

    setState(favorite: boolean): void {
        const running = this.app.get_state() !== Shell.AppState.STOPPED;
        const windowCount = this.app.get_windows()
            .filter(window => !window.skip_taskbar).length;
        this._runningIndicator.visible = running && windowCount <= 1;
        this._windowCountIndicator.visible = running && windowCount > 1;
        this._windowCountIndicator.text = windowCount > 99
            ? '99+'
            : String(windowCount);
        toggleStyle(this.actor, 'running', running);
        toggleStyle(this.actor, 'favorite', favorite);
        toggleStyle(this.actor, 'running-only', running && !favorite);
    }

    setBadge(count: number): void {
        this._badge.visible = count > 0;
        this._badge.text = count > 99 ? '99+' : String(count);
    }

    updateIconGeometry(): void {
        // Actors not attached to a stage can report invalid transformed
        // coordinates while the dock is being rebuilt.
        if (!this.actor.get_stage())
            return;

        const [x, y] = this.actor.get_transformed_position();
        const [width, height] = this.actor.get_transformed_size();
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
            return;

        const rect = new Mtk.Rectangle({
            x: Math.round(x),
            y: Math.round(y),
            width: Math.max(1, Math.round(width)),
            height: Math.max(1, Math.round(height)),
        });
        for (const window of this.app.get_windows())
            window.set_icon_geometry(rect);
    }

    activate(): void {
        this.menu.close();
        const windows = this.app.get_windows()
            .filter(window => !window.skip_taskbar);

        if (windows.length === 0) {
            this.app.activate();
            return;
        }

        const focused = global.display.focus_window;
        const index = windows.indexOf(focused);
        const next = windows.length > 1
            ? windows[(index + 1 + windows.length) % windows.length]
            : windows[0];
        Main.activateWindow(next, global.get_current_time());
    }

    destroy(): void {
        // A favorites change rebuilds the dock synchronously from the menu
        // action. Close the menu while its open-state signal is still
        // connected so Dock can release the visibility hold.
        this.menu.close();
        this._signals.destroy();
        this.menu.destroy();
        this.actor.destroy();
    }
}
