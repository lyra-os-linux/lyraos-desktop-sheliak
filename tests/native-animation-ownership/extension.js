import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const ext = () => Main.extensionManager.lookup('animations@lyraos.com.br').stateObj;
function masked(object, key, value, callback) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, {value, configurable: true, writable: true});
    try { return callback(); }
    finally {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
    }
}

export default class AnimationOwnershipProbe extends Extension {
    enable() {
        this.checks = [];
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({
            status: error ? 'failed' : 'passed', checks: this.checks,
            error: error ? String(error) : null, stack: error?.stack,
        }, null, 2));
    }
    check(name, passed, detail) {
        this.checks.push({name, passed: !!passed, detail});
        if (!passed) throw Error(`${name}: ${JSON.stringify(detail)}`);
    }
    enableAnimations() {
        const own = ext().scope.own;
        masked(ext().scope, 'own', function (object) {
            globalThis.__animationManagerForProbe = object;
            return own.call(this, object);
        }, () => ext().enable());
        this.manager = globalThis.__animationManagerForProbe;
        delete globalThis.__animationManagerForProbe;
    }
    idle(name) {
        this.check(`${name}: all owned operations released`, this.manager._activeAnimations.size === 0 &&
            (this.manager._bridge?._pending.size ?? 0) === 0);
        this.check(`${name}: GNOME bookkeeping settled`, Main.wm._minimizing.size === 0 && Main.wm._unminimizing.size === 0);
    }
    async cycle(actor, name, custom = true, rapid = false) {
        const before = {...this.counts};
        actor.meta_window.minimize();
        await wait(rapid ? 35 : 70);
        if (custom) this.check(`${name}: custom transform started`, this.manager._activeAnimations.size === 1);
        if (!rapid) await wait(530);
        if (!rapid) this.check(`${name}: minimize completed`, !actor.visible && actor.meta_window.minimized);
        actor.meta_window.unminimize();
        actor.meta_window.activate(global.get_current_time());
        await wait(600);
        this.check(`${name}: restored with normal transform`, actor.visible && !actor.meta_window.minimized &&
            actor.opacity === 255 && actor.scale_x === 1 && actor.scale_y === 1 &&
            actor.translation_x === 0 && actor.translation_y === 0 &&
            actor.x === actor.meta_window.get_buffer_rect().x && actor.y === actor.meta_window.get_buffer_rect().y,
        {visible: actor.visible, opacity: actor.opacity, scale: actor.scale_x, translation: actor.translation_x});
        this.check(`${name}: native completion exactly once per operation`,
            this.counts.minimize - before.minimize === 1 && this.counts.unminimize - before.unminimize === 1,
            {before, after: {...this.counts}});
        this.check(`${name}: foreign handlers before and after enable both ran`,
            this.counts.early - before.early === 2 && this.counts.late - before.late === 2);
        this.idle(name);
    }
    async run() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private compositor required');
        await wait(2200); Main.overview.hide(); await wait(350);
        ext().disable();
        const wm = Main.wm, swm = global.window_manager, nativeDecision = wm._shouldAnimateActor;
        this.check('Native decision initially has no instance override', !Object.hasOwn(wm, '_shouldAnimateActor'));
        const settings = ext().getSettings('org.gnome.shell.extensions.sheliak');
        this.counts = {minimize: 0, unminimize: 0, early: 0, late: 0};
        const saved = {}, ids = [];
        for (const signal of ['minimize', 'unminimize']) {
            const key = `completed_${signal}`;
            saved[key] = swm[key];
            const counts = this.counts;
            swm[key] = function (actor) { counts[signal]++; return saved[key].call(this, actor); };
            ids.push(swm.connect(signal, () => this.counts.early++));
        }
        this.enableAnimations();
        this.check('Safe request bridge enabled', !!this.manager._bridge);
        for (const signal of ['minimize', 'unminimize']) ids.push(swm.connect(signal, () => this.counts.late++));
        const process = Gio.Subprocess.new(['/usr/bin/python3', '-c',
            "import gi; gi.require_version('Gtk','4.0'); from gi.repository import Gtk; app=Gtk.Application(application_id='org.lyraos.AnimationOwnership'); app.connect('activate',lambda a: Gtk.ApplicationWindow(application=a,title='Lyra animation ownership',default_width=420,default_height=280).present()); app.run(None)"],
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        try {
            let actor;
            for (let i = 0; i < 40 && !actor?.visible; i++) {
                await wait(100);
                actor = global.get_window_actors().find(a => a.meta_window?.get_title() === 'Lyra animation ownership');
            }
            this.check('Real GTK window mapped', actor?.visible); await wait(600);
            for (const mode of ['zoom', 'fade', 'none']) {
                settings.set_string('minimize-animation', mode);
                await this.cycle(actor, mode, mode !== 'none');
            }
            settings.set_string('minimize-animation', 'zoom');
            actor.meta_window.make_fullscreen(); await wait(400);
            await this.cycle(actor, 'fullscreen window');
            actor.meta_window.unmake_fullscreen(); await wait(400);
            for (let i = 0; i < 12; i++) await this.cycle(actor, `rapid ${i + 1}`, true, true);

            actor.meta_window.minimize(); await wait(30);
            ext().disable(); await wait(100);
            this.check('Disable in flight restores native decision', wm._shouldAnimateActor === nativeDecision && !Object.hasOwn(wm, '_shouldAnimateActor'));
            this.idle('disable in flight');
            actor.meta_window.unminimize(); actor.meta_window.activate(global.get_current_time()); await wait(600);
            await this.cycle(actor, 'fully disabled native path', false);
            this.enableAnimations();

            // An allocation failure after one timeline callback was connected.
            const connect = Clutter.Timeline.prototype.connect;
            Clutter.Timeline.prototype.connect = function (signal, callback) {
                if (signal === 'completed') throw Error('Injected timeline connection failure');
                return connect.call(this, signal, callback);
            };
            try { actor.meta_window.minimize(); await wait(100); }
            finally { delete Clutter.Timeline.prototype.connect; }
            await wait(500);
            this.check('Partial timeline failure delegates native minimize', !actor.visible && actor.meta_window.minimized);
            this.idle('timeline rollback');
            actor.meta_window.unminimize(); actor.meta_window.activate(global.get_current_time()); await wait(600);

            // A foreign actor override is left in place and receives the request.
            let foreignEase = 0;
            const ease = actor.ease;
            const otherEase = function (params) { foreignEase++; return ease.call(this, params); };
            actor.ease = otherEase;
            await this.cycle(actor, 'foreign actor override', false);
            this.check('Foreign actor ease retained', actor.ease === otherEase && foreignEase === 2);
            delete actor.ease;

            ext().disable();
            const otherBefore = function (...args) { return nativeDecision.apply(this, args); };
            wm._shouldAnimateActor = otherBefore;
            this.enableAnimations();
            this.check('Pre-existing decision override selects native fallback', !this.manager._bridge);
            await this.cycle(actor, 'foreign decision before enable', false);
            ext().disable();
            this.check('Pre-existing decision override preserved', wm._shouldAnimateActor === otherBefore);
            delete wm._shouldAnimateActor;
            this.enableAnimations();
            const retained = wm._shouldAnimateActor;
            const otherAfter = function (...args) { return retained.apply(this, args); };
            wm._shouldAnimateActor = otherAfter;
            await this.cycle(actor, 'foreign decision after enable', false);
            ext().disable();
            this.check('Later decision override preserved', wm._shouldAnimateActor === otherAfter);
            await this.cycle(actor, 'retained inactive wrapper', false);
            delete wm._shouldAnimateActor;
            this.enableAnimations();
            await this.cycle(actor, 're-enabled custom animation');

            actor.meta_window.minimize(); await wait(20); process.force_exit(); await wait(700);
            this.idle('window closed during animation');
            ext().disable();
            this.check('All unrelated signal handlers remain connected', ids.every(id => GObject.signal_handler_is_connected(swm, id)));
            this.check('Final native decision restored', wm._shouldAnimateActor === nativeDecision && !Object.hasOwn(wm, '_shouldAnimateActor'));
        } finally {
            ext().disable(); process.force_exit();
            for (const id of ids) swm.disconnect(id);
            for (const key of Object.keys(saved)) delete swm[key];
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            shell.set_strv('enabled-extensions', shell.get_strv('enabled-extensions')
                .filter(uuid => !uuid.endsWith('@lyraos.com.br')));
            await wait(400);
        }
    }
}
