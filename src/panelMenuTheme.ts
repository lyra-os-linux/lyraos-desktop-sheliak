import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker} from './signals.js';

const THEME_CLASS = 'sheliak-panel-colors';

type Color = {red: number; green: number; blue: number; alpha: number};

function rgba(color: Color, opacity = color.alpha / 255): string {
    return `rgba(${color.red}, ${color.green}, ${color.blue}, ${opacity})`;
}

/** Apply the panel palette to Shell menus, including menus created later. */
export class PanelMenuTheme {
    private _signals = new SignalTracker();
    private _context = St.ThemeContext.get_for_stage(global.stage);
    private _theme: St.Theme | null = null;
    private _file: Gio.File;
    private _css = '';
    private _syncId = 0;
    private _hadClass = Main.uiGroup.has_style_class_name(THEME_CLASS);

    constructor() {
        const [file, stream] = Gio.File.new_tmp('sheliak-menu-theme-XXXXXX');
        stream.close(null);
        this._file = file;
        Main.uiGroup.add_style_class_name(THEME_CLASS);
        this._signals.connect(Main.panel, 'style-changed', () => this._queueSync());
        this._signals.connect(this._context, 'changed', () => this._queueSync());
        this._queueSync();
    }

    destroy(): void {
        this._signals.destroy();
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._syncId = 0;
        this._theme?.unload_stylesheet(this._file as never);
        const current = this._context.get_theme();
        if (current !== this._theme)
            current?.unload_stylesheet(this._file as never);
        if (!this._hadClass)
            Main.uiGroup.remove_style_class_name(THEME_CLASS);
        this._file.delete(null);
    }

    private _queueSync(): void {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            try {
                this._sync();
            } catch (error) {
                console.error(`Sheliak: falha ao aplicar cores dos menus: ${error}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _sync(): void {
        const theme = this._context.get_theme();
        if (!theme)
            return;
        const node = Main.panel.get_theme_node();
        const background = node.get_background_color();
        // The overview makes the panel transparent. Keep the last readable
        // menu surface until the regular panel palette becomes available.
        const css = background.alpha > 0
            ? this._stylesheet(background, node.get_foreground_color())
            : this._css;
        if (!css || (css === this._css && theme === this._theme))
            return;
        this._theme?.unload_stylesheet(this._file as never);
        // Main.loadTheme may have copied our stylesheet to the new theme.
        theme.unload_stylesheet(this._file as never);
        this._theme = theme;
        this._css = css;
        GLib.file_set_contents(this._file.get_path()!, css);
        theme.load_stylesheet(this._file as never);
    }

    private _stylesheet(background: Color, foreground: Color): string {
        const scope = `.${THEME_CLASS}`;
        const quick = `${scope} .quick-toggle-menu`;
        // QuickSettingsMenu places expanded items in a sibling overlay,
        // outside the actor carrying the popup-menu class.
        const menuScopes = [`${scope} .popup-menu`, quick];
        const fg = rgba(foreground);
        const line = rgba(foreground, 0.18);
        const controls = [
            '.popup-menu-item', '.icon-button', '.button',
            '.quick-toggle-menu-button',
        ].flatMap(selector => menuScopes.map(menu => `${menu} ${selector}`));
        const states = (names: string[]) => controls
            .flatMap(selector => names.map(state => `${selector}:${state}`)).join(',\n');
        const date = `${scope} .datemenu-popover`;
        const cards = ['.calendar', '.datemenu-today-button', '.message',
            '.events-button', '.world-clocks-button', '.weather-button']
            .map(selector => `${date} ${selector}`);
        const dateControls = ['.calendar .calendar-month-header .pager-button',
            '.calendar .calendar-month-header .calendar-month-label',
            '.message .message-header .message-expand-button',
            '.message .message-header .message-close-button',
            '.message-notification-group .message-collapse-button',
            '.message-media-control', '.notification-button']
            .map(selector => `${date} ${selector}`);
        const dateStates = (selectors: string[], names: string[]) => selectors
            .flatMap(selector => names.map(state => `${selector}:${state}`)).join(',\n');
        return `
${scope} .sheliak-search-entry,
${scope} .sheliak-search-entry:hover,
${scope} .sheliak-search-entry:focus {
    background-color: ${rgba(background)};
    color: ${fg};
    border-color: ${line};
    box-shadow: inset 0 0 0 1px ${line};
}
${scope} .sheliak-search-entry:hover {
    box-shadow: inset 0 0 0 1px ${rgba(foreground, 0.35)};
}
${scope} .sheliak-search-entry:focus {
    box-shadow: inset 0 0 0 2px -st-accent-color;
}
${scope} .sheliak-search-entry .search-entry-icon {
    color: inherit;
}
${scope} .sheliak-search-entry .hint-text {
    color: ${rgba(foreground, 0.65)};
}
${menuScopes.join(',\n')} { color: ${fg}; }
${scope} .popup-menu-content,
${scope} .popup-menu .popup-sub-menu {
    background-color: ${rgba(background)};
    color: ${fg};
    border-color: ${line};
}
${quick},
${quick}:insensitive {
    background-color: ${rgba(background, 1)};
    color: ${fg};
    border-color: ${line};
}
${controls.join(',\n')} {
    background-color: transparent;
    color: ${fg};
}
${['.icon-button', '.button', '.quick-toggle-menu-button']
    .flatMap(selector => menuScopes.map(menu => `${menu} ${selector}`)).join(',\n')} {
    box-shadow: inset 0 0 0 1px ${line};
}
${['.popup-menu-icon', '.popup-menu-arrow']
    .flatMap(selector => menuScopes.map(menu => `${menu} ${selector}`)).join(',\n')} {
    color: inherit;
    background-color: transparent;
    border-color: transparent;
}
${states(['hover', 'focus', 'selected'])} {
    background-color: st-transparentize(-st-accent-color, 0.85);
}
${states(['active', 'checked'])} {
    background-color: st-transparentize(-st-accent-color, 0.7);
}
${scope} .popup-menu .quick-toggle:checked,
${scope} .popup-menu .quick-toggle-has-menu:checked .quick-toggle-menu-button {
    background-color: -st-accent-color;
    color: -st-accent-fg-color;
}
${states(['insensitive'])} {
    background-color: transparent;
    color: ${rgba(foreground, 0.5)};
}
${quick} .header .subtitle,
${quick} .device-subtitle {
    color: ${rgba(foreground, 0.7)};
}
${quick} .header .icon {
    background-color: ${rgba(foreground, 0.07)};
    color: ${fg};
    box-shadow: inset 0 0 0 1px ${line};
}
${quick} .header .icon.active {
    background-color: -st-accent-color;
    color: -st-accent-fg-color;
}
${quick} .popup-separator-menu-item-separator {
    background-color: ${line};
}
/* Date menu cards have their own Shell colors, independent of popup-menu.
 * Opaque card surfaces prevent text bleeding through notification stacks.
 * Scope to the popover to preserve banners and lock-screen contrast. */
${cards.join(',\n')},
${date} .message:second-in-stack,
${date} .message:lower-in-stack {
    background-color: ${rgba(background, 1)};
    color: ${fg};
    border-color: ${line};
}
${dateStates(cards, ['hover', 'focus'])} {
    background-color: st-mix(${rgba(foreground, 1)}, ${rgba(background, 1)}, 6%);
    color: ${fg};
}
${dateStates(cards, ['active', 'checked'])} {
    background-color: st-mix(${rgba(foreground, 1)}, ${rgba(background, 1)}, 10%);
    color: ${fg};
}
${date} .message-list {
    color: ${fg};
    border-color: ${line};
}
${date} .message .message-header,
${date} .message .message-header .event-time,
${date} .events-button .events-box .events-title,
${date} .events-button .events-box .events-list .event-box .event-time,
${date} .events-button .events-box .events-list .event-placeholder,
${date} .world-clocks-button .world-clocks-header,
${date} .world-clocks-button .world-clocks-grid .world-clocks-timezone,
${date} .weather-button .weather-box .weather-header-box .weather-header {
    color: ${rgba(foreground, 0.7)};
}
${date} .message-list .message-list-placeholder {
    color: ${rgba(foreground, 0.55)};
}
${dateControls.join(',\n')} {
    background-color: transparent;
    color: ${fg};
    box-shadow: inset 0 0 0 1px ${line};
}
${dateStates(dateControls, ['hover', 'focus'])} {
    background-color: st-transparentize(-st-accent-color, 0.85);
    color: ${fg};
}
${dateStates(dateControls, ['active', 'checked'])} {
    background-color: st-transparentize(-st-accent-color, 0.7);
    color: ${fg};
}
${dateStates(dateControls, ['insensitive'])} {
    background-color: transparent;
    color: ${rgba(foreground, 0.5)};
}
${date} .message .message-box .message-icon.message-themed-icon {
    background-color: ${rgba(foreground, 0.07)};
    color: ${fg};
    box-shadow: inset 0 0 0 1px ${line};
}
${date} .calendar .calendar-month-header .calendar-month-label {
    color: ${fg} !important;
}
${date} .calendar .calendar-day,
${date} .calendar .calendar-day-heading {
    color: ${fg};
    background-color: transparent;
}
${date} .calendar .calendar-day.calendar-weekend {
    color: ${rgba(foreground, 0.7)};
}
${date} .calendar .calendar-day.calendar-other-month,
${date} .calendar .calendar-day.calendar-other-month.calendar-weekend {
    color: ${rgba(foreground, 0.45)};
}
${date} .calendar .calendar-week-number {
    color: ${rgba(foreground, 0.7)};
    background-color: ${rgba(foreground, 0.08)};
}
${date} .calendar .calendar-day:hover,
${date} .calendar .calendar-day:focus,
${date} .calendar .calendar-day:selected {
    color: ${fg};
    background-color: st-transparentize(-st-accent-color, 0.8);
}
${date} .calendar .calendar-day.calendar-today,
${date} .calendar .calendar-day.calendar-today:hover,
${date} .calendar .calendar-day.calendar-today:focus,
${date} .calendar .calendar-day.calendar-today:selected {
    background-color: -st-accent-color;
    color: -st-accent-fg-color !important;
}
`;
    }
}
