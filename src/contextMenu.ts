import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import type {FavoritesList, WindowsFavorites} from './profileFavorites.js';
import type {TileSizeAction} from './tileSizes.js';
import type {TileSize} from './tileLayout.js';

// PopupMenu normally consumes Enter/Space on its source to open itself. For
// application buttons those keys must reach St.Button and activate the app.
class AppPopupMenu extends PopupMenu.PopupMenu {
    constructor(source: St.Widget, private readonly _openFromKeyboard: () => void) {
        super(source, 0.5, St.Side.BOTTOM);
    }

    _onKeyPress(actor: Clutter.Actor, event: Clutter.Event): boolean {
        if (!actor.reactive)
            return Clutter.EVENT_PROPAGATE;
        const key = event.get_key_symbol();
        const modifiers = event.get_state() & Clutter.ModifierType.MODIFIER_MASK
            & ~Clutter.ModifierType.MOD2_MASK;
        if ((key === Clutter.KEY_Menu && modifiers === 0) ||
            (key === Clutter.KEY_F10 && modifiers === Clutter.ModifierType.SHIFT_MASK)) {
            this._openFromKeyboard();
            if (this.isOpen)
                this.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
}

export class AppContextMenu {
    readonly menu: PopupMenu.PopupMenu;
    private _app: Shell.App;
    private _favorites: FavoritesList;

    constructor(source: St.Widget, app: Shell.App, private _pins?: WindowsFavorites,
        private _surface: 'panel' | 'menu' = 'panel', private _tileSize?: TileSizeAction) {
        this._app = app;
        this._favorites = _pins?.panel ?? AppFavorites.getAppFavorites();
        this.menu = new AppPopupMenu(source, () => this.toggle());
        this.menu.actor.add_style_class_name('sheliak-menu');
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
    }

    rebuild(): void {
        this.menu.removeAll();

        if (this._app.can_open_new_window()) {
            this.menu.addAction(_('Open New Window'), () =>
                this._app.open_new_window(-1));
        }

        const id = this._app.get_id();
        if (id && !this._app.is_window_backed()) {
            if (this._pins) {
                const panel = this._pins.panel;
                const menu = this._pins.menu;
                this._pinAction(panel, id, _('Pin to Taskbar'), _('Unpin from Taskbar'));
                this._pinAction(menu, id, _('Pin to Start'), _('Unpin from Start'));
                const list = this._pins[this._surface];
                const ids = list.getFavorites().map(app => app.get_id());
                const position = ids.indexOf(id);
                if (position > 0)
                    this.menu.addAction(_('Move Earlier'), () => this._save(() => list.moveFavoriteToPos(id, position - 1)));
                if (position >= 0 && position < ids.length - 1)
                    this.menu.addAction(_('Move Later'), () => this._save(() => list.moveFavoriteToPos(id, position + 1)));
            } else {
                const favorite = this._favorites.isFavorite(id);
                this.menu.addAction(
                    favorite ? _('Remove from Favorites') : _('Add to Favorites'),
                    () => favorite
                        ? this._favorites.removeFavorite(id)
                        : this._favorites.addFavorite(id),
                );
            }
        }

        const windows = this._windows();
        if (this._tileSize) {
            const resize = new PopupMenu.PopupSubMenuMenuItem(_('Resize'));
            const sizes: Array<[TileSize, string]> = [
                ['small', _('Small')], ['medium', _('Medium')],
                ['wide', _('Wide')], ['large', _('Large')],
            ];
            for (const [size, label] of sizes) {
                const item = new PopupMenu.PopupMenuItem(label);
                item.setOrnament(this._tileSize.current() === size ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
                item.connect('activate', () => this._save(() => this._tileSize?.change(size)));
                resize.menu.addMenuItem(item);
            }
            this.menu.addMenuItem(resize);
        }
        if (windows.length > 1) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            for (const window of windows) {
                const title = window.get_title() || this._app.get_name();
                this.menu.addAction(title, () =>
                    Main.activateWindow(window, global.get_current_time()));
            }
        }

        if (windows.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addAction(_('Quit'), () => {
                for (const window of this._windows())
                    window.delete(global.get_current_time());
            });
        }
    }

    private _pinAction(list: FavoritesList, id: string, add: string, remove: string): void {
        this.menu.addAction(list.isFavorite(id) ? remove : add, () => this._save(() =>
            list.isFavorite(id) ? list.removeFavorite(id) : list.addFavorite(id)));
    }

    private _save(action: () => void): void {
        // Close before changing settings: the owning app button may be rebuilt.
        this.menu.close();
        try { action(); }
        catch (error) { Main.notifyError(_('Could not save application preferences'), String(error)); }
    }

    toggle(): void {
        this.rebuild();
        this.menu.toggle();
    }

    close(): void {
        this.menu.close();
    }

    destroy(): void {
        this.menu.destroy();
    }

    private _windows(): Meta.Window[] {
        return this._app.get_windows()
            .filter(window => !window.skip_taskbar);
    }
}
