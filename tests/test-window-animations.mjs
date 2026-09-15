import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints: ['src/windowAnimations.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Animations', plugins: [{
        name: 'animation-fixture', setup(builder) {
            builder.onResolve({filter: /^(gi|resource):\/\//}, args => ({path: args.path, namespace: 'fixture'}));
            builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents:
                args.path.startsWith('gi://') ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];`
                    : 'export const {wm, overview, layoutManager, panel, sessionMode, extensionManager} = fixtures.Main;'}));
        },
    }]});

function fixture(fault = '') {
    let nextId = 1, hint = null, mode = 'zoom';
    const warnings = [], idles = new Map(), timelines = new Set(), nativeRequests = [], completions = [];
    class Emitter {
        handlers = new Map();
        connect(signal, callback) {
            if (fault === `connect:${signal}`) throw Error(fault);
            const id = nextId++;
            this.handlers.set(id, {signal, callback});
            return id;
        }
        disconnect(id) { assert.ok(this.handlers.delete(id), `disconnect owned handler ${id}`); }
        emit(signal, ...args) {
            for (const [id, entry] of [...this.handlers])
                if (this.handlers.has(id) && entry.signal === signal) entry.callback(this, ...args);
        }
    }
    class Actor extends Emitter {
        x = 100; y = 200; opacity = 255; scale_x = 1; scale_y = 1;
        translation_x = 0; translation_y = 0; pivot = [0, 0]; visible = true;
        meta_window = {get_icon_geometry: () => [true, {x: 10, y: 800, width: 32, height: 32}],
            get_buffer_rect: () => ({x: 100, y: 200}), get_monitor: () => 0};
        get_pivot_point() { return this.pivot; }
        set_pivot_point(x, y) { this.pivot = [x, y]; }
        get_size() { return [400, 300]; }
        set_position(x, y) { this.x = x; this.y = y; }
        show() { this.visible = true; }
        ease(params) { nativeRequests.push({actor: this, params}); }
    }
    class Timeline extends Emitter {
        constructor(params) {
            super();
            if (fault === 'timeline') throw Error(fault);
            Object.assign(this, params); timelines.add(this);
        }
        start() { if (fault === 'start') throw Error(fault); }
        stop() { timelines.delete(this); }
        get_progress() { return .5; }
    }
    const shellwm = new Emitter();
    shellwm.completed_minimize = actor => { completions.push('minimize'); actor.visible = false; };
    shellwm.completed_unminimize = actor => { completions.push('unminimize'); };
    // These operations must never be attempted by Lyra, even on failure.
    shellwm.block_signal_handler = shellwm.unblock_signal_handler = () => { throw Error('Native handler ownership violation'); };
    class Wm {
        _shellwm = shellwm; _minimizing = new Set(); _unminimizing = new Set();
        _shouldAnimateActor() { return true; }
    }
    const wm = new Wm();
    const Main = {wm, overview: {visible: false}, layoutManager: {monitors: [{x: 0, y: 0, width: 1440, height: 900}]}};
    const GObject = {signal_lookup: name => name === 'minimize' ? 11 : 12,
        signal_get_invocation_hint: () => hint === null ? null : {signal_id: hint},
        signal_handler_find() { throw Error('Ambiguous native handler lookup'); }};
    const GLib = {PRIORITY_DEFAULT_IDLE: 200, SOURCE_REMOVE: false,
        idle_add(priority, callback) { if (fault === 'idle') throw Error(fault); const id = nextId++; idles.set(id, callback); return id; },
        source_remove(id) { assert.ok(idles.delete(id)); }};
    const {WindowAnimationManager} = runInNewContext(`${outputFiles[0].text}\nAnimations;`, {
        fixtures: {Main, GObject, GLib, Clutter: {Actor, Timeline}, Gio: {}, Meta: {},
            Mtk: {Rectangle: class { constructor(params) { Object.assign(this, params); } }},
            St: {Settings: {get: () => ({enable_animations: true})}}},
        global: {window_manager: shellwm}, Set,
        console: {warn: message => warnings.push(message), error: message => warnings.push(message)},
    });
    const actor = new Actor();
    const settings = {get_string: () => mode, set_string: (_key, value) => { mode = value; }};
    function done(minimizing, actor) {
        if (!(minimizing ? wm._minimizing : wm._unminimizing).delete(actor)) return;
        actor.opacity = 255; actor.scale_x = actor.scale_y = 1; actor.set_pivot_point(0, 0);
        shellwm[minimizing ? 'completed_minimize' : 'completed_unminimize'](actor);
    }
    function request(minimizing, {useEase = true, foreignDecision = false} = {}) {
        hint = minimizing ? 11 : 12;
        try {
            const allowed = wm._shouldAnimateActor(actor, []);
            if (!allowed) { shellwm[minimizing ? 'completed_minimize' : 'completed_unminimize'](actor); return; }
            (minimizing ? wm._minimizing : wm._unminimizing).add(actor);
            actor.opacity = minimizing ? 255 : 0;
            if (!minimizing) { actor.set_position(10, 800); actor.scale_x = actor.scale_y = .08; actor.show(); }
            if (useEase) actor.ease({x: minimizing ? 10 : 100, y: minimizing ? 800 : 200,
                scale_x: minimizing ? .08 : 1, scale_y: minimizing ? .08 : 1,
                onStopped: () => done(minimizing, actor)});
            if (foreignDecision) wm._shouldAnimateActor(actor, []);
            shellwm.emit(minimizing ? 'minimize' : 'unminimize', actor);
        } finally { hint = null; }
    }
    return {wm, shellwm, actor, timelines, idles, nativeRequests, completions, warnings, request,
        start: () => new WindowAnimationManager(settings), setMode: value => { mode = value; },
        kill() { done(true, actor); done(false, actor); shellwm.emit('kill-window-effects', actor); },
        drain() { for (const [id, cb] of [...idles]) { idles.delete(id); cb(); } },
        finish() { for (const timeline of [...timelines]) timeline.emit('completed'); },
    };
}

for (const mode of ['zoom', 'fade', 'none']) {
    test(`${mode}: native bookkeeping completes once and unrelated signal handlers survive`, () => {
        const f = fixture(); f.setMode(mode);
        let foreignMin = 0, foreignUnmin = 0;
        const ids = [f.shellwm.connect('minimize', () => foreignMin++), f.shellwm.connect('unminimize', () => foreignUnmin++)];
        const manager = f.start();
        f.request(true, {foreignDecision: true});
        assert.equal(foreignMin, 1);
        if (mode !== 'none') { assert.equal(f.timelines.size, 1); assert.equal(f.completions.length, 0); }
        f.finish();
        assert.equal(f.actor.visible, false);
        f.request(false); f.finish();
        assert.equal(foreignUnmin, 1);
        assert.equal(f.actor.visible, true);
        assert.equal(f.actor.x, 100); assert.equal(f.actor.y, 200);
        assert.deepEqual(f.completions, ['minimize', 'unminimize']);
        assert.equal(f.nativeRequests.length, 0);
        manager.destroy(); manager.destroy();
        assert.equal(f.actor.handlers.size, 0); assert.equal(f.idles.size, 0);
        assert.equal(f.timelines.size, 0); assert.equal(f.wm._minimizing.size + f.wm._unminimizing.size, 0);
        assert.ok(!Object.hasOwn(f.wm, '_shouldAnimateActor'));
        assert.ok(ids.every(id => f.shellwm.handlers.has(id)));
    });
}
test('rapid opposite operation settles minimize before restoring visibility', () => {
    const f = fixture(), manager = f.start();
    f.request(true); f.request(false);
    assert.deepEqual(f.completions, ['minimize']);
    assert.equal(f.actor.visible, true); assert.equal(f.timelines.size, 1);
    f.finish();
    assert.deepEqual(f.completions, ['minimize', 'unminimize']);
    assert.equal(f.actor.opacity, 255); assert.equal(f.actor.scale_x, 1);
    manager.destroy();
});
for (const reason of ['disable', 'kill', 'destroy']) {
    test(`${reason} in flight completes once and releases every owned callback`, () => {
        const f = fixture(), manager = f.start();
        f.request(true);
        if (reason === 'kill') f.kill();
        if (reason === 'destroy') f.actor.emit('destroy');
        manager.destroy(); f.finish();
        assert.deepEqual(f.completions, ['minimize']);
        assert.equal(f.actor.handlers.size + f.timelines.size + f.idles.size + f.shellwm.handlers.size, 0);
    });
}
for (const fault of ['connect:kill-window-effects', 'connect:destroy', 'idle', 'timeline', 'connect:completed', 'start']) {
    test(`${fault}: partial activation delegates native ease with its prepared state`, () => {
        const f = fixture(fault), manager = f.start();
        f.request(false);
        assert.equal(f.nativeRequests.length, 1);
        assert.equal(f.actor.opacity, 0); assert.equal(f.actor.scale_x, .08);
        assert.equal(f.actor.x, 10); assert.equal(f.actor.y, 800);
        f.nativeRequests[0].params.onStopped();
        assert.deepEqual(f.completions, ['unminimize']);
        manager.destroy();
        assert.equal(f.actor.handlers.size + f.timelines.size + f.idles.size + f.shellwm.handlers.size, 0);
        assert.ok(!Object.hasOwn(f.actor, 'ease')); assert.ok(!Object.hasOwn(f.wm, '_shouldAnimateActor'));
    });
}
for (const early of [false, true]) {
    test(`a foreign decision override ${early ? 'before' : 'after'} enable survives disable`, () => {
        const f = fixture();
        const native = f.wm._shouldAnimateActor;
        let manager;
        if (!early) manager = f.start();
        const previous = f.wm._shouldAnimateActor;
        const other = function (...args) { return previous.apply(this, args); };
        f.wm._shouldAnimateActor = other;
        if (early) manager = f.start();
        f.request(true);
        assert.equal(f.nativeRequests.length, 1);
        manager.destroy();
        assert.equal(f.wm._shouldAnimateActor, other);
        assert.equal(f.wm._shouldAnimateActor(f.actor, []), native.call(f.wm));
    });
}
test('a foreign actor ease override is never replaced', () => {
    const f = fixture(), manager = f.start();
    let calls = 0;
    const other = () => calls++;
    f.actor.ease = other;
    f.request(true);
    assert.equal(calls, 1); assert.equal(f.timelines.size, 0);
    manager.destroy(); assert.equal(f.actor.ease, other);
});
for (const cleanup of ['idle', 'disable', 'destroy']) {
    test(`unused one-shot request expires on ${cleanup} without touching foreign overrides`, () => {
        const f = fixture(), manager = f.start();
        f.request(true, {useEase: false});
        assert.ok(Object.hasOwn(f.actor, 'ease'));
        const retained = f.actor.ease;
        const other = function (params) { return retained.call(this, params); };
        f.actor.ease = other;
        if (cleanup === 'idle') f.drain();
        if (cleanup === 'destroy') f.actor.emit('destroy');
        manager.destroy();
        assert.equal(f.actor.ease, other);
        assert.equal(f.actor.handlers.size + f.idles.size, 0);
        f.actor.ease({onStopped() {}});
        assert.equal(f.nativeRequests.length, 1); assert.equal(f.timelines.size, 0);
    });
}
test('read-only decision slot fails before leaving an owned compositor callback', () => {
    const f = fixture();
    Object.preventExtensions(f.wm);
    const manager = f.start();
    assert.equal(f.shellwm.handlers.size, 0);
    f.request(true); assert.equal(f.nativeRequests.length, 1);
    manager.destroy();
});
