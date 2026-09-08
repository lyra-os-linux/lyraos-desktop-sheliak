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
        const fg = rgba(foreground);
        const line = rgba(foreground, 0.18);
        const controls = [
            '.popup-menu-item', '.icon-button', '.button',
            '.quick-toggle-menu-button',
        ].map(selector => `${scope} .popup-menu ${selector}`);
        const states = (names: string[]) => controls
            .flatMap(selector => names.map(state => `${selector}:${state}`)).join(',\n');
        return `
${scope} .popup-menu { color: ${fg}; }
${scope} .popup-menu-content,
${scope} .popup-menu .popup-sub-menu,
${scope} .popup-menu .quick-toggle-menu {
    background-color: ${rgba(background)};
    color: ${fg};
    border-color: ${line};
}
${controls.join(',\n')} {
    background-color: transparent;
    color: ${fg};
}
${scope} .popup-menu .icon-button,
${scope} .popup-menu .button,
${scope} .popup-menu .quick-toggle-menu-button {
    box-shadow: inset 0 0 0 1px ${line};
}
${scope} .popup-menu .popup-menu-icon,
${scope} .popup-menu .popup-menu-arrow {
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
`;
    }
}
