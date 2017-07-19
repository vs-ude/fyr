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

// Make TSC not throw out the colors lib
colors.red;

var pkgJson = JSON.parse(fs.readFileSync(path.join(path.dirname(module.filename), '../package.json'), 'utf8'));

function compileModules() {
    var args = Array.prototype.slice.call(arguments, 0);
    // Parse all files into a single AST
    let mnode = new ast.Node({loc: null, op: "module", statements: []});
	for(var i = 0; i < args.length - 1; i++) {
        ast.setCurrentFile(args[i]);
		var arg = path.resolve(args[i]);
        let code = fs.readFileSync(arg, 'utf8') + "\n";
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
        // Generate IR and WASM code
        let cg = new codegen.CodeGenerator(tc, program.emitIr, program.disableWasm, program.emitIrFunction, program.disableNullCheck);
        cg.processModule(mnode);
    } catch(ex) {
        if (ex instanceof typecheck.TypeError) {
            console.log((ex.location.file + " (" + ex.location.start.line + "," + ex.location.start.column + "): ").yellow + ex.message.red);
            return;                
        } else if (ex instanceof codegen.LinkError) {
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
}

program
	.version(pkgJson.version)
	.usage('[options] [command] <module ...>')
    .option('-r, --emit-ir', "Emit IR code")
    .option('-f, --emit-ir-function <name>', "Emit IR code only for one function", null)
    .option('-W, --disable-wasm', "Do not emit WASM code")
    .option('-N, --disable-null-check', "Do not check for null pointers")

program
	.command('compile')
	.description('compiles weblang modules')
	.action( compileModules );

program.parse(process.argv);