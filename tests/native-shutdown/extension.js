import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
export default class ShutdownProbe extends Extension {
    enable() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private compositor required');
        this.checks = [];
        this.run().catch(error => this.report(error));
    }
    disable() {}
    report(error = null) {
        GLib.file_set_contents(GLib.getenv('SHELIAK_NATIVE_RESULT'), JSON.stringify({
            status: error ? 'failed' : 'passed', checks: this.checks, error: error?.stack ?? null}));
    }
    check(name, passed) {
        this.checks.push({name, passed: !!passed});
        if (!passed) throw Error(name);
    }
    async run() {
        await wait(2200);
        Main.overview.hide();
        const enabled = new Gio.Settings({schema_id: 'org.gnome.shell'}).get_strv('enabled-extensions');
        const owners = enabled.filter(id => id.endsWith('@lyraos.com.br') && id !== 'desktop-icons@lyraos.com.br')
            .map(id => Main.extensionManager.lookup(id).stateObj);
        const settings = owners[0]?.getSettings('org.gnome.shell.extensions.sheliak');
        const profiles = ['lyra', 'macos', 'windows10', 'windows11'];
        for (let cycle = 0; cycle < 2; cycle++) {
            for (const profile of profiles) {
                settings?.set_string('desktop-profile', profile);
                await wait(120);
                for (const owner of owners) this.check(`${cycle}/${profile}: active ${owner.uuid}`, owner.running);
                for (const owner of [...owners].reverse()) { owner.disable(); owner.disable(); }
                for (const owner of owners) this.check(`${cycle}/${profile}: released ${owner.uuid}`, !owner.running && !owner.lyraApi);
                for (const owner of owners) owner.enable();
                await wait(120);
            }
        }
        settings?.set_string('desktop-profile', GLib.getenv('LYRA_SHUTDOWN_PROFILE') || 'lyra');
        await wait(350);
        // Model a late extension-manager disable after LayoutManager destroys
        // uiGroup, then require idempotence. The harness sends real SIGTERM.
        global.connect('shutdown', () => {
            for (const owner of [...owners].reverse()) owner.disable();
            console.log('LYRA_SHUTDOWN_LATE_DISABLE_COMPLETE');
        });
        this.report();
    }
}
