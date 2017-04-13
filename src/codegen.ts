import {Node, NodeOp} from "./ast"
import {Function, Type, UnsafePointerType, FunctionType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement} from "./typecheck"
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
                e.storageLocation = "funcTable";
                e.storageIndex = index++;
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }

        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                let f = this.processFunction(e, true);
                f.index = e.storageIndex;
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }
    }

    public processFunction(f: Function, exportFunc: boolean = false): wasm.Function {
        let func = new wasm.Function(f.name);
        this.processScope(func, f.scope);

        if (f.type.returnType != this.tc.t_void) {
            if (this.isRegisterSize(f.type.returnType)) {
                func.results.push(this.stackTypeOf(f.type.returnType));
            } else {
                // TODO
            }
        }

        for(let node of f.node.statements) {
            this.processStatement(f, f.scope, node, func, func.statements);
        }
        if (exportFunc) {
            this.module.exports.set(f.name, func);
        } 
        this.module.funcs.push(func);
        return func;
    }

    public processScope(func: wasm.Function, scope: Scope) {
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Variable) {
                if (this.isRegisterSize(e.type)) {
                    e.storageLocation = "local";
                    e.storageIndex = func.parameters.length + func.locals.length;
                    func.locals.push(this.stackTypeOf(e.type));
                } else {
                    // TODO
                }
            } else if (e instanceof FunctionParameter) {
                if (this.isRegisterSize(e.type)) {
                    e.storageLocation = "local";
                    e.storageIndex = func.parameters.length;
                    func.parameters.push(this.stackTypeOf(e.type));
                } else {
                    // TODO
                }
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }
    }

    public processStatement(f: Function, scope: Scope, snode: Node, wf: wasm.Function, code: Array<wasm.Node>) {
        switch(snode.op) {
            case "comment":
                break;
            case "if":
            {
                this.processScope(wf, snode.scope);
                if (snode.lhs) {
                    this.processStatement(f, snode.scope, snode.lhs, wf, code);
                }
                this.processExpression(f, snode.scope, snode.condition, code);
                code.push(new wasm.If());
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, wf, code);
                }
                if (snode.elseBranch) {
                    code.push(new wasm.Else());
                    this.processStatement(f, snode.elseBranch.scope, snode.elseBranch, wf, code);
                }
                code.push(new wasm.End());
                break;
            }
            case "else":
            {
                this.processScope(wf, snode.scope);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, wf, code);
                }
                break;                
            }
            case "var":
            {
                if (snode.rhs) {
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value);
                        if (this.isRegisterSize(element.type)) {
                            this.processExpression(f, scope, snode.rhs, code);
                            this.storeElementFromStack(element, code);
                        } else {
                            throw "TODO";
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
                } else {
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value);
                        if (element.storageLocation == "fyrStack") {
                            if (this.isRegisterSize(snode.lhs.type)) {
                                let storage = this.stackTypeOf(element.type);
                                code.push(new wasm.Constant(storage, 0));
                                this.storeElementFromStack(element, code);                            
                            } else {
                                throw "TODO";
                            }
                        }
                    } else {
                        throw "TODO"                        
                    }
                    // TODO: Initialize if required (only on FYR stack)
                }
                return;
            }
            case "=":
            {
                if (snode.lhs.op == "id") {
                    let element = scope.resolveElement(snode.lhs.value);
                    if (this.isRegisterSize(element.type)) {
                        this.processExpression(f, scope, snode.rhs, code);
                        this.storeElementFromStack(element, code);
                    } else {
                        throw "TODO";
                    }
                } else if (snode.lhs.op == "unary*") {
                    this.processExpression(f, scope, snode.lhs.rhs, code);
                    if (this.isRegisterSize(snode.lhs.type)) {
                        this.processExpression(f, scope, snode.rhs, code);
                        this.storeHeapWordFromStack(snode.lhs.type, 0, code);
                    } else {
                        throw "TODO";
                    }
                } else if (snode.lhs.op == "[") {
                    if (snode.lhs.lhs.type instanceof UnsafePointerType) {
                        this.processExpression(f, scope, snode.lhs.lhs, code);
                        if (this.isRegisterSize(snode.lhs.lhs.type.elementType)) {
                            let size = this.sizeOf(snode.lhs.lhs.type.elementType);
                            let offset: number = 0;
                            if (snode.lhs.rhs.op == "int") {
                                offset = parseInt(snode.lhs.rhs.value) * size;
                            } else {
                                this.processExpression(f, scope, snode.lhs.rhs, code);
                                if (size > 1) {
                                    code.push(new wasm.Constant("i32", size));
                                    code.push(new wasm.BinaryIntInstruction("i32", "mul"));                                
                                }
                                code.push(new wasm.BinaryIntInstruction("i32", "add"));                   
                            }
                            this.processExpression(f, scope, snode.rhs, code);
                            this.storeHeapWordFromStack(snode.lhs.lhs.type.elementType, offset, code);
                        } else {
                            throw "TODO"
                        }
                    } else {
                        throw "TODO"
                    }
                } else if (snode.lhs.op == "tuple") {
                    throw "TODO"
                } else if (snode.lhs.op == "array") {
                    throw "TODO"                        
                } else if (snode.lhs.op == "object") {
                    throw "TODO"                        
                } else {
                    throw "TODO"                        
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
                if (snode.lhs.op == "id") {
                    let element = scope.resolveElement(snode.lhs.value);
                    if (this.isRegisterSize(element.type)) {
                        this.loadElementOnStack(element, code);
                        this.processExpression(f, scope, snode.rhs, code);
                        let storage = this.stackTypeOf(element.type);
                        if (storage == "i32" || storage == "i64") {
                            if (snode.op == "+=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "add"));
                            } else if (snode.op == "-=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "sub"));                                
                            } else if (snode.op == "*=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "mul"));
                            } else if (snode.op == "&=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "and"));                                
                            } else if (snode.op == "|=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "or"));          
                            } else if (snode.op == "^=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));                                
                            } else if (snode.op == "<<=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "shl"));                                
                            } else if (snode.op == "&^=") {
                                code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "and"));
                            } else if (snode.op == "/=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), this.isSigned(element.type) ? "div_s" : "div_u"));                                
                            } else if (snode.op == "%=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), this.isSigned(element.type) ? "rem_s" : "rem_u"));                                
                            } else if (snode.op == ">>=") {
                                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), this.isSigned(element.type) ? "shr_s" : "shr_u"));                                
                            }
                        } else {
                            if (snode.op == "+=") {
                                code.push(new wasm.BinaryFloatInstruction(storage as ("f32" | "f64"), "add"));
                            } else if (snode.op == "-=") {
                                code.push(new wasm.BinaryFloatInstruction(storage as ("f32" | "f64"), "sub"));                                
                            } else if (snode.op == "*=") {
                                code.push(new wasm.BinaryFloatInstruction(storage as ("f32" | "f64"), "mul"));
                            } else if (snode.op == "/=") {
                                code.push(new wasm.BinaryFloatInstruction(storage as ("f32" | "f64"), "div"));                                
                            }
                        }
                        this.storeElementFromStack(element, code);
                    } else {
                        throw "TODO string add";
                    }
                } else {
                    throw "TODO"          
                }
                break;
            }
            case "--":
            case "++":
            {
                if (snode.lhs.op == "id") {
                    let element = scope.resolveElement(snode.lhs.value);
                    if (this.isRegisterSize(element.type)) {
                        this.loadElementOnStack(element, code);
                        let storage = this.stackTypeOf(element.type);
                        let increment = 1;
                        if (element.type instanceof UnsafePointerType) {
                            increment = this.sizeOf(element.type.elementType);
                        }
                        code.push(new wasm.Constant(storage, increment));
                        code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), snode.op == "++" ? "add" : "sub"));
                        this.storeElementFromStack(element, code);                        
                    } else {
                        throw "TODO pointer increment";
                    }
                } else {
                    throw "TODO";
                }
                break;
            }
            case "for":
            {
                this.processScope(wf, snode.scope);
                if (snode.condition && snode.condition.op == ";;" && snode.condition.lhs) {
                    this.processStatement(f, snode.scope, snode.condition.lhs, wf, code);
                }
                code.push(new wasm.Block());
                code.push(new wasm.Loop());
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.condition) {
                            this.processExpression(f, snode.scope, snode.condition.condition, code);
                            code.push(new wasm.UnaryIntInstruction("i32", "eqz"));
                            code.push(new wasm.BrIf(1));         
                        }
                    } else if (snode.condition.op == "in") {
                        throw "TODO"
                    } else if (snode.condition.op == "var_in" || snode.condition.op == "const_in") {
                        throw "TODO"
                    } else {
                        this.processExpression(f, snode.scope, snode.condition, code);
                        code.push(new wasm.UnaryIntInstruction("i32", "eqz"));
                        code.push(new wasm.BrIf(1));
                    }
                }
                code.push(new wasm.Block());
                for(let s of snode.statements) {
                    this.processStatement(f, snode.scope, s, wf, code);
                }
                code.push(new wasm.End());
                if (snode.condition && snode.condition.op == ";;" && snode.condition.rhs) {
                    this.processStatement(f, snode.scope, snode.condition.rhs, wf, code);
                }
                code.push(new wasm.Br(0));
                code.push(new wasm.End());
                code.push(new wasm.End());
                break;
            }
            case "continue":
            {
                let blocks = 0;
                let s = scope;
                while(s && !s.forLoop) {
                    blocks++;
                    s = s.parent;
                }
                code.push(new wasm.Br(blocks));
                break;
            }
            case "break":
            {
                let blocks = 2;
                let s = scope;
                while(s && !s.forLoop) {
                    blocks++;
                    s = s.parent;
                }
                code.push(new wasm.Br(blocks));
                break;
            }
            case "return":
                // TODO: Clean up the FYR stack if required
                if (!snode.lhs) {
                    if (f.namedReturnTypes) {
                        let resultCount = 0;
                        for(let key of f.scope.elements.keys()) {
                            let v = f.scope.elements.get(key);
                            if (v instanceof Variable && v.isResult) {
                                if (resultCount == 0 && this.isRegisterSize(v.type)) {
                                    // TODO: Load on WASM stack
                                } else {
                                    // TODO: Load on FYR stack
                                }
                            }
                        }
                    }
                    code.push(new wasm.Return());
                    return;
                }
                if (snode.lhs.type instanceof TupleType) {
                    // TODO
                } else {
                    this.processExpression(f, scope, snode.lhs, code);
                    code.push(new wasm.Return());
                    return;
                }
                break;
                // TODO
            default:
                this.processExpression(f, scope, snode, code);
                if (snode.type != this.tc.t_void) {
                    // TODO: How much should be dropped?
                    code.push(new wasm.Drop);
                }
        }
    }

    public processExpression(f: Function, scope: Scope, enode: Node, code: Array<wasm.Node>): void {
        switch(enode.op) {
            case "int":
            case "float":
                if (enode.type == this.tc.t_int8 || enode.type == this.tc.t_int16 || enode.type == this.tc.t_int32 || enode.type instanceof UnsafePointerType) {
                    code.push(new wasm.Constant("i32", parseInt(enode.value)));
                } else if (enode.type == this.tc.t_int64) {
                    code.push(new wasm.Constant("i64", parseInt(enode.value)));                    
                } else if (enode.type == this.tc.t_uint8 || enode.type == this.tc.t_uint16 || enode.type == this.tc.t_uint32) {
                    code.push(new wasm.Constant("i32", parseInt(enode.value)));
                } else if (enode.type == this.tc.t_uint64) {
                    code.push(new wasm.Constant("i64", parseInt(enode.value)));                    
                } else if (enode.type == this.tc.t_float) {
                    code.push(new wasm.Constant("f32", parseFloat(enode.value)));
                } else if (enode.type == this.tc.t_double) {
                    code.push(new wasm.Constant("f64", parseFloat(enode.value)));
                } else {
                    throw "CodeGen: Implementation error";
                }
                break;
            case "bool":
                code.push(new wasm.Constant("i32", enode.value == "true" ? 1 : 0));
                break;
            case "str":
                let off = this.module.addData(enode.value);
                // TODO: Code to load the string
                throw "TODO";
            case "==":
                if (enode.lhs.type instanceof BasicType) {
                    this.processCompare("eq", f, scope, enode, code);
                } else {
                    throw "TODO"
                }
                break;
            case "!=":
                if (enode.lhs.type instanceof BasicType) {
                    this.processCompare("ne", f, scope, enode, code);
                } else {
                    throw "TODO"
                }
                break;
            case "<":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("lt", f, scope, enode, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("lt_s", f, scope, enode, code);
                } else {
                    this.processCompare("lt_u", f, scope, enode, code);
                }
                break;
            case ">":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("gt", f, scope, enode, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("gt_s", f, scope, enode, code);
                } else {
                    this.processCompare("gt_u", f, scope, enode, code);
                }
                break;
            case "<=":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("le", f, scope, enode, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("le_s", f, scope, enode, code);
                } else {
                    this.processCompare("le_u", f, scope, enode, code);
                }
                break;
            case ">=":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("ge", f, scope, enode, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("ge_s", f, scope, enode, code);
                } else {
                    this.processCompare("ge_u", f, scope, enode, code);
                }
                break;
            case "+":
            {
                this.processExpression(f, scope, enode.lhs, code);
                this.processExpression(f, scope, enode.rhs, code);
                if (enode.lhs.type == this.tc.t_string) {
                    throw "TODO"
                } else {
                    let storage = this.stackTypeOf(enode.type);
                    if (storage == "f32" || storage == "f64") {
                        code.push(new wasm.BinaryFloatInstruction(storage, "add"))
                    } else {
                        code.push(new wasm.BinaryIntInstruction(storage, "add"))
                    }                    
                }
                break;
            }
            case "*":
            case "-":
            {
                this.processExpression(f, scope, enode.lhs, code);
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.type);
                let opcode: "mul" | "sub" = enode.op == "*" ? "mul" : "sub";
                if (storage == "f32" || storage == "f64") {
                    code.push(new wasm.BinaryFloatInstruction(storage, opcode))
                } else {
                    code.push(new wasm.BinaryIntInstruction(storage, opcode))
                }
                break;
            }
            case "/":
            {
                this.processExpression(f, scope, enode.lhs, code);
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.type);
                if (storage == "f32" || storage == "f64") {
                    code.push(new wasm.BinaryFloatInstruction(storage, "div"))
                } else {
                    let opcode: "div_u" | "div_s" = this.isSigned(enode.type) ? "div_s" : "div_u";
                    code.push(new wasm.BinaryIntInstruction(storage, opcode))
                }
                break;
            }
            case "%":
            {
                this.processExpression(f, scope, enode.lhs, code);
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.type);
                let opcode: "rem_u" | "rem_s" = this.isSigned(enode.type) ? "rem_s" : "rem_u";
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), opcode));
                break;
            }
            case "|":
            case "&":
            case "^":
            {
                let opcode: "or" | "xor" | "and" = enode.op == "|" ? "or" : (enode.op == "&" ? "and" : "xor");
                this.processExpression(f, scope, enode.lhs, code);
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.type);
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), opcode));
                break;
            }
            case "&^":
            {
                this.processExpression(f, scope, enode.lhs, code);
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.type);
                code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "and"));
                break;
            }
            case "unary!":
            {
                this.processExpression(f, scope, enode.rhs, code);
                code.push(new wasm.UnaryIntInstruction("i32", "eqz"));
                break;                
            }
            case "unary+":
            {
                this.processExpression(f, scope, enode.rhs, code);
                break;                
            }
            case "unary-":
            {
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.rhs.type);
                if (enode.rhs.type == this.tc.t_float || enode.rhs.type == this.tc.t_double) {
                    code.push(new wasm.UnaryFloatInstruction(storage as ("f32" | "f64"), "neg"));                    
                } else {
                    code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                    code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                    code.push(new wasm.Constant(storage as ("i32" | "i64"), 1));
                    code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "add"));
                }
                break;                
            }
            case "unary^":
            {
                this.processExpression(f, scope, enode.rhs, code);
                let storage = this.stackTypeOf(enode.rhs.type);
                code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                break;
            }
            case "unary*":
            {
                this.processExpression(f, scope, enode.rhs, code);
                if (enode.rhs.type instanceof UnsafePointerType) {
                    let storage = this.stackTypeOf(enode.rhs.type.elementType);
                    if (this.isRegisterSize(enode.rhs.type.elementType)) {
                        this.loadHeapWordOnStack(enode.rhs.type.elementType, 0, code);
                    } else {
                        throw "TODO"
                    }
                } else {
                    throw "TODO"
                }                                
                break;
            }
            case "||":
            {
                this.processExpression(f, scope, enode.lhs, code);
                code.push(new wasm.If(["i32"]));
                code.push(new wasm.Constant("i32", 1));
                code.push(new wasm.Else());
                this.processExpression(f, scope, enode.rhs, code);
                code.push(new wasm.End());
                break;
            }
            case "&&":
            {
                this.processExpression(f, scope, enode.lhs, code);
                code.push(new wasm.If(["i32"]));
                this.processExpression(f, scope, enode.rhs, code);
                code.push(new wasm.Else());
                code.push(new wasm.Constant("i32", 0));
                code.push(new wasm.End());
                break;
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                if (this.isRegisterSize(element.type)) {
                    this.loadElementOnStack(element, code);
                } else {
                    throw "TODO"
                }
                break;
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
                
                if (t.hasVariableParameterList()) {
                    throw "TODO"
                } else {
                    for(let pnode of enode.parameters) {
                        this.processExpression(f, scope, pnode, code);
                    }
                }

                if (f) {
                    code.push(new wasm.Call(f.storageIndex));
                } else {
                    throw "TODO: call a lambda function"
                }
                break;
            }
            case "[":
            {
                if (enode.lhs.type instanceof UnsafePointerType) {
                    this.processExpression(f, scope, enode.lhs, code);
                    if (this.isRegisterSize(enode.lhs.type.elementType)) {
                        let size = this.sizeOf(enode.lhs.type.elementType);
                        let offset: number = 0;
                        if (enode.rhs.op == "int") {
                            offset = parseInt(enode.rhs.value) * size;
                        } else {
                            this.processExpression(f, scope, enode.rhs, code);
                            if (size > 1) {
                                code.push(new wasm.Constant("i32", size));
                                code.push(new wasm.BinaryIntInstruction("i32", "mul"));                                
                            }
                            code.push(new wasm.BinaryIntInstruction("i32", "add"));                   
                        }
                        this.loadHeapWordOnStack(enode.lhs.type.elementType, offset, code);
                    } else {
                        throw "TODO";
                    }
                } else {
                    throw "TODO";
                }
                break;
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    private processCompare(opcode: wasm.BinaryFloatOp | wasm.BinaryIntOp, f: Function, scope: Scope, enode: Node, code: Array<wasm.Node>) {
        this.processExpression(f, scope, enode.lhs, code);
        this.processExpression(f, scope, enode.rhs, code);
        if (enode.lhs.type == this.tc.t_string) {
            throw "TODO"
        } else {
            let storage = this.stackTypeOf(enode.type);
            if (storage == "f32" || storage == "f64") {
                code.push(new wasm.BinaryFloatInstruction(storage, opcode as wasm.BinaryFloatOp))
            } else {
                code.push(new wasm.BinaryIntInstruction(storage, opcode as wasm.BinaryIntOp))
            }                    
        }
    }

    public loadElementOnStack(e: ScopeElement, code: Array<wasm.Node>) {
        if (e instanceof FunctionParameter || e instanceof Variable) {
            switch(e.storageLocation) {
                case "local":
                    code.push(new wasm.GetLocal(e.storageIndex));
                    break;
                case "global":
                    code.push(new wasm.GetGlobal(e.storageIndex));
                    break;
                case "fyrStack":
                    code.push(new wasm.GetGlobal(0));
//                    code.push(new wasm.Load(this.stackTypeOf(e.type)))
                    throw "TODO";
            }
        }
    }

    public storeElementFromStack(e: ScopeElement, code: Array<wasm.Node>) {
        if (e instanceof FunctionParameter || e instanceof Variable) {
            switch(e.storageLocation) {
                case "local":
                    code.push(new wasm.SetLocal(e.storageIndex));
                    break;
                case "global":
                    code.push(new wasm.SetGlobal(e.storageIndex));
                    break;
                case "fyrStack":
                    code.push(new wasm.GetGlobal(0));
                    throw "TODO";
            }
        }
    }

    public loadHeapWordOnStack(t: Type, offset: number, code: Array<wasm.Node>) {
        let storage = this.stackTypeOf(t);
        if (t == this.tc.t_int8) {
            code.push(new wasm.Load(storage, "8_s", offset));
        } else if (t == this.tc.t_int16) {
            code.push(new wasm.Load(storage, "16_s", offset));
        } else if (t == this.tc.t_int32) {
            code.push(new wasm.Load(storage, null, offset));
        } else if (t == this.tc.t_int64) {
            code.push(new wasm.Load(storage, null, offset));
        } else if (t == this.tc.t_uint8) {
            code.push(new wasm.Load(storage, "8_u", offset));
        } else if (t == this.tc.t_uint16) {
            code.push(new wasm.Load(storage, "16_u", offset));
        } else if (t == this.tc.t_uint32) {
            code.push(new wasm.Load(storage, null, offset));
        } else if (t == this.tc.t_uint64 || t == this.tc.t_float || t == this.tc.t_double) {
            code.push(new wasm.Load(storage, null, offset));
        } else if (t instanceof UnsafePointerType) {
            code.push(new wasm.Load(storage, null, offset));
        } else {
            throw "Implementation error";
        }
    }

    public storeHeapWordFromStack(t: Type, offset: number, code: Array<wasm.Node>) {
        let storage = this.stackTypeOf(t);
        if (t == this.tc.t_int8) {
            code.push(new wasm.Store(storage, "8", offset));
        } else if (t == this.tc.t_int16) {
            code.push(new wasm.Store(storage, "16", offset));
        } else if (t == this.tc.t_int32) {
            code.push(new wasm.Store(storage, null, offset));
        } else if (t == this.tc.t_int64) {
            code.push(new wasm.Store(storage, null, offset));
        } else if (t == this.tc.t_uint8) {
            code.push(new wasm.Store(storage, "8", offset));
        } else if (t == this.tc.t_uint16) {
            code.push(new wasm.Store(storage, "16", offset));
        } else if (t == this.tc.t_uint32) {
            code.push(new wasm.Store(storage, null, offset));
        } else if (t == this.tc.t_uint64 || t == this.tc.t_float || t == this.tc.t_double) {
            code.push(new wasm.Store(storage, null, offset));
        } else if (t instanceof UnsafePointerType) {
            code.push(new wasm.Store(storage, null, offset)); 
        } else {
            throw "Implementation error";
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

    public stackTypeOf(t: Type): wasm.StackType {
        if (t == this.tc.t_bool || t == this.tc.t_int8 || t == this.tc.t_uint8 ||t == this.tc.t_int16 || t == this.tc.t_uint16 || t == this.tc.t_int32 || t == this.tc.t_uint32) {
            return "i32";
        }
        if (t == this.tc.t_int64 || t == this.tc.t_uint64) {
            return "i64";
        }
        if (t == this.tc.t_float) {
            return "f32";
        }
        if (t == this.tc.t_double) {
            return "f64";
        }
        if (t instanceof UnsafePointerType) {
            return "i32";
        }
        throw "CodeGen: Implementation error: The type does not fit in a register " + t.name;
    }

   public sizeOf(t: Type): number {
        if (t == this.tc.t_bool || t == this.tc.t_int8 || t == this.tc.t_uint8) {
            return 1;
        }
        if (t == this.tc.t_int16 || t == this.tc.t_uint16) {
            return 2;
        }
        if (t == this.tc.t_int32 || t == this.tc.t_uint32 || t == this.tc.t_float || t instanceof UnsafePointerType) {
            return 4;
        }
        if (t == this.tc.t_int64 || t == this.tc.t_uint64 || t == this.tc.t_double) {
            return 8;
        }
        throw "TODO";
    }

    public isRegisterSize(t: Type) {
        if (t == this.tc.t_double || t == this.tc.t_float || t == this.tc.t_int64 || this.tc.t_uint64 || t == this.tc.t_bool || t == this.tc.t_int8 || t == this.tc.t_uint8 ||t == this.tc.t_int16 || t == this.tc.t_uint16 || t == this.tc.t_int32 || t == this.tc.t_uint32) {
            return true;
        }
        if (t instanceof UnsafePointerType) {
            return true;
        }
        return false;
    }

    public module: wasm.Module = new wasm.Module();

    private tc: TypeChecker;
}