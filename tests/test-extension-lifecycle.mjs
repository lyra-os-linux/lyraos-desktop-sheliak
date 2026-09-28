import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
const {outputFiles} = await build({entryPoints: ['src/core/extension.ts'], bundle: true,
    write: false, format: 'iife', globalName: 'Lifecycle', plugins: [{name: 'fixture', setup(b) {
        b.onResolve({filter: /shellCompat\.js$/}, () => ({path: 'compat', namespace: 'fixture'}));
        b.onResolve({filter: /^resource:/}, args => ({path: args.path, namespace: 'fixture'}));
        b.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({contents:
            path === 'compat' ? 'export const extensionManager = () => fixture.manager;' :
            path.endsWith('/extensions/extension.js') ? 'export class Extension {}' :
            'export const layoutManager = fixture.layout;'}));
    }}]});
function fixture() {
    const callbacks = new Map(), events = [];
    let id = 0, disposed = false;
    const group = {
        connect(_name, callback) { callbacks.set(++id, callback); return id; },
        disconnect(key) { assert.equal(disposed, false); callbacks.delete(key); },
        destroy() { for (const callback of [...callbacks.values()]) callback(); disposed = true; },
    };
    const {LyraExtension} = runInNewContext(`${outputFiles[0].text};Lifecycle;`, {
        fixture: {manager: {lookup() {}}, layout: {uiGroup: group}}, console,
    });
    class Owner extends LyraExtension {
        activate() {
            this.scope.add(() => { assert.equal(disposed, false); events.push('restore'); });
            this.lyraApi = {revoke: () => { events.push('revoke'); this.disable(); }};
            if (this.fail) throw Error('activation failure');
        }
    }
    return {owner: new Owner(), group, callbacks, events};
}
test('normal disable restores, disconnects and permits repeated enable', () => {
    const {owner, callbacks, events} = fixture();
    for (let i = 0; i < 3; i++) {
        owner.enable(); owner.enable(); assert.equal(callbacks.size, 1);
        owner.disable(); owner.disable(); assert.equal(callbacks.size, 0);
    }
    assert.deepEqual(events, ['revoke', 'restore', 'revoke', 'restore', 'revoke', 'restore']);
});
test('parent destruction releases before disposal, late disable and enable are harmless', () => {
    const {owner, group, callbacks, events} = fixture();
    owner.enable(); group.destroy(); owner.disable(); owner.enable();
    assert.equal(callbacks.size, 0); assert.equal(owner.lyraApi, null);
    assert.deepEqual(events, ['revoke', 'restore']);
});
test('partial activation failure disconnects shutdown hook and restores acquired state', () => {
    const {owner, callbacks, events} = fixture();
    owner.fail = true; assert.throws(() => owner.enable(), /activation failure/);
    assert.equal(callbacks.size, 0); assert.equal(owner.lyraApi, null);
    assert.deepEqual(events, ['revoke', 'restore']);
});
