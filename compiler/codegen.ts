import {Node, AstFlags, Location} from "./parser"
import {
    Function, TemplateFunction, Scope, Variable, ScopeElement,
    FunctionParameter, ImportedPackage
} from "./scope"
import {
    Type, PackageType, StringLiteralType, MapType, InterfaceType,
    RestrictedType, OrType, StructType, UnsafePointerType, PointerType,
    FunctionType, ArrayType, SliceType, TupleType, TemplateFunctionType
} from "./types/"
import { TypeChecker, Static } from './typecheck/'
import * as helper from './typecheck/helper'
import * as types from "./types/"
import * as ssa from "./ssa"
import {SystemCalls} from "./pkg"
import * as backend from "./backend/backend"
import {Package} from "./pkg"
import {createHash} from "crypto";
import { ImplementationError, TodoError, TypeError } from './errors'

/**
 * A DestructorInstruction tells which actions must be taken to destruct the result of an expression
 * once this result is no longer required.
 */
export class DestructorInstruction {
    constructor(v: ssa.Variable, t: Type, action: "none" | "decref" | "destruct" | "unlock") {
        this.v = v;
        this.t = t;
        this.action = action;
    }

    public v: ssa.Variable;
    public action: "none" | "decref" | "destruct" | "unlock"
    public t: Type;
}

export class CodeGenerator {
    constructor(tc: TypeChecker, backend: backend.Backend, disableNullCheck: boolean) {
        this.tc = tc;
        this.disableNullCheck = disableNullCheck;
        this.backend = backend;
        this.imports = new Map<string, backend.FunctionImport>();

        this.localSlicePointer = new ssa.StructType();
        this.localSlicePointer.name = "localSlice";
        this.localSlicePointer.addField("data_ptr", "addr");
        this.localSlicePointer.addField("data_length", "sint");
        this.localSlicePointer.finalize()

        this.slicePointer = new ssa.StructType();
        this.slicePointer.name = "strongSlice";
        this.slicePointer.addField("base", this.localSlicePointer);
        this.slicePointer.addField("array_ptr", "addr");
        this.slicePointer.finalize()

        this.ifaceHeader = new ssa.StructType();
        this.ifaceHeader.name = "iface";
        this.ifaceHeader.addField("pointer", "addr");
        this.ifaceHeader.addField("table", "addr");
        this.ifaceHeader.finalize()

        this.mapHead = new ssa.StructType();
        this.mapHead.name = "mapHead";
        this.mapHead.addField("nextHead", "ptr");
        this.mapHead.addField("size", "i32");
        this.mapHead.addField("free", "i32");
        this.mapHead.addField("freeList", "addr");
        this.mapHead.finalize()
    }

    public processModule(mnode: Node, emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string {
        // Iterate over all files and import all functions, but import each function not more than once
        for(let fnode of mnode.statements) {
            for(let name of fnode.scope.elements.keys()) {
                let e = fnode.scope.elements.get(name);
                if (e instanceof Function && e.isNative) {
                    let name = e.nativePackageName + "/" + e.name;
                    if (this.imports.has(name)) {
                        this.funcs.set(e, this.imports.get(name));
                    } else {
                        let ft = this.getSSAFunctionType(e.type);
                        let wf = this.backend.importFunction(e.name, e.nativePackageName, ft);
                        this.funcs.set(e, wf);
                        this.imports.set(name, wf);
                    }
                } else if (e instanceof Variable && e.isNative) {
                    let g = this.backend.importGlobalVar(e.name, this.getSSAType(e.type), e.nativePackageName);
                    this.globalVars.set(e, g);
                }
            }
        }

        // Global variables ordered by their appearance in the code
        let globals: Array<Variable> = [];
        // Declare all functions and global variables
        let scope = mnode.scope;
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isNative) {
                    // A native function that has been imported and is being exported as well.
                    // It has been handled as imported already. Nothing to do here.
                    continue;
                }
                let name = e.name;
                if (e.type.objectType) {
                    let t = RestrictedType.strip(e.type.objectType);
                    if (t instanceof PointerType) {
                        t = RestrictedType.strip(t.elementType);
                    }
                    name = TypeChecker.mangledTypeName(RestrictedType.strip(t)) + "." + name;
                }
                let wf = this.backend.declareFunction(name);
                this.funcs.set(e, wf);

                // If the function is a template instantiation, make all global variables of the package available,
                // in which the template has been defined.
                if (e.type instanceof TemplateFunctionType) {
                    let pkg = e.type.base.pkg;
                    for(let ge of pkg.tc.globalVariables) {
                        if (this.globalVars.has(ge)) {
                            continue;
                        }
                        let gv = this.backend.importGlobalVar(ge.name, this.getSSAType(ge.type), pkg);
                        this.globalVars.set(ge, gv);
                    }
                }
            } else if (e instanceof TemplateFunction) {
                // Do nothing by intention
            } else if (e instanceof Variable) {
                if (e.nativePackageName) {
                    // A native variable that has been imported and is being exported as well.
                    // It has been handled as imported already. Nothing to do here.
                    continue;
                }
                let g = this.backend.declareGlobalVar(e.name, this.getSSAType(e.type));
                this.globalVars.set(e, g);
                if (e.node.rhs) {
                    globals.push(e);
                }
            } else {
                throw new Error("CodeGen: Implementation Error " + e)
            }
        }

        // Generate IR code for the initialization of global variables
        let wf = this.backend.declareInitFunction("init");
        let b = new ssa.Builder();
        let t = new FunctionType();
        t.returnType = Static.t_void;
        t.callingConvention = "fyr";
        b.define("init", this.getSSAFunctionType(t));
        let vars = new Map<ScopeElement, ssa.Variable>();
        // Add global variables
        for(let e of this.globalVars.keys()) {
            vars.set(e, this.globalVars.get(e));
        }
        for(let v of globals) {
            let g = this.globalVars.get(v);
            if ((helper.isStruct(v.type) || helper.isArray(v.type)) && helper.isPureLiteral(v.type, v.node.rhs)) {
                let expr = this.processPureLiteral(v.node.rhs);
                if (v.isConst) {
                    g.isConstant = true;
                    g.constantValue = (expr as ssa.Variable).constantValue;
                } else {
                    b.assign(g, "copy", this.getSSAType(v.type), [expr]);
                }
            } else {
                let expr = this.processValueExpression(null, scope, v.node.rhs, b, vars);
                b.assign(g, "copy", this.getSSAType(v.type), [expr]);
            }
        }
        this.backend.defineFunction(b.node, wf, false, false);

        // Generate IR code for all functions
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isNative) {
                    // A native function that has been imported and is being exported as well.
                    // It has been handled as imported already. Nothing to do here.
                    continue;
                }
                let wf = this.funcs.get(e) as backend.Function;
                this.processFunction(e, wf);
            } else if (e instanceof TemplateFunction) {
                // Do nothing by intention
            } else if (e instanceof Variable) {
                // Do nothing by intention
            } else {
                throw new Error("CodeGen: Implementation Error " + e)
            }
        }

        // Generate code for the module
        return this.backend.generateModule(emitIR, initPackages, duplicateCodePackages);
    }

    public getSSAType(t: Type, finalize: boolean = true): ssa.Type | ssa.StructType | ssa.PointerType {
        if (t == Static.t_bool || t == Static.t_uint8 || t == Static.t_byte || t == Static.t_void) {
            return "i8";
        }
        if (t == Static.t_int8) {
            return "s8";
        }
        if (t == Static.t_int16) {
            return "s16";
        }
        if (t == Static.t_uint16) {
            return "i16";
        }
        if (t == Static.t_int32) {
            return "s32";
        }
        if (t == Static.t_uint32) {
            return "i32";
        }
        if (t == Static.t_int64) {
            return "s64";
        }
        if (t == Static.t_uint64) {
            return "i64";
        }
        if (t == Static.t_float) {
            return "f32";
        }
        if (t == Static.t_double) {
            return "f64";
        }
        if (t == Static.t_rune) {
            return "i32";
        }
        if (t == Static.t_int) {
            return "sint";
        }
        if (t == Static.t_uint) {
            return "int";
        }
        if (t == Static.t_char) {
            return "s8";
        }
        if (t == Static.t_byte) {
            return "i8";
        }
        if (t instanceof RestrictedType && t.elementType instanceof types.PointerType) {
            // Const pointer to an interface?
            if (helper.isInterface(t.elementType)) {
                return this.ifaceHeader;
            }
            return new ssa.PointerType(this.getSSAType(t.elementType.elementType, finalize), true);
        }
        if (t instanceof types.PointerType) {
            // Pointer to an interface?
            if (helper.isInterface(t)) {
                return this.ifaceHeader;
            }
            return new ssa.PointerType(this.getSSAType(t.elementType, finalize), helper.isConst(t.elementType));
        }
        if (t instanceof RestrictedType && t.elementType instanceof types.UnsafePointerType) {
            return new ssa.PointerType(this.getSSAType(t.elementType.elementType, finalize), true);
        }
        if (t instanceof types.UnsafePointerType) {
            return new ssa.PointerType(this.getSSAType(t.elementType, finalize), helper.isConst(t.elementType));
        }
        if (t == Static.t_string) {
            return "addr";
        }
        if (t == Static.t_null) {
            return "addr";
        }
        if (t instanceof SliceType) {
            if (t.mode == "local_reference") {
                return this.localSlicePointer;
            }
            return this.slicePointer;
        }
        if (t instanceof MapType) {
            return "ptr";
        }
        if (t instanceof StructType) {
            if (this.structs.has(t)) {
                return this.structs.get(t);
            }
            let s = new ssa.StructType();
            s.name = t.name;
            this.structs.set(t, s);
            for(let i = 0; i < t.fields.length; i++) {
                let f = t.fields[i];
                let ft = this.getSSAType(f.type, false);
                s.addField(f.name, ft, 1);
                if (t.extends && i == 0) {
                    s.extend(ft as ssa.StructType)
//                    for(let entry of (ft as ssa.StructType).fieldOffsetsByName.entries()) {
//                        s.fieldOffsetsByName.set(entry[0], entry[1]);
//                    }
                }
            }
            s.pkg = t.pkg;
            if (finalize) {
                s.finalize()
            }
            return s;
        }
        if (t instanceof ArrayType) {
            let s = new ssa.StructType();
            s.name = t.name;
            s.addField("data", this.getSSAType(t.elementType, false), t.size);
            if (finalize) {
                s.finalize()
            }
            return s;
        }
        if (t instanceof TupleType) {
            let s = new ssa.StructType();
            s.name = t.name;
            let i = 0;
            for(let el of t.types) {
                s.addField("t" + i.toString(), this.getSSAType(el, false));
                i++;
            }
            if (finalize) {
                s.finalize()
            }
            return s;
        }
        if (t instanceof InterfaceType) {
            return this.ifaceHeader;
        }
        if (t instanceof OrType) {
            if (t.stringsOnly()) {
                return ssa.symbolType;
            }
            if (this.structs.has(t)) {
                return this.structs.get(t);
            }
            let s = new ssa.StructType();
            let u = new ssa.StructType();
            u.isUnion = true;
            s.name = t.name;
            u.name = "union__" + t.name;
            this.structs.set(t, s);
            let i = 0;
            for(let ot of t.types) {
                i++;
                let ft = this.getSSAType(ot, false);
                u.addField("option" + i.toString(), ft, 1);
            }
            s.addField("value", u, 1);
            s.addField("kind", "addr", 1);
            if (finalize) {
                u.finalize()
            }
            if (finalize) {
                s.finalize()
            }
            return s;
        }
        if (t instanceof StringLiteralType) {
            return ssa.symbolType;
        }
        if (t instanceof RestrictedType) {
            return this.getSSAType(t.elementType);
        }
        console.log(t)
        throw new Error("CodeGen: Implementation error: The type does not fit in a register " + t.toString())
    }

    private getSSAFunctionType(t: FunctionType): ssa.FunctionType {
        let ftype = new ssa.FunctionType([], null, t.callingConvention);
        if (t.objectType) {
            ftype.params.push("addr");
        }
        for(let p of t.parameters) {
            ftype.params.push(this.getSSAType(p.type));
        }
        if (t.returnType != Static.t_void) {
            ftype.result = this.getSSAType(t.returnType);
        }
        if (t.hasEllipsis()) {
            ftype.ellipsisParam = this.getSSAType(((t.lastParameter().type as SliceType).arrayType as ArrayType).elementType);
        }
        return ftype;
    }

    public processFunction(f: Function, wf: backend.Function): ssa.Node {
        let vars = new Map<ScopeElement, ssa.Variable>();
        // Add global variables
        for(let e of this.globalVars.keys()) {
            vars.set(e, this.globalVars.get(e));
        }

        let b = new ssa.Builder();

        b.define(f.name, this.getSSAFunctionType(f.type));
        // Declare parameters
        let vthis: ssa.Variable = null;
        for(let name of f.scope.elements.keys()) {
            let e = f.scope.elements.get(name);
            if (e instanceof FunctionParameter) {
                let v = b.declareParam(this.getSSAType(e.type), name);
                vars.set(e, v);
                if (name == "this") {
                    vthis = v;
                }
            }
        }
        // Declare result
        if (f.namedReturnVariables) {
            for(let name of f.scope.elements.keys()) {
                let e = f.scope.elements.get(name);
                if (e instanceof Variable && e.isResult) {
                    // Create a variable that can be assigned multiple times
                    let v = b.declareResult(this.getSSAType(e.type), name);
                    vars.set(e, v);
                }
            }
        } else if (f.type.returnType != Static.t_void) {
            let v = b.declareResult(this.getSSAType(f.type.returnType), "$return");
        }

        this.processScopeVariables(b, vars, f.scope);

        for(let node of f.node.statements) {
            this.processStatement(f, f.scope, node, b, vars, null);
        }

        if (!f.type.returnType || f.type.returnType == Static.t_void) {
            // Free all variables
            this.freeScopeVariables(null, b, vars, f.scope);
        }

        b.end();

//        if (this.emitIR || f.name == this.emitFunction) {
//            console.log(ssa.Node.strainToString("", b.node));
//        }

        this.backend.defineFunction(b.node, wf, f.isExported, f.isTemplateInstance);

        return b.node;
    }

    public processScopeVariables(b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, scope: Scope): void {
        // Declare variables
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Variable) {
                if (e.isResult) {
                    continue;
                } else if (e.isForLoopPointer) {
                    let v = b.declareVar("addr", name, false);
                    vars.set(e, v);
                } else {
                    // Create a variable that can be assigned multiple times
                    let v = b.declareVar(this.getSSAType(e.type), name, e.isReferencedWithRefcounting);
                    vars.set(e, v);
                }
            }
        }
    }

    public freeScopeVariables(ignoreVariables: Array<Variable | FunctionParameter>, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, scope: Scope): void {
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            // Parameters with isConst == true are either "this" or references. In both cases the caller is responsible
            // for managing the lifetime of the variables.
            if ((e instanceof Variable && !e.isResult && !e.isForLoopPointer) || (e instanceof FunctionParameter && !e.isConst)) {
                if (ignoreVariables && ignoreVariables.indexOf(e) != -1) {
                    continue;
                }
                if (!scope.elementNeedsDestruction.get(e)) {
                    // console.log("NOT destruction", e.name, scope.elementNeedsDestruction.get(e), e.loc);
                    continue;
                }
                let v = vars.get(e);
                if (!v) {
                    throw new ImplementationError()
                }
                this.callDestructorOnVariable(e.type, v, b);
            }
        }
    }

    public processStatement(f: Function, scope: Scope, snode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, blocks: {body: ssa.Node, outer: ssa.Node} | null): void {
        switch(snode.op) {
            case "comment":
                break;
            case "if":
            {
                if (snode.lhs) {
                    this.processScopeVariables(b, vars, snode.lhs.scope);
                    this.processStatement(f, snode.scope, snode.lhs, b, vars, blocks);
                }
                let tmp = this.processValueExpression(f, snode.scope, snode.condition, b, vars);
                b.ifBlock(tmp);
                this.processScopeVariables(b, vars, snode.scope);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, b, vars, blocks);
                }
                this.freeScopeVariables(null, b, vars, snode.scope);
                if (snode.elseBranch) {
                    b.elseBlock();
                    this.processStatement(f, snode.elseBranch.scope, snode.elseBranch, b, vars, blocks);
                }
                b.end();
                if (snode.lhs) {
                    this.freeScopeVariables(null, b, vars, snode.lhs.scope);
                }
                break;
            }
            case "else":
            {
                this.processScopeVariables(b, vars, snode.scope);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, b, vars, blocks);
                }
                this.freeScopeVariables(null, b, vars, snode.scope);
                break;
            }
            case "let":
            case "var":
            {
                if (snode.rhs) { // Assignment of an expression value?
                    if (snode.lhs.op == "id") {
                        // A single variabe is defined and assigned
                        let element = scope.resolveElement(snode.lhs.value) as Variable;
                        let v = vars.get(element);
                        if ((helper.isArray(element.type) || helper.isStruct(element.type)) && helper.isPureLiteral(element.type, snode.rhs)) {
                            let data = this.processPureLiteral(snode.rhs);
                            if (element.isConst) {
                                v.isConstant = true;
                                v.constantValue = (data as ssa.Variable).constantValue;
                            } else {
                                b.assign(v, "copy", v.type, [data]);
                            }
                        } else {
                            let dtor: Array<DestructorInstruction> = [];
                            //let rhs: ssa.Variable | number | ssa.Pointer;
                            // if (snode.rhs.op == "take") {
                                // Skip the take. Get the address and fill the memory with zeros afterwards
                            //    rhs = this.processLeftHandExpression(f, scope, snode.rhs.lhs, b, vars, dtor, "donate");
                            //} else {
                            let rhs = this.processExpression(f, scope, snode.rhs, b, vars, dtor, "donate");
                            //}
                            let data = this.autoConvertData(rhs, snode.lhs.type, snode.rhs.type, b);
                            /*
                            if (helper.isSafePointer(snode.lhs.type) && helper.isReference(snode.lhs.type) && (helper.isStrong(snode.rhs.type) || helper.isUnique(snode.rhs.type) || !helper.isTakeExpression(snode.rhs))) {
                                // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                                if (helper.isInterface(snode.lhs.type)) {
                                    let ptr = b.assign(b.tmp(), "member", "addr", [data, this.ifaceHeader.fieldIndexByName("pointer")]);
                                    b.assign(null, "incref", "addr", [ptr]);
                                } else {
                                    data = b.assign(b.tmp(), "incref", "addr", [data]);
                                }
                            } else if (helper.isString(snode.lhs.type) && !helper.isTakeExpression(snode.rhs)) {
                                data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
                            }*/
                            b.assign(v, "copy", v.type, [data]);
                            /*if (helper.isSlice(snode.lhs.type) && helper.isReference(snode.lhs.type) && (helper.isStrong(snode.rhs.type) || helper.isUnique(snode.rhs.type) || !helper.isTakeExpression(snode.rhs))) {
                                let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                                let arrayPointer: ssa.Variable;
                                if (rhs instanceof ssa.Pointer) {
                                    arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
                                } else {
                                    arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
                                }
                                b.assign(null, "incref_arr", "addr", [arrayPointer]);
                            }*/
                            this.processDestructorInstructions(dtor, b);
                            /*
                            if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {
                                if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                                    throw new ImplementationError()
                                }
                                // Fill the RHS with zeros
                                this.processFillZeros(rhs, snode.rhs.type, b);
                            }
                            */
                            if (!helper.isPureValue(snode.lhs.type)) {
                                // Avoid that the variable is inlined. It carries a reference count and must be destructed correctly
                                v.readCount = 2;
                                v.writeCount = 2;
                            }
                        }
                    } else if (snode.lhs.op == "tuple") {
                        throw new TodoError()
                    } else if (snode.lhs.op == "array") {
                        throw new TodoError()
                    } else if (snode.lhs.op == "object") {
                        throw new TodoError()
                    } else {
                        throw new ImplementationError()
                    }
                } /* else {
                    if (snode.lhs.op == "id") {
                        // A single variable is defined and assigned
                        let element = scope.resolveElement(snode.lhs.value) as Variable;
                        let v = vars.get(element);
                        let t = this.getSSAType(element.type);
                        if (t instanceof ssa.StructType) {
                            b.assign(v, "struct", t, this.generateZeroStruct(t));
                        } else {
                            b.assign(v, "const", v.type, [0]);
                        }
                    } else if (snode.lhs.op == "tuple") {
                        throw new TodoError()
                    } else if (snode.lhs.op == "array") {
                        throw new TodoError()
                    } else if (snode.lhs.op == "object") {
                        throw new TodoError()
                    } else {
                        throw new ImplementationError()
                    }
                } */
                return;
            }
            case "=":
            {
                if (snode.lhs.op == "tuple" || snode.lhs.op == "array" || snode.lhs.op == "object") {
                    let dtor: Array<DestructorInstruction> = [];
                    var processAssignmentDestinations = (node: Node, destinations: Array<ssa.Variable | ssa.Pointer>) => {
                        if (node.op == "tuple") {
                            for(let p of node.parameters) {
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    processAssignmentDestinations(p, destinations);
                                } else {
                                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, p, b, vars, dtor, "lock");
                                    destinations.push(dest);
                                }
                            }
                        } else if (node.op == "array") {
                            throw new TodoError()
                        } else if (node.op == "object") {
                            throw new TodoError()
                        }
                    }
                    var processAssignment = (node: Node, type: Type, destinations: Array<ssa.Variable | ssa.Pointer>, destCount: number, source: ssa.Pointer | ssa.Variable, isDonated: boolean) => {
                        if (node.op == "tuple") {
                            if (!(type instanceof TupleType)) {
                                throw new ImplementationError()
                            }
                            let stype = this.getSSAType(type) as ssa.StructType;
                            for(let i = 0; i < node.parameters.length; i++) {
                                let p = node.parameters[i];
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    throw new TodoError()
                                    // let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    // destCount = processAssignment(p, type.types[i], rhsIsTakeExpr, destinations, destCount, new ssa.Pointer(source.variable, source.offset + eoffset));
                                } else {
                                    // let elementType = type.types[i];
                                    let etype: ssa.Type | ssa.StructType | ssa.PointerType = stype.fields[i][1];
                                    let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    let dest = destinations[destCount];
                                    destCount++;
                                    // Assigning to a value containing pointers? -> destruct the LHS before assigning the RHS
                                    if (!helper.isPureValue(snode.lhs.type)) {
                                        // The 'dest != rhs' covers the case of assigning a variable to itself without a take expression
                                        if (dest instanceof ssa.Pointer) {
                                            this.callDestructorOnPointer(snode.lhs.type, dest, b);
                                        } else {
                                            this.callDestructorOnVariable(snode.lhs.type, dest, b);
                                        }
                                    }

                                    let val: ssa.Variable;
                                    if (source instanceof ssa.Pointer) {
                                        val = b.assign(b.tmp(), "load", etype, [source.variable, source.offset + eoffset]);
                                    } else {
                                        val = b.assign(b.tmp(), "member", etype, [source, i]);
                                    }

                                    if (!isDonated) {
                                        this.processIncref(val, type.types[i], b, null);
                                    }
                                    /*
                                    // Reference counting for pointers
                                    if (helper.isSafePointer(p.type) && helper.isReference(p.type) && (helper.isStrong(elementType) || helper.isUnique(elementType) || !rhsIsTakeExpr)) {
                                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                                        if (helper.isInterface(p.type)) {
                                            let ptr = b.assign(b.tmp(), "member", "addr", [val, this.ifaceHeader.fieldIndexByName("pointer")]);
                                            b.assign(null, "incref", "addr", [ptr]);
                                        } else {
                                            val = b.assign(b.tmp(), "incref", "addr", [val]);
                                        }
                                    } else if (helper.isString(p.type) && !rhsIsTakeExpr) {
                                        val = b.assign(b.tmp(), "incref_arr", "addr", [val]);
                                    }
                                    */
                                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                                    if (dest instanceof ssa.Pointer) {
                                        b.assign(b.mem, "store", etype, [dest.variable, dest.offset, val]);
                                    } else {
                                        b.assign(dest, "copy", etype, [val]);
                                    }
                                    /*
                                    // Reference counting for slices
                                    if (helper.isSlice(p.type) && helper.isReference(p.type) && (helper.isStrong(elementType) || helper.isUnique(elementType) || !rhsIsTakeExpr)) {
                                        let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                                        let arrayPointer: ssa.Variable;
                                        if (dest instanceof ssa.Pointer) {
                                            arrayPointer = b.assign(b.tmp(), "load", "addr", [dest.variable, dest.offset + st.fieldOffset("array_ptr")]);
                                        } else {
                                            arrayPointer = b.assign(b.tmp(), "member", "addr", [dest, st.fieldIndexByName("array_ptr")]);
                                        }
                                        b.assign(null, "incref_arr", "addr", [arrayPointer]);
                                    }
                                    */
                                }
                            }
                        } else if (node.op == "array") {
                            throw new TodoError()
                        } else if (node.op == "object") {
                            throw new TodoError()
                        }
                        return destCount;
                    }
                    let destinations: Array<ssa.Variable | ssa.Pointer> = [];
                    processAssignmentDestinations(snode.lhs, destinations);
                    let val: ssa.Pointer | ssa.Variable | number;
                    let isDonated = false;
                    if (this.isLeftHandSide(snode.rhs)) {
                        val = this.processLeftHandExpression(f, scope, snode.rhs, b, vars, dtor, "none");
                    } else {
                        val = this.processExpression(f, scope, snode.rhs, b, vars, dtor, "donate");
                        isDonated = true;
                    }
                    // let rhsIsTakeExpr = helper.isTakeExpression(snode.rhs);
                    if (typeof(val) == "number") {
                        throw new ImplementationError();
                    }
                    processAssignment(snode.lhs, snode.rhs.type, destinations, 0, val, isDonated);
                    this.processDestructorInstructions(dtor, b);
                    /*
                    if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {
                        // Fill the RHS with zeros
                        this.processFillZeros(val, snode.rhs.type, b);
                    }*/
                } else if (snode.lhs.op == "[" && helper.stripType(snode.lhs.lhs.type) instanceof MapType) {
                    // TODO: Ownership transfer
                    /*
                    let mtype: MapType = helper.stripType(snode.lhs.lhs.type) as MapType;
                    let m = this.processExpression(f, scope, snode.lhs.lhs, b, vars, mtype);
                    let key = this.processExpression(f, scope, snode.lhs.rhs, b, vars, mtype.keyType);
                    let value = this.processExpression(f, scope, snode.rhs, b, vars, mtype.valueType);
                    if (mtype.keyType == Static.t_string) {
                        let dest = b.call(b.tmp(), this.setMapFunctionType, [SystemCalls.setMap, m, key]);
                        b.assign(b.mem, "store", this.getSSAType(mtype.valueType), [dest, 0, value]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (mtype.keyType == Static.t_int64 || mtype.keyType == Static.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(mtype.keyType), [key]);
                        }
                        let dest = b.call(b.tmp(), this.setNumericMapFunctionType, [SystemCalls.setNumericMap, m, key64]);
                        b.assign(b.mem, "store", this.getSSAType(mtype.valueType), [dest, 0, value]);
                    }
                    */
                } else {
                    let dtor: Array<DestructorInstruction> = [];
                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars, dtor, "lock");
                    let rhs: ssa.Variable | number;
                    if ((helper.isArray(snode.lhs.type) || helper.isStruct(snode.lhs.type)) && helper.isPureLiteral(snode.lhs.type, snode.rhs)) {
                        rhs = this.processPureLiteral(snode.rhs);
                    // } else if (snode.rhs.op == "take") {
                    //    rhs = this.processLeftHandExpression(f, scope, snode.rhs.lhs, b, vars, dtor, "none");
                    } else {
                        rhs = this.processExpression(f, scope, snode.rhs, b, vars, dtor, "donate");
                    }
                    // Assigning to a value containing pointers? -> destruct the LHS value before assigning the RHS
                    if (!helper.isPureValue(snode.lhs.type)) {
                        if ((snode.lhs.flags & AstFlags.EmptyOnAssignment) != AstFlags.EmptyOnAssignment) {
                            if (dest instanceof ssa.Pointer) {
                                this.callDestructorOnPointer(snode.lhs.type, dest, b);
                            } else {
                                this.callDestructorOnVariable(snode.lhs.type, dest, b);
                            }
                        }
                    }
                    /*
                    let data: ssa.Variable | number;
                    if (rhs instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "load", t, [rhs.variable, rhs.offset]);
                    } else {
                        data = rhs;
                    }
                    */
                    /*
                    // Reference counting for pointers
                    if (helper.isSafePointer(snode.lhs.type) && helper.isReference(snode.lhs.type) && (helper.isStrong(snode.rhs.type) || helper.isUnique(snode.rhs.type) || !helper.isTakeExpression(snode.rhs))) {
                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                        if (helper.isInterface(snode.lhs.type)) {
                            let ptr = b.assign(b.tmp(), "member", "addr", [data, this.ifaceHeader.fieldIndexByName("pointer")]);
                            b.assign(null, "incref", "addr", [ptr]);
                        } else {
                            data = b.assign(b.tmp(), "incref", "addr", [data]);
                        }
                    } else if (helper.isString(snode.lhs.type) && !helper.isTakeExpression(snode.rhs)) {
                        data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
                    }
                    */
                    // If the left-hand expression returns an address, the resulting value must be stored in memory.
                    // Otherwise copy the resulting value to the destination variable.
                    if (dest instanceof ssa.Pointer) {
                        b.assign(b.mem, "store", this.getSSAType(snode.lhs.type), [dest.variable, dest.offset, rhs]);
                    } else {
                        b.assign(dest, "copy", this.getSSAType(snode.lhs.type), [rhs]);
                    }
                    /*
                    // Reference counting for slices
                    if (helper.isSlice(snode.lhs.type) && helper.isReference(snode.lhs.type) && (helper.isStrong(snode.rhs.type) || helper.isUnique(snode.rhs.type) || !helper.isTakeExpression(snode.rhs))) {
                        let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                        let arrayPointer: ssa.Variable;
                        if (dest instanceof ssa.Pointer) {
                            arrayPointer = b.assign(b.tmp(), "load", "addr", [dest.variable, dest.offset + st.fieldOffset("array_ptr")]);
                        } else {
                            arrayPointer = b.assign(b.tmp(), "member", "addr", [dest, st.fieldIndexByName("array_ptr")]);
                        }
                        b.assign(null, "incref_arr", "addr", [arrayPointer]);
                    }
                    */
                    this.processDestructorInstructions(dtor, b);
                    /*
                    if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {
                        if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                            throw new ImplementationError()
                        }
                        // Fill the RHS with zeros
                        this.processFillZeros(rhs, snode.rhs.type, b);
                    }*/
                }
                break;
            }
            case "/=":
            case "%=":
            case ">>=":
            case "*=":
            case "-=":
            case "+=":
            case "&=":
            case "&^=":
            case "^=":
            case "|=":
            case "<<=":
            {
                let t = helper.stripType(snode.lhs.type);
                let storage = this.getSSAType(t);
                let dtor: Array<DestructorInstruction> = [];
                let tmp: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars, dtor, "lock", true);
                let p1: ssa.Variable;
                let dest: ssa.Variable;
                if (tmp instanceof ssa.Pointer) {
                    p1 = b.assign(b.tmp(), "load", storage, [tmp.variable, tmp.offset]);
                    dest = b.tmp();
                } else {
                    p1 = tmp;
                    dest = tmp;
                }
                let p2 = this.processExpression(f, scope, snode.rhs, b, vars, dtor, "none", true);
                if (snode.lhs.type == Static.t_string) {
                    if (!this.disableNullCheck) {
                        b.assign(null, "notnull_ref", null, [p1]);
                    }
                    let l1 = b.assign(b.tmp(), "len_str", "sint", [p1]);
                    let l2 = b.assign(b.tmp(), "len_str", "sint", [p2]);
                    let l = b.assign(b.tmp(), "add", "sint", [l1, l2]);
                    let lplus = b.assign(b.tmp(), "add", "sint", [l, 1]);
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [lplus, 1]);
                    b.assign(b.mem, "memcpy", null, [ptr, p1, l1, 1]);
                    let ptr2 = b.assign(b.tmp(), "add", "addr", [ptr, l1]);
                    b.assign(b.mem, "memcpy", null, [ptr2, p2, l2, 1]);
                    this.callDestructorOnVariable(Static.t_string, p1, b, true);
                    // Decref p2 if necessary
                    if (helper.isTakeExpression(snode.rhs)) {
                        this.callDestructorOnVariable(Static.t_string, p2 as ssa.Variable, b, true);
                    }
                    dest = ptr;
                } else if (storage == "f32" || storage == "f64") {
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    } else if (snode.op == "*=") {
                        b.assign(dest, "mul", storage, [p1, p2]);
                    } else if (snode.op == "/=") {
                        b.assign(dest, "div", storage, [p1, p2]);
                    }
                } else if (t instanceof UnsafePointerType) {
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    }
                } else {
                    if (snode.op == "+=") {
                        b.assign(dest, "add", storage, [p1, p2]);
                    } else if (snode.op == "-=") {
                        b.assign(dest, "sub", storage, [p1, p2]);
                    } else if (snode.op == "*=") {
                        b.assign(dest, "mul", storage, [p1, p2]);
                    } else if (snode.op == "&=") {
                        b.assign(dest, "and", storage, [p1, p2]);
                    } else if (snode.op == "|=") {
                        b.assign(dest, "or", storage, [p1, p2]);
                    } else if (snode.op == "^=") {
                        b.assign(dest, "xor", storage, [p1, p2]);
                    } else if (snode.op == "<<=") {
                        b.assign(dest, "shl", storage, [p1, p2]);
                    } else if (snode.op == "&^=") {
                        let x = b.assign(b.tmp(), "xor", storage, [p2, -1]);
                        b.assign(dest, "and", storage, [p1, x]);
                    } else if (snode.op == "/=") {
                        b.assign(dest, helper.isSigned(snode.lhs.type) ? "div_s" : "div_u", storage, [p1, p2]);
                    } else if (snode.op == "%=") {
                        b.assign(dest, helper.isSigned(snode.lhs.type) ? "rem_s" : "rem_u", storage, [p1, p2]);
                    } else if (snode.op == ">>=") {
                        b.assign(dest, helper.isSigned(snode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
                    }
                }
                if (tmp instanceof ssa.Pointer) {
                    b.assign(b.mem, "store", storage, [tmp.variable, tmp.offset, dest]);
                }
                this.processDestructorInstructions(dtor, b);
                break;
            }
            case "--":
            case "++":
            {
                let t = helper.stripType(snode.lhs.type)
                let storage = this.getSSAType(t);
                let dtor: Array<DestructorInstruction> = [];
                let tmp: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars, dtor, "none");
                let p1: ssa.Variable;
                let dest: ssa.Variable;
                if (tmp instanceof ssa.Pointer) {
                    p1 = b.assign(b.tmp(), "load", storage, [tmp.variable, tmp.offset]);
                    dest = b.tmp();
                } else {
                    p1 = tmp;
                    dest = tmp;
                }
                let increment = 1;
                if (t instanceof UnsafePointerType) {
                    increment = ssa.sizeOf(this.getSSAType(t.elementType));
                }
                b.assign(dest, snode.op == "++" ? "add" : "sub", storage, [p1, increment]);
                if (tmp instanceof ssa.Pointer) {
                    b.assign(b.mem, "store", storage, [tmp.variable, tmp.offset, dest]);
                }
                this.processDestructorInstructions(dtor, b);
                break;
            }
            case "for":
            {
                let val: ssa.Variable;
                let counter: ssa.Variable;
                let ptr: ssa.Variable;
                let len: ssa.Variable | number;
                let dtor: Array<DestructorInstruction> = [];
                //
                // Loop initialization
                //
                if (snode.condition && snode.condition.op == ";;" && snode.condition.lhs) {
                    // A c-style for loop
                    this.processScopeVariables(b, vars, snode.condition.scope);
                    this.processStatement(f, snode.condition.scope, snode.condition.lhs, b, vars, blocks);
                } else if (snode.condition && snode.condition.op == "let_in") {
                    //
                    // A for loop of the form "for(let i in list) or for(let i, j in list)"
                    //
                    this.processScopeVariables(b, vars, snode.condition.scope);
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    //
                    // Initialize the counter with 0
                    //
                    if (snode.condition.lhs.op == "tuple") {
                        if (snode.condition.lhs.parameters[0].value != "_") {
                            // Initialize the counter with 0
                            let element = snode.condition.scope.resolveElement(snode.condition.lhs.parameters[0].value) as Variable;
                            counter = vars.get(element);
                        } else {
                            counter = b.tmp();
                        }
                        if (snode.condition.lhs.parameters[1].value != "_") {
                            let valElement = snode.condition.scope.resolveElement(snode.condition.lhs.parameters[1].value) as Variable;
                            val = vars.get(valElement);
                            if (valElement.isForLoopPointer) {
                                ptr = val;
                            }
                        }
                    } else {
                        if (snode.condition.lhs.value != "_") {
                            let element = snode.condition.scope.resolveElement(snode.condition.lhs.value) as Variable;
                            val = vars.get(element);
                            if (element.isForLoopPointer) {
                                ptr = val;
                            }
                        }
                        counter = b.tmp();
                    }
                    b.assign(counter, "const", "sint", [0]);
                    //
                    // Address and length of array or string
                    //
                    if (t instanceof SliceType) {
                        let sliceHeader = this.processExpression(f, snode.condition.scope, snode.condition.rhs, b, vars, dtor, "lock");
                        if (t.mode != "local_reference") {
                            let base = b.assign(b.tmp(), "member", this.localSlicePointer, [sliceHeader, this.slicePointer.fieldIndexByName("base")]);
                            b.assign(ptr, "member", "addr", [base, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        } else {
                            b.assign(ptr, "member", "addr", [sliceHeader, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        }
                        if (t.mode != "local_reference") {
                            let base = b.assign(b.tmp(), "member", this.localSlicePointer, [sliceHeader, this.slicePointer.fieldIndexByName("base")]);
                            len = b.assign(b.tmp(), "member", "sint", [base, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            len = b.assign(b.tmp(), "member", "sint", [sliceHeader, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
                    } else if (t instanceof ArrayType) {
                        // Get the address of the array
                        len = t.size;
                        if (this.isLeftHandSide(snode.condition.rhs)) {
                            let arr = this.processLeftHandExpression(f, snode.condition.scope, snode.condition.rhs, b, vars, dtor, "lock");
                            if (arr instanceof ssa.Variable) {
                                b.assign(ptr, "addr_of", "addr", [arr]);
                            } else {
                                b.assign(ptr, "copy", "addr", [arr.variable]);
                                if (arr.offset != 0) {
                                    b.assign(ptr, "add", "addr", [ptr, arr.offset]);
                                }
                            }
                        } else {
                            let arr = this.processExpression(f, snode.condition.scope, snode.condition.rhs, b, vars, dtor, "none") as ssa.Variable;
                            b.assign(ptr, "addr_of", "addr", [arr]);
                        }
                    } else if (t == Static.t_string) {
                        let v = this.processExpression(f, snode.condition.scope, snode.condition.rhs, b, vars, dtor, "lock") as ssa.Variable;
                        b.assign(ptr, "copy", "addr", [v]);
                        len = b.assign(b.tmp(), "len_str", "sint", [ptr]);
                    } else {
                        throw new TodoError("map")
                    }
                }
                //
                // Loop condition
                //
                let outer = b.block();
                let loop = b.loop();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.condition) {
                            let tmp = this.processValueExpression(f, snode.condition.scope, snode.condition.condition, b, vars);
                            let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                            b.br_if(tmp2, outer);
                        }
                    } else if (snode.condition.op == "let_in") {
                        // End of iteration?
                        let endcond = b.assign(b.tmp(), "eq", "i8", [counter, len]);
                        b.br_if(endcond, outer);
                        let t = RestrictedType.strip(snode.condition.rhs.type);
                        if (t instanceof SliceType || t instanceof ArrayType || t == Static.t_string) {
                            // Do nothing by intention
                        /* } else if (t == Static.t_string) {
                            let [decodeUtf8, decodeUtf8Type] = this.loadFunction("runtime/utf8", "DecodeUtf8", snode.loc);
                            // Get address of value
                            let valAddr: ssa.Variable;
                            if (val instanceof ssa.Variable) {
                                valAddr = b.assign(b.tmp(), "addr_of", "addr", [val]);
                            } else {
                                let tmp = b.declareVar("sint", "$dummyVar", false);
                                valAddr = b.assign(b.tmp(), "addr_of", "addr", [tmp]);
                            }
                            // Start computing the next rune with 0, in state 0
                            b.assign(val, "const", "s32", [0]);
                            let state = b.assign(b.tmp(), "const", "sint", [0]);
                            // Decode loop
                            let decodeLoop = b.loop();
                            // Load a character
                            let ch = b.assign(b.tmp(), "load", "i8", [ptr, 0]);
                            // Increase the counter
                            counter = b.assign(counter, "add", "sint", [counter, 1]);
                            b.assign(ptr, "add", "addr", [ptr, 1]);
                            b.call(state, decodeUtf8Type, [decodeUtf8.getIndex(), valAddr, ch, state]);
                            // Not a complete or illegal unicode char?
                            b.ifBlock(state);
                            // If illegal or end of string -> return 0xfffd
                            let illegal = b.assign(b.tmp(), "eq", "i8", [state, 1]);
                            endcond = b.assign(b.tmp(), "eq", "i8", [counter, len]);
                            b.assign(illegal, "or", "i8", [illegal, endcond]);
                            b.ifBlock(illegal);
                            // Handle illegal characters
                            b.assign(val, "const", "i32", [0xfffd]);
                            b.elseBlock();
                            // In the middle of a character. Repeat the loop
                            b.br(decodeLoop);
                            b.end();
                            b.end();
                            b.end(); */
                        } else {
                            throw new TodoError("map")
                        }
                    } else {
                        // A for loop of the form: "for( condition )"
                        let tmp = this.processValueExpression(f, snode.condition.scope, snode.condition, b, vars);
                        let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                        b.br_if(tmp2, outer);
                    }
                }
                this.processScopeVariables(b, vars, snode.scope);
                //
                // Loop body
                //
                let body = b.block();
                for(let s of snode.statements) {
                    this.processStatement(f, snode.scope, s, b, vars, {body: body, outer: outer});
                }
                this.freeScopeVariables(null, b, vars, snode.scope);
                //
                // Loop footer
                //
                b.end();
                if (snode.condition && snode.condition.op == ";;" && snode.condition.rhs) {
                    this.processStatement(f, snode.scope, snode.condition.rhs, b, vars, blocks);
                } else if (snode.condition && snode.condition.op == "let_in") {
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    if (t instanceof SliceType || t instanceof ArrayType) {
                        // Increase the pointer towards the last element
                        let storage = this.getSSAType(t.getElementType());
                        let size = ssa.alignedSizeOf(storage)
                        b.assign(ptr, "add", "addr", [ptr, size]);
                        // Increase the counter
                        b.assign(counter, "add", "sint", [counter, 1]);
                    } else if (t == Static.t_string) {
                        b.assign(ptr, "add", "addr", [ptr, 1]);
                        // Increase the counter
                        b.assign(counter, "add", "sint", [counter, 1]);
                    } else {
                        throw new TodoError("map")
                    }
                }
                b.br(loop);
                b.end();
                b.end();
                if (snode.condition) {
                    this.freeScopeVariables(null, b, vars, snode.condition.scope);
                }
                this.processDestructorInstructions(dtor, b);
                break;
            }
            case "continue":
            {
                b.br(blocks.body);
                break;
            }
            case "break":
            {
                b.br(blocks.outer);
                break;
            }
            case "return":
            {
                let ignoreVariables: Array<Variable | FunctionParameter> = [];
                let data: ssa.Variable | number;
                let dtor: Array<DestructorInstruction> = [];
                if (f.namedReturnVariables) {
                    for(let v of f.namedReturnVariables) {
                        ignoreVariables.push(v);
                    }
                }
                if (snode.lhs) {
                    // let rhs: ssa.Variable | ssa.Pointer | number;
                    // let forceIncref = false;
                    let varName = helper.getUnderlyingLocalVariable(snode.lhs)
                    if (varName != null) {
                        let e = scope.resolveElement(varName.value);
                        if (e instanceof FunctionParameter || (e instanceof Variable && !e.isGlobal)) {
                            // Do not run the destructor on this local variable
                            ignoreVariables.push(e);
                            // Returning a local variable? Then do not zero it out and do not execute its destructor
                            snode.lhs.flags &= ~AstFlags.ZeroAfterAssignment;
                            snode.lhs.flags |= AstFlags.TakenAfterAssignment;
                        }
                    }
                    data = this.processExpression(f, scope, snode.lhs, b, vars, dtor, "donate");
                    /*if (!doNotZero && ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment)) {
                        rhs = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                    } else {
                        rhs = this.processExpression(f, scope, snode.lhs, b, vars, targetType);
                    }
                    let t = this.getSSAType(snode.lhs.type);
                    if (rhs instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "load", t, [rhs.variable, rhs.offset]);
                    } else {
                        data = rhs;
                    }*/
                    // Reference counting for pointers
                    /*
                    if (helper.isSafePointer(targetType) && helper.isReference(targetType) && (helper.isStrong(snode.lhs.type) || helper.isUnique(snode.lhs.type) || !helper.isTakeExpression(snode.lhs) || forceIncref)) {
                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                        data = b.assign(b.tmp(), "incref", "addr", [data]);
                    } else if (helper.isString(targetType) && (!helper.isTakeExpression(snode.lhs) || forceIncref)) {
                        data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
                    }
                    // Reference counting for slices
                    if (helper.isSlice(targetType) && helper.isReference(targetType) && (helper.isStrong(snode.lhs.type) || helper.isUnique(snode.lhs.type) || !helper.isTakeExpression(snode.rhs))) {
                        let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                        let arrayPointer: ssa.Variable;
                        if (rhs instanceof ssa.Pointer) {
                            arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
                        } else {
                            arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
                        }
                        b.assign(null, "incref_arr", "addr", [arrayPointer]);
                    }
                    // TODO: The same for maps

                    if (!doNotZero && ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment)) {
                        if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                            throw new ImplementationError()
                        }
                        // Fill the RHS with zeros
                        this.processFillZeros(rhs, snode.lhs.type, b);
                    }
                    */
                }
                this.processDestructorInstructions(dtor, b);
                if (this.scopeNeedsDestructors(scope)) {
                    let s = scope;
                    while (s) {
                        this.freeScopeVariables(ignoreVariables, b, vars, s);
                        if (s.func) {
                            break;
                        }
                        s = s.parent;
                    }
                    if (!snode.lhs) {
                        if (f.namedReturnVariables) {
                            let args: Array<ssa.Variable | string | number> = [];
                            for(let key of f.scope.elements.keys()) {
                                let v = f.scope.elements.get(key);
                                if (v instanceof Variable && v.isResult) {
                                    args.push(vars.get(v));
                                }
                            }
                            let t = this.getSSAType(f.type.returnType);
                            let tmp = b.assign(b.tmp(), "struct", t, args);
                            b.assign(null, "return", t, [tmp]);
                        } else {
                            b.assign(null, "return", null, []);
                        }
                    } else {
                        let t = this.getSSAType(f.type.returnType);
                        b.assign(null, "return", t, [data]);
                    }
                } else {
                    if (!snode.lhs) {
                        if (f.namedReturnVariables) {
                            let args: Array<ssa.Variable | string | number> = [];
                            for(let key of f.scope.elements.keys()) {
                                let v = f.scope.elements.get(key);
                                if (v instanceof Variable && v.isResult) {
                                    args.push(vars.get(v));
                                }
                            }
                            let t = this.getSSAType(f.type.returnType);
                            let tmp = b.assign(b.tmp(), "struct", t, args);
                            b.assign(null, "return", t, [tmp]);
                        } else {
                            b.assign(null, "return", null, []);
                        }
                    } else {
                        b.assign(null, "return", this.getSSAType(f.type.returnType), [data]);
                    }
                }
                break;
            }
            case "yield":
                b.assign(null, "yield", null, []);
                break;
            case "yield_continue":
                b.assign(null, "yield_continue", null, []);
                break;
            /*
            case "take":
            {
                // If take is used as a statement, run the destructor on it and zero everything
                let t = this.getSSAType(snode.type);
                let dtor: Array<DestructorInstruction> = [];
                let src: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars, dtor, "donate");
                if (src instanceof ssa.Pointer) {
                    this.callDestructorOnPointer(snode.type, src, b);
                    if (t instanceof ssa.StructType) {
                        let tmp = b.assign(b.tmp(), "struct", t, this.generateZeroStruct(t));
                        b.assign(b.mem, "store", t, [src.variable, src.offset, tmp]);
                    } else {
                        b.assign(b.mem, "store", t, [src.variable, src.offset, 0]);
                    }
                    break;
                }
                this.callDestructorOnVariable(snode.type, src, b);
                if (t instanceof ssa.StructType) {
                    b.assign(src, "struct", t, this.generateZeroStruct(t));
                } else {
                    b.assign(src, "copy", t, [0]);
                }
                this.processDestructorInstructions(dtor, b);
                break;
            } */
            case "copy":
            case "move":
            {
                let dtor: Array<DestructorInstruction> = [];
                let objType = helper.stripType(snode.lhs.type);
                if (!(objType instanceof SliceType)) {
                    throw new ImplementationError()
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);
                // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                let head_addr = this.processExpression(f, scope, snode.lhs, b, vars, dtor, "lock");
                let dest_data_ptr: ssa.Variable | number;
                let dest_count: ssa.Variable | number;
                if (objType.mode == "local_reference") {
                    dest_data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    dest_count = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                } else {
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                }
                let head2_addr = this.processExpression(f, scope, snode.rhs, b, vars, dtor, "none");
                let src_data_ptr: ssa.Variable | number;
                let src_count: ssa.Variable | number;
                if (objType.mode == "local_reference") {
                    src_data_ptr = b.assign(b.tmp(), "member", "addr", [head2_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    src_count = b.assign(b.tmp(), "member", "sint", [head2_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                } else {
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head2_addr, this.slicePointer.fieldIndexByName("base")]);
                    src_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head2_addr, this.slicePointer.fieldIndexByName("base")]);
                    src_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                }
                let count = b.assign(b.tmp(), "min", "sint", [src_count, dest_count]);
                if (snode.op == "copy") {
                    b.assign(null, "memmove", null, [dest_data_ptr, src_data_ptr, count, size]);
                } else {
                    let dtor = this.generateArrayDestructor(RestrictedType.strip(objType.arrayType) as ArrayType);
                    b.assign(null, "move_arr", null, [dest_data_ptr, src_data_ptr, count, size, dtor.getIndex()]);
                }
                this.processDestructorInstructions(dtor, b);
                break;
            }
            case "println": {
                let dtor: Array<DestructorInstruction> = [];
                let args: Array<number | ssa.Variable> = [];
                for(let i = 0; i < snode.parameters.length; i++) {
                    args.push(this.processExpression(f, scope, snode.parameters[i], b, vars, dtor, "hold"));
                }
                b.assign(null, "println", null, args);
                this.processDestructorInstructions(dtor, b);
                break;
            }
            default:
            {
                let dtor: Array<DestructorInstruction> = [];
                let value = this.processExpression(f, scope, snode, b, vars, dtor, "none");
                this.processDestructorInstructions(dtor, b);
                // this.processCleanupExpression(snode, value, b, false);
            }
        }
    }

    /**
     * Returns a local variable that can be assigned to or a pointer to a memory location that can be used to store a value.
     */
    public processLeftHandExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, dtor: Array<DestructorInstruction>, keepAlive: "none" | "hold" | "lock", noNullPointer: boolean = false): ssa.Variable | ssa.Pointer {
        switch(enode.op) {
            case "id":
            {
                if ((enode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment) {
                    throw new ImplementationError();
                }
                let element = scope.resolveElement(enode.value);
                let v = vars.get(element);
                if (!v) {
                    throw new ImplementationError("unknown element " + element.name)
                }
                if (element instanceof Variable && element.isForLoopPointer) {
                    return new ssa.Pointer(v, 0);
                }
                // The LHS of an ssa.Variable is the variable itself, since it can be assigned to.
                // The variable itself can neither be locked nor hold. Therefore, nothing to do.
                return v;
            }
            case "unary*":
            {
                let t = helper.stripType(enode.rhs.type);
                // unary* returns the underlying pointer without dereferencing it.
                // Holding or locking means to hold or lock this pointer. Therefore, keepAlive is simply delegated to processExpression().
                let tmp = this.processExpression(f, scope, enode.rhs, b, vars, dtor, keepAlive, true);
                return new ssa.Pointer(tmp as ssa.Variable, 0);
            }
            case "[":
            {
                let ltype = helper.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (ltype instanceof UnsafePointerType) {
                    // Unsafe pointers cannot be locked or hold. Ignore keepAlive
                    let ptr = this.processValueExpression(f, scope, enode.lhs, b, vars);
                    let index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    let size = ssa.alignedSizeOf(this.getSSAType(ltype.elementType));
                    let index2 = index;
                    if (size > 1) {
                        // TODO: If size is power of 2, shift bits
                        index2 = b.assign(b.tmp(), "mul", "i32", [index, size]);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index2]), 0);
                } else if (ltype instanceof SliceType) {
                    // Compute the index
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    }
                    // The following code computes the slice fat-pointer.
                    // Holding or locking mean that the underlying array must not die, since a pointer into it is returned.
                    // The pointer returned is an inner pointer, hence this pointer can neither be locked nor increfed.
                    // Instead, the underlying array must be locked, because this is the only option which ensures that the
                    // returned pointer is not dangling.
                    let head_addr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive, true);
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    let size = ssa.alignedSizeOf(this.getSSAType(ltype.getElementType()));
                    if (ltype.mode == "local_reference") {
                        data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        len = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        let tmp1 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        data_ptr = b.assign(b.tmp(), "member", "addr", [tmp1, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        let tmp2 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        len = b.assign(b.tmp(), "member", "sint", [tmp2, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                    // Compare 'index' with 'len'
                    let cmp = b.assign(b.tmp(), "ge_u", "i8", [index, len]);
                    b.ifBlock(cmp);
                    b.assign(null, "trap", null, []);
                    b.end();
                    if (size != 1) {
                        if (typeof(index) == "number") {
                            index *= size;
                        } else {
                            index = b.assign(b.tmp(), "mul", "sint", [index, size]);
                        }
                    }
                    if (typeof(index) == "number") {
                        return new ssa.Pointer(data_ptr, index);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [data_ptr, index]), 0);
                } else if (ltype instanceof ArrayType) {
                    let size = ssa.alignedSizeOf(this.getSSAType(ltype.elementType));
                    // The following code computes the address of an array element.
                    // Holding or locking mean that the array must not die, since a pointer into it is returned.
                    // The pointer returned is an inner pointer, hence this pointer can neither be locked nor increfed.
                    // Instead, the underlying array must be locked, because this is the only option which ensures that the
                    // returned pointer is not dangling.
                    let ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive == "none" ? "none" : "lock", true);
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "addr", [ptr]);
                    }
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    }
                    // Compare 'index' with 'len'
                    if (typeof(index) == "number") {
                        if (index < 0 || index >= ltype.size * size) {
                            throw new ImplementationError(index + " " +ltype.size )
                        }
                    } else {
                        let cmp = b.assign(b.tmp(), "ge_u", "int", [index, ltype.size]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    if (typeof(index) == "number") {
                        index *= size;
                        if (ptr instanceof ssa.Pointer) {
                            ptr.offset += index;
                            return ptr;
                        }
                        return new ssa.Pointer(ptr, index);
                    }
                    if (size != 1) {
                        index = b.assign(b.tmp(), "mul", "sint", [index, size]);
                    }
                    if (ptr instanceof ssa.Pointer) {
                        return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr.variable, index]), ptr.offset);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index]), 0);
                } else if (ltype instanceof TupleType) {
                    // The following code computes the address of a tuple element.
                    // Holding or locking mean that the tuple must not die, since a pointer into it is returned.
                    // The pointer returned is an inner pointer, hence this pointer can neither be locked nor increfed.
                    // Instead, the underlying tuple must be locked, because this is the only option which ensures that the
                    // returned pointer is not dangling.
                    let ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive == "none" ? "none" : "lock", true);
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [ptr]);
                    }
                    let t = this.getSSAType(ltype) as ssa.StructType;
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op != "int") {
                        throw new ImplementationError()
                    }
                    let i = parseInt(enode.rhs.value);
                    if (i < 0 || i >= ltype.types.length) {
                        throw new ImplementationError()
                    }
                    let offset = t.fieldOffset("t" + i.toString());
                    if (ptr instanceof ssa.Pointer) {
                        ptr.offset += index;
                        return ptr;
                    }
                    return new ssa.Pointer(ptr, offset);
                } else {
                    throw new TodoError(); // TODO: map
                }
            }
            case ".":
            {
                let t = helper.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (t instanceof PointerType || t instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive == "none" ? "none" : "lock", true);
                    let elementType = t.elementType;
                    if (elementType instanceof RestrictedType) {
                        elementType = elementType.elementType;
                    }
                    if (elementType instanceof StructType) {
                        let s = this.getSSAType(elementType) as ssa.StructType;
                        if (ptr instanceof ssa.Variable) {
                            return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                        }
                        return b.assign(b.tmp(), "add", "ptr", [ptr, s.fieldOffset(enode.name.value)]);
                    } else {
                        throw new TodoError("interface and class")
                    }
                } else if (t instanceof PackageType) {
                    let ip = scope.resolveElement(enode.lhs.value);
                    if (!(ip instanceof ImportedPackage)) {
                        throw new ImplementationError("no such package " + enode.lhs.value)
                    }
                    let element = ip.pkg.scope.resolveElement(enode.name.value);
                    if (!element) {
                        throw new ImplementationError("missing " + enode.name.value)
                    }
                    let v = vars.get(element);
                    if (!v) {
                        if (element instanceof Variable) {
                            v = this.backend.importGlobalVar(element.name, this.getSSAType(element.type), element.nativePackageName ? element.nativePackageName : ip.pkg);
                            this.globalVars.set(element, v);
                            vars.set(element, v);
                        } else {
                            throw new ImplementationError()
                        }
                    }
                    return v;
                } else if (t instanceof StructType) {
                    // It is a value, i.e. not a pointer to a value
                    let left = this.processLeftHandExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive == "none" ? "none" : "lock", true);
                    let s = this.getSSAType(enode.lhs.type) as ssa.StructType;
                    if (left instanceof ssa.Pointer) {
                        left.offset += s.fieldOffset(enode.name.value);
                        return left;
                    }
                    let ptr = b.assign(b.tmp(), "addr_of", "ptr", [left]);
                    if (noNullPointer) {
                        this.processNullCheck(ptr, t, b);
                    }
                    return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                } else {
                    throw new Error("CodeGen: Implementation error")
                }
            }
            /*
            case "typeCast":
            {
                // This must be a type cast that extracts a value from an OrType.
                // All other type casts cannot be assigned to.
                // This typeCase is only assigned to when used with take, e.g. `take(<Object*>some_expression)`.
                // In this case return `some_expression` as a left-hand side
                if (!helper.isOrType(enode.rhs.type)) {
                    throw new ImplementationError()
                }
                let s = this.getSSAType(enode.rhs.type)
                let tc_real: ssa.Variable;
                let left = this.processLeftHandExpression(f, scope, enode.rhs, b, vars, dtor, keepAlive);
                if (left instanceof ssa.Pointer) {
                    tc_real = b.assign(b.tmp(), "load", "addr", [left.variable, left.offset + (s as ssa.StructType).fieldOffset("kind")])
                } else {
                    tc_real = b.assign(b.tmp(), "member", "addr", [left, (s as ssa.StructType).fieldIndexByName("kind")])
                }
                let idx = this.tc.orTypeIndex(enode.rhs.type as OrType, enode.type, true);
                let d_goal = this.createTypeDescriptor(enode.type);
                let tc_goal = b.assign(b.tmp(), "table_iface", "addr", [d_goal]);
                let cmp = b.assign(b.tmp(), "ne", "i8", [tc_real, tc_goal]);
                b.ifBlock(cmp);
                b.assign(null, "trap", null, []);
                b.end();
                if ((s as ssa.StructType).fieldOffset("value") != 0) {
                    throw new ImplementationError()
                }
                if (left instanceof ssa.Pointer) {
                    return left
                } else {
                    return new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [left]), 0);
                }
            }
            */
            default:
                throw new Error("CodeGen: Implementation error " + enode.op)
        }
    }

    /**
     * Creates code that checks that a pointer-like value is non-null.
     * If a `ssa.Variable` is passed, the value of the variable is tested.
     * If a `ssa.Pointer` is passed, the value stored at the location pointed to is checked.
     */
    private processNullCheck(ptr: ssa.Variable | number | ssa.Pointer, t: Type, b: ssa.Builder): void {
        if (this.disableNullCheck) {
            return;
        }
        let v: ssa.Variable | number;
        if (helper.isSafePointer(t) || helper.isString(t)) {
            // An interface pointer is a fat pointer
            if (helper.isInterface(t)) {
                if (ptr instanceof ssa.Pointer) {
                    v = b.assign(b.tmp(), "load", "addr", [ptr.variable, ptr.offset + this.ifaceHeader.fieldOffset("pointer")]);
                } else {
                    v = b.assign(b.tmp(), "member", "addr", [ptr, this.ifaceHeader.fieldIndexByName("pointer")]);
                }
            } else {
                if (ptr instanceof ssa.Pointer) {
                    v = b.assign(b.tmp(), "load", this.getSSAType(t), [ptr.variable, ptr.offset]);
                } else if (this.isThis(ptr)) {
                    // `this` is never null
                    return;
                } else {
                    v = ptr;
                }
            }
            if (helper.isReference(t)) {
                // References can point to an object that has already been destructed.
                // Hence, we use notnull_ref to track this.
                b.assign(null, "notnull_ref", null, [v]);
            } else {
                b.assign(null, "notnull", null, [v]);
            }
        } else if (helper.isSlice(t)) {
            if (ptr instanceof ssa.Pointer) {
                v = b.assign(b.tmp(), "load", "addr", [ptr.variable, ptr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
            } else if (helper.isLocalReference(t)) {
                v = b.assign(b.tmp(), "member", "addr", [ptr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
            } else {
                let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [ptr, this.slicePointer.fieldIndexByName("base")]);
                v = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
            }
            if (helper.isReference(t)) {
                // References can point to an object that has already been destructed.
                // Hence, we use notnull_ref to track this.
                b.assign(null, "notnull_ref", null, [v]);
            } else {
                b.assign(null, "notnull", null, [v]);
            }
        }
    }

    private processPureLiteral(n: Node): ssa.Variable | number {
        let buf: ssa.BinaryData = [];
        this.processPureLiteralInternal(n, buf);
        let v = new ssa.Variable();
        v.type = this.getSSAType(n.type);
        v.constantValue = buf;
        v.isConstant = true;
        return v;
    }

    private processPureLiteralInternal(n: Node, buf: ssa.BinaryData): void {
        if (n.type == Static.t_bool) {
            buf.push(n.value == "true" ? 1 : 0);
        } else if (n.type == Static.t_uint8 || n.type == Static.t_byte) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_uint16) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_uint32 || n.type == Static.t_rune) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_uint64) {
            // TODO large numbers
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_uint) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_int8 || n.type == Static.t_char) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_int16) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_int32) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_int64) {
            // TODO large numbers
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_int) {
            buf.push(parseInt(n.value));
        } else if (n.type == Static.t_float) {
            buf.push(parseFloat(n.value));
        } else if (n.type == Static.t_double) {
            buf.push(parseFloat(n.value));
        } else if (n.type == Static.t_string) {
            buf.push(n.value);
        } else if (helper.isSafePointer(n.type) || helper.isUnsafePointer(n.type)) {
            if (n.op != "null" && (n.op != "int" || n.numValue != 0)) {
                throw new ImplementationError()
            }
            buf.push(0);
        } else if (helper.isArray(n.type)) {
            let arrType = RestrictedType.strip(n.type) as ArrayType;
            let arrData = new ssa.BinaryArray();
            arrData.totalLen = arrType.size;
            if (n.parameters) {
                for(let p of n.parameters) {
                    if (p.op == "unary...") {
                        throw new ImplementationError()
                    }
                    if (p.op == "...") {
                        continue;
                    }
                    this.processPureLiteralInternal(p, arrData.data);
                }
            }
            buf.push(arrData);
        } else if (helper.isTuple(n.type)) {
            for(let p of n.parameters) {
                this.processPureLiteralInternal(p, buf);
            }
        } else if (helper.isStruct(n.type)) {
            for(let f of (helper.stripType(n.type) as StructType).fields) {
                let found = false;
                if (n.parameters) {
                    for(let p of n.parameters) {
                        if (p.name.value == f.name) {
                            this.processPureLiteralInternal(p.lhs, buf);
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) {
                    buf.push(0);
                }
            }
        } else {
            throw new ImplementationError()
        }
    }

    /*
    private processPureLiteralInternal(n: Node, buf: BinaryBuffer): void {
        if (n.type == Static.t_bool) {
            buf.appendUint8(n.value == "true" ? 1 : 0);
        } else if (n.type == Static.t_uint8) {
            buf.appendUint8(parseInt(n.value));
        } else if (n.type == Static.t_uint16) {
            buf.appendUint16(parseInt(n.value));
        } else if (n.type == Static.t_uint32 || n.type == Static.t_rune) {
            buf.appendUint32(parseInt(n.value));
        } else if (n.type == Static.t_uint64) {
            // TODO large numbers
            buf.appendUint64(parseInt(n.value));
        } else if (n.type == Static.t_int8) {
            buf.appendInt8(parseInt(n.value));
        } else if (n.type == Static.t_int16) {
            buf.appendInt16(parseInt(n.value));
        } else if (n.type == Static.t_int32) {
            buf.appendInt32(parseInt(n.value));
        } else if (n.type == Static.t_int64) {
            // TODO large numbers
            buf.appendInt64(parseInt(n.value));
        } else if (n.type == Static.t_float) {
            buf.appendFloat32(parseFloat(n.value));
        } else if (n.type == Static.t_double) {
            buf.appendFloat64(parseFloat(n.value));
        } else if (n.type instanceof PointerType) {
            if (n.op != "null" && (n.op != "int" || n.numValue != 0)) {
                throw new ImplementationError()
            }
            buf.appendPointer(0);
        } else if (n.type instanceof ArrayType) {

        } else if (n.type instanceof TupleType || n.type instanceof StructType) {

        } else {
            throw new ImplementationError()
        }
    }
    */

    /**
     * Returns true if the expression denoted by 'node' must be evaluted with processLeftHandSide.
     * For example in "a.b.c" the expression "a.b" must be processed with processLeftHandSide, because
     * otherwise we would get a copy of the struct denoted by "a.b".
     */
    public isLeftHandSide(node: Node): boolean {
        if (node.op == "id") {
            return true;
//        } else if (node.op == "unary*") {
//            return true;
        } else if (node.op == ".") {
            if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType) {
                return true;
            }
            return this.isLeftHandSide(node.lhs);
        } else if (node.op == "[") {
            if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof SliceType) {
                return true;
            }
            return this.isLeftHandSide(node.lhs);
        }
        return false;
    }

    private createInterfaceTable(iface: InterfaceType, s: StructType): Array<backend.Function | backend.FunctionImport> {
        let table: Array<backend.Function | backend.FunctionImport> = [];
        let dtr: backend.Function = this.generateStructDestructor(s);
        for(let m of iface.sortMethodNames()) {
            if (m == "__dtr__") {
                table.push(dtr);
                continue;
            }
            let method = s.method(m);
            let methodObjType = RestrictedType.strip((RestrictedType.strip(method.objectType) as types.PointerType).elementType);
            if (!(methodObjType instanceof types.StructType)) {
                throw new ImplementationError()
            }
            let methodName = methodObjType.pkg.pkgPath + "/" + methodObjType.name + "." + m;
            let f = s.pkg.scope.resolveElement(methodName);
            if (!(f instanceof Function)) {
                throw new ImplementationError()
            }
            let wf = this.funcs.get(f);
            table.push(wf);
        }
        return table;
    }

    private createInterfaceDescriptor(ifaceType: InterfaceType, structType: StructType): number {
        // Assign a pointer to some struct to a pointer to some interface? -> create an ifaceHeader instance
        let typecode = RestrictedType.strip(ifaceType).toTypeCodeString() + "::" + RestrictedType.strip(structType).toTypeCodeString();
        let descriptor: number;
        if (this.ifaceDescriptors.has(typecode)) {
            descriptor = this.ifaceDescriptors.get(typecode);
        } else {
            let table = this.createInterfaceTable(ifaceType, structType);
            descriptor = this.backend.addInterfaceDescriptor(typecode, table);
            this.ifaceDescriptors.set(typecode, descriptor);
        }
        return descriptor;
    }

    private createTypeDescriptor(t: Type): number {
        let typecode = t.toTypeCodeString();
        if (this.ifaceDescriptors.has(typecode)) {
            return this.ifaceDescriptors.get(typecode);
        }
        let table: Array<backend.Function | backend.FunctionImport> = [];
        if (helper.isPureValue(t)) {
            table.push(null);
        } else {
            let dtr: backend.Function = this.generateDestructor(t);
            table.push(dtr);
        }
        let descriptor = this.backend.addInterfaceDescriptor(typecode, table);
        this.ifaceDescriptors.set(typecode, descriptor);
        return descriptor;
    }

    public autoConvertData(data: ssa.Variable | number | ssa.Pointer, targetType: Type, fromType: Type, b: ssa.Builder): ssa.Variable | number {
        let v: ssa.Variable | number;
        if (data instanceof ssa.Pointer) {
            v = b.assign(b.tmp(), "load", this.getSSAType(fromType), [data.variable, data.offset]);
        } else {
            v = data;
        }

        // Convert a normal slice to a local-reference slice
        if (helper.isSlice(fromType) && !helper.isLocalReference(fromType) && helper.isSlice(targetType) && helper.isLocalReference(targetType)) {
            v = b.assign(b.tmp(), "member", this.localSlicePointer, [v, 0]);
        } else if (helper.isInterface(targetType) && !helper.isInterface(fromType)) {
            // Assign a pointer to some struct to a pointer to some interface? -> create an ifaceHeader instance
            if (!helper.isSafePointer(fromType)) {
                throw new ImplementationError()
            }
            let structType = RestrictedType.strip((RestrictedType.strip(fromType) as PointerType).elementType);
            let ifaceType = RestrictedType.strip((RestrictedType.strip(targetType) as PointerType).elementType);
            if (!(structType instanceof StructType)) {
                throw new ImplementationError()
            }
            if (!(ifaceType instanceof InterfaceType)) {
                throw new ImplementationError()
            }
            let descriptor = this.createInterfaceDescriptor(ifaceType, structType);
            let d = b.assign(b.tmp(), "table_iface", "addr", [descriptor]);
            v = b.assign(b.tmp(), "struct", this.ifaceHeader, [v, d]);
        } else if (helper.isOrType(targetType) && !helper.isOrType(fromType)) {
            let s = this.getSSAType(targetType);
            let ut = (s as ssa.StructType).fieldTypeByName("value");
            let idx = this.tc.orTypeIndex(targetType as OrType, fromType, false);
            let u = b.assign(b.tmp(), "union", ut, [idx, v]);
            let d = b.assign(b.tmp(), "table_iface", "addr", [this.createTypeDescriptor((targetType as OrType).types[idx])]);
            v = b.assign(b.tmp(), "struct", s, [u, d]);
        }
        // TODO: Encode data for an any
        /*
        if ((helper.isInterface(targetType) || helper.isComplexOrType(targetType)) && !helper.isInterface(enode.type) && !helper.isComplexOrType(enode.type)) {
            // TODO: Do not use instanceof here
            if (helper.isUnsafePointer(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type instanceof PointerType && enode.type.elementType instanceof StructType) {
                let index = this.createInterfaceTable(scope, enode.type.elementType);
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), v, index]);
            } else if (this.tc.checkIsPointer(enode, false) || helper.isString(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), v, 0]);
            } else if (helper.isSlice(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderSlice, [this.typecode(enode.type), v]);
            } else if (helper.isArray(enode.type)) {
                // TODO: Copy to allocated area
                throw new TodoError()
            } else if (helper.isStruct(enode.type)) {
                throw new TodoError()
            } else if (enode.type == Static.t_int64 || enode.type == Static.t_uint64) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == Static.t_float) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderFloat, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == Static.t_double) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderDouble, [this.typecode(enode.type), 0, v]);
            } else if (helper.isNumber(enode.type) || enode.type == Static.t_bool) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == Static.t_null) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, 0]);
            } else if (enode.type instanceof StringLiteralType) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, 0]);
            } else if (helper.isOrType(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [v, 0, 0]);
            } else {
                throw new ImplementationError(enode.type.toString())
            }
        } else if (!helper.isInterface(targetType) && !helper.isComplexOrType(targetType) && (helper.isInterface(enode.type) || helper.isComplexOrType(enode.type))) {
            return this.processUnboxInterface(targetType, v, b);
        }
        */
        return v;
    }

    /*
    private processUnboxInterface(targetType: Type, v: number | ssa.Variable, b: ssa.Builder): ssa.Variable | number {
        let addr = b.assign(b.tmp("addr"), "addr_of", "addr", [v]);
        if (helper.isUnsafePointer(targetType)) {
            return b.assign(b.tmp(), "load", "addr", [addr, this.ifaceHeader32.fieldOffset("value")]);
        } else if (helper.isSafePointer(targetType) || helper.isString(targetType)) {
            return b.assign(b.tmp(), "load", "ptr", [addr, this.ifaceHeader.fieldOffset("pointer")]);
        } else if (helper.isSlice(targetType)) {
            return b.assign(b.tmp(), "load", this.slicePointer, [addr, this.ifaceHeaderSlice.fieldOffset("value")]);
        } else if (helper.isArray(targetType)) {
            // TODO: Copy to allocated area
            throw new TodoError()
        } else if (helper.isStruct(targetType)) {
            throw new TodoError()
        } else if (targetType == Static.t_int64 || targetType == Static.t_uint64) {
            return b.assign(b.tmp(), "load", "i64", [addr, this.ifaceHeader.fieldOffset("value")]);
        } else if (targetType == Static.t_double) {
            return b.assign(b.tmp(), "load", "f64", [addr, this.ifaceHeaderDouble.fieldOffset("value")]);
        } else if (targetType == Static.t_float) {
            return b.assign(b.tmp(), "load", "f32", [addr, this.ifaceHeaderFloat.fieldOffset("value")]);
        } else if (helper.isNumber(targetType) || targetType == Static.t_bool) {
            return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("value")]);
        } else if (helper.isOrType(targetType)) {
            return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("typecode")]);
        } else {
            throw new ImplementationError()
        }
    }
    */

    /**
     * The same as processExpression except that it destructs/decrefs/unlocks all data structures that have been
     * increfed/locked while computing this expression.
     * This is safe if the type of the expression is a pure value type or if the expression is a take expression.
     * For all other expressions, the destruction might free the memory to which returned pointers are pointing.
     */
    private processValueExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | number {
        let dtor: Array<DestructorInstruction> = [];
        let result = this.processExpression(f, scope, enode, b, vars, dtor, "none", false);
        this.processDestructorInstructions(dtor, b);
        return result;
    }

    /**
     * Returns a pointer to a value if possible and otherwise a variable that holds the value.
     * This is required for example by `expr[index]` if `expr` is an array.
     * It does not make sense to copy the array into a variable and then access one of its elements.
     * However, if `expr` is a function call that returns an array, then the array is in a variable anyway.
     * In this case it makes no sense to return a pointer to it.
     */
    private processInnerExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, dtor: Array<DestructorInstruction>, keepAlive: "lock" | "none", noNullPointer: boolean = false): ssa.Variable | ssa.Pointer {
        if (this.isLeftHandSide(enode)) {
            let result = this.processLeftHandExpression(f, scope, enode, b, vars, dtor, "none", true);
            // The promise is that the required value is non-null.
            // So far we only know that the address of the value is not null.
            if (noNullPointer) {
                this.processNullCheck(result, enode.type, b);
            }
            return result;
        }
        let r = this.processExpression(f, scope, enode, b, vars, dtor, keepAlive, noNullPointer);
        if (!(r instanceof ssa.Variable)) {
            throw new ImplementationError();
        }
        return r;
    }

    /**
     *
     * @param dtor is a list with destructor instructions that must be executed after the value computed by the expression
     *             is no longer required. processExpression will append to this list.
     * @param keepAlive determines whether pointers/slices returned by processExpression should either be locked or donated.
     *             processExpression will ignore keep alive if used on types that do not contain any pointers.
     *             Holding and locking both require that the returned pointer is pointing to allocated memory.
     *             Locking means in addition, that the data structure in this memory has not been destructed.
     *             The `dtor` carries information on how to release the holding or locking later.
     */
    private processExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, dtor: Array<DestructorInstruction>, keepAlive: "donate" | "hold" | "lock" | "none", noNullPointer: boolean = false): ssa.Variable | number {
        switch(enode.op) {
            case "null":
            {
                if (noNullPointer) {
                    // The compiler should catch that at type checking time.
                    // Here it is too late to throw a TypeCheck error. Hence, we let it fail on run-time.
                    b.assign(null, "trap", null, []);
                } else {
                    if (helper.isSlice(enode.type)) {
                        if (helper.isLocalReference(enode.type)) {
                            let zeros = this.generateZeroStruct(this.localSlicePointer);
                            return b.assign(b.tmp(), "struct", this.localSlicePointer, zeros);
                        }
                        let zeros = this.generateZeroStruct(this.slicePointer);
                        return b.assign(b.tmp(), "struct", this.slicePointer, zeros);
                    }
                }
                return 0;
            }
            case "int":
                return parseInt(enode.value);
            case "float":
            {
                let v = new ssa.Variable();
                if (enode.type == Static.t_float) {
                    v.type = "f32";
                } else {
                    v.type = "f64";
                }
                v.isConstant = true;
                v.constantValue = parseFloat(enode.value);
                return v;
            }
            case "rune":
                return enode.numValue;
            case "bool":
                return enode.value == "true" ? 1 : 0;
            case "str":
            {
                if (helper.isStringLiteralType(enode.type)) {
                    let idx: number;
                    let sl = RestrictedType.strip(enode.type) as StringLiteralType;
                    if (this.symbols.has(sl.name)) {
                        idx = this.symbols.get(sl.name);
                    } else {
                        idx = this.backend.addSymbol(sl.name);
                        this.symbols.set(sl.name, idx);
                    }
                    return b.assign(b.tmp(), "symbol", ssa.symbolType, [idx]);
                } else {
                    let v = new ssa.Variable();
                    v.isConstant = true;
                    v.constantValue = enode.value;
                    v.type = "addr";
                    return v;
                }
            }
            case "object":
            {
                let t = helper.stripType(enode.type);
                if (t instanceof PointerType) {
                    t = RestrictedType.strip(t.elementType);
                    if (t instanceof StructType) {
                        let st = this.getSSAType(t) as ssa.StructType; // This returns a struct type
                        let ptr = b.assign(b.tmp(), "alloc", "addr", [ssa.sizeOf(st)]);
                        let args: Array<string | ssa.Variable | number> = [];
                        let fieldValues = new Map<string, Node>();
                        if (enode.parameters) {
                            for(let p of enode.parameters) {
                                fieldValues.set(p.name.value, p.lhs);
                            }
                        }
                        for(let i = 0; i < st.fields.length; i++) {
                            if (!fieldValues.has(st.fields[i][0])) {
                                args.push(0);
                            } else {
                                let p = fieldValues.get(st.fields[i][0]);
                                let v = this.processExpression(f, scope, p, b, vars, dtor, "donate");
                                args.push(v);
                            }
                        }
                        let v = b.assign(b.tmp(), "struct", st, args);
                        b.assign(b.mem, "store", st, [ptr, 0, v]);
                        if (keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") {
                            dtor.push(new DestructorInstruction(ptr, enode.type, "destruct"));
                        }
                        return ptr;
                    } else if (t instanceof MapType) {
                        /*
                        let entry = new ssa.StructType()
                        entry.name = "map";
                        entry.addField("hashNext", "addr")
                        entry.addField("listNext", "addr")
                        entry.addField("hash", "i64")
                        entry.addField("key", "ptr")
                        entry.addField("value", this.getSSAType(t.valueType));
                        let m = b.call(b.tmp(), this.createMapFunctionType, [SystemCalls.createMap, enode.parameters ? enode.parameters.length : 4]);
                        if (enode.parameters) {
                            for(let p of enode.parameters) {
                                if (t.keyType != Static.t_string) {
                                    throw new ImplementationError()
                                }
                                // let off = this.backend.addString(p.name.value);
                                let str = new ssa.Variable;
                                str.isConstant = true;
                                str.constantValue = p.name.value;
                                str.type = "addr";
                                let value = this.processLiteralArgument(f, scope, p.lhs, t.valueType, b, vars);
                                let dest = b.call(b.tmp(), this.setMapFunctionType, [SystemCalls.setMap, m, str]);
                                b.assign(b.mem, "store", this.getSSAType(t.valueType), [dest, 0, value]);
                            }
                        }
                        return m;
                        */
                    }
                } else if (t instanceof StructType) {
                    let st = this.getSSAType(t) as ssa.StructType; // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    let fieldValues = new Map<string, Node>();
                    if (enode.parameters) {
                        for(let p of enode.parameters) {
                            fieldValues.set(p.name.value, p.lhs);
                        }
                    }
                    for(let i = 0; i < st.fields.length; i++) {
                        if (!fieldValues.has(st.fields[i][0])) {
//                            if (st.fields[i][1] instanceof ssa.StructType) {
                                // Generate a zero struct
                            //    args.push(this.generateZeroStruct(b, st.fields[i][1] as ssa.StructType));
//                            } else {
                                args.push(0);
//                            }
                        } else {
                            let p = fieldValues.get(st.fields[i][0]);
                            let v = this.processExpression(f, scope, p, b, vars, dtor, "donate");
                            args.push(v);
                        }
                    }
                    let s = b.assign(b.tmp(), "struct", st, args);
                    if ((keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") && !helper.isPureValue(t)) {
                        dtor.push(new DestructorInstruction(s, enode.type, "destruct"));
                    }
                    return s;
                }
                throw new ImplementationError()
            }
            case "make":
            {
                let et = this.getSSAType(enode.lhs.type);
                let esize = ssa.alignedSizeOf(et);
                if (enode.parameters.length > 0) {
                    let len = this.processValueExpression(f, scope, enode.parameters[0], b, vars);
                    let size = len;
                    if (enode.parameters.length == 2) {
                        size = this.processValueExpression(f, scope, enode.parameters[1], b, vars);
                    }
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [size, esize]);
                    let slice = b.assign(b.tmp(), "struct", this.slicePointer, [ptr, len, ptr]);
                    if (keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") {
                        dtor.push(new DestructorInstruction(slice, enode.type, "destruct"));
                    }
                    return slice;
                }
                let ptr = b.assign(b.tmp(), "alloc", "addr", [esize]);
                if (keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") {
                    dtor.push(new DestructorInstruction(ptr, enode.type, "destruct"));
                }
                return ptr;
            }
            case "tuple":
            {
                let st = this.getSSAType(enode.type); // This returns a struct type
                let args: Array<string | ssa.Variable | number> = [];
                for(let i = 0; i < enode.parameters.length; i++) {
                    let v = this.processExpression(f, scope, enode.parameters[i], b, vars, dtor, "donate");
                    args.push(v);
                }
                let tuple = b.assign(b.tmp(), "struct", st, args);
                if ((keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") && !helper.isPureValue(enode.type)) {
                    dtor.push(new DestructorInstruction(tuple, enode.type, "destruct"));
                }
                return tuple;
            }
            case "array":
            {
                let t = helper.stripType(enode.type);
                if (t instanceof SliceType) {
                    let dtor: Array<DestructorInstruction> = [];
                    let et = this.getSSAType(t.getElementType());
                    let esize = ssa.alignedSizeOf(et);
                    let count = enode.parameters.length;
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [count, esize]);
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let p = enode.parameters[i];
                        let v = this.processExpression(f, scope, p, b, vars, dtor, "donate");
                        b.assign(b.mem, "store", et, [ptr, i * esize, v]);
                    }
                    this.processDestructorInstructions(dtor, b);
                    let slice = b.assign(b.tmp(), "struct", this.slicePointer, [ptr, count, ptr]);
                    if (keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") {
                        dtor.push(new DestructorInstruction(slice, enode.type, "destruct"));
                    }
                    return slice;
                } else if (t instanceof ArrayType) {
                    // Ignore keepAlive, since it only applies to pointers
                    let st = this.getSSAType(t); // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    let dtor: Array<DestructorInstruction> = [];
                    for(let i = 0; i < enode.parameters.length; i++) {
                        if (enode.parameters[i].op == "...") {
                            continue;
                        }
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars, dtor, "donate");
                        args.push(v);
                    }
                    this.processDestructorInstructions(dtor, b);
                    let arr = b.assign(b.tmp(), "struct", st, args);
                    if ((keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") && !helper.isPureValue(t)) {
                        dtor.push(new DestructorInstruction(arr, enode.type, "destruct"));
                    }
                    return arr;
                }
                throw new ImplementationError()
            }
            case "==":
                return this.processCompare("eq", f, scope, enode, b, vars);
            case "!=":
                return this.processCompare("ne", f, scope, enode, b, vars);
            case "<":
            {
                let t = helper.stripType(enode.lhs.type);
                if (t == Static.t_float || t == Static.t_double || t == Static.t_string) {
                    return this.processCompare("lt", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && helper.isSigned(t)) {
                    return this.processCompare("lt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("lt_u", f, scope, enode, b, vars);
            }
            case ">":
            {
                let t = helper.stripType(enode.lhs.type);
                if (t == Static.t_float || t == Static.t_double || t == Static.t_string) {
                    return this.processCompare("gt", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && helper.isSigned(t)) {
                    return this.processCompare("gt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("gt_u", f, scope, enode, b, vars);
            }
            case "<=":
            {
                let t = helper.stripType(enode.lhs.type);
                if (t == Static.t_float || t == Static.t_double || t == Static.t_string) {
                    return this.processCompare("le", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && helper.isSigned(t)) {
                    return this.processCompare("le_s", f, scope, enode, b, vars);
                }
                return this.processCompare("le_u", f, scope, enode, b, vars);
            }
            case ">=":
            {
                let t = helper.stripType(enode.lhs.type);
                if (t == Static.t_float || t == Static.t_double || t == Static.t_string) {
                    return this.processCompare("ge", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && helper.isSigned(t)) {
                    return this.processCompare("ge_s", f, scope, enode, b, vars);
                }
                return this.processCompare("ge_u", f, scope, enode, b, vars);
            }
            case "+":
            {
                let t = helper.stripType(enode.type);
                if (t == Static.t_string) {
                    let p1 = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "lock", true);
                    let l1 = b.assign(b.tmp(), "len_str", "sint", [p1]);
                    let p2 = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "none", true);
                    let l2 = b.assign(b.tmp(), "len_str", "sint", [p2]);
                    let l = b.assign(b.tmp(), "add", "sint", [l1, l2]);
                    let lplus = b.assign(b.tmp(), "add", "sint", [l, 1]);
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [lplus, 1]);
                    b.assign(b.mem, "memcpy", null, [ptr, p1, l1, 1]);
                    let ptr2 = b.assign(b.tmp(), "add", "addr", [ptr, l1]);
                    b.assign(b.mem, "memcpy", null, [ptr2, p2, l2, 1]);
                    if (keepAlive == "none" || keepAlive == "hold" || keepAlive == "lock") {
                        dtor.push(new DestructorInstruction(ptr, t, "destruct"));
                    }
                    return ptr;
                }
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                } else {
                    p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                }
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "add", storage, [p1, p2]);
            }
            case "*":
            case "-":
            {
                let t = helper.stripType(enode.type);
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                } else {
                    p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                }
                let storage = this.getSSAType(t);
                let opcode: "mul" | "sub" = enode.op == "*" ? "mul" : "sub";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "/":
            {
                let t = helper.stripType(enode.type);
                let storage = this.getSSAType(t);
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                if (storage == "f32" || storage == "f64") {
                    return b.assign(b.tmp(), "div", storage, [p1, p2]);
                }
                let opcode: "div_u" | "div_s" = helper.isSigned(t) ? "div_s" : "div_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "%":
            {
                let t = helper.stripType(enode.type);
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(t);
                let opcode: "rem_u" | "rem_s" = helper.isSigned(t) ? "rem_s" : "rem_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "|":
            case "&":
            case "^":
            {
                let t = helper.stripType(enode.type);
                let opcode: "or" | "xor" | "and" = enode.op == "|" ? "or" : (enode.op == "&" ? "and" : "xor");
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(t);
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "&^":
            {
                let t = helper.stripType(enode.type);
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(t);
                let tmp = b.assign(b.tmp(), "xor", storage, [p2, -1]);
                return b.assign(b.tmp(), "and", storage, [p1, tmp]);
            }
            case "unary!":
            {
                let t = helper.stripType(enode.type);
                let p = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(t);
                return b.assign(b.tmp(), "eqz", storage, [p]);
            }
            case "unary+":
            {
                return this.processValueExpression(f, scope, enode.rhs, b, vars);
            }
            case "unary-":
            {
                let t = helper.stripType(enode.type);
                let p = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(t);
                if (t == Static.t_float || t == Static.t_double) {
                    return b.assign(b.tmp(), "neg", storage, [p]);
                }
                let tmp = b.assign(b.tmp(), "xor", storage, [p, -1]);
                return b.assign(b.tmp(), "add", storage, [tmp, 1]);
            }
            case "unary^":
            {
                let t = helper.stripType(enode.type);
                let p = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.rhs.type);
                return b.assign(b.tmp(), "xor", storage, [p, -1]);
            }
            case "unary*":
            {
                let t = helper.stripType(enode.rhs.type);
                // No null-check for unsafe pointers
                let p = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "none", (t instanceof PointerType)) as ssa.Variable;
                let result: number | ssa.Variable;
                if (t instanceof UnsafePointerType) {
                    let storage = this.getSSAType(t.elementType);
                    result = b.assign(b.tmp(), "load", storage, [p, 0]);
                } else if (t instanceof PointerType) {
                    let storage = this.getSSAType(t.elementType);
                    result = b.assign(b.tmp(), "load", storage, [p, 0]);
                } else {
                    throw new ImplementationError();
                }
                if ((enode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment) {
                    this.processFillZeros(p, enode.type, b);
                }
                if (helper.isSafePointer(enode.type) || helper.isSlice(enode.type) || helper.isString(enode.type)) {
                    if (noNullPointer) {
                        this.processNullCheck(result, enode.type, b);
                    }
                    if (keepAlive == "donate") {
                        if ((enode.flags & AstFlags.ZeroAfterAssignment) != AstFlags.ZeroAfterAssignment) {
                            this.processIncref(result, enode.type, b, null);
                        }
                    } else if (keepAlive == "hold") {
                        this.processIncref(result, enode.type, b, dtor);
                    } else if (keepAlive == "lock") {
                        if (helper.isString(enode.type)) {
                            this.processIncref(result, enode.type, b, dtor);
                        } else {
                            this.processLock(result, enode.type, b, dtor);
                        }
                    }
                }
                return result;
            }
            case "unary&":
            {
                if (enode.rhs.op == "bool" || enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "str" || enode.rhs.op == "array" || enode.rhs.op == "tuple" || enode.rhs.op == "object") {
                    // Make a copy of a literal
                    let t = helper.stripType(enode.rhs.type);
                    let p = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "donate");
                    let s = this.getSSAType(t);
                    let copy = b.assign(b.tmp(), "alloc", "addr", [ssa.sizeOf(s)]);
                    b.assign(b.mem, "store", s, [copy, 0, p]);
                    if (keepAlive == "hold" || keepAlive == "lock" || keepAlive == "none") {
                        dtor.push(new DestructorInstruction(copy, enode.type, "destruct"));
                    }
                    return copy;
                }
                if (keepAlive == "donate") {
                    throw new ImplementationError("Returning a local reference. It cannot be donated for assignment elsewhere");
                }
                let p = this.processLeftHandExpression(f, scope, enode.rhs, b, vars, dtor, keepAlive == "none" ? "none" : "lock", true);
                if (p instanceof ssa.Pointer) {
                    if (p.offset == 0) {
                        return p.variable;
                    }
                    return b.assign(b.tmp(), "add", "ptr", [p.variable, p.offset]);
                }
                return b.assign(b.tmp(), "addr_of", "ptr", [p]);
            }
            case "||":
            {
                let t = helper.stripType(enode.type);
                let result = b.tmp();
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                b.assign(result, "const", "i8", [1]);
                b.elseBlock();
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                b.assign(result, "copy", "i8", [p2]);
                b.end();
                return result;
            }
            case "&&":
            {
                let t = helper.stripType(enode.type);
                let result = b.tmp();
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                b.assign(result, "copy", "i8", [p2]);
                b.elseBlock();
                b.assign(result, "const", "i8", [0]);
                b.end();
                return result;
            }
            case ">>":
            {
                let t = helper.stripType(enode.type);
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), helper.isSigned(enode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
            }
            case "<<":
            {
                let t = helper.stripType(enode.type);
                let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
                let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), "shl", storage, [p1, p2]);
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                let v = vars.get(element);
                if (!v) {
                    throw new ImplementationError("unknown element " + element.name)
                }
                let storage = this.getSSAType(element.type);
                if (element instanceof Variable && element.isForLoopPointer) {
                    return b.assign(b.tmp(), "load", storage, [v, 0]);
                }
                if ((enode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment) {
                    let copy = b.assign(b.tmp(), "copy", storage, [v]);
                    this.processFillZeros(v, enode.type, b);
                    v = copy;
                }
                if (helper.isSafePointer(enode.type) || helper.isSlice(enode.type) || helper.isString(enode.type)) {
                    if (noNullPointer) {
                        this.processNullCheck(v, enode.type, b);
                    }
                    if (keepAlive == "donate") {
                        if ((enode.flags & AstFlags.ZeroAfterAssignment) != AstFlags.ZeroAfterAssignment) {
                            if ((enode.flags & AstFlags.TakenAfterAssignment) != AstFlags.TakenAfterAssignment) {
                                this.processIncref(v, enode.type, b, null);
                            }
                        }
                    } else if (keepAlive == "hold") {
                        if (this.isThis(v)) {
                            // This is already locked. No need to do anything.
                        } else if (((element instanceof Variable && !element.isReferenced) || element instanceof FunctionParameter)
                                   && (helper.isString(enode.type) || helper.isStrong(element.type) || helper.isUnique(element.type))) {
                            // Variables that are not referenced cannot change their value either.
                            // Function Parameters cannot change their value anyway.
                            // In case the variable is an owning pointer or string, the value pointed to will not be destructed as long as the variable lives.
                            // Hence, nothing to do.
                        } else {
                            this.processIncref(v, enode.type, b, dtor);
                        }
                    } else if (keepAlive == "lock") {
                        if (this.isThis(v)) {
                            // This is already locked. No need to do anything.
                        } else if (((element instanceof Variable && !element.isReferenced) || element instanceof FunctionParameter)
                                   && (helper.isString(enode.type) || helper.isStrong(element.type) || helper.isUnique(element.type))) {
                            // Variables that are not referenced cannot change their value either.
                            // Function Parameters cannot change their value anyway.
                            // In case the variable is an owning pointer or string, the value pointed to will not be destructed as long as the variable lives.
                            // Hence, nothing to do.
                        } else if (helper.isString(enode.type)) {
                            this.processIncref(v, enode.type, b, dtor);
                        } else {
                            this.processLock(v, enode.type, b, dtor);
                        }
                    }
                }
                return v;
            }
            case "(":
            case "spawn":
            {
                let isSpawn = false;
                if (enode.op == "spawn") {
                    isSpawn = true;
                    enode = enode.rhs;
                }
                let f: Function;
                let t: FunctionType;
                let findex: ssa.Variable;
                let args: Array<ssa.Variable | string | number> = [];
                let objPtr: ssa.Variable | number | null = null;
                let iface: ssa.Variable | number;
                let striplhs = helper.stripType(enode.lhs.type);
                let lhs = enode.lhs;
                if (lhs.op == "genericInstance") {
                    lhs = lhs.lhs;
                }
                //
                // Determine the function that is to be called.
                // When calling a member function, determine the `this` pointer as well.
                if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "remove") {
                    if (isSpawn) {
                        throw new TypeError("The function cannot be spawned", enode.loc);
                    }
                    /*
                    let objType = helper.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof MapType)) {
                        throw new ImplementationError()
                    }
                    let m = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType);
                    let key = this.processExpression(f, scope, enode.parameters[0], b, vars, objType.keyType);
                    if (objType.keyType == Static.t_string) {
                        return b.call(b.tmp(), this.removeMapKeyFunctionType, [SystemCalls.removeMapKey, m, key]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (objType.keyType == Static.t_int64 || objType.keyType == Static.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(objType.keyType), [key]);
                        }
                        return b.call(b.tmp(), this.removeNumericMapKeyFunctionType, [SystemCalls.removeNumericMapKey, m, key64]);
                    } */
                    throw new TodoError()
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system") {
                    if (isSpawn) {
                        throw new TypeError("The function cannot be spawned", enode.loc);
                    }
                    // A built-in function. Nothing to do here
                    t = striplhs;
                } else if (lhs.op == "id") {
                    // Calling a named function
                    let e = scope.resolveElement(lhs.value);
                    if (e instanceof TemplateFunction) {
                        if (!(enode.lhs.type instanceof TemplateFunctionType)) {
                            throw new ImplementationError()
                        }
                        let name = e.type.pkg.pkgPath + "/" + lhs.value + TypeChecker.mangleTemplateParameters(enode.lhs.type.templateParameterTypes);
                        e = this.tc.pkg.scope.resolveElement(name);
                    }
                    if (!(e instanceof Function)) {
                        throw new ImplementationError()
                    }
                    f = e;
                    t = f.type;
                } else if (lhs.op == "." && lhs.lhs.type instanceof PackageType) {
                    // Calling a function of some package?
                    let pkg = lhs.lhs.type.pkg;
                    let name = lhs.name.value;
                    let e = pkg.scope.resolveElement(name);
                    if (e instanceof TemplateFunction) {
                        if (!(enode.lhs.type instanceof TemplateFunctionType)) {
                            throw new ImplementationError()
                        }
                        let name = e.type.pkg.pkgPath + "/" + lhs.name.value + TypeChecker.mangleTemplateParameters(enode.lhs.type.templateParameterTypes);
                        e = this.tc.pkg.scope.resolveElement(name);
                    }
                    if (!(e instanceof Function)) {
                        throw new ImplementationError()
                    }
                    f = e;
                    t = f.type;
                } else if (lhs.op == ".") {
                    // Calling a member function.
                    // First, compute `this`.
                    let ltype = helper.stripType(lhs.lhs.type);
                    let objType: Type;
                    if (ltype instanceof PointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        if (objType instanceof InterfaceType) {
                            iface = this.processExpression(f, scope, lhs.lhs, b, vars, dtor, isSpawn ? "none" : "lock", true);
                            objPtr = b.assign(b.tmp(), "member", "addr", [iface, this.ifaceHeader.fieldIndexByName("pointer")]);
                            if (isSpawn) {
                                // Lock here. Unlock happens in the wrapper.
                                this.processLock(objPtr, ltype, b, null);
                            }
                        } else {
                            objPtr = this.processExpression(f, scope, lhs.lhs, b, vars, dtor, isSpawn ? "none" : "lock", true);
                            if (isSpawn) {
                                // Lock here. Unlock happens in the wrapper.
                                this.processLock(objPtr as ssa.Variable, ltype, b, null);
                            }
                        }
                    } else if (ltype instanceof UnsafePointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        objPtr = this.processExpression(f, scope, lhs.lhs, b, vars, dtor, "none", false);
                    } else if (ltype instanceof StructType) {
                        objType = ltype;
                        // Use processInnerExpression, to avoid copying the struct, which might be expensive.
                        let sPtr = this.processInnerExpression(f, scope, lhs.lhs, b, vars, dtor, "lock", true);
                        if (sPtr instanceof ssa.Variable) {
                            objPtr = b.assign(b.tmp(), "addr_of", "addr", [sPtr]);
                        } else if (sPtr instanceof ssa.Pointer) {
                            if (sPtr.offset != 0) {
                                objPtr = b.assign(b.tmp(), "add", "addr", [sPtr.variable, sPtr.offset]);
                            } else {
                                objPtr = sPtr.variable;
                            }
                        } else {
                            throw new ImplementationError();
                        }
                    } else {
                        throw new ImplementationError()
                    }
                    // Determine the member function to call
                    if (objType instanceof StructType) {
                        let method = objType.method(lhs.name.value);
                        let methodObjType = RestrictedType.strip(method.objectType);
                        methodObjType = RestrictedType.strip(method.objectType);
                        if (methodObjType instanceof PointerType) {
                            methodObjType = RestrictedType.strip(methodObjType.elementType);
                        }
                        let methodName = TypeChecker.mangledTypeName(methodObjType) + "." + lhs.name.value;
                        let e = scope.resolveElement(methodName);
                        if (!(e instanceof Function)) {
                            throw new ImplementationError("call to unknown member function " + methodName, lhs.loc)
                        }
                        f = e;
                        t = f.type;
                    } else if (objType instanceof InterfaceType) {
                        let table: ssa.Variable;
                        if (iface instanceof ssa.Pointer) {
                            table = b.assign(b.tmp(), "load", "addr", [iface.variable, iface.offset + this.ifaceHeader.fieldOffset("table")]);
                        } else {
                            table = b.assign(b.tmp(), "member", "addr", [iface, this.ifaceHeader.fieldIndexByName("table")]);
                        }
                        let name = lhs.name.value;
                        let idx = objType.methodIndex(name);
                        findex = b.assign(b.tmp(), "load", "addr", [table, idx * ssa.sizeOf("addr")]);
                        t = objType.method(name);
                    } else {
                        throw new ImplementationError()
                    }
                } else {
                    // Calling a lamdba function
                    t = lhs.type as FunctionType;
                }
                let ft = this.getSSAFunctionType(t);

                // Is a wrapper function required to spawn the function?
                let wrapper_ft: ssa.FunctionType;
                let wrapper: backend.Function;
                if (isSpawn && this.spawnNeedsWrapper(t)) {
                    // Declare a wrapper function at the backend as anonymous function
                    wrapper = this.backend.declareFunction(null);
                    // Create the IR for the wrapper function
                    let wrapper_b = new ssa.Builder();
                    // Determine the type of the wrapper function
                    if (findex) {
                        // The wrapper accepts a function pointer as its first argument
                        let params = [].concat(ft.params);
                        params.unshift("addr");
                        wrapper_ft = new ssa.FunctionType(params, ft.result, ft.callingConvention);
                    } else {
                        // The wrapper has the same type as the spawn'd function
                        wrapper_ft = ft;
                    }
                    let node = wrapper_b.define(wrapper.getName(), wrapper_ft);
                    let wargs: Array<ssa.Variable | number> = [];
                    // Add the real function to the arguments for `call`
                    if (f) {
                        if (!this.funcs.has(f)) {
                            // this.funcs.set(f, this.backend.importFunction(f.name, f.scope.package(), this.getSSAFunctionType(f.type)));
                            this.funcs.set(f, this.backend.importFunction(f.name, f.nativePackageName ? f.nativePackageName : f.scope.package(), this.getSSAFunctionType(f.type)));
                        }
                        wargs.push(this.funcs.get(f).getIndex());
                    } else if (findex) {
                        wargs.push(findex);
                    }
                    // Declare all IR parameters of the wrapper
                    for(let i = 0; i < ft.params.length; i++) {
                        wargs.push(wrapper_b.declareParam(ft.params[i], "p" + i.toString()));
                    }
                    let wrapper_dtor: Array<DestructorInstruction> = [];
                    // Call the real function
                    if (findex) {
                        // The wrapper accepts a function pointer as its first argument
                        wargs.unshift(wrapper_b.declareParam("addr", "findex"));
                        wrapper_b.callIndirect(null, wrapper_ft, wargs);
                    } else {
                        // The wrapper has the same type as the spawn'd function
                        wrapper_ft = ft;
                        wrapper_b.call(null, wrapper_ft, wargs);
                    }
                    // Free/decref
                    if (objPtr !== null) {
                        // The callee donated a reference, but the function does not consume it.
                        // Hence, free/decref that argument that has been passed to the function
                        wrapper_dtor.push(new DestructorInstruction(wargs[1] as ssa.Variable, lhs.lhs.type, "unlock"));
                    }
                    for(let i = 0; i < t.requiredParameterCount(); i++) {
                        let pnode = t.parameters[i];
                        if (!helper.isStrong(pnode.type) && !helper.isUnique(pnode.type)) {
                            // The callee donated a reference, but the function does not consume it.
                            // Hence, free/decref that argument that has been passed to the function
                            wrapper_dtor.push(new DestructorInstruction(wargs[i + 1] as ssa.Variable, pnode.type, "destruct"));
                        }
                    }
                    // Free the additional slice
                    if (t.hasEllipsis()) {
                        wrapper_dtor.push(new DestructorInstruction(wargs[wargs.length - 1] as ssa.Variable, new SliceType((t.lastParameter().type as SliceType).arrayType, "strong"), "destruct"));
                    }
                    // `this` will be unlocked here and all donated references free'd.
                    this.processDestructorInstructions(wrapper_dtor, wrapper_b);
                    // Push the IR code to the backend
                    this.backend.defineFunction(node, wrapper, false, false);
                }

                // Add the function to the argument list
                if (wrapper) {
                    // Call the wrapper instead of the real function.
                    args.push(wrapper.getIndex());
                    if (findex) {
                        args.push(findex);
                    }
                } else if (f) {
                    if (!this.funcs.has(f)) {
                        // this.funcs.set(f, this.backend.importFunction(f.name, f.scope.package(), this.getSSAFunctionType(f.type)));
                        this.funcs.set(f, this.backend.importFunction(f.name, f.nativePackageName ? f.nativePackageName : f.scope.package(), this.getSSAFunctionType(f.type)));
                    }
                    args.push(this.funcs.get(f).getIndex());
                } else if (findex) {
                    args.push(findex);
                }

                // Add 'this' to the arguments
                if (objPtr !== null) {
                    let data: ssa.Variable | number;
                    if (objPtr instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "add", "addr", [objPtr.variable, objPtr.offset]);
                    } else {
                        data = objPtr;
                    }
                    args.push(data);
                }

                // Compute function arguments
                // TODO: Evaluate parameters from right to left as in C
                if (t.hasEllipsis() && (enode.parameters.length != t.parameters.length || enode.parameters[enode.parameters.length - 1].op != "unary...")) {
                    // The function is variadic
                    let elementType = this.getSSAType((t.lastParameter().type as SliceType).getElementType());
                    let normalParametersCount = t.parameters.length - 1 - (t.objectType ? 1 : 0);
                    for(let i = 0; i < normalParametersCount; i++) {
                        let pnode = enode.parameters[i];
                        let data: ssa.Variable | number;
                        if (helper.isStrong(pnode.type) || helper.isUnique(pnode.type) || wrapper) {
                            data = this.processExpression(f, scope, pnode, b, vars, dtor, "donate", false);
                        } else {
                            data = this.processExpression(f, scope, pnode, b, vars, dtor, "hold", false);
                        }
                        args.push(data);
                    }
                    let elementSize = ssa.alignedSizeOf(elementType);
                    let mem = b.assign(b.tmp("ptr"), "alloc_arr", "addr", [enode.parameters.length - normalParametersCount, elementSize]);
                    let offset = 0;
                    for(let i = normalParametersCount; i < enode.parameters.length; i++, offset += elementSize) {
                        let pnode = enode.parameters[i];
                        let data: ssa.Variable | number;
                        if (helper.isStrong(pnode.type) || helper.isUnique(pnode.type) || wrapper) {
                            data = this.processExpression(f, scope, pnode, b, vars, dtor, "donate", false);
                        } else {
                            data = this.processExpression(f, scope, pnode, b, vars, dtor, "hold", false);
                        }
                        b.assign(b.mem, "store", elementType, [mem, offset, data]);
                    }
                    dtor.push(new DestructorInstruction(mem, t.lastParameter().type, "destruct"));
                    args.push(b.assign(b.tmp(), "struct", this.localSlicePointer, [mem, enode.parameters.length - normalParametersCount]));
                } else if (enode.parameters) {
                    // The function is not variadic
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let pnode = enode.parameters[i];
                        let vnode = pnode.op == "unary..." ? pnode.rhs : pnode;
                        let data: ssa.Variable | number;
                        if (helper.isStrong(pnode.type) || helper.isUnique(pnode.type) || wrapper) {
                            data = this.processExpression(f, scope, vnode, b, vars, dtor, "donate", false);
                        } else {
                            data = this.processExpression(f, scope, vnode, b, vars, dtor, "hold", false);
                        }
                        args.push(data);
                    }
                }

                let result: ssa.Variable | number;
                if (wrapper) {
                    // Spawn via a wrapper function that unlocks/decrefs the parameters.
                    if (!isSpawn) {
                        throw new ImplementationError();
                    }
                    b.spawn(wrapper_ft, args);
                    result = 0;
                } else if (f) {
                    // let ft = this.getSSAFunctionType(t);
                    if (isSpawn) {
                        b.spawn(ft, args);
                        result = 0;
                    } else {
                        result = b.call(b.tmp(), ft, args);
                    }
                } else if (findex) {
                    // let ft = this.getSSAFunctionType(t);
                    if (isSpawn) {
                        result =  b.spawnIndirect(b.tmp(), ft, args);
                    } else {
                        result = b.callIndirect(b.tmp(), ft, args);
                    }
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.abs32) {
                    result = b.assign(b.tmp(), "abs", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.abs64) {
                    result = b.assign(b.tmp(), "abs", "f64", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.floor32) {
                    result = b.assign(b.tmp(), "floor", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.floor64) {
                    result = b.assign(b.tmp(), "floor", "f64", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.ceil32) {
                    result = b.assign(b.tmp(), "ceil", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.ceil64) {
                    result = b.assign(b.tmp(), "ceil", "f64", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.sqrt32) {
                    result = b.assign(b.tmp(), "sqrt", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.sqrt64) {
                    result = b.assign(b.tmp(), "sqrt", "f64", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.trunc32) {
                    result = b.assign(b.tmp(), "trunc", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.trunc64) {
                    result = b.assign(b.tmp(), "trunc", "f64", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.nearest32) {
                    result = b.assign(b.tmp(), "nearest", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.nearest64) {
                    result = b.assign(b.tmp(), "nearest", "f64", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.copysign32) {
                    result = b.assign(b.tmp(), "copysign", "f32", [args[0]]);
                } else if (t.callingConvention == "system" && t.systemCallType == SystemCalls.copysign64) {
                    result = b.assign(b.tmp(), "copysign", "f64", [args[0]]);
                } else {
                    throw new TodoError("call a lambda function")
                }

                if (typeof(result) == "number") {
                    // Nothing to do
                } else if (helper.isSafePointer(enode.type) || helper.isSlice(enode.type) || helper.isString(enode.type)) {
                    if (noNullPointer) {
                        this.processNullCheck(result, enode.type, b);
                    }
                    if (keepAlive == "donate") {
                        // Do nothing, the result is already incredef upon return and can be donated.
                    } else {
                        // Do nothing yet, the result is already incredef upon return.
                        // But later, decrease the reference count for references or destruct for strong or unique pointers.
                        // In case the returned pointer is a reference, locking must be performed in addition.
                        // Otherwise, holding an owning pointer feels like a lock already.
                        if (helper.isUnique(t.returnType) || helper.isStrong(t.returnType)) {
                            dtor.push(new DestructorInstruction(result, t.returnType, "destruct"));
                        } else {
                            if (keepAlive == "lock") {
                                this.processLock(result, enode.type, b, dtor);
                            }
                            dtor.push(new DestructorInstruction(result, t.returnType, "decref"));
                        }
                    }
                } else if (keepAlive != "donate" && !helper.isPureValue(t.returnType)) {
                    // Got a value containing pointers. Destruct the value afterwards.
                    dtor.push(new DestructorInstruction(result, t.returnType, "destruct"));
                }

                return result;
            }
            case ":":
            {
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                let index1: ssa.Variable | number = 0;
                if (enode.parameters[0]) {
                    if (enode.parameters[0].op == "int") {
                        index1 = parseInt(enode.parameters[0].value);
                    } else {
                        index1 = this.processValueExpression(f, scope, enode.parameters[0], b, vars);
                    }
                }
                let index2: ssa.Variable | number = 0;
                if (enode.parameters[1]) {
                    if (enode.parameters[1].op == "int") {
                        index2 = parseInt(enode.parameters[1].value);
                    } else {
                        index2 = this.processValueExpression(f, scope, enode.parameters[1], b, vars);
                    }
                }
                let t = helper.stripType(enode.lhs.type);
                if (t instanceof UnsafePointerType) {
                    if (!helper.isLocalReference(enode.type)) {
                        throw new ImplementationError()
                    }
                    let size = ssa.alignedSizeOf(this.getSSAType(t.elementType));
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;
                    } else {
                        l = b.assign(b.tmp(), "sub", "sint", [index2, index1]);
                    }
                    if (index1 != 0) {
                        if (size != 1) {
                            if (typeof(index1) == "number") {
                                ptr = b.assign(b.tmp("ptr"), "add", "sint", [ptr, index1 * size]);
                            } else {
                                let tmp = b.assign(b.tmp(), "mul", "sint", [index1, size]);
                                ptr = b.assign(b.tmp("ptr"), "add", "sint", [ptr, tmp]);
                            }
                        } else {
                            ptr = b.assign(b.tmp("ptr"), "add", "sint", [ptr, index1]);
                        }
                    }
                    return b.assign(b.tmp(), "struct", this.localSlicePointer, [ptr, l]);
                } else if (t instanceof SliceType) {
                    let size = ssa.alignedSizeOf(this.getSSAType(t.getElementType()));
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive);
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    let array_ptr: ssa.Variable;
                    if (t.mode == "local_reference") {
                        data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        len = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        if (!helper.isLocalReference(enode.type)) {
                            array_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr")]);
                        }
                        let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        len = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i8", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    if (enode.parameters[1] && index2 !== 0) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i8", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else if (!enode.parameters[1]) {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || (index2 instanceof ssa.Variable && index2 !== len)) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i8", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;
                    } else {
                        l = b.assign(b.tmp(), "sub", "sint", [index2, index1]);
                    }
                    if (index1 != 0) {
                        if (size != 1) {
                            if (typeof(index1) == "number") {
                                data_ptr = b.assign(b.tmp(), "add", "addr", [data_ptr, index1 * size]);
                            } else {
                                let tmp = b.assign(b.tmp(), "mul", "sint", [index1, size]);
                                data_ptr = b.assign(b.tmp(), "add", "addr", [data_ptr, tmp]);
                            }
                        } else {
                            data_ptr = b.assign(b.tmp(), "add", "addr", [data_ptr, index1]);
                        }
                    }
                    if (helper.isLocalReference(enode.type)) {
                        if (helper.isTakeExpression(enode.lhs)) {
                            throw new ImplementationError()
                        }
                        return b.assign(b.tmp(), "struct", this.localSlicePointer, [data_ptr, l]);
                    }
//                    if (helper.isReference(enode.type) && !helper.isTakeExpression(enode.lhs)) {
//                        b.assign(null, "incref_arr", null, [array_ptr]);
//                    }
                    return b.assign(b.tmp(), "struct", this.slicePointer, [data_ptr, l, array_ptr]);
                } else if (t == Static.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    let len = b.assign(b.tmp(), "len_str", "sint", [ptr]);
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i8", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    if (enode.parameters[1] && index2 !== 0) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i8", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else if (!enode.parameters[2]) {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || (index2 instanceof ssa.Variable && index2 != len)) {
                        let cmp = b.assign(b.tmp(), "gt_s", "sint", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    let ptr3 = b.assign(b.tmp(), "add", "addr", [ptr, index1]);
                    let l: ssa.Variable | number;
                    let copyLen: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1 + 1;
                        copyLen = index2 - index1;
                    } else {
                        copyLen = b.assign(b.tmp(), "sub", "sint", [index2, index1]);
                        l = b.assign(b.tmp(), "add", "sint", [copyLen, 1]);
                    }
                    // This is allocating one byte more. Optimization: Do not use calloc. But then add a trailing zero!
                    let result = b.assign(b.tmp(), "alloc_arr", "addr", [l, 1]);
                    b.assign(b.mem, "memcpy", null, [result, ptr3, copyLen, 1]);
                    if (keepAlive != "donate") {
                        dtor.push(new DestructorInstruction(result, Static.t_string, "destruct"));
                    }
                    return result;
                } else if (t instanceof ArrayType) {
                    if (keepAlive == "donate") {
                        // An array is a value type. A pointer to it cannot be donated in the general case.
                        throw new ImplementationError();
                    }
                    let ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars, dtor, keepAlive);
                    let len = t.size;
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i8", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i8", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i8", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    let ptr2: ssa.Pointer;
                    if (ptr instanceof ssa.Variable) {
                        ptr2 = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [ptr]), 0);
                    } else {
                        ptr2 = ptr;
                    }
                    let st = this.getSSAType(t.elementType);
                    let size = ssa.alignedSizeOf(st);
                    let ptr3: ssa.Variable;
                    if (typeof(index1) == "number") {
                        if (index1 != 0) {
                            ptr3 = b.assign(b.tmp(), "add", "addr", [ptr2.variable, ptr2.offset + size * index1]);
                        } else if (ptr2.offset != 0) {
                            ptr3 = b.assign(b.tmp(), "add", "addr", [ptr2.variable, ptr2.offset]);
                        } else {
                            ptr3 = ptr2.variable;
                        }
                    } else {
                        let tmp = ptr2.variable;
                        let offset = index1;
                        if (size != 1) {
                            offset = b.assign(b.tmp(), "mul", "sint", [tmp, size]);
                        }
                        if (ptr2.offset != 0 ) {
                            tmp = b.assign(b.tmp(), "add", "addr", [ptr2.variable, ptr2.offset]);
                        }
                        ptr3 = b.assign(b.tmp(), "add", "addr", [tmp, offset]);
                    }
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;
                    } else {
                        l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    }
                    if (helper.isLocalReference(enode.type)) {
                        return b.assign(b.tmp(), "struct", this.localSlicePointer, [ptr3, l]);
                    }
                    let arrayPtr: ssa.Variable;
                    if (ptr2.offset == 0) {
                        arrayPtr = ptr2.variable;
                    } else {
                        arrayPtr = b.assign(b.tmp(), "add", "addr", [ptr2.variable, ptr2.offset]);
                    }
                    return b.assign(b.tmp(), "struct", this.slicePointer, [ptr3, l, arrayPtr]);
                } else {
                    throw new ImplementationError()
                }
            }
            case "[":
            {
                let result: ssa.Variable;
                let t = helper.stripType(enode.lhs.type);
                let take = ((enode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment);
                if (t instanceof MapType) {
                    /*
                    let m = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let key = this.processExpression(f, scope, enode.rhs, b, vars, t.keyType);
                    let result: ssa.Variable;
                    if (t.keyType == Static.t_string) {
                        result = b.call(b.tmp(), this.lookupMapFunctionType, [SystemCalls.lookupMap, m, key]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (t.keyType == Static.t_int64 || t.keyType == Static.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(t.keyType), [key]);
                        }
                        result = b.call(b.tmp(), this.lookupNumericMapFunctionType, [SystemCalls.lookupNumericMap, m, key64]);
                    }
                    let check = b.assign(b.tmp("i32"), "eqz", "addr", [result]);
                    if (!this.disableNullCheck && !this.isThis(check)) {
                        b.ifBlock(check);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    return b.assign(b.tmp(), "load", this.getSSAType(helper.stripType(t.valueType)), [result, 0]);
                    */
                } else if (t == Static.t_string) {
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    }
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    let len = b.assign(b.tmp(), "len_arr", "sint", [ptr]);
                    // Compare 'index' with 'len'
                    let trap = b.assign(b.tmp(), "ge_u", "int", [index, len]);
                    // let zero = b.assign(b.tmp(), "eqz", "addr", [ptr]);
                    // let trap = b.assign(b.tmp(), "or", "i32", [cmp, zero]);
                    b.ifBlock(trap);
                    b.assign(null, "trap", null, []);
                    b.end();
                    if (typeof(index) == "number") {
                        return b.assign(b.tmp(), "load", "i8", [ptr, index]);
                    }
                    let tmp = b.assign(b.tmp(), "add", "addr", [ptr, index]);
                    // Ignore keepAlive here. The returned rune is unaffected, because it is no pointer type.
                    return b.assign(b.tmp(), "load", "i8", [tmp, 0]);
                } else if (t instanceof UnsafePointerType) {
                    // Unsafe pointers cannot be locked or hold. Ignore keepAlive
                    let ptr = this.processValueExpression(f, scope, enode.lhs, b, vars);
                    if (!(ptr instanceof ssa.Variable)) {
                        ptr = b.assign(b.tmp(), "copy", this.getSSAType(t), [ptr]);
                    }
                    let index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    let et = this.getSSAType(t.elementType);
                    let size = ssa.alignedSizeOf(et);
                    let offset = 0;
                    if (typeof(index) == "number") {
                        offset = index * size;
                    } else {
                        if (size != 1) {
                            index = b.assign(b.tmp(), "mul", "sint", [index, size]);
                        }
                        ptr = b.assign(b.tmp(), "add", "addr", [ptr, index]);
                    }
                    result = b.assign(b.tmp(), "load", et, [ptr, offset]);
                    if (take) {
                        this.processFillZeros(new ssa.Pointer(ptr, offset), enode.type, b);
                    }
                } else if (t instanceof SliceType) {
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    }
                    let et = this.getSSAType(t.getElementType());
                    let size = ssa.alignedSizeOf(et);
                    let head_addr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, take ? "lock" : "none", true);
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    if (t.mode == "local_reference") {
                        data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        len = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        let tmp1 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        data_ptr = b.assign(b.tmp(), "member", "addr", [tmp1, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        let tmp2 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        len = b.assign(b.tmp(), "member", "sint", [tmp2, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                    // Compare 'index' with 'len'
                    let cmp = b.assign(b.tmp(), "ge_u", "i8", [index, len]);
                    b.ifBlock(cmp);
                    b.assign(null, "trap", null, []);
                    b.end();
                    let offset = 0;
                    let ptr = data_ptr;
                    if (typeof(index) == "number") {
                        offset = index * size;
                    } else {
                        if (size != 1) {
                            index = b.assign(b.tmp(), "mul", "sint", [index, size]);
                        }
                        ptr = b.assign(b.tmp(), "add", "addr", [data_ptr, index]);

                    }
                    result = b.assign(b.tmp(), "load", et, [ptr, offset]);
                    if (take) {
                        this.processFillZeros(new ssa.Pointer(ptr, offset), enode.type, b);
                    }
                } else if (t instanceof ArrayType) {
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    }
                    let et = this.getSSAType(t.getElementType());
                    let size = ssa.alignedSizeOf(et);
                    let ptr = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, take ? "lock" : "none", true);
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "addr", [ptr]);
                    }
                    // Compare 'index' with 'len'
                    if (typeof(index) == "number") {
                        if (index < 0 || index >= t.size * size) {
                            throw new ImplementationError(index + " " + t.size )
                        }
                    } else {
                        let cmp = b.assign(b.tmp(), "ge_u", "int", [index, t.size]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();
                    }
                    let offset = 0;
                    if (typeof(index) == "number") {
                        offset = index * size;
                        if (ptr instanceof ssa.Pointer) {
                            offset += ptr.offset;
                            ptr = ptr.variable;
                        }
                    } else {
                        if (size != 1) {
                            index = b.assign(b.tmp(), "mul", "sint", [index, size]);
                        }
                        if (ptr instanceof ssa.Pointer) {
                            offset = ptr.offset;
                            ptr = b.assign(b.tmp(), "add", "addr", [ptr.variable, index]);
                        } else {
                            ptr = b.assign(b.tmp(), "add", "addr", [ptr, index]);
                        }
                    }
                    result = b.assign(b.tmp(), "load", et, [ptr, offset]);
                    if (take) {
                        this.processFillZeros(new ssa.Pointer(ptr, offset), enode.type, b);
                    }
                } else if (t instanceof TupleType) {
                    let ptr = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, take ? "lock" : "none", true);
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [ptr]);
                    }
                    let st = this.getSSAType(t) as ssa.StructType;
                    if (enode.rhs.op != "int") {
                        throw new ImplementationError()
                    }
                    let i = parseInt(enode.rhs.value);
                    if (i < 0 || i >= t.types.length) {
                        throw new ImplementationError()
                    }
                    let offset = st.fieldOffset("t" + i.toString());
                    if (ptr instanceof ssa.Pointer) {
                        offset += ptr.offset;
                        ptr = ptr.variable;
                    }
                    result = b.assign(b.tmp(), "load", st.fieldTypeByName("t" + i.toString()), [ptr, offset]);
                    if (take) {
                        this.processFillZeros(new ssa.Pointer(ptr as ssa.Variable, offset), enode.type, b);
                    }
                } else {
                    throw new TodoError(); // TODO: map
                }
                // keepAlive
                if (helper.isSafePointer(enode.type) || helper.isSlice(enode.type) || helper.isString(enode.type)) {
                    if (noNullPointer) {
                        this.processNullCheck(result, enode.type, b);
                    }
                    if (keepAlive == "donate") {
                        if ((enode.flags & AstFlags.ZeroAfterAssignment) != AstFlags.ZeroAfterAssignment) {
                            this.processIncref(result, enode.type, b, null);
                        }
                    } else if (keepAlive == "hold") {
                        this.processIncref(result, enode.type, b, dtor);
                    } else if (keepAlive == "lock") {
                        if (helper.isString(enode.type)) {
                            this.processIncref(result, enode.type, b, dtor);
                        } else {
                            this.processLock(result, enode.type, b, dtor);
                        }
                    }
                }
                return result;
            }
            case ".":
            {
                let take = ((enode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment);
                // Access to member functions is not handled here.
                // Handle non-pointer member access here.
                let t = helper.stripType(enode.lhs.type);
                let result: ssa.Variable | number;
                let zeroPtr: ssa.Pointer;
                if (t instanceof PointerType || t instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, take ? "lock" : "none", true);
                    let elementType = t.elementType;
                    if (elementType instanceof RestrictedType) {
                        elementType = elementType.elementType;
                    }
                    if (elementType instanceof StructType) {
                        let rt = this.getSSAType(enode.type);
                        let s = this.getSSAType(elementType) as ssa.StructType;
                        result = b.assign(b.tmp(), "load", rt, [ptr, s.fieldOffset(enode.name.value)]);
                        zeroPtr = new ssa.Pointer(ptr as ssa.Variable, s.fieldOffset(enode.name.value));
                    } else {
                        throw new ImplementationError();
                    }
                } else if (t instanceof PackageType) {
                    let ip = scope.resolveElement(enode.lhs.value);
                    if (!(ip instanceof ImportedPackage)) {
                        throw new ImplementationError("no such package " + enode.lhs.value)
                    }
                    let element = ip.pkg.scope.resolveElement(enode.name.value);
                    if (!element) {
                        throw new ImplementationError("missing " + enode.name.value)
                    }
                    result = vars.get(element);
                    if (!result) {
                        if (element instanceof Variable) {
                            result = this.backend.importGlobalVar(element.name, this.getSSAType(element.type), element.nativePackageName ? element.nativePackageName : ip.pkg);
                            this.globalVars.set(element, result);
                            vars.set(element, result);
                        } else {
                            throw new ImplementationError()
                        }
                    }
                } else if (t instanceof StructType) {
                    let left = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, take ? "lock" : "none");
                    let memberType = this.getSSAType(enode.type) as ssa.StructType;
                    let structType = this.getSSAType(enode.lhs.type) as ssa.StructType;
                    if (left instanceof ssa.Pointer) {
                        result = b.assign(b.tmp(), "load", memberType, [left.variable, left.offset + structType.fieldIndexByName(enode.name.value)]);
                        zeroPtr = new ssa.Pointer(left.variable, left.offset + structType.fieldIndexByName(enode.name.value));
                    } else {
                        result = b.assign(b.tmp(), "member", memberType, [left, structType.fieldIndexByName(enode.name.value)]);
                        if (take) {
                            let ptr = b.assign(b.tmp(), "addr_of", "addr", [left]);
                            zeroPtr = new ssa.Pointer(ptr, structType.fieldIndexByName(enode.name.value));
                        }
                    }
                } else {
                    throw new ImplementationError();
                }
                if (take) {
                    if (!zeroPtr) {
                        throw new ImplementationError();
                    }
                    this.processFillZeros(zeroPtr, enode.type, b);
                }
                // keepAlive
                if (helper.isSafePointer(enode.type) || helper.isSlice(enode.type) || helper.isString(enode.type)) {
                    if (noNullPointer) {
                        this.processNullCheck(result, enode.type, b);
                    }
                    if (keepAlive == "donate") {
                        if (!take) {
                            this.processIncref(result, enode.type, b, null);
                        }
                    } else if (keepAlive == "hold") {
                        this.processIncref(result, enode.type, b, dtor);
                    } else if (keepAlive == "lock") {
                        if (helper.isString(enode.type)) {
                            this.processIncref(result, enode.type, b, dtor);
                        } else {
                            this.processLock(result, enode.type, b, dtor);
                        }
                    }
                }
                return result;
            }
            case "is":
            {
                let rtype = RestrictedType.strip(enode.rhs.type);
                let ltype = RestrictedType.strip(enode.lhs.type);
                if (helper.isStringOrType(enode.lhs.type)) {
                    let ltypecode = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    throw new TodoError()
                    // return b.assign(b.tmp(), "eq", "i32", [ltypecode, rtypecode]);
                } else if (helper.isInterface(ltype)) {
                    let ifaceAddr = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    let ifaceType = RestrictedType.strip((ltype as types.PointerType).elementType);
                    if (!(ifaceType instanceof InterfaceType)) {
                        throw new ImplementationError()
                    }
                    let structType = RestrictedType.strip((rtype as types.PointerType).elementType);
                    if (!(structType instanceof types.StructType)) {
                        throw new ImplementationError()
                    }
                    let table: ssa.Variable;
                    if (ifaceAddr instanceof ssa.Variable) {
                        table = b.assign(b.tmp(), "member", "addr", [ifaceAddr, this.ifaceHeader.fieldIndexByName("table")]);
                    } else {
                        table = b.assign(b.tmp(), "load", "addr", [ifaceAddr.variable, ifaceAddr.offset + this.ifaceHeader.fieldIndexByName("table")]);
                    }
                    let dtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
                    let dtr2 = b.assign(b.tmp(), "addr_of_func", "addr", [this.generateStructDestructor(structType).getIndex()]);
                    let cmp = b.assign(b.tmp(), "eq", "i8", [dtr, dtr2]);
                    return cmp;
                } else if (helper.isOrType(enode.lhs.type)) {
                    let expr = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    let s = this.getSSAType(ltype);
                    let tc_real = b.assign(b.tmp(), "member", "addr", [expr, (s as ssa.StructType).fieldIndexByName("kind")])
                    let d_goal = this.createTypeDescriptor(rtype);
                    let tc_goal = b.assign(b.tmp(), "table_iface", "addr", [d_goal]);
                    let cmp = b.assign(b.tmp(), "eq", "i8", [tc_real, tc_goal]);
                    return cmp;
                } else {
                    throw new ImplementationError()
                }
            }
            case "typeCast":
            {
                let t = enode.type;
                // let dtor: Array<DestructorInstruction> = [];
                let t2 = helper.stripType(enode.rhs.type);
                // let expr: number | ssa.Variable;
                // if (t == Static.t_string && t2 instanceof SliceType && enode.rhs.op == "clone") {
                //    expr = this.processExpression(f, scope, enode.rhs.lhs, b, vars, dtor, "none");
                //} else {
                //    expr = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "none");
                //}
                let s = this.getSSAType(t);
                let s2 = this.getSSAType(enode.rhs.type);
                if ((t == Static.t_float || t == Static.t_double) && helper.isIntNumber(t2)) {
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    // Ints can be converted to floats
                    let to = this.getSSAType(t);
                    let op: "convert64_s" | "convert64_u" | "convert32_u" | "convert32_s";
                    if (t2 == Static.t_uint64) {
                        op = "convert64_u";
                    } else if (t2 == Static.t_int64) {
                        op = "convert64_s";
                    } else {
                        op = helper.isSigned(t2) ? "convert32_s" : "convert32_u";
                    }
                    return b.assign(b.tmp(), op, to, [expr]);
                } else if (helper.isIntNumber(t) && (t2 == Static.t_float || t2 == Static.t_double)) {
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    // Floats can be converted to ints
                    let to = this.getSSAType(t);
                    let op: "trunc64" | "trunc32";
                    if (t2 == Static.t_double) {
                        op = "trunc64";
                    } else {
                        op = "trunc32";
                    }
                    return b.assign(b.tmp(), op, to, [expr]);
                } else if (t == Static.t_float && t2 == Static.t_double) {
                    // Doubles can be converted to floats
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    return b.assign(b.tmp(), "demote", "f32", [expr]);
                } else if (t == Static.t_double && t2 == Static.t_float) {
                    // Floats can be converted to doubles
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    return b.assign(b.tmp(), "promote", "f64", [expr]);
                } else if (helper.isIntNumber(t) && t2 instanceof UnsafePointerType) {
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    // Convert pointer to integer
                    if (ssa.sizeOf(s) == ssa.sizeOf(s2)) {
                        return expr;
                    } else if (ssa.sizeOf(s) < ssa.sizeOf(s2)) {
                        if (ssa.sizeOf(s2) == 8) {
                            return b.assign(b.tmp(s), "wrap", s2, [expr]);
                        }
                        return expr;
                    }
                    if (ssa.sizeOf(s) == 8) {
                        return b.assign(b.tmp(s), "extend", s2, [expr]);
                    }
                    return expr;
                } else if (this.tc.checkIsIntNumber(enode.rhs, false) && t instanceof UnsafePointerType) {
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    // Convert integer to pointer
                    if (ssa.sizeOf(s) == ssa.sizeOf(s2)) {
                        return expr;
                    } else if (ssa.sizeOf(s) < ssa.sizeOf(s2)) {
                        if (ssa.sizeOf(s2) == 8) {
                            return b.assign(b.tmp(s), "wrap", s2, [expr]);
                        }
                        return expr;
                    }
                    if (ssa.sizeOf(s) == 8) {
                        return b.assign(b.tmp(s), "extend", s2, [expr]);
                    }
                    return expr;
                } else if (t instanceof UnsafePointerType && (t2 instanceof UnsafePointerType || t2 instanceof PointerType || t2 == Static.t_string)) {
                    // Convert pointer or string to unsafe pointer
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    return expr;
                } else if (t == Static.t_string && t2 instanceof UnsafePointerType) {
                    // Convert unsafe pointer to string
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    // TODO: keepAlive
                    return expr;
                } else if (t == Static.t_string && t2 instanceof SliceType) {
                    // Convert a cloned slice to a string?
                    // Then add the trailing 0 while cloning.
                    if (enode.rhs.op == "clone") {
                        let expr = this.processExpression(f, scope, enode.rhs.lhs, b, vars, dtor, "none");
                        let ptr: ssa.Variable;
                        let l: ssa.Variable;
                        if (t2.mode == "local_reference") {
                            ptr = b.assign(b.tmp(), "member", "addr", [expr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            l = b.assign(b.tmp(), "member", "sint", [expr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            let head = b.assign(b.tmp(), "member", this.localSlicePointer, [expr, this.slicePointer.fieldIndexByName("base")]);
                            ptr = b.assign(b.tmp(), "member", "addr", [head, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            head = b.assign(b.tmp(), "member", this.localSlicePointer, [expr, this.slicePointer.fieldIndexByName("base")]);
                            l = b.assign(b.tmp(), "member", "sint", [head, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
                        let str = b.assign(b.tmp(), "copy", "addr", [0]);
                        let nn = b.assign(b.tmp(), "ne", "i8", [ptr, 0]);
                        b.ifBlock(nn);
                        // Make room for the terminating 0 character
                        let l2 = b.assign(b.tmp(), "add", "sint", [l, 1]);
                        b.assign(str, "alloc_arr", "addr", [l2, 1]);
                        b.assign(b.mem, "memcpy", null, [str, ptr, l, 1]);
                        b.end();
                        // this.processDestructorInstructions(dtor, b);
                        return str;
                    }
                    // Convert a slice to a string
                    let expr = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "none");
                    let arrptr = b.assign(b.tmp(), "member", "addr", [expr, this.slicePointer.fieldIndexByName("array_ptr")]);
                    let head = b.assign(b.tmp(), "member", this.localSlicePointer, [expr, this.slicePointer.fieldIndexByName("base")]);
                    let dataptr = b.assign(b.tmp(), "member", "addr", [head, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    head = b.assign(b.tmp(), "member", this.localSlicePointer, [expr, this.slicePointer.fieldIndexByName("base")]);
                    let l = b.assign(b.tmp(), "member", "sint", [head, this.localSlicePointer.fieldIndexByName("data_length")]);
                    if (enode.rhs.op == "id") {
                        let zero = b.assign(b.tmp(), "struct", this.slicePointer, [0, 0, 0]);
                        b.assign(expr as ssa.Variable, "copy", this.slicePointer, [zero]);
                    }
                    let str = b.assign(b.tmp(), "arr_to_str", "addr", [arrptr, dataptr, l]);
                    // this.processDestructorInstructions(dtor, b);
                    return str;
                } else if ((t == Static.t_bool || t == Static.t_rune || helper.isIntNumber(t)) && (t2 == Static.t_bool || t2 == Static.t_rune || this.tc.checkIsIntNumber(enode.rhs, false))) {
                    // Convert between integers
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    if (ssa.sizeOf(s) == ssa.sizeOf(s2)) {
                        return expr;
                    } else if (ssa.sizeOf(s) < ssa.sizeOf(s2)) {
                        if (ssa.sizeOf(s2) == 8) {
                            return b.assign(b.tmp(s), "wrap", s2, [expr]);
                        }
                        return expr;
                    }
                    if (ssa.sizeOf(s) == 8) {
                        return b.assign(b.tmp(s), "extend", s2, [expr]);
                    }
                    return expr;
                } else if (t instanceof PointerType && t2 instanceof UnsafePointerType) {
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    // TODO: keepAlive
                    return expr;
                } else if (t instanceof SliceType && (t.getElementType() == Static.t_byte || t.getElementType() == Static.t_char) && t2 == Static.t_string) {
                    if (helper.isConst(t.arrayType)) {
                        let expr = this.processExpression(f, scope, enode.rhs, b, vars, dtor, keepAlive);
                        let len = b.assign(b.tmp(), "len_str", "sint", [expr]);
                        if (t.mode == "local_reference") {
                            return b.assign(b.tmp(), "struct", this.localSlicePointer, [expr, len]);
                        }
                        return b.assign(b.tmp(), "struct", this.slicePointer, [expr, len, expr]);
                    }
                    // Convert string to a slice.
                    // Using len_arr assures that the trailing zero is part of the string
                    let expr = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "none");
                    let slice = b.assign(b.tmp(), "struct", this.slicePointer, [0, 0, 0]);
                    let nn = b.assign(b.tmp(), "ne", "i8", [expr, 0]);
                    b.ifBlock(nn);
                    let size = b.assign(b.tmp(), "len_arr", "sint", [expr]);
                    let newptr = b.assign(b.tmp(), "alloc_arr", "addr", [size, 1]);
                    b.assign(b.mem, "memcpy", null, [newptr, expr, size, 1]);
                    if (helper.isTakeExpression(enode.rhs)) {
                        this.callDestructorOnVariable(t2, expr as ssa.Variable, b, true);
                    }
                    b.assign(slice, "struct", this.slicePointer, [newptr, size, newptr]);
                    b.end();
                    // this.processDestructorInstructions(dtor, b);
                    return slice;
                } else if (t2 == Static.t_null) {
                    // Convert null to a pointer type
                    let expr = this.processValueExpression(f, scope, enode.rhs, b, vars);
                    return expr;
                } else if (helper.isComplexOrType(t2)) {
                    let expr = this.processExpression(f, scope, enode.rhs, b, vars, dtor, keepAlive);
                    // Get the real typecode
                    let tc_real = b.assign(b.tmp(), "member", "addr", [expr, (s2 as ssa.StructType).fieldIndexByName("kind")])
                    let idx = this.tc.orTypeIndex(t2 as OrType, t, true);
                    let d_goal = this.createTypeDescriptor(t);
                    let tc_goal = b.assign(b.tmp(), "table_iface", "addr", [d_goal]);
                    let cmp = b.assign(b.tmp(), "ne", "i8", [tc_real, tc_goal]);
                    b.ifBlock(cmp);
                    b.assign(null, "trap", null, []);
                    b.end();
                    let u = b.assign(b.tmp(), "member", (s2 as ssa.StructType).fieldTypeByName("value"), [expr, (s2 as ssa.StructType).fieldIndexByName("value")]);
                    let result = b.assign(b.tmp(), "member", s, [u, idx]);
                    // this.processDestructorInstructions(dtor, b);
                    // TODO: keepAlive
                    return result;
                } else {
                    throw new TodoError("conversion not implemented")
                }
            }
            case "take":
            {
                // let t = this.getSSAType(enode.type);
                // let dtor: Array<DestructorInstruction> = [];
                let copy = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "donate");
                if (keepAlive != "donate") {
                    dtor.push(new DestructorInstruction(copy as ssa.Variable, enode.type, "destruct"));
                }
                /*
                if (src instanceof ssa.Pointer) {
                    let copy = b.assign(b.tmp(), "load", t, [src.variable, src.offset]);
                    if (t instanceof ssa.StructType) {
                        let tmp = b.assign(b.tmp(), "struct", t, this.generateZeroStruct(t));
                        b.assign(b.mem, "store", t, [src.variable, src.offset, tmp]);
                    } else {
                        b.assign(b.mem, "store", t, [src.variable, src.offset, 0]);
                    }
                    this.processDestructorInstructions(dtor, b);
                    return copy;
                }
                let copy = b.assign(b.tmp(), "copy", t, [src]);
                if (t instanceof ssa.StructType) {
                    b.assign(src, "struct", t, this.generateZeroStruct(t));
                } else {
                    b.assign(src, "copy", t, [0]);
                }
                */
                // this.processDestructorInstructions(dtor, b);
                return copy;
            }
            case "len":
            {
                let objType = RestrictedType.strip(enode.lhs.type);
                let result: number | ssa.Variable;
                if (objType == Static.t_string) {
                    let s = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    result = b.assign(b.tmp(), "len_str", "sint", [s]);
                } else if (objType instanceof SliceType) {
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    if (head_addr instanceof ssa.Variable) {
                        if (objType.mode == "local_reference") {
                            result = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            let base = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                            result = b.assign(b.tmp(), "member", "sint", [base, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
                    } else {
                        result = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                    }
                } else if (objType instanceof ArrayType) {
                    result = objType.size;
                } else {
                    // TODO: Map
                    throw new ImplementationError()
                }
                return result;
            }
            case "cap":
            {
                let objType = helper.stripType(enode.lhs.type);
                let result: number | ssa.Variable;
                if (objType instanceof SliceType) {
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                    if (objType.mode == "local_reference") {
                        if (head_addr instanceof ssa.Variable) {
                            result = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            result = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                        }
                    } else {
                        let arrayPointer: ssa.Variable;
                        if (head_addr instanceof ssa.Variable) {
                            arrayPointer = b.assign(b.tmp(), "member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr")]);
                        } else {
                            arrayPointer = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.slicePointer.fieldOffset("array_ptr")]);
                        }
                        result = b.assign(b.tmp(), "len_arr", "sint", [arrayPointer]);
                    }
                } else {
                    throw new ImplementationError();
                }
                return result;
            }
            case "clone":
            {
                let objType = helper.stripType(enode.lhs.type);
                if (!(objType instanceof SliceType)) {
                    throw new ImplementationError()
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);
                // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                let head_addr = this.processInnerExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                let data_ptr: ssa.Variable | number;
                let count: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        count = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                } else {
                    data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                    count = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                }
                let mem = b.assign(b.tmp(), "alloc_arr", "addr", [count, size]);
                b.assign(null, "memcpy", null, [mem, data_ptr, count, size]);
                return b.assign(b.tmp(), "struct", this.slicePointer, [mem, count, mem]);
            }
            case "pop":
            {
                let objType = helper.stripType(enode.lhs.type);
                if (!(objType instanceof SliceType)) {
                    throw new ImplementationError()
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);

                // Get the address of the destination SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                // Append and Push modifies the slice, therefore the slice is a left-hand expression
                let head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars, dtor, "none");
                let dest_data_ptr: ssa.Variable | number;
                // The current length of the slice
                let dest_count: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw new ImplementationError()
                    }
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                } else {
                    dest_data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                    dest_count = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                }
                let cond = b.assign(b.tmp(), "eq", "sint", [dest_count, 0]);
                b.ifBlock(cond);
                b.assign(null, "trap", null, []);
                b.end()
                let new_count = b.assign(b.tmp(), "sub", "sint", [dest_count, 1]);
                let read_addr = b.assign(b.tmp(), "mul", "sint", [size, new_count]);
                read_addr = b.assign(b.tmp(), "add", "addr", [dest_data_ptr, read_addr]);
                let result = b.assign(b.tmp(), "load", elementType, [read_addr, 0]);
                // Fill the place with zeros
                if (elementType instanceof ssa.StructType) {
                    let tmp = b.assign(b.tmp(), "struct", elementType, this.generateZeroStruct(elementType));
                    b.assign(b.mem, "store", elementType, [read_addr, 0, tmp]);
                } else {
                    b.assign(b.mem, "store", elementType, [read_addr, 0, 0]);
                }
                // Update length of the slice
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw new ImplementationError()
                    }
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    b.assign(b.mem, "set_member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length"), new_count]);
                } else {
                    b.assign(b.mem, "store", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length"), new_count]);
                }
                return result;
            }
            case "push":
            case "tryPush":
            case "append":
            {
                let objType = helper.stripType(enode.parameters[0].type);
                if (!(objType instanceof SliceType)) {
                    throw new ImplementationError()
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);

                // Evaluate the arguments right to left and
                // compute how much capacity is required, i.e. how large will dest_count become after appending?
                let required = 0;
                for(let i = 1; i < enode.parameters.length; i++) {
                    let p = enode.parameters[i];
                    if (p.op == "unary...") {
                        // TODO: Check on fixed size array
                    } else {
                        required++;
                    }
                }
                let src_values: Array<ssa.Variable | number> = [];
                let src_data_ptr_arr: Array<ssa.Variable> = [];
                let src_count_arr: Array<ssa.Variable> = [];
                let req_count: ssa.Variable | number = required;
                for(let i = enode.parameters.length - 1; i >= 1; i--) {
                    let p = enode.parameters[i];
                    if (p.op == "unary...") {
                        p = p.rhs;
                        let head_addr = this.processExpression(f, scope, p, b, vars, dtor, "lock");
                        let src_data_ptr: ssa.Variable | number;
                        let src_count: ssa.Variable | number;
                        if (objType.mode == "local_reference") {
                            src_data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            src_count = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                            src_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                            src_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
                        src_data_ptr_arr.unshift(src_data_ptr);
                        src_count_arr.unshift(src_count);
                        // TODO: incref if the slice if necessary
                        req_count = b.assign(b.tmp(), "add", "sint", [req_count, src_count]);
                    } else {
                        let src = this.processExpression(f, scope, p, b, vars, dtor, "donate");
                        src_values.unshift(src);
                    }
                }

                // Get the address of the destination SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                // Append and Push modifies the slice, therefore the slice is a left-hand expression
                let head_addr = this.processLeftHandExpression(f, scope, enode.parameters[0], b, vars, dtor, "none");
                let dest_data_ptr: ssa.Variable | number;
                // The current length of the slice
                let dest_count: ssa.Variable | number;
                let dest_array: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw new ImplementationError()
                    }
                    dest_array = b.assign(b.tmp(), "member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr")]);
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                    tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                } else {
                    dest_array = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.slicePointer.fieldOffset("array_ptr")]);
                    dest_data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                    dest_count = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                }
                // Compute how much capacity is left starting at the point where the slice begins
                let dest_total_cap = b.assign(b.tmp(), "len_arr", "sint", [dest_array]);
                let dest_prefix = b.assign(b.tmp(), "sub", "addr", [dest_data_ptr, dest_array]);
                if (size != 1) {
                    dest_prefix = b.assign(b.tmp(), "div", "sint", [dest_prefix, size]);
                }
                // This is the size of the slice plus remaining array capacity at the end of the slice.
                let dest_cap = b.assign(b.tmp(), "sub", "sint", [dest_total_cap, dest_prefix]);

                let offset = dest_count;
                if (size > 1) {
                    offset = b.assign(b.tmp(), "mul", "sint", [dest_count, size]);
                }
                // This is the new target size of the slice
                req_count = b.assign(b.tmp(), "add", "sint", [req_count, dest_count]);
                let to = b.tmp();

                // Is the array large enough? If not -> trap or return false or resize the array.
                // Else, let to point to the location where to append.
                let cond: ssa.Variable;
                if (enode.op == "tryPush") {
                    cond = b.assign(b.tmp(), "le", "i8", [req_count, dest_cap]);
                    b.ifBlock(cond);
                    b.assign(to, "add", "addr", [dest_data_ptr, offset]);
                } else if (enode.op == "push") {
                    cond = b.assign(b.tmp(), "gt", "i8", [req_count, dest_cap]);
                    b.ifBlock(cond);
                    b.assign(null, "trap", null, []);
                    b.end();
                    b.assign(to, "add", "addr", [dest_data_ptr, offset]);
                } else if (enode.op == "append") {
                    cond = b.assign(b.tmp(), "gt", "i8", [req_count, dest_cap]);
                    b.ifBlock(cond);
                    // Allocate a new array
                    // New allocation is at least twice the size
                    let newCount = b.assign(b.tmp(), "mul", "sint", [dest_cap, 2]);
                    let newCount2 = b.assign(b.tmp(), "max", "sint", [newCount, req_count]);
                    let newArray = b.assign(b.tmp(), "alloc_arr", "addr", [newCount2, size]);
                    b.assign(null, "memcpy", null, [newArray, dest_data_ptr, dest_count, size]);
                    if (head_addr instanceof ssa.Variable) {
                        b.assign(b.mem, "set_member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr"), newArray]);
                        let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        b.assign(b.mem, "set_member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr"), newArray]);
                    } else {
                        b.assign(b.mem, "store", "addr", [head_addr.variable, head_addr.offset + this.slicePointer.fieldOffset("array_ptr"), newArray]);
                        b.assign(b.mem, "store", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr"), newArray]);
                    }
                    b.assign(to, "add", "addr", [newArray, offset]);
                    b.elseBlock();
                    b.assign(to, "add", "addr", [dest_data_ptr, offset]);
                    b.end();
                }

                // Append data to the array at the location "to" is pointing to
                let arr_count = 0;
                let value_count = 0;
                for(let i = 1; i < enode.parameters.length; i++) {
                    let p = enode.parameters[i];
                    if (p.op == "unary...") {
                        // TODO: Check that the array is not null
                        let src_data_ptr = src_data_ptr_arr[arr_count];
                        let src_count = src_count_arr[arr_count];
                        arr_count++;
                        b.assign(b.mem, "memmove", null, [to, src_data_ptr, src_count, size]);
                        let addOffset = src_count;
                        if (size > 1) {
                            addOffset = b.assign(b.tmp(), "mul", "sint", [src_count, size]);
                        }
                        b.assign(to, "add", "addr", [to, addOffset]);
                        // TODO: decref the slice or release it
                    } else {
                        b.assign(b.mem, "store", elementType, [to, 0, src_values[value_count]]);
                        b.assign(to, "add", "addr", [to, size]);
                        /*
                        if ((p.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment) {
                            if (!(src_values[value_count] instanceof ssa.Variable) && !(src_values[value_count] instanceof ssa.Pointer)) {
                                throw new ImplementationError()
                            }
                            // Fill the RHS with zeros
                            this.processFillZeros(src_values[value_count] as ssa.Variable | ssa.Pointer, RestrictedType.strip(objType.getElementType()), b);
                        }
                        */
                        value_count++;
                    }
                }

                if (enode.op == "append") {
                    // Release the old array
                    // let dtor = this.generateArrayDestructor(RestrictedType.strip(objType.arrayType) as ArrayType);
                    b.ifBlock(cond);
                    b.assign(null, "free_arr", null, [dest_array, -1]);
                    b.end();
                }

                // Update length of the slice
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw new ImplementationError()
                    }
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    b.assign(b.mem, "set_member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length"), req_count]);
                } else {
                    b.assign(b.mem, "store", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length"), req_count]);
                }

                if (enode.op == "push" || enode.op == "append") {
                    return 0; // void
                } else if (enode.op == "tryPush") {
                    b.end();
                    return cond;
                }
                throw new ImplementationError()
            }
            case "slice":
            {
                let objType = helper.stripType(enode.parameters[0].type);
                if (!(objType instanceof SliceType)) {
                    throw new ImplementationError()
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);

                let offset = this.processValueExpression(f, scope, enode.parameters[1], b, vars);
                let len = this.processValueExpression(f, scope, enode.parameters[2], b, vars);

                let head_addr = this.processLeftHandExpression(f, scope, enode.parameters[0], b, vars, dtor, "none");
                // The current length of the slice
                let dest_array: ssa.Variable | number;
                let dest_data: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw new ImplementationError()
                    }
                    dest_array = b.assign(b.tmp(), "member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr")]);
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    dest_data = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                } else {
                    dest_array = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.slicePointer.fieldOffset("array_ptr")]);
                    dest_data = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                }
                let dest_array_len = b.assign(b.tmp(), "len_arr", "sint", [dest_array])
                let dest_offset = b.assign(b.tmp(), "sub", "sint", [dest_data, dest_array]);
                dest_offset = b.assign(b.tmp(), "div", "sint", [dest_offset, size]);
                dest_offset = b.assign(b.tmp(), "add", "sint", [dest_offset, offset]);
                let dest_end_offset = b.assign(b.tmp(), "add", "sint", [dest_offset, len]);

                // Test the validity of the arguments
                let cond0 = b.assign(b.tmp(), "lt", "i8", [len, 0]);
                let cond1 = b.assign(b.tmp(), "lt", "i8", [dest_offset, 0]);
                let cond2 = b.assign(b.tmp(), "gt", "i8", [dest_end_offset, dest_array_len]);
                let cond3 = b.assign(b.tmp(), "or", "i8", [cond0, cond1]);
                let cond = b.assign(b.tmp(), "or", "i8", [cond3, cond2]);
                b.ifBlock(cond);
                b.assign(null, "trap", null, []);
                b.end();

                let diff = b.assign(b.tmp(), "mul", "sint", [dest_offset, size]);
                let data_ptr = b.assign(b.tmp(), "add", "addr", [dest_array, diff]);

                // Update data_ptr and length of the slice
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw new ImplementationError()
                    }
                    let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    b.assign(b.mem, "set_member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length"), len]);
                    tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                    b.assign(b.mem, "set_member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr"), data_ptr]);
                } else {
                    b.assign(b.mem, "store", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length"), len]);
                    b.assign(b.mem, "store", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr"), data_ptr]);
                }
                return 0; // void
            }
            case "min":
            {
                return b.assign(b.tmp(), "min", this.getSSAType(enode.lhs.type), []);
            }
            case "max":
            {
                return b.assign(b.tmp(), "max", this.getSSAType(enode.lhs.type), []);
            }
            case "sizeof":
            {
                let st = this.getSSAType(enode.lhs.type);
                return ssa.sizeOf(st);
            }
            case "aligned_sizeof":
            {
                let st = this.getSSAType(enode.lhs.type);
                return ssa.alignedSizeOf(st);
            }
            case "resume":
            {
                let expr = this.processValueExpression(f, scope, enode.lhs, b, vars);
                return b.assign(null, "resume", null, [expr]);
            }
            case "coroutine":
            {
                return b.assign(b.tmp(), "coroutine", this.getSSAType(Static.t_coroutine), []);
            }
            default:
                throw new Error("CodeGen: Implementation error " + enode.op)
        }
    }

    private processFillZeros(target: ssa.Variable | ssa.Pointer, type: Type, b: ssa.Builder) {
        // Fill the RHS with zeros
        let st = this.getSSAType(type);
        if (target instanceof ssa.Variable) {
            if (st instanceof ssa.StructType) {
                b.assign(target, "struct", st, this.generateZeroStruct(st));
            } else {
                b.assign(target, "copy", st, [0]);
            }
        } else if (target instanceof ssa.Pointer) {
            if (st instanceof ssa.StructType) {
                let tmp = b.assign(b.tmp(), "struct", st, this.generateZeroStruct(st));
                b.assign(b.mem, "store", st, [target.variable, target.offset, tmp]);
            } else {
                b.assign(b.mem, "store", st, [target.variable, target.offset, 0]);
            }
        }
    }

    private processCompare(opcode: ssa.NodeKind, f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable {
        let t = helper.stripType(enode.lhs.type);
        if (t == Static.t_string) {
            let dtor: Array<DestructorInstruction> = [];
            let p1 = this.processExpression(f, scope, enode.lhs, b, vars, dtor, "lock");
            let p2 = this.processExpression(f, scope, enode.rhs, b, vars, dtor, "none");
            // let cond = b.assign(b.tmp(), "eq", "i8", [p1, p2]);
            let l1 = b.assign(b.tmp(), "len_arr", "sint", [p1]);
            let l2 = b.assign(b.tmp(), "len_arr", "sint", [p2]);
            let l = b.assign(b.tmp(), "min", "sint", [l1, l2])
            let cmp = b.assign(b.tmp(), "memcmp", "sint", [p1, p2, l]);
            this.processDestructorInstructions(dtor, b);
            switch(opcode) {
                case "eq":
                    return b.assign(b.tmp(), "eqz", "sint", [cmp]);
                case "ne":
                    return b.assign(b.tmp(), "ne", "sint", [cmp, 0]);
                case "lt":
                    return b.assign(b.tmp(), "lt_s", "sint", [cmp, 0]);
                case "le":
                    return b.assign(b.tmp(), "le_s", "sint", [cmp, 0]);
                case "gt":
                    return b.assign(b.tmp(), "gt_s", "sint", [cmp, 0]);
                case "ge":
                    return b.assign(b.tmp(), "ge_s", "sint", [cmp, 0]);
            }
            throw new ImplementationError(opcode);
        } else if (helper.isReference(t)) {
            let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
            let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
            let cmp = b.assign(b.tmp(), "cmp_ref", "i8", [p1, p2]);
            switch(opcode) {
                case "eq":
                    return cmp;
                case "ne":
                    return b.assign(b.tmp(), "eqz", "i8", [cmp, 0]);
                default:
                    throw new ImplementationError(opcode);
            }
        } else {
            let p1 = this.processValueExpression(f, scope, enode.lhs, b, vars);
            let p2 = this.processValueExpression(f, scope, enode.rhs, b, vars);
            let storage = this.getSSAType(t);
            if (p1 === 0 && opcode == "eq" && storage != "f32" && storage != "f64") {
                return b.assign(b.tmp(), "eqz", storage, [p2]);
            }
            if (p2 === 0 && opcode == "eq" && storage != "f32" && storage != "f64") {
                return b.assign(b.tmp(), "eqz", storage, [p1]);
            }
            return b.assign(b.tmp(), opcode, storage, [p1, p2]);
        }
    }

    /*
    private generateZero(t: ssa.Type | ssa.StructType | ssa.PointerType): Array<number> {
        if (t instanceof ssa.StructType) {
            return this.generateZeroStruct(t);
        }
        if (t instanceof ssa.PointerType) {
            return [0];
        }
        return [0];
    }
    */

    private generateZeroStruct(st: ssa.StructType): Array<number> {
        let args: Array<number> = [];
        for(let f of st.fields) {
            for(let i = 0; i < f[2]; i++) {
                args.push(0);
            }
        }
        return args;
    }

    private typecode(t: Type): number {
        // TODO: String addresses and type code numbers must not overlap
//        if (t instanceof StringLiteralType) {
//            let off = this.backend.addString(t.name);
//            if (typeof(off) == "number") {
//                return off;
//            }
//        }
        let tc = t.toTypeCodeString();
        if (this.typeCodeMap.has(tc)) {
            return this.typeCodeMap.get(tc);
        }
        let n = this.typeCodeMap.size + 1;
        this.typeCodeMap.set(tc, n);
        return n;
    }

    private isThis(v: ssa.Variable | number): boolean {
        return v instanceof ssa.Variable && v.name == "this";
    }



    private mangleDestructorName(t: Type): string {
        let hash = createHash("md5");
        hash.update(t.toTypeCodeString());
        return "dtr_" + hash.digest("hex");
    }

    private generateSliceDestructor(t: SliceType): backend.Function {
        let typecode = this.typecode(t).toString();
        let bf = this.destructors.get(typecode);
        if (bf) {
            return bf;
        }
        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(typecode, bf);
        let st = this.getSSAType(t) as ssa.StructType;
        // Load pointer to the underlying array, which is a size-prefixed array
        let arrPointer = b.assign(b.tmp(), "load", "addr", [pointer, st.fieldOffset("array_ptr")]);
        this.callDestructor(t.arrayType, arrPointer, b, false, "free");
        // this.callDestructorOnPointer(new tc.PointerType(t.arrayType, t.mode), new ssa.Pointer(arrPointer, 0), b);
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    private generateTupleDestructor(t: TupleType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let st = this.getSSAType(t) as ssa.StructType;
        let i = 0;
        for (let e of t.types) {
            this.callDestructorOnPointer(e, new ssa.Pointer(pointer, st.fieldOffset("t" + i.toString())), b);
            i++;
        }
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    private generateStructDestructor(t: StructType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let st = this.getSSAType(t) as ssa.StructType;
        for (let f of t.fields) {
            this.callDestructorOnPointer(f.type, new ssa.Pointer(pointer, st.fieldOffset(f.name)), b);
        }
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    /**
     * Generates a destructor that takes two arguments.
     * One is a pointer to the data, the other is the size.
     * This destructor can be used for slices, too, since a slice
     * is a pointer to an array which has a runtime-dependent size.
     *
     * The destructor does not free the memory used by the array.
     */
    private generateArrayDestructor(t: ArrayType): backend.Function {
        let tc = this.typecode(t).toString();
        let elementType = RestrictedType.strip(t.elementType);
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr", "sint"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        let size = b.declareParam("sint", "size");
        this.destructors.set(tc, bf);

        let counter = b.assign(b.tmp(), "copy", "sint", [0]);
        let outer = b.block();
        let loop = b.loop()
        let cmp = b.assign(b.tmp(), "eq", "sint", [counter, size]);
        b.br_if(cmp, outer);
        this.callDestructorOnPointer(elementType, new ssa.Pointer(pointer, 0), b);
        let st = this.getSSAType(elementType);
        b.assign(pointer, "add", "addr", [pointer, ssa.alignedSizeOf(st)]);
        b.assign(counter, "add", "addr", [counter, 1]);
        b.br(loop);
        b.end();
        b.end();
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    /**
     * Generates a destructor that takes one argument, which is
     * a pointer to the data
     * This destructor can be used for or-types, where the size of the array is known
     * and the destructor must have only one argument.
     *
     * The destructor does not free the memory used by the array.
     */
    private generateFixedArrayDestructor(t: ArrayType, size: number): backend.Function {
        let tc = this.typecode(t).toString();
        let elementType = RestrictedType.strip(t.elementType);
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);

        let counter = b.assign(b.tmp(), "copy", "sint", [0]);
        let outer = b.block();
        let loop = b.loop()
        let cmp = b.assign(b.tmp(), "eq", "sint", [counter, size]);
        b.br_if(cmp, outer);
        this.callDestructorOnPointer(elementType, new ssa.Pointer(pointer, 0), b);
        let st = this.getSSAType(elementType);
        b.assign(pointer, "add", "addr", [pointer, ssa.alignedSizeOf(st)]);
        b.assign(counter, "add", "addr", [counter, 1]);
        b.br(loop);
        b.end();
        b.end();
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    private generatePointerDestructor(t: PointerType): backend.Function {
        let tc = this.typecode(t).toString() + "//pointer";
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }

        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        this.callDestructorOnPointer(t, new ssa.Pointer(pointer, 0), b);
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    /**
     * Generates a destructor that takes one argument.
     * The argument is a pointer to the interface header.
     */
    private generateInterfaceDestructor(t: InterfaceType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }

        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let realPointer = b.assign(b.tmp(), "load", "addr", [pointer, this.ifaceHeader.fieldOffset("pointer")]);
        let table = b.assign(b.tmp(), "load", "addr", [pointer, this.ifaceHeader.fieldOffset("table")]);
        let dtrPtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
        b.callIndirect(null, new ssa.FunctionType(["addr"], null), [dtrPtr, realPointer]);
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    /**
     * Generates a destructor that takes two arguments.
     * The first is a pointer to the struct behind the interface.
     * The second is a pointer to the interface table.
     */
    /*
    private generateUniversalInterfaceDestructor(): backend.Function {
        let tc = "interface{}";
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }

        let dtrName = "dtr_interface";
        let dtrType = new ssa.FunctionType(["addr", "addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let realPointer = b.declareParam("addr", "realPointer");
        let table = b.declareParam("addr", "table");
        this.destructors.set(tc, bf);
        let dtrPtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
//        let cond = b.assign(b.tmp(), "ne", "i8", [dtrPtr, 0]);
//        b.ifBlock(cond);
        b.callIndirect(null, new ssa.FunctionType(["addr"], null), [dtrPtr, realPointer]);
//        b.end();
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }
    */

    /**
     * Generates a destructor that takes one argument.
     * The argument is a pointer to the or type struct.
     */
    private generateOrTypeDestructor(t: OrType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }

        let orType = this.getSSAType(t) as ssa.StructType
        let dtrName = this.mangleDestructorName(t);
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam(new ssa.PointerType(orType, false), "pointer");
        this.destructors.set(tc, bf);
        if (orType.fieldIndexByName("value") != 0) {
            throw new ImplementationError("Wrong offset in or-type struct")
        }
        let table = b.assign(b.tmp(), "load", "addr", [pointer, orType.fieldOffset("kind")]);
        let dtrPtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
        let cond = b.assign(b.tmp(), "ne", "i8", [dtrPtr, 0]);
        b.ifBlock(cond);
        b.callIndirect(null, new ssa.FunctionType(["addr"], null), [dtrPtr, pointer]);
        b.end();
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }

    /*
    private generateUniversalOrTypeDestructor(): backend.Function {
        let tc = "ortype";
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = "dtr_ortype";
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        // Load a pointer to the destructor function. If not null, call it.
        let dtrPtr = b.assign(b.tmp(), "load", "addr", [pointer, 0]);
        let cond = b.assign(b.tmp(), "ne", "i8", [dtrPtr, 0]);
        b.ifBlock(cond);
        let realPointer = b.assign(b.tmp(), "add", "addr", [pointer, ssa.sizeOf("addr")]);
        b.callIndirect(null, new ssa.FunctionType(["addr"], null), [dtrPtr, realPointer]);
        b.end();
        b.end();
        this.backend.defineFunction(dtrNode, bf, false, true);
        return bf;
    }
    */

    /**
     * Generate a destructor function that takes only one argument, which is a pointer
     * to the value that is to be destructed.
     *
     * If the type needs no destructors, the function returns null.
     */
    private generateDestructor(t: Type): backend.Function {
        if (t instanceof InterfaceType) {
            return this.generateInterfaceDestructor(t);
        } else if (t instanceof PointerType) {
            return this.generatePointerDestructor(t);
        } else if (t instanceof StructType) {
            return this.generateStructDestructor(t);
        } else if (t instanceof ArrayType) {
            if (t.size < 0) {
                throw new ImplementationError("Generating destructor for array of unknown size")
            }
            return this.generateFixedArrayDestructor(t, t.size);
        } else if (t instanceof TupleType) {
            return this.generateTupleDestructor(t);
        } else if (t instanceof SliceType) {
            return this.generateSliceDestructor(t);
        } else if (t == Static.t_string) {
            // Do nothing by intention, because strings are not explicitly destructed. They are always reference counted.
            return null
        }
        return null
    }

    /**
     * pointer is the address of a value and t is the type of the value being pointed to.
     */
    private callDestructor(typ: Type, pointer: ssa.Variable | number, b: ssa.Builder, avoidNullCheck: boolean, free: "no" | "free" | "decref" | "unlock") {
        let t = RestrictedType.strip(typ);
        let dtr: backend.Function;
        // Determine the destructor and store it in 'dtr'.
        // If the underlying memory is not free'd in any way, call the destructor.
        if (!helper.isPureValue(typ) && !helper.isLocalReference(typ)) {
            if (free == "no" && !avoidNullCheck) {
                let cond: ssa.Variable;
                if (t instanceof InterfaceType) {
                    let realPointer = b.assign(b.tmp(), "load", "addr", [pointer, this.ifaceHeader.fieldOffset("pointer")]);
                    cond = b.assign(b.tmp(), "ne", "i8", [realPointer, 0]);
                } else {
                    cond = b.assign(b.tmp(), "ne", "i8", [pointer, 0]);
                }
                b.ifBlock(cond);
            }
            if (t instanceof InterfaceType) {
                dtr = this.generateInterfaceDestructor(t);
                if (free == "no") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), pointer]);
                }
            } else if (t instanceof OrType) {
                dtr = this.generateOrTypeDestructor(t);
                if (free == "no") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), pointer]);
                }
            } else if (t instanceof PointerType) {
                if (free == "no") {
                    let val = b.assign(b.tmp(), "load", "addr", [pointer, 0]);
                    if (t.mode == "strong" || t.mode == "unique") {
                        this.callDestructor(t.elementType, val, b, false, "free");
                    } else if (t.mode == "reference")
                        this.callDestructor(t.elementType, val, b, false, "decref");
                } else {
                    dtr = this.generatePointerDestructor(t);
                }
            } else if (t instanceof StructType) {
                dtr = this.generateStructDestructor(t);
                if (free == "no") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), pointer]);
                }
            } else if (t instanceof ArrayType) {
                dtr = this.generateArrayDestructor(t);
                if (free == "no") {
                    let size: number | ssa.Variable = t.size;
                    if (t.size < 0) {
                        size = b.assign(b.tmp(), "load", "sint", [pointer, -ssa.sizeOf("sint")]);
                    }
                    b.call(null, new ssa.FunctionType(["addr", "sint"], null), [dtr.getIndex(), pointer, size]);
                }
            } else if (t instanceof TupleType) {
                dtr = this.generateTupleDestructor(t);
                if (free == "no") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), pointer]);
                }
            } else if (t instanceof SliceType) {
                if (free == "no") {
                    let st = this.getSSAType(t) as ssa.StructType;
                    let arrPointer = b.assign(b.tmp(), "load", "addr", [pointer, st.fieldOffset("array_ptr")]);
                    if (t.mode == "strong" || t.mode == "unique") {
                        this.callDestructor(t.arrayType, arrPointer, b, false, "free");
                    } else {
                        this.callDestructor(t.arrayType, arrPointer, b, false, "decref");
                    }
                } else {
                    dtr = this.generateSliceDestructor(t);
                }
            } else if (t == Static.t_string) {
                // Do nothing by intention, because strings are not explicitly destructed. They are only reference counted.
            } else {
                throw new ImplementationError()
            }
            if (free == "no" && !avoidNullCheck) {
                b.end();
            }
        }
        // Check that the interface is not a null-pointer
        if (!avoidNullCheck && t instanceof InterfaceType) {
            let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
            let cond = b.assign(b.tmp(), "ne", "i8", [realPointer, 0]);
            b.ifBlock(cond);
        }
        // Free the underlying memory and by doing so invoke the destructor
        if (free == "free") {
            if (helper.isArray(typ) || helper.isString(typ)) {
                b.assign(null, "free_arr", null, [pointer, dtr ? dtr.getIndex() : -1]);
            } else {
                b.assign(null, "free", null, [pointer, dtr ? dtr.getIndex() : -1]);
            }
        } else if (free == "unlock") {
            if (helper.isArray(typ) || helper.isString(typ)) {
                b.assign(null, "unlock_arr", null, [pointer, dtr ? dtr.getIndex() : -1]);
            } else {
                b.assign(null, "unlock", null, [pointer, dtr ? dtr.getIndex() : -1]);
            }
        } else if (free == "decref") {
            if (helper.isArray(typ) || helper.isString(typ)) {
                b.assign(null, "decref_arr", null, [pointer, dtr ? dtr.getIndex() : -1]);
            } else {
                b.assign(null, "decref", null, [pointer, dtr ? dtr.getIndex() : -1]);
            }
        }
        if (!avoidNullCheck && t instanceof InterfaceType) {
            b.end();
        }
    }

    private callDestructorOnPointer(type: Type, pointer: ssa.Pointer, b: ssa.Builder): void {
        let t = RestrictedType.strip(type);
        if (helper.isPureValue(t)) {
            return;
        }
        if (t instanceof PointerType && (t.mode == "strong" || t.mode == "unique")) {
            let v = b.assign(b.tmp(), "load", this.getSSAType(type), [pointer.variable, pointer.offset]);
            this.callDestructor(t.elementType, v, b, false, "free");
        } else if (t instanceof PointerType && (t.mode == "reference")) {
            let v = b.assign(b.tmp(), "load", this.getSSAType(type), [pointer.variable, pointer.offset]);
            this.callDestructor(t.elementType, v, b, false, "decref");
        } else if (t == Static.t_string) {
            let v = b.assign(b.tmp(), "load", this.getSSAType(type), [pointer.variable, pointer.offset]);
            this.callDestructor(t, v, b, false, "decref");
        } else if (t instanceof ArrayType || t instanceof TupleType || t instanceof StructType || t instanceof SliceType || helper.isOrType(t)) {
            let p = pointer.variable;
            if (pointer.offset) {
                p = b.assign(b.tmp(), "add", "addr", [p, pointer.offset]);
            }
            this.callDestructor(t, p, b, true, "no");
        }
    }

    private callDestructorOnVariable(type: Type, v: ssa.Variable, b: ssa.Builder, avoidNullCheck: boolean = false): void {
        let t = RestrictedType.strip(type);
        if (helper.isPureValue(t)) {
            return;
        }
        if (t instanceof PointerType && (t.mode == "strong" || t.mode == "unique")) {
            this.callDestructor(t.elementType, v, b, avoidNullCheck, "free");
        } else if (t instanceof PointerType && (t.mode == "reference")) {
            this.callDestructor(t.elementType, v, b, avoidNullCheck, "decref");
        } else if (t == Static.t_string) {
            this.callDestructor(t, v, b, avoidNullCheck, "decref");
        } else if (t instanceof SliceType && (t.mode == "strong" || t.mode == "unique")) {
            let st = this.getSSAType(type) as ssa.StructType;
            let arrayPointer = b.assign(b.tmp(), "member", "addr", [v, st.fieldIndexByName("array_ptr")]);
            this.callDestructor(t.arrayType, arrayPointer, b, false, "free");
        } else if (t instanceof SliceType && t.mode == "reference") {
            let st = this.getSSAType(type) as ssa.StructType;
            let arrayPointer = b.assign(b.tmp(), "member", "addr", [v, st.fieldIndexByName("array_ptr")]);
            this.callDestructor(t.arrayType, arrayPointer, b, false, "decref");
        } else if (t instanceof ArrayType || t instanceof TupleType || t instanceof StructType) {
            let obj = b.assign(b.tmp(), "addr_of", "addr", [v]);
            this.callDestructor(t, obj, b, true, "no");
        } else if (helper.isOrType(t)) {
            let obj = b.assign(b.tmp(), "addr_of", "addr", [v]);
            this.callDestructor(t, obj, b, true, "no");
        }
    }

    private scopeNeedsDestructors(scope: Scope): boolean {
        while(scope) {
            for(let e of scope.elements.values()) {
                // FunctionParameters marked with isConst are not destructed by the function but by their caller
                if ((e instanceof Variable && !e.isResult) || (e instanceof FunctionParameter && !e.isConst)) {
                    if (!helper.isPureValue(e.type)) {
                        return true;
                    }
                }
            }
            if (scope.func) {
                break;
            }
            scope = scope.parent;
        }
        return false;
    }

    /*
    private functionArgumentIncref(rhs: ssa.Variable | ssa.Pointer | number, rhsNode: Node, rhsData: ssa.Variable | number, targetType: Type, targetIsThis: boolean, scope: Scope, b: ssa.Builder): [ssa.Variable | number, ssa.Variable, "none" | "decref" | "free" | "unlock"] {
        let decrefVar: ssa.Variable;
        let action: "none" | "decref" | "free" | "unlock" = "none"
        if (helper.isSafePointer(targetType) && (targetIsThis || helper.isLocalReference(targetType) || helper.isReference(targetType))) {
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if ((result[0] != "no" && result[0] != "no_not_null") || (targetIsThis && result[0] == "no")) {
                if (helper.isInterface(targetType)) {
                    let ptr = b.assign(b.tmp(), "member", "addr", [rhsData, this.ifaceHeader.fieldIndexByName("pointer")]);
                    if (targetIsThis && result[0] == "no") {
                        // No null-check necessary, because null-check happened during function-table lookup already
                    } else {
                        b.assign(null, targetIsThis ? "lock" : "incref", "addr", [ptr]);
                    }
                } else {
                    if (targetIsThis && result[0] == "no") {
                        this.processNullCheck(rhsData, rhsNode.type, b);
                    } else {
                        b.assign(null, targetIsThis ? "lock" : "incref", "addr", [rhsData]);
                    }
                }
                decrefVar = rhsData as ssa.Variable;
                if (targetIsThis && result[0] == "no") {
                    action = "none";
                } else {
                    action = targetIsThis ? "unlock" : "decref";
                }
            }
            if ((helper.isStrong(rhsNode.type) || helper.isUnique(rhsNode.type)) && helper.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    console.log(action)
                    throw new ImplementationError()
                }
                action = "free";
                decrefVar = rhsData as ssa.Variable;
            }
            if (helper.isReference(rhsNode.type) && helper.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    console.log(action)
                    throw new ImplementationError()
                }
                action = "decref";
                decrefVar = rhsData as ssa.Variable;
            }
        } else if (helper.isSlice(targetType) && (helper.isLocalReference(targetType) || helper.isReference(targetType))) {
            if (targetIsThis) {
                throw new ImplementationError()
            }
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if (result[0] != "no" && result[0] != "no_not_null") {
                let st = this.getSSAType(rhsNode.type) as ssa.StructType;
                let arrayPointer: ssa.Variable;
                if (rhs instanceof ssa.Pointer) {
                    arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
                } else {
                    arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
                }
                b.assign(null, "incref_arr", "addr", [arrayPointer]);
                decrefVar = arrayPointer;
                action = "decref";
            }
            if ((helper.isStrong(rhsNode.type) || helper.isUnique(rhsNode.type)) && helper.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    throw new ImplementationError()
                }
                action = "free";
            }
            if (helper.isReference(rhsNode.type) && helper.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    console.log(action)
                    throw new ImplementationError()
                }
                action = "decref";
            }
            // TODO: Handle Maps here, too
        } else if (helper.isString(targetType)) {
            if (targetIsThis) {
                throw new ImplementationError()
            }
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if (result[0] != "no") {
                if (rhs instanceof ssa.Pointer) {
                    let tmp = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset]);
                    decrefVar = b.assign(b.tmp(), "incref_arr", "addr", [tmp]);
                } else {
                    decrefVar = b.assign(b.tmp(), "incref_arr", "addr", [rhs]);
                }
                action = "decref";
            }
        }

        if ((rhsNode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || rhsNode.op == "take") {
            if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                throw new ImplementationError()
            }
            if (rhs instanceof ssa.Variable) {
                let st = this.getSSAType(rhsNode.type) as ssa.StructType;
                // Make a copy of the data, otherwise it will be overwritten with zeros
                rhsData = b.assign(b.tmp(), "copy", st, [rhsData]);
            }
            this.processFillZeros(rhs, rhsNode.type, b);
        }

        return [rhsData, decrefVar, action];
    }
    */

    /*
    private functionArgumentDecref(decrefVar: ssa.Variable, rhsNode: Node, action: "none" | "decref" | "free" | "unlock", b: ssa.Builder): void {
        // If the variable has already been zero'd out, there is no need to destruct it.
        if ((rhsNode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || rhsNode.op == "take") {
            return;
        }
        let t = RestrictedType.strip(rhsNode.type);
        if (t instanceof PointerType) {
            t = t.elementType;
        } else if (t instanceof SliceType) {
            t = t.arrayType;
        }
        if (action == "free") {
            this.callDestructor(t, decrefVar, b, false, "free");
        } else if (action == "unlock") {
            this.callDestructor(t, decrefVar, b, false, "unlock");
        } else if (action == "decref") {
            this.callDestructor(t, decrefVar, b, false, "decref");
        }
    }
    */

    /**
     * Determines whether the expression enode needs an incref before passing it as argument to a function call.
     * References stored in local variables on the stack do not need an incref, if no pointer to said local variables have been passed as arguments already.
     * The reason is that the callee cannot modify the stack variables of the caller.
     * Furthermore, references to objects owned directly via a strong pointer stored on the stack, do not need incref as well.
     * The reason is that local variables of the caller are not modified, hence said object must continue exist, because the local variable holds a strong pointer on it.
     */
    /*
    private functionArgumentIncrefIntern(enode: Node, scope: Scope): ["yes" | "no" | "no_not_null", Variable | FunctionParameter] {
        if (helper.isLocalReference(enode.type)) {
            // Passing on a local reference means no incref/decref, because local references must only point to objects
            // that live as long as the local reference does.
            return ["no", null];
        }
        switch(enode.op) {
            case "null":
                // null needs no reference counting
            case "object":
            case "array":

            case "(":
                // Return values of functions come with an increased reference count already.
            case "take":
            case "clone":
                // Take and clone return an owning pointer and hence there is no need to increase the reference count.
                // However, the value must be destructed afterwards unless ownership is passed to the function.
                return ["no", null];
            case ".":
            case "[":
            {
                let lhs = this.functionArgumentIncrefIntern(enode.lhs, scope);
                if (lhs[0] == "yes") {
                    return lhs;
                }
                let type: Type = RestrictedType.strip(enode.type);
                if (helper.isUnsafePointer(type)) {
                    return ["no", null];
                }
                if (helper.isStruct(type) || helper.isTuple(type) || helper.isArray(type)) {
                    return lhs;
                }
                return ["yes", null];
            }
            case "unary&":
            {
                let result = this.functionArgumentIncrefIntern(enode.rhs, scope);
                return ["no", result[1]];
            }
            case "id":
            {
                let e = scope.resolveElement(enode.value);
                if (!e) {
                    throw new ImplementationError()
                }
                // FunctionParameters of pointer type already guarantee that the object being pointed to exists while the function executes.
                // No need to refcount again.
                // When 'this' is being passed we are sure that it is a non-null variable.
                if (e instanceof FunctionParameter) {
                    if (e.isReferenced) {
                        return ["yes", e];
                    }
                    return [e.name == "this" ? "no_not_null" : "no", e];
                }
                // Local variables of pointer type already guarantee that the object being pointed to exists while the variable is in scope.
                // No need to refcount again.
                // When a 'let' is passed, it is known to be not-null.
                if (e instanceof Variable && (!e.isGlobal || e.isConst)) {
                    if (e.isReferenced) {
                        return ["yes", e];
                    }
                    return [e.isNotNull ? "no_not_null" : "no", e];
                }
                return ["yes", null];
            }
            case "str":
                // String constants need no reference counting
                return ["no", null];
        }
        return ["yes", null];
    }
    */
    /*
    private processLiteralArgument(f: Function, scope: Scope, rhsNode: Node, targetType: Type, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | number {
        let rhs: ssa.Pointer | ssa.Variable | number;
        if ((helper.isArray(rhsNode.type) || helper.isStruct(rhsNode.type)) && helper.isPureLiteral(targetType, rhsNode)) {
            rhs = this.processPureLiteral(rhsNode);
        } else if (rhsNode.op == "take") {
            rhs = this.processLeftHandExpression(f, scope, rhsNode.lhs, b, vars);
        } else {
            rhs = this.processExpression(f, scope, rhsNode, b, vars, targetType);
        }
        let data: ssa.Variable | number;
        if (rhs instanceof ssa.Pointer) {
            let st = this.getSSAType(rhsNode.type) as ssa.StructType;
            data = b.assign(b.tmp(), "load", st, [rhs.variable, rhs.offset]);
        } else {
            data = rhs;
        }
        // Reference counting for pointers
        if (helper.isSafePointer(targetType) && helper.isReference(targetType) && (helper.isStrong(rhsNode.type) || helper.isUnique(rhsNode.type) || !helper.isTakeExpression(rhsNode))) {
            // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
            data = b.assign(b.tmp(), "incref", "addr", [data]);
        } else if (helper.isString(targetType) && !helper.isTakeExpression(rhsNode)) {
            data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
        }
        // Reference counting for slices
        if (helper.isSlice(targetType) && helper.isReference(targetType) && (helper.isStrong(rhsNode.type) || helper.isUnique(rhsNode.type) || !helper.isTakeExpression(rhsNode))) {
            let st = this.getSSAType(targetType) as ssa.StructType;
            let arrayPointer: ssa.Variable;
            if (rhs instanceof ssa.Pointer) {
                arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
            } else {
                arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
            }
            b.assign(null, "incref_arr", "addr", [arrayPointer]);
        }
        if ((rhsNode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || rhsNode.op == "take") {
            if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                throw new ImplementationError()
            }
            // Fill the RHS with zeros
            this.processFillZeros(rhs, rhsNode.type, b);
        }

        return data;
    }
    */

    /*
    private processCleanupExpression(enode: Node, v: ssa.Variable | number, b: ssa.Builder, avoidNullCheck: boolean) {
        if (!(v instanceof ssa.Variable)) {
            return;
        }
        if (this.isDonatingExpression(enode)) {
            this.callDestructorOnVariable(enode.type, v, b, avoidNullCheck)
        }
    }
    */
    /**
     * Returns whether the expression yields a value that requires a cleanup via callDestructor().
     */
    /*
    private isDonatingExpression(enode: Node): boolean {
        if (helper.isPureValue(enode.type)) {
            return false;
        }
        if (helper.isTakeExpression(enode)) {
            return true;
        }
        if (enode.op == "(") {
            return true;
        }

        return false;
    }
    */

    private processDestructorInstructions(dtor: Array<DestructorInstruction>, b: ssa.Builder) {
        for(let d of dtor) {
            switch (d.action) {
                case "decref":
                    this.callDestructor(d.t, d.v, b, true, "decref");
                    break;
                case "destruct":
                    this.callDestructorOnVariable(d.t, d.v, b, false);
                    break;
                case "unlock":
                    this.callDestructor(d.t, d.v, b, true, "unlock");
                    break;
            }
        }
    }

    private processIncref(val: ssa.Variable, t: Type, b: ssa.Builder, dtor: Array<DestructorInstruction> | null): void {
        if (helper.isSafePointer(t) && !helper.isLocalReference(t)) {
            if (helper.isInterface(t)) {
                let ptr = b.assign(b.tmp(), "member", "addr", [val, this.ifaceHeader.fieldIndexByName("pointer")]);
                b.assign(null, "incref", "addr", [ptr]);
                if (dtor) {
                    dtor.push(new DestructorInstruction(ptr, t, "decref"));
                }
            } else {
                if (dtor) {
                    dtor.push(new DestructorInstruction(val, t, "decref"));
                }
                b.assign(null, "incref", "addr", [val]);
            }
        } else if (helper.isString(t)) {
            if (dtor) {
                dtor.push(new DestructorInstruction(val, t, "decref"));
            }
            b.assign(null, "incref_arr", "addr", [val]);
        } else if (helper.isSlice(t) && !helper.isLocalReference(t)) {
            let arrayPointer = b.assign(b.tmp(), "member", "addr", [val, this.slicePointer.fieldIndexByName("array_ptr")]);
            if (dtor) {
                dtor.push(new DestructorInstruction(arrayPointer, t, "decref"));
            }
            b.assign(null, "incref_arr", "addr", [arrayPointer]);
        }
    }

    private processLock(val: ssa.Variable, t: Type, b: ssa.Builder, dtor: Array<DestructorInstruction> | null): void {
        if (helper.isSafePointer(t) && !helper.isLocalReference(t)) {
            if (helper.isInterface(t)) {
                let ptr = b.assign(b.tmp(), "member", "addr", [val, this.ifaceHeader.fieldIndexByName("pointer")]);
                if (dtor) {
                    dtor.push(new DestructorInstruction(ptr, t, "unlock"));
                }
                b.assign(null, "lock", "addr", [ptr]);
            } else {
                if (dtor) {
                    dtor.push(new DestructorInstruction(val, t, "unlock"));
                }
                b.assign(null, "lock", "addr", [val]);
            }
        } else if (helper.isString(t)) {
            if (dtor) {
                dtor.push(new DestructorInstruction(val, t, "unlock"));
            }
            b.assign(null, "lock_arr", "addr", [val]);
        } else if (helper.isSlice(t) && !helper.isLocalReference(t)) {
            let arrayPointer = b.assign(b.tmp(), "member", "addr", [val, this.slicePointer.fieldIndexByName("array_ptr")]);
            if (dtor) {
                dtor.push(new DestructorInstruction(arrayPointer, t, "unlock"));
            }
            b.assign(null, "lock_arr", "addr", [arrayPointer]);
        }
    }

    private spawnNeedsWrapper(ft: FunctionType): boolean {
        if (ft.objectType) {
            return true;
        }
        for(let p of ft.parameters) {
            if (!helper.isPureValue(p.type) && !helper.isStrong(p.type) && !helper.isUnique(p.type)) {
                return true;
            }
        }
        return false;
    }

    /**
     * This function is used to load a package that implements some built-in functionality
     * like decoding a string while iterating over it in a for-loop.
     *
     * Throws SyntaxError, ImportError or TypeError.
     */
    private loadPackage(pkgPath: string, loc: Location): Package {
        let p = Package.resolve(pkgPath, loc);
        Package.checkTypesForPackages();
        return p;
    }

    private loadFunction(pkgPath: string, name: string, loc: Location): [backend.Function | backend.FunctionImport, ssa.FunctionType] {
        let p = this.loadPackage(pkgPath, loc);
        let f = p.scope.elements.get(name);
        if (!f || !(f instanceof Function)) {
            throw new TypeError("Function " + name + " does not exist in package " + pkgPath, loc);
        }
        let t = this.getSSAFunctionType(f.type);
        return [this.backend.importFunction(name, p, t), t];
    }

    public hasDestructors(): boolean {
        return this.destructors.size != 0;
    }

    public hasSymbols(): boolean {
        return this.symbols.size != 0;
    }

    private backend: backend.Backend;
    private tc: TypeChecker;
    private imports: Map<string, backend.FunctionImport>;
    private funcs: Map<Function, backend.Function | backend.FunctionImport> = new Map<Function, backend.Function | backend.FunctionImport>();
    private globalVars = new Map<ScopeElement, ssa.Variable>();
    private slicePointer: ssa.StructType;
    private localSlicePointer: ssa.StructType;
    private ifaceHeader: ssa.StructType;
    /*private ifaceHeader32: ssa.StructType;
    private ifaceHeaderFloat: ssa.StructType;
    private ifaceHeaderDouble: ssa.StructType;
    private ifaceHeaderSlice: ssa.StructType; */
    private mapHead: ssa.StructType;
    private disableNullCheck: boolean;
    private typeCodeMap: Map<string,number> = new Map<string, number>();
    private destructors: Map<string, backend.Function> = new Map<string, backend.Function>();
    private structs: Map<StructType | OrType, ssa.StructType> = new Map<StructType, ssa.StructType>();
    private ifaceDescriptors: Map<string, number> = new Map<string, number>();
    private symbols: Map<string, number> = new Map<string, number>();
}

