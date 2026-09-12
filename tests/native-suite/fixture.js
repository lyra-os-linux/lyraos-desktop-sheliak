// Test-only adapter: retain the existing behavioral assertions while locating
// actors in their new owning extensions. This is never part of the RPM.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const roles = ['dock', 'panel', 'menus', 'search', 'animations'];
const lookup = role => Main.extensionManager.lookup(`${role}@lyraos.com.br`)?.stateObj;
const wait = () => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));

export function suiteFixture() {
    if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private fixture only');
    const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
    const owned = roles.map(role => `${role}@lyraos.com.br`);
    let previous = owned;
    return {
        get _settings() { return lookup('dock').getSettings('org.gnome.shell.extensions.sheliak'); },
        get _dock() { return lookup('dock')?.lyraApi?.current?.dock; },
        get _windowsPanel() {
            const panel = lookup('panel')?.lyraApi?.current;
            return panel && new Proxy(panel, {get(target, key) {
                if (key === '_start') return lookup('menus')?._start;
                const value = target[key];
                return typeof value === 'function' ? value.bind(target) : value;
            }});
        },
        get _panelMenus() {
            const menus = lookup('menus')?._controller;
            const search = lookup('search')?._controller;
            return menus && new Proxy(menus, {get(target, key) {
                return key === '_search' ? search?._search : target[key];
            }});
        },
        gettext(text) { return lookup('menus').gettext(text); },
        async disable() {
            const enabled = shell.get_strv('enabled-extensions');
            previous = enabled.filter(id => owned.includes(id));
            shell.set_strv('enabled-extensions', enabled.filter(id => !owned.includes(id)));
            await wait();
        },
        async enable() {
            shell.set_strv('enabled-extensions', [...shell.get_strv('enabled-extensions').filter(id => !owned.includes(id)), ...previous]);
            await wait();
        },
    };
}
