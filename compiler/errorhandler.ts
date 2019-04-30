"use strict"

import ast = require("./parser/ast");

import { SyntaxError, TypeError, ImportError } from './errors'

import { readFileSync } from 'fs'

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
            if (e.stack) {
                console.error(this.buildOffendingLineString(e.stack))
                console.error(e.stack)
            } else {
                console.error(e)
            }
            process.exit(1)
        }
    }

    /**
     * This generates a string of the offending line in the file in the style of NodeJS.
     * The offending file and line are extracted from the given stack trace.
     * There is definitely room for optimization as it currently only loops through all lines in the file.
     *
     * @param stack The stack trace string.
     */
    private buildOffendingLineString(stack: string) {
        let fileAndLocation: Array<string> = stack
            .split('\n')[1]
            .replace(/\s*at\s*[\w\.]*\s*\(/i, '') // remove the cruft before the path
            .replace(')', '')
            .split(':')

        let file: string = fileAndLocation[0]
        let lineNumber: number = Number(fileAndLocation[1])
        let column: number = Number(fileAndLocation[2])

        let outputLine: string = file + ':' + lineNumber + '\n'
        let currentLineNumber: number = 1
        readFileSync(file).toString().split('\n').forEach((line) => {
            if (currentLineNumber == lineNumber) {
                outputLine = outputLine + line + '\n'
            }
            currentLineNumber++
        })

        for (let i: number = 1; i < column; i++) {
            outputLine = outputLine + ' '
        }
        return outputLine + '^\n'
    }
}
