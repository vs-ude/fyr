import {Optimizer, Stackifier, StructType, FunctionType, Variable, Node} from "./ssa";
import {Package} from "./pkg";
import * as backend from "./backend";
import * as ssa from "./ssa"
import path = require("path");

export type BinaryOperator = "*" | "/" | "%" | "+" | "-" | "->" | "." | ">>" | "<<" | "<" | ">" | "<=" | ">=" | "==" | "!=" | "&" | "^" | "|" | "&&" | "||" | "=" | "+=" | "-=" | "/=" | "*=" | "%=" | "<<=" | ">>=" | "&=" | "^=" | "|=" | "[";

export class FunctionImport implements backend.FunctionImport {
    public getIndex(): number {
        return this.index
    }

    public isImported(): boolean {
        return true;
    }

    public index: number;
    public name: string;
    public pkg?: Package;
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
    constructor(pkg: Package) {
        this.pkg = pkg;
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

    public importFunction(name: string, from: string | Package, type: ssa.FunctionType): backend.FunctionImport {
        if (type.callingConvention == "native") {
            if (typeof(from) != "string") {
                throw "Implementation error";
            }
            let path = from;
            let isSystemPath = false;
            if (path[0] == '<') {
                isSystemPath = true;
                path = path.substr(1, path.length - 2);
            }
            if (!this.module.hasInclude(path, isSystemPath)) {
                let imp = new CInclude();
                imp.isSystemPath = isSystemPath;
                imp.path = path;
                this.module.includes.push(imp);
            }
        } else {
            if (!(from instanceof Package)) {
                throw "Implementation error";
            }
            let headerFile = from.pkgPath + ".h";
            if (!this.module.hasInclude(headerFile, false)) {
                let imp = new CInclude();
                imp.isSystemPath = false;
                imp.path = headerFile;
                this.module.includes.push(imp);
            }
        }
        let f = new FunctionImport();
        if (type.callingConvention == "native") {
            f.name = name;
        } else {
            f.name = this.mangleName((from as Package).pkgPath + "/" + name);
        }
        f.index = this.funcs.length;
        this.funcs.push(f);
        return f;
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

    public declareFunction(name: string): backend.Function {
        let f = new Function();
        f.name = name;
        f.func.returnType = new CType("void");
        f.index = this.funcs.length;
        this.funcs.push(f);
        return f;
    }

    public declareInitFunction(name: string): backend.Function {
        let f = new Function();
        f.name = name;
        f.func.returnType = new CType("void");
        f.index = this.funcs.length;
        this.initFunction = f;
        this.funcs.push(f);
        return f;
    }

    public getInitFunction(): Function {
        if (this.initFunction && this.initFunction.node.next.length == 0) {
            return null;
        }
        return this.initFunction;
    }

    public defineFunction(n: ssa.Node, f: backend.Function, isExported: boolean) {
        if (!(f instanceof Function)) {
            throw "Implementation error";
        }        
        let name = f.name;
        if (this.pkg.pkgPath) {
            name = this.pkg.pkgPath + "/" + name;
        }
        name = this.mangleName(name);
        if (f == this.initFunction) {
            f.func.name = "s_" + name;
        } else if (isExported && f.name == "main") {
            this.mainFunction = f;
            f.func.name = "f_" + name;        
            f.isExported = true;
        } else if (isExported) {
            f.func.name = name;
            f.isExported = true;
        } else {
            f.func.name = "f_" + name;
        }
        f.node = n;
    }

    private mangleName(name: string): string {        
        name = name.replace(/_/g, "_u");
        name = name.replace(/\./g, "__");
        name = name.replace(/</g, "_l");
        name = name.replace(/>/g, "_g");
        name = name.replace(/,/g, "_c");
        name = name.replace(/\//g, "_");
        return name;
    }

    public generateModule(emitIR: boolean, initPackages: Array<Package> | null): string {
        let ircode = "";

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
            if (v.isConstant) {
                cv.type = new CType("const " + cv.type.code);
                cv.initExpr = this.emitExprIntern(v, true);
            }
            this.module.elements.push(cv);
        }

        for(let f of this.funcs) {
            if (f instanceof FunctionImport) {
                continue;
            }
            // Do not generate empty init functions
            if (f == this.initFunction && f.node.next.length == 0) {
                continue;
            }
            this.optimizer.optimizeConstants(f.node);
            if (emitIR) {
                ircode += '============ OPTIMIZED Constants ===============\n';
                ircode += Node.strainToString("", f.node) + "\n";
            }

            this.optimizer.removeDeadCode(f.node);
            if (emitIR) {
                ircode += '============ OPTIMIZED Dead code ===============\n';
                ircode += Node.strainToString("", f.node) + "\n";
            }

            this.currentFunction = f;
            this.returnVariables = [];
            this.localVariables = [];
            this.parameterVariables = [];
            this.varStorage = new Map<ssa.Variable, string>();
            this.stackifier.stackifyStep(f.node, null);

            if (emitIR) {
                ircode += '============ STACKIFIED code ===============\n';
                ircode += Node.strainToString("", f.node) + "\n";
            }

            this.analyzeVariableStorage(f.node, f.node.blockPartner);

            let code: Array<CNode> = [];

            for(let v of this.localVariables) {
                // Ignore variables which are neither read nor written
                if (v.readCount == 0 && v.writeCount == 0) {
                    continue;
                }
                let cv = new CVar();
                cv.type = this.mapType(v.type);
                cv.name = this.varStorage.get(v);
                if (v.isConstant) {
                    cv.type = new CType("static " + cv.type.code);
                    cv.initExpr = this.emitExprIntern(v, true);
                }
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

        if (this.mainFunction) {
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

            // Call the init function
            if (this.initFunction && this.initFunction.node.next.length != 0) {
                let call = new CFunctionCall();
                call.funcExpr = new CConst(this.initFunction.func.name);
                main.body.push(call);
            }

            // Call the init function of imported packages
            if (initPackages) {
                for (let p of initPackages) {
                    let name = "init";
                    if (!p.pkgPath) {
                        throw "Implementation error";
                    }
                    name = p.pkgPath + "/" + name;                    
                    name = this.mangleName(name);
                    name = "s_" + name;
                    let call = new CFunctionCall();
                    call.funcExpr = new CConst(name);
                    main.body.push(call);                
                }
            }

            let call = new CFunctionCall();
            call.funcExpr = new CConst(this.mainFunction.func.name);
            let r = new CReturn();
            r.expr = call;
            main.body.push(r);
            this.module.elements.push(main);
        }

        return ircode;
    }

    public addFunctionToTable(f: Function, index: number) {
        throw "TODO";
    }

    public getImplementationCode(): string {
        return this.module.getImplementationCode(this.pkg);
    }

    public getHeaderCode(): string {
        return this.module.getHeaderCode(this.pkg);
    }

    private mapType(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType, cstyle: boolean = false): CType {
        if (t instanceof ssa.StructType) {
            if (t.name) {
                if (!this.namedStructs.has(t.name)) {
                    this.namedStructs.set(t.name, t);
                }
                return new CType("struct " + t.name);
            }
            let str = " {\n" + t.fields.map((c: [string, ssa.Type | ssa.StructType, number], i: number) => {
                let t = this.mapType(c[1], cstyle).toString();
                if (c[2] > 1) {
                    return "    " + t + " field" + i.toString() + "[" + c[2].toString() + "];\n"
                }
                return "    " + this.mapType(c[1], cstyle).toString() + " field" + i.toString() + ";\n";
            }).join("") + "}";
            if (this.anonymousStructs.has(str)) {
                return new CType("struct " + this.anonymousStructs.get(str));
            }
            let name = "ta_struct" + this.anonymousStructs.size.toString();
            this.anonymousStructs.set(str, name);
            str = "struct " + name + str;
            this.module.elements.unshift(new CType(str));
            return new CType("struct " + name);
        }
        if (t instanceof ssa.PointerType) {
            if (cstyle) {
                if (t.isConst) {
                    return new CType("const void*");                    
                }
                return new CType("void*");
            }
            return new CType("addr_t");
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
                return new CType("int_t");
        }
        throw "Implementation error";
    }

    private mapToSignedType(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType): CType {
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
            case "int":
                return new CType("int_t");
        }
        throw "Implementation error";
    }

    private mapToUnsignedType(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType): CType {
        switch(t) {
            case "s8":
                return new CType("uint8_t");
            case "s16":
                return new CType("uint16_t");
            case "s32":
                return new CType("uint32_t");
            case "s64":
                return new CType("uint64_t");
            case "sint":
                return new CType("uint_t");
        }
        throw "Implementation error";
    }

    private isSignedType(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType): boolean {
        return t == "s8" || t == "s16" || t == "s32" || t == "s64" || t == "sint";
    }

    private emitExpr(n: number | string | ssa.Variable | ssa.Node): CNode {
        let c = this.emitExprIntern(n);
        if (n instanceof ssa.Node && n.assign && (n.assign.readCount != 0 || n.assign.writeCount != 0)) {
            let e = new CBinary();
            e.operator = "=";
            e.lExpr = this.emitExprIntern(n.assign);
            e.rExpr = c;
            return e;    
        }
        return c;
    }

    // TODO: Remove tx
    private emitExprIntern(n: number | string | ssa.Variable | ssa.Node, generateConstants: boolean = false): CNode {
        if (typeof(n) == "number") {
            return new CConst(n.toString());
        }
        if (typeof(n) == "string") {
            let s = this.module.addString(n);
            let addr = new CUnary();
            addr.operator = "&";
            let member = new CBinary();
            member.operator = ".";
            member.lExpr = new CConst(s.name);
            member.rExpr = new CConst("data");
            let arr = new CBinary();
            arr.operator = "[";
            arr.lExpr = member;
            arr.rExpr = new CConst("0");
            addr.expr = arr;
            return addr;
        }
        if (n instanceof ssa.Variable) {
            if (this.globalStorage && this.globalStorage.has(n) && !generateConstants) {
                let name = this.globalStorage.get(n);
                return new CConst(name);                    
            }
            if (this.varStorage && this.varStorage.has(n) && !generateConstants) {
                let name = this.varStorage.get(n);
                return new CConst(name);
            }
            if (n.isConstant && typeof(n.constantValue) == "string") {
                return this.emitExprIntern(n.constantValue);
            } else if (n.isConstant && typeof(n.constantValue) == "number") {
                return this.emitExprIntern(n.constantValue);
            } else if (n.isConstant) {
                if (!(n.type instanceof StructType)) {
                    throw "Implementation error"
                }
                let t = new CTypeCast();
                t.type = this.mapType(n.type);
                let l = new CCompoundLiteral();
                for(let a of (n.constantValue as ssa.BinaryData)) {
                    l.values.push(this.emitExpr(a));
                }
                t.expr = l;
                return t;
            }

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
            e.expr = this.emitExpr(n.args[0]);
            let t = new CTypeCast();
            t.type = new CType("addr_t");
            t.expr = e;
            return t;
        } else if (n.kind == "load") {
            if (n.type instanceof FunctionType) {
                throw "Implementation error"
            }
            let expr = this.emitExpr(n.args[0]);
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
            if (typeof(n.args[0]) == "number") {
                let t = new CTypeCast();
                t.type = this.mapType(n.type);
                t.expr = new CConst((n.args[0] as number).toString());
                return t;
            }
            return this.emitExpr(n.args[0]);
        } else if (n.kind == "call") {
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error"
            }
            let c = new CFunctionCall();
            let f = this.funcs[n.args[0] as number];
            if (f instanceof FunctionImport) {
                c.funcExpr = new CConst(f.name);
            } else {
                c.funcExpr = new CConst(f.func.name);
            }
            for(let i = 1; i < n.args.length; i++) {
                let a = n.args[i];
                let e = this.emitExpr(a);
                if (f instanceof FunctionImport) {
                    let ctype = this.mapType(n.type.params[i-1], true);
                    let fyrtype = this.mapType(n.type.params[i-1]);
                    if (ctype != fyrtype) {
                        let tcast = new CTypeCast();
                        tcast.type = ctype;
                        tcast.expr = e;
                        e = tcast;
                    }
                }
                c.args.push(e);
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
            return this.emitExpr(n.args[0]);
        } else if (n.kind == "struct") {
            if (!(n.type instanceof StructType)) {
                throw "Implementation error"
            }
            let t = new CTypeCast();
            t.type = this.mapType(n.type);
            let l = new CCompoundLiteral();
            for(let a of n.args) {
                l.values.push(this.emitExpr(a));
            }
            t.expr = l;
            return t;
        } else if (n.kind == "add" || n.kind == "sub" || n.kind == "mul" || n.kind == "div" || n.kind == "eq" || n.kind == "ne" || n.kind == "or" || n.kind == "xor" || n.kind == "and" || n.kind == "shl" || n.kind == "lt" || n.kind == "gt" || n.kind == "le" || n.kind == "ge") {
            let e = new CBinary();
            e.operator = this.operatorMap.get(n.kind);
            e.lExpr = this.emitExpr(n.args[0]);
            e.rExpr = this.emitExpr(n.args[1]);
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
            e.lExpr = this.emitExpr(n.args[0]);
            e.rExpr = new CConst("0");
            return e;
        } else if (n.kind == "neg") {
            let e = new CUnary();
            e.operator = "-";
            e.expr = this.emitExpr(n.args[0]);
            return e;
        } else if (n.kind == "abs") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("fabsf");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("fabs");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "sqrt") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("sqrtf");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("sqrt");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "copysign") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("copysignf");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("copysign");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "ceil") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("ceilf");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("ceil");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "floor") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("floorf");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("floor");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "trunc") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("trunc_f32");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("trunc_f64");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "nearest") {
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("roundf");
            } else if (n.type == "f64") {
                c.funcExpr = new CConst("round");
            } else {
                throw "Implementation error";
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "min") {
            if (n.type != "f32" && n.type != "f64") {
                let c = new CTypeCast();
                c.type = this.mapType(n.type);
                let call = new CFunctionCall();
                call.funcExpr = new CConst("fyr_min");
                call.args.push(this.emitExpr(n.args[0]));
                call.args.push(this.emitExpr(n.args[1]));
                c.expr = call;
                return c;
            }
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("fminf");
            } else {
                c.funcExpr = new CConst("fmin");
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            c.args.push(this.emitExpr(n.args[1]));
            return c;
        } else if (n.kind == "max") {
            if (n.type != "f32" && n.type != "f64") {
                let c = new CTypeCast();
                c.type = this.mapType(n.type);
                let call = new CFunctionCall();
                call.funcExpr = new CConst("fyr_max");
                call.args.push(this.emitExpr(n.args[0]));
                call.args.push(this.emitExpr(n.args[1]));
                c.expr = call;
                return c;
            }
            let c = new CFunctionCall();
            if (n.type == "f32") {
                c.funcExpr = new CConst("fmaxf");
            } else {
                c.funcExpr = new CConst("fmax");
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            c.args.push(this.emitExpr(n.args[1]));
            return c;
        } else if (n.kind == "popcnt") {
            let c = new CFunctionCall();
            // TODO: Non-standard. What about longs?
            c.funcExpr = new CConst("__builtin_popcount");
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "clz") {
            let c = new CFunctionCall();
            // TODO: Non-standard. What about longs?
            // TODO: This should be sign agnostic
            c.funcExpr = new CConst("__builtin_clz");
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "ctz") {
            let c = new CFunctionCall();
            // TODO: Non-standard. What about longs?
            // TODO: This should be sign agnostic
            c.funcExpr = new CConst("__builtin_ctz");
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "div_s" || n.kind == "shr_s" || n.kind == "rem_s" || n.kind == "lt_s" || n.kind == "gt_s" || n.kind == "le_s" || n.kind == "ge_s") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CBinary();
            e.operator = this.operatorMap.get(n.kind);
            e.lExpr = this.emitExpr(n.args[0]);
            let a = n.args[0];
            if ((a instanceof Node || a instanceof Variable) && !this.isSignedType(a.type)) {
                let t = new CTypeCast();
                t.type = this.mapToSignedType(a.type);
                t.expr = e.lExpr;
                e.lExpr = t;
            }
            e.rExpr = this.emitExpr(n.args[1]);
            a = n.args[1];
            if ((a instanceof Node || a instanceof Variable) && !this.isSignedType(a.type)) {
                let t = new CTypeCast();
                t.type = this.mapToSignedType(a.type);
                t.expr = e.rExpr;
                e.rExpr = t;
            }
            return e;            
        } else if (n.kind == "div_u" || n.kind == "shr_u" || n.kind == "rem_u" || n.kind == "lt_u" || n.kind == "gt_u" || n.kind == "le_u" || n.kind == "ge_u") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }
            let e = new CBinary();
            e.operator = this.operatorMap.get(n.kind);
            e.lExpr = this.emitExpr(n.args[0]);
            let a = n.args[0];
            if ((a instanceof Node || a instanceof Variable) && this.isSignedType(a.type)) {
                let t = new CTypeCast();
                t.type = this.mapToUnsignedType(a.type);
                t.expr = e.lExpr;
                e.lExpr = t;
            }
            e.rExpr = this.emitExpr(n.args[1]);
            a = n.args[1];
            if ((a instanceof Node || a instanceof Variable) && this.isSignedType(a.type)) {
                let t = new CTypeCast();
                t.type = this.mapToUnsignedType(a.type);
                t.expr = e.rExpr;
                e.rExpr = t;
            }
            return e;            
        } else if (n.kind == "wrap" || n.kind == "extend") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CTypeCast();
            e.type = this.mapType(n.type);
            e.expr = this.emitExpr(n.args[0]);
            return e;
        } else if (n.kind == "convert32_s" || n.kind == "convert32_u" || n.kind == "convert64_s" || n.kind == "convert64_u") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw "Implementation error"
            }            
            let e = new CTypeCast();
            e.type = this.mapType(n.type);
            e.expr = this.emitExpr(n.args[0]);
            return e;            
        } else if (n.kind == "alloc") {
            let t = this.mapType(n.type);
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_alloc");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "free") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_free");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "decref") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_decref");
            if (typeof(n.args[1]) != "number") {
                throw "Implementation error";
            }
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw "Implementation error";
                }
                m.args = [this.emitExpr(n.args[0]), new CConst(f.func.name)];
            }
            return m;
        } else if (n.kind == "incref") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_incref");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "alloc_arr") {
            let t = this.mapType(n.type);
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_alloc_arr");
            m.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1])];
            return m;
        } else if (n.kind == "free_arr") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_free_arr");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "decref_arr") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_decref_arr");
            if (typeof(n.args[1]) != "number") {
                throw "Implementation error";
            }
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw "Implementation error";
                }
                m.args = [this.emitExpr(n.args[0]), new CConst(f.func.name)];
            }
            return m;
        } else if (n.kind == "incref_arr") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_incref_arr");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "member") {
            let m = new CBinary();
            m.operator = ".";
            let s = n.args[0];
            if (!(s instanceof ssa.Variable) && !(s instanceof ssa.Node)) {
                throw "Implementation error";
            }
            let idx = n.args[1];
            if (typeof(idx) != "number") {
                throw "Implementation error";
            }
            let t = s.type;
            if (!(t instanceof ssa.StructType) || t.fields.length <= idx) {
                throw "Implementation error";
            }
            m.lExpr = this.emitExpr(n.args[0]);
            m.rExpr = new CConst(t.fieldNameByIndex(idx));
            return m;
        } else if (n.kind == "len_arr") {
            let call = new CFunctionCall();
            call.funcExpr = new CConst("fyr_len_arr");
            call.args = [this.emitExpr(n.args[0])];
            return call;
        } else if (n.kind == "len_str") {
            let v = n.args[0];
            if (v instanceof ssa.Variable && v.isConstant && typeof(v.constantValue) == "string") {
                return new CConst(CString.toUTF8Array(v.constantValue).length.toString());
            }
            let call = new CFunctionCall();
            call.funcExpr = new CConst("fyr_len_str");
            call.args = [this.emitExpr(v)];
            return call;
        } else if (n.kind == "memcmp") {
            let call = new CFunctionCall();
            call.funcExpr = new CConst("memcmp");
            call.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1]), this.emitExpr(n.args[2])];
            this.includeStringHeaderFile();
            return call;
        }
        throw "Implementation error " + n.kind;
    }

    private includeMathHeaderFile() {
        if (!this.module.hasInclude("math.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "math.h";
            this.module.includes.push(inc);
        }
    }

    private includeStringHeaderFile() {
        if (!this.module.hasInclude("string.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "string.h";
            this.module.includes.push(inc);
        }
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
                let expr = this.emitExpr(n.args[0]);
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
//                code.push(new CGoto(b));
                n = n.blockPartner.next[0];
            } else if (n.kind == "br") {
                code.push(new CGoto(this.blockStack[n.args[0] as number]));
                n = n.next[0];
            } else if (n.kind == "br_if") {
                let expr = this.emitExpr(n.args[0]);
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
                let expr = this.emitExpr(n.args[0]);
                let val = this.emitExpr(n.args[2]);
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
                } else { //} if (n.args.length == 1) {
//                    if (this.returnVariables.length != 1) {
//                        throw "return with one parameter, but function has no return type"
//                    }
                    let r = new CReturn();
                    r.expr = this.emitExpr(n.args[0]);;
                    code.push(r);
/*                } else {
                    if (this.returnVariables.length != n.args.length) {
                        throw "number of return values does not match with return type"
                    }
                    let r = new CReturn();
                    for(let i = 0; i < n.args.length; i++) {
                        let t = this.returnVariables[i].type;
                        throw "TODO";
                    }
                    code.push(r); */
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
            } else if (n.kind == "memcpy") {
                let call = new CFunctionCall();
                call.funcExpr = new CConst("memcpy");
                let size = new CBinary();
                size.operator = "*";
                size.lExpr = this.emitExpr(n.args[2]);
                size.rExpr = this.emitExpr(n.args[3]);
                call.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1]), size];
                this.includeStringHeaderFile();
                code.push(call);
                n = n.next[0];
            } else if (n.kind == "memmove") {
                let call = new CFunctionCall();
                call.funcExpr = new CConst("memmove");
                let size = new CBinary();
                size.operator = "*";
                size.lExpr = this.emitExpr(n.args[2]);
                size.rExpr = this.emitExpr(n.args[3]);
                call.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1]), size];
                this.includeStringHeaderFile();
                code.push(call);
                n = n.next[0];
            } else if (n.kind == "set_member") {
                let m = new CBinary();
                m.operator = ".";
                let s = n.args[0];
                if (!(s instanceof ssa.Variable) && !(s instanceof ssa.Node)) {
                    throw "Implementation error";
                }
                let idx = n.args[1];
                if (typeof(idx) != "number") {
                    throw "Implementation error";
                }
                let t = s.type;
                if (!(t instanceof ssa.StructType) || t.fields.length <= idx) {
                    throw "Implementation error";
                }
                m.lExpr = this.emitExpr(n.args[0]);
                m.rExpr = new CConst(t.fieldNameByIndex(idx));
                let assign = new CBinary();
                assign.operator = "=";
                assign.lExpr = m;
                assign.rExpr = this.emitExpr(n.args[2]);
                code.push(assign);
                n = n.next[0];
            } else {
                code.push(this.emitExpr(n));
                n = n.next[0];
            }
        }        
    }

    private analyzeVariableStorage(start: Node, end: Node) {
        let resultTypes: Array<[string, ssa.Type | ssa.StructType]> = [];
        let n = start;
        for(; n; ) {
            // Ignore decl_var here. These variables get storage when they are assigned.
            // Parameters and result variables, however, need storage even if they are not being assigned.
            if (n.kind == "decl_result") {
                if (n.assign.name == "$return") {
                    this.currentFunction.func.returnType = this.mapType(n.type);
                } else {
                    resultTypes.push([n.assign.name, n.type as ssa.Type | ssa.StructType]);
                    this.assignVariableStorage(n.assign);
                }
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
                this.assignVariableStorage(n.assign);
            }
            for(let v of n.args) {
                if (v instanceof Variable) {
                    this.assignVariableStorage(v);
                } else if (v instanceof Node) {
                    this.analyzeVariableStorage(v, null);
                }
            }
            if (n.kind == "if" && n.next.length > 1) {
                this.analyzeVariableStorage(n.next[1], n.blockPartner);
                n = n.next[0];
            } else {
                n = n.next[0];                
            }
        }
        if (resultTypes.length != 0) {
            let s = new ssa.StructType;
            for(let r of resultTypes) {
                s.addField(r[0], r[1]);
            }
            this.currentFunction.func.returnType = this.mapType(s);
        }            
    }

    private assignVariableStorage(v: Variable): void {
        if (v.name == "$mem") {
            return;
        }
        if (this.varStorage.has(v) || this.globalStorage.has(v)) {
            return;
        }
        if (this.parameterVariables.indexOf(v) != -1) {
            return;
        }
        let name = v.name;
        if (name.substr(0, 1) == "%" && !v.isConstant) {
            name = "nr_" + name.substr(1);
        } else if (v.isConstant) {
            if (typeof(v.constantValue) == "string" || typeof(v.constantValue) == "number") {
                return;
            }    
            name = "s_" + name;
        } else {
            name = "v_" + name;
        }
        this.varStorage.set(v, name);
        this.localVariables.push(v);
    }

    public hasMainFunction(): boolean {
        return !!this.mainFunction;
    }

    private pkg: Package;
    private optimizer: Optimizer;
    private stackifier: Stackifier;
    private module: CModule;
    private initFunction: Function;
    private mainFunction: Function;
    private globalVariables: Array<ssa.Variable> = [];
    private funcs: Array<Function | FunctionImport> = [];
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
    private anonymousStructs: Map<string, string> = new Map<string, string>();
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
    public getImplementationCode(pkg: Package): string {
        let headerFile: string;
        if (pkg.pkgPath) {
            headerFile = pkg.pkgPath + ".h";
        } else {
            headerFile = path.join(pkg.objFilePath, pkg.objFileName + ".h");
        }
        let str = "#include \"" + headerFile + "\"\n";
        str += "\n";     
        for(let s of this.strings.values()) {
            str += s.toString() + "\n\n";
        }
        this.elements.forEach(function(c: CStruct | CFunction | CVar | CComment | CType) {if (c instanceof CType) { } else if (c instanceof CFunction) str += c.toString() + "\n\n"; else str += c.toString() + ";\n\n"});
        return str;
    }

    public getHeaderCode(pkg: Package): string {
        let mangledName = pkg.pkgPath;
        let str: string = "";
        if (mangledName) {
            mangledName = mangledName.replace(/\//g, "_").toUpperCase() + "_H";
            str += "#ifndef " + mangledName + "\n";
            str += "#define " + mangledName + "\n\n";
        }

        str += this.includes.map(function(c: CInclude) { return c.toString()}).join("\n") + "\n\n";
        this.elements.forEach(function(c: CStruct | CFunction | CVar | CComment | CType) {if (c instanceof CType) str += c.toString() + ";\n\n";});
        this.elements.forEach(function(c: CStruct | CFunction | CVar | CComment | CType) {if (c instanceof CFunction) str += c.declaration() + "\n";});

        if (mangledName) {
            str += "\n#endif\n";
        }
        return str;
    }

    public hasInclude(path: string, isSystemPath: boolean): boolean {
        for(let inc of this.includes) {
            if (inc.path == path && inc.isSystemPath == isSystemPath) {
                return true;
            }
        }
        return false;
    }

    public addString(str: string): CString {
        if (this.strings.has(str)) {
            return this.strings.get(str);
        }
        let s = new CString(str);
        this.strings.set(str, s);
        return s;        
    }

    public includes: Array<CInclude> = [];
    public strings: Map<string, CString> = new Map<string, CString>();
    public elements: Array<CStruct | CFunction | CVar | CComment | CType> = [];
}

export abstract class CNode {
    public precedence(): number {
        return 0;
    }

    public abstract toString(indent: string): string;
}

export class CString extends CNode {
    constructor(str: string) {
        super();
        this.name = "str_" + CString.counter.toString();
        CString.counter++;
        this.bytes = CString.toUTF8Array(str);
        // Add trailing zero for C-compatibility
        this.bytes.push(0);
    }

    public toString(indent: string = ""): string {
        let str = indent + "struct {\n" + indent + "    int_t refcount;\n" + indent + "    int_t size;\n" + indent + "    uint8_t data[" + this.bytes.length + "];\n" + indent + "} " + this.name + " = {1, " + this.bytes.length;
        if (this.bytes.length != 0) {
            str += ",";
        }
        str += this.bytes.map(function(val: number) { return val.toString();}).join(",");
        return str + "};";
    }

    private static counter: number = 0;

    public static toUTF8Array(str: string): Array<number> {
        var utf8: Array<number> = [];
        for (var i = 0; i < str.length; i++) {
            var charcode = str.charCodeAt(i);
            if (charcode < 0x80) utf8.push(charcode);
            else if (charcode < 0x800) {
                utf8.push(0xc0 | (charcode >> 6), 
                          0x80 | (charcode & 0x3f));
            }
            else if (charcode < 0xd800 || charcode >= 0xe000) {
                utf8.push(0xe0 | (charcode >> 12), 
                          0x80 | ((charcode>>6) & 0x3f), 
                          0x80 | (charcode & 0x3f));
            }
            // surrogate pair
            else {
                i++;
                // UTF-16 encodes 0x10000-0x10FFFF by
                // subtracting 0x10000 and splitting the
                // 20 bits of 0x0-0xFFFFF into two halves
                charcode = 0x10000 + (((charcode & 0x3ff)<<10)
                          | (str.charCodeAt(i) & 0x3ff))
                utf8.push(0xf0 | (charcode >>18), 
                          0x80 | ((charcode>>12) & 0x3f), 
                          0x80 | ((charcode>>6) & 0x3f), 
                          0x80 | (charcode & 0x3f));
            }
        }
        return utf8;
    }

    public bytes: Array<number>;
    public name: string;
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

    public declaration(): string {
        return this.returnType + " " + this.name + "(" + this.parameters.map(function(c: CFunctionParameter) { return c.toString()}).join(", ") + ");";
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
        if (this.operator == ".") {
            str += ".";
        } else if (this.operator == "[") {
            str += "[";
        } else {
            str += " " + this.operator + " ";
        }
        if (this.precedence() <= this.rExpr.precedence()) {
            str += "(" + this.rExpr.toString("") + ")";
        } else {
            str += this.rExpr;
        }
        if (this.operator == "[") {
            str += "]";
        }
        return str;
    }

    public precedence(): number {
        switch (this.operator) {
        case "[":
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
