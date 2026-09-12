import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('suite', ROOT / 'packaging/lyra-shell-suite.py')
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)


class Settings:
    def __init__(self, **values):
        self.values, self.saved, self.fail_key = values, None, None

    def get_string(self, key): return self.values.get(key, '')
    def get_boolean(self, key): return self.values.get(key, False)
    def get_strv(self, key): return list(self.values.get(key, []))
    def is_writable(self, key): return key != self.fail_key
    def set_string(self, key, value):
        if key == self.fail_key: return False
        self.values[key] = value
        return True
    set_strv = set_string
    def delay(self): self.saved = dict(self.values)
    def apply(self): self.saved = None
    def revert(self):
        if self.saved is not None: self.values = self.saved
        self.saved = None


class SuiteMigrationTests(unittest.TestCase):
    def setUp(self):
        self.session = suite.Session.__new__(suite.Session)
        self.session.Gio = types.SimpleNamespace(Settings=types.SimpleNamespace(sync=lambda: None))
        self.session.shell = Settings(**{
            'enabled-extensions': ['other@example.org', *suite.UUIDS.values()],
            'disabled-extensions': ['policy@example.org'],
        })
        self.session.settings = Settings(**{'suite-current-profile': 'lyra', 'desktop-profile': 'lyra'})
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.session.state_dir = Path(directory.name)
        self.session.migrate = self.session.recover_transition

    def test_profiles_preserve_individual_choices_and_desktop_independence(self):
        s = self.session
        s.toggle('desktop-icons', False)
        s.apply('windows10')
        s.toggle('animations', False)
        s.apply('windows11')
        s.apply('windows10')
        state = s.status()
        self.assertFalse(state['components']['animations'])
        self.assertFalse(state['components']['desktop-icons'])
        s.apply('vanilla')
        self.assertFalse(any(s.status()['components'].values()))
        s.apply('lyra')
        self.assertFalse(s.status()['components']['desktop-icons'])
        self.assertIn('other@example.org', s.lists()[0])
        self.assertEqual(s.lists()[1], ['policy@example.org'])

    def test_explicit_all_off_profile_is_not_reseeded(self):
        s = self.session
        for role in suite.ROLES: s.toggle(role, False)
        s.apply('macos')
        s.apply('lyra')
        self.assertFalse(any(s.status()['components'][r] for r in suite.ROLES))
        self.assertTrue(s.status()['components']['desktop-icons'])

    def test_global_disable_and_invalid_state_do_not_change_preferences(self):
        s = self.session
        before = s.lists()
        s.shell.values['disable-user-extensions'] = True
        with self.assertRaises(ValueError): s.apply('macos')
        with self.assertRaises(ValueError): s.toggle('dock', True)
        self.assertEqual(before, s.lists())
        s.shell.values['disable-user-extensions'] = False
        for bad in ['[]', '{"lyra": {}}', '{"lyra": {"dock": 1}}', 'broken']:
            s.settings.values['suite-profile-components'] = bad
            with self.assertRaises(ValueError): s.apply('windows10')
            self.assertEqual(before, s.lists())

    def test_failed_profile_persistence_restores_extension_selection(self):
        s = self.session
        before = s.lists()
        s.settings.fail_key = 'suite-current-profile'
        with self.assertRaises(ValueError): s.apply('windows10')
        self.assertEqual(s.lists(), before)
        self.assertEqual(s.settings.get_string('suite-current-profile'), 'lyra')
        self.assertEqual(s.settings.get_string('suite-profile-components'), '')

    def test_interrupted_transition_recovers_owned_state_and_preserves_third_parties(self):
        s = self.session
        before = s.lists()
        s.atomic_json(s.state_dir / 'transition-v1.json', {'enabled': before[0], 'disabled': before[1],
            'current': 'lyra', 'states': ''})
        s.shell.values['enabled-extensions'] = ['new-third-party@example.org']
        with self.assertRaises(ValueError): s.status()
        s.recover_transition()
        self.assertEqual(s.status()['profile'], 'lyra')
        self.assertTrue(s.status()['components']['dock'])
        self.assertIn('new-third-party@example.org', s.lists()[0])
        self.assertNotIn('other@example.org', s.lists()[0])
        s.recover_transition()

    def test_new_package_requires_shell_discovery_before_disabling_legacy(self):
        s = self.session
        before = s.lists()
        s.runtime_extensions = lambda: {suite.OLD_SHELL: {'state': 1}}
        with self.assertRaisesRegex(ValueError, 'sign in again'):
            s.ensure_runtime_ready()
        self.assertEqual(s.lists(), before)
        s.runtime_extensions = lambda: {uuid: {'state': 2} for uuid in suite.UUIDS.values()}
        s.ensure_runtime_ready()

    def test_vanilla_requires_selecting_a_layout_before_enabling_shell_components(self):
        self.session.apply('vanilla')
        with self.assertRaises(ValueError): self.session.toggle('dock', True)
        self.session.toggle('desktop-icons', False)


class SuitePayloadTests(unittest.TestCase):
    def test_exact_six_extension_payload_and_no_legacy_uuid(self):
        manifest = json.loads((ROOT / 'suite.json').read_text())
        payload = ROOT / 'dist/extensions'
        self.assertEqual(set(p.name for p in payload.iterdir()), set(manifest['extensions']))
        self.assertEqual(len(manifest['extensions']), 6)
        self.assertNotIn(suite.OLD_SHELL, manifest['extensions'])
        self.assertNotIn(suite.OLD_DESKTOP, manifest['extensions'])
        for uuid in manifest['extensions']:
            metadata = json.loads((payload / uuid / 'metadata.json').read_text())
            self.assertEqual(metadata['uuid'], uuid)
            self.assertEqual(metadata['lyra-suite-api'], 1)
            self.assertEqual(metadata['shell-version'], ['48'])
            self.assertTrue((payload / uuid / 'extension.js').is_file())
        menus = (payload / suite.UUIDS['menus'] / 'extension.js').read_text()
        self.assertNotIn('gi://Tracker', menus)

    def test_portuguese_and_spanish_desktop_catalogs_are_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            for lang in ['pt_BR', 'es']:
                po = ROOT / 'extensions/desktop-icons/po' / f'{lang}.po'
                result = subprocess.run(['msgfmt', '--check', '--statistics', '-o', str(Path(tmp)/'catalog.mo'), str(po)],
                    text=True, capture_output=True, check=True, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
                self.assertIn('190 translated messages', result.stderr)
                self.assertNotIn('fuzzy', result.stderr)
                self.assertNotIn('untranslated', result.stderr)


if __name__ == '__main__': unittest.main()
