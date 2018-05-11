import {TypeMapper, TypeMap} from "./gc"
import {SystemCalls} from "./pkg"
import {SMTransformer, Optimizer, Stackifier, Type, StructType, FunctionType, Variable, sizeOf, Node, alignmentOf, isSigned, NodeKind} from "./ssa"
import * as backend from "./backend"
import * as ssa from "./ssa"

export type BinaryOperator = "*" | "/" | "%" | "+" | "-" | "->" | "." | ">>" | "<<" | "<" | ">" | "<=" | ">=" | "==" | "!=" | "&" | "^" | "|" | "&&" | "||" | "=" | "+=" | "-=" | "/=" | "*=" | "%=" | "<<=" | ">>=" | "&=" | "^=" | "|=";

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

    public index: number;
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
        this.operatorMap.set("mul", "*");
        this.operatorMap.set("add", "+");
        this.operatorMap.set("sub", "-");
        this.operatorMap.set("div", "/");
        this.operatorMap.set("div_s", "/");
        this.operatorMap.set("div_u", "/");
        this.operatorMap.set("rem_u", "%");
        this.operatorMap.set("rem_s", "%");
        this.operatorMap.set("and", "&");
        this.operatorMap.set("xor", "^");
        this.operatorMap.set("or", "|");
        this.operatorMap.set("shl", "<<");
        this.operatorMap.set("shr_s", ">>");
        this.operatorMap.set("shr_u", ">>");
        this.operatorMap.set("eq", "==");
        this.operatorMap.set("ne", "!=");
        this.operatorMap.set("lt", "<");
        this.operatorMap.set("lt_s", "<");
        this.operatorMap.set("lt_u", "<");
        this.operatorMap.set("gt", ">");
        this.operatorMap.set("gt_s", ">");
        this.operatorMap.set("gt_u", ">");
        this.operatorMap.set("le", "<=");
        this.operatorMap.set("le_s", "<=");
        this.operatorMap.set("le_u", "<=");
        this.operatorMap.set("ge", ">=");
        this.operatorMap.set("ge_s", ">=");
        this.operatorMap.set("ge_u", ">=");
    }

    public importFunction(name: string, from: string, type: ssa.FunctionType): FunctionImport {
        throw "TODO"
    }

    public declareGlobalVar(name: string, type: ssa.Type | ssa.StructType): ssa.Variable {
        name = "g_" + name;
        let v = new Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;        
        this.globalVariables.push(v);        
        this.globalStorage.set(v, v.name);
        return v;
    }

    public declareFunction(name: string): Function {
        let f = new Function();
        f.name = name;
        f.func.returnType = new CType("void");
        f.index = this.funcs.length;
        this.funcs.push(f);
        return f;
    }

    public declareInitFunction(name: string): Function {
        let f = new Function();
        f.name = name;
        f.func.name = "s_" + name;
        f.func.returnType = new CType("void");
        f.index = this.funcs.length;
        this.initFunction = f;
        this.funcs.push(f);
        return f;
    }

    public defineFunction(n: ssa.Node, f: Function, isExported: boolean) {
        if (!(f instanceof Function)) {
            throw "Implementation error";
        }
        let nameWithoutDot = f.name.replace("_", "_u");
        nameWithoutDot = nameWithoutDot.replace(".", "__");
        if (isExported && f.name == "main") {
            this.mainFunction = f;
            f.func.name = "f_" + nameWithoutDot;        
            f.isExported = true;
        } else if (isExported) {
            f.func.name = nameWithoutDot;        
            f.isExported = true;
        } else {
            f.func.name = "f_" + nameWithoutDot;        
        }
        f.node = n;
    }

    public generateModule() {
        let i = new CInclude();
        i.isSystemPath = true;
        i.path = "stdint.h";
        this.module.includes.push(i);
        i = new CInclude();
        i.isSystemPath = true;
        i.path = "stdlib.h";
        this.module.includes.push(i);
        i = new CInclude();
        i.isSystemPath = false;
        i.path = "fyr.h";
        this.module.includes.push(i);

        for(let v of this.globalVariables) {
            let cv = new CVar();
            cv.name = v.name;
            cv.type = this.mapType(v.type);
            this.module.elements.push(cv);
        }

        for(let f of this.funcs) {
            this.optimizer.optimizeConstants(f.node);
            if (this.emitIR || f.name == this.emitIRFunction) {
                console.log('============ OPTIMIZED Constants ===============');
                console.log(Node.strainToString("", f.node));
            }

            this.optimizer.removeDeadCode(f.node);
            if (this.emitIR || f.name == this.emitIRFunction) {
                console.log('============ OPTIMIZED Dead code ===============');
                console.log(Node.strainToString("", f.node));
            }

            this.currentFunction = f;
            this.returnVariables = [];
            this.localVariables = [];
            this.parameterVariables = [];
            this.varStorage = new Map<ssa.Variable, string>();
            this.stackifier.stackifyStep(f.node, null);

            if (this.emitIR || f.name == this.emitIRFunction) {
                console.log('============ STACKIFIED code ===============');
                console.log(Node.strainToString("", f.node));
            }

            let typemap = this.analyzeVariableStorage(f.node, f.node.blockPartner);
            // TODO: Set the typemap for GC

            let code: Array<CNode> = [];

            for(let v of this.localVariables) {
                if (v.readCount == 0 && v.writeCount == 0) {
                    continue;
                }
                let cv = new CVar();
                cv.type = this.mapType(v.type);
                cv.name = this.varStorage.get(v);
                code.push(cv);
            }

            this.emitCode(f.node.next[0], null, code);
            f.func.body = code;

            this.module.elements.push(f.func);
        }

        for(let t of this.namedStructs.values()) {
            let ct = new CType("struct " + t.name + " {\n" + t.fields.map((c: [string, ssa.Type | ssa.StructType, number], i: number) => {
                let t = this.mapType(c[1]).toString();
                if (c[2] > 1) {
                    return "    " + t + " " + c[0] + "[" + c[2].toString() + "];\n"
                }
                return "    " + this.mapType(c[1]).toString() + " " + c[0] + ";\n";
            }).join("") + "}")
            this.module.elements.unshift(ct);
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
            let r = new CReturn();
            r.expr = call;
            main.body.push(r);
        }
        this.module.elements.push(main);
    }

    public addString(str: string): number | ssa.Variable {
        let v = new ssa.Variable();
        v.isConstant = true;
        v.constantValue = str;
        v.readCount = 2;
        v.writeCount = 2;
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
                if (!this.namedStructs.has(t.name)) {
                    this.namedStructs.set(t.name, t);
                }
                return new CType("struct " + t.name);
            }
            return new CType("struct " + " {\n" + t.fields.map((c: [string, ssa.Type | ssa.StructType, number], i: number) => {
                let t = this.mapType(c[1]).toString();
                if (c[2] > 1) {
                    return "    " + t + " field" + i.toString() + "[" + c[2].toString() + "];\n"
                }
                return "    " + this.mapType(c[1]).toString() + " field" + i.toString() + ";\n";
            }).join("") + "}")
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
                return new CType("addr_t");
            case "int":
                return new CType("uint_t");
            case "sint":
                return new CType("int_");
        }
    }

    private mapToSignedType(t: ssa.Type | ssa.StructType | ssa.FunctionType): CType {
        switch(t) {
            case "i8":
                return new CType("int8_t");
            case "i16":
                return new CType("int16_t");
            case "i32":
                return new CType("int32_t");
            case "i64":
                return new CType("int64_t");
            case "addr":
            case "ptr":
                return new CType("saddr_t");
            case "sint":
                return new CType("int_t");
        }
        throw "Implementation error";
    }

    private mapToUnsignedType(t: ssa.Type | ssa.StructType | ssa.FunctionType): CType {
        switch(t) {
            case "s8":
                return new CType("uint8_t");
            case "s16":
                return new CType("uint16_t");
            case "s32":
                return new CType("uint32_t");
            case "s64":
                return new CType("uint64_t");
            case "int":
                return new CType("uint_t");
        }
        throw "Implementation error";
    }

    private isSignedType(t: ssa.Type | ssa.StructType | ssa.FunctionType): boolean {
        return t == "s8" || t == "s16" || t == "s32" || t == "s64";
    }

    private emitExpr(t: ssa.Type | ssa.StructType | ssa.FunctionType, n: number | ssa.Variable | ssa.Node): CNode {
        let c = this.emitExprIntern(t, n);
        if (n instanceof ssa.Node && n.assign && (n.assign.readCount != 0 || n.assign.writeCount != 0)) {
            let e = new CBinary();
            e.operator = "=";
            e.lExpr = this.emitExprIntern(n.type, n.assign);
            e.rExpr = c;
            return e;    
        }
        return c;
    }

    private emitExprIntern(t: ssa.Type | ssa.StructType | ssa.FunctionType, n: number | ssa.Variable | ssa.Node): CNode {
        if (typeof(n) == "number") {
            return new CConst(n.toString());
        }
        if (n instanceof ssa.Variable) {
            if (n.isConstant && typeof(n.constantValue) == "string") {
                // TODO: Proper string escape
                return new CConst("\"" + n.constantValue + "\"");
            }
            if (this.globalStorage.has(n)) {
                let name = this.globalStorage.get(n);
                return new CConst(name);                    
            }
            if (this.varStorage.has(n)) {
                let name = this.varStorage.get(n);
                return new CConst(name);
            }
            throw "Implementation error";
        }
        if (n instanceof ssa.FunctionType) {
            throw "Implementation error";
        }
        if (n.kind == "addr_of") {
            if (n.type instanceof ssa.FunctionType || n.type instanceof ssa.StructType) {
                throw "Implementation error"
            }
            if (!(n.args[0] instanceof ssa.Variable)) {
                throw "Implementation error"                    
            }
            let e = new CUnary();
            e.operator = "&";
            e.expr = this.emitExpr((n.args[0] as ssa.Variable).type, n.args[0]);
            let t = new CTypeCast();
            t.type = new CType("addr_t");
            t.expr = e;
            return t;
        } else if (n.kind == "load") {
            if (n.type instanceof FunctionType) {
                throw "Implementation error"
            }
            let expr = this.emitExpr(n.type, n.args[0]);
            if (n.args[1] != 0) {
                let addExpr= new CBinary();
                addExpr.operator = "+";
                addExpr.lExpr = expr;
                addExpr.rExpr = new CConst((n.args[1] as number).toString());
                expr = addExpr;
            }
            let t = new CTypeCast();
            t.expr = expr;
            t.type = new CType(this.mapType(n.type) + "*");
            let e = new CUnary();
            e.operator = "*";
            e.expr = t;
            return e;
        } else if (n.kind == "promote" || n.kind == "demote" || n.kind == "trunc32" || n.kind == "trunc64") {
            if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                throw "Implementation error"
            }
            throw "TODO"
        } else if (n.kind == "const") {
            if (n.type instanceof FunctionType || !n.assign) {
                throw "Implementation error"
            }
            return this.emitExpr(n.type, n.args[0]);
        } else if (n.kind == "call") {
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error"
            }
            let c = new CFunctionCall();
            let f = this.funcs[n.args[0] as number];
            c.funcExpr = new CConst(f.func.name);
            for(let i = 1; i < n.args.length; i++) {
                let a = n.args[i];
                c.args.push(this.emitExpr(n.type.params[i-1], a));
            }
            return c;
        } else if (n.kind == "call_indirect") {
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error"
            }
            throw "TODO";
        } else if (n.kind == "copy") {
            if (n.type instanceof FunctionType) {
                throw "Implementation error"
            }
            return this.emitExpr(n.type, n.args[0]);
        } else if (n.kind == "struct") {
            if (!(n.type instanceof StructType)) {
                throw "Implementation error"
            }
            let t = new CTypeCast();
            t.type = this.mapType(n.type);
            let l = new CCompoundLiteral();
            for(let a of n.args) {
                l.values.push(this.emitExpr(null, a));
            }
            t.expr = l;
            return t;
        } else if (n.kind == "add" || n.kind == "sub" || n.kind == "mul" || n.kind == "div" || n.kind == "eq" || n.kind == "ne" || n.kind == "or" || n.kind == "xor" || n.kind == "and" || n.kind == "shl" || n.kind == "lt" || n.kind == "gt" || n.kind == "le" || n.kind == "ge") {
            let e = new CBinary();
            e.operator = this.operatorMap.get(n.kind);
            e.lExpr = this.emitExpr(n.type, n.args[0]);
            e.rExpr = this.emitExpr(n.type, n.args[1]);
/*            if (n.assign) {
                let a = new CBinary();
                a.operator = "=";
                a.lExpr = this.emitExpr(n.assign.type, n.assign);
                a.rExpr = e;
                return a;
            } */
            return e;
        } else if (n.kind == "eqz") {
            let e = new CBinary();
            e.operator = "==";
            e.lExpr = this.emitExpr(n.type, n.args[0]);
            e.rExpr = new CConst("0");
            return e;
        } else if (n.kind == "neg") {
            let e = new CUnary();
            e.operator = "-";
            e.expr = this.emitExpr(n.type, n.args[0]);
            return e;
        } else if (n.kind == "abs") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("abs_f32");
            } else {
                c.funcExpr = new CConst("abs_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            return c;
        } else if (n.kind == "sqrt") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("sqrt_f32");
            } else {
                c.funcExpr = new CConst("sqrt_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            return c;
        } else if (n.kind == "ceil") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("ceil_f32");
            } else {
                c.funcExpr = new CConst("ceil_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            return c;
        } else if (n.kind == "floor") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("floor_f32");
            } else {
                c.funcExpr = new CConst("floor_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            return c;
        } else if (n.kind == "trunc") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("trunc_f32");
            } else {
                c.funcExpr = new CConst("trunc_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            return c;
        } else if (n.kind == "nearest") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("nearest_f32");
            } else {
                c.funcExpr = new CConst("nearest_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            return c;
        } else if (n.kind == "min") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("min_f32");
            } else {
                c.funcExpr = new CConst("min_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            c.args.push(this.emitExpr(n.type, n.args[1]));
            return c;
        } else if (n.kind == "max") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("max_f32");
            } else {
                c.funcExpr = new CConst("max_f64");
            }
            c.args.push(this.emitExpr(n.type, n.args[0]));
            c.args.push(this.emitExpr(n.type, n.args[1]));
            return c;
        } else if (n.kind == "div_s" || n.kind == "shr_s" || n.kind == "rem_s" || n.kind == "lt_s" || n.kind == "gt_s" || n.kind == "le_s" || n.kind == "ge_s") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CBinary();
            e.operator = this.operatorMap.get(n.kind);
            e.lExpr = this.emitExpr(n.type, n.args[0]);
            let a = n.args[0];
            if ((a instanceof Node || a instanceof Variable) && !this.isSignedType(a.type)) {
                let t = new CTypeCast();
                t.type = this.mapToSignedType(a.type);
                t.expr = e.lExpr;
                e.lExpr = t;
            }
            e.rExpr = this.emitExpr(n.type, n.args[1]);
            return e;            
        } else if (n.kind == "div_u" || n.kind == "shr_u" || n.kind == "rem_u" || n.kind == "lt_u" || n.kind == "gt_u" || n.kind == "le_u" || n.kind == "ge_u") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CBinary();
            e.operator = this.operatorMap.get(n.kind);
            e.lExpr = this.emitExpr(n.type, n.args[0]);
            let a = n.args[0];
            if ((a instanceof Node || a instanceof Variable) && this.isSignedType(a.type)) {
                let t = new CTypeCast();
                t.type = this.mapToUnsignedType(a.type);
                t.expr = e.lExpr;
                e.lExpr = t;
            }
            e.rExpr = this.emitExpr(n.type, n.args[1]);
            return e;            
        } else if (n.kind == "wrap" || n.kind == "extend") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CTypeCast();
            e.type = this.mapType(n.type);
            e.expr = this.emitExpr(n.type, n.args[0]);
            return e;
        } else if (n.kind == "convert32_s" || n.kind == "convert32_u" || n.kind == "convert64_s" || n.kind == "convert64_u") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CTypeCast();
            e.type = this.mapType(n.type);
            e.expr = this.emitExpr(n.type, n.args[0]);
            return e;            
        } else if (n.kind == "alloc") {
            let t = this.mapType(n.type);
            let m = new CFunctionCall();
            m.funcExpr = new CConst("malloc");
            let sizeof = new CUnary();
            sizeof.operator = "sizeof";
            sizeof.expr = new CConst(t.code);
            let size = new CBinary();            
            size.operator = "*";            
            size.lExpr = sizeof
            size.rExpr = this.emitExpr("sint", n.args[0]);
            m.args = [size];
            let e = new CTypeCast();            
            e.type = new CType("addr_t");
            e.expr = m;
            return e;
        } else if (n.kind == "free") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("free");
            m.args = [this.emitExpr("addr", n.args[0])];
            return m;
        }

        throw "Implementation error " + n.kind;
    }

    private emitCode(start: Node, end: Node | null, code: Array<CNode>): void {
        let n = start;
        for( ; n && n != end; ) {
            code.push(new CComment(n.toString("")));
            if (n.kind == "if") {
                if (n.type instanceof ssa.StructType) {
                    throw "Implementation error"
                }
                if (n.type instanceof ssa.FunctionType) {
                    throw "Implementation error"
                }
                let expr = this.emitExpr(n.type, n.args[0]);
                let s = new CIf(expr);
                code.push(s);
                this.emitCode(n.next[0], n.blockPartner, s.body);
                if (n.next[1]) {
                    let s2 = new CElse();
                    this.emitCode(n.next[1], n.blockPartner, s2.body);
                    s.elseClause = s2;
                }
                n = n.blockPartner.next[0];
            } else if (n.kind == "loop") {
                let b = "block" + this.blocks.size.toString();
                let s = new CLabel(b);
                this.blocks.set(n, b);
                code.push(s);
                this.blockStack.unshift(b);
                this.emitCode(n.next[0], n.blockPartner, code);
                this.blockStack.shift();
                code.push(new CComment("end of loop"));
                code.push(new CGoto(b));
                n = n.blockPartner.next[0];
            } else if (n.kind == "br") {
                code.push(new CGoto(this.blockStack[n.args[0] as number]));
                n = n.next[0];
            } else if (n.kind == "br_if") {
                let expr = this.emitExpr(n.type, n.args[0]);
                let s = new CIf(expr);
                s.body.push(new CGoto(this.blockStack[n.args[1] as number]));
                code.push(s);
                n = n.next[0];
            } else if (n.kind == "block") {
                let b = "block" + this.blocks.size.toString();
                this.blocks.set(n, b);
                this.blockStack.unshift(b);
                this.emitCode(n.next[0], n.blockPartner, code);
                this.blockStack.shift();
                code.push(new CComment("end of block"));                
                let s = new CLabel(b);
                code.push(s);
                n = n.blockPartner.next[0];
            } else if (n.kind == "yield") {
                throw "TODO";
            } else if (n.kind == "store") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                let expr = this.emitExpr(n.type, n.args[0]);
                let val = this.emitExpr(n.type, n.args[2]);
                if (n.args[1] != 0) {
                    let charExpr = new CTypeCast();
                    charExpr.expr = expr;
                    charExpr.type = new CType("char*");
                    let addExpr= new CBinary();
                    addExpr.operator = "+";
                    addExpr.lExpr = charExpr;
                    addExpr.rExpr = new CConst((n.args[1] as number).toString());
                    expr = addExpr;
                }
                let t = new CTypeCast();
                t.expr = expr;
                t.type = new CType(this.mapType(n.type) + "*");
                let e = new CUnary();
                e.operator = "*";
                e.expr = t;
                let a = new CBinary();
                a.operator = "=";
                a.lExpr = e;
                a.rExpr = val;
                code.push(a);
                n = n.next[0];
            } else if (n.kind == "spawn" || n.kind == "spawn_indirect") {
                throw "TODO";
            } else if (n.kind == "return") {
                if (n.type instanceof ssa.FunctionType) {
                    throw "Implementation error";
                }
                if (n.args.length == 0) {
                    if (this.returnVariables.length != 0) {
                        throw "return without a parameter, but function has a return type"
                    }
                    code.push(new CReturn());
                } else if (n.args.length == 1) {
                    if (this.returnVariables.length != 1) {
                        throw "return with one parameter, but function has no return type"
                    }
                    let r = new CReturn();
                    r.expr = this.emitExpr(this.returnVariables[0].type, n.args[0]);;
                    code.push(r);
                } else {
                    if (this.returnVariables.length != n.args.length) {
                        throw "number of return values does not match with return type"
                    }
                    let r = new CReturn();
                    for(let i = 0; i < n.args.length; i++) {
                        let t = this.returnVariables[i].type;
                        throw "TODO";
                    }
                    code.push(r);
                }
                n = n.next[0];
            } else if (n.kind == "trap") {
                let c = new CFunctionCall();
                c.funcExpr = new CConst("exit");
                c.args.push(new CConst("EXIT_FAILURE"));
                code.push(c);
                n = n.next[0];
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                n = n.next[0];
            } else if (n.kind == "end") {
                // Nothing to do
                n = n.next[0];
            } else {
                code.push(this.emitExpr(n.type, n));
                n = n.next[0];
            }
        }        
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
                this.returnVariables.push(n.assign);
                this.varStorage.set(n.assign, n.assign.name);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param") {
                let p = new CFunctionParameter();
                p.name = "v_" + n.assign.name;
                p.type = this.mapType(n.type);
                this.varStorage.set(n.assign, p.name);                
                this.currentFunction.func.parameters.push(p);
                this.parameterVariables.push(n.assign);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_var") {
                if (n.assign.readCount == 0 && n.assign.writeCount == 0) {
                    n = n.next[0];                
                    continue;
                }
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
        if (this.varStorage.has(v) || this.globalStorage.has(v)) {
            return;
        }
        if (v.isConstant) {
            return;
        }
        if (this.returnVariables.indexOf(v) != -1 || this.parameterVariables.indexOf(v) != -1) {
            return;
        }
        let name = v.name;
        if (name.substr(0, 1) == "%") {
            name = "nr_" + name.substr(1);
        } else {
            name = "v_" + name;
        }
        this.varStorage.set(v, name);
        this.localVariables.push(v);
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
    private blocks: Map<ssa.Node, string> = new Map<ssa.Node, string>();
    private blockStack: Array<string> = [];
    private operatorMap: Map<string, BinaryOperator> = new Map<string, BinaryOperator>();
    private returnVariables: Array<ssa.Variable>;
    private localVariables: Array<ssa.Variable>;
    private parameterVariables: Array<ssa.Variable>;
    private varStorage: Map<ssa.Variable, string>;
    private globalStorage: Map<ssa.Variable, string> = new Map<ssa.Variable, string>();
    private namedStructs: Map<string, ssa.StructType> = new Map<string, ssa.StructType>();
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
        str += this.elements.map(function(c: CStruct | CFunction | CVar | CComment | CType) {if (c instanceof CFunction) return c.toString(); else return c.toString() + ";"}).join("\n\n");
        return str;
    }

    public includes: Array<CInclude> = [];
    public elements: Array<CStruct | CFunction | CVar | CComment | CType> = [];
}

export abstract class CNode {
    public precedence(): number {
        return 0;
    }

    public abstract toString(indent: string): string;
}

export class CStruct extends CNode {
    public toString(indent: string = ""): string {
        return indent + "struct " + this.name + " {\n" + this.fields.map(function(c: CFunctionParameter) { return indent + "    " + c.toString()}).join("\n") + "\n" + indent + "}";
    }

    public name: string;
    public fields: Array<CFunctionParameter> = [];
}

export class CFunction extends CNode {
    public toString(indent: string = ""): string {
        let str = indent + this.returnType + " " + this.name + "(" + this.parameters.map(function(c: CFunctionParameter) { return c.toString()}).join(", ") + ") {\n";
        str += this.body.map(function(c: CNode) { return c.toString(indent + "    ") + ";"}).join("\n");
        return str + "\n" + indent + "}";
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
    public toString(indent: string = ""): string {
        if (this.expr) {
            return indent + "return " + this.expr.toString("");
        }
        return "return"
    }

    public expr?: CNode;
}

export class CUnary extends CNode {
    public toString(indent: string = ""): string {
        if (this.operator == "sizeof") {
            return indent + "sizeof(" + this.expr.toString("") + ")";
        }
        if (this.precedence() <= this.expr.precedence()) {            
            return indent + this.operator + (this.expr.toString(""));            
        }
        return indent + this.operator + this.expr.toString("");
    }

    public precedence(): number {
        switch (this.operator) {
        case "*":
        case "!":
        case "~":
        case "&":
        case "sizeof":
        case "--":
        case "++":
        case "-":
        case "+":
            return 2;
        }
    }

    public expr: CNode;
    public operator: "*" | "&" | "!" | "~" | "sizeof" | "--" | "++" | "+" | "-";
}

export class CBinary extends CNode {
    public toString(indent: string = ""): string {
        let str = indent;
        if (this.precedence() <= this.lExpr.precedence()) {
            str += "(" + this.lExpr.toString("") + ")";
        } else {
            str += this.lExpr;
        }
        str += " " + this.operator + " ";
        if (this.precedence() <= this.rExpr.precedence()) {
            str += "(" + this.rExpr.toString("") + ")";
        } else {
            str += this.rExpr;
        }
        return str;
    }

    public precedence(): number {
        switch (this.operator) {
        case ".":
        case "->":
            return 1;
        case "*":
        case "/":
        case "%":
            return 3;
        case "-":
        case "+":
            return 4;
        case "<<":
        case ">>":
            return 5;
        case "<":
        case ">":
        case "<=":
        case ">=":
            return 6;
        case "==":
        case "!=":
            return 7;
        case "&":
            return 8;
        case "^":
            return 9;
        case "|":
            return 10;
        case "&&":
            return 11;
        case "||":
            return 12;
        case "=":
        case "+=":
        case "-=":
        case "*=":
        case "/=":
        case "%=":
        case "<<=":
        case ">>=":
        case "&=":
        case "^=":
        case "|=":
            return 13;
        }
    }

    public lExpr: CNode;
    public rExpr: CNode;
    public operator: BinaryOperator
}

export class CFunctionCall extends CNode {
    public toString(indent: string = ""): string {
        let str: string = indent;
        if (this.precedence() <= this.funcExpr.precedence()) {
            str += "(" + this.funcExpr.toString("") + ")";
        } else {
            str += this.funcExpr.toString("");
        }
        str += "(" + this.args.map(function(c: CNode) { return c.toString("")}).join(", ") + ")";
        return str;
    }

    public precedence(): number {
        return 1;
    }

    public funcExpr: CNode;
    public args: Array<CNode> = [];
}

export class CTypeCast extends CNode {
    public toString(indent: string = ""): string {
        if (this.precedence() <= this.expr.precedence()) {
            return indent + "(" + this.type.toString() + ")(" + this.expr.toString("") + ")";
        }            
        return indent + "(" + this.type.toString() + ")" + this.expr.toString("");
    }

    public precedence(): number {
        return 2;
    }

    public type: CType;
    public expr: CNode;
}

export class CVar extends CNode {
    public toString(indent: string = ""): string {
        let str = indent + this.type.toString() + " " + this.name;
        if (this.initExpr) {
            str += " = " + this.initExpr.toString("");
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

    public toString(indent: string = ""): string {
        return indent + this.code;
    }

    public code: string;
}

export class CComment extends CNode {
    constructor(text: string) {
        super();
        this.text = text;
    }

    public toString(indent: string = ""): string {
        return indent + "/* " + this.text + " */";
    }

    public text: string;
}

export class CIf extends CNode {
    constructor(expr: CNode) {
        super();
        this.expr = expr;
    }

    public toString(indent: string = ""): string {
        let str = indent + "if (" + this.expr.toString("") + ") {\n" + this.body.map(function(c: CNode) { return c.toString(indent + "    ") + ";\n";}).join("") + indent + "}";
        if (this.elseClause) {
            str += " " + this.elseClause.toString(indent);
        }
        return str;
    }

    public expr: CNode;
    public body: Array<CNode> = [];
    public elseClause: CElse;
}

export class CElse extends CNode {
    public toString(indent: string = ""): string {
        return "else {\n" + this.body.map(function(c: CNode) { return c.toString(indent + "    ") + ";\n";}).join("") + indent + "}";
    }

    public body: Array<CNode> = [];
}

export class CLabel extends CNode {
    constructor(name: string) {
        super();
        this.name = name;
    }

    public toString(indent: string = ""): string {
        return indent + this.name + ":";
    }

    public name: string;
}

export class CGoto extends CNode {
    constructor(name: string) {
        super();
        this.name = name;
    }
    public toString(indent: string = ""): string {
        return indent + "goto " + this.name;
    }

    public name: string;
}

export class CCompoundLiteral extends CNode {    
    public toString(indent: string = ""): string {
        return indent + "{" + this.values.map(function (c: CNode) { return c.toString("")}).join(", ") + "}";
    }

    public precedence(): number {
        return 1;
    }

    public values: Array<CNode> = [];
}
