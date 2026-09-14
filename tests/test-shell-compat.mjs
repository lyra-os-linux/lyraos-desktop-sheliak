import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints: ['src/shellCompat.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Compat', plugins: [{
        name: 'shell-fixture', setup(builder) {
            builder.onResolve({filter: /^(gi|resource):\/\//}, args => ({path: args.path, namespace: 'fixture'}));
            builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents:
                args.path.startsWith('gi://') ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];`
                    : 'export const {panel, layoutManager, overview, sessionMode, extensionManager} = fixtures.Main;'}));
        },
    }]});

function fixture() {
    const calls = [], warnings = [], handlers = new Map();
    const actor = () => ({get_children() { return []; }, connect() { return 1; }, disconnect() {},
        get_preferred_width() { return [0, 20]; }, add_child() {}, remove_child() {}, contains() { return true; }});
    const panelBox = {...actor(), visible: true, show() { this.visible = true; }, set_position() {}, set_width() {}};
    const original = () => calls.push('original-barrier');
    const params = {actor: panelBox, affectsInputRegion: true, affectsStruts: true, trackFullscreen: true};
    const layout = {_startingUp: true, panelBox, _trackedActors: [params],
        _updatePanelBarrier: original, _destroyPanelBarrier() { calls.push('destroy-barrier'); },
        untrackChrome(target) { calls.push('untrack'); this._trackedActors = this._trackedActors.filter(item => item.actor !== target); },
        trackChrome(target, value) { calls.push({...value}); this._trackedActors.push({actor: target, ...value}); },
        connect(signal, cb) { handlers.set(1, cb); return 1; }, disconnect(id) { handlers.delete(id); }};
    const dash = {visible: true, hide() { this.visible = false; }, show() { this.visible = true; }};
    const Main = {layoutManager: layout, panel: {_leftBox: actor(), _centerBox: actor(), _rightBox: actor()},
        sessionMode: {hasOverview: true}, overview: {dash, show() { calls.push('overview'); }, showApps() { calls.push('apps'); }},
        extensionManager: {lookup() {}, connect() {}, disconnect() {}}};
    const shellwm = {completed_minimize() {}, completed_unminimize() {}, connect() {}, disconnect() {},
        block_signal_handler() { calls.push('block'); }, unblock_signal_handler() { calls.push('unblock'); }};
    const GObject = {signal_handler_find(_obj, {signalId}) { return signalId === 'minimize' ? 11 : 12; },
        signal_handler_is_connected() { return true; }};
    const compat = runInNewContext(`${outputFiles[0].text}\nCompat;`, {
        fixtures: {Main, GObject}, global: {window_manager: shellwm},
        console: {warn: message => warnings.push(message), error: message => warnings.push(message)},
    });
    return {compat, Main, layout, calls, warnings, original, handlers, shellwm, GObject};
}

for (const field of ['_trackedActors', '_updatePanelBarrier', '_destroyPanelBarrier']) {
    test(`missing ${field} leaves native layout untouched`, () => {
        const {compat, layout, calls} = fixture();
        delete layout[field];
        assert.equal(compat.bottomPanelCapabilities(), null);
        assert.deepEqual(calls, []);
    });
}
test('invalid chrome flags and missing panel boxes reject the bottom layout before mutation', () => {
    const {compat, Main, layout, calls} = fixture();
    layout._trackedActors[0].affectsStruts = 'yes';
    assert.equal(compat.bottomPanelCapabilities(), null);
    layout._trackedActors[0].affectsStruts = true;
    delete Main.panel._centerBox;
    assert.equal(compat.bottomPanelCapabilities(), null);
    assert.deepEqual(calls, []);
});
test('bottom layout releases original chrome and barrier exactly once', () => {
    const {compat, layout, calls, original} = fixture();
    const release = compat.bottomPanelCapabilities().acquire();
    assert.notEqual(layout._updatePanelBarrier, original);
    release();
    assert.equal(layout._updatePanelBarrier, original);
    assert.equal(calls.filter(value => value.trackFullscreen === true).length, 1);
    const count = calls.length;
    release();
    assert.equal(calls.length, count);
});
test('chrome acquisition failure rolls back before returning native fallback', () => {
    const {compat, layout, calls, original} = fixture();
    layout.trackChrome = (_actor, params) => {
        if (!params.trackFullscreen) throw Error('injected chrome failure');
        calls.push('chrome-restored');
    };
    assert.equal(compat.bottomPanelCapabilities().acquire(), null);
    assert.equal(layout._updatePanelBarrier, original);
    assert.ok(calls.includes('chrome-restored'));
});
test('barrier replaced by another extension is preserved on release', () => {
    const {compat, layout} = fixture();
    const release = compat.bottomPanelCapabilities().acquire();
    const other = () => {};
    layout._updatePanelBarrier = other;
    release();
    assert.equal(layout._updatePanelBarrier, other);
});
for (const replacement of [false, true]) {
    test(`foreign chrome ownership survives bottom-panel release (replacement=${replacement})`, () => {
        const {compat, layout} = fixture();
        const release = compat.bottomPanelCapabilities().acquire();
        if (replacement) layout._trackedActors[0] = {...layout._trackedActors[0]};
        else layout._trackedActors[0].affectsStruts = false;
        const foreign = layout._trackedActors[0];
        release();
        assert.equal(layout._trackedActors[0], foreign);
        assert.equal(foreign.trackFullscreen, false);
        assert.equal(foreign.affectsStruts, replacement);
    });
}
test('foreign chrome removal is not reversed on bottom-panel release', () => {
    const {compat, layout} = fixture();
    const release = compat.bottomPanelCapabilities().acquire();
    layout.untrackChrome(layout.panelBox);
    release();
    assert.equal(layout._trackedActors.length, 0);
});
test('bottom-panel visibility returns to its prior state and preserves an external hide', () => {
    const {compat, layout} = fixture();
    const track = layout.trackChrome;
    layout.trackChrome = function(actor, params) {
        track.call(this, actor, params);
        actor.visible = true; // Native visibility refresh while restoring chrome.
    };
    layout.panelBox.visible = false;
    let release = compat.bottomPanelCapabilities().acquire();
    assert.equal(layout.panelBox.visible, true);
    release();
    assert.equal(layout.panelBox.visible, false);
    layout.panelBox.visible = true;
    release = compat.bottomPanelCapabilities().acquire();
    layout.panelBox.visible = false;
    release();
    assert.equal(layout.panelBox.visible, false);
});
test('startup suppression restores state and disconnects on completion or early disable', () => {
    for (const complete of [false, true]) {
        const {compat, Main, handlers} = fixture();
        const release = compat.suppressStartupOverview();
        assert.equal(Main.sessionMode.hasOverview, false);
        if (complete) handlers.get(1)();
        release();
        assert.equal(Main.sessionMode.hasOverview, true);
        assert.equal(handlers.size, 0);
    }
});
test('missing startup signal does not suppress native overview', () => {
    const {compat, Main, layout} = fixture();
    layout.connect = () => { throw Error('unknown signal'); };
    compat.suppressStartupOverview()();
    assert.equal(Main.sessionMode.hasOverview, true);
});
test('absent dash and application grid keep overview fallback usable', () => {
    const {compat, Main, calls} = fixture();
    delete Main.overview.dash;
    delete Main.overview.showApps;
    assert.equal(compat.nativeDash(), null);
    compat.showApplications();
    assert.deepEqual(calls, ['overview']);
});
test('optional popup and invalid extension discovery are rejected', () => {
    const {compat, Main} = fixture();
    assert.equal(compat.popupArrow({}), null);
    assert.equal(compat.popupArrow({_boxPointer: {arrowSide: 0}}), null);
    delete Main.extensionManager.lookup;
    assert.equal(compat.extensionManager(), null);
});
test('animation preflight finds both handlers without blocking any of them', () => {
    const {compat, calls} = fixture();
    assert.deepEqual(Array.from(compat.animationCapabilities().ids), [11, 12]);
    assert.deepEqual(calls, []);
});
for (const problem of ['completion', 'duplicate', 'disconnected', 'lookup-throws']) {
    test(`animation ${problem} keeps native handlers untouched`, () => {
        const {compat, shellwm, GObject, calls} = fixture();
        if (problem === 'completion') delete shellwm.completed_minimize;
        if (problem === 'duplicate') GObject.signal_handler_find = () => 11;
        if (problem === 'disconnected') GObject.signal_handler_is_connected = () => false;
        if (problem === 'lookup-throws') GObject.signal_handler_find = () => { throw Error('missing signal'); };
        assert.equal(compat.animationCapabilities(), null);
        assert.deepEqual(calls, []);
    });
}

test('destroyed owned panel menus release only the native panel binding after closing', () => {
    const {compat, Main} = fixture();
    const foreign = {};
    const owners = new Set([Main.panel, foreign]);
    const calls = [];
    const menu = {disconnectObject(owner) { calls.push('disconnect'); owners.delete(owner); }};
    const indicator = {menu, destroy() {
        assert.ok(owners.has(Main.panel), 'native close callback remains until destroy completes');
        calls.push('destroy');
        this.menu = null;
    }};
    compat.destroyPanelIndicator(indicator);
    assert.deepEqual(calls, ['destroy', 'disconnect']);
    assert.deepEqual([...owners], [foreign]);
});
test('panel menu cleanup tolerates missing capability and also runs after failed destroy', () => {
    const {compat} = fixture();
    compat.destroyPanelIndicator({destroy() {}});
    compat.destroyPanelIndicator({menu: {}, destroy() {}});
    let disconnected = false;
    assert.throws(() => compat.destroyPanelIndicator({
        menu: {disconnectObject() { disconnected = true; }},
        destroy() { throw Error('injected destroy failure'); },
    }), /injected destroy failure/);
    assert.ok(disconnected);
});

test('owned submenu destruction releases parent binding without removing unrelated owners', () => {
    const {compat} = fixture();
    const parent = {}, foreign = {};
    const owners = new Set([parent, foreign]);
    const handlers = new Map();
    const submenu = {
        connect(signal, cb) { assert.equal(signal, 'destroy'); handlers.set(1, cb); return 1; },
        disconnect(id) { handlers.delete(id); },
        disconnectObject(owner) { owners.delete(owner); },
    };
    compat.trackOwnedSubmenu(parent, submenu);
    assert.equal(owners.size, 2);
    handlers.get(1)();
    assert.equal(handlers.size, 0);
    assert.deepEqual([...owners], [foreign]);
    compat.trackOwnedSubmenu(parent, {});
});
