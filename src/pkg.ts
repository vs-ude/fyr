import {Location} from "./ast"
import {Variable, Function, FunctionParameter, FunctionType, PolymorphFunctionType, GenericParameter, TypeChecker, UnsafePointerType, Scope} from "./typecheck"

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

    mathPkg = new Package("fyr/math");
    let abs = makeMathFunction("abs", 1, SystemCalls.abs32, SystemCalls.abs64, tc);
    mathPkg.scope.registerElement(abs.name, abs);
    let sqrt = makeMathFunction("sqrt", 1, SystemCalls.sqrt32, SystemCalls.sqrt64, tc);
    mathPkg.scope.registerElement(sqrt.name, sqrt);
    let trunc = makeMathFunction("trunc", 1, SystemCalls.trunc32, SystemCalls.trunc64, tc);
    mathPkg.scope.registerElement(trunc.name, trunc);
    let nearest = makeMathFunction("nearest", 1, SystemCalls.nearest32, SystemCalls.nearest64, tc);
    mathPkg.scope.registerElement(nearest.name, nearest);
    let ceil = makeMathFunction("ceil", 1, SystemCalls.sqrt32, SystemCalls.sqrt64, tc);
    mathPkg.scope.registerElement(ceil.name, ceil);
    let floor = makeMathFunction("floor", 1, SystemCalls.floor32, SystemCalls.floor64, tc);
    mathPkg.scope.registerElement(floor.name, floor);
    let min = makeMathFunction("min", 2, SystemCalls.min32, SystemCalls.min64, tc);
    mathPkg.scope.registerElement(min.name, min);
    let max = makeMathFunction("max", 2, SystemCalls.max32, SystemCalls.max64, tc);
    mathPkg.scope.registerElement(max.name, max);
    let copysign = makeMathFunction("copysign", 2, SystemCalls.copysign32, SystemCalls.copysign64, tc);
    mathPkg.scope.registerElement(copysign.name, copysign);
}