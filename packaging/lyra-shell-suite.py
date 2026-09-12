#!/usr/bin/python3
"""Unprivileged session coordinator. No desktop file operations or package changes."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time

ROLES = ('dock', 'panel', 'menus', 'search', 'animations')
UUIDS = {role: f'{role}@lyraos.com.br' for role in (*ROLES, 'desktop-icons')}
OLD_SHELL = 'sheliak@lyraos.com.br'
OLD_DESKTOP = 'ding@rastersoft.com'
PROFILES = ('lyra', 'ubuntu', 'windows10', 'windows11', 'macos', 'vanilla')


def profile_defaults(profile):
    if profile not in PROFILES:
        raise ValueError('Unknown desktop profile')
    return {role: profile != 'vanilla' and not (
        role == 'search' and profile != 'lyra' or role == 'menus' and profile == 'ubuntu'
    ) for role in ROLES}


def effective(enabled, disabled, uuid):
    return uuid in enabled and uuid not in disabled


def replace_owned(before, desired, owned):
    """Preserve unrelated extensions and order; never turn an empty list into defaults."""
    return [value for value in before if value not in owned] + [
        value for value in desired if value in owned
    ]


def parse_profiles(raw):
    states = json.loads(raw or '{}')
    if not isinstance(states, dict):
        raise ValueError('Invalid saved component preferences')
    for profile, roles in states.items():
        if profile not in PROFILES or not isinstance(roles, dict):
            raise ValueError('Invalid saved profile')
        if set(roles) != set(ROLES) or any(type(value) is not bool for value in roles.values()):
            raise ValueError('Invalid saved components')
    return states


class Session:
    def __init__(self):
        import gi
        from gi.repository import Gio, GLib
        self.Gio, self.GLib = Gio, GLib
        self.shell = Gio.Settings.new('org.gnome.shell')
        self.data_roots = [Path(GLib.get_user_data_dir()), Path('/usr/local/share'), Path('/usr/share')]
        self.settings = self.schema('org.gnome.shell.extensions.sheliak', 'dock')
        self.state_dir = Path(GLib.get_user_state_dir()) / 'lyra/shell-suite'
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)

    def installed(self, role):
        for root in self.data_roots:
            directory = root / 'gnome-shell/extensions' / UUIDS[role]
            metadata = directory / 'metadata.json'
            if metadata.is_file():
                data = json.loads(metadata.read_text())
                if data.get('uuid') != UUIDS[role] or data.get('lyra-suite-api') != 1:
                    raise ValueError(f'Incompatible extension: {role}')
                return directory
        raise ValueError(f'Missing extension: {role}')

    def schema(self, name, role):
        source = self.Gio.SettingsSchemaSource.new_from_directory(
            str(self.installed(role) / 'schemas'), self.Gio.SettingsSchemaSource.get_default(), False)
        schema = source.lookup(name, True)
        if not schema:
            raise ValueError(f'Missing schema: {name}')
        return self.Gio.Settings.new_full(schema, None, None)

    def lists(self):
        return self.shell.get_strv('enabled-extensions'), self.shell.get_strv('disabled-extensions')

    def write_lists(self, enabled, disabled):
        self.shell.delay()
        try:
            for key, value in [('enabled-extensions', enabled), ('disabled-extensions', disabled)]:
                if not self.shell.is_writable(key) or not self.shell.set_strv(key, value):
                    raise ValueError(f'Cannot write {key}')
            self.shell.apply()
            self.Gio.Settings.sync()
            if self.lists() != (enabled, disabled):
                raise ValueError('Extension preferences were not persisted')
        except Exception:
            self.shell.revert()
            raise

    def atomic_json(self, path, value):
        fd, temporary = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def runtime_extensions(self):
        if not os.environ.get('DBUS_SESSION_BUS_ADDRESS'):
            return None
        bus = self.Gio.bus_get_sync(self.Gio.BusType.SESSION, None)
        return bus.call_sync('org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions',
            'org.gnome.Shell.Extensions', 'ListExtensions', None, None,
            self.Gio.DBusCallFlags.NONE, 1000, None).unpack()[0]

    def ensure_runtime_ready(self):
        states = self.runtime_extensions()
        if states is not None and not set(UUIDS.values()).issubset(states):
            raise ValueError('The new Lyra extensions are not loaded yet; sign in again')

    def wait_legacy_disabled(self, uuids):
        for uuid in uuids:
            deadline = time.monotonic() + 5
            while True:
                reply = self.Gio.bus_get_sync(self.Gio.BusType.SESSION, None).call_sync('org.gnome.Shell.Extensions',
                    '/org/gnome/Shell/Extensions', 'org.gnome.Shell.Extensions', 'GetExtensionInfo',
                    self.GLib.Variant('(s)', (uuid,)), None, self.Gio.DBusCallFlags.NONE, 1000, None)
                if reply.unpack()[0].get('state') != 1:
                    break
                if time.monotonic() >= deadline:
                    raise ValueError('Legacy extension is still active; sign in again')
                time.sleep(0.1)

    @staticmethod
    def process_identity(pid):
        try:
            # comm may contain spaces or parentheses; starttime is field 22.
            return f"{pid}:{Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]}"
        except (FileNotFoundError, ProcessLookupError):
            return None

    def snapshot_settings(self):
        return {key: value.print_(True) if value is not None else None
            for key in self.settings.props.settings_schema.list_keys()
            for value in [self.settings.get_user_value(key)]}

    def restore_settings(self, values):
        schema = self.settings.props.settings_schema
        parsed = {}
        for key, value in values.items():
            if not schema.has_key(key) or not self.settings.is_writable(key):
                raise ValueError(f'Cannot restore profile preference: {key}')
            parsed[key] = None if value is None else self.GLib.Variant.parse(
                schema.get_key(key).get_value_type(), value, None, None)
            if parsed[key] is not None and not schema.get_key(key).range_check(parsed[key]):
                raise ValueError(f'Invalid saved preference: {key}')
        self.settings.delay()
        try:
            for key, value in parsed.items():
                if value is None:
                    self.settings.reset(key)
                elif not self.settings.set_value(key, value):
                    raise ValueError(f'Cannot restore profile preference: {key}')
            self.settings.apply()
            self.Gio.Settings.sync()
            for key, value in parsed.items():
                if self.settings.get_user_value(key) != value:
                    raise ValueError(f'Profile recovery readback failed: {key}')
        except Exception:
            self.settings.revert()
            raise

    def restore_profile(self, record):
        self.restore_settings(record['settings'])
        enabled, disabled = self.lists()
        owned = {UUIDS[r] for r in ROLES}
        self.write_lists(replace_owned(enabled, record['enabled'], owned),
            replace_owned(disabled, record['disabled'], owned))
        # The outer journal supersedes a component transition inside it.
        (self.state_dir / 'transition-v1.json').unlink(missing_ok=True)
        (self.state_dir / 'profile-v1.json').unlink()

    def recover_profile(self):
        journal = self.state_dir / 'profile-v1.json'
        if not journal.exists(): return
        record = json.loads(journal.read_text())
        owner = record['owner']
        if owner == self.process_identity(os.getppid()) and getattr(self, 'profile_operation', False):
            return
        if owner == self.process_identity(int(owner.split(':')[0])):
            raise ValueError('Another Vega process is changing the desktop profile')
        self.restore_profile(record)

    def begin_profile(self, profile):
        self.migrate()
        if profile != 'vanilla' and self.shell.get_boolean('disable-user-extensions'):
            raise ValueError('GNOME extensions are globally disabled')
        parse_profiles(self.settings.get_string('suite-profile-components'))
        enabled, disabled = self.lists()
        self.atomic_json(self.state_dir / 'profile-v1.json', {
            'owner': self.process_identity(os.getppid()), 'target': profile,
            'enabled': enabled, 'disabled': disabled, 'settings': self.snapshot_settings()})

    def finish_profile(self, profile, abort=False):
        journal = self.state_dir / 'profile-v1.json'
        record = json.loads(journal.read_text())
        if record['owner'] != self.process_identity(os.getppid()) or record['target'] != profile:
            raise ValueError('Profile transaction belongs to another process')
        if abort:
            self.restore_profile(record)
        else:
            self.profile_operation = True
            self.apply(profile)
            journal.unlink()

    def recover_transition(self):
        journal = self.state_dir / 'transition-v1.json'
        if not journal.exists(): return
        record = json.loads(journal.read_text())
        parse_profiles(record['states'])
        if record['current'] not in PROFILES:
            raise ValueError('Invalid transition journal')
        enabled, disabled = self.lists()
        owned = {UUIDS[r] for r in ROLES}
        self.write_lists(replace_owned(enabled, record['enabled'], owned),
            replace_owned(disabled, record['disabled'], owned))
        for key, value in [('suite-current-profile', record['current']),
                           ('suite-profile-components', record['states'])]:
            if not self.settings.set_string(key, value):
                raise ValueError('Cannot restore interrupted profile transition')
        self.Gio.Settings.sync()
        journal.unlink()

    def migrate(self):
        self.recover_profile()
        self.recover_transition()
        stamp = self.state_dir / 'migration-v1.json'
        if stamp.exists() and json.loads(stamp.read_text()).get('complete'):
            return
        for role in UUIDS:
            self.installed(role)
        # A package upgrade does not make new UUIDs discoverable in an already
        # running Shell. Keep the old desktop active until a fresh login.
        self.ensure_runtime_ready()
        enabled, disabled = self.lists()
        if stamp.exists():
            record = json.loads(stamp.read_text())
        else:
            # Snapshot precedes every mutation and is retained for recovery.
            record = {'complete': False, 'enabled': enabled, 'disabled': disabled,
                'settings': {key: value.print_(True) for key in self.settings.props.settings_schema.list_keys()
                    if (value := self.settings.get_user_value(key)) is not None}}
            self.atomic_json(stamp, record)
        legacy_active = effective(record['enabled'], record['disabled'], OLD_SHELL)
        desktop_active = effective(record['enabled'], record['disabled'], OLD_DESKTOP)
        desired = {UUIDS[role]: legacy_active for role in ROLES}
        desired[UUIDS['desktop-icons']] = desktop_active
        # Explicit choices for a new UUID take precedence, including disabled.
        for uuid in desired:
            if uuid in record['enabled'] or uuid in record['disabled']:
                desired[uuid] = effective(record['enabled'], record['disabled'], uuid)
        owned = set(UUIDS.values()) | {OLD_SHELL, OLD_DESKTOP}
        legacy = [uuid for uuid in (OLD_SHELL, OLD_DESKTOP) if uuid in record['enabled']]
        self.write_lists([uuid for uuid in enabled if uuid not in (OLD_SHELL, OLD_DESKTOP)], disabled)
        if legacy:
            self.wait_legacy_disabled(legacy)
        # Legacy schema is shipped privately so migration also works after RPM replacement.
        schema_source = self.Gio.SettingsSchemaSource.new_from_directory(
            str(self.installed('desktop-icons') / 'legacy-schemas'),
            self.Gio.SettingsSchemaSource.get_default(), False)
        old = self.Gio.Settings.new_full(schema_source.lookup('org.gnome.shell.extensions.ding', False), None, None)
        new = self.schema('org.gnome.shell.extensions.lyra-desktop-icons', 'desktop-icons')
        for key in old.props.settings_schema.list_keys():
            value = old.get_user_value(key)
            if value is not None and new.get_user_value(key) is None:
                if not new.set_value(key, value):
                    raise ValueError(f'Could not migrate desktop preference {key}')
        enabled, disabled = self.lists()
        self.write_lists(replace_owned(enabled, [uuid for uuid, active in desired.items() if active], owned),
            [uuid for uuid in disabled if uuid not in (OLD_SHELL, OLD_DESKTOP)])
        if not self.settings.get_string('suite-current-profile'):
            current = self.settings.get_string('desktop-profile') if any(desired[UUIDS[r]] for r in ROLES) else 'vanilla'
            if not self.settings.set_string('suite-current-profile', current):
                raise ValueError('Cannot save migrated profile')
        self.Gio.Settings.sync()
        record['complete'] = True
        self.atomic_json(stamp, record)

    def status(self, pending_ok=False):
        if not pending_ok and not getattr(self, 'profile_operation', False) and (self.state_dir / 'profile-v1.json').exists():
            raise ValueError('Incomplete desktop profile change; retry the profile change')
        if (self.state_dir / 'transition-v1.json').exists():
            raise ValueError('Incomplete profile transition; retry the profile change')
        enabled, disabled = self.lists()
        if not pending_ok and effective(enabled, disabled, OLD_SHELL) and not self.settings.get_string('suite-current-profile'):
            raise ValueError('Desktop migration is pending; sign in again')
        return {'version': 1, 'profile': self.settings.get_string('suite-current-profile') or
            (self.settings.get_string('desktop-profile') if any(effective(enabled, disabled, UUIDS[r]) for r in ROLES) else 'vanilla'),
            'globally_disabled': self.shell.get_boolean('disable-user-extensions'),
            'components': {role: effective(enabled, disabled, uuid) for role, uuid in UUIDS.items()}}

    def diagnostics(self):
        installed = {}
        for role in UUIDS:
            try:
                self.installed(role)
                installed[role] = True
            except (ValueError, OSError):
                installed[role] = False
        # Runtime is separate from stored preferences, and may be unavailable
        # outside a running Shell. Never infer activation from an enabled UUID.
        try:
            states = self.runtime_extensions()
        except self.GLib.Error:
            states = None
        return {'installed': installed, 'runtime': {role:
            states.get(uuid, {}).get('state') if states is not None else None
            for role, uuid in UUIDS.items()}}

    def apply(self, profile):
        self.migrate()
        if profile != 'vanilla' and self.shell.get_boolean('disable-user-extensions'):
            raise ValueError('GNOME extensions are globally disabled')
        states = parse_profiles(self.settings.get_string('suite-profile-components'))
        status = self.status()
        current = status['profile']
        states[current] = {r: status['components'][r] for r in ROLES}
        desired = states.get(profile, profile_defaults(profile))
        if profile == 'vanilla':
            desired = profile_defaults(profile)
        enabled, disabled = self.lists()
        owned = {UUIDS[r] for r in ROLES}
        journal = self.state_dir / 'transition-v1.json'
        self.atomic_json(journal, {'enabled': enabled, 'disabled': disabled,
            'current': current, 'states': self.settings.get_string('suite-profile-components')})
        self.write_lists(replace_owned(enabled, [UUIDS[r] for r in ROLES if desired[r]], owned),
            [uuid for uuid in disabled if uuid not in owned])
        self.settings.delay()
        try:
            if not self.settings.set_string('suite-profile-components', json.dumps(states)):
                raise ValueError('Cannot save component preferences')
            if not self.settings.set_string('suite-current-profile', profile):
                raise ValueError('Cannot save selected profile')
            self.settings.apply()
            self.Gio.Settings.sync()
            if self.settings.get_string('suite-current-profile') != profile:
                raise ValueError('Profile readback failed')
            journal.unlink()
        except Exception:
            self.settings.revert()
            self.write_lists(enabled, disabled)
            # Keep the journal if restoring settings is blocked; a later retry
            # or login can recover and status must not report a false success.
            if self.settings.get_string('suite-current-profile') == current and self.settings.get_string('suite-profile-components') == json.loads(journal.read_text())['states']:
                journal.unlink()
            raise

    def rollback(self):
        """Prepare the session for reinstalling the previous compatible RPM set."""
        self.recover_profile()
        self.recover_transition()
        stamp = self.state_dir / 'migration-v1.json'
        record = json.loads(stamp.read_text())
        saved = record['settings']
        self.restore_settings({key: saved.get(key)
            for key in self.settings.props.settings_schema.list_keys()})
        enabled, disabled = self.lists()
        owned = set(UUIDS.values()) | {OLD_SHELL, OLD_DESKTOP}
        self.write_lists(replace_owned(enabled, record['enabled'], owned),
            replace_owned(disabled, record['disabled'], owned))
        self.atomic_json(self.state_dir / 'last-rollback-v1.json', record)
        stamp.unlink()

    def toggle(self, role, active):
        if role not in UUIDS:
            raise ValueError('Unknown component')
        self.migrate()
        if active and role != 'desktop-icons' and self.status()['profile'] == 'vanilla':
            raise ValueError('Select a Lyra layout before enabling its components')
        if active and self.shell.get_boolean('disable-user-extensions'):
            raise ValueError('GNOME extensions are globally disabled')
        enabled, disabled = self.lists()
        target = UUIDS[role]
        self.write_lists(replace_owned(enabled, [target] if active else [], {target}),
            [uuid for uuid in disabled if uuid != target] if active else disabled)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'migrate', 'apply', 'toggle', 'begin-profile', 'commit-profile', 'abort-profile', 'rollback'])
    parser.add_argument('target', nargs='?')
    parser.add_argument('value', nargs='?', choices=['on', 'off'])
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error('Run in the desktop user session, never as root')
    if args.action in ('apply', 'begin-profile', 'commit-profile', 'abort-profile') and args.target not in PROFILES:
        parser.error('A supported profile is required')
    if args.action == 'toggle' and (args.target not in UUIDS or args.value is None):
        parser.error('A component and on/off are required')
    session = Session()
    with (session.state_dir / 'session.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == 'migrate':
            session.migrate()
        elif args.action == 'apply':
            session.apply(args.target)
        elif args.action == 'rollback':
            session.rollback()
        elif args.action == 'begin-profile':
            session.begin_profile(args.target)
        elif args.action in ('commit-profile', 'abort-profile'):
            session.finish_profile(args.target, abort=args.action == 'abort-profile')
        elif args.action == 'toggle':
            session.toggle(args.target, args.value == 'on')
        state = session.status(pending_ok=args.action in ('begin-profile', 'rollback'))
        if args.action == 'status':
            state.update(session.diagnostics())
        print(json.dumps(state))


if __name__ == '__main__':
    import sys
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
