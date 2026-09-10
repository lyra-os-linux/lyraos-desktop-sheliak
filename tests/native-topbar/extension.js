import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const rect = actor => {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return {x, y, width, height};
};
const intersects = (a, b) => a.x < b.x+b.width-1 && b.x < a.x+a.width-1 &&
    a.y < b.y+b.height-1 && b.y < a.y+a.height-1;

export default class TopbarTest extends Extension {
    enable() {
        this.checks = [];
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    check(name, passed, detail = null) { this.checks.push({name, passed: !!passed, detail}); }
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({
            status: !error && this.checks.every(c => c.passed) ? 'passed' : 'failed',
            checks: this.checks, error: error ? String(error) : null, stack: error?.stack,
            language: GLib.getenv('LANGUAGE'), scale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
            monitor: Main.layoutManager.primaryMonitor,
        }, null, 2));
    }
    async key(symbol, delay = 180) {
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
        await wait(30);
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
        await wait(delay);
    }
    async capture(name) {
        const screenshot = new Shell.Screenshot();
        const path = GLib.build_filenamev([GLib.path_get_dirname(GLib.getenv('SHELIAK_NATIVE_RESULT')), name+'.png']);
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await screenshot.screenshot(false, stream);
        stream.close(null);
    }
    sample(name) {
        const date = Main.panel.statusArea.dateMenu;
        const quick = Main.panel.statusArea.quickSettings;
        const elements = [];
        // Test painted leaf content: a constrained container alone can hide overflow.
        const visit = actor => {
            if (!actor.visible || !actor.mapped) return;
            if (actor instanceof St.Label || actor instanceof St.Icon || actor instanceof St.Entry)
                elements.push({name: actor.toString(), ...rect(actor)});
            else for (const child of actor.get_children()) visit(child);
        };
        for (const id of ['sheliak-applications', 'sheliak-places', 'sheliak-system', 'sheliak-search']) {
            const button = Main.panel.statusArea[id];
            if (button) visit(button);
        }
        const bounds = rect(Main.panel);
        const collisions = elements.filter(a => intersects(a, rect(date)) || intersects(a, rect(quick)) ||
            a.x < bounds.x-1 || a.x+a.width > bounds.x+bounds.width+1);
        this.check(name, collisions.length === 0, {panel: bounds, date: rect(date), quick: rect(quick),
            elements, collisions, compact: this.ext._panelMenus?._compact});
    }
    async run() {
        await wait(2000);
        Main.overview.hide();
        await wait(600);
        this.ext = Main.extensionManager.lookup('sheliak@lyraos.com.br').stateObj;
        if (!this.ext?._panelMenus) throw Error('Sheliak did not load');
        const expected = {
            en_US: ['Applications', 'Search applications and files…'],
            pt_BR: ['Aplicativos', 'Buscar aplicativos e arquivos…'],
            es_ES: ['Aplicaciones', 'Buscar aplicaciones y archivos…'],
        }[GLib.getenv('LANGUAGE')];
        const actual = [this.ext._panelMenus._applications.button.get_first_child().get_last_child().text,
            this.ext._panelMenus._search._entry.hint_text];
        this.check('real catalog uses the requested language', JSON.stringify(actual) === JSON.stringify(expected),
            {expected, actual, locale: GLib.getenv('LC_ALL')});
        const seat = global.stage.get_context().get_backend().get_default_seat();
        this.keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        await this.key(Clutter.KEY_Shift_L);
        Main.messageTray._banner?.hide();
        this.sample('initial left allocation');
        await this.capture('left');
        for (const position of ['center', 'right', 'left']) {
            this.ext._settings.set_string('panel-menu-position', position);
            await wait(400);
            this.sample(position+' allocation');
        }
        const search = this.ext._panelMenus._search;
        search.button.grab_key_focus();
        await this.key(Clutter.KEY_Return);
        this.check('Enter focuses search', search._entry.contains(global.stage.get_key_focus()),
            {focus: String(global.stage.get_key_focus()), mapped: search._entry.mapped, open: search._resultsMenu.isOpen});
        for (const character of 'Lyra Topbar Probe') await this.key(character.charCodeAt(0), 25);
        await wait(300);
        this.check('search finds installed app', search._topResult?.name === 'Lyra Topbar Probe');
        await this.capture('search');
        await this.key(Clutter.KEY_Return);
        await wait(300);
        this.check('Enter launches real desktop entry', GLib.file_test(GLib.getenv('SHELIAK_LAUNCH_MARKER'), GLib.FileTest.EXISTS));
        const [x, y] = search.button.get_transformed_position();
        this.pointer.notify_absolute_motion(GLib.get_monotonic_time(), x+search.button.width/2, y+search.button.height/2);
        await wait(100);
        this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await wait(200);
        this.check('pointer focuses search', search._entry.contains(global.stage.get_key_focus()));
        search._entry.set_text('test');
        search._entry.emit('secondary-icon-clicked');
        this.check('clear keeps entry focused and usable', !search._entry.get_text() &&
            search._entry.contains(global.stage.get_key_focus()) && search._entry.mapped);
        search.button.grab_key_focus();
        await this.key(Clutter.KEY_space);
        await this.key(Clutter.KEY_Escape);
        this.check('Escape closes search and preserves focus', !search._resultsMenu.isOpen &&
            (global.stage.get_key_focus() === search.button || search.button.contains(global.stage.get_key_focus())));
        for (const field of ['_applications', '_places', '_system']) {
            const indicator = this.ext._panelMenus[field];
            indicator.button.grab_key_focus();
            await this.key(Clutter.KEY_space);
            this.check(field+' menu opens with keyboard', indicator.button.menu.isOpen);
            indicator.button.menu.close();
        }
        const width = Main.layoutManager.panelBox.width;
        if (width / St.ThemeContext.get_for_stage(global.stage).scale_factor >= 1920) {
            const entry = search._entry;
            entry.grab_key_focus();
            entry.set_text('Lyra');
            Main.layoutManager.panelBox.width = 800 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
            await wait(400);
            this.sample('resize to narrow');
            this.check('resize retains entry query and keyboard focus', search._entry === entry &&
                entry.get_text() === 'Lyra' && entry.contains(global.stage.get_key_focus()) && search._compact);
            Main.layoutManager.panelBox.width = width;
            await wait(400);
            this.sample('resize to wide');
            this.check('wide restores inline entry with focus', !search._compact && entry.contains(global.stage.get_key_focus()));
            await this.key(Clutter.KEY_Escape);
        }
        const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        interfaceSettings.set_double('text-scaling-factor', 1.25);
        await wait(450);
        this.sample('large text allocation');
        interfaceSettings.reset('text-scaling-factor');
        await wait(300);
        for (const profile of ['ubuntu', 'windows10', 'windows11', 'lyra']) {
            // Vega applies these saved preferences when selecting the profiles.
            for (const key of ['show-applications-menu', 'show-places-menu', 'show-system-menu', 'show-search-menu'])
                this.ext._settings.set_boolean(key, profile === 'lyra');
            this.ext._settings.set_string('desktop-profile', profile);
            this.ext._settings.set_boolean('extend-to-edges', profile === 'ubuntu');
            await wait(450);
            this.sample(profile+' profile allocation');
            if (profile === 'windows10') {
                const temporary = new PanelMenu.Button(0.5, 'Temporary status menu');
                temporary.add_child(new St.Icon({icon_name: 'dialog-information-symbolic'}));
                Main.panel.addToStatusArea('topbar-test-temporary', temporary);
                this.ext._windowsPanel._syncMenus();
                const arrow = temporary.menu._boxPointer;
                this.check('Windows tracks temporary menu orientation', this.ext._windowsPanel._arrows.has(arrow));
                temporary.destroy();
                this.check('Windows forgets destroyed menu orientation', !this.ext._windowsPanel._arrows.has(arrow));
            }
        }
        const menus = this.ext._panelMenus;
        this.ext.disable();
        this.check('disable removes layout source and indicators', !menus._layoutId &&
            !Object.keys(Main.panel.statusArea).some(key => key.startsWith('sheliak-')));
    }
}
