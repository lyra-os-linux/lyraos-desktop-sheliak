"""Persistent GTK client for a private Shell lifecycle test; commands on stdin."""
import os
import sys
import gi

assert os.environ.get('SHELIAK_PRIVATE_NATIVE_TEST') == '1'
assert os.environ['XDG_RUNTIME_DIR'].startswith('/tmp/sheliak-pins-')
gi.require_version('Gtk', '4.0')
from gi.repository import GLib, Gtk

GLib.set_prgname('org.lyraos.WindowLifecycle')
app = Gtk.Application(application_id='org.lyraos.WindowLifecycle')
windows = []
serial = 0


def command(_source, condition):
    global serial
    if condition & GLib.IO_HUP:
        app.quit()
        return GLib.SOURCE_REMOVE
    line = sys.stdin.readline().strip().split()
    if not line or line[0] == 'QUIT':
        app.quit()
        return GLib.SOURCE_REMOVE
    if line[0] == 'OPEN':
        assert not windows, 'Previous batch still open'
        count = int(line[1])
        assert 1 <= count <= 24
        for _ in range(count):
            serial += 1
            window = Gtk.ApplicationWindow(application=app,
                title=f'Lyra Window Lifecycle {serial}', default_width=320, default_height=200)
            window.set_child(Gtk.Label(label='Private window lifecycle fixture'))
            windows.append(window)
            window.present()
    elif line[0] == 'CLOSE':
        for window in windows:
            window.close()
        windows.clear()
    else:
        raise ValueError(line)
    return GLib.SOURCE_CONTINUE


def activate(application):
    application.hold()
    GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP, command)


app.connect('activate', activate)
app.run([])
