export abstract class Node {
    public abstract get op(): string;
    public abstract toWabt(indent: string): string;
}

export type StorageType = "i32" | "i64" | "f32" | "f64";

let nameCounter = 0;

export class Function extends Node {
    constructor(name?: string) {
        super();
        if (!name) {
            this.name = "$f" + nameCounter.toString();
            nameCounter++;
        } else {
            this.name = name;
        }
    }

    public get op(): string {
        return "function";
    }

    public toWabt(indent: string): string {
        let s = indent + "(func " + this.name;
        for(let p of this.parameters) {
            s += " (param " + p + ")";
        } 
        for(let p of this.locals) {
            s += " (local " + p + ")";
        } 
        for(let p of this.results) {
            s += " (result " + p + ")";
        } 
        s += "\n";
        for(let st of this.statements) {
            s += st.toWabt(indent + "    ") + "\n";
        }
        return s + ")";
    }

    public name: string;
    public parameters: Array<StorageType> = [];
    public locals: Array<StorageType> = [];
    public results: Array<StorageType> = [];
    public statements: Array<Node> = [];
}

export class Constant extends Node {
    constructor(type: StorageType, value: number) {
        super();
        this.type = type;
        this.value = value;
    }

    public get op(): string {
        return this.type + ".const";
    }

    public toWabt(indent: string): string {
        return indent + this.op + " " + this.value.toString();
    }

    public value: number;  
    public type: StorageType;  
}