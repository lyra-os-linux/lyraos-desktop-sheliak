"""Compare actual private Shell shutdown, scanning the log after process exit."""
import argparse,json,os,re,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--dist',type=Path,default=Path(__file__).resolve().parents[2]/'dist')
p.add_argument('--output',type=Path,required=True)
p.add_argument('--expect-disposed',action='store_true')
a=p.parse_args();here=Path(__file__).resolve().parent;a.output.mkdir(parents=True,exist_ok=True)
cases=[('native','lyra',[]),('panel','lyra',['panel']),('dock','lyra',['dock']),('pair','lyra',['panel','dock']),
       ('pair-windows10','windows10',['dock','panel']),('pair-windows11','windows11',['panel','dock']),
       ('suite','macos',['panel','dock','menus','search','animations'])]
results=[]
for name,profile,components in cases:
    out=a.output/name
    env=dict(os.environ,LYRA_SHUTDOWN_PROFILE=profile)
    command=[sys.executable,str(here.parent/'native-pins/run.py'),'--probe',str(here/'extension.js'),
             '--dist',str(a.dist.resolve()),'--output',str(out),'--components',*components]
    print('Running',name,flush=True)
    run=subprocess.run(command,env=env,capture_output=True,text=True,timeout=110)
    (a.output/(name+'-runner.log')).write_text(run.stdout+run.stderr)
    log=(out/'shell.log').read_text(errors='replace') if (out/'shell.log').exists() else ''
    report=json.loads((out/'result.json').read_text()) if (out/'result.json').exists() else {}
    shutdown=json.loads((out/'shutdown.json').read_text()) if (out/'shutdown.json').exists() else {}
    disposed=log.count('has been already disposed')
    cleanup=re.findall(r'Lyra (?:cleanup|integration):[^\n]+',log)
    # Upstream headless Shell GC diagnostics are retained, counted and compared
    # to the native control, never hidden as part of a generic critical filter.
    gc=[re.sub(r'0x[0-9a-f]+', '<address>', signal)
        for signal in re.findall(r'The offending signal was ([^\n]+)',log)]
    row={'case':name,'profile':profile,'components':components,'runner_exit':run.returncode,
         'shutdown':shutdown,'checks':len(report.get('checks',[])),'disposed':disposed,'cleanup_errors':cleanup,
         'gc_signals':gc,'late_disable_completed':'LYRA_SHUTDOWN_LATE_DISABLE_COMPLETE' in log}
    results.append(row);(a.output/'matrix.json').write_text(json.dumps(results,indent=2)+'\n')
    assert run.returncode==0 and report.get('status')=='passed' and row['late_disable_completed'],row
    assert shutdown.get('returncode') == 0 and shutdown.get('forced') is False,row
    if not a.expect_disposed:
        assert not disposed and not cleanup and 'JS ERROR' not in log,row
        assert sorted(gc) == sorted(results[0]['gc_signals']),row
if a.expect_disposed: assert any(r['disposed'] for r in results if r['components']),results
print('PASS: native shutdown comparison',flush=True)
