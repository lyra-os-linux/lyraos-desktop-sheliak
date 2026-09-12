PREFIX ?= /usr
SYSCONFDIR ?= /etc
EXTENSIONDIR := $(DESTDIR)$(PREFIX)/share/gnome-shell/extensions

.PHONY: all check clean dist install pack
all: dist
check:
	npm run check
dist:
	npm run build
pack: dist
	npm run pack
install: dist
	install -d "$(EXTENSIONDIR)"
	cp -a dist/extensions/. "$(EXTENSIONDIR)/"
	install -Dm755 packaging/lyra-shell-suite.py "$(DESTDIR)$(PREFIX)/libexec/lyra/shell-suite"
	install -Dm644 packaging/lyra-shell-suite.desktop "$(DESTDIR)$(SYSCONFDIR)/xdg/autostart/lyra-shell-suite.desktop"
clean:
	npm run clean
