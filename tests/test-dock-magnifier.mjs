import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({
    entryPoints: ['src/dockMagnifier.ts'],
    bundle: true, write: false, format: 'iife', globalName: 'MagnifierModule',
    plugins: [{
        name: 'shell-fixture',
        setup(builder) {
            builder.onResolve({filter: /^gi:\/\//}, args =>
                ({path: args.path, namespace: 'shell-fixture'}));
            builder.onLoad({filter: /.*/, namespace: 'shell-fixture'}, args => ({
                contents: `export default fixtures[${JSON.stringify(args.path.slice(5))}];`,
            }));
        },
    }],
});

function fixture(horizontal = false) {
    const illegalAccesses = [];
    class Actor {
        handlers = new Map();
        nextId = 1;
        disposed = false;
        staged = true;
        allocated = true;
        scale = 1;
        dragging = false;
        children = [];
        constructor(x = 0, y = 0, width = 40, height = 40) {
            Object.assign(this, {x, y, w: width, h: height});
        }
        check() {
            if (this.disposed) {
                illegalAccesses.push(this);
                throw new Error('Actor already disposed');
            }
        }
        get mapped() { this.check(); return this.staged; }
        get width() { this.check(); return this.w; }
        get height() { this.check(); return this.h; }
        connect(signal, callback) {
            this.check();
            const id = this.nextId++;
            this.handlers.set(id, {signal, callback});
            return id;
        }
        disconnect(id) { this.check(); this.handlers.delete(id); }
        emit(signal) {
            this.check();
            for (const [id, handler] of [...this.handlers]) {
                if (this.handlers.has(id) && handler.signal === signal)
                    handler.callback(this);
            }
        }
        destroy(childrenFirst = true) {
            if (childrenFirst)
                this.children.forEach(child => child.destroy());
            this.emit('destroy');
            if (!childrenFirst)
                this.children.forEach(child => child.destroy());
            this.handlers.clear();
            this.disposed = true;
            this.staged = false;
        }
        get_stage() { this.check(); return this.staged ? {} : null; }
        has_allocation() { this.check(); return this.allocated; }
        get_transformed_position() {
            this.check();
            return [this.x - this.w * (this.scale - 1) / 2,
                this.y - this.h * (this.scale - 1) / 2];
        }
        get_transformed_size() { this.check(); return [this.w * this.scale, this.h * this.scale]; }
        has_style_class_name() { this.check(); return this.dragging; }
        set_pivot_point() { this.check(); }
        remove_transition() {
            this.check();
            assert.ok(this.staged, 'detached artwork must not be restyled');
        }
        save_easing_state() { this.check(); }
        set_easing_duration() { this.check(); }
        set_easing_mode() { this.check(); }
        restore_easing_state() { this.check(); }
        set_scale(x, y) { this.check(); assert.equal(x, y); this.scale = x; }
    }
    const dock = new Actor(0, 0, horizontal ? 300 : 64, horizontal ? 64 : 300);
    const icons = [30, 90, 150, 210].map(offset => {
        const actor = new Actor(horizontal ? offset : 2, horizontal ? 2 : offset, 60, 60);
        const zoomActor = new Actor(actor.x + 10, actor.y + 10);
        actor.children.push(zoomActor);
        dock.children.push(actor);
        return {actor, zoomActor};
    });
    const settings = Object.assign(new Actor(), {enable_animations: true});
    const pending = new Map();
    let nextSource = 1;
    let enabled = true;
    let pointer = horizontal ? [120, 32] : [32, 120];
    const fixtures = {
        St: {Settings: {get: () => settings}},
        Clutter: {EVENT_PROPAGATE: false, AnimationMode: {EASE_OUT_QUAD: 1}},
        GLib: {
            PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
            idle_add(_priority, callback) {
                const id = nextSource++;
                pending.set(id, callback);
                return id;
            },
            source_remove(id) { assert.ok(pending.delete(id)); },
        },
    };
    const {DockMagnifier} = runInNewContext(`${outputFiles[0].text}\nMagnifierModule;`,
        {fixtures, global: {get_pointer: () => pointer}});
    const magnifier = new DockMagnifier(dock, () => horizontal, () => enabled);
    magnifier.setIcons(icons);
    const flush = () => {
        for (let n = 0; pending.size; n++) {
            assert.ok(n < 10, 'idle callbacks must settle');
            const [id, callback] = pending.entries().next().value;
            pending.delete(id);
            callback();
        }
    };
    return {dock, icons, settings, pending, magnifier, flush, illegalAccesses,
        setEnabled(value) { enabled = value; magnifier.refresh(); },
        setPointer(value) { pointer = value; magnifier.refresh(); },
    };
}

for (const childrenFirst of [false, true]) {
    test(`native teardown cancels queued callbacks (children first: ${childrenFirst})`, () => {
        const f = fixture();
        f.flush();
        assert.equal(f.icons[1].zoomActor.scale, 1.4);
        f.magnifier.refresh();
        assert.equal(f.pending.size, 1);
        f.dock.destroy(childrenFirst);
        assert.equal(f.pending.size, 0);
        // Extension cleanup and late requests can follow native destruction.
        f.magnifier.destroy();
        f.magnifier.refresh();
        f.magnifier.reset();
        f.magnifier.setIcons(f.icons);
        f.flush();
        assert.equal(f.settings.handlers.size, 0);
        assert.deepEqual(f.illegalAccesses, []);
    });
}

for (const source of ['actor', 'zoomActor']) {
    test(`removing an individual ${source} before an idle update forgets it`, () => {
        const f = fixture();
        f.icons[1][source].destroy();
        f.flush();
        f.magnifier.reset(false);
        f.magnifier.destroy();
        assert.deepEqual(f.illegalAccesses, []);
        assert.equal(f.pending.size, 0);
        for (const {actor, zoomActor} of f.icons) {
            assert.equal(actor.handlers.size, 0);
            assert.equal(zoomActor.handlers.size, 0);
        }
    });
}

test('normal disable restores scales and disconnects handlers before icons are destroyed', () => {
    const f = fixture();
    f.flush();
    f.magnifier.refresh();
    f.magnifier.destroy();
    f.magnifier.destroy();
    for (const {actor, zoomActor} of f.icons) {
        assert.equal(zoomActor.scale, 1);
        assert.equal(actor.handlers.size, 0);
        assert.equal(zoomActor.handlers.size, 0);
    }
    assert.equal(f.dock.handlers.size, 0);
    assert.equal(f.settings.handlers.size, 0);
    assert.equal(f.pending.size, 0);
    f.dock.destroy();
    assert.deepEqual(f.illegalAccesses, []);
});

test('reset skips artwork detached from the stage', () => {
    const f = fixture();
    f.icons.forEach(({actor, zoomActor}) => actor.staged = zoomActor.staged = false);
    f.flush();
    f.magnifier.reset(false);
    f.magnifier.destroy();
    assert.deepEqual(f.illegalAccesses, []);
});

test('startup waits for allocation and rejects non-finite transforms without poisoning scales', () => {
    const f = fixture();
    f.dock.allocated = false;
    f.flush();
    assert.ok(f.icons.every(({zoomActor}) => zoomActor.scale === 1));
    f.dock.allocated = true;
    f.dock.x = NaN;
    f.dock.emit('notify::allocation');
    f.flush();
    assert.ok(f.icons.every(({zoomActor}) => zoomActor.scale === 1));
    f.dock.x = 0;
    f.icons[1].zoomActor.x = NaN;
    f.dock.emit('notify::allocation');
    f.flush();
    assert.equal(f.icons[1].zoomActor.scale, 1);
    f.icons[1].zoomActor.x = 12;
    f.icons[1].zoomActor.emit('notify::allocation');
    f.flush();
    assert.equal(f.icons[1].zoomActor.scale, 1.4);
    f.magnifier.destroy();
});

for (const horizontal of [false, true]) {
    test(`40% magnification preserves hitboxes and artwork gaps (horizontal: ${horizontal})`, () => {
        const f = fixture(horizontal);
        const hitboxes = f.icons.map(({actor}) => actor.get_transformed_position());
        f.flush();
        assert.equal(f.icons[1].zoomActor.scale, 1.4);
        assert.ok(f.icons[0].zoomActor.scale > 1);
        const axis = horizontal ? 0 : 1;
        for (let pointer = 30; pointer < 270; pointer += 3) {
            f.setPointer(horizontal ? [pointer, 32] : [32, pointer]);
            f.flush();
            for (let i = 1; i < f.icons.length; i++) {
                const a = f.icons[i - 1].zoomActor, b = f.icons[i].zoomActor;
                const end = a.get_transformed_position()[axis] + a.get_transformed_size()[axis];
                assert.ok(b.get_transformed_position()[axis] - end >= 4 - 1e-8);
            }
        }
        assert.deepEqual(f.icons.map(({actor}) => actor.get_transformed_position()), hitboxes);
        f.setPointer([-1, -1]);
        f.flush();
        assert.ok(f.icons.every(({zoomActor}) => zoomActor.scale === 1));
        f.magnifier.destroy();
    });
}

test('menus, drag and disabled animations reset and then allow magnification again', () => {
    const f = fixture();
    f.flush();
    f.setEnabled(false);
    f.flush();
    assert.ok(f.icons.every(({zoomActor}) => zoomActor.scale === 1));
    f.setEnabled(true);
    f.flush();
    assert.equal(f.icons[1].zoomActor.scale, 1.4);
    f.icons[1].actor.dragging = true;
    f.icons[1].actor.emit('style-changed');
    f.flush();
    assert.ok(f.icons.every(({zoomActor}) => zoomActor.scale === 1));
    f.icons[1].actor.dragging = false;
    f.settings.enable_animations = false;
    f.settings.emit('notify::enable-animations');
    f.flush();
    assert.ok(f.icons.every(({zoomActor}) => zoomActor.scale === 1));
    f.settings.enable_animations = true;
    f.settings.emit('notify::enable-animations');
    f.flush();
    assert.equal(f.icons[1].zoomActor.scale, 1.4);
    f.magnifier.destroy();
});
