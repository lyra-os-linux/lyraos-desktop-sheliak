import type Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import type {WindowsProfile} from './desktopProfile.js';

export interface FavoritesList {
    getFavorites(): Shell.App[];
    isFavorite(id: string): boolean;
    addFavorite(id: string): void;
    removeFavorite(id: string): void;
    moveFavoriteToPos(id: string, position: number): void;
}

/** Each Windows surface owns its list; GNOME favorites are only a migration seed. */
export class ProfileFavorites implements FavoritesList {
    readonly key: string;
    constructor(private _settings: Gio.Settings, profile: WindowsProfile,
        surface: 'panel' | 'menu', initial?: string[]) {
        this.key = `${profile}-${surface}-apps`;
        // An explicit empty array means the user removed everything. Never seed it again.
        if (initial && _settings.get_user_value(this.key) === null && _settings.is_writable(this.key))
            this._write(initial);
    }

    getIds(): string[] { return [...new Set(this._settings.get_strv(this.key))]; }

    getFavorites(): Shell.App[] {
        const apps = Shell.AppSystem.get_default();
        return this.getIds().map(id => apps.lookup_app(id))
            .filter((app): app is Shell.App => app !== null);
    }

    isFavorite(id: string): boolean { return this.getIds().includes(id); }

    addFavorite(id: string): void {
        if (!this.isFavorite(id)) this._write([...this.getIds(), id]);
    }

    removeFavorite(id: string): void { this._write(this.getIds().filter(item => item !== id)); }

    moveFavoriteToPos(id: string, position: number): void {
        if (!this.isFavorite(id)) return;
        // Position is in the visible list; retain temporarily unavailable apps too.
        const visible = this.getFavorites().map(app => app.get_id()).filter(item => item !== id);
        const before = visible[Math.max(0, Math.min(position, visible.length))];
        const ids = this.getIds().filter(item => item !== id);
        ids.splice(before ? ids.indexOf(before) : ids.length, 0, id);
        this._write(ids);
    }

    private _write(ids: string[]): void {
        if (!this._settings.set_strv(this.key, [...new Set(ids)]))
            throw new Error('Application preferences could not be saved');
    }
}

export type WindowsFavorites = {panel: ProfileFavorites; menu: ProfileFavorites};

export function windowsFavorites(settings: Gio.Settings, profile: WindowsProfile): WindowsFavorites {
    return {
        panel: new ProfileFavorites(settings, profile, 'panel'),
        menu: new ProfileFavorites(settings, profile, 'menu', global.settings.get_strv('favorite-apps')),
    };
}
