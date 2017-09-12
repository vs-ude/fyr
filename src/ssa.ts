import * as wasm from "./wasm"
import {TypeMapper, TypeMap} from "./gc"
import {SystemCalls} from "./pkg"

export type NodeKind = "goto_step" | "goto_step_if" | "step" | "call_begin" | "call_end" | "call_indirect" | "call_indirect_begin" | "define" | "decl_param" | "decl_result" | "decl_var" | "alloc" | "return" | "yield" | "block" | "loop" | "end" | "if" | "br" | "br_if" | "copy" | "struct" | "trap" | "load" | "store" | "addr_of" | "call" | "const" | "add" | "sub" | "mul" | "div" | "div_s" | "div_u" | "rem_s" | "rem_u" | "and" | "or" | "xor" | "shl" | "shr_u" | "shr_s" | "rotl" | "rotr" | "eq" | "ne" | "lt_s" | "lt_u" | "le_s" | "le_u" | "gt_s" | "gt_u" | "ge_s" | "ge_u" | "lt" | "gt" | "le" | "ge" | "min" | "max" | "eqz" | "clz" | "ctz" | "popcnt" | "neg" | "abs" | "copysign" | "ceil" | "floor" | "trunc" | "nearest" | "sqrt" | "wrap" | "extend";
export type Type = "i8" | "i16" | "i32" | "i64" | "s8" | "s16" | "s32" | "s64" | "addr" | "f32" | "f64" | "ptr";

export class StructType {
    public addField(name: string, type: Type | StructType, count: number = 1): number {
        let align = alignmentOf(type);
        this.alignment = Math.max(this.alignment, align);
        let alignOffset = (align - this.size % align) % align;
        this.size += alignOffset;
        let offset = this.size;
        this.fieldOffsetsByName.set(name, this.size);
        this.size += count * alignedSizeOf(type);
        this.fields.push([name, type, count]);
        return offset;
    }

    public addFields(s: StructType) {
        for(let f of s.fields) {
            this.addField(f[0], f[1], f[2]);
        }
    }

    public fieldOffset(name: string): number {
        return this.fieldOffsetsByName.get(name);
    }
    
    public toDetailedString(): string {
        let str = "{\n";
        for(let i = 0; i < this.fields.length; i++) {
            let f = this.fields[i];
            str += "    " + f[0] + " " + f[1] + " @" + this.fieldOffset(f[0]) + "\n";
        }
        str += "} size=" + this.size.toString();
        return str;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "struct{...}";
    }

    // An array of type [name, type, count].
    public fields: Array<[string, Type | StructType, number]> = [];
    public fieldOffsetsByName: Map<string, number> = new Map<string, number>();
    public size: number = 0;
    public name: string | null;
    public alignment: number = 1;
}

export function alignmentOf(x: Type | StructType): number {
    if (x instanceof StructType) {
        if (x.fields.length == 0) {
            return 1;
        }
        return x.alignment;
    }
    switch(x) {
        case "i8":
        case "s8":
            return 1;
        case "i16":
        case "s16":
            return 2;
        case "i32":
        case "s32":
        case "addr":
        case "ptr":
        case "f32":
            return 4;
        case "i64":
        case "s64":
        case "f64":
            return 8;
    }
}

export function isSigned(x: Type): boolean {
    return x == "s8" || x == "s16" || x == "s32" || x == "s64";
}

export function sizeOf(x: Type | StructType): number {
    if (x instanceof StructType) {
        return x.size;
    }
    switch(x) {
        case "i8":
        case "s8":
            return 1;
        case "i16":
        case "s16":
            return 2;
        case "i32":
        case "s32":
        case "addr":
        case "ptr":
        case "f32":
            return 4;
        case "i64":
        case "s64":
        case "f64":
            return 8;
    }
}

export function alignedSizeOf(type: Type | StructType): number {
    let size = sizeOf(type);
    if (size == 0) {
        return 0;
    }
    let align = alignmentOf(type);
    return align * Math.ceil(size/align);
}

export function hasPointers(t: Type | StructType): boolean {
    if (t instanceof StructType) {
        for(let f of t.fields) {
            if (hasPointers(f[1])) {
                return true;
            }
        }
    } else if (t == "ptr") {
        return true;
    }
    return false;
}

export function compareTypes(t1: Type | StructType, t2: Type | StructType): boolean {
    if (t1 == t2) {
        return true;
    }
    if (t1 instanceof StructType && t2 instanceof StructType) {
        if (t1.fields.length != t2.fields.length) {
            return false;
        }
        for(let i = 0; i < t1.fields.length; i++) {
            if (!compareTypes(t1.fields[i][1], t2.fields[i][1])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

export type CallingConvention = "fyr" | "fyrCoroutine" | "system";

export class FunctionType {
    constructor(params: Array<Type | StructType>, result: Type | StructType | null, conv: CallingConvention = "fyr") {
        this.params = params;
        this.result = result;
        this.callingConvention = conv;
    }

    public toString(): string {
        let str = "(" + this.params.map(function(t: Type) { return t.toString() }).join(",") + ")";
        str += " => (" + (this.result ? this.result.toString() : "") + ")";
        return str;
    }

    public get stackFrame(): StructType {
        if (this._stackFrame) {
            return this._stackFrame;
        }
        this._stackFrame = new StructType();
        for(let i = 0; i < this.params.length; i++) {
            // Pointers as arguments must be passed on the stack
            if (this.params[i] instanceof StructType || this.params[i] == "ptr") {
                this._stackFrame.addField("$p" + i.toString(), this.params[i]);
            }
        }
        if (this.result instanceof StructType) {
            this._stackFrame.addField("$result", this.result);
        }
        // Add a field for the typemap
        if (this._stackFrame.fields.length != 0) {
            this._stackFrame.addField("$typemapCall", "i32");
        }
        return this._stackFrame;
    }

    public params: Array<Type | StructType>;
    public ellipsisParam: Type | StructType | null;
    public result: Type | StructType | null;
    public callingConvention: CallingConvention = "fyr";

    private _stackFrame: StructType;
}

export class Variable {
    constructor(name?: string) {
        if (name) {
            this.name = name;
        } else {
            this.name = "%" + Variable.counter.toString();
            Variable.counter++;
        }
    }

    public toString(): string {
        if (this.gcDiscoverable) {
            return "[gc]" + this.name;
        }
        return this.name;
    }

    public name: string;
    public type: Type | StructType;
    /**
     * The number of times the value of the variable is used.
     */
    public readCount: number = 0;
    /**
     * The number of times the variable is assigned a value.
     */
    public writeCount: number = 0;
    /**
     * isTemporary is true if the variable has been introduced by the compiler
     * to hold a temporary value.
     */
    // public isTemporary: boolean = false;
    /**
     * usedInMultupleSteps is true, if the variable is used in different 'steps'.
     * This is only meaningful when used after SMTransformation.transform().
     */
    public usedInMultipleSteps: boolean = false;
    /**
     * isConstant is true if the variable is assigned exactly once
     * and this value is a constant.
     * The value is set by Optimizer.optimizeConstants().
     */
    public isConstant: boolean = false;
    public constantValue: number;
    public isCopy: boolean = false;
    public copiedValue: Variable;
    /**
     * addressable is true if 'addr_of' has been used on this variable.
     */
    public addressable: boolean;
    public gcDiscoverable: boolean;
    /**
     * Internal
     */
    public _step: Node;

    private static counter: number = 0;
}

export class Pointer {
    constructor(v: Variable, offset: number) {
        this.variable = v;
        this.offset = offset;
    }

    public offset: number;
    public variable: Variable;
}

export class Node {
    constructor(assign: Variable, kind: NodeKind, type: Type | FunctionType | StructType, args: Array<Variable | string | number>) {
        this.assign = assign;
        if (this.assign) {
            this.assignType = this.assign.type;
        }
        this.kind = kind;
        this.type = type;
        for(let a of args) {
            if (typeof(a) == "string") {
                this.args.push(new Variable(a));
            } else {
                this.args.push(a);
            }
        }        
    }

    public toString(indent: string): string {
        let str = indent;
        if (this.assign instanceof Variable) {
            str += this.assign.toString() + " = ";
        }
        str += this.kind + " ";
        if (this.name) {
            str += this.name + " ";
        }            
        if (this.type) {
            str += this.type.toString() + " ";
        }
        if (this.args.length > 0) {
            let names = this.args.map(function(v: Variable | number | Node): string {
                if (v instanceof Variable) {
                    return v.toString();
                } else if (v instanceof Node) {
                    return "(" + v.toString("") + ")";
                } else if (v === null || v === undefined) {
                    return "<null>";
                } else {
                    return v.toString();
                }
            });
            str += names.join(", ");
        }

        return str;
    }

    public static strainToString(indent: string, n: Node) {
        let str = "";
        for(; n && n.kind != "end";) {
            if (n.kind == "block" || n.kind == "loop" || n.kind == "define") {
                str += n.toString(indent) + "\n";
                str += Node.strainToString(indent + "    ", n.next[0]);
                str += indent + "end\n";
                n = n.blockPartner.next[0];
            } else if (n.kind == "if") {
                str += n.toString(indent) + "\n";
                str += Node.strainToString(indent + "    ", n.next[0]);
                if (n.next[1]) {
                    str += indent + "else\n";
                    str += Node.strainToString(indent + "    ", n.next[1]);
                }
                str += indent + "end\n";
                n = n.blockPartner.next[0];
            } else {
                str += n.toString(indent) + "\n";
                n = n.next[0];
            }
        }
        return str;
    }

    public static insertBetween(n1: Node, n2: Node, newNode: Node) {
        newNode.prev.push(n1);
        newNode.next.push(n2);
        for(let i = 0; i < n1.next.length; i++) {
            if (n1.next[i] == n2) {
                n1.next[i] = newNode;
                break;
            }
        }
        for(let i = 0; i < n2.prev.length; i++) {
            if (n2.prev[i] == n1) {
                n2.prev[i] = newNode;
                break;
            }
        }
    }

    public static removeNode(n: Node) {
        if (n.next.length > 1 || n.prev.length > 1) {
            throw "Cannot remove this node";
        }
        if (n.next.length == 1) {
            for(let i = 0; i < n.next[0].prev.length; i++) {
                if (n.next[0].prev[i] == n) {
                    n.next[0].prev[i] = n.prev[0];
                }
            }
        }
        if (n.prev.length == 1) {
            for(let i = 0; i < n.prev[0].next.length; i++) {
                if (n.prev[0].next[i] == n) {
                    n.prev[0].next[i] = n.next[0];
                }
            }
        }
        n.prev = [];
        n.next = [];
    }

    public name: string;
    public kind: NodeKind;
    public type: Type | FunctionType | StructType;
    public next: Array<Node> = [];
    public prev: Array<Node> = [];
    public blockPartner: Node; // 'end' for 'if'/'block'/'loop' and either 'if' or 'block' or 'loop' for 'end'.
    public assign: Variable;
    public assignType: Type | StructType;
    public args: Array<Variable | number | Node> = [];
    public isAsync: boolean = false;
}

export class Builder {
    constructor() {
        this._mem = new Variable("$mem");
        this._mem.readCount = 2; // Just to prevent optimizations on this pseudo-variable
        this._mem.writeCount = 2;
    }

    public define(name: string, type: FunctionType): Node {
        let n = new Node(null, "define", type, []);
        n.name = name;
        n.isAsync = type.callingConvention == "fyrCoroutine";
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this._blocks.push(n);

        let e = new Node(null, "end", undefined, []);
        e.blockPartner = n;
        n.blockPartner = e;  
        this.countReadsAndWrites(n);
        return n;
    }
    
    public declareParam(type: Type | StructType, name: string): Variable {
        let n = new Node(new Variable(name), "decl_param", type, []);
        n.assign.type = type;
        n.assignType = type;
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public declareResult(type: Type | StructType, name: string): Variable {
        let n = new Node(new Variable(name), "decl_result", type, []);
        n.assign.type = type;
        n.assignType = type;
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public declareVar(type: Type | StructType, name: string): Variable {
        let n = new Node(new Variable(name), "decl_var", type, []);
        n.assign.type = type;
        n.assignType = type;
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public assign(assign: Variable, kind: NodeKind, type: Type | StructType, args: Array<Variable | string | number>) : Variable {
        let n = new Node(assign, kind, type, args);
//        if (assign && assign.type && assign != this.mem) {
//            if (!compareTypes(assign.type, type)) {
//                fuck
//                throw "Variable " + assign.name + " used with wrong type: " + assign.type + " " + type;
//            }
        if (assign && !assign.type) {
            assign.type = type;
        }
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public call(assign: Variable, type: FunctionType, args: Array<Variable | string | number>): Variable {
        let n = new Node(assign, "call", type, args);
        if (assign && assign.type) {
            if (!compareTypes(assign.type, type.result)) {
                throw "Variable " + assign.name + " used with wrong type";
            }
        } else if (assign) {
            assign.type = type.result;
        }

        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        for(let b of this._blocks) {
            b.isAsync = b.isAsync || type.callingConvention == "fyrCoroutine";
        }
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public callIndirect(assign: Variable, type: FunctionType, args: Array<Variable | string | number>): Variable {
        let n = new Node(assign, "call_indirect", type, args);
        if (assign && assign.type) {
            if (!compareTypes(assign.type, type.result)) {
                throw "Variable " + assign.name + " used with wrong type";
            }
        } else if (assign) {
            assign.type = type.result;
        }

        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        for(let b of this._blocks) {
            b.isAsync = b.isAsync || type.callingConvention == "fyrCoroutine";
        }
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public br(to: Node) {
        let j = 0;
        for(let i = this._blocks.length - 1; i >= 0; i--) {
//            if (this._blocks[i].kind == "if" || this._blocks[i].kind == "define") {
//                continue;
//            }
            if (to == this._blocks[i]) {
                let n = new Node(null, "br", undefined, [j]);
                if (this._current) {
                    this._current.next.push(n);
                    n.prev.push(this._current);
                } else {
                    this._node = n;
                }
                n.blockPartner = to;
                this._current = n;
                return;                
            }
            j++;
        }
        throw "Branch target is not reachable";
    }

    public br_if(arg: Variable | string | number, to: Node) {
        let j = 0;
        for(let i = this._blocks.length - 1; i >= 0; i--) {
//            if (this._blocks[i].kind == "if" || this._blocks[i].kind == "define") {
//                continue;
//            }
            if (to == this._blocks[i]) {
                let n = new Node(null, "br_if", undefined, [arg, j]);
                if (this._current) {
                    this._current.next.push(n);
                    n.prev.push(this._current);
                } else {
                    this._node = n;
                }
                n.blockPartner = to;
                this._current = n;
                this.countReadsAndWrites(n);
                return;                
            }
            j++;
        }
        throw "Branch target is not reachable";
    }

    /*
    public br_table(arg: Variable | string | number, to: Array<Node>) {
        let args: Array<Variable | string | number> = [arg];
        for(let t of to) {
            let ok = false;
            let j = 0;
            for(let i = this._blocks.length - 1; i >= 0; i--) {
                if (this._blocks[i].kind == "if" || this._blocks[i].kind == "define") {
                    continue;
                }
                if (t == this._blocks[i]) {
                    ok = true;
                    args.push(i);
                    break;
                }
            }
            if (!ok) {
                throw "Branch target is not reachable";
            }
        }
        let n = new Node([], "br_table", undefined, args);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
    }
    */

    public block(): Node {
        let n = new Node(null, "block", undefined, []);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this._blocks.push(n);
        let e = new Node(null, "end", undefined, []);
        e.blockPartner = n;
        n.blockPartner = e;  
        return n;      
    }

    public loop() : Node {
        let n = new Node(null, "loop", undefined, []);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this._blocks.push(n);
        let e = new Node(null, "end", undefined, []);
        e.blockPartner = n;
        n.blockPartner = e;  
        return n;      
    }

    public end() {
        if (this._blocks.length == 0) {
            throw "end without opening block";
        }
        let block = this._blocks.pop();
        let end = block.blockPartner;
        this._current.next.push(end);
        end.prev.push(this._current);
        this._current = end;
    }

    public ifBlock(arg: Variable | string | number) : Node {
        let n = new Node(null, "if", undefined, [arg]);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this._blocks.push(n);
        let e = new Node(null, "end", undefined, []);
        e.blockPartner = n;
        n.blockPartner = e;  
        this.countReadsAndWrites(n);
        return n;
    }

    public elseBlock() {
        if (this._blocks.length == 0) {
            throw "end without opening block";
        }
        let n = this._blocks.pop();
        if (n.kind != "if") {
            throw "else without if";
        }
        this._blocks.push(n);
        this._current.next.push(n.blockPartner);
        n.blockPartner.prev.push(this._current);
        this._current = n;
    }

    public tmp(t: Type | StructType = null): Variable {
        let v = new Variable();
        // v.isTemporary = true;
        v.type = t;
        return v;
    }

    public get mem(): Variable {
        return this._mem;
    }

    public get node(): Node {
        return this._node;
    }

    private countReadsAndWrites(n: Node) {
        if (n.assign) {
            n.assign.writeCount++;
//            if (n.assign.isTemporary && n.assign.writeCount > 1) {
//                throw "Variable " + n.assign.name + " is temporary but assigned more than once";
//            }
        }
        for(let v of n.args) {
            if (v instanceof Variable) {
                v.readCount++;
            }
        }
        if (n.kind == "addr_of" && n.args[0] instanceof Variable) {
            (n.args[0] as Variable).addressable = true;
        } else if (n.kind == "decl_param" || n.kind == "decl_result") {
            n.assign.readCount = 1; // Avoid that assignments to the variable are treated as dead code
        }
    }

    private _node: Node;
    private _mem: Variable;
    private _blocks: Array<Node> = [];
    private _current: Node;
}

export class Optimizer {
    public optimizeConstants(n: Node) {
        this._optimizeConstants(n, n.blockPartner);
    }

    /**
     * Removes all 'const' nodes which assign to variables that are SSA.
     */
    private _optimizeConstants(start: Node, end: Node) {
        let n = start;
        for( ; n && n != end; ) {
            if (n.kind == "if") {
                if (n.next.length > 1) {
                    this._optimizeConstants(n.next[1], n.blockPartner);
                }
            }
            if (n.kind == "const" && n.assign.writeCount == 1) {
                n.assign.isConstant = true;
                n.assign.constantValue = n.args[0] as number;
                let n2 = n.next[0];
                Node.removeNode(n);
                n = n2;
            } else {
                for(let i = 0; i < n.args.length; i++) {
                    let a = n.args[i];
                    if (a instanceof Variable && a.isConstant) {
                        n.args[i] = a.constantValue;
                    }
                }
                n = n.next[0];
            }
            // TODO: Computations on constants can be optimized
        }
    }

    public removeDeadCode(n: Node) {
        this._removeDeadCode1(n.blockPartner, n);
        this._removeDeadCode2(n, n.blockPartner);
    }

    /**
     * Traverse the code backwards and remove assignment which assign to variables
     * that are never read.
     */
    private _removeDeadCode1(n: Node, end: Node) {
        for( ;n && n != end; ) {
            if (n.assign && n.assign.isCopy) {
                n.assign.writeCount--;
                n.assign = n.assign.copiedValue;
                n.assign.writeCount++;
            }
            // Remove assignments to variables which are not read
            if ((n.kind == "call" || n.kind == "call_indirect") && n.assign && n.assign.readCount == 0) {
                n.assign.writeCount--;
                n.assign = null;
            } else if (n.kind == "end" && n.prev[1]) { // The 'end' belongs to an 'if'?
                this._removeDeadCode1(n.prev[1], n.blockPartner);
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var" || n.kind == "return") {
                // Do nothing by intention
            } else if (n.kind == "copy" && n.args[0] instanceof Variable && (n.args[0] as Variable).writeCount == 1 && (n.args[0] as Variable).readCount == 1) {
                let v = n.args[0] as Variable;
                v.isCopy = true;
                v.copiedValue = n.assign;
                n.assign.writeCount--;
                v.readCount--;
                let n2 = n.prev[0];
                Node.removeNode(n);
                n = n2;
                continue;
            } else if (n.kind == "copy" && typeof(n.args[0]) == "number") {
                n.kind = "const";
            } else if ((n.kind != "call" && n.kind != "call_indirect") && n.assign && n.assign.readCount == 0) {
                let n2 = n.prev[0];
                for(let a of n.args) {
                    if (a instanceof Variable) {
                        a.readCount--;
                    }
                }
                n.assign.writeCount--;
                Node.removeNode(n);
                n = n2;
                continue;
            }
            n = n.prev[0];
        }
    }

    /**
     * Traverse the code forwards and eliminate unreachable code
     */
    private _removeDeadCode2(n: Node, end: Node) {
        let dead: boolean = false;
        for( ;n && n != end; ) {
            if (dead) {
                this.removeDeadNode(n);
                let n2 = n.next[0];
                Node.removeNode(n);
                n = n2;
                continue;
            }
            if (n.kind == "return" || n.kind == "br") {
                dead = true;
            }
            if (n.kind == "if") {
                if (typeof(n.args[0]) == "number") {
                    let val = n.args[0] as number;
                    if (n.next[1]) {
                        if (!val) {
                            let next = n.next[1];
                            n.next[1] = n.next[0];
                            n.next[0] = next;   
                            let end = n.blockPartner.prev[1];
                            n.blockPartner.prev[1] = n.blockPartner.prev[0];
                            n.blockPartner.prev[0] = end;     
                        }
                        let n2 = n.blockPartner.next[0];
                        this.removeDeadStrain(n.next[1], n.blockPartner);
                        n.next.splice(1,1);
                        n.blockPartner.prev.splice(1,1);
                        this.removeDeadNode(n);
                        Node.removeNode(n.blockPartner);
                        Node.removeNode(n);
                        n = n2;
                    } else {
                        if (!val) {
                            let n2 = n.blockPartner.next[0];
                            this.removeDeadStrain(n.next[0], n.blockPartner);
                            this.removeDeadNode(n);
                            let end = n.blockPartner;
                            for(let x = n; x != end; ) {
                                let x2 = x.next[0];
                                Node.removeNode(x);
                                x = x2;
                            }
                            Node.removeNode(n.blockPartner);
                            Node.removeNode(n);            
                            n = n2;                
                        } else {
                            let n2 = n.next[0];
                            if (n2 == n.blockPartner) {
                                n2 = n2.next[0];
                            }
                            Node.removeNode(n.blockPartner);
                            Node.removeNode(n);
                            n = n2;                           
                        }
                    }
                    continue;
                } else {
                    this._removeDeadCode2(n.next[0], n.blockPartner);
                    if (n.next[1]) {
                        this._removeDeadCode2(n.next[1], n.blockPartner);
                    }
                    n = n.blockPartner;
                }
            } else if (n.kind == "block" || n.kind == "loop") {
                this._removeDeadCode2(n.next[0], n.blockPartner);
                n = n.blockPartner;                
            }
            n = n.next[0];
        }
    }

    private removeDeadStrain(n: Node, end: Node) {
        for(; n && n != end; ) {
            let n2 = n.next[0];
            this.removeDeadNode(n);
            n = n2;
        }
    }

    private removeDeadNode(n: Node) {
        for(let a of n.args) {
            if (a instanceof Variable) {
                a.readCount--;
            }
        }
        if (n.assign) {
            n.assign.writeCount--;
        }
        if (n.kind == "if" && n.next[1]) {
            this.removeDeadStrain(n.next[1], n.blockPartner);
        }
    }

    public analyzeGCDiscoverability(n: Node) {
        let varsRead = new Set<Variable>();
        this._analyzeGCDiscoverability(n, null, varsRead);
    }

    private _analyzeGCDiscoverability(n: Node, stop: Node, varsRead: Set<Variable>): boolean {
        let doesGC = false;
        for(; n != stop;) {
            if (n.kind == "end" && n.blockPartner.kind == "if") {
                let r = new Set<Variable>();
                for(let v of varsRead) {
                    r.add(v);
                }
                let branchDoesGC = this._analyzeGCDiscoverability(n.prev[0], n.blockPartner, r);
                doesGC = doesGC || branchDoesGC;
                if (n.prev[1]) {
                    branchDoesGC = this._analyzeGCDiscoverability(n.prev[1], n.blockPartner, r);
                    doesGC = doesGC || branchDoesGC;
                }
                for(let v of r) {
                    varsRead.add(v);
                }
                n = n.blockPartner;
            } else if (n.kind == "end" && (n.blockPartner.kind == "block" || n.blockPartner.kind == "loop")) {
                let blockDoesGC = this._analyzeGCDiscoverability(n.prev[0], n.blockPartner, varsRead);
                n = n.blockPartner;
            } else if (n.kind == "call" || n.kind == "call_indirect" || n.kind == "alloc" || n.kind == "call_end" || n.kind == "call_begin") {
                for(let v of varsRead) {
                    v.gcDiscoverable = true;
                }
                doesGC = true;
                n = n.prev[0];
            } else if (n.kind == "decl_var" || n.kind == "decl_result" || n.kind == "decl_param") {
                n = n.prev[0];
            } else {
                let lastArgDoesGC = false;
                let doesGCBefore = doesGC;
                for(let i = n.args.length - 1; i >= 0; i--) {
                    let a = n.args[i];
                    // If a ptr is computed for a "store" and then a value is computed leading to a GC, the ptr must be GC discoverable
                    if (i == 0 && n.kind == "store" && doesGC && !doesGCBefore) {
                        if (a instanceof Variable && a.type == "ptr") {
                            a.gcDiscoverable = true;
                        } else if (a instanceof Node && a.assignType == "ptr") {
                            if (a.assign) {
                                a.assign.gcDiscoverable = true;
                            } else {
                                a.assign = new Variable();
                                a.assign.type = "ptr";
                                a.assign.gcDiscoverable = true;
                            }
                        }
                    }
                    if (a instanceof Node) {
                        lastArgDoesGC = this._analyzeGCDiscoverability(a, null, varsRead);
                        doesGC = doesGC || lastArgDoesGC;
                    }
                }
                // If the assigned variable has not yet been read, then it must be inside a loop,
                // otherwise the variable would be useless and would have been removed.
                // If GC happens after this assignment, GC discoverability is required.
                if (n.assign && n.assign.type == "ptr" && !varsRead.has(n.assign) && doesGC) {
                    n.assign.gcDiscoverable = true;
                } else if (n.assign && n.assign.type == "ptr") {
                    varsRead.delete(n.assign)
                }
                n = n.prev[0];
            }
        }
        return doesGC;
    }
}

/**
 * Transforms control flow with loop/block/br/br_if/if into a state machine using
 * step/goto_step/goto_step_if. This happens in all places where execution could block.
 * Non-blocking constructs are left untouched. 
 */
export class SMTransformer {
    public transform(startBlock: Node) {
        if (!startBlock.isAsync) {
            return;
        }
        this.transformUpTo(startBlock, startBlock.blockPartner, null, false);
        this.insertNextStepsUpTo(startBlock, startBlock.blockPartner);
        this.cleanup(startBlock);
    }

    /**
     * Transforms the control flow from block/loop/if/br/br_if/end into a state machine.
     * Therefore, the function inserts step, goto_step and goto_step_if nodes.
     */
    private transformUpTo(startBlock: Node, endNode: Node, step: Node, elseClause: boolean) {
        let n = startBlock;
        if (n.kind == "define") {
            n = n.next[0];
        }
        for( ; n ; ) {
            if (n.kind == "block" || n.kind == "loop") {
                if (n.isAsync) {
                    if (step) {
                        let end = new Node(null, "goto_step", undefined, []);
                        step = null;
                        Node.insertBetween(n.prev[0], n, end);                        
                    }
                    n = n.next[0];
                } else {
                    // Step behind n
                    n = n.blockPartner.next[0];
                }
            } else if (n.kind == "if") {
                if (n.isAsync) {
                    if (!step) {
                        step = new Node(null, "step", undefined, []);
                        step.name = "s" + this.stepCounter.toString();
                        this.stepCounter++;
                        Node.insertBetween(n.prev[0], n, step);
                    }
                    // Create steps on the else branch
                    if (n.next[1]) {
                        this.transformUpTo(n.next[1], n.blockPartner, step, true);
                    }
                    n = n.next[0];
                } else {
                    // Step behind n
                    n = n.blockPartner.next[0];
                }
            } else if (n.kind == "end") {
                if (step) {
                    if (n.blockPartner.kind != "if" && n.prev[0].kind == "return") {
                        // Do nothing by intention
                        step = null;
                    } else {
                        let end = new Node(null, "goto_step", undefined, []);
                        step = null;
                        Node.insertBetween(n.prev[elseClause ? 1 : 0], n, end);                        
                    }
                }
                if (n == endNode) {
                    n = null;
                    break;
                }
                n = n.next[0];
            } else {
                if (!step) {
                    step = new Node(null, "step", undefined, []);
                    step.name = "s" + this.stepCounter.toString();
                    this.stepCounter++;
                    Node.insertBetween(n.prev[0], n, step);
                }
                if (n.kind == "br") {
                    n.kind = "goto_step";
                    n.args = [];
                    if (n.blockPartner.kind == "loop") {
                        n.blockPartner = n.blockPartner;
                    } else {
                        // n.blockPartner points to 'block'
                        // n.blockPartner.blockPartner points to the corresponding 'end'.
                        // That is where we must go. Later this is adjusted to the destination step.
                        n.blockPartner = n.blockPartner.blockPartner;
                    }
                    step = null;
                    n = n.next[0];
                } else if (n.kind == "br_if") {
                    n.kind = "goto_step_if";
                    n.args.splice(1,1);
                    if (n.blockPartner.kind == "loop") {
                        n.blockPartner = n.blockPartner;
                    } else {
                        n.blockPartner = n.blockPartner.blockPartner;
                    }
                    n = n.next[0];
                } else if ((n.kind == "call" || n.kind == "call_indirect") && (n.type as FunctionType).callingConvention == "fyrCoroutine") {
                    n.kind = n.kind == "call" ? "call_begin" : "call_indirect_begin";
                    let result = new Node(n.assign, "call_end", n.type, []);
                    n.assign = null;
                    let end = new Node(null, "goto_step", undefined, []);
                    step = null;
                    Node.insertBetween(n, n.next[0], end);
                    Node.insertBetween(end, end.next[0], result);
                    n = result;
                } else if (n.kind == "yield") {
                    let end = new Node(null, "goto_step", undefined, []);
                    step = null;
                    Node.insertBetween(n, n.next[0], end);
                    n = end.next[0];                    
                } else {
                    n = n.next[0];
                }
            }
        }
    }

    public nextStep(n: Node): Node {
        for(; n; ) {
            if (n.kind == "step") {
                return n;
            }
            n = n.next[0];
        }
        return null;
    }

    /**
     * Determines the destination step of goto_step and goto_step_if.
     */
    private insertNextStepsUpTo(start: Node, end: Node) {
        let n = start;
        for(; n; ) {
            if (n.kind == "goto_step" || n.kind == "goto_step_if") {
                let f = this.nextStep(n.blockPartner ? n.blockPartner : n);
                // Point to the destination step
                n.blockPartner = f;
                if (f) {
                    n.name = f.name;
                } else {
                    n.name = "<end>";
                }
                n = n.next[0];
            } else if (n.kind == "if" && n.next.length > 1) {
                this.insertNextStepsUpTo(n.next[1], n.blockPartner);
                n = n.next[0];
            } else {
                n = n.next[0];                
            }
        }
    }

    /**
     * Removes unnecessary block, loop and end nodes.
     * Tracks whether a variable is used in multiple steps.
     * 
     * @param start
     * @param end 
     * @param step 
     */
    public cleanup(n: Node) {
        for(; n; ) {
            if (n.kind == "if" && n.next.length > 1) {
                this.cleanup(n.next[1]);
                n = n.next[0];
            } else if ((n.isAsync && (n.kind == "block" || n.kind == "loop") || (n.kind == "end" && n.blockPartner.isAsync && n.blockPartner.kind != "if"))) {
                let n2 = n.next[0];
                Node.removeNode(n);
                n = n2;
            } else {
                n = n.next[0];                
            }
        }
    }

    private stepCounter: number = 0;
}


export type Wasm32StorageType = "local" | "vars" | "params" | "result" | "local_result" | "local_var" | "global" | "global_heap";

export class Wasm32Storage {
    public storageType: Wasm32StorageType;
    public offset: number;
}


class Wasm32LocalVariableList {
    constructor(localsUsed: number) {
        this.localsUsed = localsUsed;
    }

    public clone(): Wasm32LocalVariableList {
        let l = new Wasm32LocalVariableList(this.localsUsed);
        for(let v of this.used) {
            l.used.push(v);
        }
        l.locals = this.locals;
        return l;
    }

    public allocate(type: Type): number {
        let t: wasm.StackType;
        switch(type) {
            case "i64":
            case "s64":
                t = "i64";
                break;
            case "f64":
                t = "f64";
                break;
            case "f32":
                t = "f32";
                break;
            default:
                t = "i32";
                break;
        }
        for(let i = 0; i < this.locals.length; i++) {
            if (this.locals[i] == type && !this.used[i]) {
                this.used[i] = true;
                return this.localsUsed + i;
            }
        }
        this.locals.push(t);
        this.used.push(true);
        return this.localsUsed + this.locals.length - 1;
    }

    public locals: Array<wasm.StackType> = [];
    public used: Array<boolean> = [];
    private localsUsed: number;
}

export class Wasm32Backend {
    constructor(emitIR: boolean, emitIRFunction: string | null) {
        this.emitIR = emitIR;
        this.emitIRFunction = emitIRFunction;
        this.tr = new SMTransformer();
        this.optimizer = new Optimizer();
        this.funcs = [];
        this.globalVarStorage = new Map<Variable, Wasm32Storage>();
        this.globalVariables = [];
        this.module = new wasm.Module();
        this.module.funcTypes.push(new wasm.FunctionType("$callbackFn", ["i32", "i32"], ["i32"]));
        // Null pointers point to a string that has length zero.
        this.module.addString("");
        this.heapGlobalVariableIndex = 0;
        this.heapGlobalVariable = new wasm.Global("i32", null, false);
        this.module.addGlobal(this.heapGlobalVariable);
        this.typemapGlobalVariableIndex = 1;
        this.typemapGlobalVariable = new wasm.Global("i32", null, false);
        this.module.addGlobal(this.typemapGlobalVariable);
        this.customglobalVariablesIndex = 2;
        this.typeMapper = new TypeMapper(this.module);
        this.varsFrameHeader = new StructType();
        this.varsFrameHeader.addField("$func", "i32");
        this.varsFrameHeader.addField("$sp", "i32");
        this.varsFrameHeader.addField("$step", "i32");
    }

    public importFunction(name: string, from: string, type: FunctionType): wasm.FunctionImport {
        let wt = new wasm.FunctionType(name, [], []);
        let hasHeapFrame = false;
        for(let p of type.params) {
            if (!(p instanceof StructType) && p != "ptr") {
                wt.params.push(this.stackTypeOf(p))
            }
        }
        if (type.result) {
            if (!(type.result instanceof StructType)) {
                wt.results.push(this.stackTypeOf(type.result));
            }
        }
        wt.params.push("i32");
        let f = new wasm.FunctionImport(name, from, wt);
        this.module.addFunctionImport(f);
        return f;
    }

    public declareGlobalVar(name: string, type: Type | StructType): Variable {
        let v = new Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;
        this.globalVariables.push(v);
        return v;
    }

    public declareFunction(name: string): wasm.Function {
        let wf = new wasm.Function(name);
        this.module.addFunction(wf);
        return wf;
    }

    public defineFunction(n: Node, f: wasm.Function) {
        this.funcs.push({node: n, wf: f});
    }

    public generateModule() {
        // Generate WASM code for all globals
        let index = this.customglobalVariablesIndex;
        for(let v of this.globalVariables) {
            if (v.addressable || v.type instanceof StructType || v.type == "ptr") {
                let offset = this.module.addGlobalStruct(sizeOf(v.type));
                let s: Wasm32Storage = {storageType: "global_heap", offset: offset};
                this.globalVarStorage.set(v, s);
                this.typeMapper.mapGlobal(offset, v.type);
            } else {
                let s: Wasm32Storage = {storageType: "global", offset: index};
                this.globalVarStorage.set(v, s);
                let g = new wasm.Global(this.stackTypeOf(v.type), "$" + v.name, true);
                this.module.addGlobal(g);
                index++;
            }
        }
        this.typeMapper.globalMapping.declare(this.module);

        // Generate WASM code for all functions
        for(let f of this.funcs) {
            this.optimizer.optimizeConstants(f.node);
            if (this.emitIR || f.wf.name == "$" + this.emitIRFunction) {
                console.log('============ OPTIMIZED Constants ===============');
                console.log(Node.strainToString("", f.node));
            }

            this.optimizer.removeDeadCode(f.node);
            if (this.emitIR || f.wf.name == "$" + this.emitIRFunction) {
                console.log('============ OPTIMIZED Dead code ===============');
                console.log(Node.strainToString("", f.node));
            }

            this.generateFunction(f.node, f.wf);
        }

        // Add type maps to the module
        this.typeMapper.addToModule(this.module);

        this.module.memorySize = this.module.textSize() + this.heapSize + this.stackSize;

        this.typemapGlobalVariable.initial = [new wasm.Constant("i32", this.typeMapper.globalMapping.addr)];
        this.heapGlobalVariable.initial = [new wasm.Constant("i32", this.module.textSize())];
    }

    private generateFunction(n: Node, f: wasm.Function) {
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }
        this.steps = [];
        this.stepCode = [];
        this.stepsByName = new Map<string, number>();
        this.asyncCalls = [];
        this.asyncCallCode = [];
        this.resultFrame = new StructType();
        this.paramsFrame = new StructType();
        this.varsFrame = new StructType();
        this.varsFrameHeader = new StructType();
        this.varStorage = new Map<Variable, Wasm32Storage>();
        this.parameterVariables = [];
        this.returnVariables = [];
        this.tmpI32Local = -1;
        this.tmpI64Local = -1;
        this.tmpF32Local = -1;
        this.tmpF64Local = -1;
        this.tmpI32SrcLocal = -1;
        this.tmpI32DestLocal = -1;
        this.wf = f;

        if (n.type.callingConvention == "fyrCoroutine") {
            return this.generateAsyncFunction(n, f);
        }
        return this.generateSyncFunction(n, f);
    }

    private generateSyncFunction(n: Node, wf: wasm.Function) {
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }

        this.wfIsAsync = false;

        this.traverse(n.next[0], n.blockPartner, null);
        this.stackifyStep(n, null);
        let locals = new Wasm32LocalVariableList(0);
        let typemap = this.analyzeVariableStorage(n, n.blockPartner, locals);
        if (this.varsFrame.size > 0) {
            this.varsFrame.addField("$typemap", "i32");
        }
        if (this.resultFrame.size > 0) {
            this.resultFrame.addField("$typemapCall", "i32");
        } else if (this.paramsFrame.size > 0) {
            this.paramsFrame.addField("$typemapCall", "i32");
        }
        if (typemap.offsets.length != 0) {
            typemap.typeSize = this.varsFrame.size;
            typemap.declare(this.module);
            typemap.define();
        }
        this.spLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // sp
        if (this.wfHasHeapFrame()) {
            this.bpLocal = this.wf.parameters.length;
            this.wf.locals.push("i32"); // bp
        }
        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            if (s.storageType == "local_var") {
                s.offset += this.wf.parameters.length + this.wf.locals.length;
                s.storageType = "local";
            }
        }
        this.wf.locals = this.wf.locals.concat(locals.locals);

        if (this.emitIR || this.emitIRFunction == wf.name) {
            console.log("========= Stackified ==========");
            console.log(Node.strainToString("", n));
            for(let v of this.varStorage.keys()) {
                let s = this.varStorage.get(v);
                console.log(v.name + " -> ", s.storageType, s.offset);
            }
            console.log("sp -> local " + this.spLocal);
            console.log("bp -> local " + this.bpLocal);
        }

        // Generate function body
        let code: Array<wasm.Node> = [];
        if (this.varsFrame.size > 0) {
            // Put the varsFrame on the heap_stack and set BP
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", this.varsFrame.size));
            code.push(new wasm.BinaryInstruction("i32", "sub"));
            code.push(new wasm.TeeLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the varsFrame
            // Put the typemap on the stack
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", (!typemap || typemap.offsets.length == 0) ? -this.varsFrame.size : typemap.addr));
            code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$typemap")));
        } else if (this.resultFrame.size != 0 || this.paramsFrame.size != 0) {
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the varsFrame
        }

        this.emitCode(0, n.next[0], null, code, 0, 0);

        this.wf.statements = code;

        return this.wf;
    }

    private generateAsyncFunction(n: Node, wf: wasm.Function) {
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }

        this.wfIsAsync = true;

        this.tr.transform(n);
//        console.log("========= State Machine ==========");
//        console.log(Node.strainToString("", n));

        this.traverse(n.next[0], n.blockPartner, null);
        this.stackifySteps();
        let locals = new Wasm32LocalVariableList(0);
        let typemap = this.analyzeVariableStorage(n, n.blockPartner, locals);
        if (this.varsFrame.size > 0) {
            this.varsFrame.addField("$typemap", "i32");
        }
        if (this.resultFrame.size > 0) {
            this.resultFrame.addField("$typemapCall", "i32");
        } else if (this.paramsFrame.size > 0) {
            this.paramsFrame.addField("$typemapCall", "i32");
        }
        if (typemap.offsets.length != 0) {
            typemap.typeSize = this.varsFrame.size;
            typemap.declare(this.module);
            typemap.define();
        }    
        this.analyzeVariableStorage(n, n.blockPartner, locals);
        this.stepLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // step_local
        this.spLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // sp
        this.wf.results.push("i32"); // interrupt or complete
        this.bpLocal = this.wf.parameters.length;
        this.wf.locals.push("i32"); // bp

        // Make room to store function index, sp and step upon async calls.
        this.varsFrame.addFields(this.varsFrameHeader);
//        this.varsFrame.addField("$func", "i32");
//        this.varsFrame.addField("$sp", "i32");
//        this.varsFrame.addField("$step", "i32");

        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            if (s.storageType == "local_var") {
                s.offset += this.wf.parameters.length + this.wf.locals.length;
                s.storageType = "local";
            }
        }
        this.wf.locals = this.wf.locals.concat(locals.locals);

        if (this.emitIR || this.emitIRFunction == wf.name) {
            console.log("========= Stackified ==========");
            console.log(Node.strainToString("", n));
            for(let v of this.varStorage.keys()) {
                let s = this.varStorage.get(v);
                console.log(v.name + " -> ", s.storageType, s.offset);
            }
            console.log("sp -> local " + this.spLocal);
            console.log("bp -> local " + this.bpLocal);
            console.log("step -> local " + this.stepLocal);
            console.log("varsFrame = ", this.varsFrame.toDetailedString());
        }

        // Generate function body
        let code: Array<wasm.Node> = [];
        // Put the varsFrame on the heap_stack and set BP
        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.Constant("i32", this.varsFrame.size));
        code.push(new wasm.BinaryInstruction("i32", "sub"));
        code.push(new wasm.TeeLocal(this.spLocal));
        code.push(new wasm.TeeLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        // Put the typemap on the stack
        code.push(new wasm.Constant("i32", (!typemap || typemap.offsets.length == 0) ? -this.varsFrame.size : typemap.addr));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$typemap")));

        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.Constant("i32", 0));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$sp")));

        // Main loop of the function
        code.push(new wasm.Block());
        code.push(new wasm.Loop());
        this.emitSteps();
        let targets: Array<number> = [];
        for(let i = 0; i < this.stepCode.length; i++) {
            code.push(new wasm.Block());
            targets.push(i);
        }
        for(let i = 0; i < this.asyncCallCode.length; i++) {
            code.push(new wasm.Block());
        }
        targets.push(this.stepCode.length + 1); // The default target: Exit
        code.push(new wasm.GetLocal(this.stepLocal));
        // Branch to the target steps
        code.push(new wasm.BrTable(targets));
        for(let c of this.stepCode) {
            code = code.concat(c);
        }
        for(let c of this.asyncCallCode) {
            code = code.concat(c);
        }
        // End of the main loop
        code.push(new wasm.End());
        code.push(new wasm.End());
        // Store the current state in the stack frame
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.GetLocal(this.stepLocal));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$step")));
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$sp")));
        // Safe parameters on the stack frame
        let needsCallbackFunction = false;
        for(let i = 0; i < this.parameterVariables.length; i++) {
            let v = this.parameterVariables[i];
            let s = this.varStorage.get(v);
            if (s.storageType != "local") {
                continue;
            }
            needsCallbackFunction = true;
            let t = this.stackTypeOf(v.type as Type);
            let asType: null | "8"| "16" | "32" = null;
            switch (v.type) {
                case "i8":
                case "s8":
                    asType = "8";
                    break;
                case "i16":
                case "s16":
                    asType = "16";
                    break;
            }
            code.push(new wasm.GetLocal(this.bpLocal));
            code.push(new wasm.GetLocal(s.offset));
            code.push(new wasm.Store(t, asType, this.varsFrame.fieldOffset("$param" + i.toString())));
        }
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.Constant("i32", this.module.funcTable.length));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$func")));
        code.push(new wasm.Constant("i32", 1)); // Return with '1' to indicate that this is an async return
        code.push(new wasm.Return());

        this.wf.statements = code;

        if (needsCallbackFunction) {
            let callbackWf = new wasm.Function();
            callbackWf.index = this.module.funcs.length;
            this.module.funcs.push(callbackWf);

            callbackWf.parameters.push("i32");
            callbackWf.parameters.push("i32");
            callbackWf.results.push("i32");
            callbackWf.locals.push("i32");
            let code: Array<wasm.Node> = [];
            code.push(new wasm.GetLocal(1));
            code.push(new wasm.Constant("i32", this.varsFrame.size));
            code.push(new wasm.BinaryInstruction("i32", "sub"));
            code.push(new wasm.SetLocal(2));
            for(let i = 0; i < this.parameterVariables.length; i++) {
                let v = this.parameterVariables[i];
                let s = this.varStorage.get(v);
                if (s.storageType != "local") {
                    continue;
                }
                let t = this.stackTypeOf(v.type as Type);
                let asType: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
                switch (v.type) {
                    case "i8":
                        asType = "8_u";
                        break;
                    case "s8":
                        asType = "8_s";
                        break;
                    case "i16":
                        asType = "16_u";
                        break;
                    case "s16":
                        asType = "16_s";
                        break;
                }        
                code.push(new wasm.GetLocal(2));
                code.push(new wasm.Load(t, asType, this.varsFrame.fieldOffset("$param" + i.toString())));
            }
            code.push(new wasm.GetLocal(0));
            code.push(new wasm.GetLocal(1));
            code.push(new wasm.Call(this.wf.index));
            code.push(new wasm.Return());
            callbackWf.statements = code;
            this.module.funcTable.push(callbackWf);
        } else {
            this.module.funcTable.push(this.wf);
        }

        return this.wf;
    }

    /**
     * Collects all steps and async calls
     * and remove all 'const' nodes which assign to variables that are SSA.
     */
    private traverse(start: Node, end: Node, step: Node) {
        let n = start;
        for( ; n; ) {
            // Analyze the arguments
            for(let v of n.args) {
                if (v instanceof Variable) {
                    if (v._step && v._step != step) {
                        v.usedInMultipleSteps = true;
                    } else {
                        v._step = step;
                    }                    
                }
            }
            // Analze the assignment
            if (n.assign) {
                if (n.assign._step && n.assign._step != step) {
                    n.assign.usedInMultipleSteps = true;
                } else {
                    n.assign._step = step;
                }
            }

            if (n == end) {
                break;
            } else if (n.kind == "step") {
                step = n;
                this.stepsByName.set(n.name, this.steps.length);
                this.steps.push(n);
                n = n.next[0];
            } else if (n.kind == "if") {
                if (n.next.length > 1) {
                    this.traverse(n.next[1], n.blockPartner, step);
                }
                n = n.next[0];
            } else if (n.kind == "call_begin" || n.kind == "yield") {
                this.asyncCalls.push(n);
                n = n.next[0];
            } else {
                n = n.next[0];
            }
        }
    }

    private stackifySteps() {
        for(let i = 0; i < this.steps.length; i++) {
            let n = this.steps[i];
            this.stackifyStep(n, null);
        }
    }

    private stackifyStep(start: Node, end: Node) {
        let n = start.next[0];
        let last: Node;
        for( ; n && n != end; ) {
            last = n;
            if (n.kind == "addr_of") {
                n = n.next[0];
            } else {
                if (n.kind == "if" && n.next[1]) {
                    this.stackifyStep(n.next[1], n.blockPartner);
                }
                let doNotInline: Array<Variable> = [];
                for(let i = 0; i < n.args.length; i++) {
                    let a = n.args[i];
                    if (a instanceof Variable && a.readCount == 1) {
                        // Try to inline the computation
                        let inline = this.findInline(n.prev[0], a, doNotInline);
                        if (inline && (inline.kind != "call_end" || (n.kind == "return" && n.args.length == 0) || n.kind == "store")) {
                            inline.assign = null;
                            n.args[i] = inline;
                            Node.removeNode(inline);
                        }
                    } else if (a instanceof Variable && a.writeCount == 1) {
                        // Try to inline the computation
                        let inline = this.findInlineForMultipleReads(n.prev[0], a, doNotInline);
                        if (inline && (inline.kind != "call_end" || (n.kind == "return" && n.args.length == 0) || n.kind == "store")) {
                            n.args[i] = inline;
                            Node.removeNode(inline);
                        }
                    }
                    if (a instanceof Variable) {
                        doNotInline.push(a);
                    }
                }
                if (n.kind == "step" || n.kind == "goto_step") {
                    break;
                }
                n = n.next[0];
            }
        }
        if (end === null) {
            this.optimizer.analyzeGCDiscoverability(last);
        }
    }

    private findInline(n: Node, v: Variable, doNotInline: Array<Variable>): Node {
        for( ;n; ) {
            if (n.kind == "step" || n.kind == "goto_step" || n.kind == "goto_step_if" || n.kind == "br" || n.kind == "br_if" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end" || n.kind == "return") {
                return null;
            }
            if (n.assign == v) {
                if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                    return null;
                }
                if (this.assignsToVariable(n, doNotInline)) {
                    return null;
                }
                return n;
            }
            n = n.prev[0];
        }
        return null;
    }

    /**
     * Like 'findInline' but is assures that the variable assigned by the returned node is not
     * read between 'n' and its assignment.
     * The variable assignment can then be inlined with a tee.
     */
    private findInlineForMultipleReads(n: Node, v: Variable, doNotInline: Array<Variable>): Node {
        for( ;n; ) {
            if (n.kind == "step" || n.kind == "goto_step" || n.kind == "goto_step_if" || n.kind == "br" || n.kind == "br_if" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end" || n.kind == "return") {
                return null;
            }
            if (this.readsFromVariable(n, v)) {
                return null;
            }
            if (n.assign == v) {
                if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                    return null;
                }
                if (this.assignsToVariable(n, doNotInline)) {
                    return null;
                }
                return n;
            }
            n = n.prev[0];
        }
        return null;
    }

    private assignsToVariable(n: Node, vars: Array<Variable>): boolean {
        if (vars.indexOf(n.assign) != -1) {
            return true;
        }
        for(let a of n.args) {
            if (a instanceof Node) {
                if (this.assignsToVariable(a, vars)) {
                    return true;
                }
            }
        }
        return false;
    }

    private readsFromVariable(n: Node, v: Variable): boolean {
        for(let a of n.args) {
            if (a instanceof Variable && a == v) {
                return true;
            } else if (a instanceof Node) {
                if (this.readsFromVariable(a, v)) {
                    return true;
                }
            }
        }
        return false;
    }

    private analyzeVariableStorage(start: Node, end: Node, locals: Wasm32LocalVariableList, typemap: TypeMap | null = null): TypeMap | null {
        if (!typemap) {
            typemap = new TypeMap();
        }
        let n = start;
        for(; n; ) {
            if (n.kind == "decl_result" && (this.wfIsAsync || n.type instanceof StructType)) {
                // Structs are returned via the heap stack.
                // If async, everything is returned via the heap stack.
                let index = this.resultFrame.addField(n.assign.name, n.type as Type | StructType);
                let s: Wasm32Storage = {storageType: "result", offset: index};
                this.varStorage.set(n.assign, s);
                this.returnVariables.push(n.assign);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_result") {
                let s: Wasm32Storage = {storageType: "local_result", offset: this.wf.results.length};
                this.wf.results.push(this.stackTypeOf(n.type as Type));
                this.varStorage.set(n.assign, s);
                this.returnVariables.push(n.assign);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param" && (n.type instanceof StructType || n.type == "ptr")) {
                // Pointers as arguments must be passed on the stack as well
                let index = this.paramsFrame.addField(n.assign.name, n.type as Type | StructType);
                let s: Wasm32Storage = {storageType: "params", offset: index};
                this.varStorage.set(n.assign, s);
                this.parameterVariables.push(n.assign);                
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param") {
                let s: Wasm32Storage = {storageType: "local", offset: this.wf.parameters.length};
                let t = this.stackTypeOf(n.type as Type);
                this.wf.parameters.push(t);
                this.varStorage.set(n.assign, s);
                if (this.wfIsAsync) {
                    // If the function yields, the heapstack must store the value of the parameter
                    let n = "$param" + s.offset.toString();
                    this.varsFrame.addField(n, t);
                }             
                this.parameterVariables.push(n.assign);                
                n = n.next[0];                
                continue;
            }
            if (n.assign) {
                this.assignVariableStorage(n.assign, locals, typemap);
            }
            for(let v of n.args) {
                if (v instanceof Variable) {
                    this.assignVariableStorage(v, locals, typemap);
                } else if (v instanceof Node) {
                    this.analyzeVariableStorage(v, null, locals, typemap);
                }
            }
            if (n.kind == "if" && n.next.length > 1) {
                this.analyzeVariableStorage(n.next[1], n.blockPartner, locals.clone(), typemap);
                n = n.next[0];
            } else {
                n = n.next[0];                
            }
        }
        return typemap;
    }

    private assignVariableStorage(v: Variable, locals: Wasm32LocalVariableList, typemap: TypeMap): void {
        if (v.name == "$mem") {
            return;
        }
        if (this.varStorage.has(v) || this.globalVarStorage.has(v)) {
            return;
        }
        if (!v.usedInMultipleSteps && !(v.type instanceof StructType) && !v.gcDiscoverable && !v.addressable) {
            // Pointer variables must be put on the stack
            let index = locals.allocate(v.type);
            let s: Wasm32Storage = {storageType: "local_var", offset: index};
            this.varStorage.set(v, s);
        } else {
            let index = this.varsFrame.addField(v.name, v.type);
            let s: Wasm32Storage = {storageType: "vars", offset: index};
            this.varStorage.set(v, s);
            this.typeMapper.mapStack(typemap, v.type, index);
        }
    }

    private emitSteps() {
        for(let i = 0; i < this.steps.length; i++) {
            let n = this.steps[i];
            let c: Array<wasm.Node> = [];
            c.push(new wasm.Comment("STEP " + i.toString()));
            this.emitStep(i, n.next[0], null, c, this.steps.length - i - 1 + this.asyncCalls.length);
            this.stepCode.push(c);
        }
    }

    /**
     * 'depth' is the nesting of block/loop/if constructs.
     * This is required to branch to the function's main loop.
     */
    private emitStep(step: number, start: Node, end: Node | null, code: Array<wasm.Node>, depth: number) {
        code.push(new wasm.End());
        this.emitCode(step, start, end, code, depth, 0)
    }

    private emitCode(step: number, start: Node, end: Node | null, code: Array<wasm.Node>, depth: number, additionalDepth: number) {
        let n = start;
        for( ; n && n != end; ) {
            code.push(new wasm.Comment(n.toString("")));
            if (n.kind == "step") {
                break;
            } else if (n.kind == "if") {
                if (n.type instanceof StructType) {
                    throw "Implementation error"
                }
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n.args[0], "wasmStack", 0, code);
                code.push(new wasm.If());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                if (n.next[1]) {
                    code.push(new wasm.Else());
                    this.emitCode(step, n.next[1], n.blockPartner, code, depth, additionalDepth + 1);
                }
                code.push(new wasm.End());
                n = n.blockPartner.next[0];
            } else if (n.kind == "loop") {
                code.push(new wasm.Loop());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                code.push(new wasm.End());
                n = n.blockPartner.next[0];
            } else if (n.kind == "br") {
                code.push(new wasm.Br(n.args[0] as number));
                n = n.next[0];
            } else if (n.kind == "br_if") {
                this.emitAssign("i32", n.args[0], "wasmStack", 0, code);
                code.push(new wasm.BrIf(n.args[1] as number));
                n = n.next[0];
            } else if (n.kind == "block") {
                code.push(new wasm.Block());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                code.push(new wasm.End());
                n = n.blockPartner.next[0];
            } else if (n.kind == "goto_step") {
                if (n.name == "<end>") {
                    code.push(new wasm.Constant("i32", 0));
                    code.push(new wasm.Return());
                } else {
                    let s = this.stepNumber(n.blockPartner);
                    if (s == step + 1 && additionalDepth == 0) {
                        // Do nothing by intention. Just fall through
                    } else if (s > step) {
                        code.push(new wasm.Comment("goto_step " + n.name));
                        code.push(new wasm.Br(s - step + additionalDepth - 1));
                    } else {
                        code.push(new wasm.Comment("goto_step " + n.name));
                        code.push(new wasm.Constant("i32", this.stepsByName.get(n.name)));
                        code.push(new wasm.SetLocal(this.stepLocal));
                        code.push(new wasm.Br(depth + additionalDepth));
                    }
                }
                break;
            } else if (n.kind == "goto_step_if") {
                this.emitAssign("i32", n.args[0], "wasmStack", 0, code);
                if (n.name == "<end>") {
                    code.push(new wasm.If());
                    code.push(new wasm.Constant("i32", 0));
                    code.push(new wasm.Return());
                    code.push(new wasm.End());                
                } else {
                    let s = this.stepNumber(n.blockPartner);
                    if (s > step) {
                        code.push(new wasm.Comment("goto_step_if " + n.name));
                        code.push(new wasm.BrIf(s - step + additionalDepth - 1));
                    } else {
                        code.push(new wasm.If());
                        code.push(new wasm.Constant("i32", this.stepsByName.get(n.name)));
                        code.push(new wasm.SetLocal(this.stepLocal));
                        code.push(new wasm.Br(depth + additionalDepth + 1));
                        code.push(new wasm.End());
                    }
                }
                n = n.next[0];
            } else if (n.kind == "yield") {
                code.push(new wasm.Br(depth + additionalDepth - this.asyncCalls.length + this.asyncCallCode.length));
                n = n.next[0];
                if (!n || n.kind != "goto_step") {
                    throw "yield must be followed by goto_step";
                }
                if (n.name == "<end>") {
                    throw "goto_step after yield must not return";
                }
                let nextStep = this.stepNumberFromName(n.name);
                let c: Array<wasm.Node> = [];
                c.push(new wasm.Comment("ASYNC CALL " + this.asyncCallCode.length.toString()));
                c.push(new wasm.End());
                c.push(new wasm.Constant("i32", nextStep));
                c.push(new wasm.SetLocal(this.stepLocal));
                c.push(new wasm.Constant("i32", 0));
                c.push(new wasm.SetLocal(this.spLocal));
                c.push(new wasm.Br(this.asyncCalls.length - this.asyncCallCode.length));
                this.asyncCallCode.push(c);
            } else if (n.kind == "call_begin") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                // Allocate a stack frame (if required)
                if (n.type.stackFrame.size > 0) {
                    // Allocate space on the stack                    
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "sub"));
                    code.push(new wasm.SetLocal(this.spLocal));
                    // Put typemap on the stack
                    let typemap = this.typeMapper.mapType(n.type.stackFrame);
                    code.push(new wasm.Comment("Store typemap"));
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", typemap.addr));
                    code.push(new wasm.Store("i32", null, n.type.stackFrame.fieldOffset("$typemapCall")));
                }
                // Put parameters on stack
                for(let i = 1; i < n.args.length; i++) {
                    if (n.type.params[i-1] instanceof FunctionType) {
                        throw "Implementation error"
                    }
                    // Pointers as arguments must be passed on the stack
                    if (n.type.params[i-1] instanceof StructType || n.type.params[i-1] == "ptr") {
                        this.emitAssign(n.type.params[i-1], n.args[i], "heapStack", n.type.stackFrame.fieldOffset("$p" + (i-1).toString()), code);
                    } else {
                        this.emitAssign(n.type.params[i-1], n.args[i], "wasmStack", 0, code);                        
                    }
                }
                code.push(new wasm.Constant("i32", 0)); // Step 0
                code.push(new wasm.GetLocal(this.spLocal));
                // Call the function
                code.push(new wasm.Call(n.args[0] as number));
                // If the call returned with '1', the call returned async
                code.push(new wasm.BrIf(depth + additionalDepth - this.asyncCalls.length + this.asyncCallCode.length));
                n = n.next[0];
                if (!n || n.kind != "goto_step") {
                    throw "call_begin must be followed by goto_step";
                }
                if (n.name == "<end>") {
                    throw "goto_step after call_begin must not return";
                }
                let nextStep = this.stepNumberFromName(n.name);
                // Go to the next step?
                if (nextStep == step + 1) {
                    // Nothing to do: Just fall through to the next step
                    n = n.next[0];
                }
                let c: Array<wasm.Node> = [];
                c.push(new wasm.Comment("ASYNC CALL " + this.asyncCallCode.length.toString()));
                c.push(new wasm.End());
                c.push(new wasm.Constant("i32", nextStep));
                c.push(new wasm.SetLocal(this.stepLocal));
                c.push(new wasm.Br(this.asyncCalls.length - this.asyncCallCode.length));
                this.asyncCallCode.push(c);
            } else if (n.kind == "call_end") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                if (n.assign) {
                    // Put destination addr on wasm stack
                    let destOffset = this.emitAddrOfVariable(n.assign, true, code);
                    // Copy from the stack into the destination
                    this.emitCopy(n.type.result, n.type.stackFrame.fieldOffset("$result"), destOffset, code);
                }
                // Remove the entire stack frame
                if (n.type.stackFrame.size > 0) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                }
                n = n.next[0];
            } else if (n.kind == "store") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                // Get the destination addr
                this.emitWordAssign("addr", n.args[0], "wasmStack", code);
                if (typeof(n.args[1]) != "number") {
                    throw "Implementation error: second arg to store is always a number";
                }
                if (n.args[2] instanceof Node && (n.args[2] as Node).kind == "call_end") {
                    let call_end = n.args[2] as Node;
                    let call_type = call_end.type as FunctionType;
                    // Copy from the stack into the destination
                    code.push(new wasm.GetLocal(this.spLocal));
                    this.emitCopy(n.type, call_type.stackFrame.fieldOffset("$result"), n.args[1] as number, code);
                    // Remove the stack frame                  
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", call_type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                } else {
                    // Copy the value to the destination address
                    this.emitAssign(n.type, n.args[2], "heap", n.args[1] as number, code);
                }
                n = n.next[0];
            } else if (n.kind == "addr_of") {
                if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                    throw "Implementation error"
                }
                if (!(n.args[0] instanceof Variable)) {
                    throw "Implementation error"                    
                }
                this.emitAssign("addr", n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "load") {
                if (n.type instanceof FunctionType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "wrap" || n.kind == "extend") {
                if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "const" || this.isBinaryInstruction(n.kind) || this.isUnaryInstruction(n.kind)) {
                if (n.type instanceof FunctionType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "call" || n.kind == "call_indirect") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type.result, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "return") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error";
                }
                if (n.args.length == 1 && !this.wfIsAsync && !(n.type instanceof StructType)) {
                    if (this.returnVariables.length != 1) {
                        throw "return with one parameter, but function has no return type"
                    }
                    this.emitAssign(n.type as Type, n.args[0], "wasmStack", 0, code);
                } else if (n.args.length == 1 && n.args[0] instanceof Node && (n.args[0] as Node).kind == "call_end") {
                    let call_end = n.args[2] as Node;
                    let call_type = call_end.type as FunctionType;
                    // Put the address of the return value on the wasm stack
                    code.push(new wasm.GetLocal(this.spLocal));
                    let destOffset = this.paramsFrame.size + this.varsFrame.size;
                    // Copy from the stack into the destination
                    code.push(new wasm.GetLocal(this.bpLocal));
                    this.emitCopy(n.type as Type | StructType, call_type.stackFrame.fieldOffset("$result"), 0, code);
                    // Remove the stack frame                  
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", call_type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                } else {
                    if (this.returnVariables.length != n.args.length) {
                        throw "number of return values does not match with return type"
                    }
                    for(let i = 0; i < n.args.length; i++) {
                        let t = this.returnVariables[i].type;
                        // Destination addr
//                        let destOffset = this.emitAddrOfVariable(this.returnVariables[i], true, code);
                        let returnOffset = this.varStorage.get(this.returnVariables[i]).offset;
                        let destOffset = this.paramsFrame.size + this.varsFrame.size + returnOffset;
                        this.emitAssign(t, n.args[i], "heapStack", destOffset, code);
                    }
                }
                if (this.wfIsAsync) {
                    code.push(new wasm.Constant("i32", 0));
                }
                code.push(new wasm.Return());
                n = n.next[0];
            } else if (n.kind == "trap") {
                code.push(new wasm.Unreachable());
                n = n.next[0];
            } else if (n.kind == "copy") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "struct") {
                if (!(n.type instanceof StructType)) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                n = n.next[0];
            } else if (n.kind == "alloc") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
//                if (n.type != "addr" && n.type != "ptr") {
//                    throw "Implementation error"
//                }
                this.emitAssign("ptr", n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "end") {
                // Nothing to do
                n = n.next[0];
            } else {
                // TODO: This clause should never trigger
                throw "TODO " + n.toString("");
//                n = n.next[0];
            }
        }
    }

    /**
     * stack: If a number is passed, store the value on the heapStack with the number as offset.
     */
    private emitAssign(type: Type | StructType, n: Node | Variable | number, dest: "heap" | "heapStack" | "wasmStack" | null, destOffset: number, code: Array<wasm.Node>) {
        if (dest === null && (n instanceof Variable || typeof(n) == "number" || (n instanceof Node && n.kind != "call" && n.kind != "call_indirect" && !n.assign))) {
            throw "Implementation error: No assignment";
        }

        if (type instanceof StructType) {
            if (dest == "wasmStack") {
                throw "Implementation error: StructType on wasmStack is not possible";
            }
            // Synchronous function call that returns a StructType?
            if (n instanceof Node && (n.kind == "call" || n.kind == "call_indirect")) {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error " + n.toString("");
                }
                if (!(n.type.result instanceof StructType)) {
                    throw "Implementation error.";
                }
                let assignOffset = 0;
                if (n.assign) {
                    // Put destination addr on stack
                    assignOffset = this.emitAddrOfVariable(n.assign, true, code);
                }
                let stackSubtract = n.type.stackFrame.size;
                // If the result should end up somewhere on the heapStack, create the stack frame right there
                if (dest == "heapStack") {
                    // Put the destination address on the stack
                    // It must hold that the destination address is above the SP
                    code.push(new wasm.GetLocal(this.spLocal));                
//                    stackSubtract -= destOffset;
                }
                // Make room for the stack frame on the heap stack
                code.push(new wasm.Comment("Create stack frame"));
                code.push(new wasm.GetLocal(this.spLocal));
//                if (stackSubtract < 0) {
//                    code.push(new wasm.Constant("i32", -stackSubtract));
//                    code.push(new wasm.BinaryInstruction("i32", "add"));
//                } else {
                code.push(new wasm.Constant("i32", stackSubtract));
                code.push(new wasm.BinaryInstruction("i32", "sub"));
//                }
                code.push(new wasm.SetLocal(this.spLocal));
                // Put typemap on the stack
                let typemap = this.typeMapper.mapType(n.type.stackFrame);
                code.push(new wasm.Comment("Store typemap"));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", (!typemap || typemap.offsets.length == 0) ? 0 : typemap.addr));
                code.push(new wasm.Store("i32", null, n.type.stackFrame.fieldOffset("$typemapCall")));
                // Put parameters on wasm/heap stack
                let paramTypes: Array<wasm.StackType> = [];
                for(let i = 0; i < n.type.params.length; i++) {
                    code.push(new wasm.Comment("parameter " + i.toString()));
                    // Pointers must be passed on the stack, too
                    if (n.type.params[i] instanceof StructType || n.type.params[i] == "ptr") {
//                    code.push(new wasm.Comment(">>parameter " + i.toString()));
//                        code.push(new wasm.GetLocal(this.spLocal));
//                    code.push(new wasm.Comment("<<parameter " + i.toString()));
                        this.emitAssign(n.type.params[i], n.args[i+1], "heapStack", n.type.stackFrame.fieldOffset("$p" + i.toString()), code);
                    } else {
                        if (n.kind == "call_indirect") {
                            paramTypes.push(this.stackTypeOf(n.type.params[i] as Type));
                        }
                        this.emitAssign(n.type.params[i], n.args[i+1], "wasmStack", 0, code);                    
                    }
                }
                // Call the function
                if (n.args[0] < 0) {
                    if (n.args[0] == SystemCalls.appendSlice) {
                        let typemap = this.typeMapper.mapType(n.type.ellipsisParam);
                        code.push(new wasm.Constant("i32", (!typemap || typemap.offsets.length == 0) ? 0 : typemap.addr));
                        code.push(new wasm.GetLocal(this.spLocal));
                        code.push(new wasm.Call(this.sliceAppendFunctionIndex));
                    } else if (n.args[0] == SystemCalls.growSlice) {
                        code.push(new wasm.Constant("i32", (!typemap || typemap.offsets.length == 0) ? 0 : typemap.addr));
                        code.push(new wasm.GetLocal(this.spLocal));
                        code.push(new wasm.Call(this.growSliceFunctionIndex));                        
                    } else {
                        throw "Implementation error";
                    }
                } else {
                    if (n.type.callingConvention == "fyr" || n.type.callingConvention == "fyrCoroutine") {
                        // Put SP on wasm stack
                        code.push(new wasm.GetLocal(this.spLocal));
                        if (n.kind == "call_indirect") {
                            paramTypes.push("i32");
                        }
                    }
                    if (n.kind == "call_indirect") {
                        this.emitAssign("s32", n.args[0], "wasmStack", 0, code);
                        let typeName = this.module.addFunctionType(paramTypes, []);
                        code.push(new wasm.CallIndirect(typeName));
                    } else {
                        code.push(new wasm.Call(n.args[0] as number | string));
                    }
                }
                // Assign
                if (n.assign) {
                    // Copy the struct from the heapStack to the assigned variable
                    code.push(new wasm.GetLocal(this.spLocal));
                    this.emitCopy(n.type.result, n.type.stackFrame.fieldOffset("$result"), assignOffset, code);
                }
                if (dest == "heap" || dest == "heapStack") {
                    // Copy the struct from the heapStack to the destination address that is already on the stack.
                    // This consumes the destination address
                    code.push(new wasm.GetLocal(this.spLocal));
                    this.emitCopy(n.type.result, n.type.stackFrame.fieldOffset("$result"), destOffset, code);
                }
                // Remove the stack frame and restore the SP
                code.push(new wasm.Comment("Remove stack frame and restore the SP"));
                code.push(new wasm.GetLocal(this.spLocal));
//                if (stackSubtract < 0) {
//                    code.push(new wasm.Constant("i32", -stackSubtract));
//                    code.push(new wasm.BinaryInstruction("i32", "sub"));
//                } else {
                code.push(new wasm.Constant("i32", stackSubtract));
                code.push(new wasm.BinaryInstruction("i32", "add"));
//                }
                code.push(new wasm.SetLocal(this.spLocal));
                return;
            }

            // Constructing a struct?
            if (n instanceof Node && n.kind == "struct") {
                // Put the destination addr on the stack (if it is not already there or if it is the SP)
                if (dest === null) {
                    destOffset = this.emitAddrOfVariable(n.assign, true, code);
                }

                // Compute the field values and store them
                let args = 0;
                for(let i = 0; i < type.fields.length; i++) {
                    let f = type.fields[i];
                    let name: string = f[0];
                    let t: Type | StructType = f[1];
                    let size = sizeOf(t);
                    let arrOffset = 0;
                    for(let j = 0; j < f[2]; j++, arrOffset += size) {
                        if (dest == "heapStack") {
                            this.emitAssign(t, n.args[args], "heapStack", destOffset + type.fieldOffset(name) + arrOffset, code);
                        } else {
                            // Double the destination address (unless it is SP)
                            let tmp = this.getTmpLocal("i32");
                            code.push(new wasm.TeeLocal(tmp));
                            code.push(new wasm.GetLocal(tmp));
                            this.emitAssign(t, n.args[args], "heap", destOffset + type.fieldOffset(name) + arrOffset, code);
                        }
                        args++;
                    }
                }

                if (n.assign && dest !== null) {
                    // Put the source address on the stack (unless it is already there)
                    if (dest == "heapStack") {
                        code.push(new wasm.GetLocal(this.spLocal));
                    }
                    let assignOffset = this.emitAddrOfVariable(n.assign, true, code);
                    this.emitCopy(type, destOffset, assignOffset, code);
                } else if (dest == "heap" || n.assign) {
                    code.push(new wasm.Drop());
                }
                return;
            }

            // An expression of type StructType?
            if (typeof(n) == "number") {
                throw "Implementation error: A number cannot be of type StructType " + type.name;
            } else if (n instanceof Variable) {
                let srcOffset = this.emitAddrOfVariable(n, true, code);
                if (dest === "heapStack") {
                    code.push(new wasm.GetLocal(this.spLocal));
                }
                this.emitCopy(type, srcOffset, destOffset, code);
            } else if (n instanceof Node) {
                if (n.kind == "copy" || n.kind == "load") {
                    let assignDest: "heap" | "heapStack" = "heap"
                    // Put the destination addr on the stack (if it is not already there)
                    if (dest === null) {
                        destOffset = this.emitAddrOfVariable(n.assign, true, code);
                    } else if (dest === "heapStack") {
                        assignDest = "heapStack";
                    } else if (dest === "heap" && n.assign) {
                        // Duplicate the heap addr in case we need to copy the value to the assigned variable
                        let tmp = this.getTmpLocal("i32");
                        code.push(new wasm.TeeLocal(tmp));
                        code.push(new wasm.GetLocal(tmp));
                    }
                    // Copy the value
                    if (n.kind == "load") {
                        this.emitAssign("addr", n.args[0], "wasmStack", 0, code);
                        this.emitCopy(type, n.args[1] as number, destOffset, code);
                    } else {
                        this.emitAssign(type, n.args[0], assignDest, destOffset, code);
                    }
                    // Assign and stack?
                    if (n.assign && dest !== null) {
                        // Put the destination address on the stack
                        let assignOffset = this.emitAddrOfVariable(n.assign, true, code);
                        // Put the source address on the stack (unless it is already there)
                        if (dest == "heapStack") {
                            code.push(new wasm.GetLocal(this.spLocal));
                        }
                        this.emitCopy(type, destOffset, assignOffset, code);
                    }
                }
            } else {
                throw "Implementation error: Node " + (n as Node).kind + " cannot yield a StructType";
            }
            return;
        }

        //
        // The expression is of a type that can be put on the wasm stack
        //

        if (dest == "heapStack") {
            code.push(new wasm.GetLocal(this.spLocal));
        }
        this.emitWordAssign(type, n, dest !== null ? "wasmStack" : null, code);
        if (dest == "heapStack" || dest == "heap") {
            let width: wasm.StackType = this.stackTypeOf(type);
            let asWidth: null | "8"| "16" | "32" = null;
            switch (type) {
                case "i8":
                case "s8":
                    asWidth = "8";
                    break;
                case "i16":
                case "s16":
                    asWidth = "16";
                    break;
            }
            code.push(new wasm.Store(width, asWidth, destOffset));
        }
    }

    private emitCopy(type: Type | StructType, srcOffset: number, destOffset: number, code: Array<wasm.Node>) {
        let size = sizeOf(type);
        let align = alignmentOf(type);
        switch (size) {
            case 1:
                code.push(new wasm.Load("i32", "8_u", srcOffset, align));
                code.push(new wasm.Store("i32", "8", destOffset, align));
                break;
            case 2:
                code.push(new wasm.Load("i32", "16_u", srcOffset, align));
                code.push(new wasm.Store("i32", "16", destOffset, align));
                break;
            case 4:
                code.push(new wasm.Load("i32", null, srcOffset, align));
                code.push(new wasm.Store("i32", null, destOffset, align));
                break;
            case 8:
                code.push(new wasm.Load("i64", null, srcOffset, align));
                code.push(new wasm.Store("i64", null, destOffset, align));
                break;
            case 12:
            {
                let src = this.getTmpLocal("src");
                code.push(new wasm.SetLocal(src));
                let dest = this.getTmpLocal("dest");
                code.push(new wasm.TeeLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i64", null, srcOffset, align));
                code.push(new wasm.Store("i64", null, destOffset, align));
                code.push(new wasm.GetLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i32", null, 8 + srcOffset, align));
                code.push(new wasm.Store("i32", null, 8 + destOffset, align));
                break;
            }
            case 16:
            {
                let src = this.getTmpLocal("src");
                code.push(new wasm.SetLocal(src));
                let dest = this.getTmpLocal("dest");
                code.push(new wasm.TeeLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i64", null, srcOffset, align));
                code.push(new wasm.Store("i64", null, destOffset, align));
                code.push(new wasm.GetLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i64", null, 8 + srcOffset, align));
                code.push(new wasm.Store("i64", null, 8 + destOffset, align));
                break;
            }
            default:
            {
                let tmp = this.getTmpLocal("i32");
                code.push(new wasm.SetLocal(tmp));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.GetLocal(tmp));
                if (srcOffset != 0) {
                    code.push(new wasm.Constant("i32", srcOffset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));                    
                }
                if (destOffset != 0) {
                    let tmp = this.getTmpLocal("i32");
                    code.push(new wasm.SetLocal(tmp));
                    code.push(new wasm.Constant("i32", destOffset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.GetLocal(tmp));
                }
                code.push(new wasm.Constant("i32", sizeOf(type)));
                code.push(new wasm.Call(this.copyFunctionIndex));
                break;
            }
        }
    }

    private emitAddrOfVariable(v: Variable, returnOffset: boolean, code: Array<wasm.Node>): number {
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "vars":
                code.push(new wasm.GetLocal(this.bpLocal));
                let offset = this.varsFrame.fieldOffset(v.name);
                if (returnOffset) {
                    return offset;
                }
                if (offset != 0) {
                    code.push(new wasm.Constant("i32", offset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                }
                break;                
            case "params":
            {
                code.push(new wasm.GetLocal(this.bpLocal));
                let offset = this.varsFrame.size + this.paramsFrame.fieldOffset(v.name);
                if (returnOffset) {
                    return offset;
                }
                if (offset != 0) {
                    code.push(new wasm.Constant("i32", offset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                }
                break;                
            }
            case "result":
            {
                code.push(new wasm.GetLocal(this.bpLocal));
                let offset = this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name);
                if (returnOffset) {
                    return offset;
                }
                if (offset != 0) {
                    code.push(new wasm.Constant("i32", offset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                }
                break;
            }      
            case "global_heap":
            {
                let s = this.globalVarStorage.get(v);
                code.push(new wasm.Constant("i32", s.offset));
                break;
            }
            default:
                throw "Implementation error"
        }
        return 0;
    }

    private emitWordAssign(type: Type, n: Node | Variable | number, stack: "wasmStack" | null, code: Array<wasm.Node>) {
        if (stack == null && (n instanceof Variable || typeof(n) == "number" || (n.kind != "call" && n.kind != "call_indirect" && !n.assign))) {
            throw "Implementation error: No assignment"
        }

        if (n instanceof Node) {
            return this.emitWordNode(n, stack, code);
        } else if (n instanceof Variable) {
            return this.emitWordVariable(type, n, code);
        } else {
            let width: wasm.StackType = this.stackTypeOf(type);
            code.push(new wasm.Constant(width, n));
        }
    }

    private emitWordVariable(type: Type, v: Variable, code: Array<wasm.Node>) {
        let width: wasm.StackType = this.stackTypeOf(type);
        let asWidth: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
        switch (type) {
            case "i8":
                asWidth = "8_u";
                break;
            case "s8":
                asWidth = "8_s";
                break;
            case "i16":
                asWidth = "16_u";
                break;
            case "s16":
                asWidth = "16_s";
                break;
        }        
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "local":
                code.push(new wasm.GetLocal(s.offset));
                break;
            case "vars":
                code.push(new wasm.GetLocal(this.bpLocal));
                code.push(new wasm.Load(width, asWidth, this.varsFrame.fieldOffset(v.name)));
                break;                
            case "params":
                code.push(new wasm.GetLocal(this.bpLocal));
                code.push(new wasm.Load(width, asWidth, this.varsFrame.size + this.paramsFrame.fieldOffset(v.name)));
                break;                
            case "result":
                code.push(new wasm.GetLocal(this.bpLocal));
                code.push(new wasm.Load(width, asWidth, this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name)));
                break;      
            case "global":
//                console.log("GET", v.name, s.offset);
                code.push(new wasm.GetGlobal(s.offset));
                break;
            case "global_heap":
                let st = this.globalVarStorage.get(v);
                code.push(new wasm.Constant("i32", st.offset));
                code.push(new wasm.Load(width, asWidth, 0));
                break;
        }
    }

    /**
     * Emits code for Node 'n'. The result of the node is a word-type (i.e. it fits on the WASM stack).
     * The result is either assigned to a variable or put on the wasm stack or both or no
     * assignment happens at all.
     */
    private emitWordNode(n: Node, stack: "wasmStack" | null, code: Array<wasm.Node>) {
        if (n.kind == "alloc") {
            if (n.assign) {
                this.storeVariableFromWasmStack1("addr", n.assign, code);
            }
            let size = sizeOf(n.type as Type | StructType);
            this.emitWordAssign("i32", n.args[0], "wasmStack", code);
            code.push(new wasm.Constant("i32", size));
            let m = this.typeMapper.mapType(n.type as Type | StructType);
            if (m == null || m.offsets.length == 0) {
                code.push(new wasm.Constant("i32", 0));
            } else {
                code.push(new wasm.Constant("i32", m.addr));
            }
            if (n.args.length == 2) {
                let headType = (n.args[1] as Variable).type;
                let headSize = sizeOf(headType);
                code.push(new wasm.Constant("i32", headSize));
                let m = this.typeMapper.mapType(headType);
                if (!m) {
                    throw "Implementation error. headType must have a TypeMap"                    
                }
                code.push(new wasm.Constant("i32", m.addr));                
            } else {
                code.push(new wasm.Constant("i32", 0));
                code.push(new wasm.Constant("i32", 0));                
            }
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Call(this.allocFunctionIndex));
            if (n.assign) {
                this.storeVariableFromWasmStack2("addr", n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "addr_of") {
            if (n.assign) {
                this.storeVariableFromWasmStack1("addr", n.assign, code);
            }
            this.emitAddrOfVariable(n.args[0] as Variable, false, code);
            if (n.assign) {
                this.storeVariableFromWasmStack2("addr", n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "const") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            let width: wasm.StackType = this.stackTypeOf(n.type);
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            code.push(new wasm.Constant(width, n.args[0] as number));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "load") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign("addr", n.args[0], "wasmStack", code);
            let width: wasm.StackType = this.stackTypeOf(n.type);
            let asWidth: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
            switch (n.type) {
                case "i8":
                    asWidth = "8_u";
                    break;
                case "s8":
                    asWidth = "8_s";
                    break;
                case "i16":
                    asWidth = "16_u";
                    break;
                case "s16":
                    asWidth = "16_s";
                    break;
            }
            code.push(new wasm.Load(width, asWidth, n.args[1] as number));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (this.isBinaryInstruction(n.kind)) {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            this.emitWordAssign(n.type, n.args[1], "wasmStack", code);
            let width: wasm.StackType = this.stackTypeOf(n.type);
            code.push(new wasm.BinaryInstruction(width, n.kind as wasm.BinaryOp));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (this.isUnaryInstruction(n.kind)) {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            let width: wasm.StackType = this.stackTypeOf(n.type);
            code.push(new wasm.BinaryInstruction(width, n.kind as wasm.BinaryOp));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "extend") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            code.push(new wasm.Extend(isSigned(n.type)));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "wrap") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            code.push(new wasm.Wrap());
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "copy") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "call" || n.kind == "call_indirect") {
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error " + n.toString("");
            }
            if (n.type.result instanceof StructType) {
                throw "Implementation error. StructType returns are handled elsewhere";
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type.result as Type, n.assign, code);
            }
            // Allocate a stack frame
            if (n.type.stackFrame.size > 0) {
                // Save the stack pointer
                code.push(new wasm.Comment("Create stack frame for " + (n.args[0] as number).toString()));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                code.push(new wasm.BinaryInstruction("i32", "sub"));
                code.push(new wasm.SetLocal(this.spLocal));
                // Put typemap on the stack
                let typemap = this.typeMapper.mapType(n.type.stackFrame);
                code.push(new wasm.Comment("Store typemap"));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", typemap.offsets.length == 0 ? 0 : typemap.addr));
                code.push(new wasm.Store("i32", null, n.type.stackFrame.fieldOffset("$typemapCall")));
            }
            // Put parameters on the stack
            let paramTypes: Array<wasm.StackType> = [];
            for(let i = 0; i < n.type.params.length; i++) {
                code.push(new wasm.Comment("parameter " + i.toString()));
                // Pointers must be pased on the stack
                if (n.type.params[i] instanceof StructType || n.type.params[i] == "ptr") {
                    this.emitAssign(n.type.params[i], n.args[i+1], "heapStack", n.type.stackFrame.fieldOffset("$p" + i.toString()), code);
                } else {
                    if (n.kind == "call_indirect") {
                        paramTypes.push(this.stackTypeOf(n.type.params[i] as Type))
                    }
                    this.emitAssign(n.type.params[i], n.args[i+1], "wasmStack", 0, code);                    
                }
            }
            if (n.type.callingConvention == "fyr") {
                if (n.kind == "call_indirect") {
                    paramTypes.push("i32");
                }
                code.push(new wasm.GetLocal(this.spLocal));
            }
            // Call the function
            if (n.args[0] < 0) {
                if (n.args[0] == SystemCalls.heap) {
                    code.push(new wasm.GetGlobal(this.heapGlobalVariableIndex));
                } else if (n.args[0] == SystemCalls.currentMemory) {
                    code.push(new wasm.CurrentMemory());
                } else if (n.args[0] == SystemCalls.growMemory) {
                    code.push(new wasm.GrowMemory());
                } else if (n.args[0] == SystemCalls.heapTypemap) {
                    code.push(new wasm.GetGlobal(this.typemapGlobalVariableIndex));
                } else if (n.args[0] == SystemCalls.pageSize) {
                    code.push(new wasm.Constant("i32", 1 << 16));
                } else if (n.args[0] == SystemCalls.defaultStackSize) {
                    code.push(new wasm.Constant("i32", this.stackSize));
                } else if (n.args[0] == SystemCalls.garbageCollect) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.garbageCollectFunctionIndex));
                } else if (n.args[0] == SystemCalls.stackPointer) {
                    code.push(new wasm.GetLocal(this.spLocal));
                } else if (n.args[0] == SystemCalls.copy) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.copyFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.makeString) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.makeStringFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.concatString) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.concatStringFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.compareString) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.compareStringFunctionIndex));
                } else if (n.args[0] == SystemCalls.createMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.createMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.setMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.setMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.lookupMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.lookupMapFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.removeMapKey) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.removeMapKeyFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.hashString) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.hashStringFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.setNumericMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.setNumericMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.lookupNumericMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.lookupNumericMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.removeNumericMapKey) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.removeNumericMapKeyFunctionIndex));
                } else if (n.args[0] == SystemCalls.abs32) {
                    code.push(new wasm.UnaryInstruction("f32", "abs"));
                } else if (n.args[0] == SystemCalls.abs64) {
                    code.push(new wasm.UnaryInstruction("f64", "abs"));
                } else if (n.args[0] == SystemCalls.sqrt32) {
                    code.push(new wasm.UnaryInstruction("f32", "sqrt"));
                } else if (n.args[0] == SystemCalls.sqrt64) {
                    code.push(new wasm.UnaryInstruction("f64", "sqrt"));
                } else if (n.args[0] == SystemCalls.trunc32) {
                    code.push(new wasm.UnaryInstruction("f32", "trunc"));
                } else if (n.args[0] == SystemCalls.trunc64) {
                    code.push(new wasm.UnaryInstruction("f64", "trunc"));
                } else if (n.args[0] == SystemCalls.nearest32) {
                    code.push(new wasm.UnaryInstruction("f32", "nearest"));
                } else if (n.args[0] == SystemCalls.nearest64) {
                    code.push(new wasm.UnaryInstruction("f64", "nearest"));
                } else if (n.args[0] == SystemCalls.floor32) {
                    code.push(new wasm.UnaryInstruction("f32", "floor"));
                } else if (n.args[0] == SystemCalls.floor64) {
                    code.push(new wasm.UnaryInstruction("f64", "floor"));
                } else if (n.args[0] == SystemCalls.ceil32) {
                    code.push(new wasm.UnaryInstruction("f32", "ceil"));
                } else if (n.args[0] == SystemCalls.ceil64) {
                    code.push(new wasm.UnaryInstruction("f64", "ceil"));
                } else if (n.args[0] == SystemCalls.min32) {
                    code.push(new wasm.BinaryInstruction("f32", "min"));
                } else if (n.args[0] == SystemCalls.min64) {
                    code.push(new wasm.BinaryInstruction("f64", "min"));
                } else if (n.args[0] == SystemCalls.max32) {
                    code.push(new wasm.BinaryInstruction("f32", "max"));
                } else if (n.args[0] == SystemCalls.max64) {
                    code.push(new wasm.BinaryInstruction("f64", "max"));
                } else if (n.args[0] == SystemCalls.copysign32) {
                    code.push(new wasm.BinaryInstruction("f32", "copysign"));
                } else if (n.args[0] == SystemCalls.copysign64) {
                    code.push(new wasm.BinaryInstruction("f64", "copysign"));
                } else {
                    throw "Implementation error. Unknown system function " + n.args[0];
                }
            } else {
                if (n.kind == "call_indirect") {
                    this.emitAssign("s32", n.args[0], "wasmStack", 0, code);
                    let resultTypes = [];
                    if (n.type.result) {
                        resultTypes.push(n.type.result);
                    }
                    let typeName = this.module.addFunctionType(paramTypes, resultTypes);
                    code.push(new wasm.CallIndirect(typeName));
                } else {
                    code.push(new wasm.Call(n.args[0] as number));
                }
            }
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type.result as Type, n.assign, stack == "wasmStack", code);
            } else if (stack == null && n.type.result) {
                // Remove result from wasm stack
                code.push(new wasm.Drop());
            }
            if (n.type.stackFrame.size > 0) {
                code.push(new wasm.Comment("Remove parameters"));
                // Remove parameters from stack
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                code.push(new wasm.SetLocal(this.spLocal));
            }
            n = n.next[0];            
        } else {
            throw "Implementation error emitAssignWordNode " + n.kind;
        }
    }

    private storeVariableFromWasmStack1(type: Type, v: Variable, code: Array<wasm.Node>) {
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "vars":
            case "params":
            case "result":
                code.push(new wasm.GetLocal(this.bpLocal));
                break;
            case "global_heap":
                let s = this.globalVarStorage.get(v);
                code.push(new wasm.Constant("i32", s.offset));
                break;
        }
    }

    private storeVariableFromWasmStack2(type: Type, v: Variable, tee: boolean, code: Array<wasm.Node>) {
        let width: wasm.StackType = this.stackTypeOf(type);
        let asWidth: null | "8"| "16" | "32" = null;
        switch (type) {
            case "i8":
            case "s8":
                asWidth = "8";
                break;
            case "i16":
            case "s16":
                asWidth = "16";
                break;
        }
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "local":
                if (tee) {
                    code.push(new wasm.TeeLocal(s.offset));
                } else {
                    code.push(new wasm.SetLocal(s.offset));
                }
                break;
            case "global":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.SetGlobal(s.offset));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
            case "vars":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, this.varsFrame.fieldOffset(v.name)));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
            case "params":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, this.varsFrame.size + this.paramsFrame.fieldOffset(v.name)));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
            case "result":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name)));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;     
            case "global_heap":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, 0));                
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
        }
    }

    private asyncCallNumber(n: Node): number {
        return this.asyncCalls.indexOf(n);
    }

    private stepNumber(n: Node): number {
        return this.steps.indexOf(n);
    }

    private stepNumberFromName(name: string): number {
        return this.stepsByName.get(name);
    }

    private isBinaryInstruction(kind: NodeKind): boolean {
        switch(kind) {
            case "add":
            case "sub":
            case "mul":
            case "div":
            case "div_s":
            case "div_u":
            case "rem_s":
            case "rem_u":
            case "and":
            case "or":
            case "xor":
            case "shl":
            case "shr_u":
            case "shr_s":
            case "rotl":
            case "rotr":
            case "eq":
            case "ne":
            case "lt_s":
            case "lt_u":
            case "le_s":
            case "le_u":
            case "gt_s":
            case "gt_u":
            case "ge_s":
            case "ge_u":
            case "lt":
            case "gt":
            case "le":
            case "ge":
            case "min":
            case "max":
                return true;
        }
        return false;
    }

    private isUnaryInstruction(kind: NodeKind): boolean {
        switch(kind) {
            case "eqz":
            case "clz":
            case "ctz":
            case "popcnt":
            case "neg":
            case "abs":
            case "copysign":
            case "ceil":
            case "floor":
            case "trunc":
            case "nearest":
            case "sqrt":
                return true;
        }
        return false;
    }

    private stackTypeOf(t: Type): wasm.StackType {
        switch(t) {
            case "i64":
            case "s64":
                return "i64";
            case "f64":
                return "f64";
            case "f32":
                return "f32";
        }
        return "i32";
    }

    private getTmpLocal(type: Type | "src" | "dest"): number {
        switch(type) {
            case "src":
                if (this.tmpI32SrcLocal == -1) {
                    this.tmpI32SrcLocal = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push("i32");
                }
                return this.tmpI32SrcLocal;
            case "dest":
                if (this.tmpI32DestLocal == -1) {
                    this.tmpI32DestLocal = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push("i32");
                }
                return this.tmpI32DestLocal;
            case "i32":
                if (this.tmpI32Local == -1) {
                    this.tmpI32Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpI32Local;
            case "i64":
                if (this.tmpI64Local == -1) {
                    this.tmpI64Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpI64Local;
            case "f32":
                if (this.tmpF32Local == -1) {
                    this.tmpF32Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpF32Local;
            case "f64":
                if (this.tmpF64Local == -1) {
                    this.tmpF64Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpF64Local;
        }
        throw "Implementation error";
    }

    private storageOf(v: Variable): Wasm32Storage {
        if (this.varStorage.has(v)) {
            return this.varStorage.get(v);
        }
        return this.globalVarStorage.get(v);
    }

    private wfHasHeapFrame(): boolean {
        for(let s of this.varStorage.values()) {
            if (s.storageType == "result" || s.storageType == "vars" || s.storageType == "params") {
                return true;
            }
        }
        return false;
    }

    public module: wasm.Module;
    public typeMapper: TypeMapper;
    
    private tr: SMTransformer;
    private optimizer: Optimizer;
    private funcs: Array<{node: Node, wf: wasm.Function}>;
    private globalVariables: Array<Variable>;
    private globalVarStorage: Map<Variable, Wasm32Storage>;
    private copyFunctionIndex: string = "$copy";
    private allocFunctionIndex: string = "$alloc";
    private sliceAppendFunctionIndex: string = "$appendSlice";
    private garbageCollectFunctionIndex: string = "$garbageCollect";
    private growSliceFunctionIndex: string = "$growSlice";
    private makeStringFunctionIndex: string = "$makeString";
    private compareStringFunctionIndex: string = "$compareString";
    private concatStringFunctionIndex: string = "$concatString";
    private hashStringFunctionIndex: string = "$hashString";
    private createMapFunctionIndex: string = "$createMap";
    private setMapFunctionIndex: string = "$setMap";
    private lookupMapFunctionIndex: string = "$lookupMap";
    private removeMapKeyFunctionIndex: string = "$removeMapKey";
    private setNumericMapFunctionIndex: string = "$setNumericMap";
    private lookupNumericMapFunctionIndex: string = "$lookupNumericMap";
    private removeNumericMapKeyFunctionIndex: string = "$removeNumericMapKey";
    private stepLocal: number;
    private bpLocal: number;
    private spLocal: number;
    private steps: Array<Node>;
    private stepCode: Array<Array<wasm.Node>>;
    private stepsByName: Map<string, number>;
    private asyncCalls: Array<Node>;
    private asyncCallCode: Array<Array<wasm.Node>>;
    private resultFrame: StructType;
    private paramsFrame: StructType;
    private varsFrame: StructType;
    private varsFrameHeader: StructType;
    private varStorage: Map<Variable, Wasm32Storage>;
    private parameterVariables: Array<Variable>;
    private returnVariables: Array<Variable>;
    private tmpI32Local: number;
    private tmpI64Local: number;
    private tmpF32Local: number;
    private tmpF64Local: number;
    private tmpI32SrcLocal: number;
    private tmpI32DestLocal: number;
    private wf: wasm.Function;
    private wfIsAsync: boolean;
    private emitIR: boolean;
    private emitIRFunction: string | null;
    private heapGlobalVariable: wasm.Global;
    private heapGlobalVariableIndex: number;
    private typemapGlobalVariable: wasm.Global;
    private typemapGlobalVariableIndex: number;
    private customglobalVariablesIndex: number;
    private heapSize: number = 16 << 16; // 1 MB heap
    private stackSize: number = 1 << 16; // 64kb Stack
}
