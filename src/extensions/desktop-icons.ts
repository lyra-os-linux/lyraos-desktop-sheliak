import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// Upstream GJS is kept as JavaScript to retain reviewable upstream diffs.
import DesktopIcons from '../../extensions/desktop-icons/extension.js';
import {Scope} from '../core/provider.js';
import {watch, UUIDS} from '../core/extension.js';
import type {DockEndpoint} from './dock.js';
import {SignalTracker} from '../signals.js';

export default class LyraDesktopIcons extends DesktopIcons {
    private _lyraScope = new Scope();

    enable(): void {
        const legacy = Main.extensionManager.lookup('ding@rastersoft.com');
        if (legacy?.state === 1) throw new Error('Disable DING before enabling Lyra Desktop Icons');
        try {
            super.enable();
            const settings = this.getSettings('org.gnome.shell.extensions.sheliak');
            let signals: SignalTracker | null = null;
            this._lyraScope.add(() => signals?.destroy());
            watch<DockEndpoint>(this._lyraScope, UUIDS.dock, endpoint => {
                signals?.destroy();
                signals = new SignalTracker();
                const area = this.DesktopIconsUsableArea;
                const sync = () => {
                    const monitor = Main.layoutManager.primaryMonitor;
                    if (!area || !endpoint || endpoint.panel || !monitor) {
                        area?.setMarginsForExtension(UUIDS.dock, null);
                        return;
                    }
                    const actor = endpoint.dock.actor;
                    const position = settings.get_string('position');
                    const gap = settings.get_boolean('extend-to-edges') ? 0 : settings.get_uint('edge-margin');
                    const size = position === 'left' || position === 'right' ? actor.width : actor.height;
                    if (!Number.isFinite(size) || size <= 0) return;
                    const margins = {top: 0, bottom: 0, left: 0, right: 0};
                    if (position in margins) margins[position as keyof typeof margins] = size + gap;
                    area.setMarginsForExtension(UUIDS.dock, {[monitor.index]: margins});
                };
                if (endpoint) {
                    signals.connect(endpoint.dock.actor, 'notify::allocation', sync);
                    signals.connect(Main.layoutManager, 'monitors-changed', sync);
                    signals.connect(settings, 'changed', sync);
                }
                sync();
            });
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable(): void {
        this._lyraScope.destroy();
        super.disable();
    }
}
