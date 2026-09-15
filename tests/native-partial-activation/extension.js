import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const roles = ['dock', 'panel', 'menus', 'search', 'animations', 'desktop-icons'];
const wait = ms => new Promise(resolve => GLib.timeout_add(0, ms, () => { resolve(); return GLib.SOURCE_REMOVE; }));
const record = role => Main.extensionManager.lookup(`${role}@lyraos.com.br`);
const ext = role => record(role).stateObj;
function override(object, key, callback) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key), original = object[key];
    Object.defineProperty(object, key, descriptor && !descriptor.configurable
        ? {...descriptor, value: callback(original)}
        : {value: callback(original), configurable: true, writable: true});
    return () => {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
    };
}
function tree(actor) {
    return [actor, ...actor.get_children().flatMap(tree)];
}
function snapshot() {
    const actors = tree(Main.uiGroup);
    return {
        chrome: Main.layoutManager._trackedActors.map(item => item.actor),
        actors,
        ownedActors: actors.filter(actor => actor instanceof St.Widget &&
            (actor.get_style_class_name() ?? '').includes('sheliak')),
        status: Object.keys(Main.panel.statusArea).sort(),
        classes: Main.panel.get_style_class_name(), style: Main.panel.get_style(),
        uiClass: Main.uiGroup.get_style_class_name(),
        geometry: [Main.panel.margin_top, Main.panel.margin_bottom, Main.panel.margin_left, Main.panel.margin_right],
    };
}

// Observe only durable external signal sources; never access a disposed actor.
// Capturing connection IDs proves that constructors release resources before
// an object can be registered with the extension's Scope.
function themeFiles() {
    const directory = Gio.File.new_for_path(GLib.get_tmp_dir());
    const enumerator = directory.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const files = [];
    try {
        let info;
        while ((info = enumerator.next_file(null)))
            if (info.get_name().startsWith('sheliak-menu-theme-')) files.push(info.get_name());
    } finally { enumerator.close(null); }
    return files;
}
function resources() {
    const connections = [], subscriptions = [], filesBefore = themeFiles(), restores = [];
    const durable = new Set([global.display, global.window_manager, global.stage, global.workspace_manager,
        Main.panel, ...[Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox],
        Main.layoutManager.panelBox, St.Settings.get(), St.ThemeContext.get_for_stage(global.stage),
        Shell.AppSystem.get_default(), Gio.VolumeMonitor.get()]);
    for (const method of ['connect', 'connect_after']) restores.push(override(GObject.Object.prototype, method, original => function (signal, callback) {
        const id = original.call(this, signal, callback);
        if (durable.has(this) || this instanceof Gio.Settings || this instanceof Gio.FileMonitor || this instanceof Shell.App)
            connections.push({source: this, id, signal});
        return id;
    }));
    for (const object of [Main.layoutManager, Main.overview, Main.extensionManager, AppFavorites.getAppFavorites()]) {
        restores.push(override(object, 'connect', original => function (signal, callback) {
            const id = original.call(this, signal, callback);
            connections.push({source: this, id, signal, js: true});
            return id;
        }));
        restores.push(override(object, 'disconnect', original => function (id) {
            const entry = connections.find(item => item.source === this && item.id === id && item.js);
            if (entry) entry.removed = true;
            return original.call(this, id);
        }));
    }
    restores.push(override(Gio.DBus.session, 'signal_subscribe', original => function (...args) {
        const id = original.apply(this, args); subscriptions.push({source: this, id}); return id;
    }));
    restores.push(override(Gio.DBus.session, 'signal_unsubscribe', original => function (id) {
        const entry = subscriptions.find(item => item.source === this && item.id === id);
        if (entry) entry.removed = true;
        return original.call(this, id);
    }));
    return {
        restore() { for (const restore of restores.reverse()) restore(); },
        remaining() {
            return {
                connections: connections.filter(entry => entry.js ? !entry.removed : GObject.signal_handler_is_connected(entry.source, entry.id))
                    .map(entry => entry.signal),
                subscriptions: subscriptions.filter(entry => !entry.removed).length,
                files: themeFiles().filter(name => !filesBefore.includes(name)),
            };
        },
    };
}

export default class PartialActivationProbe extends Extension {
    enable() {
        // GNOME can rebase this probe while disabling earlier extensions.
        // The qualification must run only once per private Shell instance.
        if (this.started) return;
        this.started = true;
        this.checks = [];
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({status: error ? 'failed' : 'passed',
            checks: this.checks, error: error ? String(error) : null, stack: error?.stack}, null, 2));
    }
    check(name, passed, detail) {
        this.checks.push({name, passed: !!passed, detail});
        if (!passed) throw Error(`${name}: ${JSON.stringify(detail)}`);
    }
    async scenario({role, name, object, method = 'connect', matches, after = false, fallback = false, startup = false}) {
        console.log(`LYRA_CASE_BEGIN ${role}/${name}`);
        ext(role).disable(); await wait(450);
        const peers = roles.filter(other => other !== role).map(other => [other,
            other === 'desktop-icons' ? ext(other).data.isEnabled : ext(other).running]);
        const before = snapshot(), nativeDecision = Main.wm._shouldAnimateActor;
        const observers = resources();
        let hit = false, thrown = null;
        const failure = Error(`LYRA_INJECTED:${role}:${name}`);
        const restore = override(object, method, original => function (...args) {
            if (!hit && matches.call(this, ...args)) {
                hit = true;
                if (after) original.apply(this, args);
                throw failure;
            }
            return original.apply(this, args);
        });
        const restoreStartup = startup ? override(Main.layoutManager, '_startingUp', () => true) : () => {};
        try { ext(role).enable(); }
        catch (error) { thrown = error; }
        finally { restore(); restoreStartup(); }
        try {
            this.check(`${role}/${name}: injection reached`, hit);
            this.check(`${role}/${name}: original error or documented native fallback`, fallback ? !thrown : thrown === failure, String(thrown));
            await wait(350);
            const remaining = observers.remaining();
            this.check(`${role}/${name}: external resources released`, !remaining.connections.length && !remaining.subscriptions && !remaining.files.length, remaining);
            const state = snapshot();
            this.check(`${role}/${name}: no extra actors/chrome/indicators`,
                state.actors.length <= before.actors.length && state.ownedActors.every(actor => before.ownedActors.includes(actor)) &&
                state.chrome.length === before.chrome.length &&
                state.chrome.every(actor => before.chrome.includes(actor)) && JSON.stringify(state.status) === JSON.stringify(before.status),
                {actorsBefore: before.actors.length, actorsAfter: state.actors.length, chromeBefore: before.chrome.length, chromeAfter: state.chrome.length, status: state.status,
                    extraOwned: state.ownedActors.filter(actor => !before.ownedActors.includes(actor)).map(actor => actor.get_style_class_name())});
            this.check(`${role}/${name}: native appearance and animation decision restored`,
                state.classes === before.classes && state.style === before.style && state.uiClass === before.uiClass &&
                JSON.stringify(state.geometry) === JSON.stringify(before.geometry) && Main.wm._shouldAnimateActor === nativeDecision);
            this.check(`${role}/${name}: peers remain usable`, peers.every(([other, enabled]) => enabled ===
                (other === 'desktop-icons' ? ext(other).data.isEnabled : ext(other).running)));
        } finally { observers.restore(); }
        ext(role).disable(); // Repeated cleanup must not touch disposed actors.
        ext(role).enable(); await wait(550);
        this.check(`${role}/${name}: reactivation succeeds`, role === 'desktop-icons' ? ext(role).data.isEnabled && !!ext(role).data.currentProcess : ext(role).running);
        console.log(`LYRA_CASE_END ${role}/${name}`);
    }
    async asynchronousDesktopFailure() {
        ext('desktop-icons').disable(); await wait(500);
        const observers = resources(), failure = Error('LYRA_INJECTED:desktop-icons:dbus-actions');
        const nativeActors = Shell.Global.prototype.get_window_actors;
        let reported = null;
        const restoreLog = override(Main.extensionManager, 'logExtensionError', original => function (uuid, error) {
            if (uuid === 'desktop-icons@lyraos.com.br') reported = error;
            return original.call(this, uuid, error);
        });
        const restore = override(GObject.Object.prototype, 'connect', original => function (signal, callback) {
            if (this instanceof Gio.SimpleAction && this.name === 'doCut' && signal === 'activate') throw failure;
            return original.call(this, signal, callback);
        });
        try {
            ext('desktop-icons').enable();
            for (let i = 0; i < 30 && !reported; i++) await wait(50);
            this.check('desktop-icons/dbus: original asynchronous error reported by GNOME', reported === failure && record('desktop-icons').error.includes('LYRA_INJECTED'));
            this.check('desktop-icons/dbus: partial service and process cleared', !ext('desktop-icons').data.isEnabled &&
                !ext('desktop-icons').data.currentProcess && !ext('desktop-icons').data.dbusConnectionId && !ext('desktop-icons').data.dbusConnectionGroupId);
            const remaining = observers.remaining();
            this.check('desktop-icons/dbus: external resources and native method restored',
                !remaining.connections.length && !remaining.subscriptions && !remaining.files.length &&
                Shell.Global.prototype.get_window_actors === nativeActors, remaining);
            this.check('desktop-icons/dbus: other five components remain enabled', roles.filter(role => role !== 'desktop-icons').every(role => ext(role).running));
        } finally { restore(); restoreLog(); observers.restore(); }
        ext('desktop-icons').disable();
        // Direct fault injection consumed the old activation without passing
        // through GNOME's disable path. Remove its order entry before asking
        // the actual activation path to insert the restored instance.
        Main.extensionManager._extensionOrder = Main.extensionManager._extensionOrder
            .filter(uuid => uuid !== 'desktop-icons@lyraos.com.br');
        Main.extensionManager._changeExtensionState(record('desktop-icons'), 2);
        await Main.extensionManager._callExtensionEnable('desktop-icons@lyraos.com.br');
        await wait(700);
        this.check('desktop-icons/dbus: GNOME reactivation restores helper', record('desktop-icons').state === 1 && !!ext('desktop-icons').data.currentProcess);
    }
    async run() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private compositor required');
        await wait(2500); Main.overview.hide(); await wait(400);
        this.settings = ext('dock').getSettings('org.gnome.shell.extensions.sheliak');
        const panel = Main.panel, appSystem = Shell.AppSystem.get_default();
        let themeConnections = 0;
        const cases = [
            {role: 'dock', name: 'trash-click', object: GObject.Object.prototype,
                matches(signal) { return signal === 'clicked' && this instanceof St.Button && this.has_style_class_name('sheliak-trash-button'); }},
            {role: 'dock', name: 'magnifier-settings', object: St.Settings.get(), matches: signal => signal === 'notify::enable-animations'},
            {role: 'dock', name: 'chrome-after-insert', object: Main.layoutManager, method: 'addChrome', after: true,
                matches: actor => actor.get_name() === 'lyraDockTrigger'},
            {role: 'dock', name: 'app-system', object: appSystem, matches: signal => signal === 'installed-changed'},
            {role: 'dock', name: 'app-icon', object: GObject.Object.prototype,
                matches(signal) { return this instanceof Shell.App && signal === 'windows-changed'; }},
            {role: 'panel', name: 'class-tracking', object: panel, matches: signal => signal === 'destroy'},
            {role: 'panel', name: 'surface-theme', object: St.ThemeContext.get_for_stage(global.stage),
                matches: signal => signal === 'changed'},
            {role: 'panel', name: 'theme-file', object: St.ThemeContext.get_for_stage(global.stage),
                matches: signal => signal === 'changed' && ++themeConnections === 2},
            {role: 'panel', name: 'bottom-panel', object: Main.layoutManager.panelBox, matches: signal => signal === 'notify::y'},
            {role: 'menus', name: 'applications', object: appSystem, matches: signal => signal === 'installed-changed'},
            {role: 'menus', name: 'places-volumes', object: Gio.VolumeMonitor.get(), matches: signal => signal === 'mount-removed'},
            {role: 'menus', name: 'system-after-insert', object: panel, method: 'addToStatusArea', after: true,
                matches: name => name === 'sheliak-system'},
            {role: 'search', name: 'entry-width', object: panel, matches: signal => signal === 'notify::width'},
            {role: 'search', name: 'popup-after-insert', object: Main.uiGroup, method: 'add_child', after: true,
                matches: actor => actor.has_style_class_name('sheliak-search-results')},
            {role: 'search', name: 'index', object: appSystem, matches: signal => signal === 'installed-changed'},
            {role: 'animations', name: 'compositor-connect', object: global.window_manager, fallback: true,
                matches: signal => signal === 'kill-window-effects'},
            {role: 'animations', name: 'decision-install', object: Object, method: 'defineProperty', fallback: true,
                matches: (object, key) => object === Main.wm && key === '_shouldAnimateActor'},
            {role: 'desktop-icons', name: 'startup-connection', object: Main.layoutManager, startup: true,
                matches: signal => signal === 'startup-complete'},
            {role: 'desktop-icons', name: 'window-emulation', object: global.window_manager, method: 'connect_after',
                matches: signal => signal === 'destroy'},
            {role: 'desktop-icons', name: 'monitor-geometry', object: global.display, matches: signal => signal === 'workareas-changed'},
        ];
        try {
            const only = GLib.getenv('LYRA_PARTIAL_CASE');
            for (const item of cases.filter(item => !only || item.name === only)) await this.scenario(item);
            if (only) return;
            this.settings.set_string('desktop-profile', 'windows10'); await wait(600);
            await this.scenario({role: 'menus', name: 'overlay-key', object: global.display, matches: signal => signal === 'overlay-key'});
            ext('dock').disable(); await wait(500);
            let installations = 0;
            await this.scenario({role: 'menus', name: 'start-menu-without-dock', object: appSystem,
                matches: signal => signal === 'installed-changed' && ++installations === 2});
            ext('dock').enable(); await wait(600);
            this.settings.set_string('desktop-profile', 'lyra'); await wait(600);
            await this.asynchronousDesktopFailure();
        } finally {
            const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
            shell.set_strv('enabled-extensions', shell.get_strv('enabled-extensions').filter(uuid => !roles.some(role => uuid === `${role}@lyraos.com.br`)));
            for (let i = 0; i < 50 && roles.some(role => role === 'desktop-icons'
                ? ext(role).data.isEnabled : ext(role).running); i++) await wait(100);
            await wait(500);
            this.check('private teardown: all components disabled', roles.every(role => role === 'desktop-icons'
                ? !ext(role).data.isEnabled && !ext(role).data.currentProcess : !ext(role).running));
        }
    }
}
