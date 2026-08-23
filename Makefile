UUID := sheliak@lyraos.com.br
PREFIX ?= /usr
EXTENSIONDIR := $(DESTDIR)$(PREFIX)/share/gnome-shell/extensions/$(UUID)

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
	install -m 0644 dist/extension.js dist/prefs.js dist/prefs.css dist/metadata.json dist/stylesheet.css "$(EXTENSIONDIR)"
	install -d "$(EXTENSIONDIR)/schemas"
	install -m 0644 dist/schemas/* "$(EXTENSIONDIR)/schemas"
	install -d "$(EXTENSIONDIR)/icons"
	install -m 0644 dist/icons/* "$(EXTENSIONDIR)/icons"
	cp -a dist/locale "$(EXTENSIONDIR)/locale"

clean:
	npm run clean
