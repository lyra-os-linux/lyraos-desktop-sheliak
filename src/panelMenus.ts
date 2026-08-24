import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Tracker from 'gi://Tracker';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SignalTracker} from './signals.js';

Gio._promisify(Tracker.SparqlConnection.prototype, 'query_async', 'query_finish');
Gio._promisify(Tracker.SparqlCursor.prototype, 'next_async', 'next_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');

const FILE_SEARCH_SERVICE = 'org.freedesktop.Tracker3.Miner.Files';
const FILE_SEARCH_LIMIT = 5;
type ApplicationInfo = {
    get_id: () => string | null;
    get_display_name: () => string;
    get_icon: () => unknown;
    should_show: () => boolean;
    get_categories?: () => string | null;
    launch: (files?: unknown[] | null, context?: unknown | null) => boolean;
};

type Place = {
    name: string;
    uri: string;
    icon: Gio.Icon | string;
};

type SearchItem = {
    name: string;
    icon: Gio.Icon | string;
    keywords: string;
    activate: () => void;
};

const LYRA_SOURCE_URL = 'https://github.com/lyra-os-linux/lyraos-desktop';
const LYRA_ISSUES_URL = 'https://github.com/lyra-os-linux/lyraos-desktop/issues';

function applicationCategories() {
    return [
        {id: 'AudioVideo', label: _('Multimedia'), icon: 'applications-multimedia-symbolic'},
        {id: 'Development', label: _('Development'), icon: 'applications-engineering-symbolic'},
        {id: 'Education', label: _('Education'), icon: 'accessories-dictionary-symbolic'},
        {id: 'Game', label: _('Games'), icon: 'applications-games-symbolic'},
        {id: 'Graphics', label: _('Graphics'), icon: 'applications-graphics-symbolic'},
        {id: 'Network', label: _('Internet'), icon: 'web-browser-symbolic'},
        {id: 'Office', label: _('Office'), icon: 'x-office-document-symbolic'},
        {id: 'Science', label: _('Science'), icon: 'applications-science-symbolic'},
        {id: 'Settings', label: _('Settings'), icon: 'preferences-system-symbolic'},
        {id: 'System', label: _('System'), icon: 'applications-system-symbolic'},
        {id: 'Utility', label: _('Utilities'), icon: 'applications-utilities-symbolic'},
    ] as const;
}

function specialDirectories(): Array<[GLib.UserDirectory, string, string]> {
    return [
        [GLib.UserDirectory.DIRECTORY_DESKTOP, _('Desktop'), 'user-desktop-symbolic'],
        [GLib.UserDirectory.DIRECTORY_DOCUMENTS, _('Documents'), 'folder-documents-symbolic'],
        [GLib.UserDirectory.DIRECTORY_DOWNLOAD, _('Downloads'), 'folder-download-symbolic'],
        [GLib.UserDirectory.DIRECTORY_MUSIC, _('Music'), 'folder-music-symbolic'],
        [GLib.UserDirectory.DIRECTORY_PICTURES, _('Pictures'), 'folder-pictures-symbolic'],
        [GLib.UserDirectory.DIRECTORY_VIDEOS, _('Videos'), 'folder-videos-symbolic'],
    ];
}

function alphabeticalCompare(a: string, b: string): number {
    return a.localeCompare(b, undefined, {sensitivity: 'base'});
}

function launchApplication(appSystem: Shell.AppSystem, appInfo: ApplicationInfo): void {
    const id = appInfo.get_id();
    const app = id ? appSystem.lookup_app(id) : null;
    try {
        if (app)
            app.activate();
        else
            appInfo.launch([], null);
    } catch (error) {
        console.error(`Sheliak: falha ao abrir ${appInfo.get_display_name()}: ${error}`);
        Main.notifyError(_('Could not open the application'), String(error));
    }
}

function panelLabel(text: string, iconName: string): St.BoxLayout {
    const box = new St.BoxLayout({
        style_class: 'panel-status-menu-box',
        y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(new St.Icon({
        icon_name: iconName,
        style_class: 'system-status-icon',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    box.add_child(new St.Label({
        text,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return box;
}

function normalizedUri(uri: string): string {
    return uri === 'file:///' ? uri : uri.replace(/\/$/, '');
}

function openUri(uri: string): void {
    try {
        Gio.AppInfo.launch_default_for_uri(
            uri, null);
    } catch (error) {
        console.error(`Sheliak: não foi possível abrir ${uri}: ${error}`);
        Main.notifyError(_('Could not open the location'), String(error));
    }
}

class ApplicationsIndicator {
    readonly button: PanelMenu.Button;
    private _settings: Gio.Settings;
    private _appSystem = Shell.AppSystem.get_default();
    private _signals = new SignalTracker();
    private _categoryMenus: PopupMenu.PopupMenu[] = [];
    private _openCategoryMenu: PopupMenu.PopupMenu | null = null;
    // Submenus flutuantes próprios, fora da árvore de button.menu, precisam
    // de seu próprio grab modal para receber eventos de ponteiro (incluindo
    // o realce ao passar o mouse). Um PopupMenuManager dedicado — em vez do
    // Main.panel.menuManager compartilhado — evita fechar o menu pai sempre
    // que uma categoria abre.
    private _categoryMenuManager: PopupMenu.PopupMenuManager;
    private _icon: St.Icon;
    // See showAppsButton.ts: St.Icon's `gicon` type comes from a separately
    // versioned nested @girs/gio-2.0 package, structurally incompatible with
    // the top-level Gio.Icon type here.
    private _darkIcon: never | null = null;
    private _lightIcon: never | null = null;
    private _interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

    constructor(settings: Gio.Settings, extensionPath?: string) {
        this._settings = settings;
        this.button = new PanelMenu.Button(0.5, _('Applications'));
        this.button.add_style_class_name('sheliak-panel-indicator');
        (this.button.menu as PopupMenu.PopupMenu).actor
            .add_style_class_name('sheliak-panel-menu');
        this._categoryMenuManager = new PopupMenu.PopupMenuManager(this.button);

        if (extensionPath) {
            this._darkIcon = Gio.icon_new_for_string(GLib.build_filenamev(
                [extensionPath, 'icons', 'sheliak-logo-symbolic.svg'])) as never;
            this._lightIcon = Gio.icon_new_for_string(GLib.build_filenamev(
                [extensionPath, 'icons', 'sheliak-logo-symbolic-dark.svg'])) as never;
        }
        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = this._darkIcon
            ? new St.Icon({
                gicon: this._darkIcon,
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            })
            : new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
        box.add_child(this._icon);
        box.add_child(new St.Label({
            text: _('Applications'),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.button.add_child(box);

        this._signals.connect(this._appSystem, 'installed-changed', () => this._rebuild());
        for (const key of ['show-application-icons', 'sort-applications-menu',
            'open-application-submenus-sideways']) {
            this._signals.connect(this._settings, `changed::${key}`,
                () => this._rebuild());
        }
        this._signals.connect(this.button.menu, 'open-state-changed',
            (_menu, open: boolean) => {
                if (!open)
                    this._closeCategoryMenus();
            });
        this._signals.connect(this._interfaceSettings, 'changed::color-scheme',
            () => this._syncTheme());
        this._syncTheme();
        this._rebuild();
    }

    destroy(): void {
        this._signals.destroy();
        this._destroyCategoryMenus();
        this.button.destroy();
    }

    private _syncTheme(): void {
        const isLight = this._interfaceSettings.get_string('color-scheme') !== 'prefer-dark';
        const gicon = isLight ? this._lightIcon : this._darkIcon;
        if (gicon)
            this._icon.set_gicon(gicon);
    }

    private _rebuild(): void {
        const menu = this.button.menu as PopupMenu.PopupMenu;
        this._destroyCategoryMenus();
        menu.removeAll();

        const appCategories = applicationCategories();
        const groups = new Map<string, ApplicationInfo[]>();
        for (const category of appCategories)
            groups.set(category.id, []);
        groups.set('Other', []);

        const seen = new Set<string>();
        for (const appInfo of this._appSystem.get_installed() as unknown as ApplicationInfo[]) {
            const id = appInfo.get_id();
            if (!id || seen.has(id) || !appInfo.should_show())
                continue;
            seen.add(id);

            const rawCategories = appInfo.get_categories?.() ?? '';
            const categories = new Set(rawCategories.split(';').filter(Boolean));
            const category = appCategories.find(item => categories.has(item.id));
            groups.get(category?.id ?? 'Other')?.push(appInfo);
        }

        const showIcons = this._settings.get_boolean('show-application-icons');
        const sortAlphabetically = this._settings.get_boolean('sort-applications-menu');
        const openSideways = this._settings.get_boolean(
            'open-application-submenus-sideways');
        const categories = [...appCategories,
            {id: 'Other', label: _('Other'), icon: 'applications-other-symbolic'}];
        if (sortAlphabetically)
            categories.sort((a, b) => alphabeticalCompare(a.label, b.label));
        let itemCount = 0;
        for (const category of categories) {
            const apps = groups.get(category.id) ?? [];
            if (apps.length === 0)
                continue;

            if (sortAlphabetically) {
                apps.sort((a, b) => alphabeticalCompare(
                    a.get_display_name(), b.get_display_name()));
            }

            if (!openSideways) {
                const submenu: PopupMenu.PopupSubMenuMenuItem & {icon?: St.Icon} =
                    new PopupMenu.PopupSubMenuMenuItem(category.label, true);
                if (submenu.icon)
                    submenu.icon.icon_name = category.icon;
                for (const appInfo of apps) {
                    submenu.menu.addMenuItem(this._applicationItem(appInfo, showIcons));
                    itemCount++;
                }
                menu.addMenuItem(submenu);
                continue;
            }

            const categoryItem = new PopupMenu.PopupImageMenuItem(category.label, category.icon, {
                activate: false,
            } as PopupMenu.PopupImageMenuItem.ConstructorProps);
            // Um expansor entre o rótulo e a seta empurra a seta até a borda
            // direita do item, em vez de deixá-la colada ao texto.
            categoryItem.add_child(new St.Bin({
                style_class: 'popup-menu-item-expander',
                x_expand: true,
            }));
            categoryItem.add_child(PopupMenu.arrowIcon(St.Side.RIGHT));
            const categoryMenu = this._createCategoryMenu(categoryItem);
            for (const appInfo of apps) {
                categoryMenu.addMenuItem(this._applicationItem(appInfo, showIcons));
                itemCount++;
            }
            categoryItem.connect('notify::active', () => {
                if (categoryItem.active)
                    this._openCategory(categoryMenu);
            });
            // Se o ponteiro sai da linha da categoria sem entrar no flyout
            // (ou vice-versa), o submenu deve fechar em vez de ficar
            // flutuando sem nenhum item em destaque.
            categoryItem.connect('leave-event', (_actor: St.Widget, event: Clutter.Event) =>
                this._onCategoryLeave(categoryMenu, event));
            categoryMenu.actor.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) =>
                this._onCategoryLeave(categoryMenu, event));
            menu.addMenuItem(categoryItem);
        }

        if (itemCount === 0) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(
                _('No applications found'), {reactive: false}));
        }
    }

    private _applicationItem(appInfo: ApplicationInfo, showIcon: boolean):
    PopupMenu.PopupImageMenuItem | PopupMenu.PopupMenuItem {
        const icon = appInfo.get_icon()
            ? appInfo.get_icon() as Gio.Icon
            : 'application-x-executable-symbolic';
        const item = showIcon
            ? new PopupMenu.PopupImageMenuItem(appInfo.get_display_name(), icon)
            : new PopupMenu.PopupMenuItem(appInfo.get_display_name());
        item.connect('activate', () => {
            (this.button.menu as PopupMenu.PopupMenu).close();
            launchApplication(this._appSystem, appInfo);
        });
        return item;
    }

    private _createCategoryMenu(source: St.Widget): PopupMenu.PopupMenu {
        // A seta fica na borda esquerda do pop-up, fazendo-o abrir à direita
        // do item. O BoxPointer troca o lado automaticamente se faltar espaço.
        const menu = new PopupMenu.PopupMenu(source, 0.0, St.Side.LEFT);
        // O BoxPointer alinha pelo centro do item por padrão mesmo com
        // arrowAlignment 0.0 (a referência é _sourceAlignment, que é 0.5);
        // setSourceAlignment(0.0) move a referência para a borda superior
        // do item de categoria, alinhando o topo do flyout com ele.
        menu.setSourceAlignment(0.0);
        menu.actor.add_style_class_name('sheliak-panel-menu');
        menu.actor.add_style_class_name('sheliak-category-menu');
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._categoryMenuManager.addMenu(menu);
        this._categoryMenus.push(menu);
        return menu;
    }

    private _openCategory(menu: PopupMenu.PopupMenu): void {
        if (this._openCategoryMenu === menu)
            return;
        this._openCategoryMenu?.close();
        this._openCategoryMenu = menu;
        menu.open();
    }

    private _onCategoryLeave(menu: PopupMenu.PopupMenu, event: Clutter.Event): boolean {
        if (this._openCategoryMenu !== menu)
            return Clutter.EVENT_PROPAGATE;
        const related = event.get_related();
        const stayedOnTrigger = related && menu.sourceActor.contains(related);
        const stayedOnMenu = related && menu.actor.contains(related);
        if (!stayedOnTrigger && !stayedOnMenu)
            this._closeCategoryMenus();
        return Clutter.EVENT_PROPAGATE;
    }

    private _closeCategoryMenus(): void {
        for (const menu of this._categoryMenus)
            menu.close();
        this._openCategoryMenu = null;
    }

    private _destroyCategoryMenus(): void {
        this._closeCategoryMenus();
        for (const menu of this._categoryMenus.splice(0)) {
            this._categoryMenuManager.removeMenu(menu);
            menu.destroy();
        }
    }

}

class PlacesIndicator {
    readonly button: PanelMenu.Button;
    private _settings: Gio.Settings;
    private _volumeMonitor = Gio.VolumeMonitor.get();
    private _signals = new SignalTracker();

    constructor(settings: Gio.Settings) {
        this._settings = settings;
        this.button = new PanelMenu.Button(0.5, _('Places'));
        this.button.add_style_class_name('sheliak-panel-indicator');
        this.button.add_child(panelLabel(_('Places'), 'folder-symbolic'));
        (this.button.menu as PopupMenu.PopupMenu).actor
            .add_style_class_name('sheliak-panel-menu');

        for (const signal of ['mount-added', 'mount-changed', 'mount-removed',
            'volume-added', 'volume-changed', 'volume-removed']) {
            this._signals.connect(this._volumeMonitor, signal, () => this._rebuild());
        }
        for (const key of ['show-place-bookmarks', 'show-place-volumes']) {
            this._signals.connect(this._settings, `changed::${key}`, () => this._rebuild());
        }
        // Recarregar ao abrir também captura alterações no arquivo de marcadores
        // feitas pelo Nautilus sem manter monitores separados para GTK 3 e GTK 4.
        this._signals.connect(this.button.menu, 'open-state-changed',
            (_menu, open: boolean) => {
                if (open)
                    this._rebuild();
            });
        this._rebuild();
    }

    destroy(): void {
        this._signals.destroy();
        this.button.destroy();
    }

    private _rebuild(): void {
        const menu = this.button.menu as PopupMenu.PopupMenu;
        menu.removeAll();
        const seen = new Set<string>();

        const personal = this._personalPlaces(seen);
        if (personal.length > 0) {
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Personal')));
            for (const place of personal)
                menu.addMenuItem(this._placeItem(place));
        }

        if (this._settings.get_boolean('show-place-bookmarks')) {
            const bookmarks = this._bookmarks(seen);
            if (bookmarks.length > 0) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Bookmarks')));
                for (const place of bookmarks)
                    menu.addMenuItem(this._placeItem(place));
            }
        }

        if (this._settings.get_boolean('show-place-volumes')) {
            const volumes = this._mountedVolumes(seen);
            if (volumes.length > 0) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Devices')));
                for (const place of volumes)
                    menu.addMenuItem(this._placeItem(place));
            }
        }
    }

    private _placeItem(place: Place): PopupMenu.PopupImageMenuItem {
        const item = new PopupMenu.PopupImageMenuItem(place.name, place.icon);
        item.connect('activate', () => openUri(place.uri));
        return item;
    }

    private _personalPlaces(seen: Set<string>): Place[] {
        const places: Place[] = [];
        this._appendUnique(places, seen, {
            name: _('Home'),
            uri: Gio.File.new_for_path(GLib.get_home_dir()).get_uri(),
            icon: 'user-home-symbolic',
        });

        for (const [directory, name, icon] of specialDirectories()) {
            const path = GLib.get_user_special_dir(directory);
            if (!path)
                continue;
            const file = Gio.File.new_for_path(path);
            if (file.query_exists(null))
                this._appendUnique(places, seen, {name, uri: file.get_uri(), icon});
        }
        return places;
    }

    private _bookmarks(seen: Set<string>): Place[] {
        const places: Place[] = [];
        const bookmarkFiles = [
            GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks']),
            GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-4.0', 'bookmarks']),
            GLib.build_filenamev([GLib.get_home_dir(), '.gtk-bookmarks']),
        ];

        for (const path of bookmarkFiles) {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null))
                continue;
            try {
                const [ok, contents] = file.load_contents(null);
                if (!ok)
                    continue;
                for (const line of new TextDecoder().decode(contents).split('\n')) {
                    const match = line.trim().match(/^(\S+)(?:\s+(.+))?$/);
                    if (!match)
                        continue;
                    const uri = match[1];
                    const bookmark = Gio.File.new_for_uri(uri);
                    let name = match[2]?.trim();
                    if (!name) {
                        const basename = bookmark.get_basename() ?? uri;
                        try {
                            name = decodeURIComponent(basename);
                        } catch {
                            name = basename;
                        }
                    }
                    const icon = uri.startsWith('file:')
                        ? 'folder-symbolic'
                        : 'folder-remote-symbolic';
                    this._appendUnique(places, seen, {name, uri, icon});
                }
            } catch (error) {
                console.debug(`Sheliak: não foi possível ler ${path}: ${error}`);
            }
        }
        return places;
    }

    private _mountedVolumes(seen: Set<string>): Place[] {
        const places: Place[] = [];
        const mounts = this._volumeMonitor.get_mounts()
            .filter(mount => !mount.is_shadowed())
            .sort((a, b) => a.get_name().localeCompare(
                b.get_name(), undefined, {sensitivity: 'base'}));

        for (const mount of mounts) {
            const root = mount.get_root();
            const uri = root.get_uri();
            const path = root.get_path();
            const isRemote = !uri.startsWith('file:');
            const isUserVisibleLocal = mount.get_volume() !== null;
            const isDocumentPortal = path?.includes('/doc/') ?? false;
            if (uri === 'file:///' || isDocumentPortal || (!isRemote && !isUserVisibleLocal))
                continue;
            this._appendUnique(places, seen, {
                name: mount.get_name(),
                uri,
                icon: mount.get_symbolic_icon(),
            });
        }
        return places;
    }

    private _appendUnique(places: Place[], seen: Set<string>, place: Place): void {
        const uri = normalizedUri(place.uri);
        if (seen.has(uri))
            return;
        seen.add(uri);
        places.push({...place, uri});
    }
}

class SystemIndicator {
    readonly button: PanelMenu.Button;
    private _settings: Gio.Settings;
    private _appSystem = Shell.AppSystem.get_default();

    constructor(settings: Gio.Settings) {
        this._settings = settings;
        this.button = new PanelMenu.Button(0.5, _('System'));
        this.button.add_style_class_name('sheliak-panel-indicator');
        this.button.add_child(panelLabel(_('System'), 'preferences-system-symbolic'));
        const menu = this.button.menu as PopupMenu.PopupMenu;
        menu.actor.add_style_class_name('sheliak-panel-menu');

        const sourceItem = new PopupMenu.PopupImageMenuItem(
            _('Source Code'), 'applications-engineering-symbolic');
        sourceItem.connect('activate', () => {
            menu.close();
            openUri(LYRA_SOURCE_URL);
        });
        menu.addMenuItem(sourceItem);

        const reportBugItem = new PopupMenu.PopupImageMenuItem(
            _('Report an Issue'), 'dialog-warning-symbolic');
        reportBugItem.connect('activate', () => {
            menu.close();
            openUri(LYRA_ISSUES_URL);
        });
        menu.addMenuItem(reportBugItem);

        const vegaIcon = (this._appSystem.lookup_app('vega.desktop')?.get_icon() as
            unknown as Gio.Icon | undefined) ?? 'preferences-other-symbolic';
        const settingsItem = new PopupMenu.PopupImageMenuItem('Vega', vegaIcon);
        settingsItem.connect('activate', () => {
            menu.close();
            this._openVega();
        });
        menu.addMenuItem(settingsItem);

        const systemTools: Array<[string, string, () => void]> = [
            [_('Audio'), 'audio-volume-high-symbolic',
                () => this._openControlCenter('sound', _('Could not open audio settings'))],
            [_('Bluetooth'), 'bluetooth-active-symbolic',
                () => this._openControlCenter('bluetooth',
                    _('Could not open Bluetooth settings'))],
            [_('Energy'), 'battery-good-symbolic',
                () => this._openControlCenter('power', _('Could not open energy settings'))],
            [_('Screenshot'), 'camera-photo-symbolic', () => this._openScreenshot()],
        ];
        for (const [label, icon, activate] of systemTools) {
            const item = new PopupMenu.PopupImageMenuItem(label, icon);
            item.connect('activate', () => {
                menu.close();
                activate();
            });
            menu.addMenuItem(item);
        }

        if (this._settings.get_boolean('show-system-about')) {
            const aboutItem = new PopupMenu.PopupImageMenuItem(_('About'), 'help-about-symbolic');
            aboutItem.connect('activate', () => {
                menu.close();
                this._openSystemAbout();
            });
            menu.addMenuItem(aboutItem);
        }

    }

    destroy(): void {
        this.button.destroy();
    }

    private _openVega(): void {
        const app = this._appSystem.lookup_app('vega.desktop');
        try {
            if (app)
                app.activate();
            else
                Gio.Subprocess.new(['vega-gtk'], Gio.SubprocessFlags.NONE);
        } catch (error) {
            console.error(`Sheliak: falha ao abrir o Vega: ${error}`);
            Main.notifyError(_('Could not open Vega'), String(error));
        }
    }

    private _openControlCenter(panel: string, errorMessage: string): void {
        try {
            Gio.Subprocess.new(['gnome-control-center', panel], Gio.SubprocessFlags.NONE);
        } catch (error) {
            console.error(`Sheliak: falha ao abrir o painel ${panel}: ${error}`);
            Main.notifyError(errorMessage, String(error));
        }
    }

    private _openScreenshot(): void {
        try {
            Main.screenshotUI.open();
        } catch (error) {
            console.error(`Sheliak: falha ao abrir a captura de tela: ${error}`);
            Main.notifyError(_('Could not open the screenshot tool'), String(error));
        }
    }

    private _openSystemAbout(): void {
        try {
            Gio.Subprocess.new(['gnome-control-center', 'system'], Gio.SubprocessFlags.NONE);
        } catch (error) {
            console.error(`Sheliak: falha ao abrir as informações do sistema: ${error}`);
            Main.notifyError(_('Could not open system information'), String(error));
        }
    }
}

class SearchIndicator {
    readonly button: PanelMenu.Button;
    private _appSystem = Shell.AppSystem.get_default();
    private _signals = new SignalTracker();
    private _entry: St.Entry;
    private _clearIcon: St.Icon;
    private _resultsMenu: PopupMenu.PopupMenu;
    private _index: SearchItem[] = [];
    private _topResult: SearchItem | null = null;
    private _stageClickId = 0;
    private _fileConnection: Tracker.SparqlConnection | null | undefined;
    private _searchCancellable: Gio.Cancellable | null = null;
    private _searchGeneration = 0;
    private _destroyed = false;

    constructor() {
        this.button = new PanelMenu.Button(0.5, _('Search'), true);
        this.button.add_style_class_name('sheliak-panel-indicator');
        this.button.add_style_class_name('sheliak-search-button');

        this._entry = new St.Entry({
            style_class: 'search-entry sheliak-search-entry',
            hint_text: _('Search applications and files…'),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            primary_icon: new St.Icon({
                style_class: 'search-entry-icon',
                icon_name: 'edit-find-symbolic',
            }),
        });

        // O “x” só aparece quando há texto; St.Entry não gerencia a
        // visibilidade do ícone, então ela é alternada em _updateResults().
        this._clearIcon = new St.Icon({
            style_class: 'search-entry-icon',
            icon_name: 'edit-clear-symbolic',
            visible: false,
        });
        this._entry.set_secondary_icon(this._clearIcon);
        this.button.add_child(this._entry);

        // Sem grab modal: o campo faz parte do botão do painel, e um grab
        // restringiria os eventos de teclado ao popup de resultados,
        // bloqueando a digitação. O fechamento ao clicar fora é manual.
        // O BoxPointer posiciona o popup a partir do CENTRO da caixa de
        // conteúdo da origem (não da borda), então arrowAlignment sozinho
        // nunca alinha bordas — setSourceAlignment(0.0) muda a referência
        // para a borda esquerda da origem, fazendo o popup nascer alinhado
        // ao início do campo de busca, independentemente da largura do
        // resultado.
        this._resultsMenu = new PopupMenu.PopupMenu(this._entry, 0.0, St.Side.TOP);
        this._resultsMenu.setSourceAlignment(0.0);
        this._resultsMenu.actor.add_style_class_name('sheliak-panel-menu');
        this._resultsMenu.actor.add_style_class_name('sheliak-search-results');
        Main.uiGroup.add_child(this._resultsMenu.actor);
        this._resultsMenu.actor.hide();

        this._signals.connect(this._entry, 'secondary-icon-clicked', () => {
            this._clearSearch();
            this._entry.grab_key_focus();
        });

        this._signals.connect(this._entry.clutter_text, 'text-changed', () => this._updateResults());
        this._signals.connect(this._entry.clutter_text, 'key-press-event',
            (_actor: unknown, event: Clutter.Event) => this._onEntryKeyPress(event));

        this._signals.connect(this._appSystem, 'installed-changed', () => this._rebuildIndex());
        this._rebuildIndex();
    }

    destroy(): void {
        this._destroyed = true;
        this._searchGeneration++;
        this._searchCancellable?.cancel();
        this._searchCancellable = null;
        this._signals.destroy();
        this._disconnectStageClick();
        this._resultsMenu.destroy();
        this.button.destroy();
        try {
            this._fileConnection?.close();
        } catch (error) {
            console.debug(`Sheliak: falha ao fechar a conexão de busca de arquivos: ${error}`);
        }
    }

    private _clearSearch(): void {
        this._resultsMenu.close();
        this._entry.set_text('');
        this._disconnectStageClick();
    }

    private _connectStageClick(): void {
        if (this._stageClickId)
            return;
        this._stageClickId = global.stage.connect('button-press-event',
            (_actor: unknown, event: Clutter.Event) => this._onStageClick(event));
    }

    private _disconnectStageClick(): void {
        if (this._stageClickId) {
            global.stage.disconnect(this._stageClickId);
            this._stageClickId = 0;
        }
    }

    private _onStageClick(event: Clutter.Event): boolean {
        const target = event.get_source() as Clutter.Actor | null;
        const withinButton = target && this.button.contains(target);
        const withinResults = target && this._resultsMenu.actor.contains(target);
        if (!withinButton && !withinResults)
            this._clearSearch();
        return Clutter.EVENT_PROPAGATE;
    }

    private _onEntryKeyPress(event: Clutter.Event): boolean {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this._clearSearch();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            if (this._topResult) {
                const item = this._topResult;
                this._clearSearch();
                item.activate();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    private _updateResults(): void {
        this._searchCancellable?.cancel();
        this._searchCancellable = null;
        const query = this._entry.get_text().trim().toLowerCase();
        this._clearIcon.visible = this._entry.get_text().length > 0;

        if (!query) {
            this._resultsMenu.close();
            this._resultsMenu.removeAll();
            this._topResult = null;
            this._disconnectStageClick();
            return;
        }

        // Mostra os apps na hora (busca em memória) e completa com os
        // arquivos assim que a consulta ao Tracker retornar, sem travar a
        // digitação. Se o texto já mudou quando a resposta chegar, o
        // resultado obsoleto é descartado.
        const appMatches = this._matchIndex(query);
        this._renderMatches(appMatches.slice(0, 8));

        const generation = ++this._searchGeneration;
        const cancellable = new Gio.Cancellable();
        this._searchCancellable = cancellable;
        this._searchFiles(query, cancellable).then(fileMatches => {
            if (this._destroyed || generation !== this._searchGeneration)
                return;
            if (fileMatches.length === 0)
                return;
            if (this._entry.get_text().trim().toLowerCase() !== query)
                return;
            this._renderMatches([...appMatches, ...fileMatches].slice(0, 8));
        }).catch((error: unknown) => {
            if (!cancellable.is_cancelled())
                console.debug(`Sheliak: busca de arquivos falhou: ${error}`);
        }).finally(() => {
            if (this._searchCancellable === cancellable)
                this._searchCancellable = null;
        });
    }

    private _matchIndex(query: string): SearchItem[] {
        const starts: SearchItem[] = [];
        const contains: SearchItem[] = [];
        for (const item of this._index) {
            if (item.keywords.startsWith(query))
                starts.push(item);
            else if (item.keywords.includes(query))
                contains.push(item);
        }
        return [...starts, ...contains];
    }

    private _renderMatches(matches: SearchItem[]): void {
        this._resultsMenu.removeAll();
        this._topResult = matches[0] ?? null;

        if (matches.length === 0) {
            this._resultsMenu.addMenuItem(new PopupMenu.PopupMenuItem(
                _('No results found'), {reactive: false}));
        } else {
            for (const item of matches) {
                const menuItem = new PopupMenu.PopupImageMenuItem(item.name, item.icon);
                menuItem.connect('activate', () => {
                    this._clearSearch();
                    item.activate();
                });
                this._resultsMenu.addMenuItem(menuItem);
            }
        }

        if (!this._resultsMenu.isOpen)
            this._resultsMenu.open();
        this._connectStageClick();
    }

    private _getFileConnection(): Tracker.SparqlConnection | null {
        if (this._fileConnection !== undefined)
            return this._fileConnection;
        try {
            this._fileConnection = Tracker.SparqlConnection.bus_new(
                FILE_SEARCH_SERVICE, null, null);
        } catch (error) {
            console.debug(`Sheliak: indexador de arquivos indisponível: ${error}`);
            this._fileConnection = null;
        }
        return this._fileConnection;
    }

    private async _searchFiles(query: string,
        cancellable: Gio.Cancellable): Promise<SearchItem[]> {
        const connection = this._getFileConnection();
        if (!connection)
            return [];

        // BIND evita que o Tracker reavalie as funções de propriedade (que
        // produziriam linhas duplicadas por arquivo); DISTINCT é uma segunda
        // rede de segurança contra isso.
        const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const sparql = `
            SELECT DISTINCT ?url ?name WHERE {
              ?file a nfo:FileDataObject ;
                    nie:url ?url .
              BIND(nfo:fileName(?file) AS ?name)
              FILTER(CONTAINS(LCASE(?name), "${escaped}"))
            } ORDER BY DESC(nfo:fileLastModified(?file)) LIMIT ${FILE_SEARCH_LIMIT}
        `;

        const cursor = await connection.query_async(sparql, cancellable);
        const results: SearchItem[] = [];
        try {
            while (await cursor.next_async(cancellable)) {
                const url = cursor.get_string(0)[0];
                const name = cursor.get_string(1)[0];
                results.push({
                    name,
                    icon: await this._fileIcon(url, cancellable),
                    keywords: name.toLowerCase(),
                    activate: () => openUri(url),
                });
            }
        } finally {
            cursor.close();
        }
        return results;
    }

    private async _fileIcon(url: string,
        cancellable: Gio.Cancellable): Promise<Gio.Icon | string> {
        // nie:mimeType não é preenchido de forma confiável pelo Tracker
        // (fica null tanto para pastas quanto para vários arquivos comuns);
        // consultar o próprio GIO dá o ícone correto, igual ao Nautilus.
        try {
            const info = await Gio.File.new_for_uri(url).query_info_async(
                'standard::icon', Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT, cancellable);
            return info.get_icon() ?? 'text-x-generic-symbolic';
        } catch {
            return 'text-x-generic-symbolic';
        }
    }

    private _rebuildIndex(): void {
        const index: SearchItem[] = [];
        const seen = new Set<string>();

        for (const appInfo of this._appSystem.get_installed() as unknown as ApplicationInfo[]) {
            const id = appInfo.get_id();
            if (!id || seen.has(id) || !appInfo.should_show())
                continue;
            seen.add(id);
            const name = appInfo.get_display_name();
            index.push({
                name,
                icon: appInfo.get_icon() ? appInfo.get_icon() as Gio.Icon
                    : 'application-x-executable-symbolic',
                keywords: name.toLowerCase(),
                activate: () => launchApplication(this._appSystem, appInfo),
            });
        }

        for (const appInfo of Gio.AppInfo.get_all() as unknown as ApplicationInfo[]) {
            const id = appInfo.get_id();
            if (!id || seen.has(id))
                continue;
            const categories = new Set((appInfo.get_categories?.() ?? '').split(';').filter(Boolean));
            if (!categories.has('X-GNOME-Settings-Panel'))
                continue;
            seen.add(id);
            const name = appInfo.get_display_name();
            index.push({
                name,
                icon: appInfo.get_icon() ? appInfo.get_icon() as Gio.Icon
                    : 'preferences-system-symbolic',
                keywords: name.toLowerCase(),
                activate: () => launchApplication(this._appSystem, appInfo),
            });
        }

        this._index = index;
    }
}

export class PanelMenus {
    private _settings: Gio.Settings;
    private _signals = new SignalTracker();
    private _applications: ApplicationsIndicator | null = null;
    private _places: PlacesIndicator | null = null;
    private _system: SystemIndicator | null = null;
    private _search: SearchIndicator | null = null;
    private _extensionPath?: string;

    constructor(settings: Gio.Settings, extensionPath?: string) {
        this._settings = settings;
        this._extensionPath = extensionPath;
        for (const key of ['show-applications-menu', 'show-places-menu',
            'show-system-menu', 'show-system-about',
            'show-search-menu', 'panel-menu-position']) {
            this._signals.connect(this._settings, `changed::${key}`,
                () => this._recreate());
        }
        this._recreate();
    }

    destroy(): void {
        this._signals.destroy();
        this._destroyIndicators();
    }

    private _recreate(): void {
        this._destroyIndicators();

        const configuredBox = this._settings.get_string('panel-menu-position');
        const box = ['left', 'center', 'right'].includes(configuredBox)
            ? configuredBox
            : 'left';
        let position = box === 'left' ? 1 : 0;

        if (this._settings.get_boolean('show-applications-menu')) {
            this._applications = new ApplicationsIndicator(this._settings, this._extensionPath);
            Main.panel.addToStatusArea(
                'sheliak-applications', this._applications.button, position++, box);
        }
        if (this._settings.get_boolean('show-places-menu')) {
            this._places = new PlacesIndicator(this._settings);
            Main.panel.addToStatusArea(
                'sheliak-places', this._places.button, position++, box);
        }
        if (this._settings.get_boolean('show-system-menu')) {
            this._system = new SystemIndicator(this._settings);
            Main.panel.addToStatusArea(
                'sheliak-system', this._system.button, position++, box);
        }
        if (this._settings.get_boolean('show-search-menu')) {
            this._search = new SearchIndicator();
            Main.panel.addToStatusArea(
                'sheliak-search', this._search.button, position, box);
        }
    }

    private _destroyIndicators(): void {
        this._search?.destroy();
        this._search = null;
        this._system?.destroy();
        this._system = null;
        this._places?.destroy();
        this._places = null;
        this._applications?.destroy();
        this._applications = null;
    }
}
