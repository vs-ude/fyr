"use strict";

import fs = require('fs');
import path = require('path');
import program = require('commander');
import colors = require('colors');
import { Package } from "./pkg";
import { FyrConfiguration } from "./config";

// Make TSC not throw out the colors lib
colors.red;

var pkgJson = JSON.parse(fs.readFileSync(path.join(path.dirname(module.filename), '../package.json'), 'utf8'));

function runCompiler() {
    if (program.emitNative && program.emitWasm) {
        console.log(("Only one code emit path can be selected".red));
        process.exit(1);
    }
    if (program.emitC && program.emitWasm) {
        console.log(("Only one code emit path can be selected".red));
        process.exit(1);
    }
    let config = new FyrConfiguration;
    config.disableCodegen = program.disableCodegen;
    config.emitC = program.emitC || program.emitNative;
    config.emitNative = config.emitNative;
    config.emitIr = program.emitIr;

    var args: Array<object | string> = Array.prototype.slice.call(arguments, 0);
    if (args.length <= 1) {
        console.log(("Missing package or file information").red);
        process.exit(1);
    }
    args = args.splice(args.length -2, 1);
    
    config.fyrPaths = Package.getFyrPaths();
    if (!config.fyrPaths) {
        process.exit(1);
    }
    config.sourcePath = args;

    let pkg: Package = constructPkg(config);

//    if (!program.disableRuntime) {
//        files.push(path.join(fyrBase, "runtime/mem.fyr"));
//        files.push(path.join(fyrBase, "runtime/map.fyr"));
//    }

    compile(pkg, config);
}

export function constructPkg(config: FyrConfiguration): Package {
    let pkg: Package;
    // Compile a package?
    if (config.sourcePath.length == 1) {
        let p = path.resolve(config.sourcePath[0] as string);
        if (p[p.length - 1] != path.sep) {
            p += path.sep;
        }
        let isdir: boolean;
        try {
            isdir = fs.lstatSync(p).isDirectory();
        } catch(e) {
            isdir = false;
        }        
        if (isdir) {
            // Is this package located in one of the known pathes. If yes -> put the output in the right location
            for(let fyrPath of config.fyrPaths) {
                let test = path.join(path.normalize(fyrPath), "src");
                if (test[test.length - 1] != path.sep) {
                    test += path.sep;
                }
                if (p.length > test.length && p.substr(0, test.length) == test) {
                    let pkgPath = p.substring(test.length, p.length - 1);
                    let packagePaths: Array<string> = pkgPath.split(path.sep);
                    packagePaths.splice(packagePaths.length - 1, 1);
                    pkg = new Package(true);
                    pkg.findSources(fyrPath, pkgPath);
                    break;
                }
            }
            // Not a package in one of the Fyr paths?
            if (!pkg) {
                // Determine all filenames
                let files: Array<string> = [];
                let allFiles = fs.readdirSync(p);
                for(let f of allFiles) {
                    if (f.length > 4 && f.substr(f.length - 4, 4) == ".fyr") {
                        files.push(path.join(p, f));
                    }
                }
                pkg = new Package(true);
                pkg.setSources(files);
            }
        }
    }
    // Compile a list of files?
    if (!pkg) {
        let files: Array<string> = [];
        // Determine all source files to compile
        for(let i = 0; i < config.sourcePath.length; i++) {
            let file = config.sourcePath[i];
            files.push(file as string);
        }
        pkg = new Package(true);
        pkg.setSources(files);
    }
    return pkg;
}

export function compile(pkg: Package, config: FyrConfiguration) {
    try {
        pkg.loadSources();
        Package.checkTypesForPackages();

        // Generate code
        if (!config.disableCodegen) {
            let backend: "C" | "WASM" | null = null;
            if (config.emitWasm) {
                backend = "WASM";
            } else if (config.emitC) {
                backend = "C";
            }
            Package.generateCodeForPackages(backend, config.emitIr, config.emitNative, config.disableNullCheck);
        }
    } catch(e) {
        config.errorHandler.handle(e);
    }
}

// only parse if this file was required by fyrc
let binaryPath = process.argv[1];

if (binaryPath.substring(binaryPath.length - 4, binaryPath.length) === 'fyrc') {
    program
        .version(pkgJson.version, '-v, --version')
        .usage('[options] [command] <module ...>')
        .option('-r, --emit-ir', "Emit IR code")
        .option('-w, --emit-wasm', "Emit WASM code")
        .option('-c, --emit-c', "Emit C code")
        .option('-n, --emit-native', "Emit native executable")
        .option('-N, --disable-null-check', "Do not check for null pointers")
//        .option('-T, --disable-runtime', "Do not include the standard runtime")
        .option('-G, --disable-codegen', "Do not generate any code, just perform syntax and typechecks")

    program
        .command('compile')
        .description('Compile Fyr source code')
        .action( runCompiler );

    program.parse(process.argv);
}