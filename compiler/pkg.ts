import path = require('path');
import process = require("process");
import fs = require("fs");
import child_process = require("child_process");
import os = require("os");
import tc = require("./typecheck");
import parser = require("./parser/parser");
import ast = require("./parser/ast");
import colors = require('colors');
import {Function, FunctionParameter, Scope} from "./scope"
import { TypeChecker, Static } from './typecheck'
import {FunctionType, UnsafePointerType} from "./types/";
import {CodeGenerator} from "./codegen";
import * as backend from "./backend/backend";
import {Wasm32Backend} from "./backend/backend_wasm";
import {CBackend} from "./backend/backend_c";
import {DummyBackend} from "./backend/backend_dummy";
import { ImplementationError, ImportError, SyntaxError } from './errors'


// Make TSC not throw out the colors lib
colors.red;

export enum SystemCalls {
    heap = -1,
    currentMemory = -2,
    growMemory = -3,
    heapTypemap = -4,
    pageSize = -5,
    // Returns the default size for a stack
    defaultStackSize = -6,
    // The current SP
    stackPointer = -8,
    createMap = -15,
    setMap = -16,
    hashString = -17,
    lookupMap = -18,
    removeMapKey = -19,
    setNumericMap = -20,
    lookupNumericMap = -21,
    removeNumericMapKey = -22,
    abs32 = -23,
    abs64 = -24,
    sqrt32 = -25,
    sqrt64 = -26,
    trunc32 = -27,
    trunc64 = -28,
    nearest32 = -29,
    nearest64 = -30,
    ceil32 = -31,
    ceil64 = -32,
    floor32 = -33,
    floor64 = -34,
    max32 = -35,
    max64 = -36,
    min32 = -37,
    min64 = -38,
    copysign32 = -39,
    copysign64 = -49,
    continueCoroutine = -52,
    scheduleCoroutine = -53,
    coroutine = -54,
}

let architecture = os.platform() + "-" + os.arch();

export class Package {
    constructor(mainPackage: boolean = false) {
        this.tc = new tc.TypeChecker(this);
        if (mainPackage) {
            Package.mainPackage = this;
        }
        Package.packages.push(this);
    }

    public sourcePath(): string {
        return path.join(path.join(this.fyrPath, "src"), this.pkgPath);
    }

    /**
     * Might throw ImportError
     */
    public findSources(fyrPath: string, pkgPath: string) {
        this.pkgPath = pkgPath;
        this.fyrPath = fyrPath;

        if (this.pkgPath[0] == '/' || this.pkgPath[0] == '\\') {
            throw new ImportError("Import path '" + this.pkgPath + "' must not start with " + path.sep, null, this.pkgPath);
        }

        if (this.fyrPath[this.fyrPath.length - 1] == path.sep) {
            this.fyrPath = this.fyrPath.substr(0, this.fyrPath.length - 1);
        }

        let packagePaths: Array<string> = this.pkgPath.split('/');
        this.objFileName = packagePaths[packagePaths.length - 1];
        packagePaths.splice(packagePaths.length - 1, 1);
        this.objFilePath = path.join(fyrPath, "pkg", architecture, packagePaths.join(path.sep));
        this.binFilePath = path.join(fyrPath, "bin", architecture);
        this.binFileName = this.objFileName;
        Package.packagesByPath.set(pkgPath, this);

        // Determine all filenames
        let p = this.sourcePath();
        let allFiles = fs.readdirSync(p);
        for(let f of allFiles) {
            if (f.length > 4 && f.substr(f.length - 4, 4) == ".fyr") {
                this.files.push(path.join(p, f));
            } else if (f.length > 2 && f.substr(f.length - 2, 2) == ".c") {
                this.nativeFiles.push(path.join(p, f));
            }
        }
    }

    public setSources(files: Array<string>, nativeFiles: Array<string>) {
        this.files = files;
        this.nativeFiles = nativeFiles;
        if (this.files.length == 0) {
            return;
        }
        let paths: Array<string> = this.files[0].split(path.sep);
        let name = paths.splice(paths.length -1, 1)[0];
        let parsedName = path.parse(name);
        this.objFileName = parsedName.name;
        this.objFilePath = paths.join(path.sep);
        this.binFileName = parsedName.name;
        this.binFilePath = paths.join(path.sep);
    }

    /**
     * Might throw SyntaxError or ImportError or TypeError.
     * The function loads the sources, parses them and applies the first phase of type checking.
     */
    public loadSources() {
        if (this.isInternal) {
            return;
        }
        // Parse all files into a single AST
        this.pkgNode = new ast.Node({loc: null, op: "module", statements: []});
        for(let file of this.files) {
            ast.setCurrentFile(file);
            let fileResolved = path.resolve(file);
            console.log("Parsing " + fileResolved + " ...");
            let code: string;
            try {
                code = fs.readFileSync(fileResolved, 'utf8') + "\n";
            } catch(e) {
                throw new ImportError(("Cannot read file " + file).red, null, this.pkgPath);
            }
            // Remove windows line ending
            code = code.replace(/\r/g, "");
            try {
                let f = parser.parse(code);
                this.pkgNode.statements.push(f);
            } catch (e) {
                throw new SyntaxError(e.message, {start: e.location.start, end: e.location.end, file: ""})
            }
        }

        // This might load more packages
        this.scope = this.tc.checkModule(this);
        this.typeCheckPass = 1;
    }

    /**
     * Might throw TypeError
     */
    public checkTypesPassTwo() {
        if (this.isInternal) {
            return;
        }
        this.tc.checkModulePassTwo();
    }

    /**
     * Might throw TypeError
     */
    public checkTypesPassThree() {
        if (this.isInternal) {
            return;
        }
        this.tc.checkModulePassThree();
    }

    /**
     * Might throw TypeError
     */
    public checkTypesPassFour() {
        if (this.isInternal) {
            return;
        }
        this.tc.checkModulePassFour();
    }

    public generateCode(backend: "C" | "WASM" | null, emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package>,  disableNullCheck: boolean) {
        if (this.isInternal) {
            return;
        }

        console.log("Compiling " + (this.pkgPath ? this.pkgPath : path.join(this.objFilePath, this.objFileName)) + " ...");

        let cBackend: CBackend;
        let wasmBackend: Wasm32Backend;
        let b: backend.Backend;
        if (backend == "C") {
            cBackend = new CBackend(this);
            b = cBackend;
        } else if (backend == "WASM") {
            wasmBackend = new Wasm32Backend();
            b = wasmBackend;
        } else {
            b = new DummyBackend();
        }

        this.codegen = new CodeGenerator(this.tc, b, disableNullCheck);
        let ircode = this.codegen.processModule(this.pkgNode, emitIR, initPackages, duplicateCodePackages);

        this.createObjFilePath();

        if (emitIR) {
            let irfile = path.join(this.objFilePath, this.objFileName + ".ir");
            fs.writeFileSync(irfile, ircode, 'utf8');
        }

        if (backend == "WASM") {
            // Generate WAST
            let wastcode = wasmBackend.getCode();
            let wastfile = path.join(this.objFilePath, this.objFileName + ".wat");
            fs.writeFileSync(wastfile, wastcode, 'utf8');
            // Generate WASM
            let wasmfile = path.join(this.objFilePath, this.objFileName + ".wasm");
            child_process.execFileSync("wat2wasm", [wastfile, "-r", "-o", wasmfile]);
        } else if (backend == "C") {
            // Generate C code
            let code = cBackend.getImplementationCode();
            let cfile = path.join(this.objFilePath, this.objFileName + ".c");
            fs.writeFileSync(cfile, code, 'utf8');
            let hcode = cBackend.getHeaderCode();
            let hfile = path.join(this.objFilePath, this.objFileName + ".h");
            fs.writeFileSync(hfile, hcode, 'utf8');

            this.hasMain = cBackend.hasMainFunction();

            if (this.isImported && this.hasMain) {
                throw new ImportError("Package " + this.pkgPath + " has been imported as a library, but contains a main function", null, this.pkgPath);
            }
        }

        this.hasInitFunction = (b.getInitFunction() != null);
    }

    public generateObjectFiles(backend: "C" | "WASM" | null, nativePackages: Array<Package>) {
        // Compile the *.c and *.h files to *.o files
        if (backend == "C") {
            let cfile = path.join(this.objFilePath, this.objFileName + ".c");
            let ofile = path.join(this.objFilePath, this.objFileName + ".o");
            let includes: Array<string> = [];
            // Make fyr.h discoverable
            includes.push("-I" + path.join(Package.fyrBase, "src", "runtime"));
            for (let p of Package.fyrPaths) {
                includes.push("-I" + path.join(p, "pkg", architecture));
            }
            for(let p of nativePackages) {
                includes.push("-I" + p.sourcePath());
            }
            let args = includes.concat(["-g3", "-O3", "-Wno-parentheses", "-o", ofile, "-c", cfile]);
            if (this.compileCmdLineArgs) {
                args = args.concat(this.compileCmdLineArgs);
            }
            console.log("gcc", args.join(" "));
            child_process.execFileSync("gcc", args);

            if (this.nativeFiles) {
                for(let cfile of this.nativeFiles) {
                    let filename = path.basename(cfile, ".c");
                    let ofile = path.join(this.objFilePath, filename + ".o");
                    let includes: Array<string> = [];
                    for(let p of nativePackages) {
                        includes.push("-I" + p.sourcePath());
                    }
                    let args = includes.concat(["-g3", "-O3", "-Wno-parentheses", "-o", ofile, "-c", cfile]);
                    if (this.compileCmdLineArgs) {
                        args = args.concat(this.compileCmdLineArgs);
                    }
                    console.log("gcc", args.join(" "));
                    child_process.execFileSync("gcc", args);
                }
            }
        }
    }

    /**
     * Might throw ImportError
     */
    private createObjFilePath() {
        if (this.fyrPath == "" || this.fyrPath == null) {
            return;
        }

        let p = this.fyrPath;
        let packagePaths: Array<string> = this.pkgPath.split('/');
        packagePaths.splice(packagePaths.length - 1, 1);
        let subs = ["pkg", architecture].concat(packagePaths);

        for(let sub of subs) {
            try {
                p = path.join(p, sub);
                fs.mkdirSync(p);
            } catch(e) {
                if (e.code !== "EEXIST") {
                    throw new ImportError(("Cannot create directory " + p).red, null, this.pkgPath);
                }
            }
        }

        // Generate the bin directory
        p = this.fyrPath;
        subs = ["bin", architecture];
        for(let sub of subs) {
            try {
                p = path.join(p, sub);
                fs.mkdirSync(p);
            } catch(e) {
                if (e.code !== "EEXIST") {
                    throw new ImportError(("Cannot create directory " + p).red, null, this.pkgPath);
                }
            }
        }
    }

    public hasTemplateInstantiations(): boolean {
        return this.tc.hasTemplateInstantiations();
    }

    /*
    public globalVariables(): Array<tc.Variable> {
        return this.tc.globalVariables;
        let arr: Array<tc.Variable> = [];
        for(let e of this.scope.elements) {
            if (e instanceof tc.Variable) {
                arr.push(e);
            }
        }
        return arr;
    }
*/

    /**
     * Checks the types of all packages imported so far.
     * Calling this function multiple times is ok, as it will not check the same package twice,
     * but it will check new imported packages.
     */
    public static checkTypesForPackages() {
        for(let p of Package.packages) {
            if (p.typeCheckPass >= 2) {
                continue;
            }
            p.typeCheckPass = 2;
            p.checkTypesPassTwo();
        }

        for(let p of Package.packages) {
            if (p.typeCheckPass >= 3) {
                continue;
            }
            p.typeCheckPass = 3;
            p.checkTypesPassThree();
        }

        for(let p of Package.packages) {
            if (p.typeCheckPass >= 4) {
                continue;
            }
            p.typeCheckPass = 4;
            p.checkTypesPassFour();
        }
    }

    /**
     * Generates C or WASM files and optionally compiles and links these files to create a native executable.
     */
    public static generateCodeForPackages(backend: "C" | "WASM" | null, emitIR: boolean, emitNative: boolean, disableNullCheck: boolean) {
        // Generate code (in the case of "C" this is source code)
        let initPackages: Array<Package> = [];
        // Packages that contain native files, e.g. *.c
        let nativePackages: Array<Package> = [];
        // Packages that contain (possibly duplicate) code in their header file
        let duplicateCodePackages: Array<Package> = [];
        for(let p of Package.packages) {
            // Does the package have native files, e.g. *.c?
            if (p.nativeFiles.length != 0) {
                nativePackages.push(p);
            }
            if (p == Package.mainPackage || p.isInternal) {
                continue;
            }
            p.generateCode(backend, emitIR, null, null, disableNullCheck);
            if (p.hasInitFunction) {
                initPackages.push(p);
            }
            if (p.tc.hasTemplateInstantiations() || p.codegen.hasDestructors() || p.codegen.hasSymbols()) {
                duplicateCodePackages.push(p);
            }
        }
        if (Package.mainPackage) {
            Package.mainPackage.generateCode(backend, emitIR, initPackages, duplicateCodePackages, disableNullCheck);
        }

        // Create native executable?
        if (emitNative) {
            if (backend !== "C") {
                throw new ImplementationError()
            }

            // Generate object files
            for(let p of Package.packages) {
                if (p.isInternal) {
                    continue;
                }
                p.generateObjectFiles(backend, nativePackages);
            }

            // Run the linker on the package that contains a main function and is not itself imported
            for(let p of Package.packages) {
                if (!p.isImported && p.hasMain) {
                    if (backend == "C") {
                        // List of all object files
                        let oFiles: Array<string> = [];
                        // Always include fyr.o and fyr_spawn.o
                        oFiles.push(path.join(Package.fyrBase, "pkg", architecture, "fyr.o"));
                        oFiles.push(path.join(Package.fyrBase, "pkg", architecture, "fyr_spawn.o"));
                        let extraArgs: Array<string> = [];
                        for(let importPkg of Package.packages) {
                            if (importPkg.isInternal) {
                                continue;
                            }
                            oFiles.push(path.join(importPkg.objFilePath, importPkg.objFileName + ".o"));
                            if (importPkg.linkCmdLineArgs) {
                                extraArgs = extraArgs.concat(importPkg.linkCmdLineArgs);
                            }
                            // Link in all native files
                            for (let cfile of importPkg.nativeFiles) {
                                let filename = path.basename(cfile, ".c");
                                let ofile = path.join(importPkg.objFilePath, filename + ".o");
                                oFiles.push(ofile);
                            }
                        }
                        let bFile = path.join(p.binFilePath, p.binFileName);
                        let args = ["-o", bFile, "-g3"].concat(oFiles);
                        args = args.concat(extraArgs);
                        console.log("gcc", args.join(" "));
                        child_process.execFileSync("gcc", args);
                    }
                }
            }
        }
    }

    public static getFyrPaths(): Array<string> {
        if (Package.fyrPaths) {
            return Package.fyrPaths;
        }

        // Environment variables
        Package.fyrBase = process.env["FYRBASE"];
        if (!Package.fyrBase) {
            console.log(("No FYRBASE environment variable has been set").red);
            return null;
        }
        let fyrPaths_str = process.env["FYRPATH"];
        if (!fyrPaths_str) {
            let home = process.env["HOME"];
            if (!home) {
                fyrPaths_str = "";
            } else {
                fyrPaths_str = home + path.sep + "fyr";
            }
        }
        Package.fyrPaths = [Package.fyrBase].concat(fyrPaths_str.split(":"));
        return Package.fyrPaths;
    }

    /**
     * @param pkgPath is of the form "/some/fyr/package".
     * @param loc is the location that is used for reporting an import error.
     *
     * Throws ImportError of the package could not be resolved.
     * Can throw TypeError or SyntaxError if loading of the sources detecs a syntax error.
     */
    public static resolve(pkgPath: string, loc: ast.Location): Package {
        // Initialize system defined packages
        initPackages();

        if (Package.packagesByPath.has(pkgPath)) {
            let p = Package.packagesByPath.get(pkgPath);
            if (p.typeCheckPass == 0) {
                throw new ImportError("Cyclic import", loc, pkgPath);
            }
            return p;
        }

        for(let p of Package.fyrPaths) {
            let test = path.join(path.join(p, "src"), pkgPath);
            let isdir: boolean;
            try {
                isdir = fs.lstatSync(test).isDirectory();
            } catch(e) {
                isdir = false;
            }
            if (!isdir) {
                continue;
            }
            let pkg = new Package();
            pkg.isImported = true;
            pkg.findSources(p, pkgPath);
            pkg.loadSources();
            return pkg;
        }

        throw new ImportError("Unknown package \"" + pkgPath + "\"", loc, pkgPath);
    }

    // Used for system defined packages
    public static registerPackage(p: Package) {
        Package.packagesByPath.set(p.pkgPath, p);
    }

    public static clearPackages() {
        Package.packages = []
    }

    public pkgNode: ast.Node;
    // The path name of the package, e.g. "network/http".
    public pkgPath: string;
    // The Fyr directory where to which the package belongs or null for an anonymous package;
    public fyrPath: string = null;
    public scope: Scope;
    public tc: TypeChecker;
    // All Fyr source files of the package.
    public files: Array<string> = [];
    // All native files of the package, i.e. *.c files.
    public nativeFiles: Array<string> = [];
    public codegen: CodeGenerator;
    public objFilePath: string;
    public objFileName: string;
    public binFilePath: string;
    public binFileName: string;
    // A compiler-builtin package
    public isInternal: boolean;
    public isImported: boolean;
    public hasMain: boolean;
    public hasInitFunction: boolean;

    public compileCmdLineArgs: Array<string>;
    public linkCmdLineArgs: Array<string>;

    private typeCheckPass: number = 0;

    /**
     * The package we are generating an executable or library for or null if
     * no such target is being built;
     */
    public static mainPackage: Package | null;
    private static packagesByPath: Map<string, Package> = new Map<string, Package>();
    private static packages: Array<Package> = [];
    private static fyrPaths: Array<string>;
    public static fyrBase: string;
}


function makeMathFunction64(name: string, paramCount: number, call: SystemCalls, tc: TypeChecker): Function {
    var f: Function = new Function();
    f.name = name;
    let t = new FunctionType();
    t.callingConvention = "system";
    t.name = name;
    t.returnType = Static.t_double;
    t.systemCallType = call;
    for(let i = 0; i < paramCount; i++) {
        let p = new FunctionParameter();
        p.name = "value" + i.toString();
        p.type = Static.t_double;
        t.parameters.push(p);
    }
    f.type = t;
    return f
}

function makeMathFunction32(name: string, paramCount: number, call: SystemCalls, tc: TypeChecker): Function {
    var f: Function = new Function();
    f.name = name;
    let t = new FunctionType();
    t.callingConvention = "system";
    t.name = name;
    t.returnType = Static.t_float;
    t.systemCallType = call;
    for(let i = 0; i < paramCount; i++) {
        let p = new FunctionParameter();
        p.name = "value" + i.toString();
        p.type = Static.t_float;
        t.parameters.push(p);
    }
    f.type = t;
    return f
}

let initialized = false;

function initPackages() {
    if (initialized) {
        return;
    }
    initialized = true;
    let systemPkg = new Package();
    systemPkg.scope = new Scope(null);
    systemPkg.isInternal = true;
    systemPkg.pkgPath = "fyr/system";
    systemPkg.fyrPath = Package.fyrBase;
    var heap: Function = new Function();
    heap.name = "heap";
    heap.type = new FunctionType();
    heap.type.callingConvention = "system";
    heap.type.name = "heap";
    heap.type.systemCallType = SystemCalls.heap;
    heap.type.returnType = new UnsafePointerType(Static.t_void);
    systemPkg.scope.registerElement(heap.name, heap);
    var currentMemory: Function = new Function();
    currentMemory.name = "currentMemory";
    currentMemory.type = new FunctionType();
    currentMemory.type.name = "currentMemory";
    currentMemory.type.systemCallType = SystemCalls.currentMemory;
    currentMemory.type.returnType = Static.t_uint;
    currentMemory.type.callingConvention = "system";
    systemPkg.scope.registerElement(currentMemory.name, currentMemory);
    var growMemory: Function = new Function();
    growMemory.name = "growMemory";
    growMemory.type = new FunctionType();
    growMemory.type.name = "growMemory";
    growMemory.type.systemCallType = SystemCalls.growMemory;
    growMemory.type.returnType = Static.t_int;
    let p = new FunctionParameter();
    p.name = "pages";
    p.type = Static.t_uint;
    growMemory.type.parameters.push(p);
    growMemory.type.callingConvention = "system";
    systemPkg.scope.registerElement(growMemory.name, growMemory);
    var heapTypemap: Function = new Function();
    heapTypemap.name = "heapTypemap";
    heapTypemap.type = new FunctionType();
    heapTypemap.type.callingConvention = "system";
    heapTypemap.type.name = "heapTypemap";
    heapTypemap.type.systemCallType = SystemCalls.heapTypemap;
    heapTypemap.type.returnType = new UnsafePointerType(Static.t_void);
    systemPkg.scope.registerElement(heapTypemap.name, heapTypemap);
    var pageSize: Function = new Function();
    pageSize.name = "pageSize";
    pageSize.type = new FunctionType();
    pageSize.type.callingConvention = "system";
    pageSize.type.name = "pageSize";
    pageSize.type.systemCallType = SystemCalls.pageSize;
    pageSize.type.returnType = Static.t_uint;
    systemPkg.scope.registerElement(pageSize.name, pageSize);
    var defaultStackSize: Function = new Function();
    defaultStackSize.name = "defaultStackSize";
    defaultStackSize.type = new FunctionType();
    defaultStackSize.type.callingConvention = "system";
    defaultStackSize.type.name = "defaultStackSize";
    defaultStackSize.type.systemCallType = SystemCalls.defaultStackSize;
    defaultStackSize.type.returnType = Static.t_uint;
    systemPkg.scope.registerElement(defaultStackSize.name, defaultStackSize);
    var stackPointer: Function = new Function();
    stackPointer.name = "stackPointer";
    stackPointer.type = new FunctionType();
    stackPointer.type.callingConvention = "system";
    stackPointer.type.name = "stackPointer";
    stackPointer.type.systemCallType = SystemCalls.stackPointer;
    stackPointer.type.returnType = new UnsafePointerType(Static.t_void);
    systemPkg.scope.registerElement(stackPointer.name, stackPointer);
    var continueCoroutine: Function = new Function();
    continueCoroutine.name = "continueCoroutine";
    continueCoroutine.type = new FunctionType();
    continueCoroutine.type.callingConvention = "system";
    continueCoroutine.type.name = "continueCoroutine";
    continueCoroutine.type.systemCallType = SystemCalls.continueCoroutine;
    continueCoroutine.type.returnType = Static.t_uint32;
    p = new FunctionParameter();
    p.name = "step";
    p.type = Static.t_uint32;
    continueCoroutine.type.parameters.push(p);
    p = new FunctionParameter();
    p.name = "frame";
    p.type = new UnsafePointerType(Static.t_void);
    continueCoroutine.type.parameters.push(p);
    p = new FunctionParameter();
    p.name = "step";
    p.type = Static.t_uint32;
    continueCoroutine.type.parameters.push(p);
    systemPkg.scope.registerElement(continueCoroutine.name, continueCoroutine);
    var scheduleCoroutine: Function = new Function();
    scheduleCoroutine.name = "scheduleCoroutine";
    scheduleCoroutine.type = new FunctionType();
    scheduleCoroutine.type.callingConvention = "system";
    scheduleCoroutine.type.name = "scheduleCoroutine";
    scheduleCoroutine.type.systemCallType = SystemCalls.scheduleCoroutine;
    scheduleCoroutine.type.returnType = Static.t_void;
    p = new FunctionParameter();
    p.name = "c";
    p.type = new UnsafePointerType(Static.t_void);
    scheduleCoroutine.type.parameters.push(p);
    systemPkg.scope.registerElement(scheduleCoroutine.name, scheduleCoroutine);
    var coroutine: Function = new Function();
    coroutine.name = "coroutine";
    coroutine.type = new FunctionType();
    coroutine.type.callingConvention = "system";
    coroutine.type.name = "coroutine";
    coroutine.type.systemCallType = SystemCalls.coroutine;
    coroutine.type.returnType = new UnsafePointerType(Static.t_void);
    systemPkg.scope.registerElement(coroutine.name, coroutine);
    Package.registerPackage(systemPkg);

    let mathPkg = new Package();
    mathPkg.scope = new Scope(null);
    mathPkg.isInternal = true;
    mathPkg.pkgPath = "math";
    mathPkg.fyrPath = Package.fyrBase;
    let abs = makeMathFunction64("abs", 1, SystemCalls.abs64, mathPkg.tc);
    mathPkg.scope.registerElement(abs.name, abs);
    let sqrt = makeMathFunction64("sqrt", 1, SystemCalls.sqrt64, mathPkg.tc);
    mathPkg.scope.registerElement(sqrt.name, sqrt);
    let trunc = makeMathFunction64("trunc", 1, SystemCalls.trunc64, mathPkg.tc);
    mathPkg.scope.registerElement(trunc.name, trunc);
    let nearest = makeMathFunction64("nearest", 1, SystemCalls.nearest64, mathPkg.tc);
    mathPkg.scope.registerElement(nearest.name, nearest);
    let ceil = makeMathFunction64("ceil", 1, SystemCalls.sqrt64, mathPkg.tc);
    mathPkg.scope.registerElement(ceil.name, ceil);
    let floor = makeMathFunction64("floor", 1, SystemCalls.floor64, mathPkg.tc);
    mathPkg.scope.registerElement(floor.name, floor);
    let copysign = makeMathFunction64("copysign", 2, SystemCalls.copysign64, mathPkg.tc);
    mathPkg.scope.registerElement(copysign.name, copysign);
    Package.registerPackage(mathPkg);

    let math32Pkg = new Package();
    math32Pkg.scope = new Scope(null);
    math32Pkg.isInternal = true;
    math32Pkg.pkgPath = "math/math32";
    math32Pkg.fyrPath = Package.fyrBase;
    let abs32 = makeMathFunction32("abs", 1, SystemCalls.abs32, math32Pkg.tc);
    math32Pkg.scope.registerElement(abs.name, abs32);
    let sqrt32 = makeMathFunction32("sqrt", 1, SystemCalls.sqrt32, math32Pkg.tc);
    math32Pkg.scope.registerElement(sqrt.name, sqrt32);
    let trunc32 = makeMathFunction32("trunc", 1, SystemCalls.trunc32, math32Pkg.tc);
    math32Pkg.scope.registerElement(trunc.name, trunc32);
    let nearest32 = makeMathFunction32("nearest", 1, SystemCalls.nearest32, math32Pkg.tc);
    math32Pkg.scope.registerElement(nearest.name, nearest32);
    let ceil32 = makeMathFunction32("ceil", 1, SystemCalls.sqrt32, math32Pkg.tc);
    math32Pkg.scope.registerElement(ceil.name, ceil32);
    let floor32 = makeMathFunction32("floor", 1, SystemCalls.floor32, math32Pkg.tc);
    math32Pkg.scope.registerElement(floor.name, floor32);
    let copysign32 = makeMathFunction32("copysign", 2, SystemCalls.copysign32, math32Pkg.tc);
    math32Pkg.scope.registerElement(copysign.name, copysign32);
    Package.registerPackage(math32Pkg);
}
