import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

async function module(entry, fixtures) {
    const {outputFiles} = await build({entryPoints: [entry], bundle: true, write: false,
        format: 'iife', globalName: 'Module', plugins: [{name: 'shell', setup(builder) {
            builder.onResolve({filter: /^(gi|resource):\/\//}, args => ({path: args.path, namespace: 'shell'}));
            builder.onLoad({filter: /.*/, namespace: 'shell'}, args => ({contents:
                args.path.startsWith('gi://') ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];` :
                    'export const {uiGroup, activateWindow, getAppFavorites, PopupMenu, PopupSeparatorMenuItem, gettext} = fixtures;'}));
        }}]});
    return runInNewContext(`${outputFiles[0].text}\nModule`, {fixtures});
}

class Signals {
    callbacks = new Map();
    connect(name, callback) { const id = Symbol(); this.callbacks.set(id, {name, callback}); return id; }
    disconnect(id) { this.callbacks.delete(id); }
    emit(name, ...args) {
        let result;
        for (const handler of [...this.callbacks.values()])
            if (handler.name === name) result = handler.callback(this, ...args);
        return result;
    }
    notify() {}
    notify_state_change() {}
}

test('accessible actions share clicked, reject invalid/disabled actions and cancel on destroy', async () => {
    const queued = new Map();
    const native = new Signals();
    class Button extends Signals {
        constructor(params) { super(); this._init(params); }
        _init(params) { Object.assign(this, {reactive: true, mapped: true}, params); }
        vfunc_get_accessible() { return native; }
        grab_key_focus() { this.focused = true; }
    }
    const {AppButton} = await module('src/appAccessible.ts', {
        St: {WidgetAccessible: Signals, Button},
        Atk: {Action: {}, Component: {}, NoOpObject: Signals, Role: {PUSH_BUTTON: 1}, StateType: {DEFUNCT: 1}},
        GObject: {registerClass: (_metadata, Class) => Class},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
            idle_add: (_priority, callback) => { const id = Symbol(); queued.set(id, callback); return id; },
            source_remove: id => queued.delete(id)},
        gettext: text => text,
    });
    const button = new AppButton({accessible_name: 'Example'});
    const accessible = button.vfunc_get_accessible();
    assert.equal(accessible.vfunc_get_name(), 'Example');
    assert.equal(accessible.vfunc_get_localized_name(0), 'Activate');
    assert.equal(accessible.vfunc_get_n_actions(), 1);
    assert.equal(accessible.vfunc_do_action(1), false);
    let clicks = 0;
    button.connect('clicked', (_button, number) => { assert.equal(number, 1); clicks++; });
    assert.equal(accessible.vfunc_do_action(0), true);
    assert.equal(clicks, 0, 'AT-SPI call must finish before mutating the actor tree');
    for (const [id, callback] of queued) { queued.delete(id); callback(); }
    assert.equal(clicks, 1);
    assert.equal(button.focused, true);
    button.reactive = false;
    assert.equal(accessible.vfunc_do_action(0), false);
    button.reactive = true;
    button.mapped = false;
    assert.equal(accessible.vfunc_do_action(0), false);
    button.mapped = true;
    assert.equal(accessible.vfunc_do_action(0), true);
    button.emit('destroy');
    assert.equal(queued.size, 0);
    assert.equal(native.callbacks.size, 0);
    assert.equal(accessible.vfunc_do_action(0), false);
    assert.equal(clicks, 1);
    assert.equal(accessible.vfunc_get_name(), '');
    assert.equal(button.vfunc_get_accessible(), accessible, 'late queries must not rebind a destroyed actor');
});

test('context menu reserves Menu/Shift+F10 and lets St.Button handle activation and navigation', async () => {
    const Clutter = {EVENT_PROPAGATE: false, EVENT_STOP: true,
        KEY_Menu: 10, KEY_F10: 11, KEY_Return: 12, KEY_space: 13, KEY_Up: 14,
        ModifierType: {MODIFIER_MASK: 255, MOD2_MASK: 16, SHIFT_MASK: 1}};
    class Popup extends Signals {
        constructor(source) {
            super();
            this.actor = {add_style_class_name() {}, hide() {}, navigate_focus: () => { this.focused = true; }};
            source.connect('key-press-event', this._onKeyPress.bind(this));
        }
        _onKeyPress(_source, event) {
            if ([Clutter.KEY_Return, Clutter.KEY_space].includes(event.get_key_symbol())) {
                this.toggle(); return true;
            }
            return false;
        }
        removeAll() {}
        toggle() { this.isOpen = !this.isOpen; }
    }
    const {AppContextMenu} = await module('src/contextMenu.ts', {Clutter, St: {Side: {BOTTOM: 0}, DirectionType: {TAB_FORWARD: 1}},
        Shell: {}, Meta: {}, PopupMenu: Popup, getAppFavorites: () => ({}), uiGroup: {add_child() {}}, gettext: text => text});
    const source = Object.assign(new Signals(), {reactive: true});
    const menu = new AppContextMenu(source, {can_open_new_window: () => false, get_id: () => null, get_windows: () => []});
    const key = (symbol, state = 0) => source.emit('key-press-event', {get_key_symbol: () => symbol, get_state: () => state});
    for (const symbol of [Clutter.KEY_Return, Clutter.KEY_space, Clutter.KEY_Up]) {
        assert.equal(key(symbol), false);
        assert.ok(!menu.menu.isOpen);
    }
    assert.equal(key(Clutter.KEY_Menu), true);
    assert.equal(menu.menu.isOpen, true);
    assert.equal(menu.menu.focused, true);
    assert.equal(key(Clutter.KEY_F10, 1), true);
    assert.equal(menu.menu.isOpen, false);
    assert.equal(key(Clutter.KEY_F10), false);
    assert.equal(key(Clutter.KEY_F10, 5), false);
    source.reactive = false;
    assert.equal(key(Clutter.KEY_Menu), false);
});
