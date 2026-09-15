import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
    () => { resolve(); return GLib.SOURCE_REMOVE; }));
const roles = ['dock', 'panel', 'menus', 'search', 'animations', 'desktop-icons'];
const ext = role => Main.extensionManager.lookup(`${role}@lyraos.com.br`).stateObj;
const api = role => ext(role)?.lyraApi?.current;
const margins = () => ['top', 'bottom', 'left', 'right'].map(side => Main.panel[`margin_${side}`]);
const heightRequest = () => [Main.panel.min_height, Main.panel.min_height_set,
    Main.panel.natural_height, Main.panel.natural_height_set];
const classes = actor => (actor.get_style_class_name() ?? '').split(/\s+/).filter(Boolean).sort().join(' ');

function masked(object, key, replacement, callback) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, {value: replacement, configurable: true, writable: true});
    try { return callback(); }
    finally {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
    }
}

/** Faults and foreign actors are restricted to a private test compositor. */
export default class PanelCoexistenceProbe extends Extension {
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
    check(name, passed, detail = null) {
        this.checks.push({name, passed: !!passed, detail});
        if (!passed) throw Error(`${name}: ${JSON.stringify(detail)}`);
    }
    async run() {
        if (GLib.getenv('SHELIAK_PRIVATE_NATIVE_TEST') !== '1') throw Error('Private compositor required');
        await wait(2200);
        Main.overview.hide();
        await wait(350);
        for (const role of ['search', 'menus', 'dock', 'panel']) ext(role).disable();
        const settings = ext('panel').getSettings('org.gnome.shell.extensions.sheliak');
        settings.set_string('desktop-profile', 'lyra');
        settings.set_boolean('floating-panel', true);
        settings.set_boolean('extend-to-edges', false);
        settings.set_boolean('show-clock', true);
        settings.set_boolean('show-panel-indicators', true);
        settings.set_boolean('hide-workspace-button', false);
        await wait(100);
        const clock = Main.panel.statusArea.dateMenu;
        const activities = Main.panel.statusArea.activities.container;
        const right = Main.panel._rightBox;
        const nativeParent = clock.container.get_parent();
        const nativeIndex = nativeParent.get_children().indexOf(clock.container);
        const nativeStyle = Main.panel.get_style();
        const nativeClasses = classes(Main.panel);
        const nativeMenuClasses = classes(Main.uiGroup);
        const indicator = new St.Bin({visible: true});
        right.add_child(indicator);
        const actors = {clock, activities, indicator};

        // Foreign extension enabled first, then Lyra, then Lyra removed first.
        for (const actor of Object.values(actors)) actor.hide();
        ext('panel').enable(); await wait(150);
        for (const [name, actor] of Object.entries(actors))
            this.check(`preexisting hidden ${name} preserved`, !actor.visible);
        ext('panel').disable();
        for (const [name, actor] of Object.entries(actors))
            this.check(`preexisting hidden ${name} survives disable`, !actor.visible);

        // Lyra enabled first; another writer hides otherwise visible actors.
        for (const actor of Object.values(actors)) actor.show();
        ext('panel').enable(); await wait(120);
        for (const actor of Object.values(actors)) actor.hide();
        ext('panel').disable();
        for (const [name, actor] of Object.entries(actors))
            this.check(`later foreign hide of ${name} survives disable`, !actor.visible);

        // A native indicator can obtain its state and show after insertion.
        settings.set_boolean('show-clock', false);
        settings.set_boolean('show-panel-indicators', false);
        settings.set_boolean('hide-workspace-button', true);
        ext('panel').enable(); await wait(100);
        for (const actor of Object.values(actors)) actor.show();
        for (const [name, actor] of Object.entries(actors))
            this.check(`late ${name} show remains suppressed`, !actor.visible);
        const late = new St.Bin({visible: false}); right.add_child(late); late.show();
        this.check('late inserted native indicator is suppressed', !late.visible);
        late.destroy();
        ext('panel').disable();
        for (const [name, actor] of Object.entries(actors))
            this.check(`latest native ${name} show restored`, actor.visible);
        settings.set_boolean('show-clock', true);
        settings.set_boolean('show-panel-indicators', true);
        settings.set_boolean('hide-workspace-button', false);

        // Exact style ownership, including remove/re-add of the same class.
        ext('panel').enable(); await wait(180);
        this.check('surface uses expected Lyra color and opacity',
            Main.panel.get_style()?.includes('rgba(28, 32, 37, 0.9)'), Main.panel.get_style());
        Main.panel.set_style(`${Main.panel.get_style()}; border-width: 3px;`);
        Main.panel.add_style_class_name('foreign-panel');
        Main.uiGroup.remove_style_class_name('sheliak-panel-colors');
        Main.uiGroup.add_style_class_name('sheliak-panel-colors');
        Main.panel.remove_style_class_name('sheliak-panel-floating');
        Main.panel.add_style_class_name('sheliak-panel-floating');
        await wait(150);
        Main.panel.set_height(43);
        Main.panel.margin_top = 21; Main.panel.margin_bottom = 22;
        Main.panel.margin_left = 23; Main.panel.margin_right = 24;
        const externalHeight = Main.panel.height;
        const externalRequest = heightRequest();
        ext('panel').disable();
        this.check('external inline declaration survives without Lyra overlay',
            Main.panel.get_style() === `${nativeStyle ?? ''}; border-width: 3px;`, Main.panel.get_style());
        this.check('external geometry survives our class restyling',
            Main.panel.height === externalHeight && JSON.stringify(margins()) === '[21,22,23,24]',
            {beforeHeight: externalHeight, height: Main.panel.height, margins: margins()});
        this.check('foreign class remains', Main.panel.has_style_class_name('foreign-panel'));
        this.check('foreign reacquired floating class remains', Main.panel.has_style_class_name('sheliak-panel-floating'));
        this.check('foreign reacquired menu class remains', Main.uiGroup.has_style_class_name('sheliak-panel-colors'));
        await wait(150);
        this.check('external geometry survives the next native frame',
            JSON.stringify(heightRequest()) === JSON.stringify(externalRequest)
                && JSON.stringify(margins()) === '[21,22,23,24]',
            {height: Main.panel.height, request: heightRequest(), margins: margins()});
        Main.panel.set_style(nativeStyle);
        Main.panel.set_style_class_name(nativeClasses);
        Main.uiGroup.set_style_class_name(nativeMenuClasses);

        // Normal bottom-panel roundtrips, and clock/arrow ownership transfer.
        for (const profile of ['windows10', 'windows11']) {
            settings.set_string('desktop-profile', profile);
            ext('panel').enable(); await wait(180);
            this.check(`${profile}: bottom panel active`, api('panel').active);
            this.check(`${profile}: clock moved to status area`, clock.container.get_parent() === right);
            this.check(`${profile}: menu opens upward`, clock.menu._boxPointer.arrowSide === St.Side.BOTTOM);
            ext('panel').disable();
            this.check(`${profile}: original clock placement restored`, clock.container.get_parent() === nativeParent
                && nativeParent.get_children().indexOf(clock.container) === nativeIndex);
            this.check(`${profile}: native menu arrow restored`, clock.menu._boxPointer.arrowSide === St.Side.TOP);
            this.check(`${profile}: profile classes removed`, classes(Main.panel) === nativeClasses, classes(Main.panel));

            ext('panel').enable(); await wait(180);
            right.remove_child(clock.container);
            Main.panel._leftBox.add_child(clock.container);
            clock.menu._boxPointer.updateArrowSide(St.Side.LEFT);
            Main.panel._centerBox.translation_x = 37;
            // Synchronous disable avoids a subsequent allocation reclaiming layout.
            ext('panel').disable();
            this.check(`${profile}: external clock parent preserved`, clock.container.get_parent() === Main.panel._leftBox);
            this.check(`${profile}: external arrow direction preserved`, clock.menu._boxPointer.arrowSide === St.Side.LEFT);
            this.check(`${profile}: external translation preserved`, Main.panel._centerBox.translation_x === 37);
            Main.panel._leftBox.remove_child(clock.container);
            nativeParent.insert_child_at_index(clock.container, nativeIndex);
            clock.menu._boxPointer.updateArrowSide(St.Side.TOP);
            Main.panel._centerBox.translation_x = 0;
        }

        // Reserved workarea belongs to the latest chrome registration too.
        const layout = Main.layoutManager;
        const tracked = () => layout._trackedActors.find(item => item.actor === layout.panelBox);
        const params = item => ({affectsInputRegion: item.affectsInputRegion,
            affectsStruts: item.affectsStruts, trackFullscreen: item.trackFullscreen});
        const nativeChrome = params(tracked());
        for (const change of ['mutate', 'replace', 'remove']) {
            ext('panel').enable(); await wait(120);
            if (change === 'mutate') tracked().affectsStruts = false;
            else {
                const currentParams = params(tracked());
                layout.untrackChrome(layout.panelBox);
                if (change === 'replace') layout.trackChrome(layout.panelBox, currentParams);
            }
            const foreign = tracked();
            ext('panel').disable();
            this.check(`${change}: external workarea registration survives disable`, tracked() === foreign);
            if (change === 'mutate') this.check('external workarea flags remain intact', !tracked().affectsStruts);
            layout.untrackChrome(layout.panelBox);
            layout.trackChrome(layout.panelBox, nativeChrome);
        }
        ext('panel').enable(); await wait(100);
        layout.panelBox.hide();
        ext('panel').disable();
        this.check('external hiding of panel box survives disable', !layout.panelBox.visible);
        layout.panelBox.show();

        // Rollback after a real mutation followed by a simulated exception.
        settings.set_string('desktop-profile', 'lyra');
        settings.set_boolean('show-clock', false);
        settings.set_boolean('show-panel-indicators', false);
        const beforeFault = {height: Main.panel.height, margins: margins(), style: Main.panel.get_style(),
            panelClasses: classes(Main.panel), menuClasses: classes(Main.uiGroup)};
        const add = Main.panel.add_style_class_name;
        let failed = false;
        masked(Main.panel, 'add_style_class_name', function(name) {
            add.call(this, name);
            if (name === 'sheliak-panel-floating') throw Error('injected TopBar activation failure');
        }, () => { try { ext('panel').enable(); } catch (_) { failed = true; } });
        this.check('partial topbar activation reports failure and stops provider', failed && !ext('panel').running && !api('panel'));
        this.check('partial topbar activation restores visibility', clock.visible && indicator.visible);
        this.check('partial topbar activation restores geometry', Main.panel.height === beforeFault.height
            && JSON.stringify(margins()) === JSON.stringify(beforeFault.margins));
        this.check('partial topbar activation removes styles and menu class', Main.panel.get_style() === beforeFault.style
            && classes(Main.panel) === beforeFault.panelClasses && classes(Main.uiGroup) === beforeFault.menuClasses);

        settings.set_boolean('show-clock', true);
        settings.set_boolean('show-panel-indicators', true);
        settings.set_string('desktop-profile', 'windows10');
        const pointer = clock.menu._boxPointer;
        const update = pointer.updateArrowSide;
        const barrier = Main.layoutManager._updatePanelBarrier;
        failed = false;
        masked(pointer, 'updateArrowSide', function(side) {
            update.call(this, side);
            if (side === St.Side.BOTTOM) throw Error('injected bottom panel activation failure');
        }, () => { try { ext('panel').enable(); } catch (_) { failed = true; } });
        this.check('partial bottom activation stops provider', failed && !ext('panel').running && !api('panel'));
        this.check('partial bottom activation restores native clock and arrow', clock.container.get_parent() === nativeParent
            && pointer.arrowSide === St.Side.TOP);
        this.check('partial bottom activation releases barrier and classes', Main.layoutManager._updatePanelBarrier === barrier
            && classes(Main.panel) === beforeFault.panelClasses, classes(Main.panel));

        const addChild = right.add_child;
        failed = false;
        masked(right, 'add_child', function(child) {
            if (child === clock.container) throw Error('injected clock insertion failure');
            return addChild.call(this, child);
        }, () => { try { ext('panel').enable(); } catch (_) { failed = true; } });
        this.check('failed clock insertion stops provider', failed && !ext('panel').running && !api('panel'));
        this.check('failed clock insertion restores the detached actor', clock.container.get_parent() === nativeParent
            && nativeParent.get_children().indexOf(clock.container) === nativeIndex);
        this.check('failed clock insertion releases barrier and classes', Main.layoutManager._updatePanelBarrier === barrier
            && classes(Main.panel) === beforeFault.panelClasses);
        ext('panel').enable(); await wait(150);
        this.check('panel can activate normally after failed constructors', api('panel')?.active);

        // Panel/provider and consumers can be removed in either order.
        for (const order of [['panel', 'dock', 'menus', 'search'], ['search', 'menus', 'dock', 'panel']]) {
            for (const role of ['panel', 'dock', 'menus', 'search'])
                if (!ext(role).running) ext(role).enable();
            await wait(200);
            for (const role of order) {
                ext(role).disable();
                this.check(`${order[0]} first: ${role} disabled`, !ext(role).running);
            }
            this.check(`${order[0]} first: clock restored`, clock.container.get_parent() === nativeParent);
            this.check(`${order[0]} first: barrier restored`, Main.layoutManager._updatePanelBarrier === barrier);
        }
        indicator.destroy();
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        shell.set_strv('enabled-extensions', shell.get_strv('enabled-extensions')
            .filter(id => !roles.some(role => id === `${role}@lyraos.com.br`)));
        await wait(350);
    }
}
