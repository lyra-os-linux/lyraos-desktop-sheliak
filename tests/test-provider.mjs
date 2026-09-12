import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const {outputFiles} = await build({entryPoints: ['src/core/provider.ts'], bundle: true,
    write: false, format: 'esm', platform: 'node'});
const {Provider, Scope} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

test('revocation reaches consumers before owner destruction and release is idempotent', () => {
    const scope = new Scope(), events = [];
    const actor = {destroy: () => events.push('destroy')};
    scope.own(actor);
    const p = new Provider(actor);
    const release = p.subscribe(value => events.push(value === null ? 'detach' : 'changed'));
    p.revoke();
    release(); release();
    scope.destroy(); scope.destroy();
    assert.deepEqual(events, ['detach', 'destroy']);
    assert.equal(p.current, null);
});

test('a departing consumer cannot receive a queued notification from the old provider', () => {
    const p = new Provider({}), seen = [];
    let removeSecond;
    p.subscribe(() => { seen.push('first'); removeSecond(); });
    removeSecond = p.subscribe(() => seen.push('second'));
    p.changed();
    assert.deepEqual(seen, ['first']);
});

test('cleanup runs in reverse acquisition order even when one release fails', () => {
    const scope = new Scope(), events = [];
    scope.add(() => events.push('owner'));
    scope.add(() => { events.push('broken consumer'); throw Error('fixture'); });
    scope.add(() => events.push('menu'));
    scope.destroy();
    assert.deepEqual(events, ['menu', 'broken consumer', 'owner']);
});
