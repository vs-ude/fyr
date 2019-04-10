import * as ssa from "./ssa"
import {Package} from "./pkg"
import * as backend from "./backend"
import {InterfaceType, StructType} from "./types/"

export class FunctionImport implements backend.Function {
    getIndex(): number {
        return this.index;
    }

    public getName(): string {
        return this.name;
    }

    isImported(): boolean {
        return true;
    }

    public index: number;
    public name: string;
}

export class Function implements backend.FunctionImport {
    getIndex(): number {
        return this.index;
    }

    public getName(): string {
        return this.name;
    }

    isImported(): boolean {
        return false;
    }

    public index: number;
    public name: string;
    public node: ssa.Node;
}

export class DummyBackend {
    importFunction(name: string, from: string | Package, type: ssa.FunctionType): backend.FunctionImport {
        let f = new FunctionImport();
        f.index = this.funcs.length;
        f.name = name;
        this.funcs.push(f);
        return f;
    }

    importGlobalVar(name: string, type: ssa.Type | ssa.StructType | ssa.PointerType, from: string | Package): ssa.Variable {
        let v = new ssa.Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;
        return v;
    }

    declareGlobalVar(name: string, type: ssa.Type | ssa.StructType | ssa.PointerType): ssa.Variable {
        let v = new ssa.Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;
        return v;
    }

    declareFunction(name: string | null): backend.Function {
        let f = new Function();
        f.index = this.funcs.length;
        f.name = name == null ? "f" + (this.funcs.length + 1).toString() : name;
        this.funcs.push(f);
        return f;
    }

    declareInitFunction(name: string): backend.Function {
        let f = new Function();
        f.index = this.funcs.length;
        f.name = "init";
        this.funcs.push(f);
        this.initFunction = f;
        return f;
    }

    getInitFunction(): backend.Function {
        return this.initFunction;
    }

    defineFunction(n: ssa.Node, f: backend.Function, isExported: boolean, isPossibleDuplicate: boolean) {
        if (!(f instanceof Function)) {
            throw new Error("implementation error")
        }
        f.node = n;
    }

    generateModule(emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string {
        let ircode = "";

        if (emitIR) {
            for(let f of this.funcs) {
                if (f instanceof Function) {
                    ircode += ssa.Node.strainToString("", f.node) + "\n";
                }
            }
        }
        return ircode;
    }

//    addFunctionToTable(f: Function, index: number) {
//    }

    addInterfaceDescriptor(name: string, table: Array<backend.Function | backend.FunctionImport>): number {
        return 0;
    }

    addSymbol(name: string): number {
        return 0;
    }

    public funcs: Array<Function | FunctionImport> = [];
    public initFunction: Function;
}
