import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {SignalTracker} from './signals.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const TRASH_URI = 'trash:///';
const ICON_SIZE = 32;

Gio._promisify(Gio.File.prototype, 'enumerate_children_async',
    'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async',
    'next_files_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');

export class TrashIcon {
    readonly actor: St.Button;
    private _icon: St.Icon;
    private _trash = Gio.File.new_for_uri(TRASH_URI);
    private _monitor: Gio.FileMonitor | null = null;
    private _signals = new SignalTracker();
    private _destroyed = false;
    private _refreshing = false;
    private _refreshPending = false;
    private _refreshGeneration = 0;
    private _cancellable: Gio.Cancellable | null = null;

    constructor() {
        this._icon = new St.Icon({
            icon_name: 'user-trash-symbolic',
            icon_size: ICON_SIZE,
        });
        this.actor = new St.Button({
            style_class: 'overview-tile sheliak-system-button sheliak-trash-button',
            child: new St.Bin({style_class: 'overview-icon', child: this._icon}),
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: _('Trash'),
        });

        this._signals.connect(this.actor, 'clicked', () => {
            Gio.AppInfo.launch_default_for_uri_async(
                TRASH_URI, null, null, (_source, result) => {
                    try {
                        Gio.AppInfo.launch_default_for_uri_finish(result);
                    } catch (error) {
                        console.error(`Sheliak: não foi possível abrir a lixeira: ${error}`);
                    }
                });
        });

        try {
            this._monitor = this._trash.monitor_directory(
                Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._signals.connect(this._monitor, 'changed', () => this._refresh());
        } catch (error) {
            console.warn(`Sheliak: monitor da lixeira indisponível: ${error}`);
        }

        this._refresh();
    }

    destroy(): void {
        this._destroyed = true;
        this._refreshGeneration++;
        this._cancellable?.cancel();
        this._cancellable = null;
        this._signals.destroy();
        this._monitor?.cancel();
        this._monitor = null;
        this.actor.destroy();
    }

    private _refresh(): void {
        if (this._destroyed)
            return;
        if (this._refreshing) {
            this._refreshPending = true;
            // Invalidate the in-flight result immediately; the coalesced run
            // will be the only generation allowed to update the icon.
            this._refreshGeneration++;
            return;
        }
        this._refreshing = true;
        this._refreshPending = false;
        const generation = ++this._refreshGeneration;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._runRefresh(generation, cancellable).finally(() => {
            if (this._cancellable === cancellable)
                this._cancellable = null;
            this._refreshing = false;
            if (this._refreshPending && !this._destroyed)
                this._refresh();
        });
    }

    private async _runRefresh(generation: number,
        cancellable: Gio.Cancellable): Promise<void> {
        let enumerator: Gio.FileEnumerator | null = null;
        try {
            enumerator = await this._trash.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
            const infos = await enumerator.next_files_async(
                1, GLib.PRIORITY_DEFAULT, cancellable);
            if (this._destroyed || generation !== this._refreshGeneration)
                return;
            const hasItems = infos.length > 0;
            this._icon.icon_name = hasItems
                ? 'user-trash-full-symbolic'
                : 'user-trash-symbolic';
            if (hasItems)
                this.actor.add_style_class_name('full');
            else
                this.actor.remove_style_class_name('full');
        } catch (error) {
            if (!cancellable.is_cancelled())
                console.warn(`Sheliak: não foi possível consultar a lixeira: ${error}`);
        } finally {
            if (enumerator) {
                try {
                    await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
                } catch (error) {
                    if (!this._destroyed)
                        console.debug(`Sheliak: falha ao fechar enumeração da lixeira: ${error}`);
                }
            }
        }
    }
}
