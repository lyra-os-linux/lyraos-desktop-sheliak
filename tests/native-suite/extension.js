import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const roles = ['dock', 'panel', 'menus', 'search', 'animations', 'desktop-icons'];
const uuid = role => `${role}@lyraos.com.br`;
const ext = role => Main.extensionManager.lookup(uuid(role));
const api = role => ext(role)?.stateObj?.lyraApi?.current;

export default class SuiteTest extends Extension {
    enable() {
        // The GTK regression deliberately toggles GNOME's global extension
        // switch. Re-enabling this probe must not launch a competing test run.
        if (this._started) return;
        this._started = true;
        this.checks = [];
        this.run().then(() => this.report()).catch(error => this.report(error));
    }
    disable() {}
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({
            status: !error && this.checks.every(c => c.passed) ? 'passed' : 'failed',
            checks: this.checks, error: error ? String(error) : null, stack: error?.stack,
        }, null, 2));
    }
    check(name, passed, detail = null) { this.checks.push({name, passed: !!passed, detail}); }
    async command(argv, parse = true) {
        const process = new Gio.Subprocess({argv, flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
        process.init(null);
        const [stdout, stderr] = await new Promise((resolve, reject) => process.communicate_utf8_async(null, null, (source, result) => {
            try { const [, out, err] = source.communicate_utf8_finish(result); resolve([out, err]); }
            catch (error) { reject(error); }
        }));
        if (!process.get_successful()) throw Error(`${argv.join(' ')}: ${stderr}`);
        return parse ? JSON.parse(stdout) : stdout.trim();
    }
    async toggle(role, enabled) {
        const settings = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const current = settings.get_strv('enabled-extensions').filter(id => id !== uuid(role));
        settings.set_strv('enabled-extensions', enabled ? [...current, uuid(role)] : current);
        await wait(250);
        this.check(`${role} ${enabled ? 'enabled' : 'disabled'}`, ext(role)?.state === (enabled ? 1 : 2), ext(role)?.state);
    }
    async run() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private test only');
        await wait(1800);
        const helperPath = GLib.getenv('LYRA_NATIVE_SUITE_HELPER');
        if (GLib.getenv('LYRA_NATIVE_LEGACY_MIGRATION') === '1') {
            const legacyIds = ['sheliak@lyraos.com.br', 'ding@rastersoft.com'];
            for (const id of legacyIds)
                this.check(`legacy ${id} initially active`, Main.extensionManager.lookup(id)?.state === 1);
            const old = Main.extensionManager.lookup('sheliak@lyraos.com.br').stateObj.getSettings('org.gnome.shell.extensions.sheliak');
            old.set_uint('icon-size', 56);
            const ding = Main.extensionManager.lookup('ding@rastersoft.com').stateObj.getSettings('org.gnome.shell.extensions.ding');
            ding.set_boolean('show-trash', false);
            await this.command([helperPath, 'migrate']);
            await wait(2000);
            for (const id of legacyIds)
                this.check(`legacy ${id} disabled before replacement`, Main.extensionManager.lookup(id)?.state !== 1);
            this.check('old dock preference preserved', ext('dock').stateObj.getSettings('org.gnome.shell.extensions.sheliak').get_uint('icon-size') === 56);
            this.check('old desktop preference migrated', !ext('desktop-icons').stateObj.getSettings('org.gnome.shell.extensions.lyra-desktop-icons').get_boolean('show-trash'));
            await this.command([helperPath, 'rollback']);
            await wait(1200);
            for (const id of legacyIds)
                this.check(`rollback restores ${id}`, Main.extensionManager.lookup(id)?.state === 1);
            for (const role of roles)
                this.check(`rollback disables ${role}`, ext(role)?.state !== 1);
            await this.command([helperPath, 'migrate']);
            await wait(2000);
        }
        for (const role of roles) this.check(`${role} active`, ext(role)?.state === 1, ext(role)?.error);
        const settings = ext('dock').stateObj.getSettings('org.gnome.shell.extensions.sheliak');
        await wait(1500);
        const desktop = ext('desktop-icons').stateObj;
        this.check('LDI helper creates desktop windows', desktop.data.x11Manager._windowList.length > 0,
            desktop.data.x11Manager._windowList.length);
        this.check('desktop fixture remains present', Gio.File.new_for_path(`${GLib.get_home_dir()}/Desktop/Fixture.txt`).query_exists(null));
        const helper = GLib.getenv('LYRA_NATIVE_SUITE_HELPER');
        if (helper) {
            const call = (...args) => this.command([helper, ...args]);
            await call('migrate');
            const crashProbe = GLib.getenv('LYRA_NATIVE_PROFILE_CRASH_PROBE');
            if (crashProbe) {
                const before = settings.get_uint('icon-size');
                await this.command(['/usr/bin/python3', crashProbe, helper], false);
                let refused = false;
                try { await call('status'); } catch (_) { refused = true; }
                this.check('interrupted Vega transaction does not report success', refused);
                await call('migrate');
                this.check('interrupted Vega restores complete layout', settings.get_uint('icon-size') === before);
                const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
                this.check('recovery preserves concurrent third-party choice', shell.get_strv('enabled-extensions').includes('recovery-test@example.org'));
            }
            await call('toggle', 'desktop-icons', 'off');
            await call('apply', 'windows10');
            await call('toggle', 'search', 'off');
            await call('toggle', 'animations', 'off');
            await call('apply', 'macos');
            const restored = await call('apply', 'windows10');
            this.check('component choices restored with profile', !restored.components.animations && !restored.components.search);
            this.check('desktop choice independent of profile', !restored.components['desktop-icons']);
            const vanilla = await call('apply', 'vanilla');
            this.check('vanilla disables only shell components', roles.every(r => !vanilla.components[r]));
            await call('apply', 'lyra');
            await call('toggle', 'desktop-icons', 'on');
            await call('migrate');
            const repeated = await call('status');
            this.check('completed migration does not reset choices', repeated.profile === 'lyra' && repeated.components['desktop-icons']);
            await wait(500);
        }
        const vega = GLib.getenv('LYRA_NATIVE_VEGA_BINARY');
        if (vega) {
            for (const profile of ['windows10', 'windows11', 'macos', 'ubuntu', 'vanilla', 'lyra']) {
                const actual = await this.command([vega, '--desktop-profile', 'set', profile], false);
                this.check(`real Vega profile ${profile}`, actual === profile, actual);
            }
        }
        const testBinary = GLib.getenv('VEGA_DESKTOP_TEST_BINARY');
        if (testBinary) {
            await this.command([testBinary, '--ignored', 'ui::screen::desktop_tests::native_desktop_switch',
                '--exact', '--nocapture', '--test-threads=1'], false);
            this.check('real GTK component and desktop switches', true);
            await wait(500);
        }
        this.check('native dash hidden by Dock', !Main.overview.dash.visible);
        for (const profile of ['windows10', 'windows11', 'macos', 'ubuntu', 'lyra']) {
            settings.set_string('desktop-profile', profile);
            await wait(250);
            const hosted = profile.startsWith('windows');
            this.check(`${profile} dock host`, !!api('dock')?.panel === hosted);
            this.check(`${profile} panel layout`, !!api('panel')?.active === hosted);
        }
        settings.set_string('desktop-profile', 'windows10');
        await wait(250);
        await this.toggle('panel', false);
        this.check('Dock detached before panel teardown', api('dock')?.panel === null);
        this.check('Dock still has a live actor', !!api('dock')?.dock.actor.get_stage());
        await this.toggle('panel', true);
        this.check('Dock reattached after panel enable', !!api('dock')?.panel);
        await this.toggle('dock', false);
        this.check('fallback L button exists', !!Main.panel.statusArea['lyra-start']);
        this.check('native dash restored without Dock', Main.overview.dash.visible);
        await this.toggle('menus', false);
        this.check('fallback L removed with Menus', !Main.panel.statusArea['lyra-start']);
        await this.toggle('dock', true);
        this.check('Dock works without Menus', !!api('dock')?.dock.actor.get_stage());
        await this.toggle('menus', true);
        this.check('fallback L removed after Dock returns', !Main.panel.statusArea['lyra-start']);
        // Completely different activation order exercises provider discovery.
        for (const role of roles) await this.toggle(role, false);
        this.check('native dash restored after full disable', Main.overview.dash.visible);
        this.check('no orphaned Dock trigger after full disable', !Main.uiGroup.get_children().some(a => a.name === 'lyraDockTrigger'));
        for (const role of ['menus', 'desktop-icons', 'search', 'animations', 'panel', 'dock']) await this.toggle(role, true);
        this.check('late Dock/Panel discover each other', !!api('dock')?.panel);
        for (const role of roles) this.check(`${role} remains active`, ext(role)?.state === 1, ext(role)?.error);
        for (const role of roles) await this.toggle(role, false);
    }
}
