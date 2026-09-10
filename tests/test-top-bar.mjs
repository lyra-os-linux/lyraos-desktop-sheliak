import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({
    entryPoints: ['src/topBar.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'TopBarModule',
    plugins: [{
        name: 'shell-fixture',
        setup(builder) {
            builder.onResolve({filter: /^(gi|resource):\/\//}, args =>
                ({path: args.path, namespace: 'shell-fixture'}));
            builder.onLoad({filter: /.*/, namespace: 'shell-fixture'}, args => ({
                contents: args.path.startsWith('gi://')
                    ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];`
                    : 'export const {panel, layoutManager} = fixtures.Main;',
            }));
        },
    }],
});

class Signals {
    callbacks = new Map();
    nextId = 1;
    connect(signal, callback) {
        const id = this.nextId++;
        this.callbacks.set(id, {signal, callback});
        return id;
    }
    disconnect(id) {
        this.callbacks.delete(id);
    }
    emit(signal) {
        for (const handler of [...this.callbacks.values()]) {
            if (handler.signal === signal)
                handler.callback(this);
        }
    }
}

const marginProperties = ['margin_top', 'margin_bottom', 'margin_left', 'margin_right'];
const margins = panel => marginProperties.map(key => panel[key]);

function fixture(mapped) {
    const panel = new Signals();
    panel.height = 24;
    panel.set_height = value => panel.height = value;
    panel.statusArea = {};
    panel._rightBox = Object.assign(new Signals(), {get_children: () => []});
    panel.mapped = mapped;
    panel.classes = new Set();
    // StWidget applies the theme's margins before emitting style-changed.
    // Class changes do this immediately only when the actor is mapped.
    panel.applyTheme = () => {
        for (const key of marginProperties)
            panel[key] = 0;
        panel.emit('style-changed');
    };
    panel.has_style_class_name = name => panel.classes.has(name);
    panel.add_style_class_name = name => {
        if (panel.classes.has(name))
            return;
        panel.classes.add(name);
        if (panel.mapped)
            panel.applyTheme();
    };
    panel.remove_style_class_name = name => {
        if (panel.classes.delete(name) && panel.mapped)
            panel.applyTheme();
    };
    marginProperties.forEach((key, i) => panel[key] = i + 2);

    const settings = new Signals();
    const values = {'panel-height': 32, 'panel-margin': 7, 'floating-panel': true, 'extend-to-edges': false};
    settings.get_uint = key => values[key];
    settings.get_string = key => values[key];
    settings.get_boolean = key => values[key] ?? true;
    settings.change = (key, value) => {
        values[key] = value;
        settings.emit(`changed::${key}`);
    };
    const workspace = {};
    const window = Object.assign(new Signals(), {
        minimized: false,
        maximized: 0,
        get_workspace: () => workspace,
        get_monitor: () => 0,
        showing_on_its_workspace: () => true,
        get_maximized() { return this.maximized; },
    });
    const shellGlobal = {
        display: new Signals(),
        workspace_manager: Object.assign(new Signals(), {get_active_workspace: () => workspace}),
        get_window_actors: () => [{meta_window: window}],
    };
    const fixtures = {
        Clutter: {}, Gio: {}, St: {Widget: Signals}, Meta: {MaximizeFlags: {BOTH: 3}},
        Main: {panel, layoutManager: {primaryIndex: 0}},
    };
    const {TopBarManager} = runInNewContext(`${outputFiles[0].text}\nTopBarModule;`,
        {fixtures, global: shellGlobal, console: {debug() {}}});
    const manager = new TopBarManager(settings);
    return {panel, settings, window, manager, shellGlobal};
}

for (const mapped of [false, true]) {
    test(`saved panel margin survives startup (mapped=${mapped}) and theme changes`, () => {
        const {panel, manager} = fixture(mapped);
        assert.deepEqual(margins(panel), [7, 7, 7, 7]);
        panel.mapped = true;
        panel.applyTheme();
        assert.deepEqual(margins(panel), [7, 7, 7, 7]);
        panel.applyTheme();
        assert.deepEqual(margins(panel), [7, 7, 7, 7]);
        manager.destroy();
    });
}

test('updated margins survive restyling and maximized window transitions', () => {
    const {panel, settings, window, manager} = fixture(true);
    settings.change('panel-margin', 13);
    panel.applyTheme();
    assert.deepEqual(margins(panel), [13, 13, 13, 13]);
    window.maximized = 3;
    window.emit('notify::maximized-horizontally');
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    settings.change('panel-margin', 19);
    window.maximized = 0;
    window.emit('notify::maximized-vertically');
    assert.deepEqual(margins(panel), [19, 19, 19, 19]);
    assert.equal(panel.has_style_class_name('sheliak-panel-flush'), false);
    manager.destroy();
});

test('floating preference and margin limits remain effective after restyling', () => {
    const {panel, settings, manager} = fixture(true);
    settings.change('floating-panel', false);
    panel.applyTheme();
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    settings.change('floating-panel', true);
    assert.deepEqual(margins(panel), [7, 7, 7, 7]);
    settings.change('panel-margin', 100);
    panel.applyTheme();
    assert.deepEqual(margins(panel), [32, 32, 32, 32]);
    settings.change('panel-margin', 0);
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    manager.destroy();
});

test('disable restores prior geometry and disconnects all handlers', () => {
    const {panel, settings, window, manager, shellGlobal} = fixture(true);
    manager.destroy();
    assert.equal(panel.height, 24);
    assert.deepEqual(margins(panel), [2, 3, 4, 5]);
    assert.equal(panel.classes.size, 0);
    for (const source of [panel, panel._rightBox, settings, window,
        shellGlobal.display, shellGlobal.workspace_manager])
        assert.equal(source.callbacks.size, 0);
    panel.applyTheme();
    settings.change('panel-margin', 11);
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
});

test('extended dock keeps panel flush without windows and restores floating preference', () => {
    const {panel, settings, window, manager} = fixture(true);
    settings.change('extend-to-edges', true);
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    assert.equal(panel.has_style_class_name('sheliak-panel-flush'), true);
    settings.change('panel-margin', 15);
    panel.applyTheme();
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    settings.change('extend-to-edges', false);
    assert.deepEqual(margins(panel), [15, 15, 15, 15]);
    window.maximized = 3;
    window.emit('notify::maximized-horizontally');
    settings.change('extend-to-edges', true);
    settings.change('extend-to-edges', false);
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    window.maximized = 0;
    window.emit('notify::maximized-vertically');
    assert.deepEqual(margins(panel), [15, 15, 15, 15]);
    manager.destroy();
});

test('Windows panel height and flush edges restore the saved Lyra geometry', () => {
    const {panel, settings, manager} = fixture(true);
    const originalHeight = panel.height;
    settings.change('desktop-profile', 'windows10');
    assert.equal(panel.height, 48);
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    settings.change('desktop-profile', 'windows11');
    assert.equal(panel.height, 52);
    settings.change('panel-margin', 15);
    panel.applyTheme();
    assert.deepEqual(margins(panel), [0, 0, 0, 0]);
    settings.change('desktop-profile', 'lyra');
    assert.equal(panel.height, originalHeight);
    assert.deepEqual(margins(panel), [15, 15, 15, 15]);
    manager.destroy();
});
