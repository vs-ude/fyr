import {Node, NodeOp} from "./ast"
import {Function, Type, FunctionType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement} from "./typecheck"
import * as wasm from "./wasm"

export class CodeGenerator {
    constructor(tc: TypeChecker) {
        this.tc = tc;
    }

    public processFunction(f: Function, exportFunc: boolean = false) {
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
            func.statements = func.statements.concat(this.processStatement(f, f.scope, node));
        }
        if (exportFunc) {
            this.module.exports.set(f.name, func);
        } 
        this.module.funcs.push(func);
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
            }
        }
    }

    public processStatement(f: Function, scope: Scope, snode: Node): Array<wasm.Node> {
        switch(snode.op) {
            case "var":
            {
                let code: Array<wasm.Node> = [];
                if (snode.rhs) {
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value);
                        if (this.isRegisterSize(element.type)) {
                            code = code.concat(this.processExpression(f, scope, snode.rhs));
                            this.storeElementFromStack(element, code);
                        } else {
                            throw "TODO";
                        }
                    } else if (snode.lhs.op == "tuple") {
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
                    } else if (snode.lhs.op == "tuple") {
                        throw "TODO"                        
                    } else if (snode.lhs.op == "array") {
                        throw "TODO"                        
                    } else if (snode.lhs.op == "object") {
                        throw "TODO"                        
                    }
                    // TODO: Initialize if required (only on FYR stack)
                }
                return code;
            }
            case "return":
                // TODO: Clean up the FYR stack if required
                if (!snode.lhs) {
                    let code = [];
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
                    return code;
                }
                if (snode.lhs.type instanceof TupleType) {
                    // TODO
                } else {
                    let code = this.processExpression(f, scope, snode.lhs);
                    code.push(new wasm.Return());
                    return code;
                }
                break;
                // TODO
        }
        let code = this.processExpression(f, scope, snode);
        if (snode.type != this.tc.t_void) {
            // TODO: How much should be dropped?
            code.push(new wasm.Drop);
        }
        return code;
    }

    public processExpression(f: Function, scope: Scope, enode: Node): Array<wasm.Node> {
        switch(enode.op) {
            case "int":
            case "float":
                if (enode.type == this.tc.t_int8 || enode.type == this.tc.t_int16 || enode.type == this.tc.t_int32) {
                    return [new wasm.Constant("i32", parseInt(enode.value))];
                } else if (enode.type == this.tc.t_int64) {
                    return [new wasm.Constant("i64", parseInt(enode.value))];                    
                } else if (enode.type == this.tc.t_uint8 || enode.type == this.tc.t_uint16 || enode.type == this.tc.t_uint32) {
                    return [new wasm.Constant("i32", parseInt(enode.value))];
                } else if (enode.type == this.tc.t_uint64) {
                    return [new wasm.Constant("i64", parseInt(enode.value))];                    
                } else if (enode.type == this.tc.t_float) {
                    return [new wasm.Constant("f32", parseFloat(enode.value))];
                } else if (enode.type == this.tc.t_double) {
                    return [new wasm.Constant("f64", parseFloat(enode.value))];
                } else {
                    throw "CodeGen: Implementation error";
                }
            case "bool":
                return [new wasm.Constant("i32", enode.value == "true" ? 1 : 0)];
            case "str":
                let off = this.module.addData(enode.value);
                // TODO: Code to load the string
                throw "TODO";
            case "+":
            {
                let code = this.processExpression(f, scope, enode.lhs);
                code = code.concat(this.processExpression(f, scope, enode.rhs));
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
                return code;
            }
            case "*":
            case "-":
            {
                let code = this.processExpression(f, scope, enode.lhs);
                code = code.concat(this.processExpression(f, scope, enode.rhs));
                let storage = this.stackTypeOf(enode.type);
                let opcode: "mul" | "sub" = enode.op == "*" ? "mul" : "sub";
                if (storage == "f32" || storage == "f64") {
                    code.push(new wasm.BinaryFloatInstruction(storage, opcode))
                } else {
                    code.push(new wasm.BinaryIntInstruction(storage, opcode))
                }
                return code;
            }
            case "/":
            {
                let code = this.processExpression(f, scope, enode.lhs);
                code = code.concat(this.processExpression(f, scope, enode.rhs));
                let storage = this.stackTypeOf(enode.type);
                if (storage == "f32" || storage == "f64") {
                    code.push(new wasm.BinaryFloatInstruction(storage, "div"))
                } else {
                    let opcode: "div_u" | "div_s" = this.isSigned(enode.type) ? "div_s" : "div_u";
                    code.push(new wasm.BinaryIntInstruction(storage, opcode))
                }
                return code;
            }
            case "%":
            {
                let code = this.processExpression(f, scope, enode.lhs);
                code = code.concat(this.processExpression(f, scope, enode.rhs));
                let storage = this.stackTypeOf(enode.type);
                let opcode: "rem_u" | "rem_s" = this.isSigned(enode.type) ? "rem_s" : "rem_u";
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), opcode));
                return code;
            }
            case "|":
            case "&":
            case "^":
            {
                let opcode: "or" | "xor" | "and" = enode.op == "|" ? "or" : (enode.op == "&" ? "and" : "xor");
                let code = this.processExpression(f, scope, enode.lhs);
                code = code.concat(this.processExpression(f, scope, enode.rhs));
                let storage = this.stackTypeOf(enode.type);
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), opcode));
                return code;
            }
            case "&^":
            {
                let code = this.processExpression(f, scope, enode.lhs);
                code = code.concat(this.processExpression(f, scope, enode.rhs));
                let storage = this.stackTypeOf(enode.type);
                code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "and"));
                return code;
            }
            case "unary!":
            {
                let code = this.processExpression(f, scope, enode.rhs);
                code.push(new wasm.Constant("i32", 1));
                code.push(new wasm.BinaryIntInstruction("i32", "xor"));
                return code;                
            }
            case "id":
                let element = scope.resolveElement(enode.value);
                let code: Array<wasm.Node> = [];
                if (this.isRegisterSize(element.type)) {
                    this.loadElementOnStack(element, code);
                } else {
                    throw "TODO"
                }
                return code;
        }
        throw "CodeGen: Implementation error " + enode.op;
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
        throw "CodeGen: Implementation error: The type does not fit in a register"
    }

    public isRegisterSize(t: Type) {
        if (t == this.tc.t_double || t == this.tc.t_float || t == this.tc.t_int64 || this.tc.t_uint64 || t == this.tc.t_bool || t == this.tc.t_int8 || t == this.tc.t_uint8 ||t == this.tc.t_int16 || t == this.tc.t_uint16 || t == this.tc.t_int32 || t == this.tc.t_uint32) {
            return true;
        }
        return false;
    }

    public module: wasm.Module = new wasm.Module();

    private tc: TypeChecker;
}