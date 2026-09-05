Name:           sheliak
Version:        1.12.3
Release:        0
Summary:        Native Lyra OS dock for GNOME Shell
License:        GPL-3.0-or-later
URL:            https://github.com/lyra-os-linux/lyraos-desktop-sheliak
Source0:        %{name}-%{version}.tar.zst
BuildArch:      noarch
BuildRequires:  zstd
Requires:       gnome-shell >= 48
Requires:       gnome-shell < 49

%description
Sheliak is the Lyra OS dock for GNOME Shell. It displays favorite and running
applications, a dynamic Trash icon, application menus, and the native
applications grid button. It also configures the top panel size and visibility
of the clock and native indicators, and provides Applications, Places, System,
and Search menus. The System menu provides system information and Lyra OS links.

%prep
%autosetup

%build
# Release archives contain the pre-built GJS bundle. OBS builds never need
# network access or npm dependencies.
test -f dist/extension.js

%install
install -d %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br
install -m 0644 \
    dist/extension.js \
    dist/prefs.js \
    dist/prefs.css \
    dist/metadata.json \
    dist/stylesheet.css \
    %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/
install -d %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/schemas
install -m 0644 dist/schemas/* \
    %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/schemas/
install -d %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/icons
install -m 0644 dist/icons/* \
    %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/icons/
cp -a dist/locale \
    %{buildroot}%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/locale

%files
%license LICENSE
%doc README.md
%dir %{_datadir}/gnome-shell
%dir %{_datadir}/gnome-shell/extensions
%dir %{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/extension.js
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/prefs.js
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/prefs.css
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/metadata.json
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/stylesheet.css
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/schemas
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/icons
%{_datadir}/gnome-shell/extensions/sheliak@lyraos.com.br/locale

%changelog
