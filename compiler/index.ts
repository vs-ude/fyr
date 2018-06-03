"use strict";

import fs = require('fs');
import path = require('path');
import program = require('commander');
import colors = require('colors');
import parser = require("./parser");
import typecheck = require("./typecheck");
import codegen = require("./codegen");
import ast = require("./ast");
import pkg = require("./pkg");
import child_process = require("child_process");
import process = require("process");
import os = require("os");

// Make TSC not throw out the colors lib
colors.red;

var pkgJson = JSON.parse(fs.readFileSync(path.join(path.dirname(module.filename), '../package.json'), 'utf8'));

function createPath(basePath: string, subs: Array<string>): string {
    let p = basePath;
    for(let sub of subs) {
        try {
            p = path.join(p, sub);
            fs.mkdirSync(p);
        } catch(e) {
            if (e.code !== "EEXIST") {
                console.log(("Cannot create directory " + p).red);
                return null;
            }
        }
    }
    return p;
}

function compileModules() {
    if (program.emitC && program.emitWasm) {
        console.log(("Only one code emit path can be selected".red));
        return;
    }

    var args: Array<object | string> = Array.prototype.slice.call(arguments, 0);
    if (args.length <= 1) {
        console.log(("Missing package or file information").red);
        return;
    }
    args = args.splice(args.length -2, 1);
    
    let fyrPaths = pkg.getFyrPaths();
    if (!fyrPaths) {
        return;
    }

    let architecture = os.platform() + "-" + os.arch();
    let packageFullName: string;
    let packageShortName: string;

    // Determine which files to compile and where to write the output
    let objFilesDir: string;
    let files: Array<string> = [];
    let filesDone = false;
    // Compile a package?
    if (args.length == 1) {
        let p = path.resolve(args[0] as string);
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
            let allFiles = fs.readdirSync(p);
            for(let f of allFiles) {
                if (f.length > 4 && f.substr(f.length - 4, 4) == ".fyr") {
                    files.push(path.join(p, f));
                }
            }
            // Is this package located in one of the known pathes. If yes -> put the output in the right location
            for(let fyrPath of fyrPaths) {
                let test = path.join(path.normalize(fyrPath), "src");
                if (test[test.length - 1] != path.sep) {
                    test += path.sep;
                }
                if (p.length > test.length && p.substr(0, test.length) == test) {
                    packageFullName = p.substring(test.length, p.length - 1);
                    let packagePaths: Array<string> = packageFullName.split(path.sep);
                    packageShortName = packagePaths[packagePaths.length - 1];
                    packagePaths.splice(packagePaths.length - 1, 1);
                    objFilesDir = createPath(fyrPath, ["pkg", architecture].concat(packagePaths));
                    if (!objFilesDir) {
                        return;
                    }
                    if (objFilesDir[objFilesDir.length - 1] != path.sep) {
                        objFilesDir += path.sep;
                    }
                    break;
                }
            }
            if (!objFilesDir) {
                objFilesDir = p;
            }
            filesDone = true;
        }
    }
    // Compile a list of files?
    if (!filesDone) {
        // Determine all source files to compile
        for(let i = 0; i < args.length; i++) {
            let file = args[i];
            files.push(file as string);
            if (!objFilesDir) {            
                let input = path.resolve(file);
                let f = path.parse(input);
                packageShortName = f.name;
                packageFullName = path.join(f.dir, packageShortName);
                objFilesDir = f.dir + path.sep;
            }
        }
    }

//    if (!program.disableRuntime) {
//        files.push(path.join(fyrBase, "runtime/mem.fyr"));
//        files.push(path.join(fyrBase, "runtime/map.fyr"));
//    }

    // Parse all files into a single AST
    let mnode = new ast.Node({loc: null, op: "module", statements: []});
	for(let file of files) {
        ast.setCurrentFile(file);
        let fileResolved = path.resolve(file);
        console.log("Compiling " + fileResolved + " ...");
        let code: string;
        try {
            code = fs.readFileSync(fileResolved, 'utf8') + "\n";
        } catch(e) {
            console.log(("Cannot read file " + file).red);
            return;
        }
        try {
            let f = parser.parse(code);
            mnode.statements.push(f);
        } catch(ex) {
            if (ex instanceof parser.SyntaxError) {
                console.log((ast.currentFile() + " (" + ex.location.start.line + "," + ex.location.start.column + "): ").yellow + ex.message.red);
                return;
            } else {
                console.log(ex);
                throw ex;
            }
        }
    }

    try {
        // Run the type checker
        let tc = new typecheck.TypeChecker();
        pkg.initPackages(tc);
        let scope = tc.checkModule(mnode);
        if (!program.disableCodegen) {
            // Generate IR and WASM code
            let cg = new codegen.CodeGenerator(tc, program.emitIr, program.disableWasm, program.emitIrFunction, program.disableNullCheck, program.emitC);
            cg.processModule(mnode);
            if (program.emitWasm) {
                let wastcode = cg.getCode();
                let wastfile = objFilesDir + packageShortName + ".wat";
                fs.writeFileSync(wastfile, wastcode, 'utf8');
            }
            if (program.emitC) {
                let code = cg.getCode();
                let cfile = objFilesDir + packageShortName + ".c";
                fs.writeFileSync(cfile, code, 'utf8');
            }
        }
    } catch(ex) {
        if (ex instanceof typecheck.TypeError) {
            console.log((ex.location.file + " (" + ex.location.start.line + "," + ex.location.start.column + "): ").yellow + ex.message.red);
            return;
        } else if (ex instanceof pkg.ImportError) {
            console.log((ex.location.file + " (" + ex.location.start.line + "," + ex.location.start.column + "): ").yellow + ex.message.red);
            return
        } else {
            console.log(ex);
            throw ex;
        }
    }

    // Compile Wast to Wasm
    if (program.emitWasm && !program.disableCodegen) {
        var input = path.resolve(args[args.length - 2]);
        let f = path.parse(input);
        let wastfile = objFilesDir + packageShortName + ".wat";
        let wasmfile = objFilesDir + packageShortName + ".wasm";
        child_process.execFileSync("wat2wasm", [wastfile, "-r", "-o", wasmfile]);
    }
}

program
	.version(pkgJson.version, '-v, --version', "Output version")
	.usage('[options] [command] <module ...>')
    .option('-r, --emit-ir', "Emit IR code on stdout")
    .option('-f, --emit-ir-function <name>', "Emit IR code on stdout for one function only", null)
    .option('-w, --emit-wasm', "Emit WASM code")
    .option('-N, --disable-null-check', "Do not check for null pointers")
    .option('-c, --emit-c', "Emit C code")
    .option('-T, --disable-runtime', "Do not include the standard runtime")
    .option('-G, --disable-codegen', "Do not generate IR code, just perform syntax and typechecks")

program
    .command('compile')
    .description('Compile Fyr source code')
	.action( compileModules );

program.parse(process.argv);