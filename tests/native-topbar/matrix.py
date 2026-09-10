"""Sequential matrix: one disposable compositor at a time."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
rows = []
for language in ['en_US', 'pt_BR', 'es_ES']:
    for scale in [1, 2]:
        for width in [800, 1024, 1280, 1920]:
            name = f'{language}-{width}-scale{scale}'
            output = args.output / name
            with (args.output / (name+'.log')).open('w') as log:
                process = subprocess.run([sys.executable, str(Path(__file__).with_name('run.py')),
                    '--output', str(output), '--language', language, '--width', str(width), '--scale', str(scale)],
                    stdout=log, stderr=log)
            result = json.loads((output / 'result.json').read_text())
            shell_log = (output / 'shell.log').read_text()
            clean = not any(text in shell_log for text in ['already disposed', 'JS ERROR', 'Gjs-CRITICAL', 'Clutter-CRITICAL'])
            passed = process.returncode == 0 and clean and result.get('scale') == scale and result.get('monitor', {}).get('width') == width*scale
            row = dict(name=name, passed=passed, checks=len(result.get('checks', [])), shell_clean=clean,
                failed=[c['name'] for c in result.get('checks', []) if not c['passed']], error=result.get('error'))
            rows.append(row)
            (args.output / 'matrix.json').write_text(json.dumps(rows, indent=2)+'\n')
            print(json.dumps(row), flush=True)
sys.exit(0 if all(row['passed'] for row in rows) else 1)
