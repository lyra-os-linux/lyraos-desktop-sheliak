import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class DesktopIcons extends Extension {
    DesktopIconsUsableArea: {
        setMarginsForExtension(uuid: string, margins: Record<number, {
            top: number; bottom: number; left: number; right: number;
        }> | null): void;
    } | null;
    enable(): void;
    disable(): void;
}
