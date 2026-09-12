Name:           sheliak
Version:        2.0.0
Release:        0
Summary:        Lyra GNOME desktop extension suite
License:        GPL-3.0-only AND GPL-3.0-or-later
URL:            https://github.com/lyra-os-linux/lyraos-desktop-sheliak
Source0:        %{name}-%{version}.tar.zst
BuildArch:      noarch
BuildRequires:  zstd
BuildRequires:  python3
BuildRequires:  glib2-tools
Requires:       gnome-shell >= 48
Requires:       gnome-shell < 49
Requires:       nautilus >= 45
Requires:       gjs
Requires:       python3-gobject
Requires:       typelib(Adw)
Requires:       typelib(GdkX11) = 3.0
Requires:       typelib(GnomeDesktop) = 3.0
Requires:       typelib(GnomeAutoar)
Requires:       typelib(Gtk) = 3.0
Provides:       gnome-shell-extension-desktop-icons = 49.0.5
Obsoletes:      gnome-shell-extension-desktop-icons < 50
Conflicts:      gnome-shell-extension-desktop-icons >= 50

%description
Sheliak delivers Lyra Dock, Panel, Menus, Search, Animations and Desktop Icons
as independently enabled GNOME extensions in one coordinated package.
Vega configures the layouts and individual components. Desktop Icons is based
on Desktop Icons NG, with upstream licenses and credits retained.

%prep
%autosetup

%build
# Bundles and catalogs are generated before upload; OBS does not need npm/network.
python3 -c 'import json,pathlib; m=json.load(open("suite.json")); assert len(m["extensions"]) == 6; [json.load(open(pathlib.Path("dist/extensions")/u/"metadata.json")) for u in m["extensions"]]'

%install
install -d %{buildroot}%{_datadir}/gnome-shell/extensions
cp -a dist/extensions/. %{buildroot}%{_datadir}/gnome-shell/extensions/
install -Dm755 packaging/lyra-shell-suite.py %{buildroot}%{_libexecdir}/lyra/shell-suite
install -Dm644 packaging/lyra-shell-suite.desktop %{buildroot}%{_sysconfdir}/xdg/autostart/lyra-shell-suite.desktop
install -d %{buildroot}%{_sysconfdir}/apparmor.d
sed 's|@PREFIX@|%{_prefix}|g' extensions/desktop-icons/apparmor/lyra-desktop-icons.in > %{buildroot}%{_sysconfdir}/apparmor.d/lyra-desktop-icons

%check
test ! -d %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br
test ! -d %{buildroot}%{_datadir}/gnome-shell/extensions/ding@rastersoft.com
for schema in %{buildroot}%{_datadir}/gnome-shell/extensions/*/schemas; do
    glib-compile-schemas --strict --dry-run "$schema"
done

%files
%license LICENSE extensions/desktop-icons/COPYING
%doc README.md docs/extension-suite-contracts.md extensions/desktop-icons/UPSTREAM.md
%dir %{_datadir}/gnome-shell
%dir %{_datadir}/gnome-shell/extensions
%{_datadir}/gnome-shell/extensions/dock@lyraos.com.br
%{_datadir}/gnome-shell/extensions/panel@lyraos.com.br
%{_datadir}/gnome-shell/extensions/menus@lyraos.com.br
%{_datadir}/gnome-shell/extensions/search@lyraos.com.br
%{_datadir}/gnome-shell/extensions/animations@lyraos.com.br
%{_datadir}/gnome-shell/extensions/desktop-icons@lyraos.com.br
%dir %{_libexecdir}/lyra
%{_libexecdir}/lyra/shell-suite
%config(noreplace) %{_sysconfdir}/xdg/autostart/lyra-shell-suite.desktop
%config(noreplace) %{_sysconfdir}/apparmor.d/lyra-desktop-icons

%changelog
