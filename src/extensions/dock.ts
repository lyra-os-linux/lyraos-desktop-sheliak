import {LyraExtension, UUIDS, watch} from '../core/extension.js';
import {Provider} from '../core/provider.js';
import {Dock} from '../dock.js';
import type {WindowsPanel} from '../windowsPanel.js';
import {shellIsStartingUp, suppressStartupOverview, nativeDash} from '../shellCompat.js';

export type DockEndpoint = {dock: Dock; panel: WindowsPanel | null};

export default class LyraDock extends LyraExtension<DockEndpoint> {
    protected activate(): void {
        if (shellIsStartingUp()) {
            this.scope.add(suppressStartupOverview());
            global.workspace_manager.get_workspace_by_index(0)?.activate(global.get_current_time());
        }
        const dock = this.scope.own(new Dock(this.getSettings('org.gnome.shell.extensions.sheliak'), this.path));
        const dash = nativeDash();
        if (dash) {
            const wasVisible = dash.visible;
            dash.hide();
            this.scope.add(() => { if (!dash.visible) dash.visible = wasVisible; });
        }
        const state: DockEndpoint = {dock, panel: null};
        this.lyraApi = new Provider(state);
        let release: (() => void) | null = null;
        watch<WindowsPanel>(this.scope, UUIDS.panel, panel => {
            const next = panel?.active ? panel : null;
            if (state.panel === next) return;
            // Close popups borrowing the launcher before changing its parent.
            state.panel = null;
            this.lyraApi?.changed();
            release?.();
            release = null;
            if (next) release = next.attachDock(dock);
            state.panel = next;
            this.lyraApi?.changed();
        });
    }
}
