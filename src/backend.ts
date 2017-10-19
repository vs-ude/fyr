import * as ssa from "./ssa"
import {TypeMapper} from "./gc"

export interface FunctionImport {
    getIndex(): number;
    isImported(): boolean;    
}

export interface Function {
    getIndex(): number;
    isImported(): boolean;    
}

export interface Backend {
    importFunction(name: string, from: string, type: ssa.FunctionType): FunctionImport;
    declareGlobalVar(name: string, type: ssa.Type | ssa.StructType): ssa.Variable;
    declareFunction(name: string): Function;
    declareInitFunction(name: string): Function;
    defineFunction(n: ssa.Node, f: Function, isExported: boolean);
    generateModule();
    // TODO: Should not be necessary. Just use a constant variable
    addString(str: string): number | ssa.Variable;
    addFunctionToTable(f: Function, index: number);
    getCode(): string;
    getTypeMapper(): TypeMapper;
}