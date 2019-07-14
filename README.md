# Fyr

[![Build Status](https://travis-ci.org/vs-ude/fyr.svg?branch=dev)](https://travis-ci.org/vs-ude/fyr)
[![deb package](https://img.shields.io/badge/deb-packagecloud.io-844fec.svg)](https://packagecloud.io/vs-ude/fyrlang?filter=debs)
[![rpm package](https://img.shields.io/badge/rpm-packagecloud.io-844fec.svg)](https://packagecloud.io/vs-ude/fyrlang?filter=rpms)
[![npm package](https://img.shields.io/npm/v/fyrlang.svg)](https://www.npmjs.com/package/fyrlang)
[![Greenkeeper badge](https://badges.greenkeeper.io/vs-ude/fyr.svg)](https://greenkeeper.io/)

Fyr is a modern systems programming language that combines the versatility of C with the ease and safety of application programming languages like Java, Go or TypeScript. Like C/C++, Fyr can be used for low-level hardware-oriented programming and high-level application programming. In contrast to C, the Fyr compiler guarantees memory safety and thread safety at compilation time.  

Fyr is designed to implement all tiers of distributed IoT applications, i.e. embedded devices, server-side code and the Web UI. Furthermore, it can be combined with existing C and JavaScript code.  

It is currently in early stages of development, so some features are not yet implemented and others could be removed in the future.

## Installation

The compiler currently only supports UNIX-like systems, Windows support is planned for a future release.  
We provide _deb_ and _rpm_ packages hosted on [packagecloud](https://packagecloud.io/vs-ude/fyrlang).
An _npm_ package is available in the standard npm [registry](https://www.npmjs.com/package/fyrlang).
Additionally, we maintain a [Homebrew Tap](https://github.com/vs-ude/homebrew-fyr) containing the _fyrlang_ formula.
See the [home page](http://fyr.vs.uni-due.de) for more information.  

### From Source

Simply clone this repository and run `npm install && npm run build`.
Working _node_, _npm_, and _gcc_ executables are required, everything else will be installed by _npm_.  
The _fyrc_ executable can be found in _bin/_.

The install script also registers a git hook that will automatically rebuild the compiler after git pulls if necessary.

## Usage

The package comes with the _fyrc_ binary, which can be used to compile Fyr code into C or binary executables.  
A simple _hello_world.fyr_ looks like this:

```
export func main() int {
    println("Hello World")
    return 0
}
```

It can be compiled with `fyrc -n hello_world.fyr`.
The generated executable is _hello_world_ and yields `Hello World` when run.

More examples can be found in the _src/_ folder of this repository.


### Tools

We provide a [plugin](https://marketplace.visualstudio.com/items?itemName=vs-ude.fyr) for Visual Studio Code that supports code highlighting.
Integration of a language server is currently in progress but depends on some functionality of the compiler that is not yet fully implemented.
