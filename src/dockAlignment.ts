import type Gio from 'gi://Gio';

/** Each layout remembers its own alignment; extended docks start at the top/left. */
export function alignmentKey(settings: Gio.Settings): string {
    return settings.get_boolean('extend-to-edges') ? 'extended-content-alignment' : 'content-alignment';
}
