import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SHOW_DELAY_MS = 400;
const GAP = 8;

export type DockSide = 'top' | 'bottom' | 'left' | 'right';

// Single shared label reused by every dock icon: only one tooltip can ever
// be visible at a time, and reusing the actor avoids allocating/destroying
// an St.Label on every hover.
export class TooltipManager {
    private _label: St.Label;
    private _showTimeoutId = 0;
    private _showing = false;

    constructor(private _getSide: () => DockSide) {
        this._label = new St.Label({
            style_class: 'dash-label sheliak-tooltip',
            visible: false,
        });
        Main.layoutManager.addChrome(this._label, {affectsInputRegion: false});
    }

    show(source: St.Widget, text: string): void {
        this.hide();
        this._showTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
            this._showTimeoutId = 0;
            this._showNow(source, text);
            return GLib.SOURCE_REMOVE;
        });
    }

    hide(): void {
        if (this._showTimeoutId) {
            GLib.source_remove(this._showTimeoutId);
            this._showTimeoutId = 0;
        }
        if (this._showing) {
            this._showing = false;
            this._label.hide();
        }
    }

    destroy(): void {
        this.hide();
        Main.layoutManager.removeChrome(this._label);
        this._label.destroy();
    }

    private _showNow(source: St.Widget, text: string): void {
        if (!source.get_stage() || !source.visible)
            return;

        this._label.text = text;
        // Clear any previously fixed size first: once set_size() below fixes
        // the label's natural size, Clutter's get_preferred_width/height
        // stop reflecting the current text and just return that old fixed
        // value, so without this reset a longer title on a later hover gets
        // truncated to whatever size the last tooltip used.
        this._label.set_size(-1, -1);
        const [, naturalWidth] = this._label.get_preferred_width(-1);
        const [, naturalHeight] = this._label.get_preferred_height(-1);
        this._label.set_size(naturalWidth, naturalHeight);

        const [sourceX, sourceY] = source.get_transformed_position();
        const [sourceWidth, sourceHeight] = source.get_transformed_size();
        let x = sourceX + (sourceWidth - naturalWidth) / 2;
        let y = sourceY + (sourceHeight - naturalHeight) / 2;

        switch (this._getSide()) {
        case 'bottom':
            y = sourceY - naturalHeight - GAP;
            break;
        case 'top':
            y = sourceY + sourceHeight + GAP;
            break;
        case 'left':
            x = sourceX + sourceWidth + GAP;
            break;
        case 'right':
            x = sourceX - naturalWidth - GAP;
            break;
        }

        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
            x = Math.clamp(x, monitor.x, monitor.x + monitor.width - naturalWidth);
            y = Math.clamp(y, monitor.y, monitor.y + monitor.height - naturalHeight);
        }

        this._label.set_position(Math.round(x), Math.round(y));
        this._label.show();
        this._showing = true;
    }
}
