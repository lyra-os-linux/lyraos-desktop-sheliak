import type Gio from 'gi://Gio';

export type WindowsProfile = 'windows10' | 'windows11';

export function windowsProfile(settings: Gio.Settings): WindowsProfile | null {
    const profile = settings.get_string('desktop-profile');
    return profile === 'windows10' || profile === 'windows11' ? profile : null;
}
