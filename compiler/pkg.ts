import path = require('path');
import colors = require('colors');
import process = require("process");
import fs = require("fs");
import child_process = require("child_process");
import os = require("os");
import tc = require("./typecheck");
import parser = require("./parser");
import ast = require("./ast");
import {Variable, Function, FunctionParameter, FunctionType, PolymorphFunctionType, GenericParameter, TypeChecker, UnsafePointerType, Scope} from "./typecheck"
import {CodeGenerator} from "./codegen";
import * as backend from "./backend";
import {Wasm32Backend} from "./backend_wasm";
import {CBackend} from "./backend_c";

export enum SystemCalls {
    heap = -1,
    currentMemory = -2,
    growMemory = -3,
    heapTypemap = -4,
    pageSize = -5,
    // Returns the default size for a stack
    defaultStackSize = -6,
    garbageCollect = -7,
    // The current SP
    stackPointer = -8,
    appendSlice = -9,
    growSlice = -10,
    copy = -11,
    makeString = -12,
    concatString = -13,
    compareString = -14,
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
    trap = -50,
    decodeUtf8 = -51,
    continueCoroutine = -52,
    scheduleCoroutine = -53,
    coroutine = -54,
}

let architecture = os.platform() + "-" + os.arch();

export class Package {
    constructor() {
        this.tc = new tc.TypeChecker();
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
            throw new ImportError("Import pathes must not start with " + path.sep, null, this.pkgPath);
        }

        if (this.fyrPath[this.fyrPath.length - 1] == path.sep) {
            this.fyrPath = this.fyrPath.substr(0, this.fyrPath.length - 1);
        }

        let packagePaths: Array<string> = this.pkgPath.split('/');
        this.objFileName = packagePaths[packagePaths.length - 1];
        packagePaths.splice(packagePaths.length - 1, 1);
        this.objFilePath = path.join(fyrPath, "pkg", architecture, packagePaths.join(path.sep));

        Package.packagesByPath.set(pkgPath, this);

        // Determine all filenames
        let p = this.sourcePath();        
        let allFiles = fs.readdirSync(p);
        for(let f of allFiles) {
            if (f.length > 4 && f.substr(f.length - 4, 4) == ".fyr") {
                this.files.push(path.join(p, f));
            }
        }
    }

    public setSources(files: Array<string>) {
        this.files = files;
        if (this.files.length == 0) {
            return;
        }
        let paths: Array<string> = this.files[0].split(path.sep);
        let name = paths.splice(paths.length -1, 1)[0];
        let parsedName = path.parse(name);
        this.objFileName = parsedName.name;
        this.objFilePath = paths.join(path.sep);
    }

    /**
     * Might throw SyntaxError or ImportError
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
            console.log("Compiling " + fileResolved + " ...");
            let code: string;
            try {
                code = fs.readFileSync(fileResolved, 'utf8') + "\n";
            } catch(e) {
                throw new ImportError(("Cannot read file " + file).red, null, this.pkgPath);
            }
            let f = parser.parse(code);
            this.pkgNode.statements.push(f);
        }

        // This might load more packages
        this.tc.checkModule(this.pkgNode);
    }

    /**
     * Might throw TypeError
     */
    public checkPackagePassTwo() {
        if (this.isInternal) {
            return;
        }
        this.tc.checkModulePassTwo();
    }

    /**
     * Might throw TypeError
     */
    public checkPackagePassThree() {
        if (this.isInternal) {
            return;
        }
        this.tc.checkModulePassThree();
    }

    public generateCode(backend: "C" | "WASM" | null, disableNullCheck: boolean) {
        if (this.isInternal) {
            return;
        }

        let b: backend.Backend;
        if (backend == "C") {
            b = new CBackend();
        } else if (backend == "WASM") {
            b = new Wasm32Backend();
        }
        
        this.codegen = new CodeGenerator(this.tc, b, disableNullCheck);
        this.codegen.processModule(this.pkgNode);

        this.createObjFilePath();

        if (backend == "WASM") {
            // Generate WAST
            let wastcode = this.codegen.getCode();
            let wastfile = path.join(this.objFilePath, this.objFileName + ".wat");
            fs.writeFileSync(wastfile, wastcode, 'utf8');
            // Generate WASM
            let wasmfile = path.join(this.objFilePath, this.objFileName + ".wasm");
            child_process.execFileSync("wat2wasm", [wastfile, "-r", "-o", wasmfile]);
        } else if (backend == "C") {
            // Generate C code
            let code = this.codegen.getCode();
            let cfile = path.join(this.objFilePath, this.objFileName + ".c");
            fs.writeFileSync(cfile, code, 'utf8');
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
    }

    public static checkTypesForPackages() {
        for(let p of Package.packages) {
            p.checkPackagePassTwo();
        }

        for(let p of Package.packages) {
            p.checkPackagePassThree();
        }
    }

    public static generateCodeForPackages(backend: "C" | "WASM" | null, disableNullCheck: boolean) {
        for(let p of Package.packages) {
            p.generateCode(backend, disableNullCheck);
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
    
    public static resolve(pkgPath: string, loc: ast.Location): Package | null {
        if (Package.packagesByPath.has(pkgPath)) {
            return Package.packagesByPath.get(pkgPath);
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
            pkg.findSources(pkgPath, p);
            pkg.loadSources();
            return pkg;
        }
    
        throw new ImportError("Unknown package \"" + pkgPath + "\"", loc, pkgPath);
    }
    
    public pkgNode: ast.Node;
    // The path name of the package, e.g. "network/http".
    public pkgPath: string;
    // The Fyr directory where to which the package belongs or null for an anonymous package;
    public fyrPath: string = null;
    public scope: Scope;
    public tc: TypeChecker;
    // All source files of the package.
    public files: Array<string> = [];
    public codegen: CodeGenerator;
    public objFilePath: string;
    public objFileName: string;
    public isInternal: boolean;

    private static packagesByPath: Map<string, Package> = new Map<string, Package>();
    private static packages: Array<Package> = [];
    private static fyrPaths: Array<string>;
    public static fyrBase: string;
}

export class ImportError {
    constructor(message: string, loc: ast.Location, path: string) {
        this.message = message;
        this.location = loc;
        this.path = path;
    }

    public message: string;
    public location: ast.Location;
    public path: string;
}

var systemPkg: Package;
var mathPkg: Package;

function makeMathFunction(name: string, paramCount: number, call32: SystemCalls, call64: SystemCalls, tc: TypeChecker): Function {
    var abs: Function = new Function();
    abs.name = name;
    let gt = new PolymorphFunctionType();
    gt.name = name;
    gt.callingConvention = "system";
    let gp = new GenericParameter();
    gp.name = "V";
    gt.genericParameters.push(gp);
    for(let i = 0; i < paramCount; i++) {
        let p = new FunctionParameter();
        p.name = "value" + i.toString();
        p.type = gp;
        gt.parameters.push(p);
    }
    gt.returnType = gp;
    // float
    let t = new FunctionType();
    t.callingConvention = "system";
    t.name = name;
    t.returnType = tc.t_float;
    t.systemCallType = call32;
    for(let i = 0; i < paramCount; i++) {
        let p = new FunctionParameter();
        p.name = "value" + i.toString();
        p.type = tc.t_float;
        t.parameters.push(p);
    }
    gt.instances.push(t);
    // double
    t = new FunctionType();
    t.callingConvention = "system";
    t.name = name;
    t.returnType = tc.t_double;
    t.systemCallType = call64;
    for(let i = 0; i < paramCount; i++) {
        let p = new FunctionParameter();
        p.name = "value" + i.toString();
        p.type = tc.t_double;
        t.parameters.push(p);
    }
    gt.instances.push(t);
    abs.type = gt;
    return abs
}

function initPackages() {
    systemPkg = new Package();
    systemPkg.isInternal = true;
    systemPkg.pkgPath = "fyr/system";
    systemPkg.fyrPath = Package.fyrBase;
    var heap: Function = new Function();
    heap.name = "heap";
    heap.type = new FunctionType();
    heap.type.callingConvention = "system";
    heap.type.name = "heap";
    heap.type.systemCallType = SystemCalls.heap;
    heap.type.returnType = new UnsafePointerType(systemPkg.tc.t_void);
    systemPkg.scope.registerElement(heap.name, heap);
    var currentMemory: Function = new Function();
    currentMemory.name = "currentMemory";
    currentMemory.type = new FunctionType();
    currentMemory.type.name = "currentMemory";
    currentMemory.type.systemCallType = SystemCalls.currentMemory;
    currentMemory.type.returnType = systemPkg.tc.t_uint;
    currentMemory.type.callingConvention = "system";
    systemPkg.scope.registerElement(currentMemory.name, currentMemory);
    var growMemory: Function = new Function();
    growMemory.name = "growMemory";
    growMemory.type = new FunctionType();
    growMemory.type.name = "growMemory";
    growMemory.type.systemCallType = SystemCalls.growMemory;
    growMemory.type.returnType = systemPkg.tc.t_int;
    let p = new FunctionParameter();
    p.name = "pages";
    p.type = systemPkg.tc.t_uint;
    growMemory.type.parameters.push(p);
    growMemory.type.callingConvention = "system";
    systemPkg.scope.registerElement(growMemory.name, growMemory);
    var heapTypemap: Function = new Function();
    heapTypemap.name = "heapTypemap";
    heapTypemap.type = new FunctionType();
    heapTypemap.type.callingConvention = "system";
    heapTypemap.type.name = "heapTypemap";
    heapTypemap.type.systemCallType = SystemCalls.heapTypemap;
    heapTypemap.type.returnType = new UnsafePointerType(systemPkg.tc.t_void);
    systemPkg.scope.registerElement(heapTypemap.name, heapTypemap);
    var pageSize: Function = new Function();
    pageSize.name = "pageSize";
    pageSize.type = new FunctionType();
    pageSize.type.callingConvention = "system";
    pageSize.type.name = "pageSize";
    pageSize.type.systemCallType = SystemCalls.pageSize;
    pageSize.type.returnType = systemPkg.tc.t_uint;
    systemPkg.scope.registerElement(pageSize.name, pageSize);
    var defaultStackSize: Function = new Function();
    defaultStackSize.name = "defaultStackSize";
    defaultStackSize.type = new FunctionType();
    defaultStackSize.type.callingConvention = "system";
    defaultStackSize.type.name = "defaultStackSize";
    defaultStackSize.type.systemCallType = SystemCalls.defaultStackSize;
    defaultStackSize.type.returnType = systemPkg.tc.t_uint;
    systemPkg.scope.registerElement(defaultStackSize.name, defaultStackSize);
    var garbageCollect: Function = new Function();
    garbageCollect.name = "garbageCollect";
    garbageCollect.type = new FunctionType();
    garbageCollect.type.callingConvention = "system";
    garbageCollect.type.name = "garbageCollect";
    garbageCollect.type.systemCallType = SystemCalls.garbageCollect;
    garbageCollect.type.returnType = systemPkg.tc.t_void;
    systemPkg.scope.registerElement(garbageCollect.name, garbageCollect);
    var stackPointer: Function = new Function();
    stackPointer.name = "stackPointer";
    stackPointer.type = new FunctionType();
    stackPointer.type.callingConvention = "system";
    stackPointer.type.name = "stackPointer";
    stackPointer.type.systemCallType = SystemCalls.stackPointer;
    stackPointer.type.returnType = new UnsafePointerType(systemPkg.tc.t_void);
    systemPkg.scope.registerElement(stackPointer.name, stackPointer);
    var trap: Function = new Function();
    trap.name = "trap";
    trap.type = new FunctionType();
    trap.type.callingConvention = "system";
    trap.type.name = "trap";
    trap.type.systemCallType = SystemCalls.trap;
    trap.type.returnType = systemPkg.tc.t_void;
    systemPkg.scope.registerElement(trap.name, trap);
    var continueCoroutine: Function = new Function();
    continueCoroutine.name = "continueCoroutine";
    continueCoroutine.type = new FunctionType();
    continueCoroutine.type.callingConvention = "system";
    continueCoroutine.type.name = "continueCoroutine";
    continueCoroutine.type.systemCallType = SystemCalls.continueCoroutine;
    continueCoroutine.type.returnType = systemPkg.tc.t_uint32;
    p = new FunctionParameter();
    p.name = "step";
    p.type = systemPkg.tc.t_uint32;
    continueCoroutine.type.parameters.push(p);
    p = new FunctionParameter();
    p.name = "frame";
    p.type = new UnsafePointerType(systemPkg.tc.t_void);
    continueCoroutine.type.parameters.push(p);
    p = new FunctionParameter();
    p.name = "step";
    p.type = systemPkg.tc.t_uint32;
    continueCoroutine.type.parameters.push(p);
    systemPkg.scope.registerElement(continueCoroutine.name, continueCoroutine);
    var scheduleCoroutine: Function = new Function();
    scheduleCoroutine.name = "scheduleCoroutine";
    scheduleCoroutine.type = new FunctionType();
    scheduleCoroutine.type.callingConvention = "system";
    scheduleCoroutine.type.name = "scheduleCoroutine";
    scheduleCoroutine.type.systemCallType = SystemCalls.scheduleCoroutine;
    scheduleCoroutine.type.returnType = systemPkg.tc.t_void;
    p = new FunctionParameter();
    p.name = "c";
    p.type = new UnsafePointerType(systemPkg.tc.t_void);
    scheduleCoroutine.type.parameters.push(p);
    systemPkg.scope.registerElement(scheduleCoroutine.name, scheduleCoroutine);
    var coroutine: Function = new Function();
    coroutine.name = "coroutine";
    coroutine.type = new FunctionType();
    coroutine.type.callingConvention = "system";
    coroutine.type.name = "coroutine";
    coroutine.type.systemCallType = SystemCalls.coroutine;
    coroutine.type.returnType = new UnsafePointerType(systemPkg.tc.t_void);
    systemPkg.scope.registerElement(coroutine.name, coroutine);

    mathPkg = new Package();
    mathPkg.isInternal = true;
    mathPkg.pkgPath = "fyr/math";
    mathPkg.fyrPath = Package.fyrBase;
    let abs = makeMathFunction("abs", 1, SystemCalls.abs32, SystemCalls.abs64, mathPkg.tc);
    mathPkg.scope.registerElement(abs.name, abs);
    let sqrt = makeMathFunction("sqrt", 1, SystemCalls.sqrt32, SystemCalls.sqrt64, mathPkg.tc);
    mathPkg.scope.registerElement(sqrt.name, sqrt);
    let trunc = makeMathFunction("trunc", 1, SystemCalls.trunc32, SystemCalls.trunc64, mathPkg.tc);
    mathPkg.scope.registerElement(trunc.name, trunc);
    let nearest = makeMathFunction("nearest", 1, SystemCalls.nearest32, SystemCalls.nearest64, mathPkg.tc);
    mathPkg.scope.registerElement(nearest.name, nearest);
    let ceil = makeMathFunction("ceil", 1, SystemCalls.sqrt32, SystemCalls.sqrt64, mathPkg.tc);
    mathPkg.scope.registerElement(ceil.name, ceil);
    let floor = makeMathFunction("floor", 1, SystemCalls.floor32, SystemCalls.floor64, mathPkg.tc);
    mathPkg.scope.registerElement(floor.name, floor);
    let min = makeMathFunction("min", 2, SystemCalls.min32, SystemCalls.min64, mathPkg.tc);
    mathPkg.scope.registerElement(min.name, min);
    let max = makeMathFunction("max", 2, SystemCalls.max32, SystemCalls.max64, mathPkg.tc);
    mathPkg.scope.registerElement(max.name, max);
    let copysign = makeMathFunction("copysign", 2, SystemCalls.copysign32, SystemCalls.copysign64, mathPkg.tc);
    mathPkg.scope.registerElement(copysign.name, copysign);
}