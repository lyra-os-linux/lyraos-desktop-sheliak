import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({stdin: {resolveDir: process.cwd(), contents:
    "export {Dock} from './src/dock.ts'; export {TopBarManager} from './src/topBar.ts'; export {SignalTracker} from './src/signals.ts';"},
    bundle: true, write: false, format: 'iife', globalName: 'Lifecycle', plugins: [{name: 'lifecycle-fixture', setup(builder) {
        builder.onResolve({filter: /^(gi|resource):\/\/|^\.\//}, args =>
            args.path.startsWith('./src/') || args.path === './signals.js' ? null : {path: args.path, namespace: 'fixture'});
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents:
            args.path.endsWith('/main.js') ? 'export const {layoutManager, panel, ctrlAltTabManager} = fixtures;' :
                'export default {}; export const windowsFavorites={}, windowsProfile={}, alignmentKey={}, AppIcon={}, DockMagnifier={}, LauncherEntryTracker={}, '+
                'ShowAppsButton={}, shellIsStartingUp={}, panelBox={}, TooltipManager={}, TrashIcon={}, getAppFavorites={}, PopupMenuManager={}, DragMotionResult={}, '+
                'OwnedValue={}, PanelStyleClass={}, PanelVisibility={};'}));
    }}]});

class Window {
    callbacks = new Map(); serial = 0; disposed = false;
    connect(signal, callback) {
        assert.equal(this.disposed, false);
        const id = ++this.serial; this.callbacks.set(id, {signal, callback}); return id;
    }
    disconnect(id) { assert.equal(this.disposed, false); this.callbacks.delete(id); }
    emit(signal) {
        for (const [id, entry] of [...this.callbacks])
            if (this.callbacks.has(id) && entry.signal === signal) entry.callback(this);
    }
    close() { this.emit('unmanaged'); this.disposed = true; this.callbacks.clear(); }
}

function fixture(role) {
    let destroyedActors = 0;
    const {Dock, TopBarManager, SignalTracker} = runInNewContext(`${outputFiles[0].text}\nLifecycle;`,
        {fixtures: {layoutManager: {removeChrome() {}}}, console: {debug() {}}});
    const manager = Object.create((role === 'dock' ? Dock : TopBarManager).prototype);
    Object.assign(manager, {_signals: new SignalTracker(), _trackedWindows: role === 'dock' ? new Map() : new Set(),
        _windowSignals: new Map(), _destroyed: false, _hideTimeoutId: 0, _redisplayTimeoutId: 0,
        _startupCompleteId: 0, _favoriteLaterId: 0, _icons: [],
        _syncVisibility() {}, _syncFloating() {}, _clearDragPlaceholder() {},
        _magnifier: {destroy() {}}, _launcherEntries: {destroy() {}}, _trash: {destroy() {}},
        _showApps: {destroy() {}}, _tooltip: {destroy() {}},
        actor: {destroy() { destroyedActors++; }}, _revealTrigger: {destroy() { destroyedActors++; }}});
    return {manager, destroyedActors: () => destroyedActors};
}

for (const role of ['dock', 'panel']) {
    test(`${role}: repeated create/unmanaged leaves no window references or handlers`, () => {
        const {manager} = fixture(role);
        for (let batch = 0; batch < 50; batch++) {
            const windows = Array.from({length: 12}, () => new Window());
            for (const window of windows) {
                manager._trackWindow(window);
                manager._trackWindow(window);
                assert.equal(window.callbacks.size, 5, 'duplicate tracking must not add handlers');
            }
            assert.equal(manager._trackedWindows.size, 12);
            for (const window of windows.reverse()) window.close();
            assert.equal(manager._trackedWindows.size, 0);
            assert.equal(manager._windowSignals.size, 0);
            assert.equal(manager._signals._signals.length, 0);
        }
    });
}

test('disabling Dock with live windows releases references as well as handlers', () => {
    const {manager, destroyedActors} = fixture('dock');
    const windows = Array.from({length: 12}, () => new Window());
    for (const window of windows) manager._trackWindow(window);
    manager.destroy();
    assert.equal(manager._trackedWindows.size, 0);
    assert.equal(manager._signals._signals.length, 0);
    for (const window of windows) {
        assert.equal(window.callbacks.size, 0);
        window.close();
    }
    manager.destroy();
    const late = new Window();
    manager._trackWindow(late);
    assert.equal(manager._trackedWindows.size, 0);
    assert.equal(late.callbacks.size, 0);
    assert.equal(destroyedActors(), 2, 'actors must be destroyed only once');
});
