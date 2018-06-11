import * as ssa from "./ssa"
import {Package} from "./pkg"
import * as backend from "./backend"

export class FunctionImport implements backend.Function {
    getIndex(): number {
        return this.index;
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

    isImported(): boolean {
        return false;
    }

    public index: number;
    public name: string;
    public node: ssa.Node;
}

export class DummyBackend {
    importFunction(name: string, from: string | Package, type: ssa.FunctionType): FunctionImport {
        let f = new FunctionImport();
        f.index = this.funcs.length;
        f.name = name;
        this.funcs.push(f);
        return f;
    }

    declareGlobalVar(name: string, type: ssa.Type | ssa.StructType | ssa.PointerType): ssa.Variable {
        let v = new ssa.Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;        
        return v;
    }
    
    declareFunction(name: string): Function {
        let f = new Function();
        f.index = this.funcs.length;
        f.name = name;
        this.funcs.push(f);
        return f;
    }

    declareInitFunction(name: string): Function {
        let f = new Function();
        f.index = this.funcs.length;
        f.name = "init";
        this.funcs.push(f);
        return f;
    }

    defineFunction(n: ssa.Node, f: Function, isExported: boolean) {
        f.node = n;
    }

    generateModule(emitIR: boolean): string {
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

    addFunctionToTable(f: Function, index: number) {        
    }

    public funcs: Array<Function | FunctionImport> = [];
}
