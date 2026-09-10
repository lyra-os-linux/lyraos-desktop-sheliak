import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const appId = 'org.lyraos.KeyboardProbe.desktop';

export default class KeyboardTest extends Extension {
    enable() {
        this.checks = [];
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({
            status: !error && this.checks.every(c => c.passed) ? 'passed' : 'failed',
            checks: this.checks, events: this.events, error: error ? String(error) : null, stack: error?.stack,
        }, null, 2));
    }
    check(name, passed, detail = null) { this.checks.push({name, passed: !!passed, detail}); }
    icon() { return this.ext._dock._icons.find(icon => icon.appId === appId); }
    async key(symbol) {
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
        await wait(50);
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
        await wait(250);
    }
    async move(x, y) {
        this.pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        await wait(100);
    }
    async point(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        await this.move(x + width / 2, y + height / 2);
    }
    async button(button, state) {
        this.pointer.notify_button(GLib.get_monotonic_time(), button, state);
        await wait(100);
    }
    async run() {
        await wait(1800);
        Main.overview.hide();
        await wait(500);
        this.ext = Main.extensionManager.lookup('sheliak@lyraos.com.br').stateObj;
        if (!this.ext?._dock) throw Error('Sheliak failed to load');
        const seat = global.stage.get_context().get_backend().get_default_seat();
        this.keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this.events = [];
        const eventId = global.stage.connect('captured-event', (_stage, event) => {
            if ([Clutter.EventType.KEY_PRESS, Clutter.EventType.KEY_RELEASE,
                Clutter.EventType.BUTTON_PRESS, Clutter.EventType.BUTTON_RELEASE].includes(event.type())) {
                const key = [Clutter.EventType.KEY_PRESS, Clutter.EventType.KEY_RELEASE].includes(event.type());
                this.events.push({type: event.type(), symbol: key ? event.get_key_symbol() : null,
                    button: key ? null : event.get_button(), focus: global.stage.get_key_focus()?.toString(),
                    source: global.stage.get_event_actor(event)?.toString()});
            }
            return Clutter.EVENT_PROPAGATE;
        });
        await this.key(Clutter.KEY_Shift_L);
        const control = new St.Button({label: 'Control', can_focus: true, x: 50, y: 80});
        Main.uiGroup.add_child(control);
        let controlClicks = 0;
        control.connect('clicked', () => controlClicks++);
        control.grab_key_focus();
        await this.key(Clutter.KEY_Return);
        await this.key(Clutter.KEY_space);
        this.check('native St.Button control Enter and Space', controlClicks === 2, controlClicks);
        control.destroy();
        await this.move(600, 300);
        const dock = this.ext._dock;
        const prototype = Object.getPrototypeOf(this.icon());
        const activate = prototype.activate;
        let activations = 0;
        prototype.activate = function () { activations++; return activate.call(this); };
        try {
            const group = Main.ctrlAltTabManager._items.find(item => item.root === dock.actor);
            this.check('dock registered in Ctrl+Alt+Tab', !!group);
            if (group) Main.ctrlAltTabManager.focusGroup(group, global.get_current_time());
            else this.icon().actor.grab_key_focus(); // baseline: inspect activation independently
            await wait(200);
            this.check('focus reaches first application', global.stage.get_key_focus() === this.icon().actor);
            this.check('visible keyboard focus styling', this.icon().actor.has_style_pseudo_class('focus'));
            for (const [name, symbol] of [['Enter', Clutter.KEY_Return], ['Space', Clutter.KEY_space], ['KP Enter', Clutter.KEY_KP_Enter]]) {
                this.icon().actor.grab_key_focus();
                const before = activations;
                await this.key(symbol);
                await wait(500);
                this.check(`${name} activates exactly once`, activations === before + 1, {before, after: activations});
            }
            this.check('real application opened two windows', this.icon().app.get_windows().length === 2);
            // The baseline cannot launch via keyboard; mouse still permits the
            // rest of the test to inspect native pointer and DND behavior.
            const beforeClick = activations;
            await this.point(this.icon().actor);
            await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await wait(600);
            this.check('primary click activates exactly once', activations === beforeClick + 1);
            const windows = this.icon().app.get_windows();
            this.icon().actor.grab_key_focus();
            await this.key(Clutter.KEY_Tab);
            this.check('Tab moves between dock buttons', dock.actor.contains(global.stage.get_key_focus()) &&
                global.stage.get_key_focus() !== this.icon().actor);
            this.icon().actor.grab_key_focus();
            const beforeCancel = activations;
            this.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_space, Clutter.KeyState.PRESSED);
            await wait(80);
            dock.launcher.grab_key_focus();
            this.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_space, Clutter.KeyState.RELEASED);
            await wait(200);
            this.check('losing focus cancels a held key', activations === beforeCancel);
            await this.point(this.icon().actor);
            const beforeMenu = activations;
            await this.button(Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
            await this.button(Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
            this.check('secondary click opens menu without launch', this.icon().menu.menu.isOpen && activations === beforeMenu);
            this.icon().menu.close();
            await wait(200);
            for (const shift of [false, true]) {
                this.icon().actor.grab_key_focus();
                const before = activations;
                if (shift) {
                    this.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
                    await wait(50);
                }
                await this.key(shift ? Clutter.KEY_F10 : Clutter.KEY_Menu);
                if (shift) this.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
                this.check(`${shift ? 'Shift+F10' : 'Menu'} opens context menu`,
                    this.icon().menu.menu.isOpen && activations === before);
                await this.key(Clutter.KEY_Escape);
                this.check('Escape closes context menu', !this.icon().menu.menu.isOpen);
            }
            // Accessibility is invoked by a separate AT-SPI client, not emit().
            this.icon().actor.grab_key_focus();
            const beforeAT = activations;
            const child = Gio.Subprocess.new(['/usr/bin/python3', GLib.getenv('SHELIAK_A11Y_DRIVER')], Gio.SubprocessFlags.NONE);
            const resultPath = `${GLib.getenv('XDG_RUNTIME_DIR')}/a11y-result.json`;
            for (let i = 0; i < 180 && !GLib.file_test(resultPath, GLib.FileTest.EXISTS); i++) await wait(100);
            if (!GLib.file_test(resultPath, GLib.FileTest.EXISTS)) { child.force_exit(); throw Error('AT-SPI driver timed out'); }
            const result = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(resultPath)[1]));
            await wait(300);
            this.check('exported AT-SPI action activates exactly once', result.status === 'passed' && activations === beforeAT + 1, result);
            if (windows.length === 2) {
                Main.activateWindow(windows[0], global.get_current_time()); await wait(200);
                this.icon().actor.grab_key_focus();
                await this.key(Clutter.KEY_Return);
                this.check('keyboard cycles to the other running window', global.display.focus_window === windows[1]);
            }
            global.stage.set_key_focus(null);
            await this.point(this.icon().actor);
            const beforeDrag = activations;
            await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            await this.move(600, 420);
            this.check('native favorite drag begins', this.icon().actor.has_style_class_name('dragging'));
            await this.key(Clutter.KEY_Escape);
            await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await wait(600);
            this.check('cancelled drag does not launch', activations === beforeDrag && !this.icon().actor.has_style_class_name('dragging'));
            // Dropping one favorite across its sibling exercises real DND and
            // the asynchronous favorites rebuild rather than calling acceptDrop.
            await this.point(this.icon().actor);
            await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            await this.move(600, 420);
            const sibling = dock._icons.find(icon => icon.appId !== appId);
            const [sx, sy] = sibling.actor.get_transformed_position();
            await this.move(sx + sibling.actor.width - 2, sy + sibling.actor.height / 2);
            await wait(250);
            await this.button(Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await wait(700);
            this.check('favorite drop reorders without launch', dock._favorites.getFavorites()[1]?.get_id() === appId && activations === beforeDrag,
                {favorites: dock._favorites.getFavorites().map(a => a.get_id()), activations, beforeDrag});
            this.ext._settings.set_string('hide-mode', 'autohide');
            await this.move(600, 300);
            global.stage.set_key_focus(null);
            await wait(700);
            this.check('autohide hides unfocused dock', dock._hidden);
            this.icon().actor.grab_key_focus();
            await wait(700);
            this.check('keyboard focus reveals and holds autohide dock', !dock._hidden);
            global.stage.set_key_focus(null);
            await wait(700);
            this.check('autohide resumes after focus leaves', dock._hidden);
            for (const profile of ['ubuntu', 'windows10', 'windows11', 'lyra']) {
                this.ext._settings.set_string('desktop-profile', profile);
                await wait(350);
                const currentDock = this.ext._dock;
                const item = Main.ctrlAltTabManager._items.find(item => item.root === currentDock.actor);
                if (item) Main.ctrlAltTabManager.focusGroup(item, global.get_current_time());
                await wait(200);
                this.check(`${profile} profile has reachable dock focus`,
                    !!item && currentDock.actor.contains(global.stage.get_key_focus()));
            }
            this.ext.disable();
            this.check('disable removes dock focus group', !Main.ctrlAltTabManager._items.some(item => item.root === dock.actor));
        } finally { prototype.activate = activate; global.stage.disconnect(eventId); }
    }
}
