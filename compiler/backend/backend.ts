import * as ssa from "../ssa"
import {Package} from "../pkg"

export interface FunctionImport {
    getIndex(): number;
    isImported(): boolean;
    getName(): string;
}

export interface Function {
    getIndex(): number;
    isImported(): boolean;
    getName(): string;
}

export interface Backend {
    importFunction(name: string, from: string | Package, type: ssa.FunctionType): FunctionImport;
    importGlobalVar(name: string, type: ssa.Type | ssa.StructType | ssa.PointerType, from: string | Package): ssa.Variable;
    declareGlobalVar(name: string, type: ssa.Type | ssa.StructType | ssa.PointerType): ssa.Variable;
    declareFunction(name: string | null): Function;
    declareInitFunction(name: string): Function;
    defineFunction(n: ssa.Node, f: Function, isExported: boolean, isPossibleDuplicate: boolean): void;
    generateModule(emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string;
//    addFunctionToTable(f: Function, index: number);
    addInterfaceDescriptor(name: string, table: Array<Function | FunctionImport>): number;
    addSymbol(name: string): number;
    /**
     * Returns the init function unless it is empty or missing.
     */
    getInitFunction(): Function | null;
}
