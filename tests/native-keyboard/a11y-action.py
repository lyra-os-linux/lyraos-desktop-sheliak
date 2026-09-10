"""Invoke the Shell button's exported AT-SPI action on the private bus."""
import json
import os
import time
from pathlib import Path
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi, GLib

assert os.environ['SHELIAK_PRIVATE_NATIVE_TEST'] == '1'
result = Path(os.environ['XDG_RUNTIME_DIR']) / 'a11y-result.json'

def walk(node, depth=0):
    if depth > 30:
        return
    yield node
    for index in range(node.get_child_count()):
        child = node.get_child_at_index(index)
        if child:
            yield from walk(child, depth + 1)

try:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        while GLib.MainContext.default().iteration(False):
            pass
        matches = [node for node in walk(Atspi.get_desktop(0))
                   if node.get_name() == 'Lyra Keyboard Probe'
                   and node.get_role() == Atspi.Role.PUSH_BUTTON
                   and node.get_state_set().contains(Atspi.StateType.SHOWING)]
        if matches:
            action = matches[0].get_action_iface()
            assert action is not None, 'No exported AT-SPI Action interface'
            names = [action.get_localized_name(i) for i in range(action.get_n_actions())]
            assert names, 'No exported accessible action'
            # AT-SPI acknowledges queueing independently of the Atk.Action
            # return value. The Shell-side counter checks this does not launch.
            action.do_action(1)
            time.sleep(.1)
            component = matches[0].get_component_iface()
            assert component.grab_focus(), 'Accessible focus failed'
            bounds = component.get_extents(Atspi.CoordType.SCREEN)
            assert bounds.width > 0 and bounds.height > 0, 'Accessible geometry missing'
            accepted = action.do_action(0)
            assert accepted, 'Accessible action rejected'
            result.write_text(json.dumps({'status': 'passed', 'actions': names, 'accepted': accepted}))
            break
        time.sleep(.1)
    else:
        raise TimeoutError('Shell button missing from private AT-SPI tree')
except Exception as error:
    result.write_text(json.dumps({'status': 'failed', 'error': str(error)}))
    raise
