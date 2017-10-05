import {TypeMapper, TypeMap} from "./gc"
import {SystemCalls} from "./pkg"
import {SMTransformer, Optimizer, Stackifier, Type, StructType, FunctionType, Variable, sizeOf, Node, alignmentOf, isSigned, NodeKind} from "./ssa"
import * as backend from "./backend"
import * as ssa from "./ssa"

export class FunctionImport implements backend.FunctionImport {
    public getIndex(): number {
        return this.index
    }

    public isImported(): boolean {
        return true;
    }

    private index: number;
}

export class Function implements backend.Function {
    constructor() {
        this.func = new CFunction();
    }

    public getIndex(): number {
        return this.index
    }

    public isImported(): boolean {
        return false;
    }

    private index: number;
    public name: string;
    public func: CFunction;
    public node: ssa.Node;
    public isExported: boolean;
}

export class CBackend implements backend.Backend {
    constructor(emitIR: boolean, emitIRFunction: string | null) {
        this.emitIR = emitIR;
        this.emitIRFunction = emitIRFunction;
        this.optimizer = new Optimizer();
        this.stackifier = new Stackifier(this.optimizer);
        this.module = new CModule();
    }

    public importFunction(name: string, from: string, type: ssa.FunctionType): FunctionImport {
        throw "TODO"
    }

    public declareGlobalVar(name: string, type: ssa.Type | ssa.StructType): ssa.Variable {
        let v = new Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;        
        this.globalVariables.push(v);
        return v;
    }

    public declareFunction(name: string): Function {
        let f = new Function();
        f.name = name;
        f.func.returnType = new CType("void");
        this.funcs.push(f);
        return f;
    }

    public declareInitFunction(name: string): Function {
        let f = new Function();
        f.name = name;
        f.func.name = "s_" + name;
        f.func.returnType = new CType("void");
        this.initFunction = f;
        this.funcs.push(f);
        return f;
    }

    public defineFunction(n: ssa.Node, f: Function, isExported: boolean) {
        if (!(f instanceof Function)) {
            throw "Implementation error";
        }
        if (isExported && f.name == "main") {
            this.mainFunction = f;
            f.func.name = "f_" + f.name;        
            f.isExported = true;
        } else if (isExported) {
            f.func.name = f.name;        
            f.isExported = true;
        } else {
            f.func.name = "f_" + f.name;        
        }
        f.node = n;
    }

    public generateModule() {
        let i = new CInclude();
        i.isSystemPath = true;
        i.path = "stdint";
        this.module.includes.push(i);

        for(let v of this.globalVariables) {
            let cv = new CVar();
            cv.name = v.name;
            cv.type = this.mapType(v.type);
            this.module.elements.push(cv);
        }

        for(let f of this.funcs) {
            this.currentFunction = f;
            this.stackifier.stackifyStep(f.node, null);
            let typemap = this.analyzeVariableStorage(f.node, f.node.blockPartner);
            // TODO: Set the typemap for GC

            let code: Array<CNode> = [];
            this.emitCode(f.node.next[0], null, code);
            f.func.body = code;

            this.module.elements.push(f.func);
        }

        let main = new CFunction();
        main.name = "main";
        main.returnType = new CType("int");
        let p = new CFunctionParameter();
        p.name = "argc";
        p.type = new CType("int");
        main.parameters.push(p);
        p = new CFunctionParameter();
        p.name = "argv";
        p.type = new CType("char**");
        main.parameters.push(p);

        if (this.initFunction) {
            let call = new CFunctionCall();
            call.funcExpr = new CConst(this.initFunction.func.name);
            main.body.push(call);
        }

        if (this.mainFunction) {
            let call = new CFunctionCall();
            call.funcExpr = new CConst(this.mainFunction.func.name);
            main.body.push(call);
        }
        this.module.elements.push(main);
    }

    public addString(str: string): number | ssa.Variable {
        let v = new ssa.Variable();
        v.isConstant = true;
        v.constantStringValue = str;
        return v;
    }

    public addFunctionToTable(f: Function, index: number) {
        throw "TODO";
    }

    public getCode(): string {
        return this.module.toString();
    }

    public getTypeMapper(): TypeMapper {
        return this.typeMapper;
    }

    private mapType(t: ssa.Type | ssa.StructType | ssa.FunctionType): CType {
        if (t instanceof ssa.StructType) {
            if (t.name) {
                return new CType("struct " + t.name);
            }
            return new CType("struct " + " {\n" + t.fields.map(function(c: [string, ssa.Type | ssa.StructType, number]) { return this.mapType(c[1]).toString()}).join("; ") + "\n}")
        }
        if (t instanceof ssa.FunctionType) {
            throw "TODO"
        }
        switch(t) {
            case "i8":
                return new CType("uint8_t");
            case "s8":
                return new CType("int8_t");
            case "i16":
                return new CType("uint16_t");
            case "s16":
                return new CType("int16_t");
            case "i32":
                return new CType("uint32_t");
            case "s32":
                return new CType("int32_t");
            case "i64":
                return new CType("uint64_t");
            case "s64":
                return new CType("int64_t");
            case "f32":
                return new CType("float");
            case "f64":
                return new CType("double");
            case "addr":
            case "ptr":
                return new CType("void*");
        }
    }

    private emitCode(start: Node, end: Node | null, code: Array<CNode>) {
        // TODO
    }

    private analyzeVariableStorage(start: Node, end: Node, typemap: TypeMap | null = null): TypeMap | null {
        if (!typemap) {
            typemap = new TypeMap();
        }
        let n = start;
        for(; n; ) {
            // Ignore decl_var here. These variables get storage when they are assigned.
            // Parameters and result variables, however, need storage even if they are not being assigned.
            if (n.kind == "decl_result") {
                this.currentFunction.func.returnType = this.mapType(n.type);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param") {
                let p = new CFunctionParameter();
                p.name = n.assign.name;
                p.type = this.mapType(n.type);
                this.currentFunction.func.parameters.push(p);
                n = n.next[0];                
                continue;
            }
            if (n.assign) {
                this.assignVariableStorage(n.assign, typemap);
            }
            for(let v of n.args) {
                if (v instanceof Variable) {
                    this.assignVariableStorage(v, typemap);
                } else if (v instanceof Node) {
                    this.analyzeVariableStorage(v, null, typemap);
                }
            }
            if (n.kind == "if" && n.next.length > 1) {
                this.analyzeVariableStorage(n.next[1], n.blockPartner, typemap);
                n = n.next[0];
            } else {
                n = n.next[0];                
            }
        }
        return typemap;
    }

    private assignVariableStorage(v: Variable, typemap: TypeMap): void {
        if (v.name == "$mem") {
            return;
        }
//        if (this.varStorage.has(v) || this.globalVarStorage.has(v)) {
//            return;
//        }

    }

    private typeMapper: TypeMapper;
    private emitIR: boolean;
    private emitIRFunction: string | null;
    private optimizer: Optimizer;
    private stackifier: Stackifier;
    private module: CModule;
    private initFunction: Function;
    private mainFunction: Function;
    private globalVariables: Array<ssa.Variable> = [];
    private funcs: Array<Function> = [];
    private currentFunction: Function;
}

export class CInclude {
    public toString(): string {
        if (this.isSystemPath) {
            return "#include <" + this.path + ">";
        }
        return "#include \"" + this.path + "\"";
    }

    public path: string;
    public isSystemPath: boolean;
}

export class CModule {
    public toString(): string {
        let str = this.includes.map(function(c: CInclude) { return c.toString()}).join("\n") + "\n\n";
        str += this.elements.map(function(c: CStruct | CFunction | CVar) {if (c instanceof CFunction) return c.toString(); else return c.toString() + ";"}).join("\n\n");
        return str;
    }

    public includes: Array<CInclude> = [];
    public elements: Array<CStruct | CFunction | CVar> = [];
}

export class CNode {    
}

export class CStruct extends CNode {
    public toString(): string {
        return "struct " + this.name + " {\n" + this.fields.map(function(c: CFunctionParameter) { return "    " + c.toString()}).join("\n") + "\n}";
    }

    public name: string;
    public fields: Array<CFunctionParameter> = [];
}

export class CFunction extends CNode {
    public toString(): string {
        let str = this.returnType + " " + this.name + "(" + this.parameters.map(function(c: CFunctionParameter) { return c.toString()}).join(", ") + ") {\n";
        str += this.body.map(function(c: CNode) { return "    " + c.toString() + ";"}).join("\n");
        return str + "\n}";
    }

    public name: string;
    public returnType: CType;
    public parameters: Array<CFunctionParameter> = [];
    public body: Array<CNode> = [];
}

export class CFunctionParameter {
    public toString(): string {
        return this.type.toString() + " " + this.name;
    }
    public name: string;
    public type: CType;
}

export class CType {
    constructor(code: string) {
        this.code = code;
    }

    public toString(): string {
        return this.code;
    }

    public code: string;
}
    
export class CReturn extends CNode {
    public toString(): string {
        if (this.expr) {
            return "return " + this.expr.toString()
        }
        return "return;"
    }

    public expr?: CNode;
}

export class CUnary extends CNode {
    public toString(): string {
        return this.operator + this.expr.toString();
    }

    public expr: CNode;
    public operator: "*" | "&" | "!";
}

export class CBinary extends CNode {
    public toString(): string {
        // TODO: Operator precedence
        return this.lExpr.toString() + this.operator + this.rExpr.toString();
    }

    public lExpr: CNode;
    public rExpr: CNode;
    public operator: "+" | "-" | "*" | "/" | "%" | "&" | "|" | "&&" | "||" | "<<" | ">>" | "=";
}

export class CFunctionCall extends CNode {
    public toString(): string {
        return this.funcExpr.toString() + "(" + this.args.map(function(c: CNode) { return c.toString()}).join(", ") + ")";
    }

    public funcExpr: CNode;
    public args: Array<CNode> = [];
}

export class CTypeCast extends CNode {
    public toString(): string {
        return "(" + this.type.toString() + ")(" + this.expr.toString() + ")";
    }

    public type: CType;
    public expr: CNode;
}

export class CVar extends CNode {
    public toString(): string {
        let str = this.type.toString() + " " + this.name;
        if (this.initExpr) {
            str += " = " + this.initExpr.toString();
        }
        return str;
    }

    public name: string;
    public type: CType;
    public initExpr?: CNode;
}

export class CConst extends CNode {
    constructor(code: string) {
        super();
        this.code = code;
    }

    public toString(): string {
        return this.code;
    }

    public code: string;
}