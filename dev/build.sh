#!/bin/env bash

cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1
cd ../

DEST_DIR=build
PREFIX=/usr
DATADIR=${DEST_DIR}${PREFIX}/share/fyrlang

prepare() {
    printf "Preparing the build folder.\n"
    mkdir -p ${DATADIR}
    mkdir -p ${DATADIR}/src
    mkdir -p ${DATADIR}/pkg

    if [ ! -f lib/index.js ]; then
        printf "Compiler is not yet built, so I'm building it now.\n"
        npm run build
    fi
}

copy_build_files() {
    printf "Copying the built compiler and dependencies.\n"
    cp -r package*.json README.md LICENSE.md ${DATADIR}/
    cp -r bin ${DATADIR}/
    cp -r lib ${DATADIR}/
    cp -r node_modules ${DATADIR}/
    cp -r src/runtime ${DATADIR}/src/
}

clean_deps() {
    printf "Cleaning up development dependencies.\n"
    cd ${DATADIR}/
    npm prune --production >/dev/null 2>&1
    rm -rf node_modules/.cache
    cd - >/dev/null
}

clean_lib() {
    printf "Cleaning up additional development files.\n"
    find ${DATADIR}/lib -type f -name "*.js.map" -exec rm -f {} \;
    find ${DATADIR}/lib -type f -name "*.d.ts" -exec rm -f {} \;
}

rebuild_runtime() {
    printf "Recompiling the runtime.\n"
    cd ${DATADIR}/
    npm run build:lib >/dev/null
    cd - >/dev/null
}

fix_permissions() {
    printf "Fixing permissions.\n"
    chmod -R ug+rwX,o+rX,o-w ${DATADIR}
    chmod -R ug+rwx,o+rx,o-w ${DATADIR}/bin/*
}

prepare
copy_build_files
clean_deps
clean_lib
rebuild_runtime
fix_permissions

printf "Done.\n"
