import {Node, NodeOp} from "./ast"
import {Function, Type, ObjectLiteralType, TupleLiteralType, ArrayLiteralType, StructType, GuardedPointerType, UnsafePointerType, PointerType, FunctionType, ArrayType, SliceType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement, StorageLocation} from "./typecheck"
import * as ssa from "./ssa"
import * as wasm from "./wasm"

export class CodeGenerator {
    constructor(tc: TypeChecker, emitIR: boolean, emitNoWasm: boolean, emitFunction: string) {
        this.tc = tc;
        this.emitIR = emitIR;
        this.emitNoWasm = emitNoWasm;
        this.emitFunction = emitFunction;
        this.imports = new Map<string, wasm.FunctionImport>();
        this.wasm = new ssa.Wasm32Backend(emitIR, emitFunction);
        this.wasm.module.importMemory("imports", "mem");
        this.sliceHeader = new ssa.StructType();
        this.sliceHeader.name = "slice";
        this.sliceHeader.addField("data_ptr", "ptr");
        this.sliceHeader.addField("length", "i32");
        this.sliceHeader.addField("cap", "i32");
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

        // Declare all functions and global variables
        let scope = mnode.scope;
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isImported) {
                    throw "Implementation error";
                }
                let wf = this.wasm.declareFunction(e.name);
                this.funcs.set(e, wf);
                if (e.name == this.stringConcatFunctionName) {
                    this.stringConcatFunction = e;
                }
            } else if (e instanceof Variable) {
                let g = this.wasm.declareGlobalVar(e.name, this.getSSAType(e.type));
                g.noGarbageCollection = true;
                this.globalVars.set(e, g);
            } else {
                throw "CodeGen: Implementation Error " + e;
            }
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
                if (e.node.rhs) {
                    throw "TODO: Initializer";
                }
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

    private getSSAType(t: Type): ssa.Type | ssa.StructType {
        if (t == this.tc.t_bool || t == this.tc.t_uint8 || t == this.tc.t_byte) {
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
        if (t instanceof StructType) {
            let s = new ssa.StructType();
            s.name = t.name;
            for(let f of t.fields) {
                s.addField(f.name, this.getSSAType(f.type), 1);
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
        throw "CodeGen: Implementation error: The type does not fit in a register " + t.toString();
    }

    private getSSAFunctionType(t: FunctionType): ssa.FunctionType {
        let ftype = new ssa.FunctionType([], null, t.callingConvention);
        for(let p of t.parameters) {
            ftype.params.push(this.getSSAType(p.type));
        }
        if (t.returnType != this.tc.t_void) {
            ftype.result = this.getSSAType(t.returnType);
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
                v.noGarbageCollection = true;
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
                    v.noGarbageCollection = true;
                    vars.set(e, v);                    
                }
            }
        } else if (f.type.returnType != this.tc.t_void) {
            let v = b.declareResult(this.getSSAType(f.type.returnType), "$return");
            v.noGarbageCollection = true;
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
                } else if (e.isConst) {
                    // Create a SSA that can be assigned only once
                    let v = b.tmp();
                    v.type = e.heapAlloc ? "ptr" : this.getSSAType(e.type);
                    vars.set(e, v);
                } else {
                    // Create a variable that can be assigned multiple times
                    let v = b.declareVar(e.heapAlloc ? "ptr" : this.getSSAType(e.type), name);
                    if (!e.heapAlloc) {
                        v.noGarbageCollection = true;
                    }
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
                let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars);
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
            case "var":
            {
                if (snode.rhs) { // Assignment of an expression value?
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value) as Variable;
                        let v = vars.get(element);
                        if (element.heapAlloc) {
                            let storage = this.getSSAType(element.type);
                            b.assign(v, "alloc", storage, [ssa.sizeOf(storage)]);
                            let tmp = this.processExpression(f, scope, snode.rhs, b, vars);
                            b.assign(b.mem, "store", storage, [v, 0, tmp]);
                        } else {
                            let tmp = this.processExpression(f, scope, snode.rhs, b, vars);
                            b.assign(v, "copy", v.type, [tmp]);
                        }
                    } else if (snode.lhs.op == "tuple") {
                        throw "TODO"
                    } else if (snode.lhs.op == "array") {
                        throw "TODO"                        
                    } else if (snode.lhs.op == "object") {
                        throw "TODO"                        
                    } else {
                        throw "Impl error"
                    }
                } else { // Assignment of initial value (all zero)
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value) as Variable;
                        let v = vars.get(element);
                        if (element.heapAlloc) {
                            let storage = this.getSSAType(element.type);
                            b.assign(v, "alloc", storage, [ssa.sizeOf(storage)]);
                        }
                        // Nothing else todo here, handled by decl_var.
                    } else {
                        throw "TODO"; // TODO: Can this happen at all?
                    }
                }
                return;
            }
            case "=":
            {
                if (snode.lhs.op == "tuple") {
                    throw "TODO"
                } else if (snode.lhs.op == "array") {
                    throw "TODO"                        
                } else if (snode.lhs.op == "object") {
                    throw "TODO"                        
                } else {
                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                    let tmp = this.processExpression(f, scope, snode.rhs, b, vars);
                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                    if (dest instanceof ssa.Pointer) {
                        b.assign(b.mem, "store", this.getSSAType(snode.rhs.type), [dest.variable, dest.offset, tmp]);
                    } else {
                        b.assign(dest, "copy", this.getSSAType(snode.rhs.type), [tmp]);
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
                let p2 = this.processExpression(f, scope, snode.rhs, b, vars);
                if (snode.lhs.type == this.tc.t_string) {
                    // String concatenation
                    if (!this.stringConcatFunction) {
                        throw "Missing string concat function in runtime";
                    }
                    let wf = this.funcs.get(this.stringConcatFunction);
                    b.call(dest, this.getSSAFunctionType(this.stringConcatFunction.type), [wf.index, p1, p2]);
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
                if (snode.lhs.type instanceof GuardedPointerType) {
                    throw "TODO"
                } else {
                    let increment = 1;
                    if (snode.lhs.type instanceof UnsafePointerType) {
                        increment = ssa.sizeOf(this.getSSAType(snode.lhs.type.elementType));
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
                } else if (snode.condition && (snode.condition.op == "var_in" || snode.condition.op == "const_in")) {
                    if (snode.condition.rhs.type instanceof SliceType) {
                        // TODO: Use processLeftHandSide if possible
                        // Load the slice header
                        let sliceHeader = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars) as ssa.Variable;
                        let sliceHeaderAddr = b.assign(b.tmp(), "addr_of", "ptr", [sliceHeader]);
                        ptr = b.assign(b.tmp(), "load", "ptr", [sliceHeaderAddr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [sliceHeaderAddr, this.sliceHeader.fieldOffset("length")]);
                        // Allocate variables
                        if (snode.condition.lhs.op == "tuple") {
                            // Initialize the counter with 0
                            let element = snode.scope.resolveElement(snode.condition.lhs.parameters[0].value) as Variable;
                            counter = vars.get(element);
                            if (element.heapAlloc) {
                                let storage = this.getSSAType(element.type);
                                b.assign(counter, "alloc", storage, [ssa.sizeOf(storage)]);
                                b.assign(b.mem, "store", "s32", [counter, 0, 0]);
                            } else {
                                b.assign(counter, "const", "s32", [0]);
                            }
                            // Allocate memory for the variable if required
                            valElement = snode.scope.resolveElement(snode.condition.lhs.parameters[1].value) as Variable;
                            val = vars.get(valElement);
                            if (valElement.heapAlloc) {
                                let storage = this.getSSAType(valElement.type);
                                b.assign(val, "alloc", storage, [ssa.sizeOf(storage)]);
                            }
                        } else {
                            // Initialize a counter with 0
                            counter = b.declareVar("s32", "$counter");
                            b.assign(counter, "const", "s32", [0]);
                            // Allocate memory for the variable if required
                            valElement = snode.scope.resolveElement(snode.condition.lhs.value) as Variable;
                            val = vars.get(valElement);
                            if (valElement.heapAlloc) {
                                let storage = this.getSSAType(valElement.type);
                                b.assign(val, "alloc", storage, [ssa.sizeOf(storage)]);
                            }
                        }
                    } else {
                        throw "TODO"
                    }
                } else if (snode.condition && snode.condition.op == "in") {
                    if (snode.condition.rhs.type instanceof SliceType) {
                        // TODO: Use processLeftHandSide if possible
                        // Load the slice header
                        let sliceHeader = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars) as ssa.Variable;
                        let sliceHeaderAddr = b.assign(b.tmp(), "addr_of", "ptr", [sliceHeader]);
                        ptr = b.assign(b.tmp(), "load", "ptr", [sliceHeaderAddr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [sliceHeaderAddr, this.sliceHeader.fieldOffset("length")]);
                        if (snode.condition.lhs.op == "tuple") {
                            throw "TODO: Initialize counter";
                        } else {
                            counter = b.declareVar("s32", "$counter");
                            b.assign(counter, "const", "s32", [0]);                            
                        }
                    } else {
                        throw "TODO"
                    }
                }
                let outer = b.block();
                let loop = b.loop();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.condition) {
                            let tmp = this.processExpression(f, snode.scope, snode.condition.condition, b, vars);
                            let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                            b.br_if(tmp2, outer);
                        }
                    } else if (snode.condition.op == "in") {
                        // TODO: map, runes in a string
                        if (snode.condition.rhs.type instanceof SliceType) {
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
                            throw "TODO";
                        }
                    } else if (snode.condition.op == "var_in" || snode.condition.op == "const_in") {
                        if (snode.condition.rhs.type instanceof SliceType) {
                            let storage = this.getSSAType(valElement.type);
                            let index = b.assign(b.tmp(), "mul", "s32", [counter, ssa.sizeOf(storage)]);
                            let addr = b.assign(b.tmp(), "add", "ptr", [ptr, index]);
                            if (valElement.heapAlloc) {
                                let tmp = b.assign(b.tmp(), "load", storage, [addr, 0]);
                                b.assign(b.mem, "store", storage, [val, 0, tmp]);
                            } else {
                                b.assign(val, "load", storage, [addr, 0]);
                            }
                            let end = b.assign(b.tmp(), "eq", "s32", [len, counter]);
                            b.br_if(end, outer);
                        } else {
                            throw "TODO"
                        }
                    } else {
                        let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars);
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
                } else if (snode.condition && (snode.condition.op == "var_in" || snode.condition.op == "const_in")) {
                    if (snode.condition.rhs.type instanceof SliceType) {
                        b.assign(counter, "add", "s32", [counter, 1]);
                    } else {
                        throw "TODO"
                    }
                } else if (snode.condition && snode.condition.op == "in") {
                    if (snode.condition.rhs.type instanceof SliceType) {
                        if (snode.condition.lhs.op == "tuple") {
                            throw "TODO: Increment counter";
                        } else {
                            b.assign(counter, "add", "s32", [counter, 1]);
                        }
                    } else {
                        throw "TODO"
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
                    let tmp = this.processExpression(f, scope, snode.lhs, b, vars);
                    b.assign(null, "return", this.getSSAType(snode.lhs.type), [tmp]);
                }
                break;
            case "yield":
                b.assign(null, "yield", null, []);
                break;
            default:
                this.processExpression(f, scope, snode, b, vars);
        }
    }

    public processLeftHandExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | ssa.Pointer {
        switch(enode.op) {
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                if (element instanceof Variable && element.heapAlloc) {
                    return new ssa.Pointer(vars.get(element), 0);
                }
                return vars.get(element);
            }
            case "unary*":
                let tmp = this.processExpression(f, scope, enode.rhs, b, vars);
                return new ssa.Pointer(tmp as ssa.Variable, 0);
            case "[":
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (enode.lhs.type instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars);
                    let index = this.processExpression(f, scope, enode.rhs, b, vars);
                    let size = ssa.sizeOf(this.getSSAType(enode.lhs.type.elementType));
                    let index2 = index;
                    if (size > 1) {
                        // TODO: If size is power of 2, shift bits
                        index2 = b.assign(b.tmp(), "mul", "i32", [index, size]);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index2]), 0);
                } else if (enode.lhs.type instanceof GuardedPointerType) {
                    throw "TODO";
                } else if (enode.lhs.type instanceof SliceType) {
                    // TODO: Perhaps in some cases there is no need for "ptr"
                    let size = ssa.sizeOf(this.getSSAType(enode.lhs.type.elementType));
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        let head = this.processExpression(f, scope, enode.lhs, b, vars);
                        head_addr = b.assign(b.tmp(), "addr_of", "ptr", [head]);
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
                    let t = this.getSSAType(enode.lhs.type);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars);
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
                } else if (enode.lhs.type == this.tc.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars);
                    let t = this.getSSAType(enode.lhs.type);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars);
                    }
                    let len = b.assign(b.tmp(), "load", "i32", [ptr, 0]);
                    // Compare 'index' with 'len'
                    let cmp = b.assign(b.tmp(), "ge_u", "i32", [index, len]);
                    let zero = b.assign(b.tmp(), "eqz", "addr", [ptr]);
                    let trap = b.assign(b.tmp(), "or", "i32", [cmp, zero]);
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
                } else if (enode.lhs.type instanceof ArrayType) {
                    let size = ssa.sizeOf(this.getSSAType(enode.lhs.type.elementType));
                    let ptr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        let arr = this.processExpression(f, scope, enode.lhs, b, vars);
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [arr]);
                    }
                    let t = this.getSSAType(enode.lhs.type);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars);
                    }
                    // Compare 'index' with 'len'
                    if (typeof(index) == "number") {
                        if (index < 0 || index >= enode.lhs.type.size * size) {
                            throw "Implementation error " + index + " " +enode.lhs.type.size ;
                        }
                    } else {
                        let cmp = b.assign(b.tmp(), "ge_u", "i32", [index, enode.lhs.type.size]);
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
                } else if (enode.lhs.type instanceof TupleType) {
                    let ptr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        let arr = this.processExpression(f, scope, enode.lhs, b, vars);
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [arr]);
                    }
                    let t = this.getSSAType(enode.lhs.type) as ssa.StructType;
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op != "int") {
                        throw "Implementation error";
                    }
                    let i = parseInt(enode.rhs.value);
                    if (i < 0 || i >= enode.lhs.type.types.length) {
                        throw "Implementation error";
                    }
                    let offset = t.fieldOffset("t" + i.toString());
                    if (ptr instanceof ssa.Pointer) {
                        ptr.offset += index;
                        return ptr;
                    }
                    return new ssa.Pointer(ptr, offset);
                } else if (enode.lhs.type == this.tc.t_json) {
                    throw "TODO";
                } else {
                    throw "TODO"; // TODO: map
                }
            case ".":
            {
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (enode.lhs.type instanceof PointerType || enode.lhs.type instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars);
                    if (enode.lhs.type.elementType instanceof StructType) {
                        let s = this.getSSAType(enode.lhs.type.elementType) as ssa.StructType;
                        if (ptr instanceof ssa.Variable) {
                            return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                        }
                        // ptr is a number. Hence we use "addr" instead of "ptr" because it must be an UnsafePointerType
                        return b.assign(b.tmp(), "add", "addr", [ptr, s.fieldOffset(enode.name.value)]);
                    } else {
                        throw "TODO interface and class"
                    }          
                } else if (enode.lhs.type instanceof GuardedPointerType) {
                    throw "TODO";
                } else {
                    let left: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        left = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        left = this.processExpression(f, scope, enode.lhs, b, vars) as ssa.Variable;
                    }
                    if (enode.lhs.type instanceof StructType) {
                        let s = this.getSSAType(enode.lhs.type) as ssa.StructType;
                        if (left instanceof ssa.Pointer) {
                            left.offset += s.fieldOffset(enode.name.value);
                            return left;
                        }
                        // ptr is a value type. Hence we use "addr" instead of "ptr" because the value must be somewhere on heapStack
                        // where the GC can find it.
                        let ptr = b.assign(b.tmp(), "addr_of", "addr", [left]);
                        return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                    } else {
                        throw "Implementation error"
                    }
                }
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    public isLeftHandSide(node: Node): boolean {
        return this.tc.checkIsLeftHandSide(node, true);
//        return (enode.op == "[" || enode.op == "." || enode.op == "id" || enode.op == "unary*");
    }

    public processExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | number {
        switch(enode.op) {
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
                if (enode.type instanceof StructType) {
                    let st = this.getSSAType(enode.type) as ssa.StructType; // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    let fieldValues = new Map<string, Node>();
                    for(let p of enode.parameters) {
                        fieldValues.set(p.name.value, p.lhs);
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
                            let v = this.processExpression(f, scope, p, b, vars);
                            args.push(v);
                        }
                    }
                    return b.assign(b.tmp(), "struct", st, args);                
                }
                throw "TODO";
            }
            case "tuple":
            {
                let st = this.getSSAType(enode.type); // This returns a struct type
                let args: Array<string | ssa.Variable | number> = [];
                for(let i = 0; i < enode.parameters.length; i++) {
                    let v = this.processExpression(f, scope, enode.parameters[i], b, vars);
                    args.push(v);
                }
                return b.assign(b.tmp(), "struct", st, args);                
            }
            case "array":
            {
                if (enode.type instanceof SliceType) {
                    let et = this.getSSAType(enode.type.elementType);
                    let esize = ssa.sizeOf(et);
                    let ptr = b.assign(b.tmp("ptr"), "alloc", et, [enode.parameters.length * esize]);
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars);
                        b.assign(b.mem, "store", et, [ptr, i * esize, v]);
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [ptr, enode.parameters.length, enode.parameters.length]);
                } else if (enode.type instanceof ArrayType) {
                    let st = this.getSSAType(enode.type); // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars);
                        args.push(v);
                    }
                    return b.assign(b.tmp(), "struct", st, args);
                } else if (enode.type == this.tc.t_json) {
                    throw "TODO";
                }
                throw "Implementation error";
            }
            case "==":
                return this.processCompare("eq", f, scope, enode, b, vars);
            case "!=":
                return this.processCompare("ne", f, scope, enode, b, vars);
            case "<":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    return this.processCompare("lt", f, scope, enode, b, vars);
                }
                if (this.isSigned(enode.lhs.type)) {
                    return this.processCompare("lt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("lt_u", f, scope, enode, b, vars);
            case ">":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    return this.processCompare("gt", f, scope, enode, b, vars);
                }
                if (this.isSigned(enode.lhs.type)) {
                    return this.processCompare("gt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("gt_u", f, scope, enode, b, vars);
            case "<=":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    return this.processCompare("le", f, scope, enode, b, vars);
                }
                if (this.isSigned(enode.lhs.type)) {
                    return this.processCompare("le_s", f, scope, enode, b, vars);
                }
                return this.processCompare("le_u", f, scope, enode, b, vars);
            case ">=":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    return this.processCompare("ge", f, scope, enode, b, vars);
                }
                if (this.isSigned(enode.lhs.type)) {
                    return this.processCompare("ge_s", f, scope, enode, b, vars);
                }
                return this.processCompare("ge_u", f, scope, enode, b, vars);
            case "+":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                if (enode.lhs.type == this.tc.t_string) {
                    if (!this.stringConcatFunction) {
                        throw "Missing string concat function in runtime";
                    }
                    let wf = this.funcs.get(this.stringConcatFunction);
                    return b.call(b.tmp(), this.getSSAFunctionType(this.stringConcatFunction.type), [wf.index, p1, p2]);
                }
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "add", storage, [p1, p2]);
            }
            case "*":
            case "-":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.type);
                let opcode: "mul" | "sub" = enode.op == "*" ? "mul" : "sub";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "/":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.type);
                if (storage == "f32" || storage == "f64") {
                    return b.assign(b.tmp(), "div", storage, [p1, p2]);
                }
                let opcode: "div_u" | "div_s" = this.isSigned(enode.type) ? "div_s" : "div_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "%":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.type);
                let opcode: "rem_u" | "rem_s" = this.isSigned(enode.type) ? "rem_s" : "rem_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "|":
            case "&":
            case "^":
            {
                let opcode: "or" | "xor" | "and" = enode.op == "|" ? "or" : (enode.op == "&" ? "and" : "xor");
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "&^":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.type);
                let tmp = b.assign(b.tmp(), "xor", storage, [p2, -1]);
                return b.assign(b.tmp(), "and", storage, [p1, tmp]);
            }
            case "unary!":
            {
                let p = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.rhs.type);
                return b.assign(b.tmp(), "eqz", storage, [p]);
            }
            case "unary+":
            {
                return this.processExpression(f, scope, enode.rhs, b, vars);
            }
            case "unary-":
            {
                let p = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.rhs.type);
                if (enode.rhs.type == this.tc.t_float || enode.rhs.type == this.tc.t_double) {
                    return b.assign(b.tmp(), "neg", storage, [p]);
                }
                let tmp = b.assign(b.tmp(), "xor", storage, [p, -1]);
                return b.assign(b.tmp(), "add", storage, [tmp, 1]);
            }
            case "unary^":
            {
                let p = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.rhs.type);
                return b.assign(b.tmp(), "xor", storage, [p, -1]);
            }
            case "unary*":
            {
                let p = this.processExpression(f, scope, enode.rhs, b, vars);
                if (enode.rhs.type instanceof UnsafePointerType) {
                    let storage = this.getSSAType(enode.rhs.type.elementType);
                    return b.assign(b.tmp(), "load", storage, [p, 0]);
                } else if (enode.rhs.type instanceof PointerType) {
                    let storage = this.getSSAType(enode.rhs.type.elementType);
                    return b.assign(b.tmp(), "load", storage, [p, 0]);
                } else if (enode.rhs.type instanceof GuardedPointerType) {
                    throw "TODO"
                }                                
                break;
            }
            case "unary&":
            {
                if (this.tc.checkIsAddressable(enode.rhs, scope)) {
                    let p = this.processLeftHandExpression(f, scope, enode.rhs, b, vars);
                    if (p instanceof ssa.Pointer) {
                        if (p.offset == 0) {
                            return p.variable;
                        }
                        return b.assign(b.tmp(), "add", "ptr", [p.variable, p.offset]);
                    }
                    return b.assign(b.tmp(), "addr_of", "ptr", [p]);                
                }
                // Make a copy of a literal
                let p = this.processExpression(f, scope, enode.rhs, b, vars);
                let s = this.getSSAType(enode.rhs.type);
                let copy = b.assign(b.tmp("ptr"), "alloc", s, [ssa.sizeOf(s)]);
                b.assign(b.mem, "store", s, [copy, 0, p]);
                return copy;
            }
            case "||":
            {
                let result = b.tmp();
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                b.assign(result, "copy", "i8", [1]);
                b.elseBlock();
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                b.assign(result, "copy", "i8", [p2]);
                b.end();
                return result;
            }
            case "&&":
            {
                let result = b.tmp();
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                b.assign(result, "copy", "i8", [p2]);
                b.elseBlock();
                b.assign(result, "copy", "i8", [0]);
                b.end();
                return result;
            }
            case ">>":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), this.isSigned(enode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
            }
            case "<<":
            {
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), "shl", storage, [p1, p2]);
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                if (element instanceof Variable && element.heapAlloc) {
                    return b.assign(b.tmp(), "load", this.getSSAType(element.type), [vars.get(element), 0]);
                }
                return vars.get(element);
            }
            case "(":
            {
                let f: Function;
                let t: FunctionType;
                if (enode.lhs.op == "id") {
                    let e = scope.resolveElement(enode.lhs.value);
                    if (e instanceof Function) {
                        f = e;
                        t = f.type;
                    }
                }
                if (!f) {
                    t = enode.lhs.type as FunctionType;
                }
                
                let args: Array<ssa.Variable | string | number> = [];
                if (f) {
                    args.push(this.funcs.get(f).index);
                }
                if (t.hasEllipsis()) {
                    throw "TODO"
                } else if (enode.parameters) {
                    for(let pnode of enode.parameters) {
                        args.push(this.processExpression(f, scope, pnode, b, vars));
                    }
                }
                
                if (f) {
                    let ft = this.getSSAFunctionType(t);
//                    if (t.returnType != this.tc.t_void) {
                    return b.call(b.tmp(), ft, args);
//                    }
//                    return b.call(null, ft, args);
                }
                throw "TODO: call a lambda function"
            }
            case "[":
            {
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
                let expr = this.processExpression(f, scope, enode.rhs, b, vars);
                let t = enode.type;
                let s = this.getSSAType(t);
                let s2 = this.getSSAType(enode.rhs.type);
                if (this.tc.checkIsIntType(t) && enode.rhs.type instanceof UnsafePointerType) {
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
                } else if (t instanceof UnsafePointerType && (enode.rhs.type instanceof UnsafePointerType || enode.rhs.type instanceof PointerType || enode.rhs.type == this.tc.t_string)) {
                    // Convert pointer or string to unsafe pointer
                    return expr;
                } else if (t == this.tc.t_string && enode.rhs.type instanceof UnsafePointerType) {
                    // Convert unsafe pointer to string
                    return expr;
                } else if ((t == this.tc.t_bool || this.tc.checkIsIntType(t)) && (enode.rhs.type == this.tc.t_bool || this.tc.checkIsIntNumber(enode.rhs, false))) {
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
                } else {
                    throw "TODO: conversion not implemented";
                }
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
        throw "Unreachable";
    }

    private processCompare(opcode: ssa.NodeKind, f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable {
        let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
        let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
        if (enode.lhs.type == this.tc.t_string) {
            throw "TODO"
        } else {
            let storage = this.getSSAType(enode.lhs.type);
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
        if (t == this.tc.t_int8 || t == this.tc.t_int16 || t == this.tc.t_int32 || t == this.tc.t_int64 || t == this.tc.t_float || t == this.tc.t_double) {
            return true;
        }
        if (t == this.tc.t_uint8 || t == this.tc.t_uint16 || t == this.tc.t_uint32 || t == this.tc.t_uint64) {
            return false;
        }
        throw "CodeGen: Implementation error: signed check on non number type"       
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

    private optimizer: ssa.Optimizer;
    private wasm: ssa.Wasm32Backend;
    private tc: TypeChecker;
    private imports: Map<string, wasm.FunctionImport>;
    private funcs: Map<Function, wasm.Function | wasm.FunctionImport> = new Map<Function, wasm.Function | wasm.FunctionImport>();
    private globalVars = new Map<ScopeElement, ssa.Variable>();
    private sliceHeader: ssa.StructType;
    private emitIR: boolean;
    private emitNoWasm: boolean;
    private emitFunction: string | null;
    private stringConcatFunctionName: string = "string_concat";
    private stringConcatFunction: Function;
}