import * as ssa from "./ssa"
import {Package} from "./pkg"

export interface FunctionImport {
    getIndex(): number;
    isImported(): boolean;    
}

export interface Function {
    getIndex(): number;
    isImported(): boolean;    
}

export interface Backend {
    importFunction(name: string, from: string | Package, type: ssa.FunctionType): FunctionImport;
    declareGlobalVar(name: string, type: ssa.Type | ssa.StructType | ssa.PointerType): ssa.Variable;
    declareFunction(name: string): Function;
    declareInitFunction(name: string): Function;
    defineFunction(n: ssa.Node, f: Function, isExported: boolean, isPossibleDuplicate: boolean);
    generateModule(emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string;
    addFunctionToTable(f: Function, index: number);
    /**
     * Returns the init function unless it is empty or missing.
     */
    getInitFunction(): Function | null;
}
