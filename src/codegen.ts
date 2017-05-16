import {Node, NodeOp} from "./ast"
import {Function, Type, UnsafePointerType, PointerType, FunctionType, ArrayType, SliceType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement, StorageLocation} from "./typecheck"
import * as ssa from "./ssa"
import * as wasm from "./wasm"

export class CodeGenerator {
    constructor(tc: TypeChecker) {
        this.tc = tc;
    }

    public processModule(scope: Scope) {
        let index = 0;
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                let wf = this.wasm.declareFunction(e.name);
                this.funcs.set(e, wf);
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }

        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                let wf = this.funcs.get(e);
                let f = this.processFunction(e, true, wf);
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }
    }

    private getSSAType(t: Type): ssa.Type | ssa.StructType {
        if (t == this.tc.t_bool || t == this.tc.t_uint8) {
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
        if (t instanceof UnsafePointerType) {
            return "addr";
        }
        // TODO: Struct
        throw "CodeGen: Implementation error: The type does not fit in a register " + t.name;
    }

    private getSSAFunctionType(t: FunctionType): ssa.FunctionType {
        let ftype = new ssa.FunctionType([], null, false);
        for(let p of t.parameters) {
            ftype.params.push(this.getSSAType(p));
        }
        if (t.returnType) {
            ftype.result = this.getSSAType(t.returnType);
        }
        return ftype;
    }

    public processFunction(f: Function, exportFunc: boolean, wf: wasm.Function) {
        let b = new ssa.Builder();
        let vars = new Map<ScopeElement, ssa.Variable>();

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
        } else if (f.type.returnType) {
            b.declareResult(this.getSSAType(f.type.returnType), "$return");
        }

        this.processScopeVariables(b, vars, f.scope);

        for(let node of f.node.statements) {
            this.processStatement(f, f.scope, node, b, vars, null);
        }

        this.wasm.generateFunction(b.node, wf);
        if (exportFunc) {
            this.wasm.module.exports.set(f.name, wf);
        } 
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
                    vars.set(e, v);                
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
                let tmp: ssa.Variable = this.processExpression(f, snode.scope, snode.condition, b, vars);
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
                        let element = scope.resolveElement(snode.lhs.value);
                        let v = vars.get(element);
                        let tmp: ssa.Variable = this.processExpression(f, scope, snode.rhs, b, vars);
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
                } else { // Assignment of initial value (all zero)
                    if (snode.lhs.op == "id") {
                        // Nothing todo here, handled by decl_var.
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
                    let tmp: ssa.Variable = this.processExpression(f, scope, snode.rhs, b, vars);
                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                    if (dest instanceof ssa.Pointer) {
                        b.assign(b.mem, "store", tmp.type, [dest.variable, dest.offset, tmp]);
                    } else {
                        b.assign(dest, "copy", tmp.type, [tmp]);
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
                let p2: ssa.Variable = this.processExpression(f, scope, snode.rhs, b, vars);
                // TODO: String concatenation
                if (storage == "i32" || storage == "i64") {
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
                } else {
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    } else if (snode.op == "*=") {
                        b.assign(dest, "mul", storage, [p1, p2]);
                    } else if (snode.op == "/=") {
                        b.assign(dest, "div", storage, [p1, p2]);
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
                if (snode.lhs.type instanceof PointerType) {
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
                this.processScopeVariables(b, vars, snode.scope);
                if (snode.condition && snode.condition.op == ";;" && snode.condition.lhs) {
                    this.processStatement(f, snode.scope, snode.condition.lhs, b, vars, blocks);
                }
                let outer = b.block();
                let loop = b.loop();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.condition) {
                            let tmp: ssa.Variable = this.processExpression(f, snode.scope, snode.condition.condition, b, vars);
                            let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                            b.br_if(tmp2, outer);
                        }
                    } else if (snode.condition.op == "in") {
                        throw "TODO"
                    } else if (snode.condition.op == "var_in" || snode.condition.op == "const_in") {
                        throw "TODO"
                    } else {
                        let tmp: ssa.Variable = this.processExpression(f, snode.scope, snode.condition.condition, b, vars);
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
                    let tmp: ssa.Variable = this.processExpression(f, scope, snode.lhs, b, vars);
                    b.assign(null, "return", tmp.type, [tmp]);
                }
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
                return vars.get(element);
            }
            case "unary*":
                let tmp = this.processExpression(f, scope, enode.rhs, b, vars);
                return new ssa.Pointer(tmp, 0);
            case "[":
                if (enode.lhs.type instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars);
                    let index = this.processExpression(f, scope, enode.rhs, b, vars);
                    let size = ssa.sizeOf(this.getSSAType(enode.lhs.type.elementType));
                    let index2 = index;
                    if (size > 1) {
                        // TODO: If size is power of 2, shift bits
                        index2 = b.assign(b.tmp(), "mul", "addr", [index, size]);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index2]), 0);
                } else if (enode.lhs.type instanceof PointerType) {
                    throw "TODO"
                } else if (enode.lhs.type instanceof SliceType || enode.lhs.type == this.tc.t_string) {
                    let slice = this.processExpression(f, scope, enode.lhs, b, vars);
                    let t = this.getSSAType(enode.lhs.type);
                    let size = ssa.sizeOf(t);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars);
                    }
                    // Load length from slice head and compare to index. Index must be less
                    code.push(new wasm.Load("i32", null, additionalOffset + 8)); // ptr to slice head, max-index is on stack
                    if (enode.rhs.op == "int") {
                        code.push(new wasm.Constant("i32", index));
                    } else {
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to slice head, max-index, index is on stack
                    }
                    code.push(new wasm.BinaryIntInstruction("i32", "lt_s")); // ptr to slice head, bool is on stack
                    code.push(new wasm.If());
                    code.push(new wasm.Unreachable());
                    code.push(new wasm.End());
                    // Index must be equal to or larger than 0
                    if (enode.rhs.op != "int") {
                        code.push(new wasm.Constant("i32", 0)); // ptr to slice head, 0 is on stack
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to slice head, 0, index is on stack
                        code.push(new wasm.BinaryIntInstruction("i32", "gt_s")); // ptr to slice head, bool is on stack
                        code.push(new wasm.If());
                        code.push(new wasm.Unreachable());
                        code.push(new wasm.End());
                    }
                    // Load pointer to first slice element
                    code.push(new wasm.Load("i32", null, additionalOffset + 4)); // ptr to first element is on stack
                    // Check for zero pointer
                    code.push(new wasm.UnaryIntInstruction("i32", "eqz"));
                    code.push(new wasm.If());
                    code.push(new wasm.Unreachable());
                    code.push(new wasm.End());                    
                    code.push(new wasm.Load("i32", null, additionalOffset + 4)); // ptr to first element is on stack
                    if (enode.rhs.op != "int") {
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to first element, index is on stack
                        if (size > 1) {
                            code.push(new wasm.Constant("i32", size)); // ptr to first element, index, size is on stack
                            code.push(new wasm.BinaryIntInstruction("i32", "mul")); // ptr to first element, offset is on stack
                        }
                        code.push(new wasm.BinaryIntInstruction("i32", "add")); // ptr to element is on stack
                    } else if (index != 0) {
                        code.push(new wasm.Constant("i32", index * size)); // ptr to first element, offset is on stack
                        code.push(new wasm.BinaryIntInstruction("i32", "add")); // ptr to element is on stack
                    }
                } else if (enode.lhs.type instanceof ArrayType) {
                    throw "TODO";
                } else if (enode.lhs.type == this.tc.t_json) {
                    throw "TODO";
                } else {
                    throw "TODO"; // TODO: map
                }
                break;
            case ".":
                throw "TODO"
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    public isLeftHandSide(enode: Node): boolean {
        return (enode.op == "[" || enode.op == "." || enode.op == "id" || enode.op == "unary*");
    }

    public processExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable {
        switch(enode.op) {
            case "int":
                return b.assign(b.tmp(), "copy", this.getSSAType(enode.type), [parseInt(enode.value)]);
            case "float":
                return b.assign(b.tmp(), "copy", this.getSSAType(enode.type), [parseFloat(enode.value)]);
            case "bool":
                return b.assign(b.tmp(), "copy", this.getSSAType(enode.type), [enode.value == "true" ? 1 : 0]);
            case "str":
                let [off, len] = this.wasm.module.addData(enode.value);
                throw "TODO"
            case "==":
                return this.processCompare("eq", f, scope, enode, b, vars);
            case "!=":
                return this.processCompare("neq", f, scope, enode, b, vars);
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
                    throw "TODO"
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
                    throw "TODO"
                }                                
                break;
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
            case "id":
            {
                let element = scope.resolveElement(enode.value);
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
                } else {
                    for(let pnode of enode.parameters) {
                        args.push(this.processExpression(f, scope, pnode, b, vars));
                    }
                }
                
                if (f) {
                    return b.call(b.tmp(), this.getSSAFunctionType(t), args);
                }
                throw "TODO: call a lambda function"
            }
            case "[":
            {
                let ptr = this.processLeftHandExpression(f, scope, enode, b, vars) as ssa.Pointer;
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "load", storage, [ptr.variable, ptr.offset]);
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    private processCompare(opcode: ssa.NodeKind, f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable {
        let p1 = this.processExpression(f, scope, enode.lhs, b, vars);
        let p2 = this.processExpression(f, scope, enode.rhs, b, vars);
        if (enode.lhs.type == this.tc.t_string) {
            throw "TODO"
        } else {
            let storage = this.getSSAType(enode.type);
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

    private optimizer: ssa.Optimizer;
    private wasm: ssa.Wasm32Backend;
    private tc: TypeChecker;
    private funcs: Map<Function, wasm.Function> = new Map<Function, wasm.Function>();
}