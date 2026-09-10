import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

const {outputFiles} = await build({entryPoints:['src/dock.ts'], bundle:true, write:false,
    format:'iife', globalName:'DockModule', plugins:[{name:'layout-fixture', setup(builder) {
        builder.onResolve({filter:/^(gi|resource):\/\/|^\.\//}, args => args.kind==='entry-point'||['./dockAlignment.js','./desktopProfile.js'].includes(args.path)?null:({path:args.path,namespace:'fixture'}));
        builder.onLoad({filter:/.*/,namespace:'fixture'}, args => ({contents:
            args.path.endsWith('/main.js') ? 'export const {panel, layoutManager, ctrlAltTabManager} = fixtures;' :
                'export default {}; export const AppIcon={}, DockMagnifier={}, LauncherEntryTracker={}, '+
                'ShowAppsButton={}, SignalTracker={}, shellIsStartingUp={}, TooltipManager={}, TrashIcon={}, getAppFavorites={}, PopupMenuManager={}, DragMotionResult={};'}));
    }}]});

function fixture(position, extend, alignment) {
    const panel={height:32};
    const monitor={x:100,y:200,width:1200,height:900};
    const {Dock}=runInNewContext(`${outputFiles[0].text}\nDockModule`,
        {fixtures:{panel,layoutManager:{primaryMonitor:monitor}},console});
    const dock=Object.create(Dock.prototype);
    const values={position,'extend-to-edges':extend,'content-alignment':alignment,'extended-content-alignment':alignment,'edge-margin':8};
    dock._settings={get_string:key=>values[key],get_boolean:key=>values[key],get_uint:key=>values[key]};
    dock._naturalDockSize=horizontal=>horizontal?[400,72]:[72,400];
    return {dock,panel};
}

for(const position of ['left','right','top','bottom']) {
    test(`extended ${position} dock reaches the monitor edges and avoids the topbar`,()=>{
        for(const alignment of ['start','center','end']) {
            const {dock,panel}=fixture(position,true,alignment);
            for(const height of [32,48]) {
                panel.height=height;
                const actual=Array.from(dock._shownGeometry());
                const expected=position==='left'?[100,200+height,72,900-height]:
                    position==='right'?[1228,200+height,72,900-height]:
                    position==='top'?[100,200+height,1200,72]:[100,1028,1200,72];
                assert.deepEqual(actual,expected);
            }
        }
    });
}

test('compact side dock retains its configured margin and natural size',()=>{
    const {dock}=fixture('left',false,'start');
    assert.deepEqual(Array.from(dock._shownGeometry()),[108,240,72,400]);
});
