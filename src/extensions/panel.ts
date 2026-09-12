import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {LyraExtension} from '../core/extension.js';
import {Provider} from '../core/provider.js';
import {TopBarManager} from '../topBar.js';
import {WindowsPanel} from '../windowsPanel.js';
import {PanelMenuTheme} from '../panelMenuTheme.js';
import {PanelSurfaceTheme} from '../panelSurfaceTheme.js';

export default class LyraPanel extends LyraExtension<WindowsPanel> {
    protected activate(): void {
        const settings = this.getSettings('org.gnome.shell.extensions.sheliak');
        this.scope.own(new PanelSurfaceTheme());
        this.scope.own(new PanelMenuTheme());
        this.scope.own(new TopBarManager(settings));
        const activities = (Main.panel.statusArea as unknown as Record<string, {container: {visible: boolean}}>).activities?.container;
        const wasVisible = activities?.visible;
        const sync = () => {
            if (activities) activities.visible = !settings.get_boolean('hide-workspace-button') && !!wasVisible;
        };
        const id = settings.connect('changed::hide-workspace-button', sync);
        this.scope.add(() => { settings.disconnect(id); if (activities) activities.visible = !!wasVisible; });
        sync();
        const panel = this.scope.own(new WindowsPanel(settings, null, () => this.lyraApi?.changed()));
        this.lyraApi = new Provider(panel);
    }
}
