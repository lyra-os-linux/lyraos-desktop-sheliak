import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

// Build the real AppIcon (with the real SignalTracker) against Shell fixtures
// and a recording AppContextMenu. The menu must not exist until it is asked
// for, must be reused afterwards, and must be closed and destroyed exactly
// once with the icon (see docs/dock-menu-lifecycle.md).
const {outputFiles} = await build({entryPoints: ['src/appIcon.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'AppIconModule', plugins: [{name: 'icon-fixture', setup(builder) {
        builder.onResolve({filter: /^(gi|resource):\/\/|^\.\//}, args =>
            args.kind === 'entry-point' || args.path === './signals.js'
                ? null : ({path: args.path, namespace: 'fixture'}));
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => {
            if (args.path.startsWith('gi://'))
                return {contents: `export default fixtures[${JSON.stringify(args.path.slice(5))}];`};
            if (args.path.endsWith('/dnd.js'))
                return {contents: 'export const makeDraggable = fixtures.makeDraggable;'};
            if (args.path.endsWith('/main.js'))
                return {contents: 'export const activateWindow = () => {};'};
            if (args.path === './contextMenu.js')
                return {contents: 'export const AppContextMenu = fixtures.AppContextMenu;'};
            if (args.path === './appAccessible.js')
                return {contents: 'export const AppButton = fixtures.AppButton;'};
            return {contents: 'export default {}; export const TooltipManager = {};'};
        });
    }}]});

const KEY_MENU = 0xff67;
const KEY_F10 = 0xffc7;
const SHIFT = 1;

function fixture() {
    class GObjectBase {
        live = new Map();
        serial = 0;
        connect(signal, callback) { const id = ++this.serial; this.live.set(id, {signal, callback}); return id; }
        disconnect(id) {
            if (!this.live.has(id))
                throw new Error('GLib would abort: disconnecting a handler that is not connected');
            this.live.delete(id);
        }
        emit(signal, ...args) {
            let result;
            for (const [, handler] of [...this.live]) {
                if (handler.signal === signal)
                    result = handler.callback(this, ...args);
            }
            return result;
        }
        handlers(signal) { return [...this.live.values()].filter(handler => handler.signal === signal).length; }
    }
    class Actor extends GObjectBase {
        children = [];
        classes = new Set();
        reactive = true;
        destroyed = false;
        constructor(props = {}) { super(); Object.assign(this, props); }
        add_child(child) { this.children.push(child); }
        set_child(child) { this.children = [child]; }
        add_style_class_name(name) { this.classes.add(name); }
        remove_style_class_name(name) { this.classes.delete(name); }
        get_stage() { return null; }
        destroy() { this.destroyed = true; this.live.clear(); }
    }
    class Label extends Actor {}
    const menus = [];
    const events = [];
    class JsEmitter {
        handlers = new Map();
        serial = 0;
        connect(signal, callback) { const id = ++this.serial; this.handlers.set(id, {signal, callback}); return id; }
        disconnect(id) { this.handlers.delete(id); }
        emit(signal, ...args) {
            for (const [, handler] of [...this.handlers]) {
                if (handler.signal === signal)
                    handler.callback(this, ...args);
            }
        }
    }
    class AppContextMenu {
        constructor(source, application, windows) {
            Object.assign(this, {source, app: application, windows, toggles: 0, closes: 0, destroyed: false});
            const owner = this;
            this.menu = Object.assign(new JsEmitter(), {
                isOpen: false,
                actor: {focused: 0, navigate_focus() { this.focused++; }},
                get owner() { return owner; },
            });
            menus.push(this);
            events.push('create');
        }
        toggle() {
            this.toggles++;
            this.menu.isOpen = !this.menu.isOpen;
            this.menu.emit('open-state-changed', this.menu.isOpen);
        }
        close() {
            this.closes++;
            if (!this.menu.isOpen) return;
            this.menu.isOpen = false;
            this.menu.emit('open-state-changed', false);
        }
        destroy() {
            assert.equal(this.destroyed, false, 'menu destroyed twice');
            this.destroyed = true;
            events.push('destroy');
        }
    }
    const fixtures = {
        Clutter: {
            BinLayout: class {}, ActorAlign: {CENTER: 0, END: 1, START: 2}, Orientation: {VERTICAL: 1},
            BUTTON_PRIMARY: 1, BUTTON_SECONDARY: 3, EVENT_STOP: true, EVENT_PROPAGATE: false,
            KEY_Menu: KEY_MENU, KEY_F10: KEY_F10,
            ModifierType: {MODIFIER_MASK: 0x1fff, MOD2_MASK: 16, SHIFT_MASK: SHIFT},
        },
        St: {Widget: Actor, Label, BoxLayout: Actor, Button: Actor, DirectionType: {TAB_FORWARD: 0}},
        Shell: {AppState: {STOPPED: 0}},
        Mtk: {Rectangle: class {}},
        GObject: {Object: GObjectBase, signal_handler_is_connected: (object, id) => object.live.has(id)},
        makeDraggable: () => new JsEmitter(),
        AppButton: Actor,
        AppContextMenu,
    };
    const {AppIcon} = runInNewContext(`${outputFiles[0].text}\nAppIconModule`,
        {fixtures, console: {...console, error(message) { events.push(`error ${message}`); }}});
    // Shell.App is a GObject emitter: AppIcon tracks its windows-changed signal.
    const application = Object.assign(new GObjectBase(), {
        get_id: () => 'app.desktop', get_name: () => 'App', get_state: () => 0, get_windows: () => [],
        create_icon_texture: () => new Actor(), activate() { events.push('activate'); },
    });
    const manager = {menus: [], addMenu(menu) { this.menus.push(menu); }};
    const states = [];
    const windows = {panel: {}, menu: {}};
    const icon = new AppIcon(application, manager, true, open => states.push(open), 40, undefined, undefined, windows);
    const release = button => icon.actor.emit('button-release-event', {get_button: () => button});
    const key = (symbol, state = 0) => icon.actor.emit('key-press-event', {get_key_symbol: () => symbol, get_state: () => state});
    return {icon, menus, events, manager, states, application, windows, release, key};
}

test('constructing an icon creates no context menu', () => {
    const {icon, menus, manager} = fixture();
    assert.equal(icon.menu, null);
    assert.deepEqual(menus, []);
    assert.deepEqual(manager.menus, []);
});

test('the first right click creates the menu once and later clicks reuse it', () => {
    const {icon, menus, manager, states, application, windows, release} = fixture();
    assert.equal(release(3), true);
    assert.equal(menus.length, 1);
    const [menu] = menus;
    assert.equal(icon.menu, menu);
    assert.equal(menu.source, icon.actor);
    assert.equal(menu.app, application);
    assert.equal(menu.windows, windows);
    assert.deepEqual(manager.menus, [menu.menu]);
    assert.equal(menu.toggles, 1);
    assert.deepEqual(states, [true]);

    assert.equal(release(3), true);
    assert.equal(menus.length, 1);
    assert.equal(menu.toggles, 2);
    assert.deepEqual(states, [true, false]);
    assert.deepEqual(manager.menus, [menu.menu]);
});

test('a primary release never creates a menu', () => {
    const {icon, menus, release} = fixture();
    assert.equal(release(1), false);
    assert.equal(icon.menu, null);
    assert.deepEqual(menus, []);
});

test('the Menu key and Shift+F10 open the menu before it exists, then defer to the menu', () => {
    const {icon, menus, key} = fixture();
    assert.equal(key(KEY_MENU), true);
    assert.equal(menus.length, 1);
    assert.equal(menus[0].toggles, 1);
    assert.equal(menus[0].menu.actor.focused, 1);

    // The PopupMenu now owns the Menu key through its own source handler.
    assert.equal(key(KEY_MENU), false);
    assert.equal(menus.length, 1);
    assert.equal(menus[0].toggles, 1);

    const other = fixture();
    assert.equal(other.key(KEY_F10, SHIFT), true);
    assert.equal(other.menus.length, 1);
    assert.equal(other.key(KEY_F10), false);
    assert.equal(other.key(KEY_MENU, SHIFT), false);
    assert.equal(other.menus.length, 1);
});

test('other keys and an unreactive button leave the menu alone', () => {
    const {icon, menus, key} = fixture();
    assert.equal(key(0x20), false);
    icon.actor.reactive = false;
    assert.equal(key(KEY_MENU), false);
    assert.equal(icon.menu, null);
    assert.deepEqual(menus, []);
});

test('activation works without a menu and closes an open one', () => {
    const {icon, menus, events, states, release} = fixture();
    icon.activate();
    assert.deepEqual(events, ['activate']);
    release(3);
    icon.activate();
    assert.equal(menus[0].closes, 1);
    assert.deepEqual(states, [true, false]);
});

test('destroy closes and destroys the menu once and forgets it', () => {
    const {icon, menus, events, states, release} = fixture();
    release(3);
    const [menu] = menus;
    icon.destroy();
    assert.equal(menu.closes, 1);
    assert.equal(menu.destroyed, true);
    assert.equal(icon.menu, null);
    assert.equal(icon.actor.destroyed, true);
    assert.deepEqual(states, [true, false]);
    assert.deepEqual(events.filter(event => event.startsWith('error')), []);
    icon.destroy();
    assert.equal(menu.closes, 1);
});

test('an icon destroyed before any menu request destroys nothing but itself', () => {
    const {icon, events} = fixture();
    icon.destroy();
    assert.equal(icon.actor.destroyed, true);
    assert.deepEqual(events, []);
});
