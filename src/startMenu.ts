import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SignalTracker} from './signals.js';
import type {WindowsProfile} from './desktopProfile.js';

/** Native application launcher, with separate Windows 10/11 compositions. */
export class StartMenu {
    readonly menu: PopupMenu.PopupMenu;
    readonly entry: St.Entry;
    private _signals = new SignalTracker();
    private _appSystem = Shell.AppSystem.get_default();
    private _favorites = AppFavorites.getAppFavorites();
    private _allApps: Shell.App[] = [];
    private _results: St.BoxLayout;
    private _pinned: St.Widget;
    private _allHeading: St.Label;
    private _pinnedHeading: St.Label;
    private _allToggle: St.Button;
    private _allVisible = false;
    private _firstResult: St.Button | null = null;
    private _profile: WindowsProfile;
    private _content: St.BoxLayout;
    private _allColumn: St.BoxLayout;

    constructor(button: St.Button, anchor: St.Widget, profile: WindowsProfile) {
        this._profile = profile;
        this.menu = new PopupMenu.PopupMenu(profile === 'windows11' ? anchor : button,
            profile === 'windows11' ? 0.5 : 0, St.Side.BOTTOM);
        if (profile === 'windows10') this.menu.setSourceAlignment(0);
        for (const style of ['sheliak-start-menu', profile])
            this.menu.actor.add_style_class_name(style);
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        const manager = new PopupMenu.PopupMenuManager(button);
        manager.addMenu(this.menu);
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        // This is a container of independently interactive controls, not a
        // disabled application row. Do not inherit the insensitive row color.
        item.remove_style_class_name('popup-menu-item');
        item.remove_style_class_name('popup-inactive-menu-item');
        this._content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sheliak-start-content', x_expand: true});
        item.add_child(this._content);
        this.menu.addMenuItem(item);

        this.entry = new St.Entry({hint_text: _('Search applications…'),
            accessible_name: _('Search applications'), can_focus: true,
            style_class: 'search-entry sheliak-start-search', x_expand: true});
        this.entry.set_primary_icon(new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 16}));
        this._content.add_child(this.entry);

        const headings = new St.BoxLayout({style_class: 'sheliak-start-headings'});
        this._pinnedHeading = new St.Label({text: _('Pinned'), x_expand: true});
        this._allToggle = new St.Button({label: _('All applications'), can_focus: true,
            style_class: 'button sheliak-start-all'});
        headings.add_child(this._pinnedHeading);
        headings.add_child(this._allToggle);
        this._content.add_child(headings);
        this._signals.connect(this._allToggle, 'clicked', () => {
            this._allVisible = !this._allVisible;
            this._render();
        });

        const body = new St.BoxLayout({orientation: profile === 'windows10'
            ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
        style_class: 'sheliak-start-body', x_expand: true, y_expand: true});
        this._content.add_child(body);
        const allColumn = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true});
        this._allColumn = allColumn;
        this._allHeading = new St.Label({text: _('All applications'),
            style_class: 'sheliak-start-heading'});
        allColumn.add_child(this._allHeading);
        this._results = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, style_class: 'sheliak-start-results'});
        const scroll = new St.ScrollView({x_expand: true, y_expand: true,
            style_class: 'sheliak-start-scroll', overlay_scrollbars: true});
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        scroll.set_child(this._results);
        allColumn.add_child(scroll);
        body.add_child(allColumn);
        this._pinned = new St.Widget({layout_manager: new Clutter.GridLayout(),
            x_expand: true, y_align: Clutter.ActorAlign.START,
            style_class: 'sheliak-start-pinned'});
        body.add_child(this._pinned);
        this._signals.connect(this.menu, 'open-state-changed', (_menu, open: boolean) => {
            if (open) {
                this._allVisible = false;
                this.entry.set_text('');
                this._reload();
                const monitor = Main.layoutManager.primaryMonitor;
                if (monitor) {
                    this._content.set_width(Math.min(profile === 'windows10' ? 680 : 620, monitor.width - 40));
                    this._content.set_height(Math.min(570, monitor.height - 140));
                }
                this.entry.grab_key_focus();
            }
        });
        this._signals.connect(this.entry.clutter_text, 'text-changed', () => this._render());
        this._signals.connect(this.entry.clutter_text, 'activate', () => {
            const query = this.entry.get_text().trim().toLocaleLowerCase();
            const first = this._matching(query)[0];
            if (first) this._launch(first);
        });
        this._signals.connect(this.entry.clutter_text, 'key-press-event', (_actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Down) {
                this._firstResult?.grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._signals.connect(this._appSystem, 'installed-changed', () => this._reload());
        this._signals.connect(this._favorites, 'changed', () => this._reload());

        const footer = new St.BoxLayout({style_class: 'sheliak-start-footer'});
        const user = new St.Label({text: GLib.get_real_name() || GLib.get_user_name(),
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        footer.add_child(user);
        const settings = this._actionButton(_('Settings'), 'preferences-system-symbolic', () => {
            const app = this._appSystem.lookup_app('org.lyraos.Vega.desktop')
                ?? this._appSystem.lookup_app('org.gnome.Settings.desktop');
            if (app) this._launch(app);
        });
        footer.add_child(settings);
        const power = this._actionButton(_('Power'), 'system-shutdown-symbolic', () => {
            this.menu.close();
            (SystemActions.getDefault() as unknown as {activateAction(id: string): void}).activateAction('power-off');
        });
        footer.add_child(power);
        const lock = this._actionButton(_('Lock'), 'system-lock-screen-symbolic', () => {
            this.menu.close();
            (SystemActions.getDefault() as unknown as {activateAction(id: string): void}).activateAction('lock-screen');
        });
        footer.add_child(lock);
        this._content.add_child(footer);
        this._reload();
    }

    toggle(): void { this.menu.toggle(); }

    destroy(): void {
        this._signals.destroy();
        this.menu.destroy();
    }

    private _actionButton(name: string, icon: string, action: () => void): St.Button {
        const button = new St.Button({child: new St.Icon({icon_name: icon, icon_size: 20}),
            accessible_name: name, can_focus: true, style_class: 'button'});
        button.connect('clicked', action);
        return button;
    }

    private _reload(): void {
        this._allApps = this._appSystem.get_installed().filter(info => info.should_show())
            .map(info => this._appSystem.lookup_app(info.get_id() ?? ''))
            .filter((app): app is Shell.App => app !== null)
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        this._render();
    }

    private _matching(query: string): Shell.App[] {
        return this._allApps.filter(app => !query ||
            `${app.get_name()} ${app.get_id()} ${app.get_description() ?? ''}`.toLocaleLowerCase().includes(query));
    }

    private _appButton(app: Shell.App, pinned: boolean): St.Button {
        const content = new St.BoxLayout({orientation: pinned
            ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        x_align: pinned ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
        x_expand: !pinned,
        style_class: 'sheliak-start-app-content'});
        const icon = app.create_icon_texture(pinned ? 32 : 24);
        icon.x_align = pinned ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
        content.add_child(icon);
        content.add_child(new St.Label({text: app.get_name(),
            y_align: Clutter.ActorAlign.CENTER, x_expand: true}));
        const button = new St.Button({child: content, accessible_name: app.get_name(),
            can_focus: true, track_hover: true, x_expand: !pinned,
            style_class: pinned ? 'sheliak-start-tile' : 'sheliak-start-app'});
        button.connect('clicked', () => this._launch(app));
        return button;
    }

    private _render(): void {
        const query = this.entry.get_text().trim().toLocaleLowerCase();
        this._results.destroy_all_children();
        this._pinned.destroy_all_children();
        this._firstResult = null;
        const showAll = this._profile === 'windows10' || this._allVisible || query.length > 0;
        this._allColumn.visible = showAll;
        this._allHeading.visible = showAll;
        this._pinned.visible = !query && (this._profile === 'windows10' || !this._allVisible);
        this._allToggle.visible = this._profile === 'windows11' && !query;
        this._allToggle.label = this._allVisible ? _('Back') : _('All applications');
        this._pinnedHeading.text = query ? _('Search results') : this._allVisible ? _('All applications')
            : this._profile === 'windows10' ? _('Applications') : _('Pinned');
        if (showAll) {
            for (const app of this._matching(query)) {
                const button = this._appButton(app, false);
                this._firstResult ??= button;
                this._results.add_child(button);
            }
            if (!this._firstResult)
                this._results.add_child(new St.Label({text: _('No applications found')}));
        }
        if (this._pinned.visible) {
            const grid = this._pinned.layout_manager as Clutter.GridLayout;
            const columns = this._profile === 'windows10' ? 3 : 6;
            const favorites = this._favorites.getFavorites();
            const apps = favorites.length ? favorites : this._allApps.slice(0, 12);
            apps.slice(0, this._profile === 'windows10' ? 12 : 18).forEach((app, index) => {
                const button = this._appButton(app, true);
                this._firstResult ??= button;
                grid.attach(button, index % columns, Math.floor(index / columns), 1, 1);
            });
        }
    }

    private _launch(app: Shell.App): void {
        this.menu.close();
        try { app.activate(); }
        catch (error) { Main.notifyError(_('Could not open the application'), String(error)); }
    }
}
