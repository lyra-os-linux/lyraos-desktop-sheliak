import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints: ['extensions/desktop-icons/gnomeShellOverride.js'],
    bundle: true, write: false, format: 'iife', globalName: 'Overrides', plugins: [{
        name: 'fixture', setup(builder) {
            builder.onResolve({filter: /^(gi|resource):\/\//}, args => ({path: args.path, namespace: 'fixture'}));
            builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents:
                args.path.startsWith('gi://') ? `export default fixtures[${JSON.stringify(args.path.slice(5))}];`
                    : 'export const {WorkspaceGroup} = fixtures;'}));
        },
    }]});
function fixture(wayland = true) {
    class Global { get_window_actors() { return this.actors; } }
    class WorkspaceGroup { _shouldShowWindow() { return true; } }
    const fixtures = {Shell: {Global}, Meta: {is_wayland_compositor: () => wayland, WindowType: {DESKTOP: 1}}, WorkspaceGroup};
    const {GnomeShellOverride} = runInNewContext(`${outputFiles[0].text}\nOverrides;`, {fixtures, console: {warn() {}}});
    return {Global, WorkspaceGroup, instance: new GnomeShellOverride()};
}
test('missing optional workspace method is never replaced', () => {
    const {WorkspaceGroup, instance} = fixture(false);
    delete WorkspaceGroup.prototype._shouldShowWindow;
    instance.enable();
    assert.equal(WorkspaceGroup.prototype._shouldShowWindow, undefined);
    instance.disable();
});
test('missing global window method and read-only methods keep native behavior', () => {
    const {Global, instance} = fixture();
    const original = Global.prototype.get_window_actors;
    Object.defineProperty(Global.prototype, 'get_window_actors', {value: original, writable: false, configurable: true});
    instance.enable();
    assert.equal(Global.prototype.get_window_actors, original);
    delete Global.prototype.get_window_actors;
    instance.enable();
    assert.equal(Global.prototype.get_window_actors, undefined);
    instance.disable();
});
test('Wayland filter preserves normal windows and restores original method on disable', () => {
    const {Global, instance} = fixture();
    const original = Global.prototype.get_window_actors;
    const normal = {}, desktop = {customJS_ding: {hideFromWindowList: true}};
    const global = Object.assign(new Global(), {actors: [normal, desktop]});
    instance.enable();
    instance.enable();
    assert.deepEqual(Array.from(global.get_window_actors()), [normal]);
    instance.disable();
    instance.disable();
    assert.equal(Global.prototype.get_window_actors, original);
    assert.deepEqual(global.get_window_actors(), [normal, desktop]);
});
test('another extension retaining the wrapper can call it safely after Lyra disable', () => {
    const {Global, instance} = fixture();
    const desktop = {customJS_ding: {hideFromWindowList: true}};
    const global = Object.assign(new Global(), {actors: [desktop]});
    instance.enable();
    const lyra = Global.prototype.get_window_actors;
    const other = function () { return lyra.call(this); };
    Global.prototype.get_window_actors = other;
    instance.disable();
    assert.equal(Global.prototype.get_window_actors, other);
    assert.deepEqual(global.get_window_actors(), [desktop]);
});
test('X11 workspace predicate delegates native decisions and skips desktop windows', () => {
    const {WorkspaceGroup, instance} = fixture(false);
    const original = WorkspaceGroup.prototype._shouldShowWindow;
    instance.enable();
    const group = new WorkspaceGroup();
    assert.equal(group._shouldShowWindow({get_window_type: () => 1}), false);
    assert.equal(group._shouldShowWindow({get_window_type: () => 0}), true);
    instance.disable();
    assert.equal(WorkspaceGroup.prototype._shouldShowWindow, original);
});
