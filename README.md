# Fyr

[![npm Version](https://img.shields.io/npm/v/fyrlang.svg)](https://www.npmjs.com/package/fyrlang)
[![Build Status](https://travis-ci.org/vs-ude/fyr.svg?branch=dev)](https://travis-ci.org/vs-ude/fyr)

Fyr is a modern systems programming language that combines the versatility of C with the ease and safety of application programming languages like Java, Go or TypeScript. Like C/C++, Fyr can be used for low-level hardware-oriented programming and high-level application programming. In contrast to C, the Fyr compiler guarantees memory safety and thread safety at compilation time.  

Fyr is designed to implement all tiers of distributed IoT applications, i.e. embedded devices, server-side code and the Web UI. Furthermore, it can be combined with existing C and JavaScript code.  

It is currently in early stages of development, so some features are not yet implemented and others could be removed in the future.

## Installation

The compiler currently only supports UNIX-like systems, Windows support is planned for a future release.  
A package will be provided in _npm_, _deb_, and _rpm_ formats.
See the [home page](http://fyr.vs.uni-due.de) for more information.  
_Note:_ Installation of the _npm_ package requires _gcc_ to be present and working.

### Usage

The package comes with the _fyrc_ binary, which can be used to compile Fyr code into C or binary executables.
We provide a [plugin](https://marketplace.visualstudio.com/items?itemName=vs-ude.fyr) for Visual Studio Code that currently supports code highlighting.
Integration of a language server is currently in progress but depends on some functionality of the compiler that is not yet fully implemented.


## Contributing

Contributions by anyone are welcome.
You can help by expanding the code, implementing more test cases, or just using the compiler and reporting bugs.

### editorconfig

To ensure consistent indentation and encoding, we use the editorconfig framework. It's settings are stored in the `.editorconfig` file.
Many applications support it natively. Please refer to the [documentation](https://editorconfig.org/#download) on how to enable or install it.

### API Documentation

The internal compiler API documentation is built using [TypeDoc](https://typedoc.org/).
To build it, run `npm run build:doc` in a terminal.  
It will be hosted on the official documentation page.


### Testing

#### High-level

To test the whole compiler, we have a simple script that tries to compile some test files and run the resulting binaries.
It only depends on `/bin/bash` and `date` so it should run on most systems.
It naively checks the exit codes of the compiler and the binaries and outputs files for which it was not `0`.  
To check for possible memory leaks we use [valgrind](http://valgrind.org/).
The script works without it but will complain about the missing dependency.  
You can invoke it with `run_tests.sh`.

#### Unit tests

We are currently in the process of integrating unit tests into the compiler.
For this, [chai](https://www.chaijs.com/) and [mocha](https://mochajs.org/) (+ [mocha-typescript](https://github.com/pana-cc/mocha-typescript)) are used.
The tests can be run with `npm run test` or `npm run test:watch`.

Additionally, [istanbul](https://istanbul.js.org/) is used to provide test coverage reports.
It can be invoked with `npm run test:coverage`.

To use the unit tests in editors like VS Code, the easiest way is to just run the `npm: test:watch` task and leave the corresponding terminal open.
It will refresh on every file save and output the tests that failed.

Please not that all imports in tests have to be done through the _index.ts_ files (only specify the folder) wherever they are present.
Failure to do so will result in errors at runtime.
