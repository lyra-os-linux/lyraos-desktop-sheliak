import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const ids = ['vega.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop', 'org.lyraos.PinProbe.desktop'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rect = actor => {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return {x, y, width, height};
};

export default class TilesTest extends Extension {
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
    check(name, passed, detail = null) { this.checks.push({name, passed: !!passed, detail}); }
    async key(symbol) {
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.PRESSED);
        await wait(30);
        this.keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, Clutter.KeyState.RELEASED);
        await wait(150);
    }
    start() { return this.ext._windowsPanel._start; }
    tile(id) {
        return this.start()._contextMenus.find(context => context._app.get_id() === id &&
            this.start()._pinned.contains(context.menu.sourceActor));
    }
    async size(id, size, mouse = false) {
        const context = this.tile(id);
        if (mouse) {
            const box = rect(context.menu.sourceActor);
            this.pointer.notify_absolute_motion(GLib.get_monotonic_time(), box.x + box.width / 2, box.y + box.height / 2);
            await wait(150);
            this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
            await wait(80);
            this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
            await wait(200);
        } else {
            context.menu.sourceActor.grab_key_focus();
            await this.key(Clutter.KEY_Menu);
        }
        const resize = context.menu._getMenuItems().find(item => item.label?.text === this.ext.gettext('Resize'));
        this.check(`${size}: context opens`, context.menu.isOpen && !!resize);
        resize.grab_key_focus(); await this.key(Clutter.KEY_Right);
        this.check(`${size}: resize submenu opens`, resize.menu.isOpen);
        const label = {small: 'Small', medium: 'Medium', wide: 'Wide', large: 'Large'}[size];
        const action = resize.menu._getMenuItems().find(item => item.label?.text === this.ext.gettext(label));
        action.grab_key_focus(); await this.key(Clutter.KEY_Return); await wait(250);
        this.check(`${size}: choice persisted`, this.settings.get_value('windows10-tile-sizes').deep_unpack()[id] === size);
        this.check(`${size}: Start stays open`, this.start().menu.isOpen);
        this.check(`${size}: style applied`, this.tile(id).menu.sourceActor.has_style_class_name(`tile-${size}`));
    }
    async capture(name) {
        const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.path_get_dirname(GLib.getenv('SHELIAK_NATIVE_RESULT')), name+'.png']));
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream); stream.close(null);
    }
    async profile(profile) {
        this.settings.set_string('desktop-profile', profile); await wait(300);
        this.start().menu.open(); await wait(250);
    }
    async run() {
        await wait(3500); Main.overview.hide(); await wait(300);
        this.ext = Main.extensionManager.lookup('sheliak@lyraos.com.br').stateObj;
        this.settings = this.ext._settings;
        const seat = Clutter.get_default_backend().get_default_seat();
        this.keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const globalBefore = global.settings.get_strv('favorite-apps');
        this.settings.set_strv('windows10-menu-apps', ids);
        this.settings.set_strv('windows11-menu-apps', ids);
        this.settings.set_string('position', 'bottom');
        this.settings.set_string('hide-mode', 'always');
        this.settings.set_boolean('extend-to-edges', true);
        for (const key of ['show-applications-menu', 'show-places-menu', 'show-system-menu', 'show-search-menu'])
            this.settings.set_boolean(key, false);
        await this.profile('windows10');
        const defaultRect = rect(this.tile(ids[0]).menu.sourceActor);
        for (const id of ids) this.check('existing card defaults to medium '+id,
            this.tile(id).menu.sourceActor.has_style_class_name('tile-medium'));
        await this.capture('windows10-default');
        const dimensions = {};
        for (const size of ['small', 'medium', 'wide', 'large']) {
            await this.size(ids[0], size, size === 'small');
            dimensions[size] = rect(this.tile(ids[0]).menu.sourceActor);
        }
        this.check('small < medium < large dimensions', dimensions.small.width < dimensions.medium.width &&
            dimensions.medium.width < dimensions.large.width && dimensions.medium.height < dimensions.large.height, dimensions);
        this.check('wide has medium height and large width', dimensions.wide.width === dimensions.large.width &&
            dimensions.wide.height === dimensions.medium.height, dimensions);
        this.check('medium retains original dimensions', dimensions.medium.width === defaultRect.width && dimensions.medium.height === defaultRect.height);
        await this.size(ids[1], 'small');
        await this.size(ids[2], 'wide');
        await this.size(ids[3], 'medium');
        const boxes = ids.map(id => rect(this.tile(id).menu.sourceActor));
        let overlap = false;
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            overlap ||= a.x < b.x+b.width-1 && b.x < a.x+a.width-1 && a.y < b.y+b.height-1 && b.y < a.y+a.height-1;
        }
        this.check('mixed tile sizes do not overlap', !overlap, boxes);
        const viewport = rect(this.start()._pinnedScroll);
        this.check('mixed cards fit horizontally inside their scroll area', boxes.every(box =>
            box.x >= viewport.x && box.x + box.width <= viewport.x + viewport.width + 1), {viewport, boxes});
        const allColumn = rect(this.start()._allColumn);
        this.check('application list retains usable width at this scale', allColumn.width >= 180 * St.ThemeContext.get_for_stage(global.stage).scale_factor, allColumn);
        await this.capture('windows10-mixed');
        const saved = this.settings.get_value('windows10-tile-sizes').deep_unpack();
        this.check('resizing keeps favorites and their order', same(this.settings.get_strv('windows10-menu-apps'), ids));
        this.check('resizing keeps taskbar defaults', same(this.ext._dock._icons.filter(icon => icon.favorite).map(icon => icon.appId), ids.slice(0, 3)));
        await this.profile('windows11');
        for (const id of ids) this.check('Windows 11 size unchanged '+id,
            !this.tile(id).menu.sourceActor.style_class.includes('tile-large') &&
            !this.tile(id).menu.sourceActor.style_class.includes('tile-small'));
        this.tile(ids[0]).menu.sourceActor.grab_key_focus(); await this.key(Clutter.KEY_Menu);
        this.check('Windows 11 has no resize action', !this.tile(ids[0]).menu._getMenuItems().some(item => item.label?.text === this.ext.gettext('Resize')));
        this.tile(ids[0]).close();
        await this.profile('windows10');
        this.check('sizes survive profile switch', same(this.settings.get_value('windows10-tile-sizes').deep_unpack(), saved));
        this.start().menu.close(); this.ext.disable(); await wait(200); this.ext.enable(); await wait(400);
        this.settings = this.ext._settings; this.start().menu.open(); await wait(200);
        this.check('sizes survive extension restart', this.tile(ids[0]).menu.sourceActor.has_style_class_name('tile-large'));
        this.check('GNOME favorites preserved', same(global.settings.get_strv('favorite-apps'), globalBefore));
        this.ext.disable();
        this.check('all menus release grabs', Main.modalCount === 0, Main.modalCount);
    }
}
