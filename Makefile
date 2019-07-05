prefix ?= /usr
bindir ?= $(prefix)/bin
datadir ?= $(prefix)/lib
export HOME=/tmp

all: build

build: install_dev
	npm run build

install_dev:
	npm install >/dev/null 2>&1

install_prod:
	npm prune --production
	rm -rf node_modules/.cache

$(DESTDIR)$(datadir)/fyrlang/:
	mkdir -p $@
$(DESTDIR)$(datadir)/fyrlang/package.json: $(DESTDIR)$(datadir)/fyrlang/
	install -DTpm0755 $(notdir $@) $@
$(DESTDIR)$(datadir)/fyrlang/bin/%: $(DESTDIR)$(datadir)/fyrlang/
	install -DTpm0755 bin/$(notdir $@) $@
$(DESTDIR)$(datadir)/fyrlang/lib: $(DESTDIR)$(datadir)/fyrlang/
	cp -a lib $(DESTDIR)$(datadir)/fyrlang/lib
	rm $(DESTDIR)$(datadir)/fyrlang/lib/*.ts
	rm $(DESTDIR)$(datadir)/fyrlang/lib/**/*.ts
	rm $(DESTDIR)$(datadir)/fyrlang/lib/*.map
	rm $(DESTDIR)$(datadir)/fyrlang/lib/**/*.map
$(DESTDIR)$(datadir)/fyrlang/node_modules: install_prod $(DESTDIR)$(datadir)/fyrlang/
	cp -a node_modules $(DESTDIR)$(datadir)/fyrlang/
	$(MAKE) install_dev
$(DESTDIR)$(datadir)/fyrlang/pkg/%: $(DESTDIR)$(datadir)/fyrlang/
	install -DTpm0644 $(subst $(DESTDIR)$(datadir)/fyrlang/,,$@) $(DESTDIR)$(datadir)/fyrlang/$(subst $(DESTDIR)$(datadir)/fyrlang/,,$@)
$(DESTDIR)$(datadir)/fyrlang/src/%: $(DESTDIR)$(datadir)/fyrlang/
	install -DTpm0644 $(subst $(DESTDIR)$(datadir)/fyrlang/,,$@) $(DESTDIR)$(datadir)/fyrlang/$(subst $(DESTDIR)$(datadir)/fyrlang/,,$@)

install: $(DESTDIR)$(datadir)/fyrlang/bin/fyrc \
 $(DESTDIR)$(datadir)/fyrlang/bin/fyrarch \
 $(DESTDIR)$(datadir)/fyrlang/lib \
 $(DESTDIR)$(datadir)/fyrlang/node_modules \
 $(DESTDIR)$(datadir)/fyrlang/$(wildcard pkg/**/fyr_spawn.o)\
 $(DESTDIR)$(datadir)/fyrlang/$(wildcard pkg/**/fyr.o)\
 $(DESTDIR)$(datadir)/fyrlang/src/runtime/utf8/utf8.fyr \
 $(DESTDIR)$(datadir)/fyrlang/src/runtime/fyr_spawn.c \
 $(DESTDIR)$(datadir)/fyrlang/src/runtime/fyr_spawn.h \
 $(DESTDIR)$(datadir)/fyrlang/src/runtime/fyr.c \
 $(DESTDIR)$(datadir)/fyrlang/src/runtime/fyr.h \
 $(DESTDIR)$(datadir)/fyrlang/package.json

package:
ifneq ($(OS),)
ifneq ($(DIST),)
	git clone https://github.com/packpack/packpack.git packpack || \
	git -C packpack pull
	./packpack/packpack
endif
endif

.PHONY: all build install_dev install_prod install package
