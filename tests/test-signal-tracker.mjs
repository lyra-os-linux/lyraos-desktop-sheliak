import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

// Build the real SignalTracker with a GObject stub whose semantics match GLib:
// disconnecting a handler id that is no longer installed aborts the process
// (modelled as a thrown "ABORT" that the production catch must never see,
// because a real GLib assertion is uncatchable), while
// signal_handler_is_connected only reads the handler table.
const {outputFiles} = await build({
    stdin: {resolveDir: process.cwd(),
        contents: "export {SignalTracker} from './src/signals.ts';"},
    bundle: true, write: false, format: 'iife', globalName: 'Signals',
    plugins: [{name: 'signals-fixture', setup(builder) {
        builder.onResolve({filter: /^gi:\/\//}, args => ({path: args.path, namespace: 'gi'}));
        builder.onLoad({filter: /.*/, namespace: 'gi'}, () => ({contents:
            'export default globalThis.fixtures.GObject;'}));
    }}]});

class GObjectBase {}

// A GObject-style emitter. Disconnecting a live id removes it; disconnecting a
// stale id aborts, exactly as GLib's invalid_closure_notify assertion does. The
// abort is recorded as a side effect rather than a throw, because the real GLib
// assertion calls abort() and a JS try/catch cannot undo it: a test that threw
// here would be silently swallowed by the old catch and pass for the wrong
// reason.
class GObjectEmitter extends GObjectBase {
    live = new Set();
    serial = 0;
    disconnects = 0;
    aborts = 0;
    connect() { const id = ++this.serial; this.live.add(id); return id; }
    disconnect(id) {
        if (!this.live.has(id)) {
            this.aborts++;
            return;
        }
        this.live.delete(id);
        this.disconnects++;
    }
    /** Model GObject auto-disconnecting its own handlers when it is finalized. */
    finalize() { this.live.clear(); }
}

// A plain imports.signals emitter: never a GObject, disconnect is always safe.
class JsEmitter {
    callbacks = new Map();
    serial = 0;
    connect() { const id = ++this.serial; this.callbacks.set(id, true); return id; }
    disconnect(id) { this.callbacks.delete(id); }
}

function load() {
    const GObject = {
        Object: GObjectBase,
        signal_handler_is_connected: (object, id) => object.live.has(id),
    };
    return runInNewContext(`${outputFiles[0].text}\nSignals;`, {fixtures: {GObject}}).SignalTracker;
}

test('destroy() skips handlers a finalized GObject already dropped', () => {
    const SignalTracker = load();
    const tracker = new SignalTracker();
    const app = new GObjectEmitter();
    tracker.connect(app, 'windows-changed', () => {});
    tracker.connect(app, 'windows-changed', () => {});

    // The shared emitter is torn down first and drops its own handlers.
    app.finalize();

    // Before the fix this called disconnect() on stale ids and aborted the
    // Shell (uncatchable in the real GLib), crashing the whole session.
    tracker.destroy();
    assert.equal(app.aborts, 0, 'no disconnect is attempted on stale ids');
    assert.equal(app.disconnects, 0);
});

test('destroy() disconnects live GObject handlers exactly once', () => {
    const SignalTracker = load();
    const tracker = new SignalTracker();
    const settings = new GObjectEmitter();
    tracker.connect(settings, 'changed', () => {});
    tracker.connect(settings, 'changed', () => {});

    tracker.destroy();
    assert.equal(settings.disconnects, 2);
    assert.equal(settings.live.size, 0);
});

test('disconnect(object, id) is guarded and idempotent for GObjects', () => {
    const SignalTracker = load();
    const tracker = new SignalTracker();
    const actor = new GObjectEmitter();
    const id = tracker.connect(actor, 'clicked', () => {});

    actor.finalize();
    tracker.disconnect(actor, id);
    assert.equal(actor.aborts, 0, 'a finalized handler is never disconnected');
    assert.equal(actor.disconnects, 0);
    // A second call is a no-op: the tracker already dropped the record.
    tracker.disconnect(actor, id);
    assert.equal(actor.aborts, 0);
});

test('plain JS signal emitters still disconnect through the catch path', () => {
    const SignalTracker = load();
    const tracker = new SignalTracker();
    const menu = new JsEmitter();
    tracker.connect(menu, 'open-state-changed', () => {});
    tracker.connect(menu, 'open-state-changed', () => {});

    tracker.destroy();
    assert.equal(menu.callbacks.size, 0, 'JS emitter handlers are removed');
});
