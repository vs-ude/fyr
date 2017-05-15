import * as textEncoding from "text-encoding";

export abstract class Node {
    public abstract get op(): string;
    public abstract toWast(indent: string): string;
}

export type StackType = "i32" | "i64" | "f32" | "f64";

let nameCounter = 0;

export class Module extends Node {
    public get op(): string {
        return "module";
    }

    public toWast(indent: string): string {
        let s = indent + "(module\n";
        s += indent + "    (memory " + Math.ceil((this.dataSize + this.heapSize + this.stackSize) / 65536).toString() + ")\n";
        for(let f of this.funcs) {
            s += f.toWast(indent + "    ") + "\n";
        }
        for(let d of this.data) {
            s += d.toWast(indent + "    ") + "\n";
        }
        let index = this.funcs.length;
        for(let k of this.exports.keys()) {
            let v = this.exports.get(k);
            if (v instanceof Function) {
                /*
                s += "    (func ";
                for(let i = 1; i < v.parameters.length; i++) {
                    s += " (param " + v.parameters[i] + ")";
                } 
                for(let p of v.results) {
                    s += " (result " + p + ")";
                } 
                s += "\n        i32.const " + (this.dataSize + this.heapSize).toString() + "\n";
                for(let i = 1; i < v.parameters.length; i++) {
                    s += "        get_local " + (i-1).toString() + "\n";
                }
                s += "        call " + v.index + "\n";
                if (v.results.length != 0) {
                    s += "        return\n";
                }
                s += "    )\n";
                */
                s += indent + "    (export \"" + k + "\" (func " + v.index.toString() + "))\n";
                index++;
            } else {
                throw "Implementation error";
            } 
        }

        if (this.funcTable.length > 0) {
            s += indent + "    (table " + this.funcTable.length + " anyfunc)\n";
            s += indent + "    (elem (i32.const 0)";
            for(let f of this.funcTable) {
                s += " " + f.index.toString();
            }
            s += ")\n";
        }

        for(let f of this.funcTypes) {
            s += indent + "    (type " + f.name + " ";
            if (f.params.length > 0) {
                s += "(param";
                for(let t of f.params) {
                    s += " " + t.toString();
                }
                s += ") ";
            }
            if (f.results.length > 0) {
                s += "(result";
                for(let t of f.results) {
                    s += " " + t.toString();
                }
                s += ") ";
            }
            s += ")\n";
        }

        return s + indent + ")";
    }

    public addData(value: string): [number, number] {
        let uint8array: Uint8Array = new textEncoding.TextEncoder("utf-8").encode(value);
        let offset = this.dataSize;
        this.data.push(new Data(offset, uint8array));
        this.dataSize += align64(12 + uint8array.length);
        return [offset, uint8array.length];
    }

    public stackSize = 1 * 65536;
    public heapSize = 1 * 65536;
    public funcs: Array<Function> = [];
    public funcTable: Array<Function> = [];
    public funcTypes: Array<FunctionType> = [];
    public exports: Map<string, Node> = new Map<string, Node>();
    public dataSize: number = 0;
    public data: Array<Data> = [];
}

export class FunctionType {
    constructor(name: string, params: Array<StackType>, results: Array<StackType>) {
        this.name = name;
        this.params = params;
        this.results = results;
    }

    public name: string;
    public params: Array<StackType> = [];
    public results: Array<StackType> = [];
}

export class Data extends Node {
    constructor(offset: number, value: Uint8Array) {
        super();
        this.offset = offset;
        this.value = value;
    }

    public get op(): string {
        return "data";
    }

    public toWast(indent: string): string {
        let a32 = new Uint32Array([this.offset + 12, this.offset + 12, this.value.length]);
        let a8 = new Uint8Array(a32.buffer);
        let v = "\"\\" + this.uint8ToHex(a8[0]) + "\\" + this.uint8ToHex(a8[1]) + "\\" + this.uint8ToHex(a8[2]) + "\\" + this.uint8ToHex(a8[3]);
        v += "\\" + this.uint8ToHex(a8[4]) + "\\" + this.uint8ToHex(a8[5]) + "\\" + this.uint8ToHex(a8[6]) + "\\" + this.uint8ToHex(a8[7]);
        v += "\\" + this.uint8ToHex(a8[8]) + "\\" + this.uint8ToHex(a8[9]) + "\\" + this.uint8ToHex(a8[10]) + "\\" + this.uint8ToHex(a8[11]);
        for(let i = 0; i < this.value.length; i++) {
            v += "\\" + this.uint8ToHex(this.value[i]);
        }
        v += "\"";
        return indent + "(data (i32.const " + this.offset.toString() + ") " + v + ")";
    }

    private uint8ToHex(x: number) {
        let s = x.toString(16);
        if (s.length == 1) {
            return "0" + s;
        }
        return s;
    }

    public offset: number;
    public value: Uint8Array;
}

export class Function extends Node {
    constructor(name?: string) {
        super();
        if (!name) {
            this.name = "f" + nameCounter.toString();
            nameCounter++;
        } else {
            this.name = name;
        }
    }

    public get op(): string {
        return "function";
    }

    public toWast(indent: string): string {
        let s = indent + "(func $" + this.name;
        for(let p of this.parameters) {
            s += " (param " + p + ")";
        } 
        for(let p of this.results) {
            s += " (result " + p + ")";
        } 
        for(let p of this.locals) {
            s += " (local " + p + ")";
        } 
        s += "\n";
        let i = indent;
        for(let st of this.statements) {
            if (st.op == "end") {
                i = i.substr(0, i.length - 4);
            } else if (st.op == "else") {
                i = i.substr(0, i.length - 4);                
            }
            s += st.toWast(i + "    ") + "\n";
            if (st.op == "block" || st.op == "loop" || st.op == "if" || st.op == "else") {
                i += "    ";
            }
        }
        return s + indent + ")";
    }

    public spRegister(): number {
        throw "OBSOLETE";
    }

    public bpRegister(): number {
        throw "OBSOLETE";
    }

    public counterRegister(): number {
        throw "OBSOLETE";
    }

    public name: string;
    public index: number;
    public parameters: Array<StackType> = [];
    public locals: Array<StackType> = [];
    public results: Array<StackType> = [];
    public statements: Array<Node> = [];
    public localFyrFrameSize: number = 0;
}

export class Constant extends Node {
    constructor(type: StackType, value: number) {
        super();
        this.type = type;
        this.value = value;
    }

    public get op(): string {
        return this.type + ".const";
    }

    public toWast(indent: string): string {
        return indent + this.op + " " + this.value.toString();
    }

    public value: number;  
    public type: StackType;  
}

export class Drop extends Node {
    public get op(): string {
        return "drop";
    }

    public toWast(indent: string): string {
        return indent + "drop";
    }   
}

export type BinaryOp = "add" | "sub" | "mul" | "div" | "div_s" | "div_u" | "rem_s" | "rem_u" | "and" | "or" | "xor" | "shl" | "shr_u" | "shr_s" | "rotl" | "rotr" | "eq" | "neq" | "lt_s" | "lt_u" | "le_s" | "le_u" | "gt_s" | "gt_u" | "ge_s" | "ge_u" | "lt" | "gt" | "le" | "ge" | "min" | "max";

export class BinaryInstruction extends Node {
    constructor(type: StackType, op: BinaryOp) {
        super();
        this.binaryOp = op;
        this.type = type;
    }

    public get op(): string {
        return this.type + "." + this.binaryOp;
    }

    public toWast(indent: string): string {
        return indent + this.type + "." + this.binaryOp;
    }   

    public type: StackType;
    public binaryOp: BinaryOp;
}

export type UnaryOp = "eqz" | "clz" | "ctz" | "popcnt" | "neg" | "abs" | "copysign" | "ceil" | "floor" | "trunc" | "nearest" | "sqrt";

export class UnaryInstruction extends Node {
    constructor(type: StackType, op: UnaryOp) {
        super();
        this.unaryOp = op;
        this.type = type;
    }

    public get op(): string {
        return this.type + "." + this.unaryOp;
    }

    public toWast(indent: string): string {
        return indent + this.type + "." + this.unaryOp;
    }   

    public type: StackType;
    public unaryOp: UnaryOp;
}


export type BinaryIntOp = "add" | "sub" | "mul" | "div_s" | "div_u" | "rem_s" | "rem_u" | "and" | "or" | "xor" | "shl" | "shr_u" | "shr_s" | "rotl" | "rotr" | "eq" | "neq" | "lt_s" | "lt_u" | "le_s" | "le_u" | "gt_s" | "gt_u" | "ge_s" | "ge_u";

export class BinaryIntInstruction extends Node {
    constructor(type: "i32" | "i64", op: BinaryIntOp) {
        super();
        this.intOp = op;
        this.type = type;
    }

    public get op(): string {
        return this.type + "." + this.intOp;
    }

    public toWast(indent: string): string {
        return indent + this.type + "." + this.intOp;
    }   

    public type: "i32" | "i64";
    public intOp: BinaryIntOp;
}

export type UnaryIntOp = "eqz" | "clz" | "ctz" | "popcnt";

export class UnaryIntInstruction extends Node {
    constructor(type: "i32" | "i64", op: UnaryIntOp) {
        super();
        this.intOp = op;
        this.type = type;
    }

    public get op(): string {
        return this.type + "." + this.intOp;
    }

    public toWast(indent: string): string {
        return indent + this.type + "." + this.intOp;
    }   

    public type: "i32" | "i64";
    public intOp: UnaryIntOp;
}

export type BinaryFloatOp = "add" | "sub" | "mul" | "div" | "eq" | "ne" | "le" | "lt" | "ge" | "gt" | "min" | "max";

export class BinaryFloatInstruction extends Node {
    constructor(type: "f32" | "f64", op: BinaryFloatOp) {
        super();
        this.intOp = op;
        this.type = type;
    }

    public get op(): string {
        return this.type + "." + this.intOp;
    }

    public toWast(indent: string): string {
        return indent + this.type + "." + this.intOp;
    }   

    public type: "f32" | "f64";
    public intOp: BinaryFloatOp;
}

export type UnaryFloatOp = "neg" | "abs" | "copysign" | "ceil" | "floor" | "trunc" | "nearest" | "sqrt";

export class UnaryFloatInstruction extends Node {
    constructor(type: "f32" | "f64", op: UnaryFloatOp) {
        super();
        this.intOp = op;
        this.type = type;
    }

    public get op(): string {
        return this.type + "." + this.intOp;
    }

    public toWast(indent: string): string {
        return indent + this.type + "." + this.intOp;
    }   

    public type: "f32" | "f64";
    public intOp: UnaryFloatOp;
}

export class Return extends Node {
    public get op(): string {
        return "return";
    }

    public toWast(indent: string): string {
        return indent + "return";
    }       
}

export class GetLocal extends Node {
    constructor(index: number) {
        super();
        this.index = index;
    }

    public get op(): string {
        return "get_local";
    }

    public toWast(indent: string): string {
        return indent + "get_local " + this.index.toString();
    }

    public index: number;
}

export class GetGlobal extends Node {
    constructor(index: number) {
        super();
        this.index = index;
    }

    public get op(): string {
        return "get_global";
    }

    public toWast(indent: string): string {
        return indent + "get_global " + this.index.toString();
    }
    
    public index: number;
}

export class SetLocal extends Node {
    constructor(index: number) {
        super();
        this.index = index;
    }

    public get op(): string {
        return "set_local";
    }

    public toWast(indent: string): string {
        return indent + "set_local " + this.index.toString();
    }

    public index: number;
}

export class TeeLocal extends Node {
    constructor(index: number) {
        super();
        this.index = index;
    }

    public get op(): string {
        return "tee_local";
    }

    public toWast(indent: string): string {
        return indent + "tee_local " + this.index.toString();
    }

    public index: number;
}

export class SetGlobal extends Node {
    constructor(index: number) {
        super();
        this.index = index;
    }

    public get op(): string {
        return "set_global";
    }

    public toWast(indent: string): string {
        return indent + "set_global " + this.index.toString();
    }
    
    public index: number;
}

export class Load extends Node {
    constructor(type: StackType, asType: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null, offset: number = 0) {
        super();
        this.type = type;
        this.asType = asType;
        this.offset = offset;
    }

    public get op(): string {
        return "load";
    }

    public toWast(indent: string): string {
        return indent + this.type + ".load" + (this.asType == null ? "" : this.asType) + (this.offset != 0 ? " offset=" + this.offset.toString() : "");
    }       

    public type: StackType;
    public offset: number;
    public asType: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u"; 
}

export class Store extends Node {
    constructor(type: StackType, asType: null | "8"| "16" | "32" = null, offset: number = 0) {
        super();
        this.type = type;
        this.asType = asType;
        this.offset = offset;
    }

    public get op(): string {
        return "store";
    }

    public toWast(indent: string): string {
        return indent + this.type + ".store" + (this.asType == null ? "" : this.asType) + (this.offset != 0 ? " offset=" + this.offset.toString() : "");
    }       

    public type: StackType;
    public offset: number;
    public asType: null | "8" | "16" | "32"; 
}

export class If extends Node {
    constructor(blockType: Array<StackType> = null) {
        super();
        this.blockType = blockType;
    }

    public get op(): string {
        return "if";
    }    

    public toWast(indent: string): string {
        let s = indent + "if";
        if (this.blockType) {
            for(let st of this.blockType) {
                s += " " + st;
            }
        }
        return s;
    }

    public blockType: Array<StackType>;
}

export class Else extends Node {
    public get op(): string {
        return "else";
    }    

    public toWast(indent: string): string {
        return indent + "else";
    }
}

export class Block extends Node {
    public get op(): string {
        return "block";
    }    

    public toWast(indent: string): string {
        return indent + "block";
    }
}

export class Loop extends Node {
    public get op(): string {
        return "loop";
    }    

    public toWast(indent: string): string {
        return indent + "loop";
    }
}

export class End extends Node {
    public get op(): string {
        return "end";
    }    

    public toWast(indent: string): string {
        return indent + "end";
    }
}

export class Call extends Node {
    constructor(index: number) {
        super();
        this.index = index;
    }

    public get op(): string {
        return "call";
    }    

    public toWast(indent: string): string {
        return indent + "call " + this.index.toString();
    }

    public index: number;
}

export class Br extends Node {
    constructor(depth: number) {
        super();
        this.depth = depth;
    }

    public get op(): string {
        return "br";
    }    

    public toWast(indent: string): string {
        return indent + "br " + this.depth.toString();
    }

    public depth: number;
}

export class BrIf extends Node {
    constructor(depth: number) {
        super();
        this.depth = depth;
    }

    public get op(): string {
        return "br_if";
    }    

    public toWast(indent: string): string {
        return indent + "br_if " + this.depth.toString();
    }

    public depth: number;
}

export class BrTable extends Node {
    constructor(depths: Array<number>) {
        super();
        this.depths = depths;
    }

    public get op(): string {
        return "br_table";
    }    

    public toWast(indent: string): string {
        return indent + "br_table " + this.depths.join(" ");
    }

    public depths: Array<number>;
}

export class Unreachable extends Node {
    public get op(): string {
        return "unreachable";
    }    

    public toWast(indent: string): string {
        return indent + "unreachable";
    }
}

export class Comment extends Node {
    constructor(comment: string) {
        super();
        this.comment = comment;
    }

    public get op(): string {
        return ";;";
    }    

    public toWast(indent: string): string {
        return indent + ";; " + this.comment;
    }

    public comment: string;
}

function align64(x: number): number {
    return (x + 7) & -8;
}