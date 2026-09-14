import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({
    stdin: {contents: "export {PanelSurfaceTheme} from './src/panelSurfaceTheme.ts'; export {PanelMenuTheme} from './src/panelMenuTheme.ts';", resolveDir: process.cwd()},
    bundle: true, write: false, format: 'iife', globalName: 'Themes',
    plugins: [{name: 'shell-fixture', setup(builder) {
        builder.onResolve({filter: /^(gi|resource):\/\//}, args => ({path: args.path, namespace: 'fixture'}));
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: args.path.startsWith('gi://')
            ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];`
            : 'export const {panel, uiGroup} = fixtures.Main;'}));
    }}],
});

class Widget {
    callbacks = new Map(); classes = new Set(); style = null; serial = 0;
    connect(name, callback) { const id = ++this.serial; this.callbacks.set(id, {name, callback}); return id; }
    disconnect(id) { this.callbacks.delete(id); }
    emit(name) { for (const entry of [...this.callbacks.values()]) if (entry.name === name) entry.callback(this); }
    has_style_class_name(name) { return this.classes.has(name); }
    add_style_class_name(name) { if (!this.classes.has(name)) { this.classes.add(name); this.emit('notify::style-class'); } }
    remove_style_class_name(name) { if (this.classes.delete(name)) this.emit('notify::style-class'); }
    get_style() { return this.style; }
    set_style(style) { this.style = style; this.emit('style-changed'); }
    get_theme_node() { return this; }
    get_parent() { return null; }
    get_element_type() { return Widget; }
    get_name() { return 'panel'; }
    get_style_class_name() { return [...this.classes].join(' '); }
    get_style_pseudo_class() { return ''; }
    get_background_color() { return {red: 0, green: 0, blue: 0, alpha: 255}; }
}

function fixture() {
    const panel = new Widget(), uiGroup = new Widget(), context = new Widget();
    const pending = new Map(), files = new Set(), stylesheets = new Set();
    const theme = {unload_stylesheet: file => stylesheets.delete(file)};
    context.get_theme = () => theme;
    const fixtures = {
        Main: {panel, uiGroup},
        St: {ThemeContext: {get_for_stage: () => context}, ThemeNode: {new: (...args) => {
            // Detect feeding our previous overlay back as native CSS.
            assert.equal(args.at(-1).includes('lyra-panel-surface'), false);
            return panel;
        }}},
        Gio: {File: {new_tmp: () => {
            const file = {delete: () => files.delete(file)}; files.add(file);
            return [file, {close() {}}];
        }}},
        GLib: {idle_add: (_priority, callback) => { const id = Symbol(); pending.set(id, callback); return id; },
            source_remove: id => pending.delete(id), PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false},
    };
    const errors = [];
    const classes = runInNewContext(`${outputFiles[0].text}\nThemes;`,
        {fixtures, global: {stage: {}}, console: {error: message => errors.push(message)}});
    const flush = () => {
        for (let count = 0; pending.size && count < 10; count++) {
            const entries = [...pending]; pending.clear();
            for (const [, callback] of entries) callback();
        }
        assert.equal(pending.size, 0, 'theme update loop');
        assert.deepEqual(errors, []);
    };
    return {panel, uiGroup, context, pending, files, stylesheets, flush, ...classes};
}

for (const base of [null, '', 'border-radius: 11px;']) {
    test(`surface restores exact initial style ${JSON.stringify(base)} and removes idle sources`, () => {
        const f = fixture(); f.panel.style = base;
        const surface = new f.PanelSurfaceTheme(); f.flush();
        assert.match(f.panel.style, /rgba\(28, 32, 37, 0.9\)/);
        f.context.emit('changed'); f.flush();
        surface.destroy(); surface.destroy();
        assert.equal(f.panel.style, base);
        assert.equal(f.pending.size, 0);
        assert.equal(f.panel.callbacks.size + f.context.callbacks.size, 0);
    });
}

for (const refresh of [false, true]) {
    test(`appended foreign CSS survives removal without stale background (refresh=${refresh})`, () => {
        const f = fixture(); f.panel.style = 'border-radius: 11px;';
        const surface = new f.PanelSurfaceTheme(); f.flush();
        f.panel.set_style(`${f.panel.style}; border-width: 3px;`);
        if (refresh) f.flush();
        surface.destroy();
        assert.equal(f.panel.style, 'border-radius: 11px;; border-width: 3px;');
        assert.equal(f.pending.size, 0);
    });
}

test('foreign style replacement remains intact on disable', () => {
    const f = fixture(); const surface = new f.PanelSurfaceTheme(); f.flush();
    f.panel.set_style('background-color: red;');
    surface.destroy();
    assert.equal(f.panel.style, 'background-color: red;');
});

for (const preexisting of [false, true]) {
    test(`menu class snapshot, resources and idempotent cleanup (preexisting=${preexisting})`, () => {
        const f = fixture();
        if (preexisting) f.uiGroup.add_style_class_name('sheliak-panel-colors');
        const menus = new f.PanelMenuTheme();
        f.uiGroup.add_style_class_name('foreign-menu');
        menus.destroy(); menus.destroy();
        assert.equal(f.uiGroup.has_style_class_name('sheliak-panel-colors'), preexisting);
        assert.equal(f.uiGroup.has_style_class_name('foreign-menu'), true);
        assert.equal(f.files.size + f.pending.size + f.panel.callbacks.size + f.context.callbacks.size + f.uiGroup.callbacks.size, 0);
    });
}

test('external menu class removal and reacquisition survives disable', () => {
    const f = fixture(); const menus = new f.PanelMenuTheme();
    f.uiGroup.remove_style_class_name('sheliak-panel-colors');
    f.uiGroup.add_style_class_name('sheliak-panel-colors');
    menus.destroy();
    assert.equal(f.uiGroup.has_style_class_name('sheliak-panel-colors'), true);
    assert.equal(f.files.size, 0);
});

for (const name of ['PanelMenuTheme', 'PanelSurfaceTheme']) {
    test(`${name}: failure after acquiring resources leaves no class, file or signal`, () => {
        const f = fixture();
        f.context.connect = () => { throw Error('injected context failure'); };
        assert.throws(() => new f[name](), /injected context failure/);
        assert.equal(f.panel.style, null);
        assert.equal(f.uiGroup.classes.size + f.files.size + f.pending.size + f.panel.callbacks.size + f.context.callbacks.size + f.uiGroup.callbacks.size, 0);
    });
}
