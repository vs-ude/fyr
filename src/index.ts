"use strict";

import fs = require('fs');
import path = require('path');
import program = require('commander');
import colors = require('colors');
import parser = require("./parser");
import typecheck = require("./typecheck");
import codegen = require("./codegen");

// Make TSC not throw out the colors lib
colors.red;

var pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(module.filename), '../package.json'), 'utf8'));

function compileModules() {
	var args = Array.prototype.slice.call(arguments, 0);
	for(var i = 0; i < args.length - 1; i++) {
		var arg = path.resolve(args[i]);
//        console.log("Compiling " + arg + "...");
        let code = fs.readFileSync(arg, 'utf8') + "\n";
//        try {
            let mnode = parser.parse(code);
//            console.log(fnode.stringify(""));
            let tc = new typecheck.TypeChecker();
            let scope = tc.checkModule(mnode);
            let cg = new codegen.CodeGenerator(tc);
            cg.processModule(scope);
//            console.log(cg.module.toWast(""));
/*        } catch(ex) {
            if (ex instanceof parser.SyntaxError) {
                console.log((args[i] + " (" + ex.location.start.line + "," + ex.location.start.column + "): ").yellow + ex.message.red);
                continue;
            } else if (ex instanceof typecheck.TypeError) {
                console.log((args[i] + " (" + ex.location.start.line + "," + ex.location.start.column + "): ").yellow + ex.message.red);
                continue;                
            } else {
                console.log(ex);
                throw ex;
            }
        }*/
    }
}

program
	.version(pkg.version)
	.usage('[options] [command] <module ...>')

program
	.command('compile')
	.description('compiles weblang modules')
	.action( compileModules );

program.parse(process.argv);