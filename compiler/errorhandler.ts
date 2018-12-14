"use strict"

import ast = require("./ast");
import {SyntaxError} from "./parser";
import {TypeError} from "./typecheck";
import {ImportError} from "./pkg";

export interface ErrorHandler {
    handle(e: Error)
}

export class StdErrorOutput implements ErrorHandler {
    handle(e: Error) {
        if (e instanceof TypeError) {
            console.log((e.location.file + " (" + e.location.start.line + "," + e.location.start.column + "): ").yellow + e.message.red);
            return;
        } else if (e instanceof SyntaxError) {
            console.log((ast.currentFile() + " (" + e.location.start.line + "," + e.location.start.column + "): ").yellow + e.message.red);
            return;
        } else if (e instanceof ImportError) {
            if (e.location) {
                console.log((e.location.file + " (" + e.location.start.line + "," + e.location.start.column + "): ").yellow + e.message.red);
            } else {
                console.log((e.path + ": ".yellow) + e.message.red);
            }
            return
        } else {
            console.log(e);
            throw e;
        }
    }
}
