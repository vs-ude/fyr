import * as wasm from "./wasm"

export type NodeKind = "goto_step" | "goto_step_if" | "step" | "call_begin" | "call_end" | "define" | "decl_param" | "decl_result" | "decl_var" | "return" | "block" | "loop" | "end" | "if" | "br" | "br_if" | "load" | "store" | "addr_of" | "call" | "const" | "add" | "sub" | "mul" | "div" | "div_s" | "div_u" | "rem_s" | "rem_u" | "and" | "or" | "xor" | "shl" | "shr_u" | "shr_s" | "rotl" | "rotr" | "eq" | "neq" | "lt_s" | "lt_u" | "le_s" | "le_u" | "gt_s" | "gt_u" | "ge_s" | "ge_u" | "lt" | "gt" | "le" | "ge" | "min" | "max" | "eqz" | "clz" | "ctz" | "popcnt" | "neg" | "abs" | "copysign" | "ceil" | "floor" | "trunc" | "nearest" | "sqrt";
export type Type = "i8" | "i16" | "i32" | "i64" | "s8" | "s16" | "s32" | "s64" | "addr" | "f32" | "f64";

export class StructType {

    public addField(name: string, type: Type | StructType): number {
        let offset = this.size;
        this.fieldOffsetsByName.set(name, this.size);
        this.size += sizeOf(type);
        return offset;
    }

    public fieldOffset(name: string): number {
        return this.fieldOffsetsByName.get(name);
    }

    public fields: Array<Type | StructType>;
    private fieldOffsetsByName: Map<string, number> = new Map<string, number>();
    public size: number = 0;
}

function sizeOf(x: Type | StructType): number {
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
        case "f32":
            return 4;
        case "i64":
        case "s64":
        case "f64":
            return 8;
    }
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
            if (!compareTypes(t1.fields[i], t2.fields[i])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

export class FunctionType {
    constructor(params: Array<Type | StructType>, result: Type | StructType | null, isAsync: boolean = true) {
        this.params = params;
        this.result = result;
        this.isAsync = isAsync;
    }

    public toString(): string {
        let str = "(" + this.params.map(function(t: Type) { return t.toString() }).join(",") + ")";
        str += " => (" + (this.result ? this.result.toString() : "") + ")";
        return str;
    }

    public params: Array<Type | StructType>;
    public result: Type | StructType | null;
    public isAsync: boolean;
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
    public isTemporary: boolean = false;
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
    /**
     * addressable is true if 'addr_of' has been used on this variable.
     */
    public addressable: boolean;

    /**
     * Internal
     */
    public _step: Node;

    private static counter: number = 0;
}

export class Node {
    constructor(assign: Variable, kind: NodeKind, type: Type | FunctionType | StructType, args: Array<Variable | string | number>) {
        this.assign = assign;
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
            str += this.assign.name + " = ";
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
                    return v.name;
                } else if (v instanceof Node) {
                    return "\n" + indent + "    (" + v.toString("") + ")";
                } else {
                    return v.toString();
                }
            });
            str += names.join(", ");
        }
        str += "\n";

        /*
        if (this.kind == "if" || this.kind == "block" || this.kind == "loop" || this.kind == "define") {
            if (this.next.length > 0) {
                if (this.kind == "if") {
                    str += Node.strainToString(indent + "    ", this.next[0]);
                    if (this.next.length > 1) {
                        str += indent + "else\n";
                        str += Node.strainToString(indent + "    ", this.next[1]);
                    }
                } else {
                    str += Node.strainToString(indent + "    ", this.next[0]);
                }
                str += indent + "end " + this.kind + "\n";
            }
        }
        */

        return str;
    }

    public static strainToString(indent: string, n: Node) {
        let str = "";
        for(; n && n.kind != "end";) {
            if (n.kind == "block" || n.kind == "loop" || n.kind == "define") {
                str += n.toString(indent);
                str += Node.strainToString(indent + "    ", n.next[0]);
                str += indent + "end\n";
                n = n.blockPartner.next[0];
            } else if (n.kind == "if") {
                str += n.toString(indent);
                str += Node.strainToString(indent + "    ", n.next[0]);
                if (n.next[1]) {
                    str += indent + "else\n";
                    str += Node.strainToString(indent + "    ", n.next[1]);
                }
                str += indent + "end\n";
                n = n.blockPartner.next[0];
            } else {
                str += n.toString(indent);
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
    public args: Array<Variable | number | Node> = [];
    public isAsync: boolean = false;
}

export class Builder {
    constructor() {
        this._mem = new Variable("mem");
        this._mem.readCount = 2; // Just to prevent optimizations on this pseudo-variable
        this._mem.writeCount = 2;
    }

    public define(name: string, type: FunctionType) {
        let n: Node;
        // Check whether a function of this name has already been declared
        if (this._node) {
            for(let x = this._node; x; x = x.next[0]) {
                if (x.kind == "define" && x.name == name) {
                    n = x;
                    break;
                }
            }
        }
        if (!n) {
            n = this.declare(name, type);
        }
        this._blocks.push(n);
    }

    public declare(name: string, type: FunctionType): Node {
        let n = new Node(null, "define", type, []);
        n.name = name;
        n.isAsync = type.isAsync;
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        /*
        if (type.params.length != params.length) {
            throw "Parameters do not match FunctionType"
        }
        if (!!type.result != !!result) {
            throw "Result variable does not match FunctionType"
        }
        for(let i = 0; i < params.length; i++) {
            let p = params[i];
            p.type = type.params[i];
            this.declParam(p);
        }
        if (result) {
            result.type = type.result;
            this.declResult(result);
        }
        */
        let e = new Node(null, "end", undefined, []);
        e.blockPartner = n;
        n.blockPartner = e;  
        this.countReadsAndWrites(n);
        return n;
    }
    
    public declareParam(type: Type | StructType, name: string): Variable {
        let n = new Node(new Variable(name), "decl_param", type, []);
        n.assign.type = type;
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
        if (assign && assign.type) {
            if (!compareTypes(assign.type, type)) {
                throw "Variable " + assign.name + " used with wrong type";
            }
        } else if (assign) {
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
            b.isAsync = b.isAsync || type.isAsync;
        }
        this.countReadsAndWrites(n);
        return n.assign;
    }

    public br(to: Node) {
        let j = 0;
        for(let i = this._blocks.length - 1; i >= 0; i--) {
            if (this._blocks[i].kind == "if" || this._blocks[i].kind == "define") {
                continue;
            }
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
            if (this._blocks[i].kind == "if" || this._blocks[i].kind == "define") {
                continue;
            }
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
        let n = this._blocks.pop();
        this._current.next.push(n.blockPartner);
        n.blockPartner.prev.push(this._current);
        this._current = n.blockPartner;
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

    public tmp(): Variable {
        let v = new Variable();
        v.isTemporary = true;
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
            if (n.assign.isTemporary && n.assign.writeCount > 1) {
                throw "Variable " + n.assign.name + " is temporary but assigned more than once";
            }
        }
        for(let v of n.args) {
            if (v instanceof Variable) {
                v.readCount++;
            }
        }
        if (n.kind == "addr_of" && n.args[0] instanceof Variable) {
            (n.args[0] as Variable).addressable = true;
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
     * Collects all steps and async calls
     * and remove all 'const' nodes which assign to variables that are SSA.
     */
    private _optimizeConstants(start: Node, end: Node) {
        let n = start;
        for( ; n; ) {
            if (n.kind == "if") {
                if (n.next.length > 1) {
                    this._optimizeConstants(n.next[1], n.blockPartner);
                }
                n = n.next[0];
            } else if (n.kind == "const" && n.assign.writeCount == 1) {
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
        this._removeDeadCode(n.blockPartner, n);
        this._removeDeadCode2(n, n.blockPartner);
    }

    /**
     * Traverse the code forwards and eliminate unreachable code
     */
    private _removeDeadCode2(n: Node, end: Node) {
        let dead: boolean = false;
        for( ;n && n != end; ) {
            if (dead) {
                for(let a of n.args) {
                    if (a instanceof Variable) {
                        a.readCount--;
                    }
                }
                if (n.assign) {
                    n.assign.writeCount--;
                }
                let n2 = n.next[0];
                Node.removeNode(n);
                n = n2;
                continue;
            }
            if (n.kind == "return" || n.kind == "br") {
                dead = true;
            }
            if (n.kind == "if") {
                this._removeDeadCode2(n.next[0], n.blockPartner);
                if (n.next[1]) {
                    this._removeDeadCode2(n.next[1], n.blockPartner);
                }
                n = n.blockPartner;
            } else if (n.kind == "block" || n.kind == "loop") {
                this._removeDeadCode2(n.next[0], n.blockPartner);
                n = n.blockPartner;                
            }
            n = n.next[0];
        }
    }

    /**
     * Traverse the code backwards
     */
    private _removeDeadCode(n: Node, end: Node) {
        for( ;n && n != end; ) {
            // Remove assignments to variables which are not read
            if (n.kind == "call" && n.assign && n.assign.readCount == 0) {
                n.assign.writeCount--;
                n.assign = null;
            } else if (n.kind == "end" && n.prev[1]) { // The 'end' belongs to an 'if'?
                this._removeDeadCode(n.prev[1], n.blockPartner);
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var" || n.kind == "return") {
                // Do nothing by intention
            } else if (n.kind != "call" && n.assign && n.assign.readCount == 0) {
                let n2 = n.prev[0];
                for(let a of n.args) {
                    if (a instanceof Variable) {
                        a.readCount--;
                    }
                }
                Node.removeNode(n);
                n = n2;
                continue;
            }
            n = n.prev[0];
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
        console.log("SM");
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
                } else if (n.kind == "call" && (n.type as FunctionType).isAsync) {
                    n.kind = "call_begin";
                    let result = new Node(n.assign, "call_end", n.type, []);
                    n.assign = null;
                    let end = new Node(null, "goto_step", undefined, []);
                    step = null;
                    Node.insertBetween(n, n.next[0], end);
                    Node.insertBetween(end, end.next[0], result);
                    n = result;
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


export type Wasm32StorageType = "local" | "vars" | "params" | "result";

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
    constructor() {
         this.tr = new SMTransformer();
         this.module = new wasm.Module();
    }

    public generateFunction(n: Node): wasm.Function {
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }
        if (n.type.isAsync) {
            return this.generateAsyncFunction(n);
        }
        return this.generateSyncFunction(n);
    }

    private generateSyncFunction(n: Node): wasm.Function {
        console.log("SYNC");
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }

        this.wfIsAsync = false;
        this.tmpI32Local = -1;
        this.tmpI64Local = -1;
        this.tmpF32Local = -1;
        this.tmpF64Local = -1;
        this.wf = new wasm.Function(n.name);
        if (n.type.result && !(n.type.result instanceof StructType)) {
            this.wf.results.push(this.stackTypeOf(n.type.result));
        }

        let hasHeapFrame = this.resultFrame.size != 0 || this.paramsFrame.size != 0 || this.varsFrame.size != 0;
        this.traverse(n.next[0], n.blockPartner, null);
        this.stackifyStep(n, null);
        let locals = new Wasm32LocalVariableList(this.wf.parameters.length + 1 + this.wf.locals.length + (hasHeapFrame ? 1 : 0));
        this.analyzeVariableStorage(n, n.blockPartner, locals);
        this.spLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // sp
        if (hasHeapFrame) {
            this.bpLocal = this.wf.parameters.length;
            this.wf.locals.push("i32"); // bp
        }
        this.wf.locals = this.wf.locals.concat(locals.locals);

        console.log("========= Stackified ==========");
        console.log(Node.strainToString("", n));
        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            console.log(v.name + " -> ", s.storageType, s.offset);
        }
        console.log("sp -> local " + this.spLocal);
        console.log("bp -> local " + this.bpLocal);

        // Generate function body
        let code: Array<wasm.Node> = [];
        if (this.varsFrame.size > 0) {
            // Put the varsFrame on the heap_stack and set BP
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", this.varsFrame.size));
            code.push(new wasm.BinaryIntInstruction("i32", "sub"));
            code.push(new wasm.TeeLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        } else if (this.resultFrame.size != 0 || this.paramsFrame.size != 0) {
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        }

        this.emitCode(0, n.next[0], null, code, 0, 0);

        this.wf.statements = code;
        this.module.funcs.push(this.wf)

        return this.wf;
    }

    private generateAsyncFunction(n: Node): wasm.Function {
        console.log("ASYNC");
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }

        this.wfIsAsync = true;
        this.tmpI32Local = -1;
        this.tmpI64Local = -1;
        this.tmpF32Local = -1;
        this.tmpF64Local = -1;
        this.wf = new wasm.Function(n.name);

        // Make room to store bp, sp and step upon async calls.
        this.varsFrame.addField("$bp", "i32");
        this.varsFrame.addField("$sp", "i32");
        this.varsFrame.addField("$step", "i32");

        this.tr.transform(n);
        console.log("========= State Machine ==========");
        console.log(Node.strainToString("", n));

        this.traverse(n.next[0], n.blockPartner, null);
        this.stackifySteps();
        let locals = new Wasm32LocalVariableList(this.wf.parameters.length + 2 + this.wf.locals.length + 1);
        this.analyzeVariableStorage(n, n.blockPartner, locals);
        this.stepLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // step_local
        this.spLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // sp
        this.wf.results.push("i32"); // interrupt or complete
        this.bpLocal = this.wf.parameters.length;
        this.wf.locals.push("i32"); // bp
        this.wf.locals = this.wf.locals.concat(locals.locals);

        console.log("========= Stackified ==========");
        console.log(Node.strainToString("", n));
        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            console.log(v.name + " -> ", s.storageType, s.offset);
        }
        console.log("sp -> local " + this.spLocal);
        console.log("bp -> local " + this.bpLocal);
        console.log("step -> local " + this.stepLocal);

        // Generate function body
        let code: Array<wasm.Node> = [];
        // Put the varsFrame on the heap_stack and set BP
        if (this.varsFrame.size > 0) {
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", this.varsFrame.size));
            code.push(new wasm.BinaryIntInstruction("i32", "sub"));
            code.push(new wasm.TeeLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        } else if (this.resultFrame.size != 0 || this.paramsFrame.size != 0) {
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        }

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
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$bp")));
        code.push(new wasm.Constant("i32", 1)); // Return with '1' to indicate that this is an async return
        code.push(new wasm.Return());

        this.wf.statements = code;
        this.module.funcs.push(this.wf)

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
                    if (v._step) {
                        v.usedInMultipleSteps = true;
                    } else {
                        v._step = step;
                    }                    
                }
            }
            // Analze the assignment
            if (n.assign) {
                if (n.assign._step) {
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
            } else if (n.kind == "call_begin") {
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
//        let prev: Node = null;
        for( ; n && n != end; ) {
            if (n.kind == "return" || n.kind == "step" || n.kind == "goto_step" || n.kind == "goto_step_if" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end") {
                if (n != start.next[0]) {
                    this.stackifyStepBackwards(n);
                }
                if (n.kind == "step" || n.kind == "goto_step") {
                    break;
                }
            }
            if (n.kind == "if") {
                this.stackifyStep(n, n.blockPartner.next[0]);
                if (n.next[1]) {
                    this.stackifyStep(n, n.blockPartner.next[0]);
                }
                n = n.blockPartner.next[0];
            } else {
    //            prev = n;
                n = n.next[0];
            }
        }
    }

    private stackifyStepBackwards(start: Node) {
        let n = start;
        for( ;n; ) {
            if (n != start && (n.kind == "step" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end" || n.kind == "return")) {
                break;
            }
            for(let i = 0; i < n.args.length; i++) {
                let a = n.args[i];
                if (a instanceof Variable && a.readCount == 1) {
                    // Try to inline the computation
                    let inline = this.findInline(n.prev[0], a);
                    if (inline) {
                        inline.assign = null;
                        n.args[i] = inline;
                        Node.removeNode(inline);
                    }
                } else if (a instanceof Variable && a.writeCount == 1) {
                    // Try to inline the computation
                    let inline = this.findInlineForMultipleReads(n.prev[0], a);
                    if (inline) {
                        n.args[i] = inline;
                        Node.removeNode(inline);
                    }
                }
            }
            n = n.prev[0];
        }
    }

    private findInline(n: Node, v: Variable): Node {
        for( ;n; ) {
            if (n.kind == "step" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end" || n.kind == "return") {
                return null;
            }
            if (n.assign && n.assign.name == v.name) {
                if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
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
     * used between 'n' and its assignment.
     * The variable assignment can then be inlined with a tee.
     */
    private findInlineForMultipleReads(n: Node, v: Variable): Node {
        for( ;n; ) {
            if (n.kind == "step" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end" || n.kind == "return") {
                return null;
            }
            for(let a of n.args) {
                if (a instanceof Variable && a.name == v.name) {
                    return null;
                }
            }
            if (n.assign && n.assign.name == v.name) {
                if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                    return null;
                }
                return n;
            }
            n = n.prev[0];
        }
        return null;
    }

    private analyzeVariableStorage(start: Node, end: Node, locals: Wasm32LocalVariableList) {
        let n = start;
        for(; n; ) {
            if (n.kind == "decl_result" && (this.wfIsAsync || n.type instanceof StructType)) {
                let index = this.resultFrame.addField(n.assign.name, n.type as Type | StructType);
                let s: Wasm32Storage = {storageType: "result", offset: index};
                this.varStorage.set(n.assign, s);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_result") {
                // +1 is because of the 'sp' which is an implicit register for sync functions
                let s: Wasm32Storage = {storageType: "local", offset: this.wf.parameters.length + 1};
                this.varStorage.set(n.assign, s);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param" && (n.type instanceof StructType || n.assign.type == "addr")) {
                let index = this.paramsFrame.addField(n.assign.name, n.type as Type | StructType);
                let s: Wasm32Storage = {storageType: "params", offset: index};
                this.varStorage.set(n.assign, s);                
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param") {
                let s: Wasm32Storage = {storageType: "local", offset: this.wf.parameters.length};
                this.wf.parameters.push(this.stackTypeOf(n.type as Type));
                this.varStorage.set(n.assign, s);                
                n = n.next[0];                
                continue;
            }
            if (n.assign) {
                this.assignVariableStorage(n.assign, locals);
            }
            for(let v of n.args) {
                if (v instanceof Variable) {
                    this.assignVariableStorage(v, locals);
                } else if (v instanceof Node) {
                    this.analyzeVariableStorage(v, null, locals);
                }
            }
            if (n.kind == "if" && n.next.length > 1) {
                this.analyzeVariableStorage(n.next[1], n.blockPartner, locals.clone());
                n = n.next[0];
            } else {
                n = n.next[0];                
            }
        }
    }

    private assignVariableStorage(v: Variable, locals: Wasm32LocalVariableList) {
        if (v.name == "mem") {
            return;
        }
        if (this.varStorage.has(v)) {
            return;
        }
        if (!v.usedInMultipleSteps && !(v.type instanceof StructType) && !v.addressable) {
            let index = locals.allocate(v.type);
            let s: Wasm32Storage = {storageType: "local", offset: index};
            this.varStorage.set(v, s);
        } else {
            let index = this.varsFrame.addField(v.name, v.type);
            let s: Wasm32Storage = {storageType: "vars", offset: index};
            this.varStorage.set(v, s);
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
            if (n.kind == "step") {
                break;
            } else if (n.kind == "if") {
                if (n.type instanceof StructType) {
                    throw "Implementation error"
                }
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n.args[0], "wasmStack", code);
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
            } else if (n.kind == "br_if") {
                code.push(new wasm.BrIf(n.args[0] as number));
            } else if (n.kind == "block") {
                code.push(new wasm.Loop());
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
                this.emitAssign("i32", n.args[0], "wasmStack", code);
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
            } else if (n.kind == "call_begin") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                // TODO: Optimize, make room once and then put all parameters on the stack
                // Make room for the results on the stack
                if (n.type.result) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", sizeOf(n.type.result)));
                    code.push(new wasm.BinaryInstruction("i32", "sub"));
                    code.push(new wasm.SetLocal(this.spLocal));
                }
                // Put parameters on stack
                for(let i = 1; i < n.args.length; i++) {
                    if (n.type.params[i-1] instanceof FunctionType) {
                        throw "Implementation error"
                    }
                    if (n.type.params[i-1] instanceof StructType || n.type.params[i-1] == "addr") {
                        this.emitAssign(n.type.params[i-1], n.args[i], "heapStack", code);
                    } else {
                        this.emitAssign(n.type.params[i-1], n.args[i], "wasmStack", code);                        
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
            } else if (n.kind == "store") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                if (n.type instanceof StructType) {
                    // Get the destination addr
                    this.emitWordAssign("addr", n.args[0], "wasmStack", code);
                    if (n.args[1] !== 0) {
                        this.emitWordAssign("addr", n.args[1], "wasmStack", code);
                        code.push(new wasm.BinaryInstruction("i32", "add"));
                    }
                    // Get the source addr
                    if (typeof(n.args[2]) == "number") {
                        throw "Implementation error: number is not a StructType"
                    }
                    if (n.args[1] instanceof Variable) {
                        this.emitAddrOfVariable(n.args[2] as Variable, false, code);
                    } else {
                        this.emitStructAssign1(n.type, n.args[2] as Node, code);
                    }
                    // Copy
                    this.emitCopy(n.type, code);
                    // Clean up if required
                    if (n.args[1] instanceof Node) {
                        this.emitStructAssign2(n.type, n.args[2] as Node, null, code);
                    }
                } else {
                    this.emitAssign("addr", n.args[0], "wasmStack", code);
                    this.emitAssign(n.type, n.args[2], "wasmStack", code);
                    let width: wasm.StackType = this.stackTypeOf(n.type);
                    let asWidth: null | "8"| "16" | "32" = null;
                    switch (n.type) {
                        case "i8":
                        case "s8":
                            asWidth = "8";
                            break;
                        case "i16":
                        case "s16":
                            asWidth = "16";
                            break;
                    }
                    code.push(new wasm.Store(width, asWidth, n.args[1] as number));
                }
                n = n.next[0];
            } else if (n.kind == "call_end") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type.result, n, null, code);
                n = n.next[0];
            } else if (n.kind == "addr_of") {
                if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                    throw "Implementation error"
                }
                if (!(n.args[0] instanceof Variable)) {
                    throw "Implementation error"                    
                }
                this.emitAssign("addr", n, null, code);
                n = n.next[0];
            } else if (n.kind == "load") {
                if (n.type instanceof FunctionType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, code);
                n = n.next[0];
            } else if (n.kind == "const" || this.isBinaryInstruction(n.kind) || this.isUnaryInstruction(n.kind)) {
                if (n.type instanceof FunctionType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, code);
                n = n.next[0];
            } else if (n.kind == "call") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type.result, n, null, code);
                n = n.next[0];
            } else if (n.kind == "return") {
                if (n.args.length != 0) {
                    if (!n.assign) {
                        throw "Implementation error: return is missing an assignment: " + n.toString("");
                    }
                    if (n.type instanceof StructType || this.wfIsAsync) {
                        if (n.type instanceof StructType) {
                            // Destination addr
                            this.emitAddrOfVariable(n.assign, false, code);
                            // Source addr
                            if (n.args[0] instanceof Variable) {
                                this.emitAddrOfVariable(n.args[0] as Variable, false, code);
                            } else {
                                this.emitStructAssign1(n.type as StructType, n.args[0] as Node, code);
                            }
                            // Copy
                            this.emitCopy(n.type as Type | StructType, code);
                            // Cleanup
                            if (n.args[0] instanceof Node) {
                                this.emitStructAssign2(n.type as StructType, n.args[0] as Node, null, code);
                            }
                        } else {
                            if (n.type instanceof FunctionType) {
                                throw "Implementation error";
                            }
                            // Destination addr
                            let offset = this.emitAddrOfVariable(n.assign, true, code);
                            // Put value on stack
                            this.emitWordAssign(n.type as Type, n.args[0], "wasmStack", code);
                            let width = this.stackTypeOf(n.type);
                            let asWidth: null | "8"| "16" | "32" = null;
                            switch (n.type) {
                                case "i8":
                                case "s8":
                                    asWidth = "8";
                                    break;
                                case "i16":
                                case "s16":
                                    asWidth = "16";
                                    break;
                            }
                            // Store to heapStack
                            code.push(new wasm.Store(width, asWidth, offset));
                        }
                    } else {
                        this.emitWordAssign(n.type as Type, n.args[0], "wasmStack", code);
                    }
                }
                if (this.wfIsAsync) {
                    code.push(new wasm.Constant("i32", 0));
                }
                code.push(new wasm.Return());
                n = n.next[0];
            } else {
                // TODO: This clause should never trigger
                n = n.next[0];
            }
        }
    }

    private emitAssign(type: Type | StructType, n: Node | Variable | number, stack: "heapStack" | "wasmStack" | null, code: Array<wasm.Node>) {
        if (stack == null && (n instanceof Variable || typeof(n) == "number" || (n.kind != "call" && n.kind != "call_end" && !n.assign))) {
            throw "Implementation error: No assignment";
        }

        // Synchronous function call that returns a StructType?
        if (n instanceof Node && n.kind == "call" && type instanceof StructType) {
            if (stack == "wasmStack") {
                throw "Implementation error: StructType on wasmStack is not possible";
            }
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error " + n.toString("");
            }
            if (!(n.type.result instanceof StructType)) {
                throw "Implementation error.";
            }
            if (n.assign) {
                // Put destination addr on stack
                this.emitAddrOfVariable(n.assign, false, code);
            }
            // Make room for the result on the heap stack
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", sizeOf(n.type.result)));
            code.push(new wasm.BinaryInstruction("i32", "sub"));
            code.push(new wasm.SetLocal(this.spLocal));
            // Put parameters on wasm/heap stack
            let paramSize = 0;
            for(let i = 0; i < n.type.params.length; i++) {
                if (n.type.params[i] instanceof StructType || n.type.params[i] == "addr") {
                    paramSize += sizeOf(n.type.params[i]);
                    this.emitAssign(n.type.params[i], n.args[i+1], "heapStack", code);
                } else {
                    this.emitAssign(n.type.params[i], n.args[i+1], "wasmStack", code);                    
                }
            }
            // Put SP on wasm stack
            code.push(new wasm.GetLocal(this.spLocal));
            // Call the function
            code.push(new wasm.Call(n.args[0] as number));
            if (n.assign) {
                // Remove parameters from heap stack
                if (paramSize > 0) {
                    // Remove parameters and result from stack
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", paramSize));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    paramSize = 0;
                    // Put source addr on wasm stack
                    code.push(new wasm.TeeLocal(this.spLocal));                                    
                } else {
                    // Put source addr on wasm stack
                    code.push(new wasm.GetLocal(this.spLocal));
                }
                this.emitCopy(n.type.result, code);
            }
            if (!stack) {
                // Remove parameters (if they are still on the heap stack) and result from heap stack
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", sizeOf(n.type.result) + paramSize));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                code.push(new wasm.SetLocal(this.spLocal));
            } else if (paramSize > 0) {
                // Remove parameters and result from stack
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", paramSize));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                code.push(new wasm.SetLocal(this.spLocal));                
            }
            return;
        }

        // An expression of type StructType?
        if (type instanceof StructType) {
            if (stack == "wasmStack") {
                throw "Implementation error: StructType on wasmStack is not possible";
            }
            if (typeof(n) == "number") {
                throw "Implementation error: A number cannot be of type StructType";
            }

            // If the desired value is already on the stack and it is not assigned to some variable -> do nothing
            if (n instanceof Node && n.kind == "call_end" && stack == "heapStack" && !n.assign) {
                return;
            }

            if (n instanceof Node && n.kind == "call_end") {
                // Size of parameters on the heap stack
                let paramSize = 0;
                let f = n.type as FunctionType;
                for(let i = 0; i < f.params.length; i++) {
                    if(f.params[i] instanceof StructType || f.params[i] == "addr") {
                        paramSize += sizeOf(f.params[i]);
                    }
                }
                if (paramSize > 0) {
                    // Remove parameters and result from heap stack
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", paramSize + (!stack && !n.assign ? sizeOf(f.result) : 0)));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                }
                return;
            }

            // Compute the destination addr
            if (stack == "heapStack") {
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", sizeOf(type)));
                code.push(new wasm.BinaryInstruction("i32", "sub"));
                // Put destination addr on wasm stack
                code.push(new wasm.TeeLocal(this.spLocal));
            }
            if (n instanceof Node && n.assign) {
                // Put destination addr on wasm stack
                this.emitAddrOfVariable(n.assign, false, code);
            }
            
            // Compute the source addr
            if (n instanceof Variable) {
                this.emitAddrOfVariable(n, false, code);
            } else {
                this.emitStructAssign1(type, n, code);
            }
            if (n instanceof Node && n.assign && stack) {
                code.push(new wasm.SetLocal(this.getTmpLocal("i32")));
            }

            // Copy
            if (stack == "heapStack") {
                this.emitCopy(type, code);
            }
            if (n instanceof Node && n.assign) {
                if (stack) {
                    code.push(new wasm.GetLocal(this.getTmpLocal("i32")));
                }
                this.emitCopy(type, code);
            }

            // Clean up if required
            if (n instanceof Node) {
                this.emitStructAssign2(type, n, stack, code);
            }
            return;
        }

        //
        // The expression is of a type that can be put on the wasm stack
        //

        if (stack == "heapStack") {
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", sizeOf(type)));
            code.push(new wasm.BinaryInstruction("i32", "sub"));
            code.push(new wasm.TeeLocal(this.spLocal));
        }
        this.emitWordAssign(type, n, stack == "heapStack" ? "wasmStack" : stack, code);
        if (stack == "heapStack") {
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
            code.push(new wasm.Store(width, asWidth, 0));
        }
    }

    private emitCopy(type: Type | StructType, code: Array<wasm.Node>) {
        let size = sizeOf(type);
        switch (size) {
            case 1:
                code.push(new wasm.Load("i32", "8_u", 0));
                code.push(new wasm.Store("i32", "8", 0));
                break;
            case 2:
                code.push(new wasm.Load("i32", "16_u", 0));
                code.push(new wasm.Store("i32", "16", 0));
                break;
            case 4:
                code.push(new wasm.Load("i32", null, 0));
                code.push(new wasm.Store("i32", null, 0));
                break;
            case 8:
                code.push(new wasm.Load("i64", null, 0));
                code.push(new wasm.Store("i64", null, 0));
                break;
            default:
                code.push(new wasm.Constant("i32", sizeOf(type)));
                code.push(new wasm.Call(this.copyFunctionIndex));
                break;
        }
    }

    private emitAddrOfVariable(v: Variable, returnOffset: boolean, code: Array<wasm.Node>) {
        let s = this.varStorage.get(v);
        switch(s.storageType) {
            case "vars":
                code.push(new wasm.GetLocal(this.bpLocal));
                if (returnOffset) {
                    return this.varsFrame.fieldOffset(v.name);
                }
                code.push(new wasm.Constant("i32", this.varsFrame.fieldOffset(v.name)));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                break;                
            case "params":
                code.push(new wasm.GetLocal(this.bpLocal));
                if (returnOffset) {
                    return this.varsFrame.size + this.paramsFrame.fieldOffset(v.name);
                }
                code.push(new wasm.Constant("i32", this.varsFrame.size + this.paramsFrame.fieldOffset(v.name)));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                break;                
            case "result":
                code.push(new wasm.GetLocal(this.bpLocal));
                if (returnOffset) {
                    return this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name);
                }
                code.push(new wasm.Constant("i32", this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name)));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                break;      
            default:
                throw "Implementation error"
        }
        return 0;
    }

    private emitStructAssign1(type: StructType, n: Node, code: Array<wasm.Node>) {
        if (n.kind == "call_end") {
            // Put the addr of the data on the wasm stack
            code.push(new wasm.GetLocal(this.spLocal));
        } else if (n.kind == "load") {
            // Put the addr of the data on the wasm stack
            this.emitAssign("addr", n.args[0], "wasmStack", code);
        } else {
            throw "Implementation error: Node does not support StructType: " + n.toString("");
        }
    }

    private emitStructAssign2(type: StructType, n: Node, stack: "heapStack" | null, code: Array<wasm.Node>) {
        if (!stack && n.kind == "call_end") {
            // Remove the result from the stack
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", sizeOf(type)));
            code.push(new wasm.BinaryInstruction("i32", "add"));
            code.push(new wasm.SetLocal(this.spLocal));
        }
    }

    private emitWordAssign(type: Type, n: Node | Variable | number, stack: "wasmStack" | null, code: Array<wasm.Node>) {
        if (stack == null && (n instanceof Variable || typeof(n) == "number" || (n.kind != "call" && n.kind != "call_end" && !n.assign))) {
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
        let s = this.varStorage.get(v);
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
        }
    }

    private emitWordNode(n: Node, stack: "wasmStack" | null, code: Array<wasm.Node>) {
        if (n.kind == "addr_of") {
            if (n.assign) {
                this.storeVariableFromWasmStack1("addr", n.assign, code);
            }
            this.emitAddrOfVariable(n.args[0] as Variable, false, code);
            if (n.assign) {
                this.storeVariableFromWasmStack2("addr", n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "call_end") {
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error"
            }
            if (n.type.result instanceof StructType) {
                throw "Implementation error: StructType must be handled elsewhere"
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type.result, n.assign, code);
            }
            // Size of parameters on the heap stack
            let paramSize = 0;
            let f = n.type as FunctionType;
            for(let i = 0; i < f.params.length; i++) {
                if(f.params[i] instanceof StructType || f.params[i] == "addr") {
                    paramSize += sizeOf(f.params[i]);
                }
            }
            if (n.assign || stack == "wasmStack") {
                // Load the result from the heap stack onto the wasm stack
                let width: wasm.StackType = this.stackTypeOf(n.type.result);
                let asWidth: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
                switch (n.type.result) {
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
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Load(width, asWidth, n.args[1] as number + paramSize));
            }
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type.result, n.assign, stack == "wasmStack", code);
            }
            // Remove the return value and the parameters from the stack
            if (paramSize + sizeOf(n.type.result) > 0) {
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", paramSize + sizeOf(n.type.result)));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                code.push(new wasm.SetLocal(this.spLocal));
            }
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
        } else if (n.kind == "call") {
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error " + n.toString("");
            }
            if (n.type.result instanceof StructType) {
                throw "Implementation error. StructType returns are handled elsewhere";
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type.result as Type, n.assign, code);
            }
            for(let i = 0; i < n.type.params.length; i++) {
                if (n.type.params[i] instanceof StructType || n.type.params[i] == "addr") {
                    this.emitAssign(n.type.params[i], n.args[i+1], "heapStack", code);
                } else {
                    this.emitAssign(n.type.params[i], n.args[i+1], "wasmStack", code);                    
                }
            }
            code.push(new wasm.GetLocal(this.spLocal));
            // Call the function
            code.push(new wasm.Call(n.args[0] as number));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type.result as Type, n.assign, stack == "wasmStack", code);
            } else if (stack == null) {
                // Remove parameter from wasm stack
                code.push(new wasm.Drop());
            }
            n = n.next[0];            
        } else {
            throw "Implementation error";
        }
    }

    private storeVariableFromWasmStack1(type: Type, v: Variable, code: Array<wasm.Node>) {
        let s = this.varStorage.get(v);
        switch(s.storageType) {
            case "vars":
            case "params":
            case "result":
                code.push(new wasm.GetLocal(this.bpLocal));
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
        let s = this.varStorage.get(v);
        switch(s.storageType) {
            case "local":
                if (tee) {
                    code.push(new wasm.TeeLocal(s.offset));
                } else {
                    code.push(new wasm.SetLocal(s.offset));
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
            case "neq":
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

    private getTmpLocal(type: Type): number {
        switch(type) {
            case "i32":
                if (this.tmpI32Local == -1) {
                    this.tmpI32Local = this.wf.parameters.length + this.wf.results.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpI32Local;
            case "i64":
                if (this.tmpI64Local == -1) {
                    this.tmpI64Local = this.wf.parameters.length + this.wf.results.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpI64Local;
            case "f32":
                if (this.tmpF32Local == -1) {
                    this.tmpF32Local = this.wf.parameters.length + this.wf.results.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpF32Local;
            case "f64":
                if (this.tmpF64Local == -1) {
                    this.tmpF64Local = this.wf.parameters.length + this.wf.results.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpF64Local;
        }
        throw "Implementation error";
    }

    public module: wasm.Module;

    private copyFunctionIndex: number = 0; // TODO
    private stepLocal: number;
    private bpLocal: number;
    private spLocal: number;
    private steps: Array<Node> = [];
    private stepCode: Array<Array<wasm.Node>> = [];
    private stepsByName: Map<string, number> = new Map<string, number>();
    private asyncCalls: Array<Node> = [];
    private asyncCallCode: Array<Array<wasm.Node>> = [];
    private tr: SMTransformer;
    private resultFrame: StructType = new StructType();
    private paramsFrame: StructType = new StructType();
    private varsFrame: StructType = new StructType();
    private varStorage = new Map<Variable, Wasm32Storage>();
    private tmpI32Local: number;
    private tmpI64Local: number;
    private tmpF32Local: number;
    private tmpF64Local: number;
    private wf: wasm.Function;
    private wfIsAsync: boolean;
}

function main() {

    let b = new Builder();
    b.define("f1", new FunctionType(["f32", "f32"], "f32", true));
    let p1 = b.declareParam("f32", "$1");
    let p2 = b.declareParam("f32", "$2");
    let r = b.declareResult("f32", "$r");
    let t1 = b.assign(b.tmp(), "eq", "f32", [p1, p2]);
    b.ifBlock(t1);
    b.assign(r, "return", "f32", [-1]);
    b.end();
    let t2 = b.assign(b.tmp(), "mul", "f32", [p1, p2]);
    b.assign(r, "return", "f32", [t2]);
    b.assign(r, "return", "f32", [t2]);
    b.end();
    console.log(Node.strainToString("", b.node));

    /*
    let b = new Builder();
    b.define("f1", new FunctionType(["i32", "f32"], "i32"));
    let p1 = b.declareParam("i32", "$1");
    let p2 = b.declareParam("f32", "$2");
    let r = b.declareResult("i32", "$r");
    let t2 = b.assign(b.tmp(), "const", "i32", [84]);
    let t1 = b.assign(b.tmp(), "const", "i32", [42]);
    let t = b.assign(b.tmp(), "add", "i32", [t1, t2]);
    let f1 = new FunctionType(["i32", "i32"], "i32");
    b.call(null, f1, [11, t, t]);
    b.ifBlock(t);
    let t3 = b.call(b.tmp(), f1, [9]);
    let t5 = b.assign(b.tmp(), "addr_of", "addr", [t]);
    b.assign(b.mem, "store", "i32", [t5, 4, t3]);
    b.elseBlock();
    let t6 = b.assign(b.tmp(), "addr_of", "addr", [t]);
    b.assign(b.mem, "store", "i32", [t6, 8, 0]);
    b.end();
//    b.ifBlock(t);
    let bl = b.block();
    let lo = b.loop();
    let t4 = b.assign(b.tmp(), "load", "i32", [t1, 4]);
    b.assign(b.mem, "store", "i32", [1234, 0, t4]);
    b.br_if(t, bl);
//    b.br(bl);
    b.call(null, f1, [10]);
    b.br(lo);
    b.end();
//    b.end();
    b.end();
    let f = new FunctionType(["i32"], "addr");
    b.call(b.tmp(), f, [8, t]);
    let dummy1 = b.assign(b.tmp(), "const", "i32", [44]);
    let dummy2 = b.assign(b.tmp(), "const", "i32", [45]);
    let t7 = b.assign(b.tmp(), "add", "i32", [dummy1, dummy2]);
    b.call(null, new FunctionType(["i32"], null, false), [111, t7]);
    b.end();
    console.log(Node.strainToString("", b.node));
    */

    let opt = new Optimizer();
    opt.optimizeConstants(b.node);
    console.log('============ OPTIMIZED Constants ===============');
    console.log(Node.strainToString("", b.node));

    opt.removeDeadCode(b.node);
    console.log('============ OPTIMIZED Dead code ===============');
    console.log(Node.strainToString("", b.node));

    let back = new Wasm32Backend();
    var wf = back.generateFunction(b.node);
    console.log('============ WAST ===============');
    console.log(back.module.toWast(""));
}

main();