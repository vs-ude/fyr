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
                s += indent + "    (export \"" + k + "\" (func $" + v.name + "))\n";
            } else {
                throw "Implementation error";
            } 
        }
        return s + indent + ")";
    }

    public addData(value: string): number {
        let o = this.dataSize;
        this.data.push(new Data(o, value));
        this.dataSize += value.length;
        return o;
    }

    public stackSize = 0;
    public heapSize = 0;
    public funcs: Array<Function> = [];
    public exports: Map<string, Node> = new Map<string, Node>();
    public dataSize: number = 0;
    public data: Array<Data> = [];
}

export class Data extends Node {
    constructor(offset: number, value: string) {
        super();
        this.offset = offset;
        this.value = value;
    }

    public get op(): string {
        return "data";
    }

    public toWast(indent: string): string {
        let v = "\"" + this.value + "\""; // TODO: Proper encoding
        return indent + "(data (i32.const " + this.offset.toString() + ") " + v + ")";
    }

    public offset: number;
    public value: string;
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

    public name: string;
    public parameters: Array<StackType> = [];
    public locals: Array<StackType> = [];
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
    constructor(type: StackType, asType: null | "8s" | "8u" | "16s" | "16u" | "32s" | "32u" = null, offset: number = 0) {
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
    public asType: null | "8s" | "8u" | "16s" | "16u" | "32s" | "32u"; 
}