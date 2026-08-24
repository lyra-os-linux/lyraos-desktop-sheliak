import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {installPreferencesTheme} from './prefsTheme.js';

const SCHEMA = 'org.gnome.shell.extensions.sheliak';

function connectForWidget(settings: Gio.Settings, signal: string,
    widget: Gtk.Widget, callback: () => void): void {
    const id = settings.connect(signal, callback);
    widget.connect('destroy', () => {
        if (id)
            settings.disconnect(id);
    });
}

function addSwitch(group: Adw.PreferencesGroup, settings: Gio.Settings,
    key: string, title: string, subtitle: string): void {
    const row = new Adw.ActionRow({title, subtitle});
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
    settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(toggle);
    row.activatable_widget = toggle;
    group.add(row);
}

function addSpin(group: Adw.PreferencesGroup, settings: Gio.Settings,
    key: string, title: string, subtitle: string, min: number, max: number,
    step: number): void {
    const row = new Adw.ActionRow({title, subtitle});
    const adjustment = new Gtk.Adjustment({lower: min, upper: max, step_increment: step});
    const spin = new Gtk.SpinButton({adjustment, numeric: true, valign: Gtk.Align.CENTER});
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(spin);
    group.add(row);
}

function addMinimizeAnimation(group: Adw.PreferencesGroup, settings: Gio.Settings): void {
    const row = new Adw.ActionRow({
        title: _('Minimize Animation'),
        subtitle: _('Effect used when minimizing and restoring windows'),
    });
    const values = [
        ['zoom', _('Zoom to Icon')],
        ['fade', _('Fade')],
        ['none', _('No Animation')],
    ];
    const model = Gtk.StringList.new(values.map(([, label]) => label));
    const combo = new Gtk.DropDown({model, valign: Gtk.Align.CENTER});
    const selected = () => Math.max(0,
        values.findIndex(([id]) => id === settings.get_string('minimize-animation')));
    combo.selected = selected();
    combo.connect('notify::selected', () => settings.set_string(
        'minimize-animation', values[combo.selected]?.[0] ?? 'zoom'));
    connectForWidget(settings, 'changed::minimize-animation', combo,
        () => combo.set_selected(selected()));
    row.add_suffix(combo);
    group.add(row);
}

function addPosition(group: Adw.PreferencesGroup, settings: Gio.Settings): void {
    const row = new Adw.ActionRow({title: _('Position'), subtitle: _('Screen edge where the dock appears')});
    const values = [['left', _('Left')], ['bottom', _('Bottom')], ['right', _('Right')]];
    const model = Gtk.StringList.new(values.map(([, label]) => label));
    const combo = new Gtk.DropDown({model, valign: Gtk.Align.CENTER});
    const selected = () => Math.max(0, values.findIndex(([id]) => id === settings.get_string('position')));
    combo.selected = selected();
    combo.connect('notify::selected', () => settings.set_string('position', values[combo.selected]?.[0] ?? 'left'));
    connectForWidget(settings, 'changed::position', combo,
        () => combo.set_selected(selected()));
    row.add_suffix(combo);
    group.add(row);
}

function addContentAlignment(group: Adw.PreferencesGroup, settings: Gio.Settings): void {
    const row = new Adw.ActionRow({title: _('Alignment'), subtitle: _('Position of favorites and open applications along the dock')});
    const values = [['start', _('Start')], ['center', _('Center')], ['end', _('End')]];
    const model = Gtk.StringList.new(values.map(([, label]) => label));
    const combo = new Gtk.DropDown({model, valign: Gtk.Align.CENTER});
    const selected = () => Math.max(0, values.findIndex(([id]) => id === settings.get_string('content-alignment')));
    combo.selected = selected();
    combo.connect('notify::selected', () => settings.set_string('content-alignment', values[combo.selected]?.[0] ?? 'center'));
    connectForWidget(settings, 'changed::content-alignment', combo,
        () => combo.set_selected(selected()));
    row.add_suffix(combo);
    group.add(row);
}

function addRunningAppsPosition(group: Adw.PreferencesGroup, settings: Gio.Settings): void {
    const row = new Adw.ActionRow({title: _('Open Applications Position'), subtitle: _('Where running applications appear relative to favorites')});
    const values = [['start', _('Start')], ['end', _('End')]];
    const model = Gtk.StringList.new(values.map(([, label]) => label));
    const combo = new Gtk.DropDown({model, valign: Gtk.Align.CENTER});
    const selected = () => Math.max(0, values.findIndex(([id]) => id === settings.get_string('running-apps-position')));
    combo.selected = selected();
    combo.connect('notify::selected', () => settings.set_string('running-apps-position', values[combo.selected]?.[0] ?? 'end'));
    connectForWidget(settings, 'changed::running-apps-position', combo,
        () => combo.set_selected(selected()));
    row.add_suffix(combo);
    group.add(row);
}

function addPanelMenuPosition(group: Adw.PreferencesGroup, settings: Gio.Settings): void {
    const row = new Adw.ActionRow({
        title: _('Panel Position'),
        subtitle: _('Top panel area where the menus appear'),
    });
    const values = [['left', _('Left')], ['center', _('Center')], ['right', _('Right')]];
    const model = Gtk.StringList.new(values.map(([, label]) => label));
    const combo = new Gtk.DropDown({model, valign: Gtk.Align.CENTER});
    const selected = () => Math.max(0,
        values.findIndex(([id]) => id === settings.get_string('panel-menu-position')));
    combo.selected = selected();
    combo.connect('notify::selected', () => settings.set_string(
        'panel-menu-position', values[combo.selected]?.[0] ?? 'left'));
    connectForWidget(settings, 'changed::panel-menu-position', combo,
        () => combo.set_selected(selected()));
    row.add_suffix(combo);
    group.add(row);
}

function addHideMode(group: Adw.PreferencesGroup, settings: Gio.Settings): void {
    const row = new Adw.ActionRow({title: _('Dock Visibility'), subtitle: _('How the dock should remain on screen')});
    const values = [
        ['intelligent', _('Intelligent Hide')],
        ['autohide', _('Auto Hide')],
        ['always', _('Always Visible')],
    ];
    const model = Gtk.StringList.new(values.map(([, label]) => label));
    const combo = new Gtk.DropDown({model, valign: Gtk.Align.CENTER});
    const selected = () => Math.max(0, values.findIndex(([id]) => id === settings.get_string('hide-mode')));
    combo.selected = selected();
    combo.connect('notify::selected', () => settings.set_string('hide-mode', values[combo.selected]?.[0] ?? 'intelligent'));
    connectForWidget(settings, 'changed::hide-mode', combo,
        () => combo.set_selected(selected()));
    row.add_suffix(combo);
    group.add(row);
}

export default class SheliakPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        console.debug('Sheliak: abrindo janela de preferências');
        installPreferencesTheme(window, `${this.path}/prefs.css`);
        const settings = this.getSettings(SCHEMA);
        const appearance = new Adw.PreferencesPage({title: _('Appearance'), icon_name: 'preferences-desktop-theme-symbolic'});
        const appearanceGroup = new Adw.PreferencesGroup({title: _('Appearance')});
        addPosition(appearanceGroup, settings);
        addSpin(appearanceGroup, settings, 'icon-size', _('Icon Size'), _('Size in pixels'), 24, 96, 1);
        addSpin(appearanceGroup, settings, 'edge-margin', _('Edge Margin'), _('Distance in pixels'), 0, 48, 1);
        addSwitch(appearanceGroup, settings, 'animation', _('Animate the Dock'), _('Animate the dock appearing and disappearing'));
        addMinimizeAnimation(appearanceGroup, settings);
        addSwitch(appearanceGroup, settings, 'extend-to-edges', _('Extend to Edges'), _('Use the full length of the edge instead of fitting the content'));
        addContentAlignment(appearanceGroup, settings);
        appearance.add(appearanceGroup);

        const behavior = new Adw.PreferencesPage({title: _('Behavior'), icon_name: 'preferences-system-symbolic'});
        const behaviorGroup = new Adw.PreferencesGroup({title: _('Behavior')});
        addHideMode(behaviorGroup, settings);
        addSpin(behaviorGroup, settings, 'hide-delay', _('Hide Delay'), _('After a window reaches the dock, in milliseconds'), 100, 3000, 100);
        addSwitch(behaviorGroup, settings, 'fullscreen-hide', _('Hide in Fullscreen'), _('Do not cover fullscreen applications'));
        behavior.add(behaviorGroup);

        const content = new Adw.PreferencesPage({title: _('Content'), icon_name: 'view-grid-symbolic'});
        const contentGroup = new Adw.PreferencesGroup({title: _('Displayed Items')});
        addSwitch(contentGroup, settings, 'show-running', _('Running Applications'), _('Show applications that are not in favorites'));
        addRunningAppsPosition(contentGroup, settings);
        addSwitch(contentGroup, settings, 'show-trash', _('Trash'), _('Show the Trash button'));
        addSwitch(contentGroup, settings, 'show-apps-button', _('Show Applications'), _('Show the applications grid button'));
        content.add(contentGroup);

        const panel = new Adw.PreferencesPage({
            title: _('Top Panel'),
            icon_name: 'view-more-symbolic',
        });
        const topBarGroup = new Adw.PreferencesGroup({title: _('Top Panel')});
        addSpin(topBarGroup, settings, 'panel-height', _('Size'),
            _('Panel height in pixels'), 24, 64, 1);
        addSwitch(topBarGroup, settings, 'floating-panel', _('Floating Panel'),
            _('Detach the panel from the edges, with rounded corners and Lyra colors'));
        addSpin(topBarGroup, settings, 'panel-margin', _('Panel Margin'),
            _('Distance between the floating panel and screen edges, in pixels'), 0, 32, 1);
        addSwitch(topBarGroup, settings, 'show-clock', _('Clock'),
            _('Show date and time in the center of the panel'));
        addSwitch(topBarGroup, settings, 'show-panel-indicators', _('Right-side Items'),
            _('Show native GNOME indicators'));
        panel.add(topBarGroup);

        const panelGroup = new Adw.PreferencesGroup({title: _('Panel Menus')});
        addSwitch(panelGroup, settings, 'show-applications-menu', _('Applications Menu'),
            _('Show installed applications organized by category'));
        addSwitch(panelGroup, settings, 'show-places-menu', _('Places Menu'),
            _('Show personal folders, bookmarks, and devices'));
        addSwitch(panelGroup, settings, 'show-system-menu', _('System Menu'),
            _('Show system links and system information'));
        addSwitch(panelGroup, settings, 'show-search-menu', _('Search Menu'),
            _('Show the application and settings search box'));
        addSwitch(panelGroup, settings, 'hide-workspace-button',
            _('Hide Workspaces Button'),
            _('Remove the native workspaces button from the top panel'));
        addPanelMenuPosition(panelGroup, settings);
        panel.add(panelGroup);

        const panelContentGroup = new Adw.PreferencesGroup({title: _('Menu Content')});
        addSwitch(panelContentGroup, settings, 'show-application-icons',
            _('Application Icons'), _('Show an icon next to each application name'));
        addSwitch(panelContentGroup, settings, 'sort-applications-menu',
            _('Alphabetical Order'), _('Sort categories and applications alphabetically'));
        addSwitch(panelContentGroup, settings, 'open-application-submenus-sideways',
            _('Side Submenus'), _('Open application categories beside the main menu'));
        addSwitch(panelContentGroup, settings, 'show-place-bookmarks',
            _('Bookmarks in Places'), _('Include bookmarks configured in the file manager'));
        addSwitch(panelContentGroup, settings, 'show-place-volumes',
            _('Devices in Places'), _('Include mounted volumes and remote locations'));
        addSwitch(panelContentGroup, settings, 'show-system-about',
            _('About Item in System'), _('Show the installed system information shortcut'));
        panel.add(panelContentGroup);

        const about = new Adw.PreferencesPage({
            name: 'about', title: _('About'), icon_name: 'help-about-symbolic',
        });
        const aboutGroup = new Adw.PreferencesGroup({title: 'Sheliak'});
        const aboutRow = new Adw.ActionRow({title: _('About Sheliak'), subtitle: _('Website, issue reporting, credits, and legal information'), activatable: true});
        aboutRow.connect('activated', () => showAboutDialog(window,
            String(this.metadata['version-name'] ?? this.metadata.version)));
        aboutGroup.add(aboutRow);
        about.add(aboutGroup);

        window.add(appearance);
        window.add(behavior);
        window.add(content);
        window.add(panel);
        window.add(about);
    }
}

function showAboutDialog(window: Adw.PreferencesWindow, version: string): void {
    const dialog = new Adw.AboutDialog({
        application_name: 'Sheliak',
        application_icon: 'folder-download-symbolic',
        developer_name: 'Lyra OS',
        version,
        website: 'https://github.com/lyra-os-linux/lyraos-desktop-sheliak',
        issue_url: 'https://github.com/lyra-os-linux/lyraos-desktop-sheliak/issues',
        license_type: Gtk.License.GPL_3_0,
        comments: _('Native Lyra OS dock for GNOME Shell.'),
        copyright: '© 2026 Lyra OS',
    });
    dialog.set_developers(['Rodrigo Brito']);
    dialog.present(window);
}
