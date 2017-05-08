import * as wasm from "./wasm"

export type NodeKind = "goto_step" | "goto_step_if" | "step" | "call_begin" | "call_end" | "define" | "decl_param" | "decl_result" | "decl_var" | "block" | "loop" | "end" | "if" | "br" | "br_if" | "load" | "store" | "addr_of" | "call" | "const" | "add";
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
    constructor(params: Array<Type | StructType>, result: Type | StructType | null) {
        this.params = params;
        this.result = result;
    }

    public toString(): string {
        let str = "(" + this.params.map(function(t: Type) { return t.toString() }).join(",") + ")";
        str += " => (" + (this.result ? this.result.toString() : "") + ")";
        return str;
    }

    public params: Array<Type | StructType>;
    public result: Type | StructType | null;
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

        return str;
    }

    public static strainToString(indent: string, n: Node) {
        let str = "";
        for(; n && n.kind != "end";) {
            str += n.toString(indent);
            if (n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "define") {
                n = n.blockPartner.next[0];
            } else {
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

    public define(name: string, type: FunctionType, params: Array<Variable>, result: Variable) {
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
            n = this.declare(name, type, params, result);
        }
        this._blocks.push(n);
    }

    public declare(name: string, type: FunctionType, params: Array<Variable>, result: Variable | null): Node {
        let n = new Node(null, "define", type, []);
        n.name = name;
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
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
        let e = new Node(null, "end", undefined, []);
        e.blockPartner = n;
        n.blockPartner = e;  
        this.countReadsAndWrites(n);
        return n;
    }
    
    private declParam(v: Variable): Node {
        let n = new Node(v, "decl_param", v.type, []);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n;
    }

    private declResult(v: Variable): Node {
        let n = new Node(v, "decl_result", v.type, []);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n;
    }

    public declVar(v: Variable): Node {
        let n = new Node(v, "decl_var", v.type, []);
        if (this._current) {
            this._current.next.push(n);
            n.prev.push(this._current);
        } else {
            this._node = n;
        }
        this._current = n;
        this.countReadsAndWrites(n);
        return n;
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
            b.isAsync = true;
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
    }

    /**
     * Traverse the code backwards
     */
    private _removeDeadCode(n: Node, end: Node) {
        for( ;n; ) {
            // Remove assignments to variables which are not read
            if (n.kind == "call" && n.assign && n.assign.readCount == 0) {
                n.assign.writeCount--;
                n.assign = null;
            } else if (n.kind == "end" && n.prev[1]) {
                this._removeDeadCode(n.prev[1], n.blockPartner);
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
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
                    let end = new Node(null, "goto_step", undefined, []);
                    step = null;
                    Node.insertBetween(n.prev[elseClause ? 1 : 0], n, end);                        
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
                } else if (n.kind == "call") {
                    n.kind = "call_begin";
                    let result = new Node(n.assign, "call_end", n.type, []);
                    n.assign = null;
                    let end = new Node(null, "goto_step", undefined, []);
                    step = null;
                    Node.insertBetween(n, n.next[0], end);
                    Node.insertBetween(end, end.next[0], result);
                    n = result;
/*                    // If a br follows a call, incorporate it directly in the goto_step
                    if (n && n.kind == "br") {
                        if (n.blockPartner.kind == "loop") {
                            end.blockPartner = n.blockPartner;
                        } else {
                            end.blockPartner = n.blockPartner.blockPartner;
                        }                        
                        let n2 = n.next[0];
                        Node.removeNode(n);
                        n = n2;
                    } */
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
    public clone(): Wasm32LocalVariableList {
        let l = new Wasm32LocalVariableList();
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
                return i;
            }
        }
        this.locals.push(t);
        this.used.push(true);
        return this.locals.length - 1;
    }

    public locals: Array<wasm.StackType> = [];
    public used: Array<boolean> = [];
}

export class Wasm32Backend {
    constructor() {
         this.tr = new SMTransformer();
         this.module = new wasm.Module();
    }

    public generateFunction(n: Node): wasm.Function {
        this.tr.transform(n);
        console.log("========= State Machine ==========");
        console.log(n.toString(""));

        this.traverse(n.next[0], n.blockPartner, null);
        this.stackifySteps();
        let locals = new Wasm32LocalVariableList();
        this.analyzeVariableStorage(n, n.blockPartner, locals);

        console.log("========= Stackified ==========");
        console.log(n.toString(""));
        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            console.log(v.name + " -> ", s.storageType, s.offset);
        }

        var wf = new wasm.Function(n.name);
        wf.parameters.push("i32"); // step_local
        wf.parameters.push("i32"); // sp
        wf.results.push("i32"); // interrupt or complete
        wf.locals.push("i32"); // bp
        wf.locals = wf.locals.concat(locals.locals);

        // Make room to store bp, sp and step upon async calls.
        this.varsFrame.addField("$bp", "i32");
        this.varsFrame.addField("$sp", "i32");
        this.varsFrame.addField("$step", "i32");

        // Generate function body
        let code: Array<wasm.Node> = [];
        // Put the varsFrame on the heap_stack and set BP
        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.Constant("i32", this.varsFrame.size));
        code.push(new wasm.BinaryIntInstruction("i32", "sub"));
        code.push(new wasm.TeeLocal(this.spLocal));
        code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        
        // Main loop of the function
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
        targets.push(this.stepCode.length);
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

        wf.statements = code;
        this.module.funcs.push(wf)

        return wf;
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
        let prev: Node = null;
        for( ; n && n != end; ) {
            if (n.kind == "step" || n.kind == "goto_step" || n.kind == "goto_step_if" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end") {
                if (prev) {
                    this.stackifyStepBackwards(prev);
                }
                if (n.kind == "step" || n.kind == "goto_step") {
                    break;
                }
            }
            if (n.kind == "if" && n.next[1]) {
                this.stackifyStep(n.next[1], n.blockPartner);
            }
            prev = n;
            n = n.next[0];
        }
    }

    private stackifyStepBackwards(n: Node) {
        for( ;n; ) {
            if (n.kind == "step" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end") {
                break;
            }
            for(let i = 0; i < n.args.length; i++) {
                let a = n.args[i];
                if (a instanceof Variable && a.readCount == 1) {
                    // Try to inline the computation
                    let inline = this.findInline(n.prev[0], a);
                    if (inline) {
                        if (inline.kind == "call_end") {
                            inline.assign = this._heapStack;
                        } else {
                            inline.assign = this._wasmStack;
                        }
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
            if (n.kind == "step" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end") {
                return null;
            }
            if (n.assign.name == v.name) {
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
            if (n.kind == "step" || n.kind == "if" || n.kind == "block" || n.kind == "loop" || n.kind == "end") {
                return null;
            }
            for(let a of n.args) {
                if (a instanceof Variable && a.name == v.name) {
                    return null;
                }
            }
            if (n.assign.name == v.name) {
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
            if (n.kind == "decl_result") {
                let index = this.paramsFrame.addField(n.assign.name, n.assign.type);
                let s: Wasm32Storage = {storageType: "result", offset: index};
                this.varStorage.set(n.assign, s);                
            } else if (n.kind == "decl_param") {
                let index = this.paramsFrame.addField(n.assign.name, n.assign.type);
                let s: Wasm32Storage = {storageType: "params", offset: index};
                this.varStorage.set(n.assign, s);                
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
        if (v == this._heapStack || v == this._wasmStack || v.name == "mem") {
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
                // TODO: Push value on stack
                code.push(new wasm.If());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                if (n.next[1]) {
                    code.push(new wasm.Else());
                    this.emitCode(step, n.next[1], n.blockPartner, code, depth, additionalDepth + 1);
                }
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
                // TODO: Parameter
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
                // TODO Put parameters on stack
                code.push(new wasm.Call(n.args[0] as number));
                // If the call returned with '1', the call returned async
                code.push(new wasm.BrIf(depth + additionalDepth - this.asyncCalls.length + this.asyncCallCode.length));
                let c: Array<wasm.Node> = [];
                c.push(new wasm.Comment("ASYNC CALL " + this.asyncCallCode.length.toString()));
                c.push(new wasm.End());
                c.push(new wasm.Constant("i32", step + 1)); // Next step;
                // TODO: Put next step in the stack_frame
                // TODO: Put bp in the stack_frame
                // TODO: Put sp in the stack_frame
                c.push(new wasm.Constant("i32", 1)); // Return with '1' to indicate that this is an async return
                c.push(new wasm.Return());
                this.asyncCallCode.push(c);
                n = n.next[0];
                if (n && n.kind == "goto_step" && step + 1 < this.steps.length && this.steps[step + 1].name == n.name) {
                    n = n.next[0];
                } else if (n && n.kind == "goto_step" && n.name == "<end>") {
                    n = n.next[0];
                    code.push(new wasm.Constant("i32", 0));
                    code.push(new wasm.Return());
                }
            } else if (n.kind == "call_end") {
                // TODO: Read result from stack
                n = n.next[0];                
            } else if (n.kind == "const") {
                let width: wasm.StackType;
                switch (n.type) {
                    case "i8":
                    case "i16":
                    case "i32":
                    case "s8":
                    case "s16":
                    case "s32":
                    case "addr":
                        width = "i32";
                        break;
                    case "i64":
                    case "s64":
                        width = "i64";
                        break;
                    case "f32":
                        width = "f32";
                        break;
                    case "f64":
                        width = "f64";
                        break;
                }
                code.push(new wasm.Constant(width, n.args[0] as number));
                // TODO: Store in destination
                n = n.next[0];
            } else if (n.kind == "store") {
                // TODO: Load addr
                // TODO: Load value
                let width: wasm.StackType;
                let asWidth: null | "8"| "16" | "32" = null;
                switch (n.type) {
                    case "i8":
                    case "s8":
                        asWidth = "8";
                        width = "i32";
                        break;
                    case "i16":
                    case "s16":
                        asWidth = "16";
                        width = "i32";
                        break;
                    case "i32":
                    case "s32":
                    case "addr":
                        width = "i32";
                        break;
                    case "i64":
                    case "s64":
                        width = "i64";
                        break;
                    case "f32":
                        width = "f32";
                        break;
                    case "f64":
                        width = "f64";
                        break;
                }
                code.push(new wasm.Store(width, asWidth, n.args[1] as number));
                // TODO: Store in destination
                n = n.next[0];
            } else if (n.kind == "add") {
                // TODO: Load args
                let width: wasm.StackType;
                switch (n.type) {
                    case "i8":
                    case "i16":
                    case "i32":
                    case "s8":
                    case "s16":
                    case "s32":
                    case "addr":
                        code.push(new wasm.BinaryIntInstruction("i32", "add"));
                        width = "i32";
                        break;
                    case "i64":
                    case "s64":
                        code.push(new wasm.BinaryIntInstruction("i64", "add"));
                        width = "i64";
                        break;
                    case "f32":
                        code.push(new wasm.BinaryFloatInstruction("f32", "add"));
                        width = "f32";
                        break;
                    case "f64":
                        code.push(new wasm.BinaryFloatInstruction("f64", "add"));
                        width = "f64";
                        break;
                }
                // TODO: Store in destination
                n = n.next[0];
            } else {
                // TODO
                n = n.next[0];
            }
        }
    }

    private asyncCallNumber(n: Node): number {
        return this.asyncCalls.indexOf(n);
    }

    private stepNumber(n: Node): number {
        return this.steps.indexOf(n);
    }

    public module: wasm.Module;

    private stepLocal: number = 0;
    private bpLocal: number = 2;
    private spLocal: number = 1;
    private steps: Array<Node> = [];
    private stepCode: Array<Array<wasm.Node>> = [];
    private stepsByName: Map<string, number> = new Map<string, number>();
    private asyncCalls: Array<Node> = [];
    private asyncCallCode: Array<Array<wasm.Node>> = [];
    private tr: SMTransformer;
    private resultFrame: StructType = new StructType();
    private paramsFrame: StructType = new StructType();
    private varsFrame: StructType = new StructType();
    private _heapStack = new Variable("heapStack");
    private _wasmStack = new Variable("wasmStack");
    private varStorage = new Map<Variable, Wasm32Storage>();
}

function main() {
    let b = new Builder();
    let r = new Variable("$r");
    let p1 = new Variable("$1");
    let p2 = new Variable("$2");
    b.define("f1", new FunctionType(["i32", "f32"], "i32"), [p1, p2], r);
    let t2 = b.assign(b.tmp(), "const", "i32", [84]);
    let t1 = b.assign(b.tmp(), "const", "i32", [42]);
    let t = b.assign(b.tmp(), "add", "i32", [t1, t2]);
    let f1 = new FunctionType([], "i32");
    b.call(null, f1, [t, t]);
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
    b.assign(b.tmp(), "add", "i32", [dummy1, dummy2]);
    b.end();
    console.log(Node.strainToString("", b.node));

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