"""Exercise production Sheliak in a disposable, software-rendered GNOME Shell.

Requires GNOME 48, python3-gobject (GTK4/AT-SPI) and dbus-run-session.
Build first with npm test. Never contacts the desktop or host system bus.
"""
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
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--inside-private-bus', action='store_true')
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
result = output / 'result.json'

if not args.inside_private_bus:
    with tempfile.TemporaryDirectory(prefix='sheliak-keyboard-') as temporary:
        root = Path(temporary)
        env = os.environ.copy()
        for key in ['DISPLAY', 'WAYLAND_DISPLAY', 'SESSION_MANAGER',
                    'DBUS_SESSION_BUS_ADDRESS', 'DBUS_SYSTEM_BUS_ADDRESS', 'XDG_SESSION_ID']:
            env.pop(key, None)
        for key, directory in [('XDG_RUNTIME_DIR', 'run'), ('XDG_CONFIG_HOME', 'config'),
                               ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'),
                               ('XDG_STATE_HOME', 'state')]:
            path = root / directory
            path.mkdir(mode=0o700)
            env[key] = str(path)
        env.update(GSETTINGS_BACKEND='keyfile', LIBGL_ALWAYS_SOFTWARE='1',
                   GALLIUM_DRIVER='llvmpipe', XDG_SESSION_TYPE='wayland',
                   XDG_CURRENT_DESKTOP='GNOME', SHELIAK_NATIVE_RESULT=str(result),
                   SHELIAK_PRIVATE_NATIVE_TEST='1', GTK_A11Y='atspi',
                   SHELIAK_A11Y_DRIVER=str(HERE / 'a11y-action.py'))
        extensions = root / 'data/gnome-shell/extensions'
        uuid = 'sheliak-keyboard-test@lyraos.local'
        extension = extensions / uuid
        extension.mkdir(parents=True)
        (extension / 'metadata.json').write_text(json.dumps({
            'uuid': uuid, 'name': 'Sheliak keyboard regression',
            'description': 'Disposable native keyboard test', 'shell-version': ['48']}))
        shutil.copy2(HERE / 'extension.js', extension / 'extension.js')
        production = extensions / 'sheliak@lyraos.com.br'
        shutil.copytree(args.dist.resolve(), production)
        apps = root / 'data/applications'
        apps.mkdir(parents=True)
        (apps / 'org.lyraos.KeyboardProbe.desktop').write_text(
            '[Desktop Entry]\nType=Application\nName=Lyra Keyboard Probe\n'
            'Exec=/usr/bin/python3 "' + str(HERE / 'probe-app.py') + '"\n'
            'Icon=applications-system\nTerminal=false\nStartupWMClass=org.lyraos.KeyboardProbe\n')
        (apps / 'org.lyraos.KeyboardSibling.desktop').write_text(
            '[Desktop Entry]\nType=Application\nName=Keyboard Sibling\n'
            'Exec=/usr/bin/true\nIcon=applications-system\nTerminal=false\n')
        for key, value in [('desktop-profile', 'lyra'), ('position', 'bottom'),
                           ('hide-mode', 'always'), ('hide-delay', '100'),
                           ('animation', 'false'), ('extend-to-edges', 'false')]:
            subprocess.run(['gsettings', '--schemadir', str(production / 'schemas'), 'set',
                            'org.gnome.shell.extensions.sheliak', key, value], env=env, check=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps',
                        "['org.lyraos.KeyboardProbe.desktop', 'org.lyraos.KeyboardSibling.desktop']"], env=env, check=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                        "['sheliak@lyraos.com.br', '" + uuid + "']"], env=env, check=True)
        result.write_text(json.dumps({'status': 'pending'}))
        with (output / 'bus.log').open('w') as log:
            process = subprocess.Popen(['dbus-run-session', '--', sys.executable,
                                        str(Path(__file__).resolve()), '--inside-private-bus',
                                        '--output', str(output)], env=env, stderr=log,
                                       start_new_session=True)
            try:
                returncode = process.wait(timeout=110)
            finally:
                # Only descendants of our private bus are terminated, including
                # the two probe windows and any private portal helpers.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                time.sleep(.3)
        sys.exit(returncode)

assert os.environ.get('SHELIAK_PRIVATE_NATIVE_TEST') == '1'
assert os.environ['XDG_RUNTIME_DIR'].startswith('/tmp/sheliak-keyboard-')
os.environ['DBUS_SYSTEM_BUS_ADDRESS'] = os.environ['DBUS_SESSION_BUS_ADDRESS']
with (output / 'shell.log').open('w') as log:
    a11y = subprocess.Popen(['/usr/libexec/at-spi2/at-spi-bus-launcher'], stdout=log, stderr=log)
    time.sleep(.5)
    registry = subprocess.Popen(['/usr/libexec/at-spi2/at-spi2-registryd'], stdout=log, stderr=log)
    time.sleep(.5)
    shell = subprocess.Popen(['gnome-shell', '--headless', '--wayland', '--no-x11',
                              '--virtual-monitor', '1280x900', '--sm-disable'],
                             stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if shell.poll() is not None:
                raise RuntimeError(f'Private Shell exited: {shell.returncode}')
            report = json.loads(result.read_text())
            if report['status'] != 'pending':
                break
            time.sleep(.2)
        else:
            raise TimeoutError('Private Shell did not complete tests')
        print(json.dumps({key: value for key, value in report.items() if key != 'events'}, indent=2), flush=True)
        assert report['status'] == 'passed'
    finally:
        shell.terminate()
        try:
            shell.wait(timeout=8)
        except subprocess.TimeoutExpired:
            shell.kill()
            shell.wait(timeout=5)
        for process in [registry, a11y]:
            process.terminate()
            process.wait(timeout=5)
