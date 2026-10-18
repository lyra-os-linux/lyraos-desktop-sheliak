import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

// Build the real Dock so _redisplay runs unchanged, with every collaborator
// replaced by a fixture. AppIcon is the only fixture that records behaviour:
// it must be reused across rebuilds unless app, favorite, size or profile
// change, because each destroyed menu actor was one more pass through the
// GLib abort described in docs/dock-menu-lifecycle.md.
const {outputFiles} = await build({entryPoints: ['src/dock.ts'], bundle: true, write: false,
    format: 'iife', globalName: 'DockModule', plugins: [{name: 'redisplay-fixture', setup(builder) {
        builder.onResolve({filter: /^(gi|resource):\/\/|^\.\//}, args =>
            args.kind === 'entry-point' || ['./dockAlignment.js', './desktopProfile.js'].includes(args.path)
                ? null : ({path: args.path, namespace: 'fixture'}));
        builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents:
            args.path.endsWith('/main.js') ? 'export const {panel, layoutManager, ctrlAltTabManager} = fixtures;' :
                args.path === './appIcon.js' ? 'export const AppIcon = fixtures.AppIcon;' :
                    args.path === './profileFavorites.js' ? 'export const windowsFavorites = fixtures.windowsFavorites;' :
                        'export default {}; export const DockMagnifier={}, LauncherEntryTracker={}, ' +
                'ShowAppsButton={}, SignalTracker={}, shellIsStartingUp={}, TooltipManager={}, TrashIcon={}, ' +
                'getAppFavorites={}, PopupMenuManager={}, DragMotionResult={};'}));
    }}]});

function app(id) {
    return {id, get_id: () => id};
}

function fixture() {
    const events = [];
    class AppIcon {
        constructor(application, menuManager, favorite, onMenuStateChanged, iconSize, onDragEnd, tooltip, windows) {
            Object.assign(this, {app: application, appId: application.get_id(), favorite, iconSize, windows,
                menuManager, onMenuStateChanged, onDragEnd, tooltip, destroyed: false, badge: null, stateCalls: 0});
            this.actor = {owner: this, parent: null, get_parent() { return this.parent; }};
            events.push(`create ${this.appId}`);
        }
        setBadge(count) { this.badge = count; }
        setState() { this.stateCalls++; }
        destroy() {
            assert.equal(this.destroyed, false, `${this.appId} destroyed twice`);
            this.destroyed = true;
            this.actor.parent?.remove(this.actor);
            events.push(`destroy ${this.appId}`);
        }
    }
    class Box {
        children = [];
        insert_child_at_index(actor, index) {
            assert.equal(actor.parent, null, 'inserting an actor that already has a parent');
            actor.parent = this;
            this.children.splice(index, 0, actor);
        }
        set_child_at_index(actor, index) {
            assert.equal(actor.parent, this, 'moving an actor that is not a child');
            this.children.splice(this.children.indexOf(actor), 1);
            this.children.splice(index, 0, actor);
        }
        get_child_at_index(index) { return this.children[index] ?? null; }
        remove(actor) {
            this.children.splice(this.children.indexOf(actor), 1);
            actor.parent = null;
        }
        ids() { return this.children.map(child => child.owner.appId); }
    }
    const {Dock} = runInNewContext(`${outputFiles[0].text}\nDockModule`, {
        fixtures: {AppIcon, windowsFavorites: (settings, profile) => ({panel: state.profileFavorites, menu: {}, profile}),
            panel: {}, layoutManager: {}, ctrlAltTabManager: {}},
        console: {...console, debug() {}},
    });
    const state = {
        favorites: [], running: [], profileFavorites: {getFavorites: () => state.favorites},
        settings: {'desktop-profile': 'gnome', 'running-apps-position': 'end', 'show-running': true, 'icon-size': 40},
    };
    const dock = Object.create(Dock.prototype);
    Object.assign(dock, {
        _destroyed: false, _dragPlaceholder: null, _icons: [], _menuManager: {}, _tooltip: {},
        _settings: {get_string: key => state.settings[key], get_boolean: key => state.settings[key],
            get_uint: key => state.settings[key]},
        _favorites: {getFavorites: () => state.favorites},
        _appSystem: {get_running: () => state.running},
        _launcherEntries: {countFor: id => id.length},
        _magnifier: {setIcons(icons) { events.push(`magnifier ${icons.length}`); }},
        _trash: {}, _showApps: {}, _appsBox: new Box(),
        _relayout() { events.push('relayout'); },
    });
    // Arrays built inside the vm context have a foreign prototype; copy them
    // into this realm so strict deep equality can compare them.
    return {dock, state, events, box: dock._appsBox, icons: () => Array.from(dock._icons)};
}

test('rebuilding with new running apps keeps the existing icons and appends the new one', () => {
    const {dock, state, events, box, icons} = fixture();
    const [a, b, c, d] = ['a.desktop', 'b.desktop', 'c.desktop', 'd.desktop'].map(app);
    state.favorites = [a, b]; state.running = [c];
    dock._redisplay();
    assert.deepEqual(box.ids(), ['a.desktop', 'b.desktop', 'c.desktop']);
    assert.deepEqual(icons().map(icon => icon.favorite), [true, true, false]);
    assert.deepEqual(icons().map(icon => icon.badge), [9, 9, 9]);
    const first = [...icons()];

    events.length = 0;
    state.running = [c, d];
    dock._redisplay();
    assert.deepEqual(box.ids(), ['a.desktop', 'b.desktop', 'c.desktop', 'd.desktop']);
    assert.equal(icons()[0], first[0]);
    assert.equal(icons()[1], first[1]);
    assert.equal(icons()[2], first[2]);
    assert.deepEqual(events.filter(event => event.startsWith('destroy')), []);
    assert.deepEqual(events.filter(event => event.startsWith('create')), ['create d.desktop']);
    // Kept icons refresh their running state; the new one did so in its constructor.
    assert.deepEqual(icons().map(icon => icon.stateCalls), [1, 1, 1, 0]);
    assert.deepEqual(events.at(-1), 'relayout');
});

test('apps that leave the row are destroyed after the magnifier released them', () => {
    const {dock, state, events, icons} = fixture();
    const [a, b, c] = ['a.desktop', 'b.desktop', 'c.desktop'].map(app);
    state.favorites = [a]; state.running = [b, c];
    dock._redisplay();
    const kept = icons()[0];

    events.length = 0;
    state.running = [];
    dock._redisplay();
    assert.deepEqual(icons(), [kept]);
    assert.equal(kept.destroyed, false);
    assert.deepEqual(events, ['magnifier 0', 'destroy b.desktop', 'destroy c.desktop', 'magnifier 3', 'relayout']);
});

test('reordering favorites moves the existing actors instead of recreating them', () => {
    const {dock, state, events, box, icons} = fixture();
    const [a, b, c] = ['a.desktop', 'b.desktop', 'c.desktop'].map(app);
    state.favorites = [a, b, c];
    dock._redisplay();
    const before = [...icons()];

    events.length = 0;
    state.favorites = [c, a, b];
    dock._redisplay();
    assert.deepEqual(box.ids(), ['c.desktop', 'a.desktop', 'b.desktop']);
    assert.deepEqual(icons(), [before[2], before[0], before[1]]);
    assert.deepEqual(events.filter(event => /^(create|destroy)/.test(event)), []);
});

test('running apps placed first keep their position rule after reconciliation', () => {
    const {dock, state, box} = fixture();
    const [a, b] = ['a.desktop', 'b.desktop'].map(app);
    state.settings['running-apps-position'] = 'start';
    state.favorites = [a]; state.running = [b];
    dock._redisplay();
    assert.deepEqual(box.ids(), ['b.desktop', 'a.desktop']);
    dock._redisplay();
    assert.deepEqual(box.ids(), ['b.desktop', 'a.desktop']);
});

test('an app that stops being a favorite gets a fresh icon', () => {
    const {dock, state, events, box, icons} = fixture();
    const [a, b] = ['a.desktop', 'b.desktop'].map(app);
    state.favorites = [a, b];
    dock._redisplay();
    const [keptA, oldB] = icons();

    events.length = 0;
    state.favorites = [a]; state.running = [b];
    dock._redisplay();
    assert.deepEqual(box.ids(), ['a.desktop', 'b.desktop']);
    assert.equal(icons()[0], keptA);
    assert.notEqual(icons()[1], oldB);
    assert.equal(oldB.destroyed, true);
    assert.equal(icons()[1].favorite, false);
    assert.deepEqual(events.filter(event => /^(create|destroy)/.test(event)), ['create b.desktop', 'destroy b.desktop']);
});

test('icon size and profile changes rebuild every icon', () => {
    const {dock, state, icons} = fixture();
    const [a, b] = ['a.desktop', 'b.desktop'].map(app);
    state.favorites = [a, b];
    dock._redisplay();
    const first = [...icons()];

    state.settings['icon-size'] = 48;
    dock._redisplay();
    assert.ok(icons().every((icon, index) => icon !== first[index] && icon.iconSize === 48));
    assert.ok(first.every(icon => icon.destroyed));
    const second = [...icons()];

    state.settings['desktop-profile'] = 'windows11';
    dock._redisplay();
    assert.ok(icons().every((icon, index) => icon !== second[index]));
    assert.ok(second.every(icon => icon.destroyed));
    assert.ok(icons().every(icon => icon.windows?.profile === 'windows11'));

    // The same profile on the next pass keeps the icons again.
    const third = [...icons()];
    dock._redisplay();
    assert.deepEqual(icons(), third);
});

test('a replaced Shell.App object for the same id is not mistaken for the old one', () => {
    const {dock, state, icons} = fixture();
    state.favorites = [app('a.desktop')];
    dock._redisplay();
    const old = icons()[0];
    state.favorites = [app('a.desktop')];
    dock._redisplay();
    assert.notEqual(icons()[0], old);
    assert.equal(old.destroyed, true);
});

test('a destroyed dock does not rebuild', () => {
    const {dock, state, events} = fixture();
    state.favorites = [app('a.desktop')];
    dock._destroyed = true;
    dock._redisplay();
    assert.deepEqual(events, []);
});
