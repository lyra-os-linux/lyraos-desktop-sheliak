import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import System from 'system';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const ext = role => Main.extensionManager.lookup(`${role}@lyraos.com.br`).stateObj;
const dock = () => ext('dock').lyraApi?.current?.dock;
const panelMenus = () => Object.entries(Main.panel.statusArea)
    .filter(([role]) => role.startsWith('sheliak-') || role === 'lyra-start')
    .map(([, indicator]) => indicator.menu).filter(Boolean);
const testWindows = () => global.get_window_actors().filter(actor =>
    actor.meta_window?.get_title()?.startsWith('Lyra Window Lifecycle '));

// Observe the actual production registrations. Records hold only scalar IDs
// and WeakRefs, never a window or its callback. No production instrumentation.
class Connections {
    live = new Map();
    windows = new Map();
    totals = {dock: 0, panel: 0};
    constructor() {
        const proto = Meta.Window.prototype;
        const observer = this;
        this.descriptors = ['connect', 'disconnect'].map(key => [key, Object.getOwnPropertyDescriptor(proto, key)]);
        const connect = proto.connect, disconnect = proto.disconnect;
        Object.defineProperty(proto, 'connect', {configurable: true, writable: true, value(signal, callback) {
            const id = connect.call(this, signal, callback);
            const role = new Error().stack.match(/\/(dock|panel)@lyraos\.com\.br\//)?.[1];
            if (role) {
                const sequence = this.get_stable_sequence();
                observer.live.set(`${sequence}:${id}`, {role, signal, sequence});
                observer.windows.set(sequence, new WeakRef(this));
                observer.totals[role]++;
            }
            return id;
        }});
        Object.defineProperty(proto, 'disconnect', {configurable: true, writable: true, value(id) {
            observer.live.delete(`${this.get_stable_sequence()}:${id}`);
            return disconnect.call(this, id);
        }});
    }
    counts() {
        return Object.fromEntries(['dock', 'panel'].map(role => [role,
            [...this.live.values()].filter(record => record.role === role).length]));
    }
    destroy() {
        for (const [key, descriptor] of this.descriptors) {
            if (descriptor) Object.defineProperty(Meta.Window.prototype, key, descriptor);
            else delete Meta.Window.prototype[key];
        }
        this.live.clear(); this.windows.clear();
    }
}

export default class WindowLifecycleProbe extends Extension {
    enable() {
        if (this.started) return;
        this.started = true;
        this.checks = []; this.samples = []; this.closed = 0;
        this.startedAt = GLib.get_monotonic_time();
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    report(error, pending = false) {
        const data = {status: pending ? 'pending' : error ? 'failed' : 'passed',
            control_without_lyra: this.control,
            elapsed_seconds: (GLib.get_monotonic_time() - this.startedAt) / 1e6,
            closed_windows: this.closed, checks: this.checks, samples: this.samples,
            memory_gate: this.memoryGate, error: error ? String(error) : null, stack: error?.stack};
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify(data, null, 2));
    }
    check(name, passed, detail = null) {
        this.checks.push({name, passed: !!passed, detail});
        if (!passed) throw Error(`${name}: ${JSON.stringify(detail)}`);
    }
    async until(predicate, message) {
        for (let i = 0; i < 80; i++) {
            if (predicate()) return;
            await wait(100);
        }
        throw Error(message);
    }
    send(command) { this.input.put_string(`${command}\n`, null); }
    async open(count) {
        this.send(`OPEN ${count}`);
        await this.until(() => testWindows().filter(actor => actor.visible).length === count, 'GTK windows did not map');
        await wait(200);
    }
    async close(count) {
        this.send('CLOSE');
        await this.until(() => testWindows().length === 0, 'Closed GTK windows retained actors');
        this.closed += count;
        // GNOME 48 WorkspaceTracker retains removed windows for its 1000 ms
        // LAST_WINDOW_GRACE_TIME, in addition to destroy animations.
        await wait(1250);
    }
    async collect() {
        // Separate jobs allow JS WeakRefs and GJS toggle references to settle.
        await wait(50); System.gc();
        await wait(100); System.gc();
        await wait(100);
    }
    async contextWindow() {
        await this.open(3);
        const icon = dock()._icons.find(item => item.app.get_windows().some(window =>
            window.get_title()?.startsWith('Lyra Window Lifecycle ')));
        this.check('running GTK application has a context menu', !!icon,
            dock()._icons.map(item => ({id: item.appId, windows: item.app.get_windows().length})));
        this.check('GTK windows belong to the same application', icon.app.get_windows().length === 3,
            icon.appId);
        this.check('GTK client is associated with its desktop entry', icon.appId === 'org.lyraos.WindowLifecycle.desktop', icon.appId);
        icon.menu.toggle(); await wait(150); icon.menu.close(); await wait(250);
        const weak = new WeakRef(testWindows()[0].meta_window);
        testWindows()[0].meta_window.delete(global.get_current_time());
        await this.until(() => testWindows().length === 2, 'one GTK window did not close');
        this.closed++;
        await wait(1250); await this.collect();
        this.check('app remains running with the same context menu', dock()._icons.includes(icon));
        this.check('closed window released while other app windows stay open', !weak.deref());
        await this.close(2); await this.collect();
    }
    memory() {
        const [, bytes] = GLib.file_get_contents('/proc/self/smaps_rollup');
        const text = new TextDecoder().decode(bytes);
        const field = name => Number(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
        const memoryFile = `${GLib.getenv('SHELIAK_NATIVE_RESULT')}.memory`;
        System.dumpMemoryInfo(memoryFile);
        const [, info] = GLib.file_get_contents(memoryFile);
        // GJS appends reports when this file already exists.
        const reports = [...new TextDecoder().decode(info).matchAll(/```json\n([\s\S]*?)\n```/g)];
        const gc = JSON.parse(reports.at(-1)[1]);
        return {rss_kib: field('Rss'), pss_kib: field('Pss'), private_dirty_kib: field('Private_Dirty'),
            gc_heap_kib: gc.gcBytes / 1024, js_malloc_kib: gc.mallocBytes / 1024};
    }
    exercise(index) {
        const windows = testWindows().map(actor => actor.meta_window);
        const window = windows[0];
        window.move_frame(false, 80 + index % 5 * 20, 100);
        window.maximize(Meta.MaximizeFlags.BOTH);
        window.unmaximize(Meta.MaximizeFlags.BOTH);
        windows.at(-1).minimize();
    }
    assertReleased(name, baseline, weak) {
        if (!this.control) this.check(`${name}: dock references return to baseline`, dock()._trackedWindows.size === baseline.dockWindows,
            {actual: dock()._trackedWindows.size, expected: baseline.dockWindows});
        this.check(`${name}: dock and panel handlers return to baseline`,
            JSON.stringify(this.connections.counts()) === JSON.stringify(baseline.handlers), this.connections.counts());
        const retained = weak.filter(ref => ref.deref()).length;
        if (retained) {
            const targets = weak.map(ref => ref.deref()).filter(Boolean).map(window => ({
                address: System.addressOf(window), native: System.refcount(window)}));
            GLib.file_set_contents(`${GLib.getenv('SHELIAK_NATIVE_RESULT')}.targets.json`, JSON.stringify(targets));
            System.dumpHeap(`${GLib.getenv('SHELIAK_NATIVE_RESULT')}.heap`);
        }
        this.check(`${name}: closed Meta.Window wrappers collected`, retained === 0, retained);
    }
    async run() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private compositor required');
        const clientPath = GLib.getenv('LYRA_NATIVE_WINDOW_CLIENT');
        if (!clientPath) throw Error('LYRA_NATIVE_WINDOW_CLIENT required');
        const quick = GLib.getenv('LYRA_WINDOW_LIFECYCLE_QUICK') === '1';
        this.control = GLib.getenv('LYRA_WINDOW_LIFECYCLE_CONTROL') === '1';
        const batches = quick ? 9 : 96;
        const batchSize = quick ? 4 : 12;
        await wait(2400); Main.overview.hide(); await wait(350);
        this.connections = new Connections();
        const appPath = `${GLib.get_user_data_dir()}/applications/org.lyraos.WindowLifecycle.desktop`;
        GLib.file_set_contents(appPath, '[Desktop Entry]\nType=Application\nName=Lyra Window Lifecycle\nExec=/usr/bin/true\nIcon=applications-system\n');
        await this.until(() => Shell.AppSystem.get_default().lookup_app('org.lyraos.WindowLifecycle.desktop'),
            'GTK desktop entry did not reach the Shell app registry');
        this.client = Gio.Subprocess.new(['/usr/bin/python3', clientPath],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_SILENCE);
        this.input = new Gio.DataOutputStream({base_stream: this.client.get_stdin_pipe()});
        try {
            // Rebind so instrumentation includes baseline desktop windows.
            for (const role of ['dock', 'panel']) ext(role).disable();
            if (this.control) {
                for (const role of ['menus', 'search', 'animations', 'desktop-icons']) ext(role).disable();
            } else {
                for (const role of ['panel', 'dock']) ext(role).enable();
            }
            const settings = ext('dock').getSettings('org.gnome.shell.extensions.sheliak');
            settings.set_string('desktop-profile', 'lyra');
            await wait(600);
            const baseline = {dockWindows: dock()?._trackedWindows.size ?? 0, handlers: this.connections.counts()};
            if (GLib.getenv('LYRA_WINDOW_LIFECYCLE_CONTEXT') === '1') {
                await this.contextWindow();
                return;
            }
            if (!this.control) {
            await this.open(3);
            this.check('GTK registrations observed in both components',
                this.connections.totals.dock >= 15 && this.connections.totals.panel >= 15, this.connections.totals);
            this.check('three live windows tracked by the Dock', dock()._trackedWindows.size === baseline.dockWindows + 3);
            const retired = dock();
            ext('dock').disable();
            this.check('disabled Dock releases every window reference', retired._trackedWindows.size === 0,
                retired._trackedWindows.size);
            this.check('disabled Dock disconnects every owned signal', retired._signals._signals.length === 0);
            // Explicitly exercise idempotent owner cleanup, while the windows live.
            retired.destroy();
            ext('dock').enable();
            const weak = testWindows().map(actor => new WeakRef(actor.meta_window));
            await this.close(3); await this.collect();
            this.assertReleased('disable/re-enable while windows live', baseline, weak);
            await this.contextWindow();
            }

            for (let batch = 0; batch < batches; batch++) {
                const previousMenus = panelMenus().map(menu => new WeakRef(menu));
                const profile = ['lyra', 'windows10', 'windows11'][batch % 3];
                settings.set_string('desktop-profile', profile); await wait(180);
                const before = {dockWindows: dock()?._trackedWindows.size ?? 0, handlers: this.connections.counts()};
                this.connections.windows.clear();
                const totals = {...this.connections.totals};
                await this.open(batchSize);
                if (!this.control) this.check(`batch ${batch}: every GTK window tracked`, dock()._trackedWindows.size === before.dockWindows + batchSize);
                if (!this.control) this.check(`batch ${batch}: both components connected all window signals`,
                    this.connections.totals.dock - totals.dock >= batchSize * 5
                    && this.connections.totals.panel - totals.panel >= batchSize * 5);
                const weak = testWindows().map(actor => new WeakRef(actor.meta_window));
                this.exercise(batch); await wait(300);
                // Closing a minimized window exercises the asynchronous animation path too.
                await this.close(batchSize); await this.collect();
                this.assertReleased(`batch ${batch}`, before, weak);
                const currentMenus = panelMenus();
                const retiredMenus = previousMenus.filter(ref => {
                    const menu = ref.deref();
                    return menu && !currentMenus.includes(menu);
                }).length;
                if (retiredMenus) {
                    const targets = previousMenus.map(ref => ref.deref())
                        .filter(menu => menu && !currentMenus.includes(menu))
                        .map(menu => ({address: System.addressOf(menu), label: menu.constructor.name}));
                    GLib.file_set_contents(`${GLib.getenv('SHELIAK_NATIVE_RESULT')}.targets.json`, JSON.stringify(targets));
                    await this.collect();
                    System.dumpHeap(`${GLib.getenv('SHELIAK_NATIVE_RESULT')}.heap`);
                }
                this.check(`batch ${batch}: retired panel menus collected`, retiredMenus === 0, retiredMenus);
                this.connections.windows.clear();
                this.samples.push({batch, profile, closed_windows: this.closed,
                    elapsed_seconds: (GLib.get_monotonic_time() - this.startedAt) / 1e6,
                    handlers: this.connections.counts(), dock_windows: dock()?._trackedWindows.size ?? 0,
                    ...this.memory()});
                this.report(null, true);
                if (GLib.getenv('LYRA_WINDOW_LIFECYCLE_HEAPS') === '1' && (batch === 0 || batch === 2 || batch === batches - 1))
                    System.dumpHeap(`${GLib.getenv('SHELIAK_NATIVE_RESULT')}.batch-${batch}.heap`);
                if (!quick) await wait(4500);
            }
            if (!quick) {
                // Predeclared tolerances: allocator caches need not return RSS to
                // startup. Compare two late 24-batch windows, after warmup.
                const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
                const previous = this.samples.slice(-48, -24), last = this.samples.slice(-24);
                const delta = median(last.map(s => s.rss_kib)) - median(previous.map(s => s.rss_kib));
                const range = Math.max(...last.map(s => s.rss_kib)) - Math.min(...last.map(s => s.rss_kib));
                const heapDelta = median(last.map(s => s.gc_heap_kib)) - median(previous.map(s => s.gc_heap_kib));
                const series = this.samples.slice(24);
                const meanX = series.reduce((sum, s) => sum + s.closed_windows, 0) / series.length;
                const meanY = series.reduce((sum, s) => sum + s.rss_kib, 0) / series.length;
                const slope = series.reduce((sum, s) => sum + (s.closed_windows - meanX) * (s.rss_kib - meanY), 0)
                    / series.reduce((sum, s) => sum + (s.closed_windows - meanX) ** 2, 0);
                this.memoryGate = {median_growth_kib: delta, last_range_kib: range, slope_kib_per_window: slope,
                    gc_heap_median_growth_kib: heapDelta,
                    limits: {median_growth_kib: 16384, last_range_kib: 32768, slope_kib_per_window: 16, gc_heap_median_growth_kib: 8192}};
                this.check('post-warmup Shell memory stabilizes within declared bounds', delta <= 16384 && range <= 32768
                    && slope <= 16 && heapDelta <= 8192,
                    this.memoryGate);
            }
        } finally {
            this.client.force_exit();
            this.input.close(null);
            this.connections.destroy();
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            shell.set_strv('enabled-extensions', shell.get_strv('enabled-extensions')
                .filter(id => !['dock', 'panel', 'menus', 'search', 'animations', 'desktop-icons'].some(role => id === `${role}@lyraos.com.br`)));
            await wait(350);
        }
    }
}
