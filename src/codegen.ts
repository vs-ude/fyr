import {Node, NodeOp} from "./ast"
import {Function, Type, UnsafePointerType, PointerType, FunctionType, ArrayType, SliceType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement, StorageLocation} from "./typecheck"
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
        // Copy SP to BP
        // TODO: Not necessary for some simple functions, optimize away
        func.statements.push(new wasm.GetLocal(func.spRegister()));
        if (func.localFyrFrameSize > 0) {
            func.statements.push(new wasm.TeeLocal(func.bpRegister()));
            func.statements.push(new wasm.Constant("i32", func.localFyrFrameSize));
            func.statements.push(new wasm.BinaryIntInstruction("i32", "add"));
            func.statements.push(new wasm.SetLocal(func.spRegister()));
        } else {
            func.statements.push(new wasm.SetLocal(func.bpRegister()));
        }

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

    public processScope(wf: wasm.Function, scope: Scope) {
        // TODO: The order is not deterministic
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Variable) {
                if (this.isRegisterSize(e.type)) {
                    e.storageLocation = "local";
                    e.storageIndex = wf.parameters.length + wf.locals.length;
                    wf.locals.push(this.stackTypeOf(e.type));
                } else {
                    e.storageLocation = "fyrBasePointer";
                    e.storageIndex = wf.localFyrFrameSize;
                    wf.localFyrFrameSize += 4 + this.sizeOf(e.type); // Space for typecode and data
                }
            } else if (e instanceof FunctionParameter) {
                if (this.isRegisterSize(e.type)) {
                    e.storageLocation = "local";
                    e.storageIndex = wf.parameters.length;
                    wf.parameters.push(this.stackTypeOf(e.type));
                } else {
                    e.storageLocation = "fyrBasePointer";
                    e.storageIndex = wf.localFyrFrameSize;
                    wf.localFyrFrameSize += 4 + this.sizeOf(e.type); // Space for typecode and data
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
                this.processExpression(f, snode.scope, snode.condition, wf, code);
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
                if (snode.rhs) { // Assignment of an expression value?
                    if (snode.lhs.op == "id") {
                        let element = scope.resolveElement(snode.lhs.value);
                        if (element.storageLocation == "fyrBasePointer" && this.isLeftHandSide(snode.rhs)) {
                            this.processLeftHandExpression(f, scope, snode.rhs, wf, false, code);
                            code.push(new wasm.GetLocal(wf.bpRegister()));
                            code.push(new wasm.Constant("i32", element.storageIndex));
                            this.copyElementOnHead(element.type, wf, code);
                        } else {
                            this.processExpression(f, scope, snode.rhs, wf, code);
                            this.storeElementFromStack(element, wf, code);
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
                        let element = scope.resolveElement(snode.lhs.value);
                        if (this.isRegisterSize(snode.lhs.type)) {
                            let storage = this.stackTypeOf(element.type);
                            code.push(new wasm.Constant(storage, 0));
                            this.storeElementFromStack(element, wf, code);
                        } else if (element.type == this.tc.t_string || element.type instanceof SliceType || element.type instanceof ArrayType) {
                            code.push(new wasm.GetLocal(wf.bpRegister()));
                            code.push(new wasm.Constant("i32", 0));
                            code.push(new wasm.Store("i32", null, element.storageIndex));
                            code.push(new wasm.GetLocal(wf.bpRegister()));
                            code.push(new wasm.Constant("i32", 0));
                            code.push(new wasm.Store("i32", null, element.storageIndex + 4));
                            code.push(new wasm.GetLocal(wf.bpRegister()));
                            code.push(new wasm.Constant("i32", 0));
                            code.push(new wasm.Store("i32", null, element.storageIndex + 8));                                                 
                        } else {
                            throw "TODO";
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
                if (snode.lhs.op == "tuple") {
                    throw "TODO"
                } else if (snode.lhs.op == "array") {
                    throw "TODO"                        
                } else if (snode.lhs.op == "object") {
                    throw "TODO"                        
                } else {
                    this.processLeftHandExpression(f, scope, snode.lhs, wf, false, code);
                    this.processExpression(f, scope, snode.rhs, wf, code);
                    this.processLeftHandAssignment(f, scope, snode.lhs, wf, false, code);
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
                this.processLeftHandExpression(f, scope, snode.lhs, wf, true, code);
                this.processLeftHandValue(f, scope, snode.lhs, wf, code);
                this.processExpression(f, scope, snode.rhs, wf, code);
                // TODO: String concatenation
                let storage = this.stackTypeOf(snode.lhs.type);
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
                        code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), this.isSigned(snode.lhs.type) ? "div_s" : "div_u"));                                
                    } else if (snode.op == "%=") {
                        code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), this.isSigned(snode.lhs.type) ? "rem_s" : "rem_u"));                                
                    } else if (snode.op == ">>=") {
                        code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), this.isSigned(snode.lhs.type) ? "shr_s" : "shr_u"));                                
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
                this.processLeftHandAssignment(f, scope, snode.lhs, wf, false, code);
                break;
            }
            case "--":
            case "++":
            {
                this.processLeftHandExpression(f, scope, snode.lhs, wf, true, code);
                this.processLeftHandValue(f, scope, snode.lhs, wf, code);               
                if (snode.lhs.type instanceof PointerType) {
                    throw "TODO"
                } else {
                    let storage = this.stackTypeOf(snode.lhs.type);
                    let increment = 1;
                    if (snode.lhs.type instanceof UnsafePointerType) {
                        increment = this.sizeOf(snode.lhs.type.elementType);
                    }
                    code.push(new wasm.Constant(storage, increment));
                    code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), snode.op == "++" ? "add" : "sub"));
                }
                this.processLeftHandAssignment(f, scope, snode.lhs, wf, false, code);
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
                            this.processExpression(f, snode.scope, snode.condition.condition, wf, code);
                            code.push(new wasm.UnaryIntInstruction("i32", "eqz"));
                            code.push(new wasm.BrIf(1));         
                        }
                    } else if (snode.condition.op == "in") {
                        throw "TODO"
                    } else if (snode.condition.op == "var_in" || snode.condition.op == "const_in") {
                        throw "TODO"
                    } else {
                        this.processExpression(f, snode.scope, snode.condition, wf, code);
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
                if (!snode.lhs) {
                    if (f.namedReturnTypes) {
                        let resultCount = 0;
                        for(let key of f.scope.elements.keys()) {
                            let v = f.scope.elements.get(key);
                            if (v instanceof Variable && v.isResult) {
                                if (v.storageLocation == "local") {
                                    // Load on WASM stack
                                    code.push(new wasm.GetLocal(v.storageIndex));
                                }
                            }
                        }
                    }
                    code.push(new wasm.Return());
                    return;
                }
                if (snode.lhs.type instanceof TupleType) {
                    throw "TODO";
                } else {
                    this.processExpression(f, scope, snode.lhs, wf, code);
                    code.push(new wasm.Return());
                }
                break;
            default:
                this.processExpression(f, scope, snode, wf, code);
                if (snode.type != this.tc.t_void) {
                    // Remove the value from the stack
                    if (this.isRegisterSize(snode.type)) {
                        code.push(new wasm.Drop);
                    } else  {
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.Constant("i32", this.sizeOf(snode.type)));
                        code.push(new wasm.BinaryIntInstruction("i32", "sub"));
                        code.push(new wasm.SetLocal(wf.spRegister()));
                    }
                }
        }
    }

    public processLeftHandExpression(f: Function, scope: Scope, enode: Node, wf: wasm.Function, readWrite: boolean, code: Array<wasm.Node>): void {
        switch(enode.op) {
            case "str":
            {
                let [off, len] = this.module.addData(enode.value);
                code.push(new wasm.Constant("i32", off));
                if (readWrite) {
                    throw "Implementation error";
                }
                break;
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                if (element.storageLocation == "fyrBasePointer") {
                    code.push(new wasm.GetLocal(wf.bpRegister()));
                    if (element.storageIndex != 0) {
                        code.push(new wasm.Constant("i32", element.storageIndex));
                        code.push(new wasm.BinaryIntInstruction("i32", "add"));
                    }
                    if (readWrite) {
                        code.push(new wasm.TeeLocal(wf.counterRegister()));
                        code.push(new wasm.GetLocal(wf.counterRegister()));
                    }
                }
                // Else do nothing by intention
                break;
            }
            case "unary*":
                this.processExpression(f, scope, enode.rhs, wf, code);
                if (readWrite) {
                    code.push(new wasm.TeeLocal(wf.counterRegister()));
                    code.push(new wasm.GetLocal(wf.counterRegister()));
                }
                break;
            case "[":
                if (enode.lhs.type instanceof UnsafePointerType) {
                    this.processExpression(f, scope, enode.lhs, wf, code); // ptr is on stack
                    let size = this.sizeOf(enode.lhs.type.elementType);
                    if (enode.rhs.op != "int") {
                        this.processExpression(f, scope, enode.rhs, wf, code); // ptr, index is on stack
                        if (size > 1) {
                            // TODO: If side is power of 2, shift bits
                            code.push(new wasm.Constant("i32", size)); // ptr, index, size is on stack
                            code.push(new wasm.BinaryIntInstruction("i32", "mul")); // ptr, offset is on stack             
                        }
                        code.push(new wasm.BinaryIntInstruction("i32", "add")); // ptr is on stack
                    }
                    if (readWrite) {
                        code.push(new wasm.TeeLocal(wf.counterRegister()));
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr, ptr is on stack
                    }
                } else if (enode.lhs.type instanceof PointerType) {
                    throw "TODO"
                } else if (enode.lhs.type instanceof SliceType || enode.lhs.type == this.tc.t_string) {
                    let additionalOffset = 0;
                    // Compute pointer to slice head and put it on the stack twice
                    if (this.isLeftHandSide(enode.lhs)) {
                        this.processLeftHandExpression(f, scope, enode.lhs, wf, true, code);
                    } else {
                        // Put the slice head on the stack
                        this.processExpression(f, scope, enode.lhs, wf, code);  // slice head is on the fyr stack
                        additionalOffset = 4;
                        code.push(new wasm.GetLocal(wf.spRegister())); // sp
                        code.push(new wasm.Constant("i32", 4 + 12));
                        code.push(new wasm.BinaryIntInstruction("i32", "sub"));
                        code.push(new wasm.TeeLocal(wf.counterRegister())); // ptr to slice head (with additionalOffset 4 because of the type code) is on stack
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to slice head, ptr to slice head is on stack
                        code.push(new wasm.GetLocal(wf.counterRegister()));
                    }
//                    code.push(new wasm.TeeLocal(wf.counterRegister())); // ptr to slice head is on stack
//                    code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to slice head, ptr to slice head is on stack
                    let size = enode.lhs.type instanceof SliceType ? this.sizeOf(enode.lhs.type.elementType) : 1;
                    let index = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        this.processExpression(f, scope, enode.rhs, wf, code); // ptr to slice head, ptr to slice head, index is on stack
                        code.push(new wasm.SetLocal(wf.counterRegister())); // index is in counter register; ptr to slice head, ptr to slice head is on stack
                    }
                    // Load max index from slice head and compare to index
                    code.push(new wasm.Load("i32", null, additionalOffset + 8)); // ptr to slice head, max-index is on stack
                    if (enode.rhs.op == "int") {
                        code.push(new wasm.Constant("i32", index));
                    } else {
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to slice head, max-index, index is on stack
                    }
                    code.push(new wasm.BinaryIntInstruction("i32", "le_s")); // ptr to slice head, bool is on stack
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
                    if (!this.isLeftHandSide(enode.lhs)) {
                        // Remove slice head from the fyr stack
                        code.push(new wasm.SetLocal(wf.spRegister()));
                    }
                    if (readWrite) {
                        code.push(new wasm.TeeLocal(wf.counterRegister()));
                        code.push(new wasm.GetLocal(wf.counterRegister())); // ptr to element, ptr to element is on stack
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

    public processLeftHandValue(f: Function, scope: Scope, enode: Node, wf: wasm.Function, code: Array<wasm.Node>): void {
        if (enode.op == "id") {
            let element = scope.resolveElement(enode.value);
            if (element.storageLocation == "local") {
                code.push(new wasm.GetLocal(element.storageIndex));
                return;
            } else if (element.storageLocation == "global") {
                code.push(new wasm.GetGlobal(element.storageIndex));
                return;
            }
        }
        // There is a pointer on the wasm stack
        if (this.isRegisterSize(enode.type)) {
            this.loadHeapWordOnStack(enode.type, 0, code);
        } else if (this.sizeOf(enode.type) == 12) {
            throw "TODO: Copy data from heap to FYR stack";
        } else {
            throw "TODO: Copy data from heap to FYR stack";
        }
    }

    public processLeftHandAssignment(f: Function, scope: Scope, enode: Node, wf: wasm.Function, valueOnStack: boolean, code: Array<wasm.Node>): void {
        switch (enode.op) {
            case "str":
                throw "CodeGen: Implementation error, cannot assign to string constant";
            case "id":
                let element = scope.resolveElement(enode.value);
                if (valueOnStack) {
                    this.storeElementFromStack(element, wf, code);
                } else {
                    throw "TODO"
                }
                break;
            case "unary*":
                if (this.isRegisterSize(enode.type)) {
                    if (!valueOnStack) {
                        this.loadHeapWordOnStack(enode.type, 0, code);
                    }
                    this.storeHeapWordFromStack(enode.type, 0, code);
                } else if (this.sizeOf(enode.type) == 12) {
                    if (valueOnStack) {
                        // Load ptr in register and copy there from the stack
                        code.push(new wasm.TeeLocal(wf.counterRegister())); // ptr is on stack and register
                        code.push(new wasm.GetLocal(wf.spRegister())); // ptr, sp is on stack
                        code.push(new wasm.Constant("i32", 4 + 12));
                        code.push(new wasm.BinaryIntInstruction("i32", "sub")); // ptr, sp is on stack
                        code.push(new wasm.TeeLocal(wf.spRegister())); // ptr, sp is on stack
                        code.push(new wasm.Load("i32", null, 4)); // ptr, value is on stack
                        code.push(new wasm.Store("i32", null, 0)); // empty stack
                        code.push(new wasm.GetLocal(wf.counterRegister()));
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.Load("i32", null, 8)); // ptr, value is on stack
                        code.push(new wasm.Store("i32", null, 4)); // empty stack
                        code.push(new wasm.GetLocal(wf.counterRegister()));
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.Load("i32", null, 12)); // ptr, value is on stack
                        code.push(new wasm.Store("i32", null, 8)); // empty stack
                    } else {
                        throw "TODO"
                    }
                } else {
                    throw "TODO: Copy data from FYR stack to address and change FYR stack";
                }
                break;
            case "[":
                if (enode.lhs.type instanceof UnsafePointerType) {
                    if (this.isRegisterSize(enode.lhs.type.elementType)) {
                        let offset: number = 0;
                        if (enode.rhs.op == "int") {
                            let size = this.sizeOf(enode.lhs.type.elementType);
                            offset = parseInt(enode.rhs.value) * size;
                        }
                        if (!valueOnStack) {
                            this.loadHeapWordOnStack(enode.type, 0, code);
                        }
                        this.storeHeapWordFromStack(enode.lhs.type.elementType, offset, code);
                    } else {
                        throw "TODO"
                    }
                } else {
                    throw "TODO"
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

    public processExpression(f: Function, scope: Scope, enode: Node, wf: wasm.Function, code: Array<wasm.Node>): void {
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
                let [off, len] = this.module.addData(enode.value);
                code.push(new wasm.GetLocal(wf.spRegister()));
                code.push(new wasm.Constant('i32', 0)); // TODO: Type code
                code.push(new wasm.Store("i32", null, 0));
                code.push(new wasm.GetLocal(wf.spRegister()));
                code.push(new wasm.Constant('i32', off));
                code.push(new wasm.Store("i32", null, 4));
                code.push(new wasm.GetLocal(wf.spRegister()));
                code.push(new wasm.Constant('i32', off));
                code.push(new wasm.Store("i32", null, 8));
                code.push(new wasm.GetLocal(wf.spRegister()));
                code.push(new wasm.Constant('i32', len));
                code.push(new wasm.Store("i32", null, 12));
                code.push(new wasm.GetLocal(wf.spRegister()));
                code.push(new wasm.Constant("i32", 12 + 4));
                code.push(new wasm.BinaryIntInstruction("i32", "add"));
                code.push(new wasm.SetLocal(wf.spRegister()));
                break;
            case "==":
                if (enode.lhs.type instanceof BasicType) {
                    this.processCompare("eq", f, scope, enode, wf, code);
                } else {
                    throw "TODO"
                }
                break;
            case "!=":
                if (enode.lhs.type instanceof BasicType) {
                    this.processCompare("ne", f, scope, enode, wf, code);
                } else {
                    throw "TODO"
                }
                break;
            case "<":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("lt", f, scope, enode, wf, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("lt_s", f, scope, enode, wf, code);
                } else {
                    this.processCompare("lt_u", f, scope, enode, wf, code);
                }
                break;
            case ">":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("gt", f, scope, enode, wf, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("gt_s", f, scope, enode, wf, code);
                } else {
                    this.processCompare("gt_u", f, scope, enode, wf, code);
                }
                break;
            case "<=":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("le", f, scope, enode, wf, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("le_s", f, scope, enode, wf, code);
                } else {
                    this.processCompare("le_u", f, scope, enode, wf, code);
                }
                break;
            case ">=":
                if (enode.lhs.type == this.tc.t_float || enode.lhs.type == this.tc.t_double || enode.lhs.type == this.tc.t_string) {
                    this.processCompare("ge", f, scope, enode, wf, code);
                } else if (this.isSigned(enode.lhs.type)) {
                    this.processCompare("ge_s", f, scope, enode, wf, code);
                } else {
                    this.processCompare("ge_u", f, scope, enode, wf, code);
                }
                break;
            case "+":
            {
                this.processExpression(f, scope, enode.lhs, wf, code);
                this.processExpression(f, scope, enode.rhs, wf, code);
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
                this.processExpression(f, scope, enode.lhs, wf, code);
                this.processExpression(f, scope, enode.rhs, wf, code);
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
                this.processExpression(f, scope, enode.lhs, wf, code);
                this.processExpression(f, scope, enode.rhs, wf, code);
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
                this.processExpression(f, scope, enode.lhs, wf, code);
                this.processExpression(f, scope, enode.rhs, wf, code);
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
                this.processExpression(f, scope, enode.lhs, wf, code);
                this.processExpression(f, scope, enode.rhs, wf, code);
                let storage = this.stackTypeOf(enode.type);
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), opcode));
                break;
            }
            case "&^":
            {
                this.processExpression(f, scope, enode.lhs, wf, code);
                this.processExpression(f, scope, enode.rhs, wf, code);
                let storage = this.stackTypeOf(enode.type);
                code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "and"));
                break;
            }
            case "unary!":
            {
                this.processExpression(f, scope, enode.rhs, wf, code);
                code.push(new wasm.UnaryIntInstruction("i32", "eqz"));
                break;                
            }
            case "unary+":
            {
                this.processExpression(f, scope, enode.rhs, wf, code);
                break;                
            }
            case "unary-":
            {
                this.processExpression(f, scope, enode.rhs, wf, code);
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
                this.processExpression(f, scope, enode.rhs, wf, code);
                let storage = this.stackTypeOf(enode.rhs.type);
                code.push(new wasm.Constant(storage as ("i32" | "i64"), -1));
                code.push(new wasm.BinaryIntInstruction(storage as ("i32" | "i64"), "xor"));
                break;
            }
            case "unary*":
            {
                this.processExpression(f, scope, enode.rhs, wf, code);
                if (enode.rhs.type instanceof UnsafePointerType) {
                    let storage = this.stackTypeOf(enode.rhs.type.elementType);
                    if (this.isRegisterSize(enode.rhs.type.elementType)) {
                        this.loadHeapWordOnStack(enode.rhs.type.elementType, 0, code);
                    } else {
                        throw "TODO"
                    }
                } else if (enode.rhs.type instanceof PointerType) {
                    throw "TODO"
                }                                
                break;
            }
            case "||":
            {
                this.processExpression(f, scope, enode.lhs, wf, code);
                code.push(new wasm.If(["i32"]));
                code.push(new wasm.Constant("i32", 1));
                code.push(new wasm.Else());
                this.processExpression(f, scope, enode.rhs, wf, code);
                code.push(new wasm.End());
                break;
            }
            case "&&":
            {
                this.processExpression(f, scope, enode.lhs, wf, code);
                code.push(new wasm.If(["i32"]));
                this.processExpression(f, scope, enode.rhs, wf, code);
                code.push(new wasm.Else());
                code.push(new wasm.Constant("i32", 0));
                code.push(new wasm.End());
                break;
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                if (element.storageLocation == "local") {
                    code.push(new wasm.GetLocal(element.storageIndex));
                } else if (element.storageLocation == "global") {
                    code.push(new wasm.GetGlobal(element.storageIndex));
                } else {
                    let size = this.sizeOf(element.type);
                    if (size == 12) {
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.GetLocal(wf.bpRegister()));
                        code.push(new wasm.Load("i32", null, element.storageIndex));
                        code.push(new wasm.Store("i32", null, 0));
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.GetLocal(wf.bpRegister()));
                        code.push(new wasm.Load("i32", null, element.storageIndex + 4));
                        code.push(new wasm.Store("i32", null, 4));
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.GetLocal(wf.bpRegister()));
                        code.push(new wasm.Load("i32", null, element.storageIndex + 8));
                        code.push(new wasm.Store("i32", null, 8));
                        code.push(new wasm.GetLocal(wf.spRegister()));
                        code.push(new wasm.Constant("i32", 12));
                        code.push(new wasm.BinaryIntInstruction("i32", "add"));
                        code.push(new wasm.SetLocal(wf.spRegister()));                        
                    } else {
                        code.push(new wasm.GetLocal(wf.bpRegister()));
                        code.push(new wasm.Constant("i32", element.storageIndex));
                        code.push(new wasm.BinaryIntInstruction("i32", "add"));
                        throw "TODO: Call memcpy";
                    }
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
                
                if (t.hasEllipsis()) {
                    throw "TODO"
                } else {
                    for(let pnode of enode.parameters) {
                        this.processExpression(f, scope, pnode, wf, code);
                    }
                }
                
                // Put fyrStackPointer on the wasm Stack
                // TODO: Might not be required for some simple functions
                code.push(new wasm.GetLocal(wf.spRegister()));
                if (f) {
                    code.push(new wasm.Call(f.storageIndex));
                } else {
                    throw "TODO: call a lambda function"
                }

                // TODO: Remove data from the fyrStack
                break;
            }
            case "[":
            {
                this.processLeftHandExpression(f, scope, enode, wf, false, code);
                this.processLeftHandValue(f, scope, enode, wf, code);
                break;
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    private processCompare(opcode: wasm.BinaryFloatOp | wasm.BinaryIntOp, f: Function, scope: Scope, enode: Node, wf: wasm.Function, code: Array<wasm.Node>) {
        this.processExpression(f, scope, enode.lhs, wf, code);
        this.processExpression(f, scope, enode.rhs, wf, code);
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

    public storeElementFromStack(e: ScopeElement, wf: wasm.Function, code: Array<wasm.Node>) {
        if (e instanceof FunctionParameter || e instanceof Variable) {
            if (e.storageLocation == "local") {
                code.push(new wasm.SetLocal(e.storageIndex));
            } else if (e.storageLocation == "global") {
                code.push(new wasm.SetGlobal(e.storageIndex));
            } else {
                let size = this.sizeOf(e.type);
                code.push(new wasm.GetLocal(wf.spRegister()));
                code.push(new wasm.Constant("i32", 4 + size));
                code.push(new wasm.BinaryIntInstruction("i32", "sub"));
                code.push(new wasm.SetLocal(wf.spRegister()));       
                if (size == 12) {
                    code.push(new wasm.GetLocal(wf.bpRegister()));
                    code.push(new wasm.GetLocal(wf.spRegister()));
                    code.push(new wasm.Load("i32", null, 4));
                    code.push(new wasm.Store("i32", null, e.storageIndex));
                    code.push(new wasm.GetLocal(wf.bpRegister()));
                    code.push(new wasm.GetLocal(wf.spRegister()));
                    code.push(new wasm.Load("i32", null, 8));
                    code.push(new wasm.Store("i32", null, e.storageIndex + 4));
                    code.push(new wasm.GetLocal(wf.bpRegister()));
                    code.push(new wasm.GetLocal(wf.spRegister()));
                    code.push(new wasm.Load("i32", null, 12));
                    code.push(new wasm.Store("i32", null, e.storageIndex +8));
                } else {
                    throw "TODO call memcpy"
                }                 
            }
        }
    }

    public copyElementOnHead(t: Type, wf: wasm.Function, code: Array<wasm.Node>) {
        let size = this.sizeOf(t);
        if (size == 12) {
            if (size == 12) {
                throw "TODO"
            }
        } else {
            throw "TODO"
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
        } else if (t == this.tc.t_uint8 || t == this.tc.t_bool) {
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
        if (t == this.tc.t_string || t instanceof ArrayType || t instanceof SliceType) {
            return 12;
        }
        throw "TODO";
    }

    public isRegisterSize(t: Type) {
        if (t == this.tc.t_double || t == this.tc.t_float || t == this.tc.t_int64 || t == this.tc.t_uint64 || t == this.tc.t_bool || t == this.tc.t_int8 || t == this.tc.t_uint8 ||t == this.tc.t_int16 || t == this.tc.t_uint16 || t == this.tc.t_int32 || t == this.tc.t_uint32) {
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