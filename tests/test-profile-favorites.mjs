import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints: ['src/profileFavorites.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Pins', plugins: [{name: 'shell', setup(builder) {
        builder.onResolve({filter: /^gi:\/\//}, args => ({path: args.path, namespace: 'shell'}));
        builder.onLoad({filter: /.*/, namespace: 'shell'}, () => ({contents: 'export default shell;'}));
    }}]});

function fixture() {
    const saved = new Map();
    const installed = new Set(['vega.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop', 'other.desktop']);
    const shell = {AppSystem: {get_default: () => ({lookup_app: id => installed.has(id) ? {get_id: () => id} : null})}};
    const {ProfileFavorites} = runInNewContext(`${outputFiles[0].text}\nPins`, {shell});
    const settings = {
        get_user_value: key => saved.has(key) ? saved.get(key) : null,
        get_strv: key => saved.get(key) ?? (key.includes('-panel-') ? ['vega.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop'] : []),
        is_writable: () => true,
        set_strv(key, ids) { saved.set(key, Array.from(ids)); return true; },
    };
    const list = (profile, surface, seed) => new ProfileFavorites(settings, profile, surface, seed);
    const ids = list => Array.from(list.getIds());
    return {saved, installed, settings, list, ids};
}

test('four independent lists preserve defaults, seed order and edits across recreation', () => {
    const {list, ids} = fixture();
    const seed = ['other.desktop', 'firefox.desktop'];
    const panel10 = list('windows10', 'panel'), panel11 = list('windows11', 'panel');
    const menu10 = list('windows10', 'menu', seed), menu11 = list('windows11', 'menu', seed);
    menu10.removeFavorite('firefox.desktop');
    panel10.removeFavorite('vega.desktop');
    panel10.addFavorite('other.desktop');
    panel10.moveFavoriteToPos('other.desktop', 0);
    assert.deepEqual(ids(panel10), ['other.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop']);
    assert.deepEqual(ids(panel11), ['vega.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop']);
    assert.deepEqual(ids(menu10), ['other.desktop']);
    assert.deepEqual(ids(menu11), seed);
    assert.deepEqual(ids(list('windows10', 'menu', ['vega.desktop'])), ['other.desktop']);
});

test('explicit empty panel and Start lists are never silently reseeded', () => {
    const {list, ids} = fixture();
    for (const surface of ['panel', 'menu']) {
        const pins = list('windows10', surface, surface === 'menu' ? ['other.desktop'] : undefined);
        for (const id of ids(pins)) pins.removeFavorite(id);
        assert.deepEqual(ids(list('windows10', surface, ['firefox.desktop'])), []);
        pins.addFavorite('other.desktop'); pins.addFavorite('other.desktop');
        assert.deepEqual(ids(pins), ['other.desktop']);
    }
});

test('reordering visible applications preserves unavailable pins for later installation', () => {
    const {list, ids, installed} = fixture();
    const pins = list('windows10', 'menu', ['missing.desktop', 'vega.desktop', 'firefox.desktop']);
    pins.moveFavoriteToPos('firefox.desktop', 0);
    assert.deepEqual(ids(pins), ['missing.desktop', 'firefox.desktop', 'vega.desktop']);
    assert.deepEqual(Array.from(pins.getFavorites(), app => app.get_id()), ['firefox.desktop', 'vega.desktop']);
    installed.add('missing.desktop');
    assert.deepEqual(Array.from(pins.getFavorites(), app => app.get_id()), ids(pins));
});

test('a rejected write reports failure and does not mutate stored selections', () => {
    const {list, ids, settings} = fixture();
    const pins = list('windows11', 'menu', ['firefox.desktop']);
    settings.set_strv = () => false;
    assert.throws(() => pins.addFavorite('other.desktop'), /could not be saved/);
    assert.deepEqual(ids(pins), ['firefox.desktop']);
});
