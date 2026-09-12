"""Simulate a Vega process exiting after layout writes, before component commit."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

assert os.environ.get('SHELIAK_PRIVATE_NATIVE_TEST') == '1'
assert os.environ['HOME'].startswith('/tmp/sheliak-pins-')
helper = sys.argv[1]
subprocess.run([helper, 'begin-profile', 'windows10'], check=True, stdout=subprocess.DEVNULL)
# Even another helper invocation must not recover a still-live controller.
assert subprocess.run([helper, 'apply', 'macos'], capture_output=True).returncode != 0
assert subprocess.run([helper, 'status'], capture_output=True).returncode != 0
spec = importlib.util.spec_from_file_location('suite', helper)
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
session = suite.Session()
session.settings.set_uint('icon-size', 96)
session.settings.set_string('desktop-profile', 'windows10')
enabled, disabled = session.lists()
session.write_lists(['recovery-test@example.org'] + [u for u in enabled if u not in suite.UUIDS.values()], disabled)
session.Gio.Settings.sync()
# Exit without commit/abort, just as a crashed controlling process would.
os._exit(0)
