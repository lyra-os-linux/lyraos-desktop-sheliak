import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
export default class DesktopTest extends Extension {
    enable() { this.checks = []; this.run().then(() => this.report()).catch(e => this.report(e)); }
    disable() {}
    check(name, passed, detail = null) { this.checks.push({name, passed: !!passed, detail}); }
    windows() {
        // DING deliberately filters desktop surfaces out of Shell's normal
        // window lists. Its Wayland manager retains the actual mapped windows.
        return Main.extensionManager.lookup('ding@rastersoft.com')?.stateObj?.data.x11Manager?._windowList ?? [];
    }
    async toggle(action) {
        const launcher = new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
        launcher.setenv('VEGA_DESKTOP_ICONS_TEST_ACTION', action, true);
        const test = action === 'ui' ? 'ui::screen::desktop_tests::native_desktop_switch' : 'dock::profile_tests::desktop_icons_native_toggle';
        const process = launcher.spawnv([GLib.getenv('VEGA_DESKTOP_TEST_BINARY'), '--ignored', test, '--exact', '--nocapture']);
        const [stdout, stderr] = await new Promise((resolve,reject) => process.communicate_utf8_async(null,null,(p,r) => {
            try { const [,out,err] = p.communicate_utf8_finish(r); resolve([out,err]); } catch(e) { reject(e); }
        }));
        this.check(action === 'ui' ? 'GTK switch callbacks, initial state and failure rollback' : `${action}: Vega backend preserves files, other extensions and choice across all six profiles`, process.get_successful() && stdout.includes('1 passed'), {stdout,stderr});
        await wait(2200);
    }
    async capture(name) {
        const stream = Gio.File.new_for_path(GLib.path_get_dirname(GLib.getenv('SHELIAK_NATIVE_RESULT'))+`/${name}.png`).replace(null,false,Gio.FileCreateFlags.NONE,null);
        await new Shell.Screenshot().screenshot(false, stream); stream.close(null);
    }
    report(error) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({status: !error && this.checks.every(c => c.passed) ? 'passed' : 'failed', checks:this.checks, error:error ? String(error) : null, stack:error?.stack}, null, 2));
    }
    async run() {
        if (GLib.getenv('DING_PRIVATE_NATIVE_TEST') !== '1') throw Error('private fixture required');
        await wait(5500); Main.overview.hide(); await wait(500);
        const desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        this.check('private Desktop directory', desktop.startsWith('/tmp/sheliak-pins-'));
        this.check('DING enabled', Main.extensionManager.lookup('ding@rastersoft.com')?.state === 1);
        const windows = this.windows();
        this.check('DING desktop window created', windows.length > 0, windows.map(w => ({title:w.get_title(), wmclass:w.get_wm_class()})));
        await this.capture('desktop');
        await this.toggle('disable');
        this.check('DING disabled in running Shell', Main.extensionManager.lookup('ding@rastersoft.com')?.state === 2);
        this.check('desktop window removed', this.windows().length === 0);
        await this.capture('disabled');
        await this.toggle('enable');
        this.check('DING re-enabled in running Shell', Main.extensionManager.lookup('ding@rastersoft.com')?.state === 1);
        this.check('desktop window restored', this.windows().length > 0);
        await this.capture('restored');
        await this.toggle('ui');
        // Cleanly stop the desktop process before the private compositor exits.
        global.settings.set_strv('enabled-extensions', global.settings.get_strv('enabled-extensions').filter(id => id !== 'ding@rastersoft.com'));
        await wait(600);
    }
}
