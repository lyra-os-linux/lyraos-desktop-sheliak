import {LyraExtension} from '../core/extension.js';
import {Provider, Scope} from '../core/provider.js';
import {TopBarManager} from '../topBar.js';
import {WindowsPanel} from '../windowsPanel.js';
import {PanelMenuTheme} from '../panelMenuTheme.js';
import {PanelSurfaceTheme} from '../panelSurfaceTheme.js';

export default class LyraPanel extends LyraExtension<WindowsPanel> {
    protected activate(): void {
        const settings = this.getSettings('org.gnome.shell.extensions.sheliak');
        const appearance = new Scope();
        let topBar: TopBarManager | null = null;
        // Capture geometry before themes/layout; restore it after their CSS
        // has been removed, including rollback during partial activation.
        this.scope.add(() => {
            if (topBar) topBar.destroy(() => appearance.destroy());
            else appearance.destroy();
        });
        topBar = new TopBarManager(settings);
        appearance.own(new PanelSurfaceTheme());
        appearance.own(new PanelMenuTheme());
        const panel = appearance.own(new WindowsPanel(settings, null, () => this.lyraApi?.changed()));
        this.lyraApi = new Provider(panel);
    }
}
