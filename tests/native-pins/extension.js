import {suiteFixture} from './fixture.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaults = ['vega.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop'];
const seed = ['org.gnome.Nautilus.desktop', 'org.lyraos.PinProbe.desktop'];

export default class PinsTest extends Extension {
    enable() {
        this.checks = [];
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({
            status: !error && this.checks.every(c => c.passed) ? 'passed' : 'failed',
            checks: this.checks, error: error ? String(error) : null, stack: error?.stack,
            language: GLib.getenv('LANGUAGE'), scale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
        }, null, 2));
    }
    check(name, passed, detail = null) {
        this.checks.push({name, passed: !!passed, detail});
        console.log(`PinsTest: ${name}: ${passed}`);
    }
    async key(symbol) {
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
        await wait(30);
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
        await wait(150);
    }
    async move(x, y) {
        this.pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        await wait(180);
    }
    async point(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        await this.move(x + width / 2, y + height / 2);
    }
    async button(button, state) {
        this.pointer.notify_button(GLib.get_monotonic_time(), button, state);
        await wait(150);
    }
    async choose(context, label, mouse = false) {
        if (mouse) {
            await this.point(context.menu.sourceActor);
            await this.button(Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
            await this.button(Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
        } else {
            context.menu.sourceActor.grab_key_focus();
            await this.key(Clutter.KEY_Menu);
        }
        this.check(`${label}: native context opened`, context.menu.isOpen);
        const action = context.menu._getMenuItems().find(item => item.label?.text === this.ext.gettext(label));
        if (!action) throw Error(`Missing translated action ${label}`);
        action.grab_key_focus();
        await this.key(Clutter.KEY_Return);
        await wait(250);
        this.check(`${label}: context closed`, !context.menu.isOpen);
    }
    start() { return this.ext._windowsPanel._start; }
    panel() { return this.ext._dock._icons.filter(icon => icon.favorite).map(icon => icon.appId); }
    menuContext(id) {
        const menus = this.start()._contextMenus.filter(menu => menu._app.get_id() === id);
        return menus.find(menu => this.start()._pinned.contains(menu.menu.sourceActor)) ?? menus[0];
    }
    panelContext(id) { return this.ext._dock._icons.find(icon => icon.appId === id).menu; }
    ids(profile, surface) { return this.settings.get_strv(`${profile}-${surface}-apps`); }
    async profile(profile) {
        this.settings.set_string('desktop-profile', profile);
        await wait(350);
        this.start()?.menu.open();
        await wait(200);
    }
    async capture(name) {
        const path = GLib.build_filenamev([GLib.path_get_dirname(GLib.getenv('SHELIAK_NATIVE_RESULT')), name+'.png']);
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }
    async run() {
        await wait(3500); Main.overview.hide(); await wait(300);
        this.ext = suiteFixture();
        this.settings = this.ext._settings;
        const seat = Clutter.get_default_backend().get_default_seat();
        this.keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this.settings.set_string('position', 'bottom');
        this.settings.set_string('hide-mode', 'always');
        this.settings.set_uint('icon-size', 32);
        this.settings.set_boolean('extend-to-edges', true);
        for (const key of ['show-applications-menu', 'show-places-menu', 'show-system-menu', 'show-search-menu'])
            this.settings.set_boolean(key, false);
        const baselineModal = Main.modalCount;
        for (const profile of ['windows10', 'windows11']) {
            await this.profile(profile);
            this.check(`${profile}: three default taskbar pins`, same(this.panel(), defaults), this.panel());
            this.check(`${profile}: menu preserves current favorites`, same(this.ids(profile, 'menu'), seed));
            this.check(`${profile}: cards reflect menu list`, this.start()._pinned.get_n_children() === seed.length);
            await this.capture(profile);
        }
        await this.profile('windows10');
        await this.choose(this.menuContext(seed[1]), 'Unpin from Start', true);
        this.check('Start action leaves parent menu open', this.start().menu.isOpen);
        this.check('removing a card leaves taskbar untouched', same(this.panel(), defaults));
        this.check('removed card remains in applications list', !!this.menuContext(seed[1]));
        this.check('Windows 11 menu remains independent', same(this.ids('windows11', 'menu'), seed));
        this.start().entry.set_text(seed[1]); await wait(150);
        await this.choose(this.menuContext(seed[1]), 'Pin to Taskbar');
        this.check('application can be added from Start to taskbar', same(this.panel(), [...defaults, seed[1]]), this.panel());
        this.check('taskbar pin does not recreate Start card', same(this.ids('windows10', 'menu'), [seed[0]]));
        this.start().menu.close(); await wait(250);
        await this.choose(this.panelContext(seed[1]), 'Move Earlier');
        this.check('keyboard reorders taskbar', same(this.panel(), [defaults[0], defaults[1], seed[1], defaults[2]]), this.panel());
        await this.choose(this.panelContext(seed[1]), 'Unpin from Taskbar', true);
        this.check('taskbar item can be removed', same(this.panel(), defaults));

        // Real pointer DND from first pin to after the last one.
        const first = this.ext._dock._icons[0];
        await this.point(first.actor);
        await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await this.move(600, 450);
        const last = this.ext._dock._icons[2].actor;
        const [x, y] = last.get_transformed_position();
        await this.move(x + last.width - 1, y + last.height / 2);
        await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await wait(500);
        this.check('drag reorders taskbar', same(this.panel(), [defaults[1], defaults[2], defaults[0]]), this.panel());
        this.check('drag leaves Start favorites unchanged', same(this.ids('windows10', 'menu'), [seed[0]]));
        const win10Panel = this.ids('windows10', 'panel');

        await this.profile('windows11');
        this.check('Windows 11 taskbar unaffected', same(this.panel(), defaults));
        for (const id of seed) await this.choose(this.menuContext(id), 'Unpin from Start');
        this.check('removing last card stays empty', this.ids('windows11', 'menu').length === 0);
        this.check('empty Start shows translated explanation', this.start()._pinned.get_first_child().text === this.ext.gettext('No pinned applications'));
        this.start()._allToggle.grab_key_focus(); await this.key(Clutter.KEY_Return);
        this.start().entry.set_text(seed[1]); await wait(150);
        await this.choose(this.menuContext(seed[1]), 'Pin to Start');
        this.start().entry.set_text(''); await wait(150);
        this.check('empty menu can be repopulated from all applications', same(this.ids('windows11', 'menu'), [seed[1]]));
        this.start()._allToggle.grab_key_focus(); await this.key(Clutter.KEY_Return);
        await this.choose(this.menuContext(seed[1]), 'Unpin from Start');
        this.start().menu.close(); await wait(150);
        for (const id of defaults) await this.choose(this.panelContext(id), 'Unpin from Taskbar');
        this.check('all taskbar pins may be removed', this.panel().length === 0);
        await this.profile('windows10');
        this.check('Windows 10 order restored', same(this.panel(), win10Panel));
        this.check('Windows 10 menu restored', same(this.ids('windows10', 'menu'), [seed[0]]));
        for (const profile of ['lyra', 'ubuntu']) {
            await this.profile(profile);
            this.check(`${profile}: original GNOME favorites preserved`, same(this.panel(), seed));
        }
        this.check('global favorites never modified', same(global.settings.get_strv('favorite-apps'), seed));
        await this.profile('windows11');
        this.start().menu.close();
        await this.ext.disable(); await wait(250);
        this.check('disable releases modal grabs', Main.modalCount === baselineModal, {baselineModal, actual: Main.modalCount});
        await this.ext.enable(); await wait(400);
        this.settings = this.ext._settings;
        this.check('empty menu persists across extension restart', this.ids('windows11', 'menu').length === 0);
        this.check('empty panel persists across extension restart', this.panel().length === 0);
        // An unavailable application remains stored and does not break rendering.
        this.settings.set_strv('windows11-menu-apps', ['missing-test.desktop', seed[1]]);
        this.start().menu.open(); await wait(200);
        this.check('unavailable pin is retained without broken card', this.ids('windows11', 'menu')[0] === 'missing-test.desktop' && this.start()._pinned.get_n_children() === 1);
        const many = this.start()._allApps.slice(0, 25).map(app => app.get_id());
        this.settings.set_strv('windows11-menu-apps', many); await wait(200);
        this.check('all favorites are rendered beyond the previous 18-card limit', many.length > 18 && this.start()._pinned.get_n_children() === many.length);
        const lastCard = this.menuContext(many.at(-1)).menu.sourceActor;
        lastCard.grab_key_focus(); await wait(400);
        this.check('keyboard scrolls the last card into view', this.start()._pinnedScroll.vadjustment.value > 0);
        await this.choose(this.menuContext(many.at(-1)), 'Unpin from Start');
        this.check('a favorite beyond the first page can be removed', !this.ids('windows11', 'menu').includes(many.at(-1)));
        await this.ext.disable();
    }
}
