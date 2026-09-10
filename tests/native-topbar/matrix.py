"""Allocation matrix with explicitly bounded disposable compositors."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--jobs', type=int, choices=[1, 2], default=1)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

def run_case(case):
    language, scale, width = case
    name = f'{language}-{width}-scale{scale}'
    output = args.output / name
    with (args.output / (name+'.log')).open('w') as log:
        process = subprocess.run([sys.executable, str(Path(__file__).with_name('run.py')),
            '--output', str(output), '--language', language, '--width', str(width), '--scale', str(scale)],
            stdout=log, stderr=log)
    result = json.loads((output / 'result.json').read_text())
    shell_log = (output / 'shell.log').read_text()
    runtime, _, shutdown = shell_log.partition('Shutting down GNOME Shell')
    markers = ['already disposed', 'JS ERROR', 'Gjs-CRITICAL', 'Clutter-CRITICAL']
    shutdown_warnings = any(text in shutdown for text in markers)
    # GNOME 48 may dispatch IBus callbacks while its shutdown handler
    # spins a nested main loop, after the native candidate popup dies.
    # Keep that diagnostic visible; never exempt extension stacks or
    # any warning observed while the regression is running.
    native_ibus_shutdown = shutdown_warnings and 'ibusCandidatePopup.js' in shutdown and 'extensions/' not in shutdown and 'JS ERROR' not in shutdown
    clean = not any(text in runtime for text in markers) and (not shutdown_warnings or native_ibus_shutdown)
    passed = process.returncode == 0 and clean and result.get('scale') == scale and result.get('monitor', {}).get('width') == width*scale
    row = dict(name=name, passed=passed, checks=len(result.get('checks', [])), shell_clean=clean,
        native_ibus_shutdown_warning=native_ibus_shutdown,
        failed=[c['name'] for c in result.get('checks', []) if not c['passed']], error=result.get('error'))
    return row

rows = []
cases = [(language, scale, width) for language in ['en_US', 'pt_BR', 'es_ES']
         for scale in [1, 2] for width in [800, 1024, 1280, 1920]]
with ThreadPoolExecutor(max_workers=args.jobs) as pool:
    for future in as_completed([pool.submit(run_case, case) for case in cases]):
        row = future.result()
        rows.append(row)
        (args.output / 'matrix.json').write_text(json.dumps(sorted(rows, key=lambda row: row['name']), indent=2)+'\n')
        print(json.dumps(row), flush=True)
sys.exit(0 if all(row['passed'] for row in rows) else 1)
