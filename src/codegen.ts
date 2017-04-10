import {Node, NodeOp} from "./ast"
import {Function, FunctionType, TypeChecker, TupleType, BasicType} from "./typecheck"
import * as wasm from "./wasm"

export class CodeGenerator {
    constructor(tc: TypeChecker) {
        this.tc = tc;
    }

    public processFunction(f: Function, exportFunc: boolean = false) {
        let func = new wasm.Function(f.name);
        // TODO: Parameters
        if (f.type.returnType != this.tc.t_void) {
            // TODO: namedReturnType
            if (f.type.returnType instanceof TupleType) {
                // TODO
            } else if (f.type.returnType == this.tc.t_string) {
                // TODO
            } else if (f.type.returnType == this.tc.t_error) {
                // TODO
            } else if (f.type.returnType instanceof BasicType) {
                func.results.push(this.storageTypeOf(f.type.returnType));
            } else {

            }
        }
        for(let node of f.node.statements) {
            func.statements = func.statements.concat(this.processStatement(node));
        }
        if (exportFunc) {
            this.module.exports.set(f.name, func);
        } 
        this.module.funcs.push(func);
    }

    public processStatement(snode: Node): Array<wasm.Node> {
        switch(snode.op) {
            case "return":
                if (!snode.lhs) {
                    // TODO: Named return types
                    return [new wasm.Return()];
                }
                if (snode.lhs.type instanceof TupleType) {
                    // TODO
                } else {
                    let n = this.processExpression(snode.lhs);
                    n.push(new wasm.Return());
                    return n;
                }
                break;
            // TODO
        }
        let n = this.processExpression(snode);
        if (snode.type != this.tc.t_void) {
            // TODO: How much should be dropped?
            n.push(new wasm.Drop);
        }
        return n;
    }

    public processExpression(enode: Node): Array<wasm.Node> {
        switch(enode.op) {
            case "int":
                if (enode.type == this.tc.t_int8 || enode.type == this.tc.t_int16 || enode.type == this.tc.t_int32) {
                    return [new wasm.Constant("i32", parseInt(enode.value))];
                } else if (enode.type == this.tc.t_int64) {
                    return [new wasm.Constant("i64", parseInt(enode.value))];                    
                } else if (enode.type == this.tc.t_uint8 || enode.type == this.tc.t_uint16 || enode.type == this.tc.t_uint32) {
                    return [new wasm.Constant("i32", parseInt(enode.value))];
                } else if (enode.type == this.tc.t_uint64) {
                    return [new wasm.Constant("i64", parseInt(enode.value))];                    
                }
                break;
            case "float":
                if (enode.type == this.tc.t_float) {
                    return [new wasm.Constant("f32", parseFloat(enode.value))];
                } else {
                    return [new wasm.Constant("f64", parseFloat(enode.value))];
                }
            case "bool":
                return [new wasm.Constant("i32", enode.value == "true" ? 1 : 0)];
            case "str":
                let off = this.module.addData(enode.value);
                // TODO: Code to load the string
                throw "TODO";
            case "+":
                let n = this.processExpression(enode.lhs);
                n = n.concat(this.processExpression(enode.rhs));
                if (enode.lhs.type == this.tc.t_int64 || enode.lhs.type == this.tc.t_uint64) {
                    n.push(new wasm.BinaryIntInstruction("i64", "add"))
                } else if (enode.lhs.type == this.tc.t_string) {
                    throw "TODO"
                } else if (enode.lhs.type == this.tc.t_float) {
                    n.push(new wasm.BinaryFloatInstruction("f32", "add"))
                } else if (enode.lhs.type == this.tc.t_double) {
                    n.push(new wasm.BinaryFloatInstruction("f64", "add"))
                } else {
                    n.push(new wasm.BinaryIntInstruction("i32", "add"))
                }
                return n;
        }
        throw "Implementation error";
    }

    public storageTypeOf(t: BasicType): wasm.StorageType {
        if (t == this.tc.t_bool || t == this.tc.t_int8 || t == this.tc.t_uint8 ||t == this.tc.t_int16 || t == this.tc.t_uint16 || t == this.tc.t_int32 || t == this.tc.t_uint32) {
            return "i32";
        }
        if (t == this.tc.t_int64 || this.tc.t_uint64) {
            return "i64";
        }
        if (t == this.tc.t_float) {
            return "f32";
        }
        return "f64";
    }

    public module: wasm.Module = new wasm.Module();

    private tc: TypeChecker;
}