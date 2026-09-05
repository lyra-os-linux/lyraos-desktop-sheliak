import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export class ShowAppsButton {
    readonly actor: St.Button;
    private readonly _icon: St.Icon;
    // St.Icon's `gicon` type comes from a separately-versioned nested
    // @girs/gio-2.0 package (pulled in via St -> Meta), which is
    // structurally incompatible with the top-level Gio.Icon type here.
    private readonly _darkIcon: never | null;
    private readonly _lightIcon: never | null;

    constructor(iconPath: string | null, lightIconPath: string | null) {
        this._darkIcon = iconPath ? Gio.icon_new_for_string(iconPath) as never : null;
        this._lightIcon = lightIconPath ? Gio.icon_new_for_string(lightIconPath) as never : null;
        this._icon = this._darkIcon
            ? new St.Icon({gicon: this._darkIcon, icon_size: 32})
            : new St.Icon({icon_name: 'view-app-grid-symbolic', icon_size: 32});
        this.actor = new St.Button({
            style_class: 'show-apps sheliak-system-button sheliak-show-apps-button',
            child: new St.Bin({style_class: 'overview-icon', child: this._icon}),
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: _('Show Applications'),
        });
        this.actor.connect('clicked', () => Main.overview.showApps());
        this.actor.connect('style-changed', () => this._syncTheme());
    }

    private _syncTheme(): void {
        if (!this.actor.get_stage())
            return;
        const {red, green, blue} = this.actor.get_theme_node().get_foreground_color();
        const isLight = 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128;
        const gicon = isLight ? this._lightIcon : this._darkIcon;
        if (gicon)
            this._icon.set_gicon(gicon);
    }

    destroy(): void {
        this.actor.destroy();
    }
}
