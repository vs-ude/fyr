import {Location, Node, NodeOp} from "./ast"
import {Function, Type, PackageType, MapType, InterfaceType, RestrictedType, OrType, ObjectLiteralType, TupleLiteralType, ArrayLiteralType, StructType, GuardedPointerType, UnsafePointerType, PointerType, FunctionType, ArrayType, SliceType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement} from "./typecheck"
import * as ssa from "./ssa"
import * as wasm from "./wasm"
import {SystemCalls} from "./pkg"

export class CodeGenerator {
    constructor(tc: TypeChecker, emitIR: boolean, emitNoWasm: boolean, emitFunction: string, disableNullCheck: boolean) {
        this.tc = tc;
        this.emitIR = emitIR;
        this.emitNoWasm = emitNoWasm;
        this.emitFunction = emitFunction;
        this.disableNullCheck = disableNullCheck;
        this.imports = new Map<string, wasm.FunctionImport>();
        this.wasm = new ssa.Wasm32Backend(emitIR, emitFunction);
        this.wasm.module.importMemory("imports", "mem");
        this.sliceHeader = new ssa.StructType();
        this.sliceHeader.name = "slice";
        this.sliceHeader.addField("data_ptr", "ptr");
        this.sliceHeader.addField("length", "i32");
        this.sliceHeader.addField("cap", "i32");
        this.ifaceHeader = new ssa.StructType();
        this.ifaceHeader.name = "iface";
        this.ifaceHeader.addField("typecode", "i32");
        this.ifaceHeader.addField("pointer", "ptr");
        this.ifaceHeader.addField("value", "i64");
        this.ifaceHeader32 = new ssa.StructType();
        this.ifaceHeader32.name = "iface";
        this.ifaceHeader32.addField("typecode", "i32");
        this.ifaceHeader32.addField("pointer", "ptr");
        this.ifaceHeader32.addField("value", "i32");
        this.ifaceHeaderFloat = new ssa.StructType();
        this.ifaceHeaderFloat.name = "iface";
        this.ifaceHeaderFloat.addField("typecode", "i32");
        this.ifaceHeaderFloat.addField("pointer", "addr");
        this.ifaceHeaderFloat.addField("value", "f32");
        this.ifaceHeaderDouble = new ssa.StructType();
        this.ifaceHeaderDouble.name = "iface";
        this.ifaceHeaderDouble.addField("typecode", "i32");
        this.ifaceHeaderDouble.addField("pointer", "addr");
        this.ifaceHeaderDouble.addField("value", "f64");
        this.ifaceHeaderSlice = new ssa.StructType();
        this.ifaceHeaderSlice.name = "iface";
        this.ifaceHeaderSlice.addField("typecode", "i32");
        this.ifaceHeaderSlice.addField("value", this.sliceHeader);
        this.mapHead = new ssa.StructType();
        this.mapHead.name = "mapHead";
        this.mapHead.addField("nextHead", "ptr")
        this.mapHead.addField("size", "i32")
        this.mapHead.addField("free", "i32")
        this.mapHead.addField("freeList", "addr")
        this.copyFunctionType = new ssa.FunctionType(["addr", "addr", "i32"], null, "system");
        this.makeStringFunctionType = new ssa.FunctionType(["addr", "i32"], "ptr", "system");
        this.compareStringFunctionType = new ssa.FunctionType(["ptr", "ptr"], "i32", "system");
        this.concatStringFunctionType = new ssa.FunctionType(["ptr", "ptr"], "ptr", "system");
        this.createMapFunctionType = new ssa.FunctionType(["addr", "i32", "addr"], "ptr", "system");
        this.setMapFunctionType = new ssa.FunctionType(["ptr", "i64", "i32", "ptr", "i32"], null, "system");
        this.lookupMapFunctionType = new ssa.FunctionType(["addr", "i64", "i32", "addr"], "addr", "system");
        this.removeMapKeyFunctionType = new ssa.FunctionType(["addr", "i64", "i32", "addr"], "i32", "system");
        this.hashStringFunctionType = new ssa.FunctionType(["addr"], "i64", "system");
    }

    public processModule(mnode: Node) {
        // Iterate over all files and import all functions, but import each function not more than once
        for(let fnode of mnode.statements) {
            for(let name of fnode.scope.elements.keys()) {
                let e = fnode.scope.elements.get(name);
                if (e instanceof Function && e.isImported) {
                    let name = e.importFromModule + "/" + e.name;
                    if (this.imports.has(name)) {
                        this.funcs.set(e, this.imports.get(name));
                    } else {
                        let wf = this.wasm.importFunction(e.name, e.importFromModule, this.getSSAFunctionType(e.type));
                        this.funcs.set(e, wf);
                        this.imports.set(name, wf);
                    }
                }
            }
        }

        // Global variables oredered by their appearance in the code
        let globals: Array<Variable> = [];
        // Declare all functions and global variables
        let scope = mnode.scope;
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isImported) {
                    throw "Implementation error";
                }
                let name = e.name;
                if (e.type.objectType) {
                    name = RestrictedType.strip(e.type.objectType).name + "." + name;
                }
                let wf = this.wasm.declareFunction(name);
                this.funcs.set(e, wf);
            } else if (e instanceof Variable) {
                let g = this.wasm.declareGlobalVar(e.name, this.getSSAType(e.type));
                this.globalVars.set(e, g);
                if (e.node.rhs) {
                    globals.push(e);
                }
            } else {
                throw "CodeGen: Implementation Error " + e;
            }
        }
        
        // Generate IR code for the initialization of global variables
        if (globals.length > 0) {
            let wf = this.wasm.declareFunction("init");
            let b = new ssa.Builder();
            let t = new FunctionType();
            t.returnType = this.tc.t_void;
            t.callingConvention = "fyr";
            b.define("init", this.getSSAFunctionType(t));
            for(let v of globals) {
                let g = this.globalVars.get(v);
                let expr = this.processExpression(null, scope, v.node.rhs, b, new Map<ScopeElement, ssa.Variable>(), v.type);
                b.assign(g, "copy", this.getSSAType(v.type), [expr]);
            }
            this.wasm.defineFunction(b.node, wf);
        }

        // Generate IR code for all functions and initialization of global variables
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isImported) {
                    throw "Implementation error";
                }
                let wf = this.funcs.get(e) as wasm.Function;
                let n = this.processFunction(e, true, wf);
            } else if (e instanceof Variable) {
                // Do nothing by intention
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }

        // Generate WASM code for the module
        this.wasm.generateModule();
        
//        console.log('============ WASM ===============');
        if (!this.emitNoWasm) {
            console.log(this.wasm.module.toWast(""));
        }
    }

    public getSSAType(t: Type): ssa.Type | ssa.StructType {
        if (t == this.tc.t_bool || t == this.tc.t_uint8 || t == this.tc.t_byte || t == this.tc.t_void) {
            return "i8";
        }
        if (t == this.tc.t_int8) {
            return "s8";
        }
        if (t == this.tc.t_int16) {
            return "s16";
        }
        if (t == this.tc.t_uint16) {
            return "i16";
        }
        if (t == this.tc.t_int32) {
            return "s32";
        }
        if (t == this.tc.t_uint32) {
            return "i32";
        }
        if (t == this.tc.t_int64) {
            return "s64";
        }
        if (t == this.tc.t_uint64) {
            return "i64";
        }
        if (t == this.tc.t_float) {
            return "f32";
        }
        if (t == this.tc.t_double) {
            return "f64";
        }
        if (t instanceof PointerType) {
            return "ptr";
        }
        if (t instanceof UnsafePointerType) {
            return "addr";
        }
        if (t == this.tc.t_string) {
            return "ptr";
        }
        if (t instanceof SliceType) {
            return this.sliceHeader;
        }
        if (t instanceof MapType) {
            return "ptr";
        }
        if (t instanceof StructType) {
            let s = new ssa.StructType();
            s.name = t.name;
            for(let i = 0; i < t.fields.length; i++) {
                let f = t.fields[i];
                let ft = this.getSSAType(f.type);
                s.addField(f.name, ft, 1);
                if (t.extends && i == 0) {
                    for(let entry of (ft as ssa.StructType).fieldOffsetsByName.entries()) {
                        s.fieldOffsetsByName.set(entry[0], entry[1]);
                    }
                }
            }
            return s;
        }
        if (t instanceof ArrayType) {
            let s = new ssa.StructType();
            s.name = t.name;
            s.addField("data", this.getSSAType(t.elementType), t.size);
            return s;
        }
        if (t instanceof TupleType) {
            let s = new ssa.StructType();
            s.name = t.name;
            let i = 0;
            for(let el of t.types) {
                s.addField("t" + i.toString(), this.getSSAType(el));
                i++;
            }
            return s;            
        }
        if (t instanceof InterfaceType) {
            return this.ifaceHeader;
        }
        if (t instanceof OrType) {
            return this.ifaceHeader;
        }
        if (t instanceof RestrictedType) {
            return this.getSSAType(t.elementType);
        }
        throw "CodeGen: Implementation error: The type does not fit in a register " + t.toString();
    }

    private getSSAFunctionType(t: FunctionType): ssa.FunctionType {
        let ftype = new ssa.FunctionType([], null, t.callingConvention);
        if (t.objectType) {
            ftype.params.push("ptr");
        }
        for(let p of t.parameters) {
            ftype.params.push(this.getSSAType(p.type));
        }
        if (t.returnType != this.tc.t_void) {
            ftype.result = this.getSSAType(t.returnType);
        }
        if (t.hasEllipsis()) {
            ftype.ellipsisParam = this.getSSAType((t.lastParameter().type as SliceType).elementType);
        }
        return ftype;
    }

    public processFunction(f: Function, exportFunc: boolean, wf: wasm.Function): ssa.Node {
        let vars = new Map<ScopeElement, ssa.Variable>();
        // Add global variables
        for(let e of this.globalVars.keys()) {
            vars.set(e, this.globalVars.get(e));
        }

        let b = new ssa.Builder();

        b.define(f.name, this.getSSAFunctionType(f.type));
        // Declare parameters
        for(let name of f.scope.elements.keys()) {
            let e = f.scope.elements.get(name);
            if (e instanceof FunctionParameter) {
                let v = b.declareParam(this.getSSAType(e.type), name);
                vars.set(e, v);
            }
        }
        // Declare result
        if (f.namedReturnTypes) {
            for(let name of f.scope.elements.keys()) {
                let e = f.scope.elements.get(name);
                if (e instanceof Variable && e.isResult) {
                    // Create a variable that can be assigned multiple times
                    let v = b.declareResult(this.getSSAType(e.type), name);
                    vars.set(e, v);                    
                }
            }
        } else if (f.type.returnType != this.tc.t_void) {
            let v = b.declareResult(this.getSSAType(f.type.returnType), "$return");
        }

        this.processScopeVariables(b, vars, f.scope);

        for(let node of f.node.statements) {
            this.processStatement(f, f.scope, node, b, vars, null);
        }
        b.end();

        if (this.emitIR || f.name == this.emitFunction) {
            console.log(ssa.Node.strainToString("", b.node));                
        }

        /*
        this.optimizer.optimizeConstants(b.node);
        if (this.emitIR || f.name == this.emitFunction) {
            console.log('============ OPTIMIZED Constants ===============');
            console.log(ssa.Node.strainToString("", b.node));
        }

        this.optimizer.removeDeadCode(b.node);
        if (this.emitIR || f.name == this.emitFunction) {
            console.log('============ OPTIMIZED Dead code ===============');
            console.log(ssa.Node.strainToString("", b.node));
        }
        */

        this.wasm.defineFunction(b.node, wf);
        if (exportFunc) {
            this.wasm.module.exports.set(f.name, wf);
        } 
        return b.node;
    }

    public processScopeVariables(b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, scope: Scope) {
        // Declare variables
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Variable) {
                if (e.isResult) {
                    continue;
                } else {
                    // Create a variable that can be assigned multiple times
                    let v = b.declareVar(this.getSSAType(e.type), name);
                    vars.set(e, v);
                }
            }
        }
    }

    public processStatement(f: Function, scope: Scope, snode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, blocks: {body: ssa.Node, outer: ssa.Node} | null) {
        switch(snode.op) {
            case "comment":
                break;
            case "if":
            {
                this.processScopeVariables(b, vars, snode.scope);
                if (snode.lhs) {
                    this.processStatement(f, snode.scope, snode.lhs, b, vars, blocks);
                }
                let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars, this.tc.t_bool);
                b.ifBlock(tmp);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, b, vars, blocks);
                }
                if (snode.elseBranch) {
                    b.elseBlock();
                    this.processStatement(f, snode.elseBranch.scope, snode.elseBranch, b, vars, blocks);
                }
                b.end();
                break;
            }
            case "else":
            {
                this.processScopeVariables(b, vars, snode.scope);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, b, vars, blocks);
                }
                break;                
            }
            case "const":
            case "var":
            {
                if (snode.rhs) { // Assignment of an expression value?
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value) as Variable;
                        let v = vars.get(element);
                        let tmp = this.processExpression(f, scope, snode.rhs, b, vars, element.type);
                        b.assign(v, "copy", v.type, [tmp]);
                    } else if (snode.lhs.op == "tuple") {
                        throw "TODO"
                    } else if (snode.lhs.op == "array") {
                        throw "TODO"                        
                    } else if (snode.lhs.op == "object") {
                        throw "TODO"                        
                    } else {
                        throw "Impl error"
                    }
                }
                return;
            }
            case "=":
            {
                if (snode.lhs.op == "tuple" || snode.lhs.op == "array" || snode.lhs.op == "object") {
                    var processAssignmentDestinations = (node: Node, destinations: Array<ssa.Variable | ssa.Pointer>) => {
                        if (node.op == "tuple") {
                            for(let p of node.parameters) {
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    processAssignmentDestinations(p, destinations);
                                } else {
                                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, p, b, vars);
                                    destinations.push(dest);
                                }
                            }
                        } else if (node.op == "array") {
                            throw "TODO"                        
                        } else if (node.op == "object") {
                            throw "TODO"                        
                        }
                    }
                    var processAssignment = (node: Node, type: Type, destinations: Array<ssa.Variable | ssa.Pointer>, destCount: number, source: ssa.Pointer) => {
                        if (node.op == "tuple") {
                            if (!(type instanceof TupleType)) {
                                throw "Implementation error";
                            }
                            let stype = this.getSSAType(type) as ssa.StructType;
                            for(let i = 0; i < node.parameters.length; i++) {
                                let p = node.parameters[i];
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    destCount = processAssignment(p, type.types[i], destinations, destCount, new ssa.Pointer(source.variable, source.offset + eoffset));
                                } else {
                                    let etype: ssa.Type | ssa.StructType = stype.fields[i][1];
                                    let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    let dest = destinations[destCount];
                                    destCount++;
                                    let val = b.assign(b.tmp(), "load", etype, [source.variable, source.offset + eoffset]);
                                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                                    if (dest instanceof ssa.Pointer) {
                                        b.assign(b.mem, "store", etype, [dest.variable, dest.offset, val]);
                                    } else {
                                        b.assign(dest, "copy", etype, [val]);
                                    }
                                }
                            }
                        } else if (node.op == "array") {
                            throw "TODO"                        
                        } else if (node.op == "object") {
                            throw "TODO"                        
                        }
                        return destCount;
                    }
                    let destinations: Array<ssa.Variable | ssa.Pointer> = [];
                    processAssignmentDestinations(snode.lhs, destinations);
                    let val : ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(snode.rhs)) {
                        val = this.processLeftHandExpression(f, scope, snode.rhs, b, vars);
                    } else {
                        val = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type) as ssa.Variable;
                    }
                    let ptr: ssa.Pointer;
                    if (val instanceof ssa.Pointer) {
                        ptr = val;
                    } else {
                        ptr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [val]), 0);
                    }
                    processAssignment(snode.lhs, snode.rhs.type, destinations, 0, ptr);
                } else if (snode.lhs.op == "[" && this.tc.stripType(snode.lhs.lhs.type) instanceof MapType) {
                    let mtype: MapType = this.tc.stripType(snode.lhs.lhs.type) as MapType;
                    let m = this.processExpression(f, scope, snode.lhs.lhs, b, vars, mtype);
                    let key = this.processExpression(f, scope, snode.lhs.rhs, b, vars, mtype.keyType);
                    let value = this.processExpression(f, scope, snode.rhs, b, vars, mtype.valueType);
                    let keyType: number;
                    let size: number;
                    let hash: ssa.Variable;
                    let tuplePtr: ssa.Variable;
                    if (mtype.keyType == this.tc.t_string) {
                        hash = b.call(b.tmp(), this.hashStringFunctionType, [SystemCalls.hashString, key]);
                        keyType = 1
                        let tupleType = new ssa.StructType();
                        tupleType.addField("key", "ptr")
                        tupleType.addField("value", this.getSSAType(mtype.valueType));
                        size = ssa.sizeOf(tupleType);
                        let tuple = b.assign(b.tmp(), "struct", tupleType, [key, value]);
                        tuplePtr = b.assign(b.tmp(), "addr_of", "addr", [tuple]);
                    } else {
                        throw "TODO"
                    }
                    let tmp = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type);
                    b.call(null, this.setMapFunctionType, [SystemCalls.setMap, m, hash, keyType, tuplePtr, size])
                } else {
                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                    let tmp = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type);
                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                    if (dest instanceof ssa.Pointer) {
                        b.assign(b.mem, "store", this.getSSAType(snode.lhs.type), [dest.variable, dest.offset, tmp]);
                    } else {
                        b.assign(dest, "copy", this.getSSAType(snode.lhs.type), [tmp]);
                    }
                }
                break;
            }
            case "/=":
            case "%=":
            case ">>=":
            case "*=":
            case "-=":
            case "+=":
            case "&=":
            case "&^=":
            case "^=":
            case "|=":
            case "<<=":
            {
                let storage = this.getSSAType(snode.lhs.type);
                let tmp: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                let p1: ssa.Variable;
                let dest: ssa.Variable;
                if (tmp instanceof ssa.Pointer) {
                    p1 = b.assign(b.tmp(), "load", storage, [tmp.variable, tmp.offset]);
                    dest = b.tmp();
                } else {
                    p1 = tmp;
                    dest = tmp;
                }
                let p2 = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type);
                if (snode.lhs.type == this.tc.t_string) {
                    b.call(dest, this.concatStringFunctionType, [SystemCalls.concatString, p1, p2]);
                } else if (storage == "f32" || storage == "f64") {
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    } else if (snode.op == "*=") {
                        b.assign(dest, "mul", storage, [p1, p2]);
                    } else if (snode.op == "/=") {
                        b.assign(dest, "div", storage, [p1, p2]);
                    }
                } else if (snode.lhs.type instanceof UnsafePointerType) {
                    let estorage = this.getSSAType(snode.lhs.type.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    }
                } else if (snode.lhs.type instanceof GuardedPointerType) {
                    throw "TODO"
                } else {
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    } else if (snode.op == "*=") {
                        b.assign(dest, "mul", storage, [p1, p2]);
                    } else if (snode.op == "&=") {
                        b.assign(dest, "and", storage, [p1, p2]);
                    } else if (snode.op == "|=") {
                        b.assign(dest, "or", storage, [p1, p2]);
                    } else if (snode.op == "^=") {
                        b.assign(dest, "xor", storage, [p1, p2]);
                    } else if (snode.op == "<<=") {
                        b.assign(dest, "shl", storage, [p1, p2]);
                    } else if (snode.op == "&^=") {
                        let x = b.assign(b.tmp(), "xor", storage, [p2, -1]);
                        b.assign(dest, "and", storage, [p1, x]);
                    } else if (snode.op == "/=") {
                        b.assign(dest, this.isSigned(snode.lhs.type) ? "div_s" : "div_u", storage, [p1, p2]);                                
                    } else if (snode.op == "%=") {
                        b.assign(dest, this.isSigned(snode.lhs.type) ? "rem_s" : "rem_u", storage, [p1, p2]);
                    } else if (snode.op == ">>=") {
                        b.assign(dest, this.isSigned(snode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
                    }
                }
                if (tmp instanceof ssa.Pointer) {
                    b.assign(b.mem, "store", storage, [tmp.variable, tmp.offset, dest]);
                }
                break;
            }
            case "--":
            case "++":
            {
                let t = this.tc.stripType(snode.lhs.type)
                let storage = this.getSSAType(t);
                let tmp: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                let p1: ssa.Variable;
                let dest: ssa.Variable;
                if (tmp instanceof ssa.Pointer) {
                    p1 = b.assign(b.tmp(), "load", storage, [tmp.variable, tmp.offset]);
                    dest = b.tmp();
                } else {
                    p1 = tmp;
                    dest = tmp;
                }
                if (t instanceof GuardedPointerType) {
                    throw "TODO"
                } else {
                    let increment = 1;
                    if (t instanceof UnsafePointerType) {
                        increment = ssa.sizeOf(this.getSSAType(t.elementType));
                    }
                    b.assign(dest, snode.op == "++" ? "add" : "sub", storage, [p1, increment]);
                }
                if (tmp instanceof ssa.Pointer) {
                    b.assign(b.mem, "store", storage, [tmp.variable, tmp.offset, dest]);
                }
                break;
            }
            case "for":
            {
                let valElement: Variable;
                let val: ssa.Variable;
                let counter: ssa.Variable;
                let ptr: ssa.Variable;
                let len: ssa.Variable;
                this.processScopeVariables(b, vars, snode.scope);
                if (snode.condition && snode.condition.op == ";;" && snode.condition.lhs) {
                    this.processStatement(f, snode.scope, snode.condition.lhs, b, vars, blocks);
                } else if (snode.condition && snode.condition.op == "var_in") {
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    if (t instanceof SliceType) {
                        // TODO: Use processLeftHandSide if possible
                        // Load the slice header
                        let sliceHeader = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars, t) as ssa.Variable;
                        let sliceHeaderAddr = b.assign(b.tmp(), "addr_of", "ptr", [sliceHeader]);
                        ptr = b.assign(b.tmp(), "load", "ptr", [sliceHeaderAddr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [sliceHeaderAddr, this.sliceHeader.fieldOffset("length")]);
                        // Allocate variables
                        if (snode.condition.lhs.op == "tuple") {
                            // Initialize the counter with 0
                            let element = snode.scope.resolveElement(snode.condition.lhs.parameters[0].value) as Variable;
                            counter = vars.get(element);
                            b.assign(counter, "const", "s32", [0]);
                            valElement = snode.scope.resolveElement(snode.condition.lhs.parameters[1].value) as Variable;
                            val = vars.get(valElement);
                        } else {
                            // Initialize a counter with 0
                            counter = b.declareVar("s32", "$counter");
                            b.assign(counter, "const", "s32", [0]);
                            // Allocate memory for the variable if required
                            valElement = snode.scope.resolveElement(snode.condition.lhs.value) as Variable;
                            val = vars.get(valElement);
                        }
                    } else if (t instanceof ArrayType) {
                        throw "TODO"
                    } else {
                        throw "Implementation error"
                    }
                    // TODO map and string
                } else if (snode.condition && snode.condition.op == "in") {
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    if (t instanceof SliceType) {
                        // TODO: Use processLeftHandSide if possible
                        // Load the slice header
                        let sliceHeader = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars, t) as ssa.Variable;
                        let sliceHeaderAddr = b.assign(b.tmp(), "addr_of", "ptr", [sliceHeader]);
                        ptr = b.assign(b.tmp(), "load", "ptr", [sliceHeaderAddr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [sliceHeaderAddr, this.sliceHeader.fieldOffset("length")]);
                        if (snode.condition.lhs.op == "tuple") {
                            throw "TODO: Initialize counter";
                        } else {
                            counter = b.declareVar("s32", "$counter");
                            b.assign(counter, "const", "s32", [0]);                            
                        }
                    } else if (t instanceof ArrayType) {
                        throw "TODO"
                    } else {
                        throw "Implementation error"
                    }
                    // TODO map and string
                }
                let outer = b.block();
                let loop = b.loop();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.condition) {
                            let tmp = this.processExpression(f, snode.scope, snode.condition.condition, b, vars, this.tc.t_bool);
                            let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                            b.br_if(tmp2, outer);
                        }
                    } else if (snode.condition.op == "in") {
                        // TODO: map, runes in a string
                        let t = RestrictedType.strip(snode.condition.rhs.type);
                        if (t instanceof SliceType) {
                            let dest = this.processLeftHandExpression(f, snode.scope, snode.condition.lhs, b, vars);
                            let storage = this.getSSAType(snode.condition.lhs.type);
                            let index = b.assign(b.tmp(), "mul", "s32", [counter, ssa.sizeOf(storage)]);
                            let addr = b.assign(b.tmp(), "add", "ptr", [ptr, index]);
                            let val = b.assign(b.tmp(), "load", storage, [addr, 0]);
                            // If the left-hand expression returns an address, the resulting value must be stored in memory
                            if (dest instanceof ssa.Pointer) {
                                b.assign(b.mem, "store", storage, [dest.variable, dest.offset, val]);
                            } else {
                                b.assign(dest, "copy", storage, [val]);
                            }
                        } else {
                            throw "TODO array map and string";
                        }
                    } else if (snode.condition.op == "var_in") {
                        let t = RestrictedType.strip(snode.condition.rhs.type);
                        if (t instanceof SliceType) {
                            let storage = this.getSSAType(valElement.type);
                            let index = b.assign(b.tmp(), "mul", "s32", [counter, ssa.sizeOf(storage)]);
                            let addr = b.assign(b.tmp(), "add", "ptr", [ptr, index]);
                            b.assign(val, "load", storage, [addr, 0]);
                            let end = b.assign(b.tmp(), "eq", "s32", [len, counter]);
                            b.br_if(end, outer);
                        } else {
                            throw "TODO array map and strinf"
                        }
                    } else {
                        let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars, this.tc.t_bool);
                        let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                        b.br_if(tmp2, outer);
                    }
                }
                let body = b.block();
                for(let s of snode.statements) {
                    this.processStatement(f, snode.scope, s, b, vars, {body: body, outer: outer});
                }
                b.end();
                if (snode.condition && snode.condition.op == ";;" && snode.condition.rhs) {
                    this.processStatement(f, snode.scope, snode.condition.rhs, b, vars, blocks);
                } else if (snode.condition && snode.condition.op == "var_in") {
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    if (t instanceof SliceType) {
                        b.assign(counter, "add", "s32", [counter, 1]);
                    } else {
                        throw "TODO array map and string"
                    }
                } else if (snode.condition && snode.condition.op == "in") {
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    if (t instanceof SliceType) {
                        if (snode.condition.lhs.op == "tuple") {
                            throw "TODO: Increment counter";
                        } else {
                            b.assign(counter, "add", "s32", [counter, 1]);
                        }
                    } else {
                        throw "TODO array map and string"
                    }
                }
                b.br(loop);
                b.end();
                b.end();
                break;
            }
            case "continue":
            {
                b.br(blocks.body);
                break;
            }
            case "break":
            {
                b.br(blocks.outer);
                break;
            }
            case "return":
                if (!snode.lhs) {
                    if (f.namedReturnTypes) {
                        let args: Array<ssa.Variable | string | number> = [];
                        for(let key of f.scope.elements.keys()) {
                            let v = f.scope.elements.get(key);
                            if (v instanceof Variable && v.isResult) {
                                args.push(vars.get(v));
                            }
                        }
                        let t = this.getSSAType(f.type.returnType);
                        let tmp = b.assign(b.tmp(), "struct", t, args);
                        b.assign(null, "return", t, [tmp]);
                    } else {
                        b.assign(null, "return", null, []);
                    }
                } else {
                    let tmp = this.processExpression(f, scope, snode.lhs, b, vars, f.type.returnType);
                    b.assign(null, "return", this.getSSAType(f.type.returnType), [tmp]);
                }
                break;
            case "yield":
                b.assign(null, "yield", null, []);
                break;
            default:
                this.processExpression(f, scope, snode, b, vars, snode.type);
        }
    }

    public processLeftHandExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | ssa.Pointer {
        switch(enode.op) {
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                return vars.get(element);
            }
            case "unary*":
            {
                let t = this.tc.stripType(enode.rhs.type);
                let tmp = this.processExpression(f, scope, enode.rhs, b, vars, t);
                if (!this.disableNullCheck) {
                    let check = b.assign(b.tmp("i32"), "eqz", "addr", [tmp]);
                    b.ifBlock(check);
                    b.assign(null, "trap", null, []);
                    b.end();
                }
                return new ssa.Pointer(tmp as ssa.Variable, 0);
            }
            case "[":
            {
                let ltype = this.tc.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (ltype instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype);
                    let index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    let size = ssa.sizeOf(this.getSSAType(ltype.elementType));
                    let index2 = index;
                    if (size > 1) {
                        // TODO: If size is power of 2, shift bits
                        index2 = b.assign(b.tmp(), "mul", "i32", [index, size]);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index2]), 0);
                } else if (ltype instanceof GuardedPointerType) {
                    throw "TODO";
                } else if (ltype instanceof SliceType) {
                    let size = ssa.sizeOf(this.getSSAType(ltype.elementType));
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, ltype) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = b.assign(b.tmp(), "addr_of", "ptr", [head_addr]);
                    }
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    if (head_addr instanceof ssa.Pointer) {
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                    } else {
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [head_addr, this.sliceHeader.fieldOffset("length")]);
                    }
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    }
                    // Compare 'index' with 'len'
                    let cmp = b.assign(b.tmp(), "ge_u", "i32", [index, len]);
                    b.ifBlock(cmp);
                    b.assign(null, "trap", null, []);
                    b.end();
                    if (size != 1) {
                        if (typeof(index) == "number") {
                            index *= size;
                        } else {
                            index = b.assign(b.tmp(), "mul", "i32", [index, size]);
                        }
                    }
                    if (typeof(index) == "number") {
                        return new ssa.Pointer(data_ptr, index);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "ptr", [data_ptr, index]), 0);
                } else if (ltype == this.tc.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype);
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    }
                    let len = b.assign(b.tmp(), "load", "i32", [ptr, 0]);
                    // Compare 'index' with 'len'
                    let trap = b.assign(b.tmp(), "ge_u", "i32", [index, len]);
                    // let zero = b.assign(b.tmp(), "eqz", "addr", [ptr]);
                    // let trap = b.assign(b.tmp(), "or", "i32", [cmp, zero]);
                    b.ifBlock(trap);
                    b.assign(null, "trap", null, []);
                    b.end();
                    if (typeof(index) == "number") {
                        if (typeof(ptr) == "number") {
                            return new ssa.Pointer(b.assign(b.tmp(), "const", "ptr", [ptr + index]), 0);
                        }
                        return new ssa.Pointer(ptr, 4 + index);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "ptr", [ptr, index]), 4);
                } else if (ltype instanceof ArrayType) {
                    let size = ssa.sizeOf(this.getSSAType(ltype.elementType));
                    let ptr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype) as ssa.Variable;
                    }
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [ptr]);
                    }
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    }
                    // Compare 'index' with 'len'
                    if (typeof(index) == "number") {
                        if (index < 0 || index >= ltype.size * size) {
                            throw "Implementation error " + index + " " +ltype.size ;
                        }
                    } else {
                        let cmp = b.assign(b.tmp(), "ge_u", "i32", [index, ltype.size]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    if (typeof(index) == "number") {
                        index *= size;
                        if (ptr instanceof ssa.Pointer) {
                            ptr.offset += index;
                            return ptr;
                        }
                        return new ssa.Pointer(ptr, index);
                    }
                    if (size != 1) {
                        index = b.assign(b.tmp(), "mul", "i32", [index, size]);
                    }
                    if (ptr instanceof ssa.Pointer) {
                        return new ssa.Pointer(b.assign(b.tmp(), "add", "ptr", [ptr.variable, index]), ptr.offset);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "ptr", [ptr, index]), 0);
                } else if (ltype instanceof TupleType) {
                    let ptr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype) as ssa.Variable;
                    }
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [ptr]);
                    }
                    let t = this.getSSAType(ltype) as ssa.StructType;
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op != "int") {
                        throw "Implementation error";
                    }
                    let i = parseInt(enode.rhs.value);
                    if (i < 0 || i >= ltype.types.length) {
                        throw "Implementation error";
                    }
                    let offset = t.fieldOffset("t" + i.toString());
                    if (ptr instanceof ssa.Pointer) {
                        ptr.offset += index;
                        return ptr;
                    }
                    return new ssa.Pointer(ptr, offset);
                } else {
                    throw "TODO"; // TODO: map
                }
            }
            case ".":
            {
                let t = this.tc.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (t instanceof PointerType || t instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    if (t instanceof PointerType && !this.disableNullCheck) {
                        let check = b.assign(b.tmp("i32"), "eqz", "addr", [ptr]);
                        b.ifBlock(check);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    let elementType = t.elementType;
                    if (elementType instanceof RestrictedType) {
                        elementType = elementType.elementType;
                    }                    
                    if (elementType instanceof StructType) {
                        let s = this.getSSAType(elementType) as ssa.StructType;
                        if (ptr instanceof ssa.Variable) {
                            return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                        }
                        return b.assign(b.tmp(), "add", "ptr", [ptr, s.fieldOffset(enode.name.value)]);
                    } else {
                        throw "TODO interface and class"
                    }          
                } else if (t instanceof GuardedPointerType) {
                    throw "TODO";
                } else if (t instanceof PackageType) {
                    throw "TODO";
                } else if (t instanceof StructType) {
                    // It is a value, i.e. not a pointer to a value
                    let left: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        left = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        left = this.processExpression(f, scope, enode.lhs, b, vars, t) as ssa.Variable;
                    }
                    let s = this.getSSAType(enode.lhs.type) as ssa.StructType;
                    if (left instanceof ssa.Pointer) {
                        left.offset += s.fieldOffset(enode.name.value);
                        return left;
                    }
                    let ptr = b.assign(b.tmp(), "addr_of", "ptr", [left]);
                    return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                } else {
                    throw "CodeGen: Implementation error"
                }
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    public isLeftHandSide(node: Node): boolean {
        return !this.tc.checkIsIntermediate(node);
    }

    private createInterfaceTable(scope: Scope, s: StructType): number {
        let methods = new Map<string, number>();
        let t = new PointerType(s);
        let offset = this.interfaceTableLength;
        let minOffset = 0xffffff;
        let maxOffset = -1;
        for(let iface of this.tc.ifaces) {
            if (this.tc.checkIsAssignableType(iface, t, null, false)) {
                for(let m of iface.getAllMethods().values()) {
                    if (methods.has(m.name)) {
                        continue;
                    }
                    let index: number = -1;
                    if (this.interfaceTableIndex.has(m.name)) {
                        index = this.interfaceTableIndex.get(m.name);
                    } else {
                        index = this.interfaceTableNames.length;
                        this.interfaceTableNames.push(m.name);
                        this.interfaceTableIndex.set(m.name, index);
                    }
                    methods.set(m.name, index);
                    minOffset = Math.min(minOffset, index);
                    maxOffset = Math.max(maxOffset, index);
                }
            }
        }
        if (methods.size != 0) {
            let tableStart = offset - minOffset;
            for(let m of methods.keys()) {
                let index = methods.get(m);
                let method = s.method(m);
                let methodObjType = RestrictedType.strip(method.objectType);
                let methodName = methodObjType.name + "." + m;
                let f = scope.resolveElement(methodName);
                if (!(f instanceof Function)) {
                    throw "Implementation error";
                }
                let wf = this.funcs.get(f);
                if (wf instanceof wasm.FunctionImport) {
                    throw "Implementation error";
                }
                this.wasm.module.addFunctionToTable(wf, tableStart + index);
            }
            this.interfaceTableLength = Math.max(this.interfaceTableLength, maxOffset - minOffset + 1);
            return tableStart;
        }
        return 0;
    }                

    public processExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, targetType: Type): ssa.Variable | number {
        let v = this.processExpressionIntern(f, scope, enode, b, vars);
        if (this.tc.isInterface(targetType) && !this.tc.isInterface(enode.type)) {
            if (this.tc.isUnsafePointer(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type instanceof PointerType && enode.type.elementType instanceof StructType) {
                let index = this.createInterfaceTable(scope, enode.type.elementType);
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), v, index]);                
            } else if (this.tc.checkIsPointer(enode, false) || this.tc.isString(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), v, 0]);
            } else if (this.tc.isSlice(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderSlice, [this.typecode(enode.type), v]);
            } else if (this.tc.isGuardedPointer(enode.type)) {
                throw "TODO";
            } else if (this.tc.isArray(enode.type)) {
                // TODO: Copy to allocated area
                throw "TODO";
            } else if (this.tc.isStruct(enode.type)) {
                throw "TODO";
            } else if (enode.type == this.tc.t_int64 || enode.type == this.tc.t_uint64) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == this.tc.t_float) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderFloat, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == this.tc.t_double) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderDouble, [this.typecode(enode.type), 0, v]);
            } else if (this.tc.isNumber(enode.type) || enode.type == this.tc.t_bool) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type = this.tc.t_null) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, 0]);
            } else {
                throw "Implementation error " + enode.type.toString();
            }
        } else if (!this.tc.isInterface(targetType) && this.tc.isInterface(enode.type)) {
            let addr = b.assign(b.tmp("addr"), "addr_of", "addr", [v]);
            if (this.tc.isUnsafePointer(enode.type)) {
                return b.assign(b.tmp(), "load", "addr", [addr, this.ifaceHeader32.fieldOffset("value")]);
            } else if (this.tc.checkIsPointer(enode, false) || this.tc.isString(enode.type)) {
                return b.assign(b.tmp(), "load", "ptr", [addr, this.ifaceHeader.fieldOffset("pointer")]);
            } else if (this.tc.isSlice(enode.type)) {
                return b.assign(b.tmp(), "load", this.sliceHeader, [addr, this.ifaceHeaderSlice.fieldOffset("value")]);
            } else if (this.tc.isGuardedPointer(enode.type)) {
                throw "TODO";
            } else if (this.tc.isArray(enode.type)) {
                // TODO: Copy to allocated area
                throw "TODO";
            } else if (this.tc.isStruct(enode.type)) {
                throw "TODO";
            } else if (enode.type == this.tc.t_int64 || enode.type == this.tc.t_uint64) {
                return b.assign(b.tmp(), "load", "i64", [addr, this.ifaceHeader.fieldOffset("value")]);
            } else if (enode.type == this.tc.t_double) {
                return b.assign(b.tmp(), "load", "f64", [addr, this.ifaceHeaderDouble.fieldOffset("value")]);
            } else if (enode.type == this.tc.t_float) {
                return b.assign(b.tmp(), "load", "f32", [addr, this.ifaceHeaderFloat.fieldOffset("value")]);
            } else if (this.tc.isNumber(enode.type) || enode.type == this.tc.t_bool) {
                return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("value")]);
            } else {
                throw "Implementation error";
            }                
        }
        return v;
    }

    private processExpressionIntern(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | number {
        switch(enode.op) {
            case "null":
                return 0;
            case "int":
                return parseInt(enode.value);
            case "float":
                return parseFloat(enode.value);
            case "bool":
                return enode.value == "true" ? 1 : 0;
            case "str":
                let [off, len] = this.wasm.module.addString(enode.value);
                return off;
            case "object":
            {
                let t = this.tc.stripType(enode.type);
                if (t instanceof StructType) {
                    let st = this.getSSAType(t) as ssa.StructType; // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    let fieldValues = new Map<string, Node>();
                    if (enode.parameters) {
                        for(let p of enode.parameters) {
                            fieldValues.set(p.name.value, p.lhs);
                        }
                    }
                    for(let i = 0; i < st.fields.length; i++) {
                        if (!fieldValues.has(st.fields[i][0])) {
                            if (st.fields[i][1] instanceof ssa.StructType) {
                                // Generate a zero struct
                                args.push(this.generateZeroStruct(b, st.fields[i][1] as ssa.StructType));
                            } else {
                                args.push(0);
                            }
                        } else {
                            let p = fieldValues.get(st.fields[i][0]);
                            let v = this.processExpression(f, scope, p, b, vars, t.fields[i].type);
                            args.push(v);
                        }
                    }
                    return b.assign(b.tmp(), "struct", st, args);                
                } else if (t instanceof MapType) {
                    if (t.keyType == this.tc.t_string) {
                        let mapHeadTypeMap = this.wasm.typeMapper.mapType(this.mapHead);
                        // TODO: Reuse this type where possible
                        let entry = new ssa.StructType()
                        entry.name = "map";
                        entry.addField("hashNext", "addr")
                        entry.addField("listNext", "addr")
                        entry.addField("hash", "i64")
                        entry.addField("key", "ptr")
                        entry.addField("value", this.getSSAType(t.valueType));                        
                        let entryTypeMap = this.wasm.typeMapper.mapType(entry);
                        let m = b.call(b.tmp(), this.createMapFunctionType, [SystemCalls.createMap, mapHeadTypeMap.addr, enode.parameters ? enode.parameters.length : 4, entryTypeMap.addr]);
                        if (enode.parameters) {
                            let tuple = new ssa.StructType();
                            tuple.addField("key", "ptr")
                            tuple.addField("value", this.getSSAType(t.valueType));                            
                            for(let p of enode.parameters) {
                                let [off, len] = this.wasm.module.addString(p.name.value);
                                let value = this.processExpression(f, scope, p.lhs, b, vars, t.valueType);
                                let tupleVar = b.assign(b.tmp(), "struct", tuple, [off, value]);
                                let tupleVarAddr = b.assign(b.tmp(), "addr_of", "addr", [tupleVar]);
                                // TODO: Precompute the hash
                                let hash = b.call(b.tmp(), this.hashStringFunctionType, [SystemCalls.hashString, off]);
                                b.call(null, this.setMapFunctionType, [SystemCalls.setMap, m, hash, 1, tupleVarAddr, ssa.sizeOf(tuple)]);
                            }
                        }
                        return m;
                    } else {
                        throw "TODO"                    
                    }
                }
                throw "Implementation error";
            }
            case "tuple":
            {
                let t = this.tc.stripType(enode.type);
                let st = this.getSSAType(enode.type); // This returns a struct type
                let args: Array<string | ssa.Variable | number> = [];
                for(let i = 0; i < enode.parameters.length; i++) {
                    let v = this.processExpression(f, scope, enode.parameters[i], b, vars, (t as TupleType).types[i]);
                    args.push(v);
                }
                return b.assign(b.tmp(), "struct", st, args);                
            }
            case "array":
            {
                let t = this.tc.stripType(enode.type);
                if (t instanceof SliceType) {
                    let et = this.getSSAType(t.elementType);
                    let esize = ssa.sizeOf(et);
                    let ptr = b.assign(b.tmp("ptr"), "alloc", et, [enode.parameters.length]);
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars, t.elementType);
                        b.assign(b.mem, "store", et, [ptr, i * esize, v]);
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [ptr, enode.parameters.length, enode.parameters.length]);
                } else if (t instanceof ArrayType) {
                    let st = this.getSSAType(t); // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars, t.elementType);
                        args.push(v);
                    }
                    return b.assign(b.tmp(), "struct", st, args);
                }
                throw "Implementation error";
            }
            case "==":
                return this.processCompare("eq", f, scope, enode, b, vars);
            case "!=":
                return this.processCompare("ne", f, scope, enode, b, vars);
            case "<":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
                    return this.processCompare("lt", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("lt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("lt_u", f, scope, enode, b, vars);
            }
            case ">":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
                    return this.processCompare("gt", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("gt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("gt_u", f, scope, enode, b, vars);
            }
            case "<=":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
                    return this.processCompare("le", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("le_s", f, scope, enode, b, vars);
                }
                return this.processCompare("le_u", f, scope, enode, b, vars);
            }
            case ">=":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
                    return this.processCompare("ge", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("ge_s", f, scope, enode, b, vars);
                }
                return this.processCompare("ge_u", f, scope, enode, b, vars);
            }
            case "+":
            {
                let t = this.tc.stripType(enode.type);
                if (t == this.tc.t_string) {
                    let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                    return b.call(b.tmp(), this.concatStringFunctionType, [SystemCalls.concatString, p1, p2]);
                }
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                } else {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                }
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "add", storage, [p1, p2]);
            }
            case "*":
            case "-":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                } else {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                }
                let storage = this.getSSAType(t);
                let opcode: "mul" | "sub" = enode.op == "*" ? "mul" : "sub";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "/":
            {
                let t = this.tc.stripType(enode.type);
                let storage = this.getSSAType(t);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                if (storage == "f32" || storage == "f64") {
                    return b.assign(b.tmp(), "div", storage, [p1, p2]);
                }
                let opcode: "div_u" | "div_s" = this.isSigned(t) ? "div_s" : "div_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "%":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                let opcode: "rem_u" | "rem_s" = this.isSigned(t) ? "rem_s" : "rem_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "|":
            case "&":
            case "^":
            {
                let t = this.tc.stripType(enode.type);
                let opcode: "or" | "xor" | "and" = enode.op == "|" ? "or" : (enode.op == "&" ? "and" : "xor");
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "&^":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                let tmp = b.assign(b.tmp(), "xor", storage, [p2, -1]);
                return b.assign(b.tmp(), "and", storage, [p1, tmp]);
            }
            case "unary!":
            {
                let t = this.tc.stripType(enode.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                return b.assign(b.tmp(), "eqz", storage, [p]);
            }
            case "unary+":
            {
                let t = this.tc.stripType(enode.type);
                return this.processExpression(f, scope, enode.rhs, b, vars, t);
            }
            case "unary-":
            {
                let t = this.tc.stripType(enode.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                if (t == this.tc.t_float || t == this.tc.t_double) {
                    return b.assign(b.tmp(), "neg", storage, [p]);
                }
                let tmp = b.assign(b.tmp(), "xor", storage, [p, -1]);
                return b.assign(b.tmp(), "add", storage, [tmp, 1]);
            }
            case "unary^":
            {
                let t = this.tc.stripType(enode.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(enode.rhs.type);
                return b.assign(b.tmp(), "xor", storage, [p, -1]);
            }
            case "unary*":
            {
                let t = this.tc.stripType(enode.rhs.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                if (t instanceof UnsafePointerType) {
                    let storage = this.getSSAType(t.elementType);
                    return b.assign(b.tmp(), "load", storage, [p, 0]);
                } else if (t instanceof PointerType) {
                    let storage = this.getSSAType(t.elementType);
                    return b.assign(b.tmp(), "load", storage, [p, 0]);
                } else if (t instanceof GuardedPointerType) {
                    throw "TODO"
                }                                
                throw "Implementation error";
            }
            case "unary&":
            {
                if (enode.rhs.op == "bool" || enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "str" || enode.rhs.op == "array" || enode.rhs.op == "tuple" || enode.rhs.op == "object") {
                    // Make a copy of a literal
                    let t = this.tc.stripType(enode.rhs.type);
                    let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                    let s = this.getSSAType(t);
                    let copy = b.assign(b.tmp("ptr"), "alloc", s, [1]);
                    b.assign(b.mem, "store", s, [copy, 0, p]);
                    return copy;
                }
                let p = this.processLeftHandExpression(f, scope, enode.rhs, b, vars);
                if (p instanceof ssa.Pointer) {
                    if (p.offset == 0) {
                        return p.variable;
                    }
                    return b.assign(b.tmp(), "add", "ptr", [p.variable, p.offset]);
                }
                return b.assign(b.tmp(), "addr_of", "ptr", [p]);                
            }
            case "||":
            {
                let t = this.tc.stripType(enode.type);
                let result = b.tmp();
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                b.assign(result, "copy", "i8", [1]);
                b.elseBlock();
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                b.assign(result, "copy", "i8", [p2]);
                b.end();
                return result;
            }
            case "&&":
            {
                let t = this.tc.stripType(enode.type);
                let result = b.tmp();
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                b.assign(result, "copy", "i8", [p2]);
                b.elseBlock();
                b.assign(result, "copy", "i8", [0]);
                b.end();
                return result;
            }
            case ">>":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), this.isSigned(enode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
            }
            case "<<":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), "shl", storage, [p1, p2]);
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                return vars.get(element);
            }
            case "(":
            {
                let f: Function;
                let t: FunctionType;
                let findex: ssa.Variable;
                let args: Array<ssa.Variable | string | number> = [];
                let objPtr: ssa.Variable | ssa.Pointer | number | null = null;
                let striplhs = this.tc.stripType(enode.lhs.type);
                if (striplhs == this.tc.builtin_len) {
                    let objType = RestrictedType.strip(enode.lhs.lhs.type);
                    if (objType == this.tc.t_string) {
                        let s = this.processExpression(f, scope, enode.lhs.lhs, b, vars, this.tc.t_string);
                        return b.assign(b.tmp(), "load", "i32", [s, 0]);
                    } else if (objType instanceof SliceType) {
                        // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                        let head_addr: ssa.Variable | ssa.Pointer;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                        }
                        if (head_addr instanceof ssa.Variable) {
                           head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [head_addr]), 0);
                        }
                        return b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                    } else if (objType instanceof ArrayType) {
                        return objType.size;
                    }
                    throw "Implementation error";
                } else if (striplhs == this.tc.builtin_cap) {
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (objType instanceof SliceType) {
                        // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                        let head_addr: ssa.Variable | ssa.Pointer;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                        }
                        if (head_addr instanceof ssa.Variable) {
                           head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [head_addr]), 0);
                        }
                        return b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                    }
                    throw "Implementation error";
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "clone") {
                    // A volatile slice can be converted to a non-volatile slice by copying it.
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof SliceType)) {
                        throw "Implementation error";
                    }
                    let elementType = this.getSSAType(RestrictedType.strip(objType.elementType));
                    let size = ssa.sizeOf(elementType);
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [head_addr]), 0);
                    }
                    let data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                    let len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                    let mem = b.assign(b.tmp("ptr"), "alloc", "i8", [len]);
                    b.call(null, this.copyFunctionType, [SystemCalls.copy, mem, data_ptr, len]);
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [mem, len, len]);
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "append") {
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof SliceType)) {
                        throw "Implementation error";
                    }
                    let elementType = this.getSSAType(RestrictedType.strip(objType.elementType));
                    let size = ssa.sizeOf(elementType);
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [head_addr]), 0);
                    }
                    let data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                    let len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                    let cap = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                    if (enode.parameters.length == 1 && enode.parameters[0].op == "unary...") {
                        if (this.isLeftHandSide(enode.parameters[0].rhs)) {
                            head_addr = this.processLeftHandExpression(f, scope, enode.parameters[0].rhs, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, enode.parameters[0].rhs, b, vars, striplhs.lastParameter().type) as ssa.Variable;
                        }
                        if (head_addr instanceof ssa.Variable) {
                            head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [head_addr]), 0);
                        }
                        let b_data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                        let b_len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                        let b_cap = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                        let ft = new ssa.FunctionType(["ptr", "i32", "i32", "ptr", "i32", "i32", "i32"], this.sliceHeader, "system");
                        ft.ellipsisParam = elementType
                        return b.call(b.tmp(), ft, [SystemCalls.appendSlice, data_ptr, len, cap, b_data_ptr, b_len, b_cap, size]);
                    } else {                        
                        let add = enode.parameters.length;
                        let new_len = b.assign(b.tmp(), "add", "i32", [len, add]);
                        let cond = b.assign(b.tmp(), "gt_u", "i32", [new_len, cap]);
                        b.ifBlock(cond);
                        let ft = new ssa.FunctionType(["ptr", "i32", "i32", "i32", "i32"], this.sliceHeader, "system");
                        ft.ellipsisParam = elementType
                        let newslice = b.call(b.tmp(), ft, [SystemCalls.growSlice, data_ptr, len, cap, add, size]);
                        let newslice_addr = b.assign(b.tmp(), "addr_of", "ptr", [newslice]);
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [newslice_addr, this.sliceHeader.fieldOffset("data_ptr")]);
                        cap = b.assign(b.tmp(), "load", "i32", [newslice_addr, this.sliceHeader.fieldOffset("cap")]);
                        b.end();
                        let offset = b.assign(b.tmp(), "mul", "i32", [size, len]);
                        let new_data_ptr = b.assign(b.tmp("addr"), "add", "i32", [data_ptr, offset]);
                        for(let i = 0; i < add; i++) {
                            let p = this.processExpression(f, scope, enode.parameters[i], b, vars, objType.elementType);
                            b.assign(b.mem, "store", elementType, [new_data_ptr, i * size, p]);
                        }
                        return b.assign(b.tmp(), "struct", this.sliceHeader, [data_ptr, new_len, cap]);
                    }
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system") {
                    t = striplhs;
                } else if (enode.lhs.op == "id") {
                    // Calling a named function
                    let e = scope.resolveElement(enode.lhs.value);
                    if (!(e instanceof Function)) {
                        throw "Implementation error";
                    }
                    f = e;
                    t = f.type;
                } else if (enode.lhs.op == ".") {
                    // Calling a method
                    let ltype = this.tc.stripType(enode.lhs.lhs.type);
                    let objType: Type;
                    if (ltype instanceof PointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        objPtr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                    } else if (ltype instanceof UnsafePointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        objPtr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                    } else if (ltype instanceof GuardedPointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        throw "TODO";
                    } else if (ltype instanceof StructType) {
                        objType = ltype;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            objPtr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                            if (objPtr instanceof ssa.Variable) {
                                objPtr = b.assign(b.tmp(), "addr_of", "ptr", [objPtr]);
                            }
                        } else {
                            let value = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                            objPtr = b.assign(b.tmp(), "addr_of", "ptr", [value]);
                        }
                    } else if (ltype instanceof InterfaceType) {
                        objType = ltype;
                        let ifacePtr: ssa.Pointer;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            let p = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                            if (p instanceof ssa.Variable) {
                                ifacePtr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [p]), 0);
                            } else {
                                ifacePtr = p;
                            }
                        } else {
                            let value = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                            ifacePtr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [value]), 0);
                        }                        
                        objPtr = b.assign(b.tmp(), "load", "ptr", [ifacePtr.variable, ifacePtr.offset + this.ifaceHeader.fieldOffset("pointer")]);
                        findex = b.assign(b.tmp(), "load", "s32", [ifacePtr.variable, ifacePtr.offset + this.ifaceHeader.fieldOffset("value")]);
                    } else {
                        throw "Implementation error"
                    }
                    if (objType instanceof StructType) {
                        let method = objType.method(enode.lhs.name.value);
                        let methodObjType = RestrictedType.strip(method.objectType);
                        let methodName = methodObjType.name + "." + enode.lhs.name.value;
                        let e = scope.resolveElement(methodName);
                        if (!(e instanceof Function)) {
                            throw "Implementation error";
                        }
                        f = e;
                        t = f.type;
                    } else if (objType instanceof InterfaceType) {
                        let name = enode.lhs.name.value;
                        let method = objType.method(name);
                        t = method;
                        let findex2 = this.interfaceTableIndex.get(name);
                        if (findex2 != 0) {
                            findex = b.assign(b.tmp(), "add", "s32", [findex, findex2]);
                        }
                    } else {
                        throw "Implementation error";
                    }
                } else {
                    // Calling a lamdba function
                    t = enode.lhs.type as FunctionType;
                }
                
                if (f) {
                    args.push(this.funcs.get(f).index);
                } else if (findex) {
                    args.push(findex);
                } else if (t.callingConvention == "system") {
                    args.push(t.systemCallType);
                }
                if (objPtr !== null) {
                    // Add 'this' to the arguments
                    if (objPtr instanceof ssa.Pointer) {
                        args.push(b.assign(b.tmp("ptr"), "add", "i32", [objPtr.variable, objPtr.offset]));
                    } else {
                        args.push(objPtr);
                    }
                }
                if (t.hasEllipsis() && (enode.parameters.length != t.parameters.length || enode.parameters[enode.parameters.length - 1].op != "unary...")) {
                    // TODO: If the last parameter is volatile, the alloc is not necessary.
                    let elementType = this.getSSAType((t.lastParameter().type as SliceType).elementType);
                    let normalParametersCount = t.parameters.length - 1 - (t.objectType ? 1 : 0);
                    for(let i = 0; i < normalParametersCount; i++) {
                        args.push(this.processExpression(f, scope, enode.parameters[i], b, vars, t.parameters[i].type));
                    }
                    let mem = b.assign(b.tmp("ptr"), "alloc", elementType, [enode.parameters.length - normalParametersCount]);
                    let offset = 0;
                    let elementSize = ssa.sizeOf(elementType);
                    for(let i = normalParametersCount; i < enode.parameters.length; i++, offset += elementSize) {
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars, (t.lastParameter().type as SliceType).elementType);
                        b.assign(b.mem, "store", elementType, [mem, offset, v]);
                    }
                    args.push(b.assign(b.tmp(), "struct", this.sliceHeader, [mem, enode.parameters.length - normalParametersCount, enode.parameters.length - normalParametersCount]));
                } else if (enode.parameters) {
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let pnode = enode.parameters[i];
                        args.push(this.processExpression(f, scope, pnode.op == "unary..." ? pnode.rhs : pnode, b, vars, t.parameters[i].type));
                    }
                }
                
                if (f) {
                    let ft = this.getSSAFunctionType(t);
                    return b.call(b.tmp(), ft, args);
                } else if (findex) {
                    let ft = this.getSSAFunctionType(t);
                    return b.callIndirect(b.tmp(), ft, args);
                } else if (t.callingConvention == "system") {
                    let ft = this.getSSAFunctionType(t);
                    return b.call(b.tmp(), ft, args);
                }
                throw "TODO: call a lambda function"
            }
            case ":":
            {
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                let index1: ssa.Variable | number = 0;
                if (enode.parameters[0]) {
                    if (enode.parameters[0].op == "int") {
                        index1 = parseInt(enode.parameters[0].value);
                    } else {
                        index1 = this.processExpression(f, scope, enode.parameters[0], b, vars, this.tc.t_int);
                    }
                }
                let index2: ssa.Variable | number = 0;
                if (enode.parameters[1]) {
                    if (enode.parameters[1].op == "int") {
                        index2 = parseInt(enode.parameters[1].value);
                    } else {
                        index2 = this.processExpression(f, scope, enode.parameters[1], b, vars, this.tc.t_int);
                    }
                }
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof UnsafePointerType) {
                    let size = ssa.sizeOf(this.getSSAType(t.elementType));
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;  
                    } else {
                        l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    }
                    if (index1 != 0) {
                        if (size != 1) {
                            if (typeof(index1) == "number") {
                                ptr = b.assign(b.tmp("ptr"), "add", "i32", [ptr, index1 * size]);
                            } else {
                                let tmp = b.assign(b.tmp(), "mul", "i32", [index1, size]);
                                ptr = b.assign(b.tmp("ptr"), "add", "i32", [ptr, tmp]);
                            }
                        } else {
                            ptr = b.assign(b.tmp("ptr"), "add", "i32", [ptr, index1]);
                        }
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [ptr, l, l]);
                } else if (t instanceof GuardedPointerType) {
                    throw "TODO";
                } else if (t instanceof SliceType) {
                    let size = ssa.sizeOf(this.getSSAType(t.elementType));
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, t) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = b.assign(b.tmp(), "addr_of", "ptr", [head_addr]);
                    }
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    let cap: ssa.Variable;
                    if (head_addr instanceof ssa.Pointer) {
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                        cap = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                    } else {
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [head_addr, this.sliceHeader.fieldOffset("length")]);
                        cap = b.assign(b.tmp(), "load", "i32", [head_addr, this.sliceHeader.fieldOffset("cap")]);
                    }
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i32", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;  
                    } else {
                        l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    }
                    let c = b.assign(b.tmp(), "sub", "i32", [len, index1]);
                    if (index1 != 0) {
                        if (size != 1) {
                            if (typeof(index1) == "number") {
                                data_ptr = b.assign(b.tmp("ptr"), "add", "i32", [data_ptr, index1 * size]);
                            } else {
                                let tmp = b.assign(b.tmp(), "mul", "i32", [index1, size]);
                                data_ptr = b.assign(b.tmp("ptr"), "add", "i32", [data_ptr, tmp]);
                            }
                        } else {
                            data_ptr = b.assign(b.tmp("ptr"), "add", "i32", [data_ptr, index1]);
                        }
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [data_ptr, l, c]);
                } else if (t == this.tc.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, this.tc.t_string);
                    let len = b.assign(b.tmp(), "load", "i32", [ptr, 0]);
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i32", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    let ptr3: ssa.Variable | number;
                    if (typeof(index1) == "number") {
                        ptr3 = b.assign(b.tmp(), "add", "ptr", [ptr, 4 + index1]);
                    } else {
                        let ptr2 = b.assign(b.tmp(), "add", "ptr", [ptr, 4]);
                        ptr3 = b.assign(b.tmp(), "add", "ptr", [ptr2, index1]);
                    }
                    let l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    return b.call(b.tmp(), this.makeStringFunctionType, [SystemCalls.makeString, ptr3, l]);
                } else if (t instanceof ArrayType) {
                    let ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    let len = t.size;
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i32", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    let ptr2: ssa.Pointer;
                    if (ptr instanceof ssa.Variable) {
                        ptr2 = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [ptr]), 0);
                    } else {
                        ptr2 = ptr;
                    }
                    let ptr3: ssa.Variable;
                    if (typeof(index1) == "number") {
                        if (index1 != 0 || ptr2.offset != 0) {
                            ptr3 = b.assign(b.tmp("ptr"), "add", "i32", [ptr2.variable, ptr2.offset + index1]);
                        } else {
                            ptr3 = ptr2.variable;
                        }
                    } else {
                        let tmp = ptr2.variable;
                        if (ptr2.offset != 0 ) {
                            tmp = b.assign(b.tmp("ptr"), "add", "i32", [ptr2.variable, ptr2.offset]);
                        }
                        ptr3 = b.assign(b.tmp("ptr"), "add", "i32", [tmp, index1]);
                    }
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;  
                    } else {
                        l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    }
                    let cap: ssa.Variable | number;
                    if (typeof(index1) == "number") {
                        cap = len - index1;
                    } else {
                        cap = b.assign(b.tmp(), "sub", "i32", [len, index1]);
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [ptr3, l, cap]);
                } else {
                    throw "Implementation error";
                }                
            }
            case "[":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof MapType) {
                    let keyType = this.tc.stripType(t.keyType);
                    let m = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let key = this.processExpression(f, scope, enode.rhs, b, vars, keyType);
                    let hash = b.call(b.tmp(), this.hashStringFunctionType, [SystemCalls.hashString, key]);
                    // TODO: Precompute the hash
                    let result = b.call(b.tmp(), this.lookupMapFunctionType, [SystemCalls.lookupMap, m, hash, 1, key]);
                    let check = b.assign(b.tmp("i32"), "eqz", "addr", [result]);
                    b.ifBlock(check);
                    b.assign(null, "trap", null, []);
                    b.end();
                    let tuple = new ssa.StructType();
                    tuple.addField("key", "ptr")
                    tuple.addField("value", this.getSSAType(t.valueType));                            
                    return b.assign(b.tmp(), "load", this.getSSAType(this.tc.stripType(enode.type)), [result, tuple.fieldOffset("value")]);
                }
                // Note: processLeftHandExpression implements the non-left-hand cases as well.
                let ptr = this.processLeftHandExpression(f, scope, enode, b, vars) as ssa.Pointer;
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "load", storage, [ptr.variable, ptr.offset]);
            }
            case ".":
            {
                // Note: processLeftHandExpression implements the non-left-hand cases as well.
                let expr = this.processLeftHandExpression(f, scope, enode, b, vars) as ssa.Pointer;
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "load", storage, [expr.variable, expr.offset]);
            }
            case "typeCast":
            {
                let t = enode.type;
                let t2 = this.tc.stripType(enode.rhs.type);
                let expr = this.processExpression(f, scope, enode.rhs, b, vars, t2);
                let s = this.getSSAType(t);
                let s2 = this.getSSAType(enode.rhs.type);
                if (this.tc.isIntNumber(t) && t2 instanceof UnsafePointerType) {
                    // Convert pointer to integer
                    if (ssa.sizeOf(s) == ssa.sizeOf(s2)) {
                        return expr;
                    } else if (ssa.sizeOf(s) < ssa.sizeOf(s2)) {
                        if (ssa.sizeOf(s2) == 8) {
                            return b.assign(b.tmp(), "wrap", s2, [expr]);
                        }
                        return expr;
                    }
                    if (ssa.sizeOf(s) == 8) {
                        return b.assign(b.tmp(), "extend", s2, [expr]);
                    }
                    return expr;
                } else if (this.tc.checkIsIntNumber(enode.rhs, false) && t instanceof UnsafePointerType) {
                    // Convert integer to pointer
                    if (ssa.sizeOf(s) == ssa.sizeOf(s2)) {
                        return expr;
                    } else if (ssa.sizeOf(s) < ssa.sizeOf(s2)) {
                        if (ssa.sizeOf(s2) == 8) {
                            return b.assign(b.tmp(), "wrap", s2, [expr]);
                        }
                        return expr;
                    }
                    if (ssa.sizeOf(s) == 8) {
                        return b.assign(b.tmp(), "extend", s2, [expr]);
                    }
                    return expr;
                } else if (t instanceof UnsafePointerType && (t2 instanceof UnsafePointerType || t2 instanceof PointerType || t2 == this.tc.t_string)) {
                    // Convert pointer or string to unsafe pointer
                    return expr;
                } else if (t == this.tc.t_string && t2 instanceof UnsafePointerType) {
                    // Convert unsafe pointer to string
                    return expr;
                } else if (t == this.tc.t_string && t2 instanceof SliceType) {
                    let head = b.assign(b.tmp(), "addr_of", "addr", [expr]);
                    let ptr = b.assign(b.tmp(), "load", "addr", [head, this.sliceHeader.fieldOffset("data_ptr")]);
                    let l = b.assign(b.tmp(), "load", "i32", [head, this.sliceHeader.fieldOffset("length")]);
                    return b.call(b.tmp(), this.makeStringFunctionType, [SystemCalls.makeString, ptr, l]);
                } else if ((t == this.tc.t_bool || this.tc.isIntNumber(t)) && (t2 == this.tc.t_bool || this.tc.checkIsIntNumber(enode.rhs, false))) {
                    // Convert between integers
                    if (ssa.sizeOf(s) == ssa.sizeOf(s2)) {
                        return expr;
                    } else if (ssa.sizeOf(s) < ssa.sizeOf(s2)) {
                        if (ssa.sizeOf(s2) == 8) {
                            return b.assign(b.tmp(), "wrap", s2, [expr]);
                        }
                        return expr;
                    }
                    if (ssa.sizeOf(s) == 8) {
                        return b.assign(b.tmp(), "extend", s2, [expr]);
                    }
                    return expr;
                } else if (t instanceof PointerType && t2 instanceof UnsafePointerType) {
                    return expr;
                } else if (t instanceof SliceType && t.elementType == this.tc.t_byte && t2 == this.tc.t_string) {
                    let l = b.assign(b.tmp(), "load", "i32", [expr]);
                    let src = b.assign(b.tmp("addr"), "add", "i32", [expr, 4]);
                    let mem = b.assign(b.tmp("ptr"), "alloc", "i8", [l]);
                    b.call(null, this.copyFunctionType, [SystemCalls.copy, mem, src, l]);
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [mem, l, l]);
                } else {
                    throw "TODO: conversion not implemented";
                }
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    private processCompare(opcode: ssa.NodeKind, f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable {
        let t = this.tc.stripType(enode.lhs.type);
        let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
        let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
        if (t == this.tc.t_string) {
            let cmp = b.call(b.tmp(), this.compareStringFunctionType, [SystemCalls.compareString, p1, p2]);
            switch(opcode) {
                case "eq":
                    return b.assign(b.tmp(), "eqz", "i32", [cmp]);
                case "ne":
                    return b.assign(b.tmp(), "ne", "i32", [cmp, 0]);
                case "lt":
                    return b.assign(b.tmp(), "lt_s", "i32", [cmp, 0]);
                case "le":
                    return b.assign(b.tmp(), "le_s", "i32", [cmp, 0]);
                case "gt":
                    return b.assign(b.tmp(), "gt_s", "i32", [cmp, 0]);
                case "ge":
                    return b.assign(b.tmp(), "ge_s", "i32", [cmp, 0]);
            }
            throw "Implementation error " + opcode;
        } else {
            let storage = this.getSSAType(t);
            if (p1 === 0 && opcode == "eq" && storage != "f32" && storage != "f64") {
                return b.assign(b.tmp(), "eqz", storage, [p2]);
            }
            if (p2 === 0 && opcode == "eq" && storage != "f32" && storage != "f64") {
                return b.assign(b.tmp(), "eqz", storage, [p1]);
            }
            return b.assign(b.tmp(), opcode, storage, [p1, p2]);
        }
    }

    public isSigned(t: Type): boolean {
        t = this.tc.stripType(t);
        if (t == this.tc.t_int8 || t == this.tc.t_int16 || t == this.tc.t_int32 || t == this.tc.t_int64 || t == this.tc.t_float || t == this.tc.t_double) {
            return true;
        }
        if (t == this.tc.t_uint8 || t == this.tc.t_uint16 || t == this.tc.t_uint32 || t == this.tc.t_uint64) {
            return false;
        }
        if (this.tc.isUnsafePointer(t)) {
            return true;
        }
        throw "CodeGen: Implementation error: signed check on non number type " + t.toString();       
    }

    private generateZeroStruct(b: ssa.Builder, st: ssa.StructType): ssa.Variable {
        let args = [];
        for(let f of st.fields) {
            if (f[1] instanceof ssa.StructType) {
                args.push(this.generateZeroStruct(b, f[1] as ssa.StructType));
            } else {
                args.push(0);
            }
        }
        return b.assign(b.tmp(), "struct", st, args);
    }

    private typecode(t: Type): number {
        // TODO
        return 0;
    }

    private optimizer: ssa.Optimizer;
    private wasm: ssa.Wasm32Backend;
    private tc: TypeChecker;
    private imports: Map<string, wasm.FunctionImport>;
    private funcs: Map<Function, wasm.Function | wasm.FunctionImport> = new Map<Function, wasm.Function | wasm.FunctionImport>();
    private globalVars = new Map<ScopeElement, ssa.Variable>();
    private sliceHeader: ssa.StructType;
    private ifaceHeader: ssa.StructType;
    private ifaceHeader32: ssa.StructType;
    private ifaceHeaderFloat: ssa.StructType;
    private ifaceHeaderDouble: ssa.StructType;
    private ifaceHeaderSlice: ssa.StructType;
    private mapHead: ssa.StructType;
    private emitIR: boolean;
    private emitNoWasm: boolean;
    private emitFunction: string | null;
    private disableNullCheck: boolean;
    private concatStringFunctionType: ssa.FunctionType;
    private compareStringFunctionType: ssa.FunctionType;
    private makeStringFunctionType: ssa.FunctionType;
    private createMapFunctionType: ssa.FunctionType;
    private setMapFunctionType: ssa.FunctionType;
    private hashStringFunctionType: ssa.FunctionType;
    private lookupMapFunctionType: ssa.FunctionType;
    private removeMapKeyFunctionType: ssa.FunctionType;
    private copyFunctionType: ssa.FunctionType;
    private interfaceTableNames: Array<string> = [];
    private interfaceTableIndex: Map<string, number> = new Map<string, number>();
    private interfaceTableLength: number = 0;
}

export class LinkError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}