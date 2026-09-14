import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const ext = role => Main.extensionManager.lookup(`${role}@lyraos.com.br`).stateObj;
const api = role => ext(role)?.lyraApi?.current;

// Mask capabilities only during synchronous extension activation, restoring
// them before GNOME's own frame callbacks. Never inject faults into the host.
function masked(object, key, value, callback) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, {value, configurable: true, writable: true});
    try { return callback(); }
    finally {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
    }
}

export default class CompatibilityProbe extends Extension {
    enable() {
        if (this.started) return;
        this.started = true;
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
    check(name, passed) {
        this.checks.push({name, passed: !!passed});
        if (!passed) throw Error(name);
    }
    restart(role, mask = callback => callback()) {
        ext(role).disable();
        mask(() => ext(role).enable());
        this.check(`${role}: activation completed`, ext(role).running);
    }
    async nativeAnimationWorks() {
        const process = Gio.Subprocess.new(['/usr/bin/python3', '-c',
            "import gi; gi.require_version('Gtk','4.0'); from gi.repository import Gtk; app=Gtk.Application(application_id='org.lyraos.CompatProbe'); app.connect('activate',lambda a: Gtk.ApplicationWindow(application=a,title='Lyra compatibility',default_width=320,default_height=200).present()); app.run(None)"],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        try {
            let actor;
            for (let i = 0; i < 30 && !actor?.visible; i++) {
                await wait(100);
                actor = global.get_window_actors().find(a => a.meta_window?.get_title() === 'Lyra compatibility');
            }
            this.check('Native fallback: real GTK window mapped', actor?.visible);
            actor.meta_window.minimize();
            await wait(550);
            this.check('Native fallback: minimize completes', actor.meta_window.minimized && !actor.visible);
            actor.meta_window.unminimize();
            actor.meta_window.activate(global.get_current_time());
            await wait(550);
            this.check('Native fallback: restore completes', !actor.meta_window.minimized && actor.visible);
        } finally { process.force_exit(); await wait(150); }
    }
    async run() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private compositor required');
        await wait(2200);
        Main.overview.hide();
        await wait(350);
        const settings = ext('dock').getSettings('org.gnome.shell.extensions.sheliak');
        this.check('Initial Dock alive', !!api('dock').dock.actor.get_stage());
        for (const profile of ['windows10', 'windows11', 'lyra']) {
            settings.set_string('desktop-profile', profile);
            await wait(300);
            this.check(`${profile}: normal panel capability`, api('panel').active === profile.startsWith('windows'));
        }

        this.restart('panel', callback => masked(Main.panel, '_rightBox', undefined, callback));
        settings.set_uint('panel-height', 38);
        await wait(200);
        this.check('Missing right box preserves basic panel settings', Main.panel.height === 38);
        this.check('Missing right box preserves Dock', !!api('dock').dock.actor.get_stage());
        settings.set_uint('panel-height', 32);
        this.restart('panel');

        settings.set_string('desktop-profile', 'windows10');
        await wait(250);
        for (const key of ['_trackedActors', '_destroyPanelBarrier', '_updatePanelBarrier']) {
            ext('panel').disable();
            const barrier = Main.layoutManager._updatePanelBarrier;
            masked(Main.layoutManager, key, undefined, () => ext('panel').enable());
            await wait(200);
            this.check(`${key} absent: bottom panel stays inactive`, !api('panel').active);
            this.check(`${key} absent: Dock works independently`, api('dock').panel === null && !!api('dock').dock.actor.get_stage());
            this.check(`${key} absent: native barrier unchanged`, Main.layoutManager._updatePanelBarrier === barrier);
            this.restart('panel');
            await wait(200);
            this.check(`${key} restored: bottom panel works`, api('panel').active);
        }

        settings.set_string('desktop-profile', 'lyra');
        settings.set_string('panel-menu-position', 'right');
        await wait(250);
        for (const role of ['menus', 'search']) {
            this.restart(role, callback => masked(Main.panel, '_rightBox', undefined, callback));
            await wait(200);
            const controller = ext(role)._controller;
            const button = role === 'menus' ? controller._applications.button : controller._search.button;
            this.check(`${role}: missing requested box falls back to left`, button.container.get_parent() === Main.panel._leftBox);
            this.check(`${role}: missing layout uses compact fallback`, controller._compact);
            this.restart(role);
        }
        settings.set_string('panel-menu-position', 'left');
        await wait(200);

        this.restart('dock', callback => masked(Main.overview, 'dash', undefined, callback));
        await wait(200);
        this.check('Missing native dash does not disable Lyra Dock', !!api('dock').dock.actor.get_stage());
        this.restart('dock');
        await wait(200);

        this.restart('animations', callback => masked(global.window_manager, 'completed_minimize', undefined, callback));
        this.check('Missing animation completion keeps other components alive', !!api('dock').dock.actor.get_stage() && ext('panel').running);
        await this.nativeAnimationWorks();
        ext('animations').disable();
        const connect = global.window_manager.connect;
        masked(global.window_manager, 'connect', function (signal, callback) {
            if (signal === 'unminimize') throw Error('Injected connection failure');
            return connect.call(this, signal, callback);
        }, () => ext('animations').enable());
        await this.nativeAnimationWorks();
        this.restart('animations');

        ext('search').disable();
        let rejected = false;
        try { masked(Main.extensionManager, 'lookup', undefined, () => ext('search').enable()); }
        catch (_) { rejected = true; }
        this.check('Missing mandatory discovery refuses activation before mutation', rejected && !ext('search').running);
        this.check('Discovery failure leaves Dock alive', !!api('dock').dock.actor.get_stage());
        this.restart('search');
        this.check('Final native dash hidden by working Dock', !Main.overview.dash.visible);
        for (const role of ['dock', 'panel', 'menus', 'search', 'animations'])
            this.check(`${role}: fully restored`, ext(role).running);
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        shell.set_strv('enabled-extensions', shell.get_strv('enabled-extensions')
            .filter(uuid => !uuid.endsWith('@lyraos.com.br')));
        await wait(350);
    }
}
