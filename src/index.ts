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
import child_process = require("child_process")
import process = require("process")

// Make TSC not throw out the colors lib
colors.red;

var pkgJson = JSON.parse(fs.readFileSync(path.join(path.dirname(module.filename), '../package.json'), 'utf8'));

function compileModules() {
    if (program.emitC) {
        program.disableWasm = true;
    }

    var args = Array.prototype.slice.call(arguments, 0);
    var files = [];
    let fyrPath = process.env["FYRPATH"];
    if (!fyrPath) {
        console.log(("No FYRPATH environment variable has been set").red);
        return;
    }
    if (!program.disableRuntime) {
        files.push(path.join(fyrPath, "runtime/mem.fyr"));
        files.push(path.join(fyrPath, "runtime/map.fyr"));
    }
    // Determine all source files to compile
    for(var i = 0; i < args.length - 1; i++) {
        let file = args[i];
        files.push(file);
    }

    // Parse all files into a single AST
    let mnode = new ast.Node({loc: null, op: "module", statements: []});
	for(var file of files) {
        ast.setCurrentFile(file);
        var fileResolved = path.resolve(file);
        console.log("Compiling " + fileResolved + " ...");
        let code = fs.readFileSync(fileResolved, 'utf8') + "\n";
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

//    try {
        // Run the type checker
        let tc = new typecheck.TypeChecker();
        pkg.initPackages(tc);
        let scope = tc.checkModule(mnode);
        if (!program.disableCodegen) {
            // Generate IR and WASM code
            let cg = new codegen.CodeGenerator(tc, program.emitIr, program.disableWasm, program.emitIrFunction, program.disableNullCheck, program.emitC);
            cg.processModule(mnode);
            if (!program.disableWasm) {
                let wastcode = cg.getCode();
                var input = path.resolve(args[args.length - 2]);
                let f = path.parse(input);
                let wastfile = f.dir + path.sep + f.name + ".wat";
                fs.writeFileSync(wastfile, wastcode, 'utf8');
            }
            if (program.emitC) {
                let code = cg.getCode();
                var input = path.resolve(args[args.length - 2]);
                let f = path.parse(input);
                let cfile = f.dir + path.sep + f.name + ".c";
                fs.writeFileSync(cfile, code, 'utf8');
            }
        }
/*    } catch(ex) {
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
    } */

    // Compile Wast to Wasm
    if (!program.disableWasm && !program.disableCodegen) {
        var input = path.resolve(args[args.length - 2]);
        let f = path.parse(input);
        let wastfile = f.dir + path.sep + f.name + ".wat";
        let wasmfile = f.dir + path.sep + f.name + ".wasm";
        child_process.execFileSync("wat2wasm", [wastfile, "-r", "-o", wasmfile]);
    }
}

program
	.version(pkgJson.version, '-v, --version', "Output version")
	.usage('[options] [command] <module ...>')
    .option('-r, --emit-ir', "Emit IR code")
    .option('-f, --emit-ir-function <name>', "Emit IR code only for one function", null)
    .option('-W, --disable-wasm', "Do not emit WASM code")
    .option('-N, --disable-null-check', "Do not check for null pointers")
    .option('-c, --emit-c', "Emit C code")
    .option('-T, --disable-runtime', "Do not include the standard runtime")
    .option('-G, --disable-codegen', "Do not generate IR code")

program
    .command('compile')
    .description('Compile Fyr source code')
	.action( compileModules );

program.parse(process.argv);