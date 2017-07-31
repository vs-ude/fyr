import {Location} from "./ast"
import {Variable, Function, FunctionParameter, FunctionType, TypeChecker, UnsafePointerType, Scope} from "./typecheck"

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
    append = -9,
    growSlice = -10,
    copy = -11,
}

export class Package {
    constructor(path: string) {
        this.path = path;
        packages.set(path, this);
        this.scope = new Scope(null);
    }

    public path: string;
    public scope: Scope;
}

export function resolve(path: string, loc: Location): Package | null {
    if (packages.has(path)) {
        return packages.get(path);
    }

    throw new ImportError("Unknown package \"" + path + "\"", loc, path);
}

var packages: Map<string, Package> = new Map<string, Package>();

export class ImportError {
    constructor(message: string, loc: Location, path: string) {
        this.message = message;
        this.location = loc;
        this.path = path;
    }

    public message: string;
    public location: Location;
    public path: string;
}

var systemPkg: Package;

export function initPackages(tc: TypeChecker) {
    systemPkg = new Package("fyr/system");
    var heap: Function = new Function();
    heap.name = "heap";
    heap.type = new FunctionType();
    heap.type.callingConvention = "system";
    heap.type.name = "heap";
    heap.type.systemCallType = SystemCalls.heap;
    heap.type.returnType = new UnsafePointerType(tc.t_void);
    systemPkg.scope.registerElement(heap.name, heap);
    var currentMemory: Function = new Function();
    currentMemory.name = "currentMemory";
    currentMemory.type = new FunctionType();
    currentMemory.type.name = "currentMemory";
    currentMemory.type.systemCallType = SystemCalls.currentMemory;
    currentMemory.type.returnType = tc.t_uint;
    currentMemory.type.callingConvention = "system";
    systemPkg.scope.registerElement(currentMemory.name, currentMemory);
    var growMemory: Function = new Function();
    growMemory.name = "growMemory";
    growMemory.type = new FunctionType();
    growMemory.type.name = "growMemory";
    growMemory.type.systemCallType = SystemCalls.growMemory;
    growMemory.type.returnType = tc.t_int;
    let p = new FunctionParameter();
    p.name = "pages";
    p.type = tc.t_uint;
    growMemory.type.parameters.push(p);
    growMemory.type.callingConvention = "system";
    systemPkg.scope.registerElement(growMemory.name, growMemory);
    var heapTypemap: Function = new Function();
    heapTypemap.name = "heapTypemap";
    heapTypemap.type = new FunctionType();
    heapTypemap.type.callingConvention = "system";
    heapTypemap.type.name = "heapTypemap";
    heapTypemap.type.systemCallType = SystemCalls.heapTypemap;
    heapTypemap.type.returnType = new UnsafePointerType(tc.t_void);
    systemPkg.scope.registerElement(heapTypemap.name, heapTypemap);
    var pageSize: Function = new Function();
    pageSize.name = "pageSize";
    pageSize.type = new FunctionType();
    pageSize.type.callingConvention = "system";
    pageSize.type.name = "pageSize";
    pageSize.type.systemCallType = SystemCalls.pageSize;
    pageSize.type.returnType = tc.t_uint;
    systemPkg.scope.registerElement(pageSize.name, pageSize);
    var defaultStackSize: Function = new Function();
    defaultStackSize.name = "defaultStackSize";
    defaultStackSize.type = new FunctionType();
    defaultStackSize.type.callingConvention = "system";
    defaultStackSize.type.name = "defaultStackSize";
    defaultStackSize.type.systemCallType = SystemCalls.defaultStackSize;
    defaultStackSize.type.returnType = tc.t_uint;
    systemPkg.scope.registerElement(defaultStackSize.name, defaultStackSize);
    var garbageCollect: Function = new Function();
    garbageCollect.name = "garbageCollect";
    garbageCollect.type = new FunctionType();
    garbageCollect.type.callingConvention = "system";
    garbageCollect.type.name = "garbageCollect";
    garbageCollect.type.systemCallType = SystemCalls.garbageCollect;
    garbageCollect.type.returnType = tc.t_void;
    systemPkg.scope.registerElement(garbageCollect.name, garbageCollect);
    var stackPointer: Function = new Function();
    stackPointer.name = "stackPointer";
    stackPointer.type = new FunctionType();
    stackPointer.type.callingConvention = "system";
    stackPointer.type.name = "stackPointer";
    stackPointer.type.systemCallType = SystemCalls.stackPointer;
    stackPointer.type.returnType = new UnsafePointerType(tc.t_void);
    systemPkg.scope.registerElement(stackPointer.name, stackPointer);
}