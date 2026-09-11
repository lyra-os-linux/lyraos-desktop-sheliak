import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {tileSize, type TileSize} from './tileLayout.js';

export class TileSizes {
    constructor(private _settings: Gio.Settings) {}
    get(id: string): TileSize {
        return tileSize(this._values()[id]);
    }
    set(id: string, size: TileSize): void {
        const values = {...this._values(), [id]: tileSize(size)};
        if (!this._settings.set_value('windows10-tile-sizes', new GLib.Variant('a{ss}', values)))
            throw new Error('Tile size could not be saved');
    }
    private _values(): Record<string, string> {
        return this._settings.get_value('windows10-tile-sizes').deep_unpack() as Record<string, string>;
    }
}

export type TileSizeAction = {current(): TileSize; change(size: TileSize): void};
