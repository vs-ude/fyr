import {Optimizer, Stackifier, StructType, FunctionType, Variable, Node} from "../ssa";
import {Package} from "../pkg";
import * as backend from "./backend";
import * as ssa from "../ssa"
import path = require("path");
import {createHash} from "crypto";
import { ImplementationError, TodoError } from '../errors'
import { FunctionParameter } from "../scope";

export type BinaryOperator = "*" | "/" | "%" | "+" | "-" | "->" | "." | ">>" | "<<" | "<" | ">" | "<=" | ">=" | "==" | "!=" | "&" | "^" | "|" | "&&" | "||" | "=" | "+=" | "-=" | "/=" | "*=" | "%=" | "<<=" | ">>=" | "&=" | "^=" | "|=" | "[";

export class FunctionImport implements backend.FunctionImport {
    public getIndex(): number {
        return this.index
    }

    public getName(): string {
        return this.name;
    }

    public isImported(): boolean {
        return true;
    }

    public index: number;
    // The C-name of the function
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

    public getName(): string {
        return this.name;
    }

    public isImported(): boolean {
        return false;
    }

    public index: number;
    // The name of the function (not the C-encoding of the name).
    public name: string;
    public func: CFunction;
    public node: ssa.Node;
    public isExported: boolean;
}

export class InterfaceDescriptor {
    name: CConst;
    // A list of C-encoded function names which make up the table.
    table: Array<CConst>;
}

export class CBackend implements backend.Backend {
    constructor(pkg: Package) {
        this.pkg = pkg;
        this.optimizer = new Optimizer();
        this.stackifier = new Stackifier();
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

    private importPackage(from: string | Package) {
        if (typeof(from) == "string") {
            let paths = from.split(",");
            for(let path of paths) {
                path = path.trim()
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
            }
        } else {
            if (!(from instanceof Package)) {
                throw new ImplementationError()
            }
            let headerFile = from.pkgPath + ".h";
            if (!this.module.hasInclude(headerFile, false)) {
                let imp = new CInclude();
                imp.isSystemPath = false;
                imp.path = headerFile;
                this.module.includes.push(imp);
            }
        }
    }

    public importFunction(name: string, from: string | Package, type: ssa.FunctionType): backend.FunctionImport {
        this.importPackage(from);
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

    public importGlobalVar(name: string, type: ssa.Type | ssa.StructType, from: string | Package): ssa.Variable {
        this.importPackage(from);
        if (from instanceof Package) {
            name = "g_" + this.mangleName(from.pkgPath + "/" + name);
        } else {
            // An imported native variable. Use its name without mangling it.
        }
        let v = new Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;
        this.globalVariables.push(v);
        this.globalStorage.set(v, v.name);
        this.importedGlobalVariables.set(v, from);
        return v;
    }

    public declareGlobalVar(name: string, type: ssa.Type | ssa.StructType): ssa.Variable {
        name = "g_" + this.mangleName(this.pkg.pkgPath + "/" + name);
        let v = new Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;
        this.globalVariables.push(v);
        this.globalStorage.set(v, v.name);
        return v;
    }

    public declareFunction(name: string | null): backend.Function {
        let f = new Function();
        f.name = name == null ? "f" + (this.funcs.length + 1).toString() : name;
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

    public defineFunction(n: ssa.Node, f: backend.Function, isExported: boolean, isPossibleDuplicate: boolean) {
        if (!(f instanceof Function)) {
            throw new ImplementationError()
        }
        f.func.isPossibleDuplicate = isPossibleDuplicate;
        let name = f.name;
        if (!isPossibleDuplicate) {
            if (this.pkg.pkgPath) {
                name = this.pkg.pkgPath + "/" + name;
            }
        }
        name = this.mangleName(name);
        if (f == this.initFunction) {
            f.func.name = "s_" + name;
        } else if (isExported && f.name == "main") {
            this.mainFunction = f;
            f.func.name = "f_" + name;
            f.isExported = true;
            this.module.isExecutable = true;
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
        name = name.replace(/\*/g, "_s");
        name = name.replace(/\^/g, "_u");
        name = name.replace(/\~/g, "_r");
        name = name.replace(/\&/g, "_R");
        name = name.replace(/\[/g, "_o");
        name = name.replace(/\]/g, "_c");
        name = name.replace(/\(/g, "_O");
        name = name.replace(/\)/g, "_C");
        name = name.replace(/ /g, "_");
        return name;
    }

    public generateModule(emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string {
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

        // Include the header files of all packages that need to run their initializer or that contain possibly duplicated code.
        if (initPackages) {
            for(let p of initPackages) {
                this.includePackageHeaderFile(p);
            }
        }
        if (duplicateCodePackages) {
            for(let p of duplicateCodePackages) {
                this.includePackageHeaderFile(p);
            }
        }

        // Initialize all global variables
        for(let v of this.globalVariables) {
            let cv = new CVar();
            cv.name = v.name;
            cv.type = this.mapType(v.type);
            if (v.isConstant) {
                cv.type = new CType("const " + cv.type.code);
                cv.initExpr = this.emitExprIntern(v, true);
            }
            // Ignore global variables located in other packages
            let from = this.importedGlobalVariables.get(v);
//            if (!from) {
//                this.module.elements.push(cv);
//            }
            // Export all global variables, because templates might need them.
            // For native variables however, do nothing.
            if (!from || from instanceof Package) {
                let exp = new CExtern(cv);
                this.module.elements.push(exp);
            }
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
                cv.type = this.mapType(v.type, false, v.needsRefCounting);
                cv.name = this.varStorage.get(v);
                if (v.isConstant) {
                    cv.type = new CType("static " + cv.type.code);
                    cv.initExpr = this.emitExprIntern(v, true);
                }
                code.push(cv);
            }

            /*
            if (f.isAsync()) {
                let implFunc: CFunction  = new CFunction();
                implFunc.returnType = new CType("int");
                let p = new CFunctionParameter();
                p.name = "state";
                p.type = new CType("void*");
                implFunc.parameters.push(p);
                implFunc.name = "impl_" + f.func.name;
                if (f.node.next[0]) {
                    this.currentCFunction = implFunc;
                    this.emitCode(f.node.next[0], null, code);
                    this.currentCFunction = null;
                }
                implFunc.body = code;
                this.module.elements.push(implFunc);

                let code2: Array<CNode> = [];
                // TODO: Return type
                f.func.returnType = new CType("int");
                f.func.body = code2;
                this.module.elements.push(f.func);

            } else {*/
            if (f.node.next[0]) {
                this.currentCFunction = f.func;
                this.emitCode(f.node.next[0], null, code);
                this.currentCFunction = null;
            }
            f.func.body = code;
            this.module.elements.push(f.func);
//            }
        }

        // Order the structs, such that all structs used by a field
        // are already declared. C compilers need it like that.
        var namedStructs: Array<StructType> = [];
        var mangledNames: Array<string> = [];
        for(let n of this.namedStructs.keys()) {
            mangledNames.push(n);
            namedStructs.push(this.namedStructs.get(n));
        }
        for(let pos = 0; pos < namedStructs.length; pos++) {
            let t = namedStructs[pos];
            for(let f of t.fields) {
                let ft = f[1];
                if (ft instanceof StructType) {
                    let idx = namedStructs.indexOf(ft);
                    if (idx != -1 && idx > pos) {
                        let n = mangledNames[idx];
                        let s = namedStructs[idx];
                        namedStructs.splice(idx, 1);
                        namedStructs.splice(pos, 0, s);
                        mangledNames.splice(idx, 1);
                        mangledNames.splice(pos, 0, n);
                        pos--;
                        break;
                    }
                }
            }
        }

        for(let pos = 0; pos < namedStructs.length; pos++) {
            let mangledName = mangledNames[pos];
            let t = namedStructs[pos];

            let ct = new CType("#ifndef S_" + mangledName + "\n#define S_" + mangledName + (t.isUnion ? "\nunion " : "\nstruct ") + mangledName + " {\n" + t.fields.map((c: [string, ssa.Type | ssa.StructType, number], i: number) => {
                let t = this.mapType(c[1]).toString();
                if (c[2] > 1) {
                    return "    " + t + " " + c[0] + "[" + c[2].toString() + "];\n"
                }
                return "    " + this.mapType(c[1]).toString() + " " + c[0] + ";\n";
            }).join("") + "};\n#endif")
            this.module.elements.push(ct);
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
                        throw new ImplementationError()
                    }
                    name = p.pkgPath + "/" + name;
                    name = this.mangleName(name);
                    name = "s_" + name;
                    let call = new CFunctionCall();
                    call.funcExpr = new CConst(name);
                    main.body.push(call);
                }
            }

            // Generate with coroutines?
            if (this.module.hasInclude("fyr_spawn.h", false)) {
                // Call code to initialize coroutines
                let call = new CFunctionCall();
                call.funcExpr = new CConst("fyr_component_main_start")
                main.body.push(call);

                // Call the fyr main function
                call = new CFunctionCall();
                call.funcExpr = new CConst(this.mainFunction.func.name);
                let v = new CVar()
                v.name = "ret";
                v.initExpr = call;
                v.type = new CType("int");
                main.body.push(v);

                // Call code to finalize coroutines
                call = new CFunctionCall();
                call.funcExpr = new CConst("fyr_component_main_end")
                main.body.push(call);

                let r = new CReturn();
                r.expr = new CConst("ret");
                main.body.push(r);
                this.module.elements.push(main);
            } else {
                // Call the fyr main function
                let call = new CFunctionCall();
                call.funcExpr = new CConst(this.mainFunction.func.name);
                let r = new CReturn();
                r.expr = call;
                main.body.push(r);
                this.module.elements.push(main);
            }
        }

        return ircode;
    }

    public addSymbol(name: string): number {
        let c = new CConst("sym_" + this.mangleName(name));
        this.module.symbols.set(name, c);
        this.symbols.push(name);
        return this.symbols.length - 1;
    }

    public addInterfaceDescriptor(name: string, table: Array<Function | FunctionImport>): number {
        let namesTable: Array<CConst> = [];
        for (let f of table) {
            if (f instanceof Function) {
                namesTable.push(new CConst(f.func.name));
            } else if (f instanceof FunctionImport) {
                namesTable.push(new CConst(f.name));
            } else {
                namesTable.push(new CConst("0"));
            }
        }
        let hash = createHash("md5");
        hash.update(name);
        let d = new InterfaceDescriptor;
        d.name = new CConst("t_" + hash.digest("hex"));
        d.table = namesTable;
        let index = this.module.ifaceDescriptors.length;
        this.module.ifaceDescriptors.push(d);
        return index;
    }

    public getImplementationCode(): string {
        return this.module.getImplementationCode(this.pkg);
    }

    public getHeaderCode(): string {
        return this.module.getHeaderCode(this.pkg);
    }

    private typecode(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType): string {
        if (t instanceof ssa.StructType) {
            let str = "{";
            for(let f of t.fields) {
                str += "[" + f[2].toString() + "]" + this.typecode(f[1]) + ",";
            }
            str += "}";
            return str;
        }
        return this.mapType(t).code;
    }

    private mangledTypecode(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType): string {
        let str = this.typecode(t);
        let hash = createHash("md5");
        hash.update(str);
        return hash.digest("hex");
    }

    private mapType(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType, cstyle: boolean = false, needsRefCounting: boolean = false): CType {
        if (needsRefCounting) {
            if (t instanceof ssa.FunctionType) {
                throw new ImplementationError()
            }
            let s = new ssa.StructType()
            s.addField("word1", "sint");
            s.addField("word2", "sint");
            s.addField("value", t);
            return this.mapType(s, cstyle, false);
        }
        if (t instanceof ssa.StructType) {
            let mangledName: string;
            if (t.name) {
                if (t.pkg) {
                    mangledName = this.mangleName(t.pkg.pkgPath + "/" + t.name);
                } else {
                    mangledName = this.mangleName(t.name);
                }
            } else {
                // An anonymous struct
                mangledName = "ta_struct" + this.mangledTypecode(t);
            }
            if (!this.namedStructs.has(mangledName)) {
                this.namedStructs.set(mangledName, t);
                for(let f of t.fields) {
                    if (f[1] instanceof StructType) {
                        this.mapType(f[1], false);
                    }
                }
            }
            if (t.isUnion) {
                return new CType("union " + mangledName);
            }
            return new CType("struct " + mangledName);
//            }
/*            let name = "ta_struct" + this.mangledTypecode(t);
            if (!this.anonymousStructs.has(name)) {
                let str = "#ifndef S_" + name + "\n";
                str += "#define S_" + name + "\n";
                str +=  "struct " + name + " {\n" + t.fields.map((c: [string, ssa.Type | ssa.StructType, number], i: number) => {
                    let t = this.mapType(c[1], cstyle).toString();
                    if (c[2] > 1) {
                        return "    " + t + " " + c[0] + "[" + c[2].toString() + "];\n"
                    }
                    return "    " + this.mapType(c[1], cstyle).toString() + " " + c[0] + ";\n";
                }).join("") + "};\n#endif\n";
                this.anonymousStructs.add(name);
                this.module.elements.unshift(new CType(str));
            }
            return new CType("struct " + name);*/
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
            let r = t.result ? this.mapType(t.result, cstyle) : new CType("void");
            let params = [];
            for (let p of t.params) {
                params.push(this.mapType(p, cstyle));
            }
            return new CFunctionType(r, params);
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
        throw new ImplementationError()
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
        throw new ImplementationError()
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
        throw new ImplementationError()
    }

    private isSignedType(t: ssa.Type | ssa.StructType | ssa.PointerType | ssa.FunctionType): boolean {
        return t == "s8" || t == "s16" || t == "s32" || t == "s64" || t == "sint";
    }

    private emitExpr(n: number | string | ssa.BinaryArray | ssa.Variable | ssa.Node): CNode {
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

    private emitExprIntern(n: number | string | ssa.BinaryArray | ssa.Variable | ssa.Node, generateConstants: boolean = false): CNode {
        if (typeof(n) == "number") {
            return new CConst(n.toString());
        }
        if (typeof(n) == "string") {
            let s: CString;
            if (this.currentCFunction) {
                s = this.currentCFunction.addString(n);
            } else {
                s = this.module.addString(n);
            }
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
        if (n instanceof ssa.BinaryArray) {
            let l = new CCompoundLiteral();
            for(let b of n.data) {
                l.values.push(this.emitExpr(b));
            }
            return l;
        }
        if (n instanceof ssa.Variable) {
            if (this.globalStorage && this.globalStorage.has(n) && !generateConstants) {
                let name = this.globalStorage.get(n);
                return new CConst(name);
            }
            if (this.varStorage && this.varStorage.has(n) && !generateConstants) {
                let name = this.varStorage.get(n);
                if (n.needsRefCounting) {
                    let m = new CBinary();
                    m.operator = ".";
                    m.lExpr = new CConst(name);
                    m.rExpr = new CConst("value");
                    return m;
                }
                return new CConst(name);
            }
            if (n.isConstant && typeof(n.constantValue) == "string") {
                return this.emitExprIntern(n.constantValue);
            } else if (n.isConstant && typeof(n.constantValue) == "number") {
                if (n.type == "f32") {
                    return new CConst(n.constantValue.toString() + "f");
                }
                return this.emitExprIntern(<number>n.constantValue);
            } else if (n.isConstant) {
                if (!(n.type instanceof StructType)) {
                    throw new ImplementationError()
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

            throw new ImplementationError()
        }
        if (n.kind == "addr_of") {
            if (n.type instanceof ssa.FunctionType || n.type instanceof ssa.StructType) {
                throw new ImplementationError()
            }
            if (!(n.args[0] instanceof ssa.Variable)) {
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
            }
            throw new TodoError()
        } else if (n.kind == "const") {
            if (n.type instanceof FunctionType || !n.assign) {
                throw new ImplementationError()
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
                throw new ImplementationError()
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
            if (f instanceof FunctionImport && n.type.result instanceof ssa.PointerType) {
                let conv = new CTypeCast();
                conv.expr = c;
                conv.type = this.mapType(n.type.result, false);
                return conv;
            }
            return c;
        } else if (n.kind == "call_begin") {
            if (!(n.type instanceof FunctionType)) {
                throw new ImplementationError()
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
            let cond = new CIf(c);
            let r = new CReturn();
            r.expr = new CConst("1");
            cond.body = [r];
            return cond;
        } else if (n.kind == "call_end") {
            if (!(n.type instanceof FunctionType)) {
                throw new ImplementationError()
            }
            if (n.type.result) {
                // TODO:
                return new CComment("TODO");
            }
            return new CComment("No return value to handle");
        } else if (n.kind == "call_indirect") {
            if (!(n.type instanceof FunctionType)) {
                throw new ImplementationError()
            }
            let c = new CFunctionCall();
            let f = this.funcs[n.args[0] as number];
            let cast = new CTypeCast();
            let rt: CType;
            if (n.type.result) {
                rt = this.mapType(n.type.result);
            }
            let params: Array<CType> = [];
            for(let p of n.type.params) {
                params.push(this.mapType(p));
            }
            let t = new CFunctionType(rt, params);
            cast.type = t;
            cast.expr = this.emitExpr(n.args[0]);
            c.funcExpr = cast;
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
        } else if (n.kind == "copy") {
            if (n.type instanceof FunctionType) {
                throw new ImplementationError()
            }
            return this.emitExpr(n.args[0]);
        } else if (n.kind == "struct") {
            if (!(n.type instanceof StructType)) {
                throw new ImplementationError()
            }
            let t = new CTypeCast();
            t.type = this.mapType(n.type);
            let l = new CCompoundLiteral();
            for(let a of n.args) {
                l.values.push(this.emitExpr(a));
            }
            t.expr = l;
            return t;
        } else if (n.kind == "union") {
            if (!(n.type instanceof StructType)) {
                throw new ImplementationError()
            }
            if (!n.type.isUnion) {
                throw new ImplementationError()
            }
            let t = new CTypeCast();
            t.type = this.mapType(n.type);
            if (typeof(n.args[0]) != "number") {
                throw new ImplementationError()
            }
            let name = n.type.fieldNameByIndex(n.args[0] as number);
            let l = new CUnionLiteral(name, this.emitExpr(n.args[1]));
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
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
            }
            this.includeMathHeaderFile();
            c.args.push(this.emitExpr(n.args[0]));
            return c;
        } else if (n.kind == "min") {
            if (n.args.length == 0) {
                switch(n.type) {
                    case "sint":
                        this.includeLimitsHeaderFile();
                        return new CConst("INT_MIN");
                    case "i8":
                    case "char":
                        this.includeLimitsHeaderFile();
                        return new CConst("CHAR_MIN");
                    case "i16":
                        return new CConst("INT16_MIN");
                    case "i32":
                        return new CConst("INT32_MIN");
                    case "i64":
                        return new CConst("INT64_MIN");
                    case "int":
                        this.includeLimitsHeaderFile();
                        return new CConst("UINT_MIN");
                    case "uint8":
                    case "byte":
                        return new CConst("UINT8_MIN");
                    case "uint16":
                        return new CConst("UINT16_MIN");
                    case "uint32":
                    case "rune":
                        return new CConst("UINT32_MIN");
                    case "uint64":
                        return new CConst("UINT64_MIN");
                    default:
                        throw new ImplementationError()
                }
            } else if (n.type != "f32" && n.type != "f64") {
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
            if (n.args.length == 0) {
                switch(n.type) {
                    case "sint":
                        this.includeLimitsHeaderFile();
                        return new CConst("INT_MAX");
                    case "i8":
                    case "char":
                        this.includeLimitsHeaderFile();
                        return new CConst("CHAR_MAX");
                    case "i16":
                        return new CConst("INT16_MAX");
                    case "i32":
                        return new CConst("INT32_MAX");
                    case "i64":
                        return new CConst("INT64_MAX");
                    case "int":
                        this.includeLimitsHeaderFile();
                        return new CConst("UINT_MAX");
                    case "uint8":
                    case "byte":
                        return new CConst("UINT8_MAX");
                    case "uint16":
                        return new CConst("UINT16_MAX");
                    case "uint32":
                    case "rune":
                        return new CConst("UINT32_MAX");
                    case "uint64":
                        return new CConst("UINT64_MAX");
                    default:
                        throw new ImplementationError()
                }
            } else if (n.type != "f32" && n.type != "f64") {
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
                throw new ImplementationError()
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
                throw new ImplementationError()
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
                throw new ImplementationError()
            }
            let e = new CTypeCast();
            e.type = this.mapType(n.type);
            e.expr = this.emitExpr(n.args[0]);
            return e;
        } else if (n.kind == "convert32_s" || n.kind == "convert32_u" || n.kind == "convert64_s" || n.kind == "convert64_u") {
            if (n.type instanceof FunctionType || n.type instanceof StructType) {
                throw new ImplementationError()
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
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else if (typeof(n.args[1]) == "number") {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw new ImplementationError()
                }
                m.args = [this.emitExpr(n.args[0]), new CConst(f.func.name)];
            } else {
                let cast = new CTypeCast();
                cast.type = new CType("fyr_dtr_t");
                cast.expr = this.emitExpr(n.args[1]);
                m.args = [this.emitExpr(n.args[0]), cast];
            }
            return m;
        } else if (n.kind == "decref") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_decref");
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else if (typeof(n.args[1]) == "number") {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw new ImplementationError()
                }
                m.args = [this.emitExpr(n.args[0]), new CConst(f.func.name)];
            } else {
                let cast = new CTypeCast();
                cast.type = new CType("fyr_dtr_t");
                cast.expr = this.emitExpr(n.args[1]);
                m.args = [this.emitExpr(n.args[0]), cast];
            }
            return m;
        } else if (n.kind == "incref") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_incref");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "unlock" || n.kind == "unlock_arr") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst(n.kind == "unlock" ? "fyr_unlock" : "fyr_unlock_arr");
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else if (typeof(n.args[1]) == "number") {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw new ImplementationError()
                }
                m.args = [this.emitExpr(n.args[0]), new CConst(f.func.name)];
            } else {
                let cast = new CTypeCast();
                cast.type = new CType("fyr_dtr_t");
                cast.expr = this.emitExpr(n.args[1]);
                m.args = [this.emitExpr(n.args[0]), cast];
            }
            return m;
        } else if (n.kind == "lock") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst(n.kind == "lock" ? "fyr_lock" : "fyr_lock_arr");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "cmp_ref") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_cmp_ref");
            m.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1])];
            return m;
        } else if (n.kind == "notnull_ref") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_notnull_ref");
            m.args = [this.emitExpr(n.args[0])];
            return m;
        } else if (n.kind == "notnull") {
            let expr = new CBinary();
            expr.lExpr = this.emitExpr(n.args[0]);
            expr.rExpr = new CConst("NULL");
            expr.operator = "==";
            let m = new CIf(expr);
            let exit = new CFunctionCall();
            exit.funcExpr = new CConst("exit");
            exit.args = [new CConst("EXIT_FAILURE")];
            m.body = [exit];
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
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else if (typeof(n.args[1]) == "number") {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw new ImplementationError()
                }
                m.args = [this.emitExpr(n.args[0]), new CConst(f.func.name)];
            } else {
                let cast = new CTypeCast();
                cast.type = new CType("fyr_dtr_t");
                cast.expr = this.emitExpr(n.args[1]);
                m.args = [this.emitExpr(n.args[0]), cast];
            }
            return m;
        } else if (n.kind == "decref_arr") {
            let m = new CFunctionCall();
            m.funcExpr = new CConst("fyr_decref_arr");
            if (typeof(n.args[1]) != "number") {
                throw new ImplementationError()
            }
            if (n.args[1] === -1) {
                m.args = [this.emitExpr(n.args[0]), new CConst("0")];
            } else {
                let f = this.funcs[n.args[1] as number];
                if (f instanceof FunctionImport) {
                    throw new ImplementationError()
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
                throw new ImplementationError()
            }
            let idx = n.args[1];
            if (typeof(idx) != "number") {
                throw new ImplementationError()
            }
            let t = s.type;
            if (!(t instanceof ssa.StructType) || t.fields.length <= idx) {
                throw new ImplementationError()
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
        } else if (n.kind == "arr_to_str") {
            let call = new CFunctionCall();
            call.funcExpr = new CConst("fyr_arr_to_str");
            call.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1]), this.emitExpr(n.args[2])];
            return call;
        } else if (n.kind == "memcmp") {
            let call = new CFunctionCall();
            call.funcExpr = new CConst("memcmp");
            call.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1]), this.emitExpr(n.args[2])];
            this.includeStringHeaderFile();
            return call;
        } else if (n.kind == "table_iface") {
            let idx = n.args[0];
            if (typeof(idx) != "number") {
                throw new ImplementationError()
            }
            if (idx < 0 || idx >= this.module.ifaceDescriptors.length) {
                throw new ImplementationError()
            }
//            let addr = new CUnary();
//            addr.operator = "&";
//            addr.expr = this.module.ifaceDescriptors[idx].name;
            let cast = new CTypeCast();
            cast.type = new CType("addr_t");
            cast.expr = this.module.ifaceDescriptors[idx].name;
            return cast;
        } else if (n.kind == "addr_of_func") {
            let idx = n.args[0];
            if (typeof(idx) != "number") {
                throw new ImplementationError()
            }
            let f = this.funcs[idx];
            let c: CConst;
            if (f instanceof FunctionImport) {
                c = new CConst(f.name);
            } else {
                c = new CConst(f.func.name);
            }
            let cast = new CTypeCast();
            cast.type = this.mapType("addr");
            cast.expr = c;
            return cast;
        } else if (n.kind == "symbol") {
            let idx = n.args[0];
            if (typeof(idx) != "number") {
                throw new ImplementationError()
            }
            if (idx < 0 || idx >= this.symbols.length) {
                throw new ImplementationError()
            }
            let name = this.symbols[idx];
            return this.module.symbols.get(name);
        } else if (n.kind == "resume") {
            this.includeFyrSpawnFile();
            let c = new CFunctionCall();
            c.funcExpr = new CConst("fyr_resume");
            let cast = new CTypeCast();
            cast.type = new CType("struct fyr_coro_t*")
            cast.expr = this.emitExpr(n.args[0]);
            c.args = [cast];
            return c;
        } else if (n.kind == "coroutine") {
            this.includeFyrSpawnFile();
            let c = new CFunctionCall();
            c.funcExpr = new CConst("fyr_coroutine");
            c.args = [];
            let cast = new CTypeCast();
            cast.type = new CType("void*");
            cast.expr = c;
            return cast;
        }
        throw new ImplementationError(n.kind)
    }

    private includeMathHeaderFile() {
        if (!this.module.hasInclude("math.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "math.h";
            this.module.includes.push(inc);
        }
    }

    private includeLimitsHeaderFile() {
        if (!this.module.hasInclude("limits.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "limits.h";
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

    private includeStdioHeaderFile() {
        if (!this.module.hasInclude("stdio.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "stdio.h";
            this.module.includes.push(inc);
        }
    }

    private includeIntTypesHeaderFile() {
        if (!this.module.hasInclude("inttypes.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "inttypes.h";
            this.module.includes.push(inc);
        }
    }

    private includeFyrSpawnFile() {
        if (!this.module.hasInclude("fyr_spawn.h", false)) {
            let inc = new CInclude();
            inc.isSystemPath = false;
            inc.path = "fyr_spawn.h";
            this.module.includes.push(inc);
        }
        if (!this.module.hasInclude("alloca.h", true)) {
            let inc = new CInclude();
            inc.isSystemPath = true;
            inc.path = "alloca.h";
            this.module.includes.push(inc);
        }
    }

    private includePackageHeaderFile(p: Package) {
        let headerFile = p.pkgPath + ".h";
        if (!this.module.hasInclude(headerFile, true)) {
            let inc = new CInclude();
            inc.isSystemPath = false;
            inc.path = headerFile;
            this.module.includes.push(inc);
        }
    }

    private emitCode(start: Node, end: Node | null, code: Array<CNode>): void {
        let n = start;
        for( ; n && n != end; ) {
            code.push(new CComment(n.toString("")));
            if (n.kind == "if") {
                if (n.type instanceof ssa.StructType) {
                    throw new ImplementationError()
                }
                if (n.type instanceof ssa.FunctionType) {
                    throw new ImplementationError()
                }
                let expr = this.emitExpr(n.args[0]);
                let s = new CIf(expr);
                code.push(s);
                this.blockStack.unshift(null);
                this.emitCode(n.next[0], n.blockPartner, s.body);
                this.blockStack.shift();
                if (n.next[1]) {
                    let s2 = new CElse();
                    this.blockStack.unshift(null);
                    this.emitCode(n.next[1], n.blockPartner, s2.body);
                    this.blockStack.shift();
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
                this.includeFyrSpawnFile();
                let f = new CFunctionCall();
                f.funcExpr = new CConst("fyr_yield");
                f.args = [new CConst("true")];
                code.push(f);
                n = n.next[0];
            } else if (n.kind == "yield_continue") {
                this.includeFyrSpawnFile();
                let f = new CFunctionCall();
                f.funcExpr = new CConst("fyr_yield");
                f.args = [new CConst("false")];
                code.push(f);
                n = n.next[0];
            } else if (n.kind == "step") {
                let stepname = "step_" + n.name;
                let s = new CLabel(stepname);
                code.push(s);
                n = n.next[0];
            } else if (n.kind == "goto_step") {
                if (n.name == "<end>") {
                    let r = new CReturn();
                    r.expr = new CConst("0");
                    code.push(r);
                } else {
                    let stepname = "step_" + n.name;
                    let s = new CGoto(stepname);
                    code.push(s);
                }
                n = n.next[0];
            } else if (n.kind == "store") {
                if (n.type instanceof FunctionType) {
                    throw new ImplementationError()
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
            } else if (n.kind == "spawn") {
                if (!(n.type instanceof FunctionType)) {
                    throw new ImplementationError()
                }
                this.includeFyrSpawnFile();
                let tc = this.mangledTypecode(n.type);
                let name1 = "spawn_1_" + tc;
                let name2 = "spawn_2_" + tc;
                // Call the spawn_1 function
                let c = new CFunctionCall();
                c.funcExpr = new CConst(name1);
                // The arguments passed to the spawn_1 function
                let f = this.funcs[n.args[0] as number];
                let params: Array<CFunctionParameter> = [];
                let paramTypes: Array<CType> = [];
                let argList: string = "";
                for(let i = 1; i < n.args.length; i++) {
                    let a = n.args[i];
                    let e = this.emitExpr(a);
                    let p = new CFunctionParameter();
                    p.name = "p" + i.toString();
                    if (argList == "") {
                        argList = p.name;
                    } else {
                        argList += ", " + p.name;
                    }
                    if (f instanceof FunctionImport) {
                        let ctype = this.mapType(n.type.params[i-1], true);
                        let fyrtype = this.mapType(n.type.params[i-1]);
                        if (ctype != fyrtype) {
                            let tcast = new CTypeCast();
                            tcast.type = ctype;
                            tcast.expr = e;
                            e = tcast;
                        }
                        p.type = ctype;
                    } else {
                        p.type = this.mapType(n.type.params[i-1]);
                    }
                    params.push(p);
                    paramTypes.push(p.type);
                    c.args.push(e);
                }
                // The function pointer
                if (f instanceof FunctionImport) {
                    c.args.push(new CConst(f.name));
                } else {
                    c.args.push(new CConst(f.func.name));
                }
                let pfun = new CFunctionParameter();
                pfun.name = "fun";
                pfun.type = new CFunctionType(new CType("void"), paramTypes);
                params.push(pfun);
                let result: CNode;
                if (f instanceof FunctionImport && n.type.result instanceof ssa.PointerType) {
                    let conv = new CTypeCast();
                    conv.expr = c;
                    conv.type = this.mapType(n.type.result, false);
                    result = conv;
                }
                result = c;

                let f2 = new CFunction();
                f2.name = name2;
                f2.returnType = new CType("void");
                let params2: Array<CFunctionParameter> = [];
                let p = new CFunctionParameter();
                p.name = "dummy";
                p.type = new CType("__attribute__ ((unused)) void *");
                params2.push(p);
                p = new CFunctionParameter();
                p.name = "caller";
                p.type = new CType("jmp_buf");
                params2.push(p);
                p = new CFunctionParameter();
                p.name = "c";
                p.type = new CType("struct fyr_coro_t*");
                params2.push(p);
                params2 = params2.concat(params);
                f2.parameters = params2;
                f2.isPossibleDuplicate = true;
                f2.body = [
                    new CConst("if (!setjmp(c->buf)) { longjmp(caller, 1); }"),
                    new CConst("fyr_running = c"),
                    new CConst("fun(" + argList + ")"),
                    new CConst("fyr_running = NULL"),
                    new CConst("fyr_garbage_coro = c"),
                    new CConst("fyr_yield(true)")
                ];
                this.module.elements.push(f2);

                let f1 = new CFunction();
                f1.name = name1;
                f1.returnType = new CType("void");
                f1.parameters = params;
                f1.isPossibleDuplicate = true;
                f1.body = [
                    new CConst("addr_t p; addr_t newtop; addr_t mytop; addr_t dummy"),
                    new CConst("struct fyr_coro_t *c"),
                    new CConst("jmp_buf buf"),
                    new CConst("p = fyr_alloc(fyr_stacksize())"),
                    new CConst("c = (struct fyr_coro_t*)p"),
                    new CConst("newtop = p + fyr_stacksize()"),
                    new CConst("mytop = (addr_t)&p"),
                    new CConst("dummy = alloca((size_t)((intptr_t)mytop - (intptr_t)newtop))"),
                    new CConst("c->memory = dummy"),
                    new CConst("c->next = fyr_ready_first"),
                    new CConst("c->memory = p"),
                    new CConst("fyr_ready_first = c"),
                    new CConst("if (fyr_ready_last == NULL) { fyr_ready_last = c; }"),
                    new CConst("if (setjmp(buf)) { return; }"),
                    new CConst(name2 + "(dummy, buf, c" + (argList != "" ? ", ": "") + argList + ", fun)")
                ];
                this.module.elements.push(f1);

                code.push(result);
                n = n.next[0];
            } else if (n.kind == "spawn_indirect") {
                this.includeFyrSpawnFile();
                throw new TodoError()
            } else if (n.kind == "return") {
                if (n.type instanceof ssa.FunctionType) {
                    throw new ImplementationError()
                }
                if (n.args.length == 0) {
                    if (this.returnVariables.length != 0) {
                        throw new Error("return without a parameter, but function has a return type")
                    }
                    code.push(new CReturn());
                } else { //} if (n.args.length == 1) {
//                    if (this.returnVariables.length != 1) {
//                        throw new Error("return with one parameter, but function has no return type")
//                    }
                    let r = new CReturn();
                    r.expr = this.emitExpr(n.args[0]);;
                    code.push(r);
/*                } else {
                    if (this.returnVariables.length != n.args.length) {
                        throw new Error("number of return values does not match with return type")
                    }
                    let r = new CReturn();
                    for(let i = 0; i < n.args.length; i++) {
                        let t = this.returnVariables[i].type;
                        throw new TodoError()
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
            } else if (n.kind == "move_arr") {
                let f = this.funcs[n.args[4] as number];
                if (f instanceof FunctionImport) {
                    throw new ImplementationError()
                }
                let call = new CFunctionCall();
                call.funcExpr = new CConst("fyr_move_arr");
                call.args = [this.emitExpr(n.args[0]), this.emitExpr(n.args[1]), this.emitExpr(n.args[2]), this.emitExpr(n.args[3]), new CConst(f.func.name)];
                code.push(call);
                n = n.next[0];
            } else if (n.kind == "println") {
                this.includeStdioHeaderFile();
                let call = new CFunctionCall();
                call.funcExpr = new CConst("printf");
                let args: Array<CNode> = [null];
                let f = "\"";
                for(let i = 0; i < n.args.length; i++) {
                    let arg = n.args[i];
                    if (typeof(arg) == "number") {
                        if (arg < 0) {
                            f += "%i ";
                        } else {
                            f += "%u ";
                        }
                        args.push(this.emitExpr(arg));
                    } else if (arg instanceof ssa.Variable || arg instanceof ssa.Node) {
                        if (arg instanceof ssa.Variable && arg.isConstant && typeof(arg.constantValue) == "string") {
                            f += "%s ";
                            let s = arg.constantValue;
                            s = s.replace(/"/g, "\\\"");
                            args.push(new CConst("\"" + s + "\""));
                            continue;
                        }
                        let t = arg.type;
                        if (arg instanceof ssa.Node) {
                            t = arg.assignType;
                        }
                        if (t instanceof FunctionType) {
                            f += "<func> ";
                            continue;
                        }
                        if (t instanceof StructType) {
                            f += "<struct> ";
                            continue;
                        }
                        if (t instanceof ssa.PointerType) {
                            f += "%p ";
                            args.push(this.emitExpr(arg));
                        }
                        switch(t) {
                            case "i8":
                            case "i16": {
                                f += "%\"PRIu32\" ";
                                let c = new CTypeCast();
                                c.type = new CType("uint32_t");
                                c.expr = this.emitExpr(arg);
                                args.push(c);
                                this.includeIntTypesHeaderFile();
                                break;
                            }
                            case "i32":
                                f += "%\"PRIu32\" ";
                                args.push(this.emitExpr(arg));
                                this.includeIntTypesHeaderFile();
                                break;
                            case "i64":
                                f += "%\"PRIu64\" ";
                                args.push(this.emitExpr(arg));
                                this.includeIntTypesHeaderFile();
                                break;
                            case "s8":
                            case "s16": {
                                f += "%\"PRIi32\" ";
                                let c = new CTypeCast();
                                c.type = new CType("int32_t");
                                c.expr = this.emitExpr(arg);
                                args.push(c);
                                this.includeIntTypesHeaderFile();
                                break;
                            }
                            case "s32":
                                f += "%\"PRIi32\" ";
                                args.push(this.emitExpr(arg));
                                this.includeIntTypesHeaderFile();
                                break;
                            case "s64":
                                f += "%\"PRIi64\" ";
                                args.push(this.emitExpr(arg));
                                this.includeIntTypesHeaderFile();
                                break;
                            case "ptr":
                            case "addr":
                                f += "%p ";
                                args.push(this.emitExpr(arg));
                                break;
                            case "f32": {
                                f += "%f ";
                                let c = new CTypeCast();
                                c.type = new CType("double");
                                c.expr = this.emitExpr(arg);
                                args.push(c);
                                break;
                            }
                            case "f64":
                                f += "%f ";
                                args.push(this.emitExpr(arg));
                                break;
                            case "int":
                                f += "%u ";
                                args.push(this.emitExpr(arg));
                                break;
                            case "sint":
                                f += "%i ";
                                args.push(this.emitExpr(arg));
                                break;
                        }
                    }
                }
                f += "\\n\"";
                args[0] = new CConst(f);
                call.args = args;
                code.push(call);
                n = n.next[0];
            } else if (n.kind == "set_member") {
                let m = new CBinary();
                m.operator = ".";
                let s = n.args[0];
                if (!(s instanceof ssa.Variable) && !(s instanceof ssa.Node)) {
                    throw new ImplementationError()
                }
                let idx = n.args[1];
                if (typeof(idx) != "number") {
                    throw new ImplementationError()
                }
                let t = s.type;
                if (!(t instanceof ssa.StructType) || t.fields.length <= idx) {
                    throw new ImplementationError()
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
                let name: string;
                if (n.assign.name == "$return") {
                    this.currentFunction.func.returnType = this.mapType(n.type);
                    name = "r_return_0";
                } else {
                    name = "r_return_" + resultTypes.length.toString();
                    resultTypes.push([name, n.type as ssa.Type | ssa.StructType]);
                    this.assignVariableStorage(n.assign);
                }
                this.returnVariables.push(n.assign);
                this.varStorage.set(n.assign, name);
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
        let prefix = "_";
        for(let v of this.localVariables) {
            if (v.name == name) {
                prefix = this.localVariables.length.toString() + "_";
                break;
            }
        }
        if (name.substr(0, 1) == "%" && !v.isConstant) {
            name = "nr_" + name.substr(1);
        } else if (v.isConstant) {
            if (typeof(v.constantValue) == "string" || typeof(v.constantValue) == "number") {
                return;
            }
            if (name.substr(0, 1) == "%") {
                name = "s" + prefix + name.substr(1);
            } else {
                name = "s" + prefix + name;
            }
        } else {
            name = "v" + prefix + name;
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
    private importedGlobalVariables: Map<ssa.Variable, Package | string> = new Map<ssa.Variable, Package | string>();
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
//    private anonymousStructs: Set<string> = new Set<string>();
    private symbols: Array<string> = [];
    private currentCFunction: CFunction;
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
        let str: string = "";
        if (this.isExecutable) {
            str += "#define FYR_COMPILE_MAIN\n\n";
        }
        let headerFile: string;
        if (pkg.pkgPath) {
            headerFile = pkg.pkgPath + ".h";
        } else {
            headerFile = path.join(pkg.objFilePath, pkg.objFileName + ".h");
        }
        str += "#include \"" + headerFile + "\"\n";
        str += "\n";
        for(let s of this.strings.values()) {
            str += s.toString() + "\n\n";
        }
        for(let c of this.elements) {
            if (c instanceof CType) {
            } else if (c instanceof CFunction) {
                if (!c.isPossibleDuplicate) {
                    str += c.toString() + "\n\n";
                }
            } else if (c instanceof CExtern) {
                str += c.v.toString() + ";\n\n";
            } else {
                str += c.toString() + ";\n\n"
            }
        }
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
        this.elements.forEach(function(c: CStruct | CFunction | CVar | CComment | CType) {if (c instanceof CType) str += c.toString() + "\n\n";});
        this.elements.forEach(function(c: CStruct | CFunction | CVar | CComment | CType) {if (c instanceof CFunction) str += c.declaration() + "\n";});

        for(let d of this.ifaceDescriptors) {
            str += "#ifndef " + d.name.code + "_H\n";
            str += "#define " + d.name.code + "_H\n";
            str += "#ifdef FYR_COMPILE_MAIN\n";
            str += "const addr_t " + d.name.code + "[" + d.table.length + "] = {\n";
            for(let f of d.table) {
                str += "    (addr_t)" + f.code + ",\n";
            }
            str += "};\n";
            str += "#else\n";
            str += "extern const addr_t " + d.name.code + "[" + d.table.length + "];\n";
            str += "#endif\n";
            str += "#endif\n";
        }

        for(let s of this.symbols.keys()) {
            let c = this.symbols.get(s);
            str += "#ifndef SYM_" + c.code + "_H\n";
            str += "#define SYM_" + c.code + "_H\n";
            str += "#ifdef FYR_COMPILE_MAIN\n";
            str += "const addr_t " + c.code + " = (const addr_t)(const char*)\"" + s + "\";\n";
            str += "#else\n";
            str += "extern const addr_t " + c.code + ";\n";
            str += "#endif\n";
            str += "#endif\n";
        }

        // Export global variables
        for(let c of this.elements) {
            if (c instanceof CExtern) {
                str += c.toString() + ";\n";
            }
        }

        for(let c of this.elements) {
            if (c instanceof CFunction && c.isPossibleDuplicate) {
                str += "\n#ifdef FYR_COMPILE_MAIN\n";
                str += "#ifndef " + c.name + "_H\n";
                str += "#define " + c.name + "_H\n";
                str += c.toString() + "\n";
                str += "#endif\n#endif\n";
            }
        }

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
    public elements: Array<CStruct | CFunction | CVar | CComment | CType | CExtern> = [];
    public ifaceDescriptors: Array<InterfaceDescriptor> = [];
    public symbols: Map<string, CConst> = new Map<string, CConst>();
    public isExecutable: boolean;
}

export abstract class CNode {
    public precedence(): number {
        return 0;
    }

    public abstract toString(indent: string): string;
}

export class CExtern extends CNode {
    constructor(v: CVar) {
        super();
        this.v = v;
    }

    public toString(indent: string = ""): string {
        return indent + "extern " + this.v.toString("", true);
    }

    public v: CVar;
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
        let str = indent + "struct {\n" + indent + "    int_t size;\n" + indent + "    int_t lockcount;\n" + indent + "    int_t refcount;\n" + indent + "    uint8_t data[" + this.bytes.length + "];\n" + indent + "} " + this.name + " = {" + this.bytes.length + ", 1, 1";
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
        let str = "";
        for(let s of this.strings.values()) {
            str += s.toString() + "\n\n";
        }
        str += "\n";

        str += indent + this.returnType + " " + this.name + "(" + this.parameters.map(function(c: CFunctionParameter) { return c.toString()}).join(", ") + ") {\n";
        str += this.body.map(function(c: CNode) { return c.toString(indent + "    ") + ";"}).join("\n");
        return str + "\n" + indent + "}";
    }

    public declaration(): string {
        return this.returnType + " " + this.name + "(" + this.parameters.map(function(c: CFunctionParameter) { return c.toString()}).join(", ") + ");";
    }

    public addString(str: string): CString {
        if (this.strings.has(str)) {
            return this.strings.get(str);
        }
        let s = new CString(str);
        this.strings.set(str, s);
        return s;
    }

    public name: string;
    public returnType: CType;
    public parameters: Array<CFunctionParameter> = [];
    public body: Array<CNode> = [];
    public isPossibleDuplicate: boolean;
    public strings: Map<string, CString> = new Map<string, CString>();
}

export class CFunctionParameter {
    public toString(): string {
        if (this.type instanceof CFunctionType) {
            return this.type.toString().replace(/\(\*\)/, "(*" + this.name + ")");
        }
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

export class CFunctionType extends CType {
    constructor (returnType: CType, parameters: Array<CType>) {
        let str = "";
        if (returnType) {
            str += returnType.code;
        } else {
            str += "void";
        }
        str += "(*)(";
        if (parameters) {
            str += parameters.map(function(p :CType) { return p.code; }).join(",");
        }
        str += ")"
        super(str);
    }
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
    public toString(indent: string = "", noInit: boolean = false): string {
        let str = indent + this.type.toString() + " " + this.name;
        if (this.initExpr && !noInit) {
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

export class CUnionLiteral extends CNode {
    constructor(name: string, value: CNode) {
        super();
        this.name = name;
        this.value = value;
    }

    public toString(indent: string = ""): string {
        return indent + "{ ." + this.name + " = " + this.value.toString("") + "}";
    }

    public precedence(): number {
        return 1;
    }

    public name: string;
    public value: CNode;
}
