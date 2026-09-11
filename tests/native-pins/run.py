"""Run pins allocation checks in a disposable GNOME 48 compositor."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--dist', type=Path, default=HERE.parents[1] / 'dist')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--width', type=int, default=1440)
parser.add_argument('--scale', type=int, choices=[1, 2], default=1)
parser.add_argument('--language', choices=['en_US', 'pt_BR', 'es_ES'], default='en_US')
parser.add_argument('--inside-private-bus', action='store_true')
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
result = output / 'result.json'

if not args.inside_private_bus:
    with tempfile.TemporaryDirectory(prefix='sheliak-pins-') as temporary:
        root = Path(temporary)
        env = os.environ.copy()
        for key in ['DISPLAY', 'WAYLAND_DISPLAY', 'SESSION_MANAGER', 'DBUS_SESSION_BUS_ADDRESS',
                    'DBUS_SYSTEM_BUS_ADDRESS', 'XDG_SESSION_ID']:
            env.pop(key, None)
        for key, directory in [('XDG_RUNTIME_DIR', 'run'), ('XDG_CONFIG_HOME', 'config'),
                               ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'), ('XDG_STATE_HOME', 'state')]:
            path = root / directory
            path.mkdir(mode=0o700)
            env[key] = str(path)
        env.update(GSETTINGS_BACKEND='keyfile', LIBGL_ALWAYS_SOFTWARE='1', GALLIUM_DRIVER='llvmpipe', LP_NUM_THREADS='2',
                   XDG_SESSION_TYPE='wayland', XDG_CURRENT_DESKTOP='GNOME',
                   SHELIAK_NATIVE_RESULT=str(result), SHELIAK_PRIVATE_NATIVE_TEST='1',
                   LANGUAGE=args.language, LANG=args.language+'.UTF-8', LC_ALL=args.language+'.UTF-8')
        extensions = root / 'data/gnome-shell/extensions'
        uuid = 'sheliak-pins-test@lyraos.local'
        probe = extensions / uuid
        probe.mkdir(parents=True)
        (probe / 'metadata.json').write_text(json.dumps({'uuid': uuid, 'name': 'Pins regression',
            'description': 'Disposable native test', 'shell-version': ['48']}))
        shutil.copy2(HERE / 'extension.js', probe / 'extension.js')
        production = extensions / 'sheliak@lyraos.com.br'
        shutil.copytree(args.dist.resolve(), production)
        apps = root / 'data/applications'
        apps.mkdir()
        for app_id in ['vega.desktop', 'org.gnome.Nautilus.desktop', 'firefox.desktop',
                       'org.lyraos.PinProbe.desktop']:
            (apps / app_id).write_text('[Desktop Entry]\nType=Application\nName='+app_id+
                '\nExec=/usr/bin/true\nIcon=applications-system\nTerminal=false\n')
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps',
            "['org.gnome.Nautilus.desktop', 'org.lyraos.PinProbe.desktop']"], env=env, check=True)
        for key, value in [('desktop-profile', 'lyra'), ('panel-height', '32'), ('panel-margin', '12'),
                           ('floating-panel', 'true'), ('panel-menu-position', 'left'),
                           ('show-applications-menu', 'true'), ('show-places-menu', 'true'),
                           ('show-system-menu', 'true'), ('show-search-menu', 'true'),
                           ('show-clock', 'true'), ('show-panel-indicators', 'true')]:
            subprocess.run(['gsettings', '--schemadir', str(production / 'schemas'), 'set',
                            'org.gnome.shell.extensions.sheliak', key, value], env=env, check=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.desktop.interface', 'scaling-factor', str(args.scale)], env=env, check=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                        "['sheliak@lyraos.com.br', '"+uuid+"']"], env=env, check=True)
        result.write_text(json.dumps({'status': 'pending'}))
        with (output / 'bus.log').open('w') as log:
            process = subprocess.Popen(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()),
                '--inside-private-bus', '--output', str(output), '--width', str(args.width), '--scale', str(args.scale)],
                env=env, stdout=log, stderr=log, start_new_session=True)
            try:
                code = process.wait(timeout=90)
            finally:
                try: os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError: pass
        report = json.loads(result.read_text())
        print(json.dumps(dict(status=report.get('status'), checks=len(report.get('checks', [])),
            failed=[c for c in report.get('checks', []) if not c['passed']], error=report.get('error'),
            language=report.get('language'), scale=report.get('scale'), monitor=report.get('monitor')), indent=2), flush=True)
        sys.exit(code)

assert os.environ.get('SHELIAK_PRIVATE_NATIVE_TEST') == '1'
assert os.environ['XDG_RUNTIME_DIR'].startswith('/tmp/sheliak-pins-')
os.environ['DBUS_SYSTEM_BUS_ADDRESS'] = os.environ['DBUS_SESSION_BUS_ADDRESS']
with (output / 'shell.log').open('w') as log:
    shell = subprocess.Popen(['gnome-shell', '--headless', '--wayland', '--no-x11', '--virtual-monitor',
        f'{args.width * args.scale}x{900 * args.scale}', '--sm-disable'], stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 75
        while time.monotonic() < deadline:
            if shell.poll() is not None: raise RuntimeError('Private Shell exited')
            report = json.loads(result.read_text())
            if report['status'] != 'pending': break
            time.sleep(.2)
        else: raise TimeoutError('Pins checks did not finish')
        assert report['status'] == 'passed', report
    finally:
        shell.terminate()
        try: shell.wait(timeout=8)
        except subprocess.TimeoutExpired:
            shell.kill()
            shell.wait(timeout=5)
