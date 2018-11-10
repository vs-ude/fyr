import {Node, AstFlags, Location} from "./ast"
import {Function, TemplateFunction, Type, PackageType, StringLiteralType, MapType, InterfaceType, RestrictedType, OrType, StructType, UnsafePointerType, PointerType, FunctionType, ArrayType, SliceType, TypeChecker, TupleType, Scope, Variable, FunctionParameter, ScopeElement, TemplateFunctionType} from "./typecheck"
import * as tc from "./typecheck"
import * as ssa from "./ssa"
import {SystemCalls} from "./pkg"
import * as backend from "./backend"
import {Package} from "./pkg"
import {createHash} from "crypto";

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

        this.slicePointer = new ssa.StructType();
        this.slicePointer.name = "strongSlice";
        this.slicePointer.addField("base", this.localSlicePointer);
        this.slicePointer.addField("array_ptr", "addr");

        this.ifaceHeader = new ssa.StructType();
        this.ifaceHeader.name = "iface";
        this.ifaceHeader.addField("pointer", "addr");
        this.ifaceHeader.addField("table", "addr");

        /*
        this.ifaceHeader32 = new ssa.StructType();
        this.ifaceHeader32.name = "iface";
        this.ifaceHeader32.addField("typecode", "i32");
        this.ifaceHeader32.addField("pointer", "ptr");
        this.ifaceHeader32.addField("value", "i32");
        this.ifaceHeaderFloat = new ssa.StructType();
        this.ifaceHeaderFloat.name = "iface";
        this.ifaceHeaderFloat.addField("typecode", "i32");
        this.ifaceHeaderFloat.addField("pointer", "addr");
        this.ifaceHeaderFloat.addField("value", "f32");
        this.ifaceHeaderDouble = new ssa.StructType();
        this.ifaceHeaderDouble.name = "iface";
        this.ifaceHeaderDouble.addField("typecode", "i32");
        this.ifaceHeaderDouble.addField("pointer", "addr");
        this.ifaceHeaderDouble.addField("value", "f64");
        this.ifaceHeaderSlice = new ssa.StructType();
        this.ifaceHeaderSlice.name = "iface";
        this.ifaceHeaderSlice.addField("typecode", "i32");
        this.ifaceHeaderSlice.addField("value", this.slicePointer);
        */

        this.mapHead = new ssa.StructType();
        this.mapHead.name = "mapHead";
        this.mapHead.addField("nextHead", "ptr");
        this.mapHead.addField("size", "i32");
        this.mapHead.addField("free", "i32");
        this.mapHead.addField("freeList", "addr");
    }

    public processModule(mnode: Node, emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string {
        // Iterate over all files and import all functions, but import each function not more than once
        for(let fnode of mnode.statements) {
            for(let name of fnode.scope.elements.keys()) {
                let e = fnode.scope.elements.get(name);
                if (e instanceof Function && e.isImported) {
                    let name = e.importFromModule + "/" + e.name;
                    if (this.imports.has(name)) {
                        this.funcs.set(e, this.imports.get(name));
                    } else {
                        let ft = this.getSSAFunctionType(e.type);
                        let wf = this.backend.importFunction(e.name, e.importFromModule, ft);
                        this.funcs.set(e, wf);
                        this.imports.set(name, wf);
                    }
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
                if (e.isImported) {
                    throw "Implementation error";
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

                if (e.type instanceof TemplateFunctionType) {
                    let pkg = e.type.base.pkg;
                    for(let ge of pkg.tc.globalVariables) {
                        if (this.globalVars.has(ge)) {
                            continue;
                        }
                        let gv = this.backend.declareGlobalVar(ge.name, this.getSSAType(ge.type), pkg);
                        this.globalVars.set(ge, gv);
                    }
                }
            } else if (e instanceof TemplateFunction) {
                // Do nothing by intention
            } else if (e instanceof Variable) {
                let g = this.backend.declareGlobalVar(e.name, this.getSSAType(e.type), this.tc.pkg);
                this.globalVars.set(e, g);
                if (e.node.rhs) {
                    globals.push(e);
                }
            } else {
                throw "CodeGen: Implementation Error " + e;
            }
        }
        
        // Generate IR code for the initialization of global variables
        let wf = this.backend.declareInitFunction("init");
        let b = new ssa.Builder();
        let t = new FunctionType();
        t.returnType = TypeChecker.t_void;
        t.callingConvention = "fyr";
        b.define("init", this.getSSAFunctionType(t));
        let vars = new Map<ScopeElement, ssa.Variable>();
        // Add global variables
        for(let e of this.globalVars.keys()) {
            vars.set(e, this.globalVars.get(e));
        }
        for(let v of globals) {
            let g = this.globalVars.get(v);
            if ((this.tc.isStruct(v.type) || this.tc.isArray(v.type)) && this.isPureLiteral(v.type, v.node.rhs)) {
                let expr = this.processPureLiteral(v.node.rhs);
                if (v.isConst) {
                    g.isConstant = true;
                    g.constantValue = (expr as ssa.Variable).constantValue;
                } else {
                    b.assign(g, "copy", this.getSSAType(v.type), [expr]);
                }
            } else {
                let expr = this.processExpression(null, scope, v.node.rhs, b, vars, v.type);
                b.assign(g, "copy", this.getSSAType(v.type), [expr]);
            }
        }
        this.backend.defineFunction(b.node, wf, false, false);

        // Generate IR code for all functions
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isImported) {
                    throw "Implementation error";
                }
                let wf = this.funcs.get(e) as backend.Function;
                this.processFunction(e, wf);
            } else if (e instanceof TemplateFunction) {
                // Do nothing by intention                
            } else if (e instanceof Variable) {
                // Do nothing by intention
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }

        // Generate code for the module
        return this.backend.generateModule(emitIR, initPackages, duplicateCodePackages);
    }

    public getSSAType(t: Type): ssa.Type | ssa.StructType | ssa.PointerType {
        if (t == TypeChecker.t_bool || t == TypeChecker.t_uint8 || t == TypeChecker.t_byte || t == TypeChecker.t_void) {
            return "i8";
        }
        if (t == TypeChecker.t_int8) {
            return "s8";
        }
        if (t == TypeChecker.t_int16) {
            return "s16";
        }
        if (t == TypeChecker.t_uint16) {
            return "i16";
        }
        if (t == TypeChecker.t_int32) {
            return "s32";
        }
        if (t == TypeChecker.t_uint32) {
            return "i32";
        }
        if (t == TypeChecker.t_int64) {
            return "s64";
        }
        if (t == TypeChecker.t_uint64) {
            return "i64";
        }
        if (t == TypeChecker.t_float) {
            return "f32";
        }
        if (t == TypeChecker.t_double) {
            return "f64";
        }
        if (t == TypeChecker.t_rune) {
            return "i32";
        }
        if (t == TypeChecker.t_int) {
            return "sint";
        }
        if (t == TypeChecker.t_uint) {
            return "int";
        }
        if (t == TypeChecker.t_char) {
            return "s8";
        }
        if (t == TypeChecker.t_byte) {
            return "i8";
        }
        if (t instanceof RestrictedType && t.elementType instanceof tc.PointerType) {
            // Const pointer to an interface?
            if (this.tc.isInterface(t.elementType)) {
                return this.ifaceHeader;
            }
            return new ssa.PointerType(this.getSSAType(t.elementType.elementType), true);            
        }
        if (t instanceof tc.PointerType) {
            // Pointer to an interface?
            if (this.tc.isInterface(t)) {
                return this.ifaceHeader;
            }
            return new ssa.PointerType(this.getSSAType(t.elementType), this.tc.isConst(t.elementType));
        }
        if (t instanceof RestrictedType && t.elementType instanceof tc.UnsafePointerType) {
            return new ssa.PointerType(this.getSSAType(t.elementType.elementType), true);            
        }
        if (t instanceof tc.UnsafePointerType) {
            return new ssa.PointerType(this.getSSAType(t.elementType), this.tc.isConst(t.elementType));
        }
        if (t == TypeChecker.t_string) {
            return "addr";
        }
        if (t == TypeChecker.t_null) {
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
                let ft = this.getSSAType(f.type);
                s.addField(f.name, ft, 1);
                if (t.extends && i == 0) {
                    for(let entry of (ft as ssa.StructType).fieldOffsetsByName.entries()) {
                        s.fieldOffsetsByName.set(entry[0], entry[1]);
                    }
                }
            }
            s.pkg = t.pkg;
            return s;
        }
        if (t instanceof ArrayType) {
            let s = new ssa.StructType();
            s.name = t.name;
            s.addField("data", this.getSSAType(t.elementType), t.size);
            return s;
        }
        if (t instanceof TupleType) {
            let s = new ssa.StructType();
            s.name = t.name;
            let i = 0;
            for(let el of t.types) {
                s.addField("t" + i.toString(), this.getSSAType(el));
                i++;
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
            return this.ifaceHeader;
        }
        if (t instanceof StringLiteralType) {
            return ssa.symbolType;
        }
        if (t instanceof RestrictedType) {
            return this.getSSAType(t.elementType);
        }
        console.log(t)
        throw "CodeGen: Implementation error: The type does not fit in a register " + t.toString();
    }

    private getSSAFunctionType(t: FunctionType): ssa.FunctionType {
        let ftype = new ssa.FunctionType([], null, t.callingConvention);
        if (t.objectType) {
            ftype.params.push("addr");
        }
        for(let p of t.parameters) {
            ftype.params.push(this.getSSAType(p.type));
        }
        if (t.returnType != TypeChecker.t_void) {
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
        } else if (f.type.returnType != TypeChecker.t_void) {
            let v = b.declareResult(this.getSSAType(f.type.returnType), "$return");
        }

        this.processScopeVariables(b, vars, f.scope);

        for(let node of f.node.statements) {
            this.processStatement(f, f.scope, node, b, vars, null);
        }

        if (!f.type.returnType || f.type.returnType == TypeChecker.t_void) {
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
            if ((e instanceof Variable && !e.isResult) || (e instanceof FunctionParameter && !e.isConst)) {
                if (ignoreVariables && ignoreVariables.indexOf(e) != -1) {
                    continue;
                }
                let v = vars.get(e);
                if (!v) {
                    throw "Implementation error";
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
                this.processScopeVariables(b, vars, snode.scope);
                if (snode.lhs) {
                    this.processStatement(f, snode.scope, snode.lhs, b, vars, blocks);
                }
                let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars, TypeChecker.t_bool);
                b.ifBlock(tmp);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, b, vars, blocks);
                }
                if (snode.elseBranch) {
                    b.elseBlock();
                    this.processStatement(f, snode.elseBranch.scope, snode.elseBranch, b, vars, blocks);
                }
                b.end();
                break;
            }
            case "else":
            {
                this.processScopeVariables(b, vars, snode.scope);
                for(let st of snode.statements) {
                    this.processStatement(f, snode.scope, st, b, vars, blocks);
                }
                break;                
            }
            case "let":
            case "var":
            {
                if (snode.rhs) { // Assignment of an expression value?
                    if (snode.lhs.op == "id") {
                        // A single variabe is defined and assigned
                        let element = scope.resolveElement(snode.lhs.value) as Variable;
                        let t = this.getSSAType(snode.rhs.type);
                        let v = vars.get(element);
                        if ((this.tc.isArray(element.type) || this.tc.isStruct(element.type)) && this.isPureLiteral(element.type, snode.rhs)) {
                            let data = this.processPureLiteral(snode.rhs);
                            if (element.isConst) {
                                v.isConstant = true;
                                v.constantValue = (data as ssa.Variable).constantValue;
                            } else {                                
                                b.assign(v, "copy", v.type, [data]);
                            }
                        } else {
                            let rhs: ssa.Variable | number | ssa.Pointer;
                            if (snode.rhs.op == "take") {
                                // Skip the take
                                rhs = this.processLeftHandExpression(f, scope, snode.rhs.lhs, b, vars);
                            } else {
                                rhs = this.processExpression(f, scope, snode.rhs, b, vars, element.type);
                            }
                            let data = this.autoConvertData(rhs, snode.lhs.type, snode.rhs.type, b);
                            if (this.tc.isSafePointer(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !this.tc.isTakeExpression(snode.rhs))) {
                                // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                                if (this.tc.isInterface(snode.lhs.type)) {
                                    let ptr = b.assign(b.tmp(), "member", "addr", [data, this.ifaceHeader.fieldIndexByName("pointer")]);
                                    b.assign(null, "incref", "addr", [ptr]);
                                } else {
                                    data = b.assign(b.tmp(), "incref", "addr", [data]);
                                }
                            } else if (this.tc.isString(snode.lhs.type) && !this.tc.isTakeExpression(snode.rhs)) {
                                data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
                            }
                            b.assign(v, "copy", v.type, [data]);
                            if (this.tc.isSlice(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !this.tc.isTakeExpression(snode.rhs))) {
                                let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                                let arrayPointer: ssa.Variable;
                                if (rhs instanceof ssa.Pointer) {
                                    arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
                                } else {
                                    arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
                                }
                                b.assign(null, "incref_arr", "addr", [arrayPointer]);
                            }                                            
                            if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {      
                                if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                                    throw "Implementation error";
                                }
                                // Fill the RHS with zeros
                                this.processFillZeros(rhs, snode.rhs.type, b);
                            }            
                            if (this.tc.isString(snode.lhs.type) || this.tc.isSafePointer(snode.lhs.type) || this.tc.isSlice(snode.lhs.type)) {
                                // Avoid that the variable is inlined. It carries a reference count and must be destructed correctly
                                v.readCount = 2;
                                v.writeCount = 2;
                            }
                        }
                    } else if (snode.lhs.op == "tuple") {
                        throw "TODO"
                    } else if (snode.lhs.op == "array") {
                        throw "TODO"                        
                    } else if (snode.lhs.op == "object") {
                        throw "TODO"                        
                    } else {
                        throw "Implementation error"
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
                        throw "TODO"
                    } else if (snode.lhs.op == "array") {
                        throw "TODO"                        
                    } else if (snode.lhs.op == "object") {
                        throw "TODO"                        
                    } else {
                        throw "Implementation error"
                    }                    
                } */
                return;
            }
            case "=":
            {
                if (snode.lhs.op == "tuple" || snode.lhs.op == "array" || snode.lhs.op == "object") {
                    var processAssignmentDestinations = (node: Node, destinations: Array<ssa.Variable | ssa.Pointer>) => {
                        if (node.op == "tuple") {
                            for(let p of node.parameters) {
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    processAssignmentDestinations(p, destinations);
                                } else {
                                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, p, b, vars);
                                    destinations.push(dest);
                                }
                            }
                        } else if (node.op == "array") {
                            throw "TODO"                        
                        } else if (node.op == "object") {
                            throw "TODO"                        
                        }
                    }
                    var processAssignment = (node: Node, type: Type, rhsIsTakeExpr: boolean, destinations: Array<ssa.Variable | ssa.Pointer>, destCount: number, source: ssa.Pointer | ssa.Variable) => {
                        if (node.op == "tuple") {
                            if (!(type instanceof TupleType)) {
                                throw "Implementation error";
                            }
                            let stype = this.getSSAType(type) as ssa.StructType;
                            for(let i = 0; i < node.parameters.length; i++) {
                                let p = node.parameters[i];
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    throw "TODO";
                                    // let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    // destCount = processAssignment(p, type.types[i], rhsIsTakeExpr, destinations, destCount, new ssa.Pointer(source.variable, source.offset + eoffset));
                                } else {
                                    let elementType = type.types[i];
                                    let etype: ssa.Type | ssa.StructType | ssa.PointerType = stype.fields[i][1];
                                    let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    let dest = destinations[destCount];
                                    destCount++;
                                    // Assigning to an owning pointer? -> destruct the LHS before assigning the RHS
                                    if (!TypeChecker.isPureValue(snode.lhs.type)) {
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
                                    // Reference counting to pointers
                                    if (this.tc.isSafePointer(p.type) && TypeChecker.isReference(p.type) && (TypeChecker.isStrong(elementType) || TypeChecker.isUnique(elementType) || !rhsIsTakeExpr)) {
                                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                                        if (this.tc.isInterface(p.type)) {
                                            let ptr = b.assign(b.tmp(), "member", "addr", [val, this.ifaceHeader.fieldIndexByName("pointer")]);
                                            b.assign(null, "incref", "addr", [ptr]);
                                        } else {
                                            val = b.assign(b.tmp(), "incref", "addr", [val]);
                                        }
                                    } else if (this.tc.isString(p.type) && !rhsIsTakeExpr) {
                                        val = b.assign(b.tmp(), "incref_arr", "addr", [val]);
                                    }
                                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                                    if (dest instanceof ssa.Pointer) {
                                        b.assign(b.mem, "store", etype, [dest.variable, dest.offset, val]);
                                    } else {
                                        b.assign(dest, "copy", etype, [val]);
                                    }
                                    // Reference counting for slices
                                    if (this.tc.isSlice(p.type) && TypeChecker.isReference(p.type) && (TypeChecker.isStrong(elementType) || TypeChecker.isUnique(elementType) || !rhsIsTakeExpr)) {            
                                        let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                                        let arrayPointer: ssa.Variable;
                                        if (dest instanceof ssa.Pointer) {
                                            arrayPointer = b.assign(b.tmp(), "load", "addr", [dest.variable, dest.offset + st.fieldOffset("array_ptr")]);
                                        } else {
                                            arrayPointer = b.assign(b.tmp(), "member", "addr", [dest, st.fieldIndexByName("array_ptr")]);
                                        }
                                        b.assign(null, "incref_arr", "addr", [arrayPointer]);
                                    }                
                                }
                            }
                        } else if (node.op == "array") {
                            throw "TODO"                        
                        } else if (node.op == "object") {
                            throw "TODO"                        
                        }
                        return destCount;
                    }
                    let destinations: Array<ssa.Variable | ssa.Pointer> = [];
                    processAssignmentDestinations(snode.lhs, destinations);
                    let val : ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(snode.rhs)) {
                        val = this.processLeftHandExpression(f, scope, snode.rhs, b, vars);
                    } else {
                        val = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type) as ssa.Variable;
                    }
                    let rhsIsTakeExpr = this.tc.isTakeExpression(snode.rhs);
                    processAssignment(snode.lhs, snode.rhs.type, rhsIsTakeExpr, destinations, 0, val);
                    if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {
                        // Fill the RHS with zeros
                        this.processFillZeros(val, snode.rhs.type, b);
                    }                                
                } else if (snode.lhs.op == "[" && this.tc.stripType(snode.lhs.lhs.type) instanceof MapType) {
                    // TODO: Ownership transfer
                    /*
                    let mtype: MapType = this.tc.stripType(snode.lhs.lhs.type) as MapType;
                    let m = this.processExpression(f, scope, snode.lhs.lhs, b, vars, mtype);
                    let key = this.processExpression(f, scope, snode.lhs.rhs, b, vars, mtype.keyType);
                    let value = this.processExpression(f, scope, snode.rhs, b, vars, mtype.valueType);
                    if (mtype.keyType == TypeChecker.t_string) {
                        let dest = b.call(b.tmp(), this.setMapFunctionType, [SystemCalls.setMap, m, key]);
                        b.assign(b.mem, "store", this.getSSAType(mtype.valueType), [dest, 0, value]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (mtype.keyType == TypeChecker.t_int64 || mtype.keyType == TypeChecker.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(mtype.keyType), [key]);
                        }   
                        let dest = b.call(b.tmp(), this.setNumericMapFunctionType, [SystemCalls.setNumericMap, m, key64]);
                        b.assign(b.mem, "store", this.getSSAType(mtype.valueType), [dest, 0, value]);
                    }
                    */
                } else {
                    let t = this.getSSAType(snode.rhs.type) as ssa.StructType;
                    let dest: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                    let rhs: ssa.Pointer | ssa.Variable | number;
                    if ((this.tc.isArray(snode.lhs.type) || this.tc.isStruct(snode.lhs.type)) && this.isPureLiteral(snode.lhs.type, snode.rhs)) {
                        rhs = this.processPureLiteral(snode.rhs);
                    } else if (snode.rhs.op == "take") {
                        rhs = this.processLeftHandExpression(f, scope, snode.rhs.lhs, b, vars);
                    } else {
                        rhs = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type);
                    }
                    // Assigning to an owning pointer? -> destruct the LHS before assigning the RHS
                    if (!TypeChecker.isPureValue(snode.lhs.type)) {
                        if (dest instanceof ssa.Pointer) {
                            this.callDestructorOnPointer(snode.lhs.type, dest, b);
                        } else {
                            this.callDestructorOnVariable(snode.lhs.type, dest, b);
                        }
                    }
                    let data: ssa.Variable | number;
                    if (rhs instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "load", t, [rhs.variable, rhs.offset]);
                    } else {
                        data = rhs;
                    }            
                    // Reference counting for pointers
                    if (this.tc.isSafePointer(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !this.tc.isTakeExpression(snode.rhs))) {
                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                        if (this.tc.isInterface(snode.lhs.type)) {
                            let ptr = b.assign(b.tmp(), "member", "addr", [data, this.ifaceHeader.fieldIndexByName("pointer")]);
                            b.assign(null, "incref", "addr", [ptr]);
                        } else {
                            data = b.assign(b.tmp(), "incref", "addr", [data]);
                        }
                    } else if (this.tc.isString(snode.lhs.type) && !this.tc.isTakeExpression(snode.rhs)) {
                        data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
                    }
                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                    if (dest instanceof ssa.Pointer) {
                        b.assign(b.mem, "store", this.getSSAType(snode.lhs.type), [dest.variable, dest.offset, data]);
                    } else {
                        b.assign(dest, "copy", this.getSSAType(snode.lhs.type), [data]);
                    }
                    // Reference counting for slices
                    if (this.tc.isSlice(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !this.tc.isTakeExpression(snode.rhs))) {
                        let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                        let arrayPointer: ssa.Variable;
                        if (dest instanceof ssa.Pointer) {
                            arrayPointer = b.assign(b.tmp(), "load", "addr", [dest.variable, dest.offset + st.fieldOffset("array_ptr")]);
                        } else {
                            arrayPointer = b.assign(b.tmp(), "member", "addr", [dest, st.fieldIndexByName("array_ptr")]);
                        }
                        b.assign(null, "incref_arr", "addr", [arrayPointer]);
                    }
                    if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {
                        if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                            throw "Implementation error";
                        }
                        // Fill the RHS with zeros
                        this.processFillZeros(rhs, snode.rhs.type, b);
                    }            
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
                let t = this.tc.stripType(snode.lhs.type);
                let storage = this.getSSAType(t);
                let tmp: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                let p1: ssa.Variable;
                let dest: ssa.Variable;
                if (tmp instanceof ssa.Pointer) {
                    p1 = b.assign(b.tmp(), "load", storage, [tmp.variable, tmp.offset]);
                    dest = b.tmp();
                } else {
                    p1 = tmp;
                    dest = tmp;
                }
                let p2 = this.processExpression(f, scope, snode.rhs, b, vars, snode.lhs.type);
                if (snode.lhs.type == TypeChecker.t_string) {
                    if (!this.disableNullCheck) {
                        b.assign(null, "notnull_ref", null, [p1]);
                    }
                    let l1 = b.assign(b.tmp(), "len_str", "sint", [p1]);
                    if (!this.disableNullCheck && !(p2 as ssa.Variable).isConstant) {
                        b.assign(null, "notnull_ref", null, [p2]);
                    }
                    let l2 = b.assign(b.tmp(), "len_str", "sint", [p2]);
                    let l = b.assign(b.tmp(), "add", "sint", [l1, l2]);
                    let lplus = b.assign(b.tmp(), "add", "sint", [l, 1]);
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [lplus, 1]);
                    b.assign(b.mem, "memcpy", null, [ptr, p1, l1, 1]);
                    let ptr2 = b.assign(b.tmp(), "add", "addr", [ptr, l1]);
                    b.assign(b.mem, "memcpy", null, [ptr2, p2, l2, 1]);
                    this.callDestructorOnVariable(TypeChecker.t_string, p1, b, true);
                    // Decref p2 if necessary
                    if (this.tc.isTakeExpression(snode.rhs)) {
                        this.callDestructorOnVariable(TypeChecker.t_string, p2 as ssa.Variable, b, true);
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
                        b.assign(dest, this.isSigned(snode.lhs.type) ? "div_s" : "div_u", storage, [p1, p2]);                                
                    } else if (snode.op == "%=") {
                        b.assign(dest, this.isSigned(snode.lhs.type) ? "rem_s" : "rem_u", storage, [p1, p2]);
                    } else if (snode.op == ">>=") {
                        b.assign(dest, this.isSigned(snode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
                    }
                }
                if (tmp instanceof ssa.Pointer) {
                    b.assign(b.mem, "store", storage, [tmp.variable, tmp.offset, dest]);
                }
                break;
            }
            case "--":
            case "++":
            {
                let t = this.tc.stripType(snode.lhs.type)
                let storage = this.getSSAType(t);
                let tmp: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
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
                break;
            }
            case "for":
            {
                let val: ssa.Variable;
                let counter: ssa.Variable;
                let ptr: ssa.Variable;
                let len: ssa.Variable | number;
                this.processScopeVariables(b, vars, snode.scope);
                //
                // Loop initialization
                //
                if (snode.condition && snode.condition.op == ";;" && snode.condition.lhs) {
                    // A c-style for loop
                    this.processStatement(f, snode.scope, snode.condition.lhs, b, vars, blocks);
                } else if (snode.condition && (snode.condition.op == "var_in" || snode.condition.op == "let_in")) {
                    //
                    // A for loop of the form "for(var i in list) or for(var i, j in list)" or the same without "var"
                    //
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    //
                    // Address and length of array or string
                    //                    
                    if (t instanceof SliceType) {
                        // TODO: Incref
                        let sliceHeader: ssa.Pointer | ssa.Variable;
                        if (this.isLeftHandSide(snode.condition.rhs)) {
                            sliceHeader = this.processLeftHandExpression(f, snode.scope, snode.condition.rhs, b, vars);
                        } else {
                            sliceHeader = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars, t) as ssa.Variable;                                
                        }
                        if (sliceHeader instanceof ssa.Variable) {
                            if (t.mode != "local_reference") {
                                let base = b.assign(b.tmp(), "member", this.localSlicePointer, [sliceHeader, this.slicePointer.fieldIndexByName("base")]);
                                ptr = b.assign(b.tmp(), "member", "addr", [base, this.localSlicePointer.fieldIndexByName("data_ptr")]);    
                            } else {
                                ptr = b.assign(b.tmp(), "member", "addr", [sliceHeader, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            }
                            if (t.mode != "local_reference") {
                                let base = b.assign(b.tmp(), "member", this.localSlicePointer, [sliceHeader, this.slicePointer.fieldIndexByName("base")]);
                                len = b.assign(b.tmp(), "member", "sint", [base, this.localSlicePointer.fieldIndexByName("data_length")]);
                            } else {
                                len = b.assign(b.tmp(), "member", "sint", [sliceHeader, this.localSlicePointer.fieldIndexByName("data_length")]);
                            }
                        } else {
                            ptr = b.assign(b.tmp(), "load", "addr", [sliceHeader.variable, sliceHeader.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                            len = b.assign(b.tmp(), "load", "sint", [sliceHeader.variable, sliceHeader.offset + this.localSlicePointer.fieldOffset("data_length")]);
                        }
                    } else if (t instanceof ArrayType) {
                        // TODO: Incref
                        // Get the address of the array
                        len = t.size;
                        if (this.isLeftHandSide(snode.condition.rhs)) {
                            let arr = this.processLeftHandExpression(f, snode.scope, snode.condition.rhs, b, vars);
                            if (arr instanceof ssa.Variable) {
                                ptr = b.assign(b.tmp(), "addr_of", "addr", [arr]);
                            } else {
                                ptr = b.assign(b.tmp(), "copy", "addr", [arr.variable]);
                                if (arr.offset != 0) {
                                    b.assign(ptr, "add", "addr", [ptr, arr.offset]);
                                }
                            }
                        } else {
                            let arr = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars, t) as ssa.Variable;
                            ptr = b.assign(b.tmp(), "addr_of", "addr", [arr]);
                        }
                    } else if (t == TypeChecker.t_string) {
                        // TODO: Incref
                        ptr = this.processExpression(f, snode.scope, snode.condition.rhs, b, vars, TypeChecker.t_string) as ssa.Variable;
                        len = b.assign(b.tmp(), "len_str", "sint", [ptr]);    
                    } else {
                        throw "TODO map"
                    }
                    //
                    // Initialize the counter with 0
                    //
                    if (snode.condition.lhs.op == "tuple") {
                        if (snode.condition.lhs.parameters[0].value != "_") {
                            // Initialize the counter with 0                            
                            let element = snode.scope.resolveElement(snode.condition.lhs.parameters[0].value) as Variable;                                
                            counter = vars.get(element);
                        } else {
                            counter = b.tmp();
                        }
                        if (snode.condition.lhs.parameters[1].value != "_") {
                            let valElement = snode.scope.resolveElement(snode.condition.lhs.parameters[1].value) as Variable;
                            val = vars.get(valElement);
                        }
                    } else {
                        if (snode.condition.lhs.value != "_") {
                            let element = snode.scope.resolveElement(snode.condition.lhs.value) as Variable;                                
                            val = vars.get(element);                                
                        }
                        counter = b.tmp();                                    
                    }
                    b.assign(counter, "const", "sint", [0]);
                }
                //
                // Loop condition
                //
                let outer = b.block();
                let loop = b.loop();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.condition) {
                            let tmp = this.processExpression(f, snode.scope, snode.condition.condition, b, vars, TypeChecker.t_bool);
                            let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                            b.br_if(tmp2, outer);
                        }
                    } else if (snode.condition.op == "var_in" || snode.condition.op == "let_in" || snode.condition.op == "in") {
                        // End of iteration?
                        let endcond = b.assign(b.tmp(), "eq", "i8", [counter, len]);
                        b.br_if(endcond, outer);
                        let t = RestrictedType.strip(snode.condition.rhs.type);
                        if (t instanceof SliceType || t instanceof ArrayType) {
                            // TODO: null-check
                            // Store the current value in a variable
                            let storage = this.getSSAType(t.getElementType());
                            b.assign(val, "load", storage, [ptr, 0]);
                        } else if (t == TypeChecker.t_string) {
                            let [decodeUtf8, decodeUtf8Type] = this.loadFunction("runtime/utf8", "decodeUtf8", snode.loc);
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
                            b.end();                            
                        } else {
                            throw "TODO map and string"
                        }
                    } else {
                        // A for loop of the form: "for( condition )"
                        let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars, TypeChecker.t_bool);
                        let tmp2 = b.assign(b.tmp(), "eqz", "i8", [tmp]);
                        b.br_if(tmp2, outer);
                    }
                }
                //
                // Loop body
                //
                let body = b.block();
                for(let s of snode.statements) {
                    this.processStatement(f, snode.scope, s, b, vars, {body: body, outer: outer});
                }
                //
                // Loop footer
                //
                b.end();
                if (snode.condition && snode.condition.op == ";;" && snode.condition.rhs) {
                    this.processStatement(f, snode.scope, snode.condition.rhs, b, vars, blocks);
                } else if (snode.condition && (snode.condition.op == "var_in" || snode.condition.op == "let_in" || snode.condition.op == "in")) {
                    let t = RestrictedType.strip(snode.condition.rhs.type);
                    if (t instanceof SliceType || t instanceof ArrayType) {
                        // Increase the pointer towards the last element
                        let storage = this.getSSAType(t.getElementType());
                        let size = ssa.alignedSizeOf(storage)
                        b.assign(ptr, "add", "addr", [ptr, size]);
                        // Increase the counter
                        b.assign(counter, "add", "sint", [counter, 1]);
                    } else if (t == TypeChecker.t_string) {
                        // Nothing to do. Counter has been increased already
                    } else {
                        throw "TODO map"
                    }
                }
                b.br(loop);
                b.end();
                b.end();
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
                if (f.namedReturnVariables) {
                    for(let v of f.namedReturnVariables) {
                        ignoreVariables.push(v);
                    }
                }
                if (snode.lhs) {
                    let targetType = f.type.returnType;
                    let rhs: ssa.Variable | ssa.Pointer | number;
                    // Returning a local variable? Then do not zero it out and do not execute its destructor
                    let doNotZero = false;   
                    let forceIncref = false;                 
                    if ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment && snode.lhs.op == "id") {
                        let e = scope.resolveElement(snode.lhs.value);
                        if (e instanceof FunctionParameter || (e instanceof Variable && !e.isGlobal)) {
                            ignoreVariables.push(e);
                            doNotZero = true;                        
                        }
                        // If the ~ptr parameter does not "own" a reference count, then incref is necessary upon returning the reference
                        if (e instanceof FunctionParameter && e.isConst) {
                            forceIncref = true;
                        }
                    }
                    if (!doNotZero && ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment/* || snode.lhs.op == "take"*/)) {
                        rhs = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                    } else {
                        rhs = this.processExpression(f, scope, snode.lhs, b, vars, targetType);                            
                    }
                    let t = this.getSSAType(snode.lhs.type);
                    if (rhs instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "load", t, [rhs.variable, rhs.offset]);
                    } else {
                        data = rhs;
                    }                                
                    // Reference counting for pointers
                    if (this.tc.isSafePointer(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(snode.lhs.type) || TypeChecker.isUnique(snode.lhs.type) || !this.tc.isTakeExpression(snode.lhs) || forceIncref)) {
                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                        data = b.assign(b.tmp(), "incref", "addr", [data]);
                    } else if (this.tc.isString(targetType) && (!this.tc.isTakeExpression(snode.lhs) || forceIncref)) {
                        data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
                    }
                    // Reference counting for slices
                    if (this.tc.isSlice(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(snode.lhs.type) || TypeChecker.isUnique(snode.lhs.type) || !this.tc.isTakeExpression(snode.rhs))) {
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
                    if (!doNotZero && ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment/* || snode.lhs.op == "take"*/)) {
                        if (!(rhs instanceof ssa.Variable) && !(rhs instanceof ssa.Pointer)) {
                            throw "Implementation error";
                        }
                        // Fill the RHS with zeros
                        this.processFillZeros(rhs, snode.lhs.type, b);
                    }                                
                }
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
            case "spawn":
            {
                this.processExpression(f, scope, snode, b, vars, snode.type);
                break;
            }
            case "take":
            {
                // If take is used as a statement, run the destructor on it and zero everything
                let t = this.getSSAType(snode.type);
                let src: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
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
                break;
            }
            case "copy":
            case "move":
            {
                let objType = this.tc.stripType(snode.lhs.type);
                if (!(objType instanceof SliceType)) {
                    throw "Implementation error";
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);
                // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                let head_addr: ssa.Variable | ssa.Pointer;
                if (this.isLeftHandSide(snode.lhs)) {
                    head_addr = this.processLeftHandExpression(f, scope, snode.lhs, b, vars);
                } else {
                    head_addr = this.processExpression(f, scope, snode.lhs, b, vars, objType) as ssa.Variable;
                }
                let dest_data_ptr: ssa.Variable | number;
                let dest_count: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        dest_data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        dest_count = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        dest_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        dest_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                } else {
                    dest_data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                    dest_count = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                }

                if (this.isLeftHandSide(snode.rhs)) {
                    head_addr = this.processLeftHandExpression(f, scope, snode.rhs, b, vars);
                } else {
                    head_addr = this.processExpression(f, scope, snode.rhs, b, vars, objType) as ssa.Variable;
                }
                let src_data_ptr: ssa.Variable | number;
                let src_count: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        src_data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        src_count = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        src_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        src_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                } else {
                    src_data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                    src_count = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                }
                let count = b.assign(b.tmp(), "min", "sint", [src_count, dest_count]);
                if (snode.op == "copy") {
                    b.assign(null, "memmove", null, [dest_data_ptr, src_data_ptr, count, size]);
                } else {
                    let dtor = this.generateArrayDestructor(RestrictedType.strip(objType.arrayType) as ArrayType);
                    b.assign(null, "move_arr", null, [dest_data_ptr, src_data_ptr, count, size, dtor.getIndex()]);
                }
                break;
            }
            case "println": {
                let args: Array<number | ssa.Variable> = [];
                for(let i = 0; i < snode.parameters.length; i++) {
                    args.push(this.processExpression(f, scope, snode.parameters[i], b, vars, null));
                }
                b.assign(null, "println", null, args);
                break;
            }
            default:
            {
                let value = this.processExpression(f, scope, snode, b, vars, snode.type);     
                if (value instanceof ssa.Variable) {
                    this.callDestructorOnVariable(snode.type, value, b);
                }
            }
        }
    }

    public processLeftHandExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | ssa.Pointer {
        switch(enode.op) {
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                return vars.get(element);
            }
            case "unary*":
            {
                let t = this.tc.stripType(enode.rhs.type);
                let tmp = this.processExpression(f, scope, enode.rhs, b, vars, t);
                if (!this.disableNullCheck && !this.isThis(tmp)) {
                    this.processNullCheck(tmp, t, b);
                }
                return new ssa.Pointer(tmp as ssa.Variable, 0);
            }
            case "[":
            {
                let ltype = this.tc.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (ltype instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype);
                    let index = this.processExpression(f, scope, enode.rhs, b, vars, TypeChecker.t_int);
                    let size = ssa.alignedSizeOf(this.getSSAType(ltype.elementType));
                    let index2 = index;
                    if (size > 1) {
                        // TODO: If size is power of 2, shift bits
                        index2 = b.assign(b.tmp(), "mul", "i32", [index, size]);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index2]), 0);
                } else if (ltype instanceof SliceType) {
                    let size = ssa.alignedSizeOf(this.getSSAType(ltype.getElementType()));
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, ltype) as ssa.Variable;
                    }
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    if (head_addr instanceof ssa.Pointer) {
                        data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                    } else if (ltype.mode == "local_reference") {
                        data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        len = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                    } else {
                        let tmp1 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        data_ptr = b.assign(b.tmp(), "member", "addr", [tmp1, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        let tmp2 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        len = b.assign(b.tmp(), "member", "sint", [tmp2, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
//                    let indexVar: ssa.Variable;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, TypeChecker.t_int);
                    }
//                    if (typeof(index) == "number") {
//                        indexVar = b.assign(b.tmp(), "const", "sint", [index]);
//                    } else {
//                        indexVar = index;
//                    }
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
                    let ptr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype) as ssa.Variable;
                    }
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "addr", [ptr]);
                    }
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, TypeChecker.t_int);
                    }
                    // Compare 'index' with 'len'
                    if (typeof(index) == "number") {
                        if (index < 0 || index >= ltype.size * size) {
                            throw "Implementation error " + index + " " +ltype.size ;
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
                    let ptr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype) as ssa.Variable;
                    }
                    if (ptr instanceof ssa.Variable) {
                        ptr = b.assign(b.tmp(), "addr_of", "ptr", [ptr]);
                    }
                    let t = this.getSSAType(ltype) as ssa.StructType;
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op != "int") {
                        throw "Implementation error";
                    }
                    let i = parseInt(enode.rhs.value);
                    if (i < 0 || i >= ltype.types.length) {
                        throw "Implementation error";
                    }
                    let offset = t.fieldOffset("t" + i.toString());
                    if (ptr instanceof ssa.Pointer) {
                        ptr.offset += index;
                        return ptr;
                    }
                    return new ssa.Pointer(ptr, offset);
                } else {
                    throw "TODO"; // TODO: map
                }
            }
            case ".":
            {
                let t = this.tc.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (t instanceof PointerType || t instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    if (t instanceof PointerType && !this.disableNullCheck && !this.isThis(ptr)) {                        
                        b.assign(null, "notnull", null, [ptr]);
                    }
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
                        throw "TODO interface and class"
                    }          
                } else if (t instanceof PackageType) {
                    throw "TODO";
                } else if (t instanceof StructType) {
                    // It is a value, i.e. not a pointer to a value
                    let left: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        left = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        left = this.processExpression(f, scope, enode.lhs, b, vars, t) as ssa.Variable;
                    }
                    let s = this.getSSAType(enode.lhs.type) as ssa.StructType;
                    if (left instanceof ssa.Pointer) {
                        left.offset += s.fieldOffset(enode.name.value);
                        return left;
                    }
                    let ptr = b.assign(b.tmp(), "addr_of", "ptr", [left]);
                    return new ssa.Pointer(ptr, s.fieldOffset(enode.name.value));
                } else {
                    throw "CodeGen: Implementation error"
                }
            }
            default:
                throw "CodeGen: Implementation error " + enode.op;
        }
    }

    private processNullCheck(value: ssa.Variable | number, t: Type, b: ssa.Builder) {
        if (this.tc.isSafePointer(t)) {
            if (TypeChecker.isReference(t)) {
                // References can point to an object that has already been destructed.
                // Hence, we use notnull_ref to track this.
                b.assign(null, "notnull_ref", null, [value]);
            } else {
                b.assign(null, "notnull", null, [value]);
            }
        } else {
            throw "Implementation error"
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
        if (n.type == TypeChecker.t_bool) {
            buf.push(n.value == "true" ? 1 : 0);
        } else if (n.type == TypeChecker.t_uint8 || n.type == TypeChecker.t_byte) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint16) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint32 || n.type == TypeChecker.t_rune) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint64) {
            // TODO large numbers
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int8 || n.type == TypeChecker.t_char) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int16) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int32) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int64) {
            // TODO large numbers
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int) {
            buf.push(parseInt(n.value));
        } else if (n.type == TypeChecker.t_float) {
            buf.push(parseFloat(n.value));
        } else if (n.type == TypeChecker.t_double) {
            buf.push(parseFloat(n.value));
        } else if (n.type == TypeChecker.t_string) {
            buf.push(n.value);
        } else if (this.tc.isSafePointer(n.type) || this.tc.isUnsafePointer(n.type)) {
            if (n.op != "null" && (n.op != "int" || n.numValue != 0)) {
                throw "Implementation error"
            }
            buf.push(0);
        } else if (this.tc.isArray(n.type)) {
            let arrType = RestrictedType.strip(n.type) as ArrayType;
            let arrData = new ssa.BinaryArray();
            arrData.totalLen = arrType.size;
            if (n.parameters) {
                for(let p of n.parameters) {
                    if (p.op == "unary...") {
                        throw "Implementation error";
                    }
                    if (p.op == "...") {
                        continue;
                    }
                    this.processPureLiteralInternal(p, arrData.data);
                }
            }
            buf.push(arrData);
        } else if (this.tc.isTuple(n.type)) {
            for(let p of n.parameters) {
                this.processPureLiteralInternal(p, buf);
            }
        } else if (this.tc.isStruct(n.type)) {
            for(let f of (this.tc.stripType(n.type) as StructType).fields) {
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
            throw "Implementation error";
        }
    }

    /*
    private processPureLiteralInternal(n: Node, buf: BinaryBuffer): void {        
        if (n.type == TypeChecker.t_bool) {
            buf.appendUint8(n.value == "true" ? 1 : 0);
        } else if (n.type == TypeChecker.t_uint8) {
            buf.appendUint8(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint16) {
            buf.appendUint16(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint32 || n.type == TypeChecker.t_rune) {
            buf.appendUint32(parseInt(n.value));
        } else if (n.type == TypeChecker.t_uint64) {
            // TODO large numbers
            buf.appendUint64(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int8) {
            buf.appendInt8(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int16) {
            buf.appendInt16(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int32) {
            buf.appendInt32(parseInt(n.value));
        } else if (n.type == TypeChecker.t_int64) {
            // TODO large numbers
            buf.appendInt64(parseInt(n.value));
        } else if (n.type == TypeChecker.t_float) {
            buf.appendFloat32(parseFloat(n.value));
        } else if (n.type == TypeChecker.t_double) {
            buf.appendFloat64(parseFloat(n.value));
        } else if (n.type instanceof PointerType) {
            if (n.op != "null" && (n.op != "int" || n.numValue != 0)) {
                throw "Implementation error"
            }
            buf.appendPointer(0);
        } else if (n.type instanceof ArrayType) {

        } else if (n.type instanceof TupleType || n.type instanceof StructType) {
            
        } else {
            throw "Implementation error";
        }
    }
    */

    public isLeftHandSide(node: Node): boolean {
        if (node.op == "id") {
            return true;
        } else if (node.op == "unary*") {
            return true;
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
            let methodObjType = RestrictedType.strip((RestrictedType.strip(method.objectType) as tc.PointerType).elementType);
            if (!(methodObjType instanceof tc.StructType)) {
                throw "Implementation error";
            }
            let methodName = methodObjType.pkg.pkgPath + "/" + methodObjType.name + "." + m;
            let f = s.pkg.scope.resolveElement(methodName);
            if (!(f instanceof Function)) {
                throw "Implementation error";
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

    public autoConvertData(data: ssa.Variable | number | ssa.Pointer, targetType: Type, fromType: Type, b: ssa.Builder): ssa.Variable | number {
        let v: ssa.Variable | number;
        if (data instanceof ssa.Pointer) {
            v = b.assign(b.tmp(), "load", this.getSSAType(fromType), [data.variable, data.offset]);
        } else {
            v = data;
        }

        // Convert a normal slice to a local-reference slice
        if (this.tc.isSlice(fromType) && !TypeChecker.isLocalReference(fromType) && this.tc.isSlice(targetType) && TypeChecker.isLocalReference(targetType)) {
            v = b.assign(b.tmp(), "member", this.localSlicePointer, [v, 0]);
        } else if (this.tc.isInterface(targetType) && !this.tc.isInterface(fromType)) {
            // Assign a pointer to some struct to a pointer to some interface? -> create an ifaceHeader instance
            if (!this.tc.isSafePointer(fromType)) {
                throw "Implementation error";
            }
            let structType = RestrictedType.strip((RestrictedType.strip(fromType) as PointerType).elementType);
            let ifaceType = RestrictedType.strip((RestrictedType.strip(targetType) as PointerType).elementType);
            if (!(structType instanceof StructType)) {
                throw "Implementation error";
            }
            if (!(ifaceType instanceof InterfaceType)) {
                throw "Implementation error";
            }
            let descriptor = this.createInterfaceDescriptor(ifaceType, structType);
            let d = b.assign(b.tmp(), "table_iface", "addr", [descriptor]);
            v = b.assign(b.tmp(), "struct", this.ifaceHeader, [v, d]);
        }
        // TODO: Encode data for an any
        /*
        if ((this.tc.isInterface(targetType) || this.tc.isComplexOrType(targetType)) && !this.tc.isInterface(enode.type) && !this.tc.isComplexOrType(enode.type)) {
            // TODO: Do not use instanceof here
            if (this.tc.isUnsafePointer(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type instanceof PointerType && enode.type.elementType instanceof StructType) {
                let index = this.createInterfaceTable(scope, enode.type.elementType);
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), v, index]);                
            } else if (this.tc.checkIsPointer(enode, false) || this.tc.isString(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), v, 0]);
            } else if (this.tc.isSlice(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderSlice, [this.typecode(enode.type), v]);
            } else if (this.tc.isArray(enode.type)) {
                // TODO: Copy to allocated area
                throw "TODO";
            } else if (this.tc.isStruct(enode.type)) {
                throw "TODO";
            } else if (enode.type == TypeChecker.t_int64 || enode.type == TypeChecker.t_uint64) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == TypeChecker.t_float) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderFloat, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == TypeChecker.t_double) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderDouble, [this.typecode(enode.type), 0, v]);
            } else if (this.tc.isNumber(enode.type) || enode.type == TypeChecker.t_bool) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == TypeChecker.t_null) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, 0]);
            } else if (enode.type instanceof StringLiteralType) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, 0]);
            } else if (this.tc.isOrType(enode.type)) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [v, 0, 0]);
            } else {
                throw "Implementation error " + enode.type.toString();
            }
        } else if (!this.tc.isInterface(targetType) && !this.tc.isComplexOrType(targetType) && (this.tc.isInterface(enode.type) || this.tc.isComplexOrType(enode.type))) {
            return this.processUnboxInterface(targetType, v, b);
        }
        */
        return v;
    }

    /*
    private processUnboxInterface(targetType: Type, v: number | ssa.Variable, b: ssa.Builder): ssa.Variable | number {        
        let addr = b.assign(b.tmp("addr"), "addr_of", "addr", [v]);
        if (this.tc.isUnsafePointer(targetType)) {
            return b.assign(b.tmp(), "load", "addr", [addr, this.ifaceHeader32.fieldOffset("value")]);
        } else if (this.tc.isSafePointer(targetType) || this.tc.isString(targetType)) {
            return b.assign(b.tmp(), "load", "ptr", [addr, this.ifaceHeader.fieldOffset("pointer")]);
        } else if (this.tc.isSlice(targetType)) {
            return b.assign(b.tmp(), "load", this.slicePointer, [addr, this.ifaceHeaderSlice.fieldOffset("value")]);
        } else if (this.tc.isArray(targetType)) {
            // TODO: Copy to allocated area
            throw "TODO";
        } else if (this.tc.isStruct(targetType)) {
            throw "TODO";
        } else if (targetType == TypeChecker.t_int64 || targetType == TypeChecker.t_uint64) {
            return b.assign(b.tmp(), "load", "i64", [addr, this.ifaceHeader.fieldOffset("value")]);
        } else if (targetType == TypeChecker.t_double) {
            return b.assign(b.tmp(), "load", "f64", [addr, this.ifaceHeaderDouble.fieldOffset("value")]);
        } else if (targetType == TypeChecker.t_float) {
            return b.assign(b.tmp(), "load", "f32", [addr, this.ifaceHeaderFloat.fieldOffset("value")]);
        } else if (this.tc.isNumber(targetType) || targetType == TypeChecker.t_bool) {
            return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("value")]);
        } else if (this.tc.isOrType(targetType)) {
            return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("typecode")]);
        } else {
            throw "Implementation error";
        }                
    }
    */

    private processExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, targetType: Type): ssa.Variable | number {
        switch(enode.op) {
            case "null":
                if (this.tc.isSlice(enode.type)) {
                    if (TypeChecker.isLocalReference(enode.type)) {
                        let zeros = this.generateZeroStruct(this.localSlicePointer);
                        return b.assign(b.tmp(), "struct", this.localSlicePointer, zeros);
                    }
                    let zeros = this.generateZeroStruct(this.slicePointer);
                    return b.assign(b.tmp(), "struct", this.slicePointer, zeros);
                }
                return 0;
            case "int":
                return parseInt(enode.value);
            case "float":
            {
                let v = new ssa.Variable();
                if (enode.type == TypeChecker.t_float) {
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
                if (this.tc.isStringLiteralType(enode.type)) {
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
                let t = this.tc.stripType(enode.type);
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
                                let v = this.processLiteralArgument(f, scope, p, t.fields[i].type, b, vars);
                                args.push(v);
                            }
                        }
                        let v = b.assign(b.tmp(), "struct", st, args);
                        b.assign(b.mem, "store", st, [ptr, 0, v]);
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
                                if (t.keyType != TypeChecker.t_string) {
                                    throw "Implementation error";
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
                            let v = this.processLiteralArgument(f, scope, p, t.fields[i].type, b, vars);
                            args.push(v);
                        }
                    }
                    return b.assign(b.tmp(), "struct", st, args);
                }
                throw "Implementation error";
            }
            case "tuple":
            {
                let t = this.tc.stripType(enode.type);
                let st = this.getSSAType(enode.type); // This returns a struct type
                let args: Array<string | ssa.Variable | number> = [];
                for(let i = 0; i < enode.parameters.length; i++) {
                    let v = this.processLiteralArgument(f, scope, enode.parameters[i], (t as TupleType).types[i], b, vars);
                    args.push(v);
                }
                return b.assign(b.tmp(), "struct", st, args);                
            }
            case "array":
            {
                let t = this.tc.stripType(enode.type);
                if (t instanceof SliceType) {
                    let et = this.getSSAType(t.getElementType());
                    let esize = ssa.alignedSizeOf(et);
                    let count: number | ssa.Variable = enode.parameters.length;
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let p = enode.parameters[i];
                        if (p.op == "unary...") {
                            if (typeof(count) != "number") {
                                throw "Implementation error";
                            }
                            count--;
                            let dynCount = this.processExpression(f, scope, p.rhs, b, vars, TypeChecker.t_int);
                            if (typeof(dynCount) == "number") {
                                count += dynCount;
                            } else if (count == 0) {
                                count = dynCount;
                            } else {
                                count = b.assign(b.tmp(), "add", "sint", [count, dynCount]);
                            }
                            break;
                        }
                    }
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [count, esize]);
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let p = enode.parameters[i];
                        if (p.op == "unary...") {
                            continue;
                        }
                        let v = this.processLiteralArgument(f, scope, p, t.getElementType(), b, vars);
                        b.assign(b.mem, "store", et, [ptr, i * esize, v]);
                    }
                    return b.assign(b.tmp(), "struct", this.slicePointer, [ptr, count, ptr]);
                } else if (t instanceof ArrayType) {
                    let st = this.getSSAType(t); // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    for(let i = 0; i < enode.parameters.length; i++) {
                        if (enode.parameters[i].op == "...") {
                            continue;
                        }
                        let v = this.processLiteralArgument(f, scope, enode.parameters[i], t.elementType, b, vars);
                        args.push(v);
                    }
                    return b.assign(b.tmp(), "struct", st, args);
                }
                throw "Implementation error";
            }
            case "==":
                return this.processCompare("eq", f, scope, enode, b, vars);
            case "!=":
                return this.processCompare("ne", f, scope, enode, b, vars);
            case "<":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == TypeChecker.t_float || t == TypeChecker.t_double || t == TypeChecker.t_string) {
                    return this.processCompare("lt", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("lt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("lt_u", f, scope, enode, b, vars);
            }
            case ">":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == TypeChecker.t_float || t == TypeChecker.t_double || t == TypeChecker.t_string) {
                    return this.processCompare("gt", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("gt_s", f, scope, enode, b, vars);
                }
                return this.processCompare("gt_u", f, scope, enode, b, vars);
            }
            case "<=":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == TypeChecker.t_float || t == TypeChecker.t_double || t == TypeChecker.t_string) {
                    return this.processCompare("le", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("le_s", f, scope, enode, b, vars);
                }
                return this.processCompare("le_u", f, scope, enode, b, vars);
            }
            case ">=":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t == TypeChecker.t_float || t == TypeChecker.t_double || t == TypeChecker.t_string) {
                    return this.processCompare("ge", f, scope, enode, b, vars);
                }
                if (!(t instanceof UnsafePointerType) && this.isSigned(t)) {
                    return this.processCompare("ge_s", f, scope, enode, b, vars);
                }
                return this.processCompare("ge_u", f, scope, enode, b, vars);
            }
            case "+":
            {
                let t = this.tc.stripType(enode.type);
                if (t == TypeChecker.t_string) {
                    let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    if (!this.disableNullCheck && !(p1 as ssa.Variable).isConstant) {
                        b.assign(null, "notnull_ref", null, [p1]);
                    }
                    let l1 = b.assign(b.tmp(), "len_str", "sint", [p1]);
                    let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                    if (!this.disableNullCheck && !(p2 as ssa.Variable).isConstant) {
                        b.assign(null, "notnull_ref", null, [p2]);
                    }
                    let l2 = b.assign(b.tmp(), "len_str", "sint", [p2]);
                    let l = b.assign(b.tmp(), "add", "sint", [l1, l2]);
                    let lplus = b.assign(b.tmp(), "add", "sint", [l, 1]);
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [lplus, 1]);
                    b.assign(b.mem, "memcpy", null, [ptr, p1, l1, 1]);
                    let ptr2 = b.assign(b.tmp(), "add", "addr", [ptr, l1]);
                    b.assign(b.mem, "memcpy", null, [ptr2, p2, l2, 1]);
                    // Decref p1 and p2 if necessary
                    if (this.tc.isTakeExpression(enode.lhs)) {
                        this.callDestructorOnVariable(TypeChecker.t_string, p1 as ssa.Variable, b, true);
                    }
                    if (this.tc.isTakeExpression(enode.rhs)) {
                        this.callDestructorOnVariable(TypeChecker.t_string, p2 as ssa.Variable, b, true);
                    }
                    return ptr;
                }
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, TypeChecker.t_int);
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                } else {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                }
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "add", storage, [p1, p2]);
            }
            case "*":
            case "-":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, TypeChecker.t_int);
                    let estorage = this.getSSAType(t.elementType);
                    let size = ssa.sizeOf(estorage);
                    if (size > 1) {
                        p2 = b.assign(b.tmp(), "mul", "i32", [p2, size]);
                    }
                } else {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                }
                let storage = this.getSSAType(t);
                let opcode: "mul" | "sub" = enode.op == "*" ? "mul" : "sub";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "/":
            {
                let t = this.tc.stripType(enode.type);
                let storage = this.getSSAType(t);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                if (storage == "f32" || storage == "f64") {
                    return b.assign(b.tmp(), "div", storage, [p1, p2]);
                }
                let opcode: "div_u" | "div_s" = this.isSigned(t) ? "div_s" : "div_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "%":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                let opcode: "rem_u" | "rem_s" = this.isSigned(t) ? "rem_s" : "rem_u";
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "|":
            case "&":
            case "^":
            {
                let t = this.tc.stripType(enode.type);
                let opcode: "or" | "xor" | "and" = enode.op == "|" ? "or" : (enode.op == "&" ? "and" : "xor");
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                return b.assign(b.tmp(), opcode, storage, [p1, p2]);
            }
            case "&^":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                let tmp = b.assign(b.tmp(), "xor", storage, [p2, -1]);
                return b.assign(b.tmp(), "and", storage, [p1, tmp]);
            }
            case "unary!":
            {
                let t = this.tc.stripType(enode.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                return b.assign(b.tmp(), "eqz", storage, [p]);
            }
            case "unary+":
            {
                let t = this.tc.stripType(enode.type);
                return this.processExpression(f, scope, enode.rhs, b, vars, t);
            }
            case "unary-":
            {
                let t = this.tc.stripType(enode.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(t);
                if (t == TypeChecker.t_float || t == TypeChecker.t_double) {
                    return b.assign(b.tmp(), "neg", storage, [p]);
                }
                let tmp = b.assign(b.tmp(), "xor", storage, [p, -1]);
                return b.assign(b.tmp(), "add", storage, [tmp, 1]);
            }
            case "unary^":
            {
                let t = this.tc.stripType(enode.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(enode.rhs.type);
                return b.assign(b.tmp(), "xor", storage, [p, -1]);
            }
            case "unary*":
            {
                let t = this.tc.stripType(enode.rhs.type);
                let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                if (t instanceof UnsafePointerType) {
                    let storage = this.getSSAType(t.elementType);
                    return b.assign(b.tmp(), "load", storage, [p, 0]);
                } else if (t instanceof PointerType) {
                    let storage = this.getSSAType(t.elementType);
                    return b.assign(b.tmp(), "load", storage, [p, 0]);
                }                                
                throw "Implementation error";
            }
            case "unary&":
            {
                if (enode.rhs.op == "bool" || enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "str" || enode.rhs.op == "array" || enode.rhs.op == "tuple" || enode.rhs.op == "object") {
                    // Make a copy of a literal
                    let t = this.tc.stripType(enode.rhs.type);
                    let p = this.processExpression(f, scope, enode.rhs, b, vars, t);
                    let s = this.getSSAType(t);
                    let copy = b.assign(b.tmp(), "alloc", "addr", [ssa.sizeOf(s)]);
                    b.assign(b.mem, "store", s, [copy, 0, p]);
                    return copy;
                }
                let p = this.processLeftHandExpression(f, scope, enode.rhs, b, vars);
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
                let t = this.tc.stripType(enode.type);
                let result = b.tmp();
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                b.assign(result, "const", "i8", [1]);
                b.elseBlock();
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                b.assign(result, "copy", "i8", [p2]);
                b.end();
                return result;
            }
            case "&&":
            {
                let t = this.tc.stripType(enode.type);
                let result = b.tmp();
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                // TODO: Use if-expressions in IR
                b.ifBlock(p1);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                b.assign(result, "copy", "i8", [p2]);
                b.elseBlock();
                b.assign(result, "const", "i8", [0]);
                b.end();
                return result;
            }
            case ">>":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), this.isSigned(enode.lhs.type) ? "shr_s" : "shr_u", storage, [p1, p2]);
            }
            case "<<":
            {
                let t = this.tc.stripType(enode.type);
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                let storage = this.getSSAType(enode.lhs.type);
                return b.assign(b.tmp(), "shl", storage, [p1, p2]);
            }
            case "id":
            {
                let element = scope.resolveElement(enode.value);
                return vars.get(element);
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
                let objPtr: ssa.Variable | ssa.Pointer | number | null = null;
                let striplhs = this.tc.stripType(enode.lhs.type);
                let lhs = enode.lhs;
                if (lhs.op == "genericInstance") {
                    lhs = lhs.lhs;
                }
                if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "remove") {
                    /*
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof MapType)) {
                        throw "Implementation error";
                    }
                    let m = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType);
                    let key = this.processExpression(f, scope, enode.parameters[0], b, vars, objType.keyType);
                    if (objType.keyType == TypeChecker.t_string) {
                        return b.call(b.tmp(), this.removeMapKeyFunctionType, [SystemCalls.removeMapKey, m, key]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (objType.keyType == TypeChecker.t_int64 || objType.keyType == TypeChecker.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(objType.keyType), [key]);
                        }   
                        return b.call(b.tmp(), this.removeNumericMapKeyFunctionType, [SystemCalls.removeNumericMapKey, m, key64]);
                    } */
                    throw "TODO";
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system") {
                    // A built-in function. Nothing to do here
                    t = striplhs;
                } else if (lhs.op == "id") {
                    // Calling a named function
                    let e = scope.resolveElement(lhs.value);
                    if (e instanceof TemplateFunction) {
                        if (!(enode.lhs.type instanceof TemplateFunctionType)) {
                            throw "Implementation error";
                        }
                        let name = e.type.pkg.pkgPath + "/" + lhs.value + TypeChecker.mangleTemplateParameters(enode.lhs.type.templateParameterTypes);
                        e = this.tc.pkg.scope.resolveElement(name);
                    }
                    if (!(e instanceof Function)) {
                        throw "Implementation error";
                    }    
                    f = e;
                    t = f.type;
                /* } else if (enode.lhs.op == "genericInstance") {
                    // Lookup the template function
                    let tmplFunc = scope.resolveElement(enode.lhs.lhs.value);
                    if (!(tmplFunc instanceof TemplateFunction)) {
                        throw "Implementation error";
                    }
                    let types: Array<Type> = [];
                    for(let g of enode.lhs.genericParameters) {
                        types.push(g.type);
                    }
                    let name = tmplFunc.type.pkg.pkgPath + "/" + enode.lhs.lhs.value + TypeChecker.mangleTemplateParameters(types);
                    let e = scope.resolveElement(name);
                    if (!(e instanceof Function)) {
                        throw "Implementation error";
                    }
                    f = e;
                    t = f.type;                */
                } else if (lhs.op == "." && lhs.lhs.type instanceof PackageType) {
                    // Calling a function of some package?
                    let pkg = lhs.lhs.type.pkg;
                    let name = lhs.name.value;
                    let e = pkg.scope.resolveElement(name);
                    if (e instanceof TemplateFunction) {                        
                        if (!(enode.lhs.type instanceof TemplateFunctionType)) {
                            throw "Implementation error";
                        }
                        let name = e.type.pkg.pkgPath + "/" + lhs.name.value + TypeChecker.mangleTemplateParameters(enode.lhs.type.templateParameterTypes);
                        e = this.tc.pkg.scope.resolveElement(name);
                    }
                    if (!(e instanceof Function)) {
                        throw "Implementation error";
                    }    
                    f = e;
                    t = f.type;                    
                } else if (lhs.op == ".") {
                    // Calling a member function?
                    let ltype = this.tc.stripType(lhs.lhs.type);
                    let objType: Type;
                    if (ltype instanceof PointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        if (!(objType instanceof InterfaceType)) {
                            objPtr = this.processExpression(f, scope, lhs.lhs, b, vars, ltype);
                        }
                    } else if (ltype instanceof UnsafePointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        objPtr = this.processExpression(f, scope, lhs.lhs, b, vars, ltype);
                    } else if (ltype instanceof StructType) {
                        objType = ltype;
                        if (this.isLeftHandSide(lhs.lhs)) {
                            objPtr = this.processLeftHandExpression(f, scope, lhs.lhs, b, vars);
                            if (objPtr instanceof ssa.Variable) {
                                objPtr = b.assign(b.tmp(), "addr_of", "addr", [objPtr]);
                            }
                        } else {
                            let value = this.processExpression(f, scope, lhs.lhs, b, vars, ltype);
                            objPtr = b.assign(b.tmp(), "addr_of", "addr", [value]);
                        }
                    } else {
                        throw "Implementation error"
                    }
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
                            throw "Implementation error";
                        }
                        f = e;
                        t = f.type;
                    } else if (objType instanceof InterfaceType) {
                        let iface: ssa.Pointer | ssa.Variable;
                        if (this.isLeftHandSide(lhs.lhs)) {
                            iface = this.processLeftHandExpression(f, scope, lhs.lhs, b, vars);
                        } else {
                            iface = this.processExpression(f, scope, lhs.lhs, b, vars, ltype) as ssa.Variable;
                        }
                        let table: ssa.Variable;
                        if (iface instanceof ssa.Pointer) {
                            objPtr = b.assign(b.tmp(), "load", "addr", [iface.variable, iface.offset + this.ifaceHeader.fieldOffset("pointer")]);
                            table = b.assign(b.tmp(), "load", "addr", [iface.variable, iface.offset + this.ifaceHeader.fieldOffset("table")]);
                        } else {
                            objPtr = b.assign(b.tmp(), "member", "addr", [iface, this.ifaceHeader.fieldIndexByName("pointer")]);
                            table = b.assign(b.tmp(), "member", "addr", [iface, this.ifaceHeader.fieldIndexByName("table")]);
                        }
                        if (!this.disableNullCheck) {
                            this.processNullCheck(objPtr, ltype, b);
                        }
                        let name = lhs.name.value;
                        let idx = objType.methodIndex(name);
                        findex = b.assign(b.tmp(), "load", "addr", [table, idx * ssa.sizeOf("addr")]);
                        t = objType.method(name);
                    } else {
                        throw "Implementation error";
                    }
                } else {
                    // Calling a lamdba function
                    t = lhs.type as FunctionType;
                }
                
                if (f) {
                    if (!this.funcs.has(f)) {
                        // this.funcs.set(f, this.backend.importFunction(f.name, f.scope.package(), this.getSSAFunctionType(f.type)));
                        this.funcs.set(f, this.backend.importFunction(f.name, f.importFromModule, this.getSSAFunctionType(f.type)));
                    }
                    args.push(this.funcs.get(f).getIndex());
                } else if (findex) {
                    args.push(findex);
                }

                let decrefArgs: Array<[Node, ssa.Variable, "none" | "decref" | "free" | "unlock"]> = [];
                if (objPtr !== null) {
                    // Add 'this' to the arguments
                    let data: ssa.Variable | number;
                    if (objPtr instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "add", "addr", [objPtr.variable, objPtr.offset]);
                    } else {
                        data = objPtr;
                    }
                    let targetType = this.tc.stripType(enode.lhs.lhs.type);
                    let dataAndRef = this.functionArgumentIncref(objPtr, enode.lhs.lhs, data, targetType, true, scope, b);
                    args.push(dataAndRef[0]);
                    if (dataAndRef[1]) {
                        decrefArgs.push([enode.lhs.lhs, dataAndRef[1], dataAndRef[2]]);
                    }                
                }                

                // Compute arguments
                if (t.hasEllipsis() && (enode.parameters.length != t.parameters.length || enode.parameters[enode.parameters.length - 1].op != "unary...")) {
                    // TODO: If the last parameter is volatile, the alloc is not necessary.
                    let elementType = this.getSSAType((t.lastParameter().type as SliceType).getElementType());
                    let normalParametersCount = t.parameters.length - 1 - (t.objectType ? 1 : 0);
                    for(let i = 0; i < normalParametersCount; i++) {
                        args.push(this.processExpression(f, scope, enode.parameters[i], b, vars, t.parameters[i].type));
                    }
                    let elementSize = ssa.alignedSizeOf(elementType);
                    let mem = b.assign(b.tmp("ptr"), "alloc_arr", "addr", [enode.parameters.length - normalParametersCount, elementSize]);
                    let offset = 0;
                    for(let i = normalParametersCount; i < enode.parameters.length; i++, offset += elementSize) {
                        let v = this.processExpression(f, scope, enode.parameters[i], b, vars, (t.lastParameter().type as SliceType).getElementType());
                        b.assign(b.mem, "store", elementType, [mem, offset, v]);
                    }
                    args.push(b.assign(b.tmp(), "struct", this.localSlicePointer, [mem, enode.parameters.length - normalParametersCount]));
                    // TODO: There is no take and incref support here
                } else if (enode.parameters) {
                    // TODO: Evaluate parameters from right to left as in C
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let pnode = enode.parameters[i];
                        let vnode = pnode.op == "unary..." ? pnode.rhs : pnode;
                        // Evaluate the RHS
                        let targetType = t.parameters[i].type;
                        let rhs: ssa.Variable | ssa.Pointer | number;
                        if ((vnode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || vnode.op == "take") {
                            rhs = this.processLeftHandExpression(f, scope, vnode, b, vars);
                        } else {
                            rhs = this.processExpression(f, scope, vnode, b, vars, targetType);                            
                        }
                        let st = this.getSSAType(pnode.type);
                        // Load the data if we have a pointer to it
                        let data: ssa.Variable | number;
                        if (rhs instanceof ssa.Pointer) {
                            data = b.assign(b.tmp(), "load", st, [rhs.variable, rhs.offset]);
                        } else {
                            data = rhs;
                        }     
                        let dataAndRef = this.functionArgumentIncref(rhs, vnode, data, targetType, false, scope, b);
                        args.push(dataAndRef[0]);
                        if (dataAndRef[1]) {
                            decrefArgs.push([vnode, dataAndRef[1], dataAndRef[2]]);
                        }
                    }
                }
                
                let result: ssa.Variable | number;
                if (f) {
                    let ft = this.getSSAFunctionType(t);
                    if (isSpawn) {
                        b.spawn(ft, args);
                        result = 0;
                    } else {
                        result = b.call(b.tmp(), ft, args);
                    }
                } else if (findex) {
                    let ft = this.getSSAFunctionType(t);
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
                    throw "TODO: call a lambda function"
                }

                for(let decrefArg of decrefArgs) {
                    this.functionArgumentDecref(decrefArg[1], decrefArg[0], decrefArg[2], b);
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
                        index1 = this.processExpression(f, scope, enode.parameters[0], b, vars, TypeChecker.t_int);
                    }
                }
                let index2: ssa.Variable | number = 0;
                if (enode.parameters[1]) {
                    if (enode.parameters[1].op == "int") {
                        index2 = parseInt(enode.parameters[1].value);
                    } else {
                        index2 = this.processExpression(f, scope, enode.parameters[1], b, vars, TypeChecker.t_int);
                    }
                }
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof UnsafePointerType) {
                    if (!TypeChecker.isLocalReference(enode.type)) {
                        throw "Implementation error";
                    }
                    let size = ssa.alignedSizeOf(this.getSSAType(t.elementType));
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, t);
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
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, t) as ssa.Variable;
                    }
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    let array_ptr: ssa.Variable;
                    if (head_addr instanceof ssa.Pointer) {
                        data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                        if (!TypeChecker.isLocalReference(enode.type)) {
                            array_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.slicePointer.fieldOffset("array_ptr")]);
                        }
                    } else {
                        if (t.mode == "local_reference") {
                            data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            len = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            if (!TypeChecker.isLocalReference(enode.type)) {
                                array_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr")]);
                            }
                            let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                            data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                            len = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
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
                    if (TypeChecker.isLocalReference(enode.type)) {
                        if (this.tc.isTakeExpression(enode.lhs)) {
                            throw "Implementation error";
                        }
                        return b.assign(b.tmp(), "struct", this.localSlicePointer, [data_ptr, l]);                        
                    }
//                    if (TypeChecker.isReference(enode.type) && !this.tc.isTakeExpression(enode.lhs)) {
//                        b.assign(null, "incref_arr", null, [array_ptr]);
//                    }
                    return b.assign(b.tmp(), "struct", this.slicePointer, [data_ptr, l, array_ptr]);
                } else if (t == TypeChecker.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, TypeChecker.t_string);
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
                    if (this.tc.isTakeExpression(enode.lhs)) {
                        b.assign(null, "decref_arr", null, [ptr]);
                    }
                    return result;
                } else if (t instanceof ArrayType) {
//                    if (!TypeChecker.isLocalReference(enode.type)) {
//                        throw "Implementation error";
//                    }
                    let ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
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
                    if (TypeChecker.isLocalReference(enode.type)) {
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
                    throw "Implementation error";
                }                
            }
            case "[":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof MapType) {           
                    /*         
                    let m = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let key = this.processExpression(f, scope, enode.rhs, b, vars, t.keyType);
                    let result: ssa.Variable;
                    if (t.keyType == TypeChecker.t_string) {
                        result = b.call(b.tmp(), this.lookupMapFunctionType, [SystemCalls.lookupMap, m, key]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (t.keyType == TypeChecker.t_int64 || t.keyType == TypeChecker.t_uint64) {
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
                    return b.assign(b.tmp(), "load", this.getSSAType(this.tc.stripType(t.valueType)), [result, 0]);
                    */
                } else if (t == TypeChecker.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, TypeChecker.t_int);
                    }
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
                    return b.assign(b.tmp(), "load", "i8", [tmp, 0]);
                }
                // Note: processLeftHandExpression implements the non-left-hand cases as well.
                let ptr = this.processLeftHandExpression(f, scope, enode, b, vars) as ssa.Pointer;
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "load", storage, [ptr.variable, ptr.offset]);
            }
            case ".":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof StructType) {
                    // It is a value, i.e. not a pointer to a value
                    let left = this.processExpression(f, scope, enode.lhs, b, vars, t) as ssa.Variable;                    
                    let memberType = this.getSSAType(enode.type) as ssa.StructType;
                    let structType = this.getSSAType(enode.lhs.type) as ssa.StructType;
                    return b.assign(b.tmp(), "member", memberType, [left, structType.fieldIndexByName(enode.name.value)]);
                }
                // Note: processLeftHandExpression implements the non-left-hand cases as well.
                let expr = this.processLeftHandExpression(f, scope, enode, b, vars) as ssa.Pointer;
                let storage = this.getSSAType(enode.type);
                return b.assign(b.tmp(), "load", storage, [expr.variable, expr.offset]);
            }
            case "is":
            {
                let rtype = RestrictedType.strip(enode.rhs.type);
                let ltype = RestrictedType.strip(enode.lhs.type);
                if (this.tc.isStringOrType(enode.lhs.type)) {
                    let ltypecode = this.processExpression(f, scope, enode.lhs, b, vars, enode.lhs.type);    
                    throw "TODO"                
                    // return b.assign(b.tmp(), "eq", "i32", [ltypecode, rtypecode]);
                } else if (this.tc.isInterface(ltype)) {
                    let ifaceAddr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        ifaceAddr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        ifaceAddr = this.processExpression(f, scope, enode.lhs, b, vars, enode.lhs.type) as ssa.Variable;
                    }
                    let ifaceType = RestrictedType.strip((ltype as tc.PointerType).elementType);
                    if (!(ifaceType instanceof InterfaceType)) {
                        throw "Implementation error";
                    }
                    let structType = RestrictedType.strip((rtype as tc.PointerType).elementType);
                    if (!(structType instanceof tc.StructType)) {
                        throw "Implementation error";
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
                } else {
                    throw "TODO: OrType"
                }
            }
            case "typeCast":
            {
                let t = enode.type;
                let t2 = this.tc.stripType(enode.rhs.type);
                let expr: number | ssa.Variable;
                if (t == TypeChecker.t_string && t2 instanceof SliceType && enode.rhs.op == "clone") {
                    t2 = this.tc.stripType(enode.rhs.lhs.type);
                    expr = this.processExpression(f, scope, enode.rhs.lhs, b, vars, t2);
                } else {
                    expr = this.processExpression(f, scope, enode.rhs, b, vars, t2);
                }
                let s = this.getSSAType(t);
                let s2 = this.getSSAType(enode.rhs.type);
                if ((t == TypeChecker.t_float || t == TypeChecker.t_double) && this.tc.isIntNumber(t2)) {
                    // Ints can be converted to floats
                    let to = this.getSSAType(t);
                    let op: "convert64_s" | "convert64_u" | "convert32_u" | "convert32_s";
                    if (t2 == TypeChecker.t_uint64) {
                        op = "convert64_u";
                    } else if (t2 == TypeChecker.t_int64) {
                        op = "convert64_s";
                    } else {
                        op = this.isSigned(t2) ? "convert32_s" : "convert32_u";
                    }
                    return b.assign(b.tmp(), op, to, [expr]);
                } else if (this.tc.isIntNumber(t) && (t2 == TypeChecker.t_float || t2 == TypeChecker.t_double)) {
                    // Floats can be converted to ints
                    let to = this.getSSAType(t);
                    let op: "trunc64" | "trunc32";
                    if (t2 == TypeChecker.t_double) {
                        op = "trunc64";
                    } else {
                        op = "trunc32";
                    }
                    return b.assign(b.tmp(), op, to, [expr]);                    
                } else if (t == TypeChecker.t_float && t2 == TypeChecker.t_double) {
                    // Doubles can be converted to floats
                    return b.assign(b.tmp(), "demote", "f32", [expr]);
                } else if (t == TypeChecker.t_double && t2 == TypeChecker.t_float) {
                    // Floats can be converted to doubles
                    return b.assign(b.tmp(), "promote", "f64", [expr]);                    
                } else if (this.tc.isIntNumber(t) && t2 instanceof UnsafePointerType) {
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
                } else if (t instanceof UnsafePointerType && (t2 instanceof UnsafePointerType || t2 instanceof PointerType || t2 == TypeChecker.t_string)) {
                    // Convert pointer or string to unsafe pointer
                    return expr;
                } else if (t == TypeChecker.t_string && t2 instanceof UnsafePointerType) {
                    // Convert unsafe pointer to string
                    return expr;
                } else if (t == TypeChecker.t_string && t2 instanceof SliceType) {
                    // Convert a cloned slice to a string?
                    // Then add the trailing 0 while cloning.
                    if (enode.rhs.op == "clone") {
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
                        return str;
                    }
                    // Convert a slice to a string
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
                    return str;
                } else if ((t == TypeChecker.t_bool || t == TypeChecker.t_rune || this.tc.isIntNumber(t)) && (t2 == TypeChecker.t_bool || t2 == TypeChecker.t_rune || this.tc.checkIsIntNumber(enode.rhs, false))) {
                    // Convert between integers
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
                    return expr;
                } else if (t instanceof SliceType && t.getElementType() == TypeChecker.t_byte && t2 == TypeChecker.t_string) {
                    // Convert string to a slice.
                    // Using len_arr assures that the trailing zero is part of the string
                    let slice = b.assign(b.tmp(), "struct", this.slicePointer, [0, 0, 0]);
                    let nn = b.assign(b.tmp(), "ne", "i8", [expr, 0]);
                    b.ifBlock(nn);
                    let size = b.assign(b.tmp(), "len_arr", "sint", [expr]);                    
                    let newptr = b.assign(b.tmp(), "alloc_arr", "addr", [size, 1]);
                    b.assign(b.mem, "memcpy", null, [newptr, expr, size, 1]);
                    if (this.tc.isTakeExpression(enode.rhs)) {
                        this.callDestructorOnVariable(t2, expr as ssa.Variable, b, true);
                    }
                    b.assign(slice, "struct", this.slicePointer, [newptr, size, newptr]);
                    b.end();
                    return slice;
                } else if (t2 == TypeChecker.t_null) {
                    // Convert null to a pointer type
                    return expr;
                } else if (this.tc.isComplexOrType(t2)) {
                    throw "TODO: Unpack complex or type"
//                    return this.processUnboxInterface(t, expr, b);
                } else {
                    throw "TODO: conversion not implemented";
                }
            }
            case "take":
            {
                // This code does not work when take is a statement-level expression, because in this case refcounting and freeing is required.
                let t = this.getSSAType(enode.type);
                let src: ssa.Variable | ssa.Pointer = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                let pointer: ssa.Variable;
                if (src instanceof ssa.Pointer) {
                    let copy = b.assign(b.tmp(), "load", t, [src.variable, src.offset]);
                    if (t instanceof ssa.StructType) {
                        let tmp = b.assign(b.tmp(), "struct", t, this.generateZeroStruct(t));
                        b.assign(b.mem, "store", t, [src.variable, src.offset, tmp]);                        
                    } else {
                        b.assign(b.mem, "store", t, [src.variable, src.offset, 0]);                            
                    }
                    return copy;
                }
                let copy = b.assign(b.tmp(), "copy", t, [src]);
                if (t instanceof ssa.StructType) {
                    b.assign(src, "struct", t, this.generateZeroStruct(t));
                } else {
                    b.assign(src, "copy", t, [0]);                            
                }
                return copy;
            }
            case "len":
            {            
                let objType = RestrictedType.strip(enode.lhs.type);
                if (objType == TypeChecker.t_string) {
                    let s = this.processExpression(f, scope, enode.lhs, b, vars, TypeChecker.t_string);
                    return b.assign(b.tmp(), "len_str", "sint", [s]);
                } else if (objType instanceof SliceType) {
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, objType) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        if (objType.mode == "local_reference") {
                            return b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
                        let base = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                        return b.assign(b.tmp(), "member", "sint", [base, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                    return b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                } else if (objType instanceof ArrayType) {
                    return objType.size;
                }
                // TODO: Map
                throw "Implementation error";
            }
            case "cap":
            {
                let objType = this.tc.stripType(enode.lhs.type);
                if (objType instanceof SliceType) {
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, objType) as ssa.Variable;
                    }
                    if (objType.mode == "local_reference") {
                        if (head_addr instanceof ssa.Variable) {
                            return b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        } else {
                            return b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                        }
                    }
                    let arrayPointer: ssa.Variable;
                    if (head_addr instanceof ssa.Variable) {
                        arrayPointer = b.assign(b.tmp(), "member", "addr", [head_addr, this.slicePointer.fieldIndexByName("array_ptr")]);
                    } else {
                        arrayPointer = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.slicePointer.fieldOffset("array_ptr")]);
                    }
                    return b.assign(b.tmp(), "len_arr", "sint", [arrayPointer]);
                }
                throw "Implementation error";
            }
            case "clone":
            {
                let objType = this.tc.stripType(enode.lhs.type);
                if (!(objType instanceof SliceType)) {
                    throw "Implementation error";
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);
                // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                let head_addr: ssa.Variable | ssa.Pointer;
                if (this.isLeftHandSide(enode.lhs)) {
                    head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                } else {
                    head_addr = this.processExpression(f, scope, enode.lhs, b, vars, objType) as ssa.Variable;
                }
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
            case "pop": {
                let objType = this.tc.stripType(enode.lhs.type);
                if (!(objType instanceof SliceType)) {
                    throw "Implementation error";
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);

                // Get the address of the destination SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                // Append and Push modifies the slice, therefore the slice is a left-hand expression
                let head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);                
                let dest_data_ptr: ssa.Variable | number;
                // The current length of the slice
                let dest_count: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw "Implementation error";
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
                        throw "Implementation error";
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
                let objType = this.tc.stripType(enode.parameters[0].type);
                if (!(objType instanceof SliceType)) {
                    throw "Implementation error";
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
                        let head_addr: ssa.Variable | ssa.Pointer;
                        if (this.isLeftHandSide(p)) {
                            head_addr = this.processLeftHandExpression(f, scope, p, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, p, b, vars, objType) as ssa.Variable;
                        }
                        let src_data_ptr: ssa.Variable | number;
                        let src_count: ssa.Variable | number;
                        if (head_addr instanceof ssa.Variable) {
                            if (objType.mode == "local_reference") {
                                src_data_ptr = b.assign(b.tmp(), "member", "addr", [head_addr, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                                src_count = b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                            } else {
                                let tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                                src_data_ptr = b.assign(b.tmp(), "member", "addr", [tmp, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                                tmp = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.slicePointer.fieldIndexByName("base")]);
                                src_count = b.assign(b.tmp(), "member", "sint", [tmp, this.localSlicePointer.fieldIndexByName("data_length")]);
                            }
                        } else {
                            src_data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                            src_count = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                        }
                        src_data_ptr_arr.unshift(src_data_ptr);
                        src_count_arr.unshift(src_count);
                        // TODO: incref if the slice if necessary
                        req_count = b.assign(b.tmp(), "add", "sint", [req_count, src_count]);
                    } else {
                        let src = this.processExpression(f, scope, p, b, vars, objType.getElementType());
                        src_values.unshift(src);
                    }
                }

                // Get the address of the destination SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                // Append and Push modifies the slice, therefore the slice is a left-hand expression
                let head_addr = this.processLeftHandExpression(f, scope, enode.parameters[0], b, vars);                
                let dest_data_ptr: ssa.Variable | number;
                // The current length of the slice
                let dest_count: ssa.Variable | number;
                let dest_array: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw "Implementation error";
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
                        value_count++;
                    }
                }

                if (enode.op == "append") {
                    // Release the old array
                    let dtor = this.generateArrayDestructor(RestrictedType.strip(objType.arrayType) as ArrayType);
                    b.ifBlock(cond);                    
                    b.assign(null, "free_arr", null, [dest_array, dtor.getIndex()]);
                    b.end();
                }

                // Update length of the slice
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw "Implementation error";
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
                throw "Implementation error";
            }
            case "slice": {
                let objType = this.tc.stripType(enode.parameters[0].type);
                if (!(objType instanceof SliceType)) {
                    throw "Implementation error";
                }
                let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                let size = ssa.alignedSizeOf(elementType);

                let offset = this.processExpression(f, scope, enode.parameters[1], b, vars, TypeChecker.t_int);
                let len = this.processExpression(f, scope, enode.parameters[2], b, vars, TypeChecker.t_int);

                let head_addr = this.processLeftHandExpression(f, scope, enode.parameters[0], b, vars);
                // The current length of the slice
                let dest_array: ssa.Variable | number;
                let dest_data: ssa.Variable | number;
                if (head_addr instanceof ssa.Variable) {
                    if (objType.mode == "local_reference") {
                        throw "Implementation error";
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
                        throw "Implementation error";
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
            default:
                throw "CodeGen: Implementation error " + enode.op;
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
        let t = this.tc.stripType(enode.lhs.type);
        let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
        let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
        if (t == TypeChecker.t_string) {
            let cond = b.assign(b.tmp(), "eq", "i8", [p1, p2]);
            let l1 = b.assign(b.tmp(), "len_arr", "sint", [p1]);
            let l2 = b.assign(b.tmp(), "len_arr", "sint", [p2]);
            let l = b.assign(b.tmp(), "min", "sint", [l1, l2])
            let cmp = b.assign(b.tmp(), "memcmp", "sint", [p1, p2, l]);
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
            throw "Implementation error " + opcode;
        } else {
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

    public isSigned(t: Type): boolean {
        t = this.tc.stripType(t);
        if (t == TypeChecker.t_char || t == TypeChecker.t_int || t == TypeChecker.t_int8 || t == TypeChecker.t_int16 || t == TypeChecker.t_int32 || t == TypeChecker.t_int64 || t == TypeChecker.t_float || t == TypeChecker.t_double) {
            return true;
        }
        if (t == TypeChecker.t_byte || t == TypeChecker.t_uint || t == TypeChecker.t_uint8 || t == TypeChecker.t_uint16 || t == TypeChecker.t_uint32 || t == TypeChecker.t_uint64) {
            return false;
        }
        if (this.tc.isUnsafePointer(t)) {
            return true;
        }
        throw "CodeGen: Implementation error: signed check on non number type " + t.toString();       
    }

    private generateZero(t: ssa.Type | ssa.StructType | ssa.PointerType): Array<number> {
        if (t instanceof ssa.StructType) {
            return this.generateZeroStruct(t);
        }
        if (t instanceof ssa.PointerType) {
            return [0];
        }
        return [0];
    }

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

    private isPureLiteral(t: Type, n: Node): boolean {        
        t = RestrictedType.strip(t);
        if (t instanceof InterfaceType) {
            return false;
        }
        switch (n.op) {
            case "int":
            case "bool":
            case "float":
            case "null":
            case "rune":
            case "str":
                return true;
            case "array":                
            {
                if (this.tc.isArray(t)) {
                    if (n.parameters) {
                        for(let p of n.parameters) {
                            if (p.op == "unary...") {
                                continue;
                            } else if (!this.isPureLiteral((t as ArrayType).elementType, p)) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
                break;
            }
            case "tuple":
            {
                let i = 0
                for(let p of n.parameters) {
                    if (!this.isPureLiteral((t as TupleType).types[i], p)) {
                        return false;
                    }
                }
                return true;
            }
            case "object":
            {
                if (this.tc.isStruct(t)) {
                    if (n.parameters) {
                        for(let p of n.parameters) {
                            let f = (t as StructType).field(p.name.value);
                            if (!this.isPureLiteral(f.type, p.lhs)) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
                break;
            }
        }
        return false;
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

    private generateInterfaceDestructor(): backend.Function {
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

    /**
     * pointer is the address of a value and t is the type of the value being pointed to.
     */
    private callDestructor(typ: Type, pointer: ssa.Variable | number, b: ssa.Builder, avoidNullCheck: boolean, free: "no" | "free" | "decref" | "unlock") {
        let t = RestrictedType.strip(typ);
        let dtr: backend.Function;
        if (!TypeChecker.isPureValue(typ) && !TypeChecker.isLocalReference(typ)) {
            if (free == "no" && !avoidNullCheck) {
                let cond: ssa.Variable;
                if (t instanceof InterfaceType) {
                    let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
                    cond = b.assign(b.tmp(), "ne", "i8", [realPointer, 0]);
                } else {
                    cond = b.assign(b.tmp(), "ne", "i8", [pointer, 0]);
                }
                b.ifBlock(cond);
            }
            if (t instanceof InterfaceType) {
                if (free == "no") {
                    let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
                    let table = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("table")]);
                    let dtr = this.generateInterfaceDestructor();
                    b.call(null, new ssa.FunctionType(["addr", "addr"], null), [dtr.getIndex(), realPointer, table]);
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
                dtr = this.generateSliceDestructor(t);
                if (free == "no") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), pointer]);
                }
            } else if (t == TypeChecker.t_string) {
                // Do nothing by intention, because strings are not explicitly destructed. They are always reference counted.
            } else {
                throw "Implementation error";
            }
            if (free == "no" && !avoidNullCheck) {
                b.end();
            }    
        }
        if (!avoidNullCheck && t instanceof InterfaceType) {
            let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
            let cond = b.assign(b.tmp(), "ne", "i8", [realPointer, 0]);
            b.ifBlock(cond);
        }
        if (free == "free") {
            if (this.tc.isArray(typ) || this.tc.isString(typ)) {
                b.assign(null, "free_arr", null, [pointer, dtr ? dtr.getIndex() : -1]);
            } else if (t instanceof InterfaceType) {
                let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
                let table = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("table")]);
                let dtrPtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
                b.assign(null, "free", null, [realPointer, dtrPtr]);
            } else {
                b.assign(null, "free", null, [pointer, dtr ? dtr.getIndex() : -1]);
            }
        } else if (free == "unlock") {
            if (this.tc.isArray(typ) || this.tc.isString(typ)) {
                throw "Implementation error"
            } else if (t instanceof InterfaceType) {
                let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
                let table = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("table")]);
                let dtrPtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
                b.assign(null, "unlock", null, [realPointer, dtrPtr]);
            } else {
                b.assign(null, "unlock", null, [pointer, dtr ? dtr.getIndex() : -1]);
            }
        } else if (free == "decref") {
            if (this.tc.isArray(typ) || this.tc.isString(typ)) {
                b.assign(null, "decref_arr", null, [pointer, dtr ? dtr.getIndex() : -1]);
            } else if (t instanceof InterfaceType) {
                let realPointer = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("pointer")]);
                let table = b.assign(b.tmp(), "member", "addr", [pointer, this.ifaceHeader.fieldIndexByName("table")]);
                let dtrPtr = b.assign(b.tmp(), "load", "addr", [table, 0]);
                b.assign(null, "decref", null, [realPointer, dtrPtr]);
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
        if (TypeChecker.isPureValue(t)) {
            return;
        }
        if (t instanceof PointerType && (t.mode == "strong" || t.mode == "unique")) {
            let v = b.assign(b.tmp(), "load", this.getSSAType(type), [pointer.variable, pointer.offset]);
            this.callDestructor(t.elementType, v, b, false, "free");
        } else if (t instanceof PointerType && (t.mode == "reference")) {
            let v = b.assign(b.tmp(), "load", this.getSSAType(type), [pointer.variable, pointer.offset]);
            this.callDestructor(t.elementType, v, b, false, "decref");
        } else if (t == TypeChecker.t_string) {
            let v = b.assign(b.tmp(), "load", this.getSSAType(type), [pointer.variable, pointer.offset]);
            this.callDestructor(t, v, b, false, "decref");
        } else if (t instanceof ArrayType || t instanceof TupleType || t instanceof StructType || t instanceof SliceType) {
            let p = pointer.variable;
            if (pointer.offset) {
                p = b.assign(b.tmp(), "add", "addr", [p, pointer.offset]);
            }
            this.callDestructor(t, p, b, true, "no");
        }
    }

    private callDestructorOnVariable(type: Type, v: ssa.Variable, b: ssa.Builder, avoidNullCheck: boolean = false): void {        
        let t = RestrictedType.strip(type);
        if (TypeChecker.isPureValue(t)) {
            return;
        }
        if (t instanceof PointerType && (t.mode == "strong" || t.mode == "unique")) {
            this.callDestructor(t.elementType, v, b, avoidNullCheck, "free");
        } else if (t instanceof PointerType && (t.mode == "reference")) {
            this.callDestructor(t.elementType, v, b, avoidNullCheck, "decref");
        } else if (t == TypeChecker.t_string) {
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
        }
    }

    private scopeNeedsDestructors(scope: Scope): boolean {
        while(scope) {
            for(let e of scope.elements.values()) {
                // FunctionParameters marked with isConst are not destructed by the function but by their caller
                if ((e instanceof Variable && !e.isResult) || (e instanceof FunctionParameter && !e.isConst)) {
                    if (!TypeChecker.isPureValue(e.type)) {
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

    private functionArgumentIncref(rhs: ssa.Variable | ssa.Pointer | number, rhsNode: Node, rhsData: ssa.Variable | number, targetType: Type, targetIsThis: boolean, scope: Scope, b: ssa.Builder): [ssa.Variable | number, ssa.Variable, "none" | "decref" | "free" | "unlock"] {
        let decrefVar: ssa.Variable;
        let action: "none" | "decref" | "free" | "unlock" = "none"
        if (this.tc.isSafePointer(targetType) && (targetIsThis || TypeChecker.isLocalReference(targetType) || TypeChecker.isReference(targetType))) {
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if ((result[0] != "no" && result[0] != "no_not_null") || (targetIsThis && result[0] == "no")) {
                if (this.tc.isInterface(targetType)) {
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
            if ((TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type)) && this.tc.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    console.log(action)
                    throw "Implementation error";
                }
                action = "free";
                decrefVar = rhsData as ssa.Variable;
            }
            if (TypeChecker.isReference(rhsNode.type) && this.tc.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    console.log(action)
                    throw "Implementation error";
                }
                action = "decref";
                decrefVar = rhsData as ssa.Variable;
            }
        } else if (this.tc.isSlice(targetType) && (TypeChecker.isLocalReference(targetType) || TypeChecker.isReference(targetType))) {
            if (targetIsThis) {
                throw "Implementation error";
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
            if ((TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type)) && this.tc.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    throw "Implementation error";
                }
                action = "free";
            }
            if (TypeChecker.isReference(rhsNode.type) && this.tc.isTakeExpression(rhsNode)) {
                if (action != "none") {
                    console.log(action)
                    throw "Implementation error";
                }
                action = "decref";
            }
            // TODO: Handle Maps here, too
        } else if (this.tc.isString(targetType)) {
            if (targetIsThis) {
                throw "Implementation error";
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
                throw "Implementation error"
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

    private functionArgumentDecref(decrefVar: ssa.Variable, rhsNode: Node, action: "none" | "decref" | "free" | "unlock", b: ssa.Builder): void {
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

    /**
     * Determines whether the expression enode needs an incref before passing it as argument to a function call.
     * References stored in local variables on the stack do not need an incref, if no pointer to said local variables have been passed as arguments already.
     * The reason is that the callee cannot modify the stack variables of the caller.
     * Furthermore, references to objects owned directly via a strong pointer stored on the stack, do not need incref as well.
     * The reason is that local variables of the caller are not modified, hence said object must continue exist, because the local variable holds a strong pointer on it.
     */
    private functionArgumentIncrefIntern(enode: Node, scope: Scope): ["yes" | "no" | "no_not_null", Variable | FunctionParameter] {
        if (TypeChecker.isLocalReference(enode.type)) {
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
                if (this.tc.isUnsafePointer(type)) {
                    return ["no", null];
                }
                if (this.tc.isStruct(type) || this.tc.isTuple(type) || this.tc.isArray(type)) {
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
                    throw "Implementation error";
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

    private processLiteralArgument(f: Function, scope: Scope, rhsNode: Node, targetType: Type, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | number {
        let rhs: ssa.Pointer | ssa.Variable | number;
        if ((this.tc.isArray(rhsNode.type) || this.tc.isStruct(rhsNode.type)) && this.isPureLiteral(targetType, rhsNode)) {
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
        if (this.tc.isSafePointer(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type) || !this.tc.isTakeExpression(rhsNode))) {
            // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
            data = b.assign(b.tmp(), "incref", "addr", [data]);
        } else if (this.tc.isString(targetType) && !this.tc.isTakeExpression(rhsNode)) {
            data = b.assign(b.tmp(), "incref_arr", "addr", [data]);
        }
        // Reference counting for slices
        if (this.tc.isSlice(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type) || !this.tc.isTakeExpression(rhsNode))) {
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
                throw "Implementation error";
            }
            // Fill the RHS with zeros
            this.processFillZeros(rhs, rhsNode.type, b);
        }            

        return data;
    }

    /**
     * This function is used to load a package that implements some built-in functionality
     * like starting a coroutine or decoding a string while iterating over it in a for-loop.
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
            throw new tc.TypeError("Function " + name + " does not exist in package " + pkgPath, loc);
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
    private structs: Map<StructType, ssa.StructType> = new Map<StructType, ssa.StructType>();
    private ifaceDescriptors: Map<string, number> = new Map<string, number>();
    private symbols: Map<string, number> = new Map<string, number>();
}

