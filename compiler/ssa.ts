import {Package} from "./pkg"
import { ImplementationError } from "./errors";

export type NodeKind = "coroutine" | "resume" | "spawn" | "spawn_indirect" | "promote" | "demote" | "trunc32" | "trunc64" | "convert32_u" | "convert32_s" | "convert64_u" | "convert64_s" | "goto_step" | "goto_step_if" | "step" | "call_begin" | "call_end" | "call_indirect" | "call_indirect_begin" | "define" | "decl_param" | "decl_result" | "decl_var" | "alloc" | "return" | "yield" | "yield_continue" | "block" | "loop" | "end" | "if" | "br" | "br_if" | "copy" | "struct" | "trap" | "load" | "store" | "addr_of" | "call" | "const" | "add" | "sub" | "mul" | "div" | "div_s" | "div_u" | "rem_s" | "rem_u" | "and" | "or" | "xor" | "shl" | "shr_u" | "shr_s" | "rotl" | "rotr" | "eq" | "ne" | "lt_s" | "lt_u" | "le_s" | "le_u" | "gt_s" | "gt_u" | "ge_s" | "ge_u" | "lt" | "gt" | "le" | "ge" | "min" | "max" | "eqz" | "clz" | "ctz" | "popcnt" | "neg" | "abs" | "copysign" | "ceil" | "floor" | "trunc" | "nearest" | "sqrt" | "wrap" | "extend" | "free" | "incref" | "decref" | "alloc_arr" | "free_arr" | "incref_arr" | "decref_arr" | "member" | "set_member" | "len_arr" | "memcpy" | "memmove" | "memcmp" | "len_str" | "table_iface" | "addr_of_func" | "symbol" | "lock" | "unlock" | "notnull" | "notnull_ref" | "println" | "arr_to_str" | "move_arr" | "union";
export type Type = "i8" | "i16" | "i32" | "i64" | "s8" | "s16" | "s32" | "s64" | "addr" | "f32" | "f64" | "ptr" | "int" | "sint";

export var intSize = 4;
export var ptrSize = 8;
export var symbolType: Type = "addr";

export class PointerType {
    constructor(elementType: Type | StructType | PointerType, isConst: boolean) {
        this.elementType = elementType;
        this.isConst = isConst;
    }

    public finalize() {
        if (this.elementType instanceof StructType) {
            this.elementType.finalize()
        } else if (this.elementType instanceof PointerType) {
            this.elementType.finalize()
        }
    }

    public elementType: Type | StructType | PointerType;
    public isConst: boolean;
}

export class StructType {
    public addField(name: string, type: Type | StructType | PointerType, count: number = 1): void {
        this.fields.push([name, type, count]);
    }

    public addFields(s: StructType): void {
        for(let f of s.fields) {
            this.addField(f[0], f[1], f[2]);
        }
    }

    public extend(s: StructType): void {
        this.extends = s;
    }

    /**
     * Computes the size and offsets of structs.
     * Due to recursivte types, we can do that only after all fields are added to a StructType.
     */
    public finalize(): void {
        if (this.finalized) {
            return
        }
        // This will recursively finalize the types of all fields.
        // However, for pointer types are not finalized.
        for (let field of this.fields) {
            if (this.isUnion) {
                this.size = Math.max(this.size, sizeOf(field[1]));
                this.fieldOffsetsByName.set(field[0], 0);
            } else {
                let align = alignmentOf(field[1]);
                this.alignment = Math.max(this.alignment, align);
                let alignOffset = (align - this.size % align) % align;
                this.size += alignOffset;
                this.fieldOffsetsByName.set(field[0], this.size);
                this.size += field[2] * alignedSizeOf(field[1]);
            }
        }
        this.finalized = true;
        // Finalize all referenced types
        for (let field of this.fields) {
            if (field[1] instanceof PointerType) {
                field[1].finalize()
            }
        }
    }

    public fieldOffset(name: string): number {
        let offset = this.fieldOffsetsByName.get(name);
        if (offset === undefined) {
            if (this.extends) {
                return this.extends.fieldOffset(name);
            }
            throw new ImplementationError(name)
        }
        return offset;
    }

    public fieldNameByIndex(index: number): string {
        return this.fields[index][0];
    }

    public fieldIndexByName(name: string): number {
        for(var i = 0; i < this.fields.length; i++) {
            if (this.fields[i][0] == name) {
                return i;
            }
        }
        throw new ImplementationError(name)
    }

    public fieldTypeByName(name: string): Type | StructType | PointerType {
        for(var i = 0; i < this.fields.length; i++) {
            if (this.fields[i][0] == name) {
                return this.fields[i][1];
            }
        }
        throw new ImplementationError(name)
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
    public fields: Array<[string, Type | StructType | PointerType, number]> = [];
    public fieldOffsetsByName: Map<string, number> = new Map<string, number>();
    public size: number = 0;
    public name: string | null;
    public alignment: number = 1;
    public isUnion: boolean = false;
    // The package the type has been defined in.
    // Anonymous structs like arrays and tuples are not associated to any package.
    public pkg?: Package;
    private extends: StructType;
    public finalized: boolean;
}

export function alignmentOf(x: Type | StructType | PointerType): number {
    if (x instanceof StructType) {
        if (x.fields.length == 0) {
            return 1;
        }
        return x.alignment;
    }
    if (x instanceof PointerType) {
        return ptrSize;
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
        case "f32":
            return 4;
        case "addr":
        case "ptr":
            return ptrSize;
        case "i64":
        case "s64":
        case "f64":
            return 8;
        case "int":
        case "sint":
            return intSize;
    }
}

export function isSigned(x: Type | PointerType): boolean {
    return x == "s8" || x == "s16" || x == "s32" || x == "s64";
}

export function sizeOf(x: Type | StructType | PointerType): number {
    if (x instanceof StructType) {
        if (!x.finalized) {
            x.finalize();
        }
        return x.size;
    }
    if (x instanceof PointerType) {
        return ptrSize;
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
        case "f32":
        return 4;
        case "addr":
        case "ptr":
            return ptrSize;
        case "i64":
        case "s64":
        case "f64":
            return 8;
        case "int":
        case "sint":
            return intSize;
    }
}

export function alignedSizeOf(type: Type | StructType | PointerType): number {
    let size = sizeOf(type);
    if (size == 0) {
        return 0;
    }
    let align = alignmentOf(type);
    return align * Math.ceil(size/align);
}

/*
export function hasPointers(t: Type | StructType | PointerType): boolean {
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
*/

export function compareTypes(t1: Type | StructType | PointerType, t2: Type | StructType | PointerType): boolean {
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
    if (t1 instanceof PointerType && t2 instanceof PointerType) {
        return compareTypes(t1.elementType, t2.elementType);
    }
    return false;
}

export type CallingConvention = "fyr" | "fyrCoroutine" | "system" | "native";

export class FunctionType {
    constructor(params: Array<Type | StructType | PointerType>, result: Type | StructType | PointerType | null, conv: CallingConvention = "fyr") {
        this.params = params;
        this.result = result;
        this.callingConvention = conv;
    }

    public toString(): string {
        let str = "(" + this.params.map(function(t: Type) { return t.toString() }).join(",") + ")";
        str += " => (" + (this.result ? this.result.toString() : "") + ")";
        return str;
    }

    // TODO: This is WASM specific code
    public get stackFrame(): StructType {
        if (this._stackFrame) {
            return this._stackFrame;
        }
        this._stackFrame = new StructType();
        for(let i = 0; i < this.params.length; i++) {
            // Pointers as arguments must be passed on the stack
            if (this.params[i] instanceof StructType) {
                this._stackFrame.addField("$p" + i.toString(), this.params[i]);
            }
        }
        if (this.result instanceof StructType || this.isAsync()) {
            this._stackFrame.addField("$result", this.result);
        }
        // Add a field for the typemap if the stack is non-empty
        if (this._stackFrame.fields.length != 0) {
            this._stackFrame.addField("$typemapCall", "i32");
        }
        this._stackFrame.finalize()
        return this._stackFrame;
    }

    public isAsync(): boolean {
        return this.callingConvention == "fyrCoroutine";
    }

    public params: Array<Type | StructType | PointerType>;
    public ellipsisParam: Type | StructType | PointerType | null;
    public result: Type | StructType | PointerType | null;
    public callingConvention: CallingConvention = "fyr";

    // TODO: This is WASM specific code
    private _stackFrame: StructType;
}

/**
 * BinaryArray is used in BinaryData to capture constant byte data.
 */
export class BinaryArray {
    constructor() {
        this.data = [];
    }

    // This length might be higher than the elements in 'data'.
    // In this case all array elements missing in 'data' are zero.
    // For large arrays it would be a waste to fill 'data' with thousands of zeros.
    public totalLen: number;
    public data: BinaryData;
}

/**
 * BinaryData is used to capture constant data.
 */
export type BinaryData = Array<number | string | BinaryArray>;

/**
 * Variables are used to describe local variables.
 */
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
        return this.name;
    }

    public name: string;
    public type: Type | StructType | PointerType;
    /**
     * The number of times the value of the variable is used.
     */
    public readCount: number = 0;
    /**
     * The number of times the variable is assigned a value.
     */
    public writeCount: number = 0;
    /**
     * usedInMultupleSteps is true, if the variable is used in different 'steps'.
     * This is only meaningful when used after SMTransformation.transform().
     */
    public usedInMultipleSteps: boolean = false;
    /**
     * isConstant is true if the variable is assigned exactly once
     * and this value is a constant.
     * The value is set by Optimizer.optimizeConstants() or by the code generation.
     */
    public isConstant: boolean = false;
    /**
     * The value of the variable if it is assigned a constant number.
     * TODO: Cannot hold 64bit integers
     */
    public constantValue: number | string | BinaryData;
    /**
     * True if the variable is just a copy of another and hence just an artefact
     * created by the code generation layer.
     */
    public isCopy: boolean = false;
    /**
     * The variable from which this variable is a copy.
     */
    public copiedValue: Variable;
    /**
     * addressable is true if 'addr_of' has been used on this variable.
     */
    public addressable: boolean;
    /**
     * True for addressable local variables that are pointed to by strong pointers or references.
     * In this case the variable must provide additional space for storing the reference counters.
     */
    public needsRefCounting: boolean;
    /**
     * Internal
     */
    public _step: Node;

    private static counter: number = 0;
}

/**
 * Pointer describes an address in memory.
 * The address consists of the numerical value of a Variable plus an offset.
 */
export class Pointer {
    constructor(v: Variable, offset: number) {
        this.variable = v;
        this.offset = offset;
    }

    public offset: number;
    public variable: Variable;
}

export class Node {
    constructor(assign: Variable, kind: NodeKind, type: Type | FunctionType | StructType | PointerType, args: Array<Variable | string | number>) {
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
            throw new Error("Cannot remove this node")
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
    public type: Type | FunctionType | StructType | PointerType;
    public next: Array<Node> = [];
    public prev: Array<Node> = [];
    public blockPartner: Node; // 'end' for 'if'/'block'/'loop' and either 'if' or 'block' or 'loop' for 'end'.
    public assign: Variable;
    public assignType: Type | StructType | PointerType;
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

    public declareParam(type: Type | StructType | PointerType, name: string): Variable {
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

    public declareResult(type: Type | StructType | PointerType, name: string): Variable {
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

    public declareVar(type: Type | StructType | PointerType, name: string, needsRefCounting: boolean): Variable {
        let n = new Node(new Variable(name), "decl_var", type, []);
        n.assign.type = type;
        n.assign.needsRefCounting = needsRefCounting;
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

    public assign(assign: Variable, kind: NodeKind, type: Type | StructType | PointerType, args: Array<Variable | string | number>) : Variable {
        let n = new Node(assign, kind, type, args);
//        if (assign && assign.type && assign != this.mem) {
//            if (!compareTypes(assign.type, type)) {
//                fuck
//                throw new Error("Variable " + assign.name + " used with wrong type: " + assign.type + " " + type)
//            }
        if (assign && !assign.type) {
            assign.type = type;
        }
        if (assign) {
            n.assignType = assign.type;
        }
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        if (kind == "yield") {
            for(let b of this._blocks) {
                b.isAsync = true;
            }
        }
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public call(assign: Variable, type: FunctionType, args: Array<Variable | string | number>): Variable {
        let n = new Node(assign, "call", type, args);
        if (assign && assign.type) {
            if (!compareTypes(assign.type, type.result)) {
                throw new Error("Variable " + assign.name + " used with wrong type")
            }
            n.assignType = assign.type;
        } else if (assign) {
            assign.type = type.result;
            n.assignType = assign.type;
        } else {
            n.assignType = type.result;
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
                throw new Error("Variable " + assign.name + " used with wrong type")
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

    public spawn(type: FunctionType, args: Array<Variable | string | number>) {
        let n = new Node(null, "spawn", type, args);

        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
    }

    public spawnIndirect(assign: Variable, type: FunctionType, args: Array<Variable | string | number>): Variable {
        let n = new Node(assign, "spawn_indirect", type, args);
        if (assign && assign.type) {
            if (!compareTypes(assign.type, type.result)) {
                throw new Error("Variable " + assign.name + " used with wrong type")
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
        throw new Error("Branch target is not reachable")
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
        throw new Error("Branch target is not reachable")
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
                throw new Error("Branch target is not reachable")
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
            throw new Error("end without opening block")
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
            throw new Error("end without opening block")
        }
        let n = this._blocks.pop();
        if (n.kind != "if") {
            throw new Error("else without if")
        }
        this._blocks.push(n);
        this._current.next.push(n.blockPartner);
        n.blockPartner.prev.push(this._current);
        this._current = n;
    }

    public tmp(t: Type | StructType | PointerType = null): Variable {
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
        if (n.assign && n.kind != "decl_var") {
            n.assign.writeCount++;
//            if (n.assign.isTemporary && n.assign.writeCount > 1) {
//                throw new Error("Variable " + n.assign.name + " is temporary but assigned more than once")
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
     * Those variables are marked with isConstant.
     */
    private _optimizeConstants(start: Node, end: Node) {
        let n = start;
        for( ; n && n != end; ) {
            if (n.kind == "if") {
                if (n.next.length > 1) {
                    this._optimizeConstants(n.next[1], n.blockPartner);
                }
            }
            if ((n.kind == "const" || (n.kind == "copy" && typeof(n.args[0]) == "number")) && n.assign.writeCount == 1 && !n.assign.addressable) {
                // A variable that is assigned once with a constant, can be treated like a constant.
                n.assign.isConstant = true;
                n.assign.constantValue = n.args[0] as number;
                n.assign.writeCount--;
                let n2 = n.next[0];
                Node.removeNode(n);
                n = n2;
            } else {
                for(let i = 0; i < n.args.length; i++) {
                    let a = n.args[i];
                    if (a instanceof Variable && a.isConstant && typeof(a.constantValue) == "number") {
                        n.args[i] = a.constantValue;
                        a.readCount--;
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
            } else if (n.kind == "decl_var") {
                // Remove variables that are never assigned and never read.
                // This can happen if a previous step inlined it.
                if (n.assign.writeCount == 0 && n.assign.readCount == 0) {
                    let n2 = n.prev[0];
                    Node.removeNode(n);
                    n = n2;
                    continue;
                }
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "return") {
                // Do nothing by intention
            } else if (n.kind == "copy" && n.assign.writeCount == 1 && n.args[0] instanceof Variable && (n.args[0] as Variable).writeCount == 1 && (n.args[0] as Variable).readCount == 1) {
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
            } else if ((n.kind != "call" && n.kind != "call_indirect" && n.kind != "spawn" && n.kind != "spawn_indirect") && n.assign && n.assign.readCount == 0) {
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
        this.insertNextStepsUpTo(startBlock);
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
    private insertNextStepsUpTo(start: Node) {
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
                this.insertNextStepsUpTo(n.next[1]);
                n = n.next[0];
            } else {
                n = n.next[0];
            }
        }
    }

    /**
     * Removes unnecessary block, loop and end nodes.
     */
    private cleanup(n: Node) {
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

export class Stackifier {
    constructor() {
    }

    public stackifyStep(start: Node, end: Node) {
        // No need to inline in the first line
        let n = start.next[0];
        // Iterate over the code
        for( ; n && n != end; ) {
            if (n.kind == "addr_of") {
                // If we have the following code:
                // %56 = expression
                // %57 = addr_of %56
                // then inlining would yield
                // %57 = addr_of expression
                // which is something different, because it is no longer the address of a local variable.
                n = n.next[0];
                continue
            }
            // Investigate branches and inline inside the branches
            if (n.kind == "if" && n.next[1]) {
                this.stackifyStep(n.next[1], n.blockPartner);
            }
            let doNotInline: Array<Variable> = [];
            let assigned = new Map<Variable, boolean>();
            for(let i = 0; i < n.args.length; i++) {
                let a = n.args[i];
                // A variable that is read only here, could perhaps be removed by inlining the code that computes its value.
                if (a instanceof Variable && a.readCount == 1) {
                    // Try to inline the computation of variable 'a'
                    let inline: Node = this.findInline(n.prev[0], a, doNotInline, assigned);
                    if (inline) {
                        // The variable is now no longer read
                        inline.assign.readCount--;
                        // The variable is assigned once less
                        inline.assign.writeCount--;
                        // The inlined expression does not assign to any variable any more.
                        inline.assign = null;
                        // Inline the expression
                        if (inline.kind == "const") {
                            n.args[i] = inline.args[0];
                        } else {
                            n.args[i] = inline;
                        }
                        // Remove the inlined expression
                        Node.removeNode(inline);
                    }
/*                    } else if (a instanceof Variable && a.writeCount == 1) {
                    // Try to inline the computation
                    let inline = this.findInlineForMultipleReads(n.prev[0], a, doNotInline, assigned);
                    if (inline && (inline.kind != "call_end" || (n.kind == "return" && n.args.length == 0) || n.kind == "store")) {
                        inline.assign.readCount--;
                        n.args[i] = inline;
                        Node.removeNode(inline);
                    }*/
                }
                if (a instanceof Variable) {
                    // The variable 'a' is used here.
                    // Do not move any expression assigning to 'a' behind here,
                    // since we rely on 'a' right here.
                    doNotInline.push(a);
                } else if (a instanceof Node) {
                    // See which variables are assigned here.
                    // Do not move earlier assignments of these variables beyond this point.
                    // Otherwise we might inline a previous value of the same variable,
                    this.collectAssignments(a, null, assigned);
                }
            }
            // End of step?
            if (n.kind == "step" || n.kind == "goto_step") {
                break;
            }
            // Next expression
            n = n.next[0];
        }
    }

    /**
     * Searches for an assignment of 'v' at Node 'n' or a previous expression.
     * 'assigned' is a list of all variables that have been assigned between 'n' and the returned Node.
     * 'doNotInline' lists variables that must not be assigned bewteen 'n' and the returned Node.
     */
    private findInline(n: Node, v: Variable, doNotInline: Array<Variable>, assigned: Map<Variable, boolean>): Node {
        // Iterate over the code backwards and search for a place where the desired variable is assigned.
        for( ;n; ) {
            // Do not go past flow-control operations
            if (n.kind == "step" || n.kind == "goto_step" || n.kind == "goto_step_if" || n.kind == "br" || n.kind == "br_if" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end" || n.kind == "return") {
                return null;
            }
            if (n.assign == v) {
                // Here, the desired variable is assigned
                if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                    // The variable is just declared here. Do not inline declarations
                    return null;
                }
                if (this.assignsToVariable(n, doNotInline)) {
                    // The expression 'n' assigns to a variable that must not be inlined? Then do not inline.
                    return null;
                }
                if (this.readsFromVariables(n, assigned)) {
                    // The expression 'n' reads from a variable that is assigned later.
                    // In this case, we would inline a previous value and not the latest value.
                    // Therefore, do not inline.
                    return null;
                }
                // Do not inline call_end, because it must stay where it is.
                if (n.kind == "call_end") {
                    return null;
                }
                // The expression is safe for inlining
                return n;
            } else if (n.assign) {
                // Check which variables are assigned by the expression in 'n'
                if (this.collectAssignments(n, v, assigned)) {
                    return null;
                }
            }
            // Some statements change the state of memory. In this case we can no longer known whether inlining is safe.
            // In this case, don't do it.
            if (this.doNotByPassForInline(n)) {
                return null;
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
    /*
    private findInlineForMultipleReads(n: Node, v: Variable, doNotInline: Array<Variable>, assigned: Map<Variable, boolean>): Node {
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
                if (this.readsFromVariables(n, assigned)) {
                    return null;
                }
                return n;
            } else if (n.assign) {
                if (this.collectAssignments(n, v, assigned)) {
                    return null;
                }
            }
            if (this.doNotByPassForInline(n)) {
                return null;
            }
            n = n.prev[0];
        }
        return null;
    }
    */

    private collectAssignments(n: Node, v: Variable, assigned: Map<Variable, boolean>): boolean {
        if (n.assign) {
            if (n.assign == v) {
                return true;
            }
            if (!assigned.has(n.assign)) {
                assigned.set(n.assign, true);
            }
            for(let a of n.args) {
                if (a instanceof Node) {
                    if (this.collectAssignments(a, v, assigned)) {
                        return true;
                    }
                }
            }
        }
        return false;
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

    /*
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
    */

    private readsFromVariables(n: Node, vars: Map<Variable, boolean>): boolean {
        for(let a of n.args) {
            if (a instanceof Variable && vars.has(a)) {
                return true;
            } else if (a instanceof Node) {
                if (this.readsFromVariables(a, vars)) {
                    return true;
                }
            }
        }
        return false;
    }

    private doNotByPassForInline(n: Node): boolean {
        if (n.kind == "call" || n.kind == "call_indirect" || n.kind == "call_begin" || n.kind == "call_end" || n.kind == "call_indirect_begin" || n.kind == "decref" || n.kind == "store" || n.kind == "free" || n.kind == "free_arr" || n.kind == "unlock") {
            return true;
        }
        for(let a of n.args) {
            if (a instanceof Node) {
                if (this.doNotByPassForInline(a)) {
                    return true;
                }
            }
        }
        return false;
    }

}
