import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker} from './signals.js';

/** Keep text and indicators opaque while making the panel surface 10% clear.
 * Dock reads this same surface from the panel's theme node. */
export class PanelSurfaceTheme {
    private _signals = new SignalTracker();
    private _context = St.ThemeContext.get_for_stage(global.stage);
    private _baseStyle = Main.panel.get_style();
    private _ownedStyle: string | null = null;
    private _syncId = 0;

    constructor() {
        this._signals.connect(Main.panel, 'style-changed', () => this._queueSync());
        this._signals.connect(this._context, 'changed', () => this._queueSync());
        this._queueSync();
    }

    destroy(): void {
        this._signals.destroy();
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._syncId = 0;
        if (Main.panel.get_style() === this._ownedStyle)
            Main.panel.set_style(this._baseStyle);
    }

    private _queueSync(): void {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            try {
                this._sync();
            } catch (error) {
                console.error(`Sheliak: falha ao aplicar transparência: ${error}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _sync(): void {
        const panel = Main.panel;
        const currentStyle = panel.get_style();
        if (currentStyle !== this._ownedStyle)
            this._baseStyle = currentStyle;
        const node = panel.get_theme_node();
        // Evaluate the native style without our previous background override.
        // This avoids compounding alpha on each style/theme notification.
        const native = St.ThemeNode.new(this._context, node.get_parent(),
            this._context.get_theme(), node.get_element_type(), panel.get_name(),
            panel.get_style_class_name(), panel.get_style_pseudo_class(),
            this._baseStyle ?? '');
        let {red, green, blue, alpha} = native.get_background_color();
        // Soften the native black panel with Lyra's dark surface (#1c2025).
        // Other theme palettes and the overview's transparency are preserved.
        if (red === 0 && green === 0 && blue === 0) {
            red = 0x1c;
            green = 0x20;
            blue = 0x25;
        }
        const base = this._baseStyle ? `${this._baseStyle}; ` : '';
        const style = `${base}background-color: ` +
            `rgba(${red}, ${green}, ${blue}, ${alpha / 255 * 0.9});`;
        this._ownedStyle = style;
        if (currentStyle !== style)
            panel.set_style(style);
    }
}
