import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints: ['src/extensions/desktop-icons.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Desktop', plugins: [{name: 'desktop-fixture', setup(builder) {
        builder.onResolve({filter: /\/(emulateX11WindowType|visibleArea|gnomeShellOverride)\.js$/}, args => ({path: args.path, namespace: 'helper'}));
        builder.onLoad({filter: /.*/, namespace: 'helper'}, () => ({contents:
            'export const {EmulateX11WindowType, VisibleArea, GnomeShellOverride} = fixtures.helpers;'}));
        builder.onResolve({filter: /^(gi|resource):\/\//}, args => ({path: args.path, namespace: 'fixture'}));
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: args.path.startsWith('gi://')
            ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];`
            : args.path.endsWith('/extension.js') ? 'export const Extension = fixtures.Extension;'
                : 'export const {layoutManager, extensionManager, overview, panel, sessionMode, wm} = fixtures.Main;'}));
    }}]});

function fixture({failure = '', startup = false} = {}) {
    let next = 1;
    const callbacks = [], busOwners = new Set(), exports = new Set(), activeHelpers = new Set(), emitters = [], errors = [];
    const injected = Error(`injected ${failure}`);
    class Emitter {
        handlers = new Map();
        constructor() { emitters.push(this); }
        connect(signal, cb) {
            if (failure === 'action-connect' && this.name === 'doCut') throw injected;
            if (failure === 'startup-connect' && signal === 'startup-complete') throw injected;
            if (failure === 'workarea-connect' && signal === 'workareas-changed') throw injected;
            const id = next++; this.handlers.set(id, {signal, cb}); return id;
        }
        disconnect(id) { assert.ok(this.handlers.delete(id), `disconnect only an owned ID: ${id}`); }
    }
    class Helper {
        enable() { activeHelpers.add(this); }
        disable() { activeHelpers.delete(this); }
        setWaylandClient() {}
    }
    class Area extends Emitter {
        constructor() { super(); if (failure === 'area-constructor') throw injected; }
        setMarginsForExtension() {}
        disable() {}
    }
    class Action extends Emitter {
        constructor(params) { super(); Object.assign(this, params); }
        set_enabled() {}
        static new_stateful(name) { return new Action({name}); }
    }
    const connection = {
        export_action_group() { if (failure === 'export') throw injected; const id = next++; exports.add(id); return id; },
        unexport_action_group(id) { assert.ok(exports.delete(id)); },
    };
    const Main = {layoutManager: Object.assign(new Emitter(), {_startingUp: startup}),
        extensionManager: Object.assign(new Emitter(), {lookup() { return null; }, logExtensionError(uuid, error) { errors.push(error); }})};
    const fixtures = {Main, helpers: {EmulateX11WindowType: Helper, GnomeShellOverride: Helper, VisibleArea: Area},
        Extension: class {
            uuid = 'desktop-icons@lyraos.com.br';
            getSettings() { return new Emitter(); }
        },
        Clutter: {}, Shell: {}, Meta: {is_wayland_compositor: () => true},
        St: {Clipboard: {get_default: () => ({})}, ClipboardType: {CLIPBOARD: 1}}, GObject: {},
        GLib: {VariantType: class {}, source_remove() {}},
        Gio: {BusType: {SESSION: 1}, BusNameOwnerFlags: {NONE: 0}, SimpleAction: Action,
            SimpleActionGroup: class { add_action() {} },
            bus_own_name(type, name, flags, acquired, owned) {
                const id = next++; busOwners.add(id); callbacks.push(() => owned(connection, name)); return id;
            },
            bus_unown_name(id) { assert.ok(busOwners.delete(id)); },
        },
    };
    const Ctor = runInNewContext(`${outputFiles[0].text}\nDesktop.default;`, {fixtures,
        global: {window_manager: new Emitter(), display: new Emitter()},
        console: {warn() {}, error() {}}, Set});
    Ctor.prototype.doKillAllOldDesktopProcesses = () => {};
    Ctor.prototype.getDesktopGeometry = () => ({});
    let launches = 0;
    Ctor.prototype.launchDesktop = () => { launches++; };
    const desktop = new Ctor();
    return {desktop, callbacks, busOwners, exports, activeHelpers, errors, injected, Main,
        launches: () => launches,
        clean() {
            assert.equal(busOwners.size + exports.size + activeHelpers.size, 0);
            assert.equal(emitters.reduce((sum, emitter) => sum + emitter.handlers.size, 0), 0);
            assert.equal(desktop.data.isEnabled, false);
            assert.equal(desktop.DesktopIconsUsableArea, null);
        },
    };
}
for (const failure of ['area-constructor', 'startup-connect', 'workarea-connect']) {
    test(`desktop ${failure}: first activation keeps original error and releases partial helpers`, () => {
        const f = fixture({failure, startup: failure === 'startup-connect'});
        assert.throws(() => f.desktop.enable(), error => error === f.injected);
        f.clean(); f.desktop.disable(); f.clean();
    });
}
for (const failure of ['action-connect', 'export']) {
    test(`desktop asynchronous ${failure}: report original error and release signals, bus and helpers`, () => {
        const f = fixture({failure});
        f.desktop.enable(); f.callbacks[0]();
        assert.deepEqual(f.errors, [f.injected]);
        assert.equal(f.launches(), 0); f.clean();
        f.desktop.disable(); f.clean();
    });
}
test('desktop callback from a disabled generation cannot export a service or launch a helper', () => {
    const f = fixture();
    f.desktop.enable(); const stale = f.callbacks[0];
    f.desktop.disable(); f.clean();
    stale(); f.clean(); assert.equal(f.launches(), 0);
    f.desktop.enable(); stale(); assert.equal(f.exports.size, 0);
    f.callbacks[1](); assert.equal(f.exports.size, 1); assert.equal(f.launches(), 1);
    f.desktop.disable(); f.clean();
});
test('desktop normal enable/disable cycles release every action and discovery callback', () => {
    const f = fixture();
    for (let i = 0; i < 10; i++) {
        f.desktop.enable(); f.callbacks.at(-1)();
        assert.equal(f.exports.size, 1); assert.equal(f.busOwners.size, 1);
        f.desktop.disable(); f.clean();
    }
    assert.equal(f.launches(), 10);
});
