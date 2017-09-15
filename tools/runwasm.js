#!/usr/bin/env node

// Copyright Joel Martin
// License MIT

const fs = require('fs'),
assert = require('assert')

assert('WebAssembly' in global,
  'WebAssembly global object not detected')

// Convert node Buffer to Uint8Array
function toUint8Array(buf) {
    var u = new Uint8Array(buf.length)
    for (var i = 0; i < buf.length; ++i) {
        u[i] = buf[i]
    }
    return u
}

// Based on:
// https://gist.github.com/kripken/59c67556dc03bb6d57052fedef1e61ab
//   and
// http://thecodebarbarian.com/getting-started-with-webassembly-in-node.js.html

// Loads a WebAssembly dynamic library, returns a promise.
// imports is an optional imports object
function loadWebAssembly(filename, imports) {
    // Fetch the file and compile it
    const buffer = toUint8Array(fs.readFileSync(filename))
    return WebAssembly.compile(buffer)
    .then(module => {
        let memory = new WebAssembly.Memory({initial: 600});
        let importObject = {
            imports: {
                logString: function(sp) {
                    var offset = memory_u32[sp >> 2];
                    var bytes = new Uint8Array(memory.buffer, offset + 4, memory_u32[offset >> 2]);
                    var string = new TextDecoder('utf8').decode(bytes);
                    console.log(string);
                },
                logNumber: function(n) {
                    console.log(n);
                },
                logFloat: function(n) {
                    console.log(n);
                },
                mem: memory
            }
        };
        
        // Create the instance.
        return new WebAssembly.Instance(module, importObject)
    })
}

if (module.parent) {
    module.exports.loadWebAssembly = loadWebAssembly
} else {
    assert(process.argv.length >= 4, 'Usage: ./runwasm.js prog.wasm func INT_ARG...')

    const wasm = process.argv[2],
    func = process.argv[3],
    // Convert args to either floats or ints
    args = process.argv.slice(4).map(
            x => x.match(/[.]/) ? parseFloat(x) : parseInt(x))

    loadWebAssembly(wasm)
    .then(instance => {
        var exports = instance.exports
        assert(exports, 'no exports found')
        assert(func in exports, func + ' not found in wasm module exports')
        //console.log('calling exports.'+func+'('+args+')')
        console.log(exports[func](...args))
    })
    .catch(res => {
        console.log(res)
    })
}
