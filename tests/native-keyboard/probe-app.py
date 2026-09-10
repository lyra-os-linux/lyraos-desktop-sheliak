import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk

app = Gtk.Application(application_id='org.lyraos.KeyboardProbe')

def activate(application):
    if application.get_windows():
        application.get_windows()[0].present()
        return
    for number in range(2):
        window = Gtk.ApplicationWindow(application=application, title=f'Keyboard Probe {number}')
        window.set_default_size(320, 200)
        window.present()

app.connect('activate', activate)
app.run(None)
