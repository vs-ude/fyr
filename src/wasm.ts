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
        s += indent + "    (memory " + (this.dataSize + this.heapSize + this.stackSize).toString() + ")\n";
        for(let f of this.funcs) {
            s += f.toWast(indent + "    ") + "\n";
        }
        for(let d of this.data) {
            s += d.toWast(indent + "    ") + "\n";
        }
        for(let k of this.exports.keys()) {
            let v = this.exports.get(k);
            if (v instanceof Function) {
                s += indent + "    (export \"" + k + "\" (func " + v.index + "))\n";
            } else {
                throw "Implementation error";
            } 
        }
        return s + indent + ")";
    }

    public addData(value: string): [number, number] {
        let uint8array: Uint8Array = new textEncoding.TextEncoder("utf-8").encode(value);
        // TODO: Position on alignment
        let offset = this.dataSize;
        this.data.push(new Data(offset, uint8array));
        this.dataSize += uint8array.length + 2 * 4;
        return [offset, uint8array.length + 2 * 4];
    }

    public stackSize = 0;
    public heapSize = 1;
    public funcs: Array<Function> = [];
    public exports: Map<string, Node> = new Map<string, Node>();
    public dataSize: number = 0;
    public data: Array<Data> = [];
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
        let a32 = new Uint32Array([this.value.length]);
        let a8 = new Uint8Array(a32.buffer);
        let v = "\"\\" + this.uint8ToHex(a8[0]) + "\\" + this.uint8ToHex(a8[1]) + "\\" + this.uint8ToHex(a8[2]) + "\\" + this.uint8ToHex(a8[3]);
        v += "\\01\\00\\00\\00"; // Reference count of 1 -> the string is never deallocated
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
        for(let st of this.statements) {
            s += st.toWast(indent + "    ") + "\n";
        }
        return s + indent + ")";
    }

    public counterRegister(): number {
        return this.parameters.length;
    }

    public name: string;
    public index: number;
    public parameters: Array<StackType> = [];
    public locals: Array<StackType> = ["i32"]; // One for the counter register
    public results: Array<StackType> = [];
    public statements: Array<Node> = [];
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
        return indent + this.type + ".load" + (this.asType == null ? "" : this.asType) + (this.offset != 0 ? "offset=" + this.offset.toString() : "");
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
        return indent + this.type + ".store" + (this.asType == null ? "" : this.asType) + (this.offset != 0 ? "offset=" + this.offset.toString() : "");
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