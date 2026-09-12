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

import {SignalTracker} from '../signals.js';

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

export class SearchIndicator {
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
    private _compact = false;
    private _compactIcon: St.Icon;
    private _entryBox: St.BoxLayout;

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
        // The panel allocates status-area actors in a fixed row. Keep enough
        // room for GNOME's centered clock and right indicators on narrow
        // outputs instead of allowing the search entry to overlap them.
        this._signals.connect(Main.panel, 'notify::width', () => this._syncWidth());
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => this._syncWidth());
        this._syncWidth();

        // O “x” só aparece quando há texto; St.Entry não gerencia a
        // visibilidade do ícone, então ela é alternada em _updateResults().
        this._clearIcon = new St.Icon({
            style_class: 'search-entry-icon',
            icon_name: 'edit-clear-symbolic',
            visible: false,
        });
        this._entry.set_secondary_icon(this._clearIcon);
        this.button.add_child(this._entry);
        this._compactIcon = new St.Icon({icon_name: 'edit-find-symbolic',
            style_class: 'system-status-icon', y_align: Clutter.ActorAlign.CENTER});

        // Sem grab modal: o campo faz parte do botão do painel, e um grab
        // restringiria os eventos de teclado ao popup de resultados,
        // bloqueando a digitação. O fechamento ao clicar fora é manual.
        // O BoxPointer posiciona o popup a partir do CENTRO da caixa de
        // conteúdo da origem (não da borda), então arrowAlignment sozinho
        // nunca alinha bordas — setSourceAlignment(0.0) muda a referência
        // para a borda esquerda da origem, fazendo o popup nascer alinhado
        // ao início do campo de busca, independentemente da largura do
        // resultado. A origem é o botão, que permanece no painel mesmo quando
        // o campo é movido para dentro do popup no modo compacto.
        this._resultsMenu = new PopupMenu.PopupMenu(this.button, 0.0, St.Side.TOP);
        this._resultsMenu.setSourceAlignment(0.0);
        this._resultsMenu.actor.add_style_class_name('sheliak-panel-menu');
        this._resultsMenu.actor.add_style_class_name('sheliak-search-results');
        Main.uiGroup.add_child(this._resultsMenu.actor);
        this._resultsMenu.actor.hide();
        // Not a menu item: rebuilding results must not destroy the focused entry.
        this._entryBox = new St.BoxLayout({style_class: 'sheliak-search-popup-entry', visible: false});
        this._resultsMenu.box.add_child(this._entryBox);
        this._signals.connect(this.button, 'captured-event',
            (_actor: unknown, event: Clutter.Event) => {
                if (this._compact && (event.type() === Clutter.EventType.TOUCH_BEGIN ||
                    (event.type() === Clutter.EventType.BUTTON_PRESS && event.get_button() === Clutter.BUTTON_PRIMARY))) {
                    this._openCompact();
                    return Clutter.EVENT_STOP;
                }
                if (event.type() !== Clutter.EventType.KEY_PRESS)
                    return Clutter.EVENT_PROPAGATE;
                if (global.stage.get_key_focus() !== this.button)
                    return Clutter.EVENT_PROPAGATE;
                if (![Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space,
                    Clutter.KEY_Down].includes(event.get_key_symbol()))
                    return Clutter.EVENT_PROPAGATE;
                if (this._compact) this._openCompact();
                else this._entry.grab_key_focus();
                return Clutter.EVENT_STOP;
            });

        this._signals.connect(this._entry, 'secondary-icon-clicked', () => {
            this._entry.set_text('');
            this._entry.grab_key_focus();
        });

        this._signals.connect(this._entry.clutter_text, 'text-changed', () => this._updateResults());
        this._signals.connect(this._entry.clutter_text, 'key-press-event',
            (_actor: unknown, event: Clutter.Event) => this._onEntryKeyPress(event));

        this._signals.connect(this._appSystem, 'installed-changed', () => this._rebuildIndex());
        this._rebuildIndex();
    }

    private _syncWidth(): void {
        const panelWidth = Main.panel.width;
        if (!Number.isFinite(panelWidth) || panelWidth <= 0)
            return;
        const reserved = 360;
        const width = Math.max(120, Math.min(300, panelWidth - reserved));
        this._entry.set_width(width);
    }

    destroy(): void {
        this._destroyed = true;
        this._searchGeneration++;
        this._searchCancellable?.cancel();
        this._searchCancellable = null;
        this._signals.destroy();
        this._disconnectStageClick();
        // Either actor can be outside the button tree after a mode switch.
        this._compactIcon.destroy();
        this._entry.destroy();
        this._resultsMenu.destroy();
        this.button.destroy();
        try {
            this._fileConnection?.close();
        } catch (error) {
            console.debug(`Sheliak: falha ao fechar a conexão de busca de arquivos: ${error}`);
        }
    }

    expandedWidth(): number {
        const padding = this.button.get_theme_node().get_length('-natural-hpadding') * 2;
        return this._entry.get_preferred_width(-1)[1] + padding;
    }

    setCompact(compact: boolean): void {
        if (compact === this._compact) return;
        const focus = global.stage.get_key_focus();
        const focused = !!focus && (this.button.contains(focus) || this._entry.contains(focus));
        this._resultsMenu.close();
        this._compact = compact;
        this._entry.get_parent()?.remove_child(this._entry);
        this._compactIcon.get_parent()?.remove_child(this._compactIcon);
        if (compact) {
            this.button.add_child(this._compactIcon);
            this._entryBox.add_child(this._entry);
        } else {
            this.button.add_child(this._entry);
        }
        this._entryBox.visible = compact;
        if (focused) {
            if (compact) this._openCompact();
            else this._entry.grab_key_focus();
        }
        if (this._entry.get_text()) this._updateResults();
    }

    private _openCompact(): void {
        this._resultsMenu.open();
        this._connectStageClick();
        this._entry.grab_key_focus();
    }

    private _clearSearch(): void {
        const focus = global.stage.get_key_focus();
        const restoreFocus = this._compact && !!focus && this._resultsMenu.actor.contains(focus);
        this._entry.set_text('');
        this._resultsMenu.close();
        this._disconnectStageClick();
        if (restoreFocus) this.button.grab_key_focus();
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
            if (this._compact) this.button.grab_key_focus();
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
            this._resultsMenu.removeAll();
            this._topResult = null;
            if (!this._compact) {
                this._resultsMenu.close();
                this._disconnectStageClick();
            }
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

function openUri(uri: string): void {
    try {
        Gio.AppInfo.launch_default_for_uri(
            uri, null);
    } catch (error) {
        console.error(`Sheliak: não foi possível abrir ${uri}: ${error}`);
        Main.notifyError(_('Could not open the location'), String(error));
    }
}
