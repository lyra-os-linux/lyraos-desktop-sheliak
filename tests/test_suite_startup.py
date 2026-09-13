"""Real D-Bus timeout regression, always on a disposable session bus."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class StartupIntegration(unittest.TestCase):
    def test_delayed_shell_service(self):
        if not shutil.which('dbus-run-session'):
            self.skipTest('dbus-run-session unavailable')
        probe = subprocess.run([sys.executable, '-c', 'from gi.repository import Gio, GLib'], capture_output=True)
        if probe.returncode:
            self.skipTest('PyGObject unavailable')
        with tempfile.TemporaryDirectory(prefix='lyra-startup-') as temporary:
            root = Path(temporary)
            env = os.environ.copy()
            for key in ['DBUS_SESSION_BUS_ADDRESS', 'DBUS_SYSTEM_BUS_ADDRESS', 'DISPLAY', 'WAYLAND_DISPLAY']:
                env.pop(key, None)
            for key in ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR']:
                directory = root/key
                directory.mkdir(mode=0o700)
                env[key] = str(directory)
            env['GSETTINGS_BACKEND'] = 'keyfile'
            extensions = Path(env['XDG_DATA_HOME'])/'gnome-shell/extensions'
            shutil.copytree(ROOT/'dist/extensions', extensions)
            result = subprocess.run(['dbus-run-session', '--', sys.executable, str(Path(__file__).resolve()), '--inside'],
                env=env, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            self.assertIn('startup recovery passed', result.stdout)


def inside():
    from gi.repository import Gio, GLib
    assert os.environ['HOME'].startswith('/tmp/lyra-startup-')
    import importlib.util
    spec = importlib.util.spec_from_file_location('suite', ROOT/'packaging/lyra-shell-suite.py')
    suite = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(suite)
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName',
        GLib.Variant('(su)', ('org.gnome.Shell.Extensions', 0)), None, Gio.DBusCallFlags.NONE, 1000, None)
    info = Gio.DBusNodeInfo.new_for_xml("""<node><interface name="org.gnome.Shell.Extensions">
      <method name="ListExtensions"><arg type="a{sa{sv}}" direction="out"/></method>
      <method name="GetExtensionInfo"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method>
    </interface></node>""").interfaces[0]
    delay_first = [True]
    def method(connection, sender, path, interface, name, parameters, invocation):
        if name == 'GetExtensionInfo':
            invocation.return_value(GLib.Variant('(a{sv})', ({'state': GLib.Variant('d', 2)},)))
            return
        response = GLib.Variant('(a{sa{sv}})', ({uuid: {'state': GLib.Variant('d', 6)} for uuid in suite.UUIDS.values()},))
        if delay_first[0]:
            delay_first[0] = False
            def delayed():
                invocation.return_value(response)
                return GLib.SOURCE_REMOVE
            GLib.timeout_add(1500, delayed)
        else:
            invocation.return_value(response)
    registration = bus.register_object('/org/gnome/Shell/Extensions', info, method, None, None)
    shell = Gio.Settings.new('org.gnome.shell')
    shell.set_strv('enabled-extensions', [suite.OLD_SHELL, suite.OLD_DESKTOP, 'third-party@example.org'])
    shell.set_strv('disabled-extensions', ['policy@example.org'])
    Gio.Settings.sync()
    before = shell.get_strv('enabled-extensions')
    def command(args):
        process = subprocess.Popen([sys.executable, str(ROOT/'packaging/lyra-shell-suite.py'), *args],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        loop = GLib.MainLoop()
        def poll():
            if process.poll() is not None:
                loop.quit()
                return GLib.SOURCE_REMOVE
            return GLib.SOURCE_CONTINUE
        GLib.timeout_add(20, poll)
        loop.run()
        stdout, stderr = process.communicate()
        return process.returncode, stdout, stderr
    code, _, error = command(['migrate'])
    assert code != 0 and 'Timeout' in error, error
    assert shell.get_strv('enabled-extensions') == before
    assert not (Path(os.environ['XDG_STATE_HOME'])/'lyra/shell-suite/migration-v1.json').exists()
    delay_first[0] = True
    code, stdout, stderr = command(['migrate', '--wait-for-shell'])
    assert code == 0, stderr
    state = json.loads(stdout)
    assert state['profile'] == 'lyra' and all(state['components'].values()), state
    enabled = shell.get_strv('enabled-extensions')
    assert set(suite.UUIDS.values()).issubset(enabled) and suite.OLD_SHELL not in enabled
    assert 'third-party@example.org' in enabled
    assert shell.get_strv('disabled-extensions') == ['policy@example.org']
    bus.unregister_object(registration)
    print('startup recovery passed')

if __name__ == '__main__':
    if '--inside' in sys.argv: inside()
    else: unittest.main()
