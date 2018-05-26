import {Location, Node, NodeOp, AstFlags} from "./ast"
import {Function, TemplateFunction, Type, PackageType, StringLiteralType, MapType, InterfaceType, RestrictedType, OrType, ObjectLiteralType, TupleLiteralType, ArrayLiteralType, StructType, UnsafePointerType, PointerType, FunctionType, ArrayType, SliceType, TypeChecker, TupleType, BasicType, Scope, Variable, FunctionParameter, ScopeElement, TemplateFunctionType} from "./typecheck"
import * as ssa from "./ssa"
import {SystemCalls} from "./pkg"
import {Wasm32Backend} from "./backend_wasm"
import {CBackend} from "./backend_c"
import * as backend from "./backend"
import { tmpdir } from "os";

export class CodeGenerator {
    constructor(tc: TypeChecker, emitIR: boolean, emitNoWasm: boolean, emitFunction: string, disableNullCheck: boolean, emitC: boolean) {
        this.tc = tc;
        this.emitIR = emitIR;
        this.emitNoWasm = emitNoWasm;
        this.emitFunction = emitFunction;
        this.emitC = emitC;
        this.disableNullCheck = disableNullCheck;
        this.imports = new Map<string, backend.FunctionImport>();
        if (emitC) {
            this.backend = new CBackend(emitIR, emitFunction);
        } else {
            this.backend = new Wasm32Backend(emitIR, emitFunction);
        }

        this.localSlicePointer = new ssa.StructType();
        this.localSlicePointer.name = "localSlice";
        this.localSlicePointer.addField("data_ptr", "addr");
        this.localSlicePointer.addField("data_length", "sint");

        this.strongSlicePointer = new ssa.StructType();
        this.strongSlicePointer.name = "strongSlice";
        this.strongSlicePointer.addField("base", this.localSlicePointer);
        this.strongSlicePointer.addField("array_ptr", "addr");

        this.ifaceHeader = new ssa.StructType();
        this.ifaceHeader.name = "iface";
        this.ifaceHeader.addField("typecode", "i32");
        this.ifaceHeader.addField("pointer", "ptr");
        this.ifaceHeader.addField("value", "i64");
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
        this.ifaceHeaderSlice.addField("value", this.strongSlicePointer);
        this.mapHead = new ssa.StructType();
        this.mapHead.name = "mapHead";
        this.mapHead.addField("nextHead", "ptr")
        this.mapHead.addField("size", "i32")
        this.mapHead.addField("free", "i32")
        this.mapHead.addField("freeList", "addr")
        this.copyFunctionType = new ssa.FunctionType(["addr", "addr", "i32"], null, "system");
        this.makeStringFunctionType = new ssa.FunctionType(["addr", "i32"], "ptr", "system");
        this.compareStringFunctionType = new ssa.FunctionType(["ptr", "ptr"], "i32", "system");
        this.concatStringFunctionType = new ssa.FunctionType(["ptr", "ptr"], "ptr", "system");
        this.createMapFunctionType = new ssa.FunctionType(["addr", "i32", "addr"], "ptr", "system");
        this.setMapFunctionType = new ssa.FunctionType(["ptr", "ptr"], "ptr", "system");
        this.lookupMapFunctionType = new ssa.FunctionType(["addr", "addr"], "ptr", "system");
        this.removeMapKeyFunctionType = new ssa.FunctionType(["addr", "addr"], "i32", "system");
        this.hashStringFunctionType = new ssa.FunctionType(["addr"], "i64", "system");
        this.setNumericMapFunctionType = new ssa.FunctionType(["ptr", "i64"], "ptr", "system");
        this.lookupNumericMapFunctionType = new ssa.FunctionType(["addr", "i64"], "ptr", "system");
        this.removeNumericMapKeyFunctionType = new ssa.FunctionType(["addr", "i64"], "i32", "system");
        this.decodeUtf8FunctionType = new ssa.FunctionType(["addr", "i32", "i32"], "i32", "system");
    }

    public processModule(mnode: Node) {
        // Iterate over all files and import all functions, but import each function not more than once
        for(let fnode of mnode.statements) {
            for(let name of fnode.scope.elements.keys()) {
                let e = fnode.scope.elements.get(name);
                if (e instanceof Function && e.isImported) {
                    let name = e.importFromModule + "/" + e.name;
                    if (this.imports.has(name)) {
                        this.funcs.set(e, this.imports.get(name));
                    } else {
                        let wf = this.backend.importFunction(e.name, e.importFromModule, this.getSSAFunctionType(e.type));
                        this.funcs.set(e, wf);
                        this.imports.set(name, wf);
                    }
                }
            }
        }

        // Global variables oredered by their appearance in the code
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
                    name = this.tc.qualifiedTypeName(RestrictedType.strip(t)) + "." + name;
                }
                let wf = this.backend.declareFunction(name);
                this.funcs.set(e, wf);
            } else if (e instanceof TemplateFunction) {
                // Do nothing by intention
            } else if (e instanceof Variable) {
                let g = this.backend.declareGlobalVar(e.name, this.getSSAType(e.type));
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
        t.returnType = this.tc.t_void;
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
                if (this.tc.isConst(v.type)) {
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
        this.backend.defineFunction(b.node, wf, false);

        // Generate IR code for all functions and initialization of global variables
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Function) {
                if (e.isImported) {
                    throw "Implementation error";
                }
                let wf = this.funcs.get(e) as backend.Function;
                let n = this.processFunction(e, wf);
            } else if (e instanceof TemplateFunction) {
                // Do nothing by intention                
            } else if (e instanceof Variable) {
                // Do nothing by intention
            } else {
                throw "CodeGen: Implementation Error " + e
            }
        }

        if (!this.emitNoWasm || this.emitC) {
            // Generate WASM code for the module
            this.backend.generateModule();
        }
    }

    public getCode(): string {
        return this.backend.getCode();
    }

    public getSSAType(t: Type): ssa.Type | ssa.StructType {
        if (t == this.tc.t_bool || t == this.tc.t_uint8 || t == this.tc.t_byte || t == this.tc.t_void) {
            return "i8";
        }
        if (t == this.tc.t_int8) {
            return "s8";
        }
        if (t == this.tc.t_int16) {
            return "s16";
        }
        if (t == this.tc.t_uint16) {
            return "i16";
        }
        if (t == this.tc.t_int32) {
            return "s32";
        }
        if (t == this.tc.t_uint32) {
            return "i32";
        }
        if (t == this.tc.t_int64) {
            return "s64";
        }
        if (t == this.tc.t_uint64) {
            return "i64";
        }
        if (t == this.tc.t_float) {
            return "f32";
        }
        if (t == this.tc.t_double) {
            return "f64";
        }
        if (t == this.tc.t_rune) {
            return "i32";
        }
        if (t instanceof PointerType) {
            return "ptr";
        }
        if (t instanceof UnsafePointerType) {
            return "addr";
        }
        if (t == this.tc.t_string) {
            return "ptr";
        }
        if (t == this.tc.t_null) {
            return "addr";
        }
        if (t instanceof SliceType) {
            if (t.mode == "local_reference") {
                return this.localSlicePointer;
            }
            return this.strongSlicePointer;
        }
        if (t instanceof MapType) {
            return "ptr";
        }
        if (t instanceof StructType) {
            let s = new ssa.StructType();
            s.name = t.name;
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
                return "addr";
            }
            return this.ifaceHeader;
        }
        if (t instanceof RestrictedType) {
            return this.getSSAType(t.elementType);
        }
        throw "CodeGen: Implementation error: The type does not fit in a register " + t.toString();
    }

    private getSSAFunctionType(t: FunctionType): ssa.FunctionType {
        let ftype = new ssa.FunctionType([], null, t.callingConvention);
        if (t.objectType) {
            ftype.params.push("ptr");
        }
        for(let p of t.parameters) {
            ftype.params.push(this.getSSAType(p.type));
        }
        if (t.returnType != this.tc.t_void) {
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
        for(let name of f.scope.elements.keys()) {
            let e = f.scope.elements.get(name);
            if (e instanceof FunctionParameter) {
                let v = b.declareParam(this.getSSAType(e.type), name);
                vars.set(e, v);
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
        } else if (f.type.returnType != this.tc.t_void) {
            let v = b.declareResult(this.getSSAType(f.type.returnType), "$return");
        }

        this.processScopeVariables(b, vars, f.scope);

        for(let node of f.node.statements) {
            this.processStatement(f, f.scope, node, b, vars, null);
        }

        if (!f.type.returnType || f.type.returnType == this.tc.t_void) {
            // Free all variables
            this.freeScopeVariables(null, b, vars, f.scope);
        }

        b.end();

        if (this.emitIR || f.name == this.emitFunction) {
            console.log(ssa.Node.strainToString("", b.node));                
        }

        this.backend.defineFunction(b.node, wf, f.isExported);

        return b.node;
    }

    public processScopeVariables(b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, scope: Scope) {
        // Declare variables
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if (e instanceof Variable) {
                if (e.isResult) {
                    continue;
                } else {
                    // Create a variable that can be assigned multiple times
                    let v = b.declareVar(this.getSSAType(e.type), name);
                    vars.set(e, v);
                }
            }
        }
    }

    public freeScopeVariables(ignoreVariables: Array<Variable | FunctionParameter>, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, scope: Scope) {
        // Declare variables
        for(let name of scope.elements.keys()) {
            let e = scope.elements.get(name);
            if ((e instanceof Variable && !e.isResult) || (e instanceof FunctionParameter && !e.isConst)) {
                if (ignoreVariables && ignoreVariables.indexOf(e) != -1) {
                    continue;
                }
                let v = vars.get(e);
                if (!v) {
                    throw "Implementation error";
                }
                let t = RestrictedType.strip(e.type);
                if (t instanceof PointerType && (t.mode == "strong" || t.mode == "unique")) {
                    this.callDestructor(t.elementType, v, 0, b, false, "free");
                } else if (t instanceof PointerType && (t.mode == "reference")) {
                    this.callDestructor(t.elementType, v, 0, b, false, "decref");
                } else if (t instanceof ArrayType || t instanceof TupleType || t instanceof StructType || t instanceof SliceType) {
                    let obj = b.assign(b.tmp(), "addr_of", "addr", [v]);
                    this.callDestructor(t, obj, 0, b, true, "no");
                }
            }
        }
    }

    public processStatement(f: Function, scope: Scope, snode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, blocks: {body: ssa.Node, outer: ssa.Node} | null) {
        switch(snode.op) {
            case "comment":
                break;
            case "if":
            {
                this.processScopeVariables(b, vars, snode.scope);
                if (snode.lhs) {
                    this.processStatement(f, snode.scope, snode.lhs, b, vars, blocks);
                }
                let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars, this.tc.t_bool);
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
                            if (this.tc.isConst(element.type)) {
                                v.isConstant = true;
                                v.constantValue = (data as ssa.Variable).constantValue;
                            } else {                                
                                b.assign(v, "struct", v.type, (data as ssa.Variable).constantValue as ssa.BinaryData);
                            }
                        } else {
                            let rhs: ssa.Variable | number | ssa.Pointer;
                            if (snode.rhs.op == "take") {
                                // Skip the take
                                rhs = this.processLeftHandExpression(f, scope, snode.rhs.lhs, b, vars);
                            } else {
                                rhs = this.processExpression(f, scope, snode.rhs, b, vars, element.type);
                            }
                            let data: ssa.Variable | number;
                            if (rhs instanceof ssa.Pointer) {
                                data = b.assign(b.tmp(), "load", t, [rhs.variable, rhs.offset]);
                            } else {
                                data = rhs;
                            }
                            if (this.tc.isSafePointer(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !TypeChecker.isTakeExpression(snode.rhs))) {
                                // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                                data = b.assign(b.tmp(), "incref", "addr", [data]);
                            }
                            b.assign(v, "copy", v.type, [data]);
                            if (this.tc.isSlice(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !TypeChecker.isTakeExpression(snode.rhs))) {
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
                    var processAssignment = (node: Node, type: Type, rhsIsTakeExpr: boolean, destinations: Array<ssa.Variable | ssa.Pointer>, destCount: number, source: ssa.Pointer) => {
                        if (node.op == "tuple") {
                            if (!(type instanceof TupleType)) {
                                throw "Implementation error";
                            }
                            let stype = this.getSSAType(type) as ssa.StructType;
                            for(let i = 0; i < node.parameters.length; i++) {
                                let p = node.parameters[i];
                                if (p.op == "tuple" || p.op == "array" || p.op == "object") {
                                    let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    destCount = processAssignment(p, type.types[i], rhsIsTakeExpr, destinations, destCount, new ssa.Pointer(source.variable, source.offset + eoffset));
                                } else {
                                    let elementType = type.types[i];
                                    let etype: ssa.Type | ssa.StructType = stype.fields[i][1];
                                    let eoffset = stype.fieldOffset(stype.fields[i][0]);
                                    let dest = destinations[destCount];
                                    destCount++;
                                    let val = b.assign(b.tmp(), "load", etype, [source.variable, source.offset + eoffset]);
                                    // Reference counting to pointers
                                    if (this.tc.isSafePointer(p.type) && TypeChecker.isReference(p.type) && (TypeChecker.isStrong(elementType) || TypeChecker.isUnique(elementType) || !rhsIsTakeExpr)) {
                                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                                        val = b.assign(b.tmp(), "incref", "addr", [val]);
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
                    let ptr: ssa.Pointer;
                    if (val instanceof ssa.Pointer) {
                        ptr = val;
                    } else {
                        ptr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [val]), 0);
                    }
                    let rhsIsTakeExpr = TypeChecker.isTakeExpression(snode.rhs);
                    processAssignment(snode.lhs, snode.rhs.type, rhsIsTakeExpr, destinations, 0, ptr);
                    if ((snode.rhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.rhs.op == "take") {
                        // Fill the RHS with zeros
                        this.processFillZeros(ptr, snode.rhs.type, b);
                    }                                
                } else if (snode.lhs.op == "[" && this.tc.stripType(snode.lhs.lhs.type) instanceof MapType) {
                    // TODO: Ownership transfer
                    let mtype: MapType = this.tc.stripType(snode.lhs.lhs.type) as MapType;
                    let m = this.processExpression(f, scope, snode.lhs.lhs, b, vars, mtype);
                    let key = this.processExpression(f, scope, snode.lhs.rhs, b, vars, mtype.keyType);
                    let value = this.processExpression(f, scope, snode.rhs, b, vars, mtype.valueType);
                    if (mtype.keyType == this.tc.t_string) {
                        let dest = b.call(b.tmp(), this.setMapFunctionType, [SystemCalls.setMap, m, key]);
                        b.assign(b.mem, "store", this.getSSAType(mtype.valueType), [dest, 0, value]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (mtype.keyType == this.tc.t_int64 || mtype.keyType == this.tc.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(mtype.keyType), [key]);
                        }   
                        let dest = b.call(b.tmp(), this.setNumericMapFunctionType, [SystemCalls.setNumericMap, m, key64]);
                        b.assign(b.mem, "store", this.getSSAType(mtype.valueType), [dest, 0, value]);
                    }
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
                    let data: ssa.Variable | number;
                    if (rhs instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "load", t, [rhs.variable, rhs.offset]);
                    } else {
                        data = rhs;
                    }            
                    // Reference counting for pointers
                    if (this.tc.isSafePointer(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !TypeChecker.isTakeExpression(snode.rhs))) {
                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                        data = b.assign(b.tmp(), "incref", "addr", [data]);
                    }
                    // If the left-hand expression returns an address, the resulting value must be stored in memory
                    if (dest instanceof ssa.Pointer) {
                        b.assign(b.mem, "store", this.getSSAType(snode.lhs.type), [dest.variable, dest.offset, data]);
                    } else {
                        b.assign(dest, "copy", this.getSSAType(snode.lhs.type), [data]);
                    }
                    // Reference counting for slices
                    if (this.tc.isSlice(snode.lhs.type) && TypeChecker.isReference(snode.lhs.type) && (TypeChecker.isStrong(snode.rhs.type) || TypeChecker.isUnique(snode.rhs.type) || !TypeChecker.isTakeExpression(snode.rhs))) {
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
                if (snode.lhs.type == this.tc.t_string) {
                    b.call(dest, this.concatStringFunctionType, [SystemCalls.concatString, p1, p2]);
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
                                let base = b.assign(b.tmp(), "member", this.localSlicePointer, [sliceHeader, this.strongSlicePointer.fieldIndexByName("base")]);
                                ptr = b.assign(b.tmp(), "member", "addr", [base, this.localSlicePointer.fieldIndexByName("data_ptr")]);    
                            } else {
                                ptr = b.assign(b.tmp(), "member", "addr", [sliceHeader, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            }
                            if (t.mode != "local_reference") {
                                let base = b.assign(b.tmp(), "member", this.localSlicePointer, [sliceHeader, this.strongSlicePointer.fieldIndexByName("base")]);
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
                    } else {
                        throw "TODO string and map"
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
                            let tmp = this.processExpression(f, snode.scope, snode.condition.condition, b, vars, this.tc.t_bool);
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
                        } else if (t == this.tc.t_string) {
                            // Get address of value
                            let valAddr: ssa.Variable;
                            if (val instanceof ssa.Variable) {
                                valAddr = b.assign(b.tmp(), "addr_of", "addr", [val]);
                            } else {
                                let tmp = b.declareVar("sint", "$dummyVar");
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
                            b.call(state, this.decodeUtf8FunctionType, [SystemCalls.decodeUtf8, valAddr, ch, state]);
                            // Not a complete or illegal unicode char?
                            b.ifBlock(state);
                            // If illegal or end of string -> return 0xfffd      
                            let illegal = b.assign(b.tmp(), "eq", "sint", [state, 1]);
                            endcond = b.assign(b.tmp(), "eq", "sint", [counter, len]);
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
                        let tmp = this.processExpression(f, snode.scope, snode.condition, b, vars, this.tc.t_bool);
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
                    } else if (t == this.tc.t_string) {
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
                        // If the ~ptr parameter does not "own" a reference count, then incref is necessary upon returing the reference
                        if (e instanceof FunctionParameter && e.isConst) {
                            forceIncref = true;
                        }
                    }
                    if (!doNotZero && ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.lhs.op == "take")) {
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
                    if (this.tc.isSafePointer(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(snode.lhs.type) || TypeChecker.isUnique(snode.lhs.type) || !TypeChecker.isTakeExpression(snode.lhs) || forceIncref)) {
                        // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
                        data = b.assign(b.tmp(), "incref", "addr", [data]);
                    }
                    // Reference counting for slices
                    if (this.tc.isSlice(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(snode.lhs.type) || TypeChecker.isUnique(snode.lhs.type) || !TypeChecker.isTakeExpression(snode.rhs))) {
                        let st = this.getSSAType(snode.lhs.type) as ssa.StructType;
                        let arrayPointer: ssa.Variable;
                        if (rhs instanceof ssa.Pointer) {
                            arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
                        } else {
                            arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
                        }
                        b.assign(null, "incref_arr", "addr", [arrayPointer]);
                    }
                    if (!doNotZero && ((snode.lhs.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment || snode.lhs.op == "take")) {
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
                    this.callDestructor(snode.type, src.variable, src.offset, b, true, "no");
                    if (t instanceof ssa.StructType) {
                        let tmp = b.assign(b.tmp(), "struct", t, this.generateZeroStruct(t));
                        b.assign(b.mem, "store", t, [src.variable, src.offset, tmp]);                        
                    } else {
                        b.assign(b.mem, "store", t, [src.variable, src.offset, 0]);                            
                    }
                    break;
                }
                let pointer = b.assign(b.tmp(), "addr_of", "addr", [src]);
                this.callDestructor(snode.type, pointer, 0, b, true, "no");
                if (t instanceof ssa.StructType) {
                    b.assign(src, "struct", t, this.generateZeroStruct(t));
                } else {
                    b.assign(src, "copy", t, [0]);                            
                }
                break;
            }
            default:
                this.processExpression(f, scope, snode, b, vars, snode.type);
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
                    let check = b.assign(b.tmp("i32"), "eqz", "addr", [tmp]);
                    b.ifBlock(check);
                    b.assign(null, "trap", null, []);
                    b.end();
                }
                return new ssa.Pointer(tmp as ssa.Variable, 0);
            }
            case "[":
            {
                let ltype = this.tc.stripType(enode.lhs.type);
                // Note: This code implements the non-left-hand cases as well to avoid duplicating code
                if (ltype instanceof UnsafePointerType) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype);
                    let index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
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
                        let tmp1 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.strongSlicePointer.fieldIndexByName("base")]);
                        data_ptr = b.assign(b.tmp(), "member", "addr", [tmp1, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                        let tmp2 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.strongSlicePointer.fieldIndexByName("base")]);
                        len = b.assign(b.tmp(), "member", "sint", [tmp2, this.localSlicePointer.fieldIndexByName("data_length")]);
                    }
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
                    let indexVar: ssa.Variable;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    }
                    if (typeof(index) == "number") {
                        indexVar = b.assign(b.tmp(), "const", "sint", [index]);
                    } else {
                        indexVar = index;
                    }
                    // Compare 'index' with 'len'
                    let cmp = b.assign(b.tmp(), "ge_u", "i8", [indexVar, len]);
                    b.ifBlock(cmp);
                    b.assign(null, "trap", null, []);
                    b.end();
                    if (size != 1) {
                        if (typeof(index) == "number") {
                            index *= size;
                        } else {
                            index = b.assign(b.tmp(), "mul", "sint", [indexVar, size]);
                        }
                    }
                    if (typeof(index) == "number") {
                        return new ssa.Pointer(data_ptr, index);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "ptr", [data_ptr, indexVar]), 0);
                } else if (ltype == this.tc.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, ltype);
                    let t = this.getSSAType(ltype);
                    let index: ssa.Variable | number = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    } else {
                        index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
                    }
                    let len = b.assign(b.tmp(), "load", "int", [ptr, -2 * ssa.sizeOf("sint")]);
                    // Compare 'index' with 'len'
                    let trap = b.assign(b.tmp(), "ge_u", "int", [index, len]);
                    // let zero = b.assign(b.tmp(), "eqz", "addr", [ptr]);
                    // let trap = b.assign(b.tmp(), "or", "i32", [cmp, zero]);
                    b.ifBlock(trap);
                    b.assign(null, "trap", null, []);
                    b.end();
                    if (typeof(index) == "number") {
                        if (typeof(ptr) == "number") {
                            return new ssa.Pointer(b.assign(b.tmp(), "const", "addr", [ptr + index]), 0);
                        }
                        return new ssa.Pointer(ptr, index);
                    }
                    return new ssa.Pointer(b.assign(b.tmp(), "add", "addr", [ptr, index]), 0);
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
                        index = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
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
                        let check = b.assign(b.tmp("i8"), "eqz", "addr", [ptr]);
                        b.ifBlock(check);
                        b.assign(null, "trap", null, []);
                        b.end();
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
        if (n.type == this.tc.t_bool) {
            buf.push(n.value == "true" ? 1 : 0);
        } else if (n.type == this.tc.t_uint8) {
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_uint16) {
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_uint32 || n.type == this.tc.t_rune) {
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_uint64) {
            // TODO large numbers
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_int8) {
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_int16) {
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_int32) {
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_int64) {
            // TODO large numbers
            buf.push(parseInt(n.value));
        } else if (n.type == this.tc.t_float) {
            buf.push(parseFloat(n.value));
        } else if (n.type == this.tc.t_double) {
            buf.push(parseFloat(n.value));
        } else if (n.type == this.tc.t_string) {
            buf.push(n.value);
        } else if (this.tc.isSafePointer(n.type) || this.tc.isUnsafePointer(n.type)) {
            if (n.op != "null" && (n.op != "int" || n.numValue != 0)) {
                throw "Implementation error"
            }
            buf.push(0);
        } else if (this.tc.isArray(n.type)) {
            if (n.parameters) {
                for(let p of n.parameters) {
                    this.processPureLiteralInternal(p, buf);
                }
            }
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
        if (n.type == this.tc.t_bool) {
            buf.appendUint8(n.value == "true" ? 1 : 0);
        } else if (n.type == this.tc.t_uint8) {
            buf.appendUint8(parseInt(n.value));
        } else if (n.type == this.tc.t_uint16) {
            buf.appendUint16(parseInt(n.value));
        } else if (n.type == this.tc.t_uint32 || n.type == this.tc.t_rune) {
            buf.appendUint32(parseInt(n.value));
        } else if (n.type == this.tc.t_uint64) {
            // TODO large numbers
            buf.appendUint64(parseInt(n.value));
        } else if (n.type == this.tc.t_int8) {
            buf.appendInt8(parseInt(n.value));
        } else if (n.type == this.tc.t_int16) {
            buf.appendInt16(parseInt(n.value));
        } else if (n.type == this.tc.t_int32) {
            buf.appendInt32(parseInt(n.value));
        } else if (n.type == this.tc.t_int64) {
            // TODO large numbers
            buf.appendInt64(parseInt(n.value));
        } else if (n.type == this.tc.t_float) {
            buf.appendFloat32(parseFloat(n.value));
        } else if (n.type == this.tc.t_double) {
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

    private createInterfaceTable(scope: Scope, s: StructType): number {
        let methods = new Map<string, number>();
        let t = new PointerType(s, "strong");
        let offset = this.interfaceTableLength;
        let minOffset = 0xffffff;
        let maxOffset = -1;
        for(let iface of this.tc.ifaces) {
            if (this.tc.checkIsAssignableType(iface, t, null, "assign", false)) {
                for(let m of iface.getAllMethods().values()) {
                    if (methods.has(m.name)) {
                        continue;
                    }
                    let index: number = -1;
                    if (this.interfaceTableIndex.has(m.name)) {
                        index = this.interfaceTableIndex.get(m.name);
                    } else {
                        index = this.interfaceTableNames.length;
                        this.interfaceTableNames.push(m.name);
                        this.interfaceTableIndex.set(m.name, index);
                    }
                    methods.set(m.name, index);
                    minOffset = Math.min(minOffset, index);
                    maxOffset = Math.max(maxOffset, index);
                }
            }
        }
        if (methods.size != 0) {
            let tableStart = offset - minOffset;
            for(let m of methods.keys()) {
                let index = methods.get(m);
                let method = s.method(m);
                let methodObjType = RestrictedType.strip(method.objectType);
                let methodName = methodObjType.name + "." + m;
                let f = scope.resolveElement(methodName);
                if (!(f instanceof Function)) {
                    throw "Implementation error";
                }
                let wf = this.funcs.get(f);
                if (wf.isImported()) {
                    throw "Implementation error";
                }
                this.backend.addFunctionToTable(wf, tableStart + index);
            }
            this.interfaceTableLength = Math.max(this.interfaceTableLength, maxOffset - minOffset + 1);
            return tableStart;
        }
        return 0;
    }                

    public processExpression(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>, targetType: Type): ssa.Variable | number {
        let v = this.processExpressionIntern(f, scope, enode, b, vars);
        // Convert a normal slice to a local-reference slice
        if (this.tc.isSlice(enode.type) && !TypeChecker.isLocalReference(enode.type) && this.tc.isSlice(targetType) && TypeChecker.isLocalReference(targetType)) {
            v = b.assign(b.tmp(), "member", this.localSlicePointer, [v, 0]);
        }
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
            } else if (enode.type == this.tc.t_int64 || enode.type == this.tc.t_uint64) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == this.tc.t_float) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderFloat, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == this.tc.t_double) {
                return b.assign(b.tmp(), "struct", this.ifaceHeaderDouble, [this.typecode(enode.type), 0, v]);
            } else if (this.tc.isNumber(enode.type) || enode.type == this.tc.t_bool) {
                return b.assign(b.tmp(), "struct", this.ifaceHeader32, [this.typecode(enode.type), 0, v]);
            } else if (enode.type == this.tc.t_null) {
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
        return v;
    }

    private processUnboxInterface(targetType: Type, v: number | ssa.Variable, b: ssa.Builder): ssa.Variable | number {        
        let addr = b.assign(b.tmp("addr"), "addr_of", "addr", [v]);
        if (this.tc.isUnsafePointer(targetType)) {
            return b.assign(b.tmp(), "load", "addr", [addr, this.ifaceHeader32.fieldOffset("value")]);
        } else if (this.tc.isSafePointer(targetType) || this.tc.isString(targetType)) {
            return b.assign(b.tmp(), "load", "ptr", [addr, this.ifaceHeader.fieldOffset("pointer")]);
        } else if (this.tc.isSlice(targetType)) {
            return b.assign(b.tmp(), "load", this.strongSlicePointer, [addr, this.ifaceHeaderSlice.fieldOffset("value")]);
        } else if (this.tc.isArray(targetType)) {
            // TODO: Copy to allocated area
            throw "TODO";
        } else if (this.tc.isStruct(targetType)) {
            throw "TODO";
        } else if (targetType == this.tc.t_int64 || targetType == this.tc.t_uint64) {
            return b.assign(b.tmp(), "load", "i64", [addr, this.ifaceHeader.fieldOffset("value")]);
        } else if (targetType == this.tc.t_double) {
            return b.assign(b.tmp(), "load", "f64", [addr, this.ifaceHeaderDouble.fieldOffset("value")]);
        } else if (targetType == this.tc.t_float) {
            return b.assign(b.tmp(), "load", "f32", [addr, this.ifaceHeaderFloat.fieldOffset("value")]);
        } else if (this.tc.isNumber(targetType) || targetType == this.tc.t_bool) {
            return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("value")]);
        } else if (this.tc.isOrType(targetType)) {
            return b.assign(b.tmp(), "load", "i32", [addr, this.ifaceHeader32.fieldOffset("typecode")]);
        } else {
            throw "Implementation error";
        }                
    }

    private processExpressionIntern(f: Function, scope: Scope, enode: Node, b: ssa.Builder, vars: Map<ScopeElement, ssa.Variable>): ssa.Variable | number {
        switch(enode.op) {
            case "null":
                return 0;
            case "int":
                return parseInt(enode.value);
            case "float":
                return parseFloat(enode.value);
            case "rune":
                return enode.numValue;
            case "bool":
                return enode.value == "true" ? 1 : 0;
            case "str":
            {
                let v = new ssa.Variable();
                v.isConstant = true;
                v.constantValue = enode.value;
                v.type = "addr";
                return v;
                // return this.backend.addString(enode.value);
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
                                if (t.keyType != this.tc.t_string) {
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
                    let ptr = b.assign(b.tmp(), "alloc_arr", "addr", [enode.parameters.length, esize]);
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let v = this.processLiteralArgument(f, scope, enode.parameters[i], t.getElementType(), b, vars);
                        b.assign(b.mem, "store", et, [ptr, i * esize, v]);
                    }
                    return b.assign(b.tmp(), "struct", this.strongSlicePointer, [ptr, enode.parameters.length, ptr]);
                } else if (t instanceof ArrayType) {
                    let st = this.getSSAType(t); // This returns a struct type
                    let args: Array<string | ssa.Variable | number> = [];
                    for(let i = 0; i < enode.parameters.length; i++) {
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
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
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
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
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
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
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
                if (t == this.tc.t_float || t == this.tc.t_double || t == this.tc.t_string) {
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
                if (t == this.tc.t_string) {
                    let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let p2 = this.processExpression(f, scope, enode.rhs, b, vars, t);
                    return b.call(b.tmp(), this.concatStringFunctionType, [SystemCalls.concatString, p1, p2]);
                }
                let p1 = this.processExpression(f, scope, enode.lhs, b, vars, t);
                let p2: ssa.Variable | number;
                if (t instanceof UnsafePointerType) {
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
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
                    p2 = this.processExpression(f, scope, enode.rhs, b, vars, this.tc.t_int);
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
                if (t == this.tc.t_float || t == this.tc.t_double) {
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
                if (striplhs == this.tc.builtin_len) {
                    let objType = RestrictedType.strip(enode.lhs.lhs.type);
                    if (objType == this.tc.t_string) {
                        let s = this.processExpression(f, scope, enode.lhs.lhs, b, vars, this.tc.t_string);
                        return b.assign(b.tmp(), "load", "sint", [s, -ssa.sizeOf("sint")]);
                    } else if (objType instanceof SliceType) {
                        // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                        let head_addr: ssa.Variable | ssa.Pointer;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                        }
                        if (head_addr instanceof ssa.Variable) {
                           return b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                        }
                        return b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                    } else if (objType instanceof ArrayType) {
                        return objType.size;
                    }
                    throw "Implementation error";
                } else if (striplhs == this.tc.builtin_cap) {
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (objType instanceof SliceType) {
                        // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                        let head_addr: ssa.Variable | ssa.Pointer;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                        }
                        if (objType.mode == "local_reference") {
                            if (head_addr instanceof ssa.Variable) {
                                return b.assign(b.tmp(), "member", "sint", [head_addr, this.localSlicePointer.fieldIndexByName("data_length")]);
                            } else {
                                return b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                            }
                        }
                        let dataSize: ssa.Variable;
                        let arrayPointer: ssa.Variable;
                        let dataPointer: ssa.Variable;
                        if (head_addr instanceof ssa.Variable) {
                            let tmp1 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.strongSlicePointer.fieldIndexByName("base")]);
                            dataSize = b.assign(b.tmp(), "member", "sint", [tmp1, this.localSlicePointer.fieldIndexByName("data_length")]);
                            let tmp2 = b.assign(b.tmp(), "member", this.localSlicePointer, [head_addr, this.strongSlicePointer.fieldIndexByName("base")]);
                            dataPointer = b.assign(b.tmp(), "member", "addr", [tmp2, this.localSlicePointer.fieldIndexByName("data_ptr")]);
                            arrayPointer = b.assign(b.tmp(), "member", "addr", [head_addr, this.strongSlicePointer.fieldIndexByName("array_ptr")]);
                        } else {
                            dataSize = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                            dataPointer = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                            arrayPointer = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.strongSlicePointer.fieldOffset("array_ptr")]);
                        }
                        let size = ssa.alignedSizeOf(this.getSSAType(objType.getElementType()));
                        if (size != 1) {
                            dataSize = b.assign(b.tmp(), "mul", "sint", [dataSize, size]);
                        }
                        let endPointer = b.assign(b.tmp(), "add", "addr", [arrayPointer, dataSize]);
                        let diff = b.assign(b.tmp(), "sub", "sint", [endPointer, dataPointer]);
                        if (size != 1) {
                            diff = b.assign(b.tmp(), "div", "sint", [diff, size]);
                        }
                        return diff;
                    }
                    throw "Implementation error";
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "clone") {
                    // A volatile slice can be converted to a non-volatile slice by copying it.
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof SliceType)) {
                        throw "Implementation error";
                    }
                    let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                    let size = ssa.alignedSizeOf(elementType);
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [head_addr]), 0);
                    }
                    let data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_ptr")]);
                    let len = b.assign(b.tmp(), "load", "sint", [head_addr.variable, head_addr.offset + this.localSlicePointer.fieldOffset("data_length")]);
                    let mem = b.assign(b.tmp(), "alloc_arr", "addr", [len, size]);
                    b.call(null, this.copyFunctionType, [SystemCalls.copy, mem, data_ptr, len]);
                    return b.assign(b.tmp(), "struct", this.strongSlicePointer, [mem, len, len]);
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "append") {
                    /*
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof SliceType)) {
                        throw "Implementation error";
                    }
                    let elementType = this.getSSAType(RestrictedType.strip(objType.getElementType()));
                    let size = ssa.alignedSizeOf(elementType);
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [head_addr]), 0);
                    }
                    let data_ptr = b.assign(b.tmp(), "load", "addr", [head_addr.variable, head_addr.offset + this.strongSliceHeader.fieldOffset("data_ptr")]);
                    let len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                    let cap = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                    if (enode.parameters.length == 1 && enode.parameters[0].op == "unary...") {
                        if (this.isLeftHandSide(enode.parameters[0].rhs)) {
                            head_addr = this.processLeftHandExpression(f, scope, enode.parameters[0].rhs, b, vars);
                        } else {
                            head_addr = this.processExpression(f, scope, enode.parameters[0].rhs, b, vars, striplhs.lastParameter().type) as ssa.Variable;
                        }
                        if (head_addr instanceof ssa.Variable) {
                            head_addr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [head_addr]), 0);
                        }
                        let b_data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                        let b_len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                        let b_cap = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                        let ft = new ssa.FunctionType(["ptr", "i32", "i32", "ptr", "i32", "i32", "i32"], this.sliceHeader, "system");
                        ft.ellipsisParam = elementType
                        return b.call(b.tmp(), ft, [SystemCalls.appendSlice, data_ptr, len, cap, b_data_ptr, b_len, b_cap, size]);
                    } else {                        
                        let add = enode.parameters.length;
                        let new_len = b.assign(b.tmp(), "add", "i32", [len, add]);
                        let cond = b.assign(b.tmp(), "gt_u", "i32", [new_len, cap]);
                        b.ifBlock(cond);
                        let ft = new ssa.FunctionType(["ptr", "i32", "i32", "i32", "i32"], this.sliceHeader, "system");
                        ft.ellipsisParam = elementType
                        let newslice = b.call(b.tmp(), ft, [SystemCalls.growSlice, data_ptr, len, cap, add, size]);
                        let newslice_addr = b.assign(b.tmp(), "addr_of", "ptr", [newslice]);
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [newslice_addr, this.sliceHeader.fieldOffset("data_ptr")]);
                        cap = b.assign(b.tmp(), "load", "i32", [newslice_addr, this.sliceHeader.fieldOffset("cap")]);
                        b.end();
                        let offset = b.assign(b.tmp(), "mul", "i32", [size, len]);
                        let new_data_ptr = b.assign(b.tmp("addr"), "add", "i32", [data_ptr, offset]);
                        for(let i = 0; i < add; i++) {
                            let p = this.processExpression(f, scope, enode.parameters[i], b, vars, objType.getElementType());
                            b.assign(b.mem, "store", elementType, [new_data_ptr, i * size, p]);
                        }
                        return b.assign(b.tmp(), "struct", this.sliceHeader, [data_ptr, new_len, cap]);
                    }
                    */
                   throw "TODO";
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system" && striplhs.name == "remove") {
                    /*
                    let objType = this.tc.stripType(enode.lhs.lhs.type);
                    if (!(objType instanceof MapType)) {
                        throw "Implementation error";
                    }
                    let m = this.processExpression(f, scope, enode.lhs.lhs, b, vars, objType);
                    let key = this.processExpression(f, scope, enode.parameters[0], b, vars, objType.keyType);
                    if (objType.keyType == this.tc.t_string) {
                        return b.call(b.tmp(), this.removeMapKeyFunctionType, [SystemCalls.removeMapKey, m, key]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (objType.keyType == this.tc.t_int64 || objType.keyType == this.tc.t_uint64) {
                            key64 = key;
                        } else {
                            key64 = b.assign(b.tmp(), "extend", this.getSSAType(objType.keyType), [key]);
                        }   
                        return b.call(b.tmp(), this.removeNumericMapKeyFunctionType, [SystemCalls.removeNumericMapKey, m, key64]);
                    } */
                    throw "TODO";
                } else if (striplhs instanceof FunctionType && striplhs.callingConvention == "system") {
                    t = striplhs;
                } else if (enode.lhs.op == "id") {
                    // Calling a named function
                    let e = scope.resolveElement(enode.lhs.value);
                    if (e instanceof TemplateFunction) {
                        if (!(enode.lhs.type instanceof TemplateFunctionType)) {
                            throw "Implementation error";
                        }
                        let name = enode.lhs.value + "<";
                        for(let g of enode.lhs.type.templateParameterTypes) {
                            name += g.toString() + ",";
                        }
                        name += ">";
                        e = scope.resolveElement(name);
                    }
                    if (!(e instanceof Function)) {
                        throw "Implementation error";
                    }    
                    f = e;
                    t = f.type;
                } else if (enode.lhs.op == "genericInstance") {
                    let name = enode.lhs.lhs.value + "<";
                    for(let g of enode.lhs.genericParameters) {
                        name += g.type.toString() + ",";
                    }
                    name += ">";
                    let e = scope.resolveElement(name);
                    if (!(e instanceof Function)) {
                        throw "Implementation error";
                    }
                    f = e;
                    t = f.type;                
                } else if (enode.lhs.op == ".") {
                    // Calling a method
                    let ltype = this.tc.stripType(enode.lhs.lhs.type);
                    let objType: Type;
                    if (ltype instanceof PointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        objPtr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                        if (!this.disableNullCheck && !this.isThis(objPtr)) {
                            let check = b.assign(b.tmp("i32"), "eqz", "addr", [objPtr]);
                            b.ifBlock(check);
                            b.assign(null, "trap", null, []);
                            b.end();
                        }        
                    } else if (ltype instanceof UnsafePointerType) {
                        objType = RestrictedType.strip(ltype.elementType);
                        objPtr = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                    } else if (ltype instanceof StructType) {
                        objType = ltype;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            objPtr = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                            if (objPtr instanceof ssa.Variable) {
                                objPtr = b.assign(b.tmp(), "addr_of", "addr", [objPtr]);
                            }
                        } else {
                            let value = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                            objPtr = b.assign(b.tmp(), "addr_of", "addr", [value]);
                        }
                    } else if (ltype instanceof InterfaceType) {
                        objType = ltype;
                        let ifacePtr: ssa.Pointer;
                        if (this.isLeftHandSide(enode.lhs.lhs)) {
                            let p = this.processLeftHandExpression(f, scope, enode.lhs.lhs, b, vars);
                            if (p instanceof ssa.Variable) {
                                ifacePtr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [p]), 0);
                            } else {
                                ifacePtr = p;
                            }
                        } else {
                            let value = this.processExpression(f, scope, enode.lhs.lhs, b, vars, ltype);
                            ifacePtr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [value]), 0);
                        }                        
                        objPtr = b.assign(b.tmp(), "load", "addr", [ifacePtr.variable, ifacePtr.offset + this.ifaceHeader.fieldOffset("pointer")]);
                        findex = b.assign(b.tmp(), "load", "s32", [ifacePtr.variable, ifacePtr.offset + this.ifaceHeader.fieldOffset("value")]);
                    } else {
                        throw "Implementation error"
                    }
                    if (objType instanceof StructType) {
                        let method = objType.method(enode.lhs.name.value);
                        let methodObjType = RestrictedType.strip(method.objectType);
                        methodObjType = RestrictedType.strip(method.objectType);
                        if (methodObjType instanceof PointerType) {
                            methodObjType = RestrictedType.strip(methodObjType.elementType);
                        }    
                        let methodName = this.tc.qualifiedTypeName(methodObjType) + "." + enode.lhs.name.value;
                        let e = scope.resolveElement(methodName);
                        if (!(e instanceof Function)) {
                            throw "Implementation error";
                        }
                        f = e;
                        t = f.type;
                    } else if (objType instanceof InterfaceType) {
                        let name = enode.lhs.name.value;
                        let method = objType.method(name);
                        t = method;
                        let findex2 = this.interfaceTableIndex.get(name);
                        if (findex2 != 0) {
                            findex = b.assign(b.tmp(), "add", "s32", [findex, findex2]);
                        }
                    } else {
                        throw "Implementation error";
                    }
                } else {
                    // Calling a lamdba function
                    t = enode.lhs.type as FunctionType;
                }
                
                let decrefArgs: Array<[Node, ssa.Variable, Type]> = [];
                if (f) {
                    args.push(this.funcs.get(f).getIndex());
                } else if (findex) {
                    args.push(findex);
                } else if (t.callingConvention == "system") {
                    args.push(t.systemCallType);
                }
                if (objPtr !== null) {
                    // Add 'this' to the arguments
                    let data: ssa.Variable | number;
                    if (objPtr instanceof ssa.Pointer) {
                        data = b.assign(b.tmp(), "add", "addr", [objPtr.variable, objPtr.offset]);
                    } else {
                        data = objPtr;
                    }
                    let targetType = this.tc.stripType(enode.lhs.lhs.type);
                    let dataAndRef = this.functionArgumentIncref(objPtr, enode.lhs.lhs, data, targetType, scope, b);
                    args.push(dataAndRef[0]);
                    if (dataAndRef[1]) {
                        decrefArgs.push([enode.lhs.lhs, dataAndRef[1], targetType]);
                    }                
                }                
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
                        let dataAndRef = this.functionArgumentIncref(rhs, vnode, data, targetType, scope, b);
                        args.push(dataAndRef[0]);
                        if (dataAndRef[1]) {
                            decrefArgs.push([vnode, dataAndRef[1], targetType]);
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
                } else if (t.callingConvention == "system") {
                    let ft = this.getSSAFunctionType(t);
                    result = b.call(b.tmp(), ft, args);
                } else {
                    throw "TODO: call a lambda function"
                }

                for(let decrefArg of decrefArgs) {
                    this.functionArgumentDecref(decrefArg[1], decrefArg[0], decrefArg[2], scope, b);
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
                        index1 = this.processExpression(f, scope, enode.parameters[0], b, vars, this.tc.t_int);
                    }
                }
                let index2: ssa.Variable | number = 0;
                if (enode.parameters[1]) {
                    if (enode.parameters[1].op == "int") {
                        index2 = parseInt(enode.parameters[1].value);
                    } else {
                        index2 = this.processExpression(f, scope, enode.parameters[1], b, vars, this.tc.t_int);
                    }
                }
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof UnsafePointerType) {
                    let size = ssa.sizeOf(this.getSSAType(t.elementType));
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
                    throw "TODO";
                    /*
                    let size = ssa.sizeOf(this.getSSAType(t.getElementType()));
                    // Get the address of the SliceHead. Either compute it from a left-hand-side expression or put it on the stack first
                    let head_addr: ssa.Variable | ssa.Pointer;
                    if (this.isLeftHandSide(enode.lhs)) {
                        head_addr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    } else {
                        head_addr = this.processExpression(f, scope, enode.lhs, b, vars, t) as ssa.Variable;
                    }
                    if (head_addr instanceof ssa.Variable) {
                        head_addr = b.assign(b.tmp(), "addr_of", "ptr", [head_addr]);
                    }
                    let data_ptr: ssa.Variable;
                    let len: ssa.Variable;
                    let cap: ssa.Variable;
                    if (head_addr instanceof ssa.Pointer) {
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("length")]);
                        cap = b.assign(b.tmp(), "load", "i32", [head_addr.variable, head_addr.offset + this.sliceHeader.fieldOffset("cap")]);
                    } else {
                        data_ptr = b.assign(b.tmp(), "load", "ptr", [head_addr, this.sliceHeader.fieldOffset("data_ptr")]);
                        len = b.assign(b.tmp(), "load", "i32", [head_addr, this.sliceHeader.fieldOffset("length")]);
                        cap = b.assign(b.tmp(), "load", "i32", [head_addr, this.sliceHeader.fieldOffset("cap")]);
                    }
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i32", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;  
                    } else {
                        l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    }
                    let c = b.assign(b.tmp(), "sub", "i32", [len, index1]);
                    if (index1 != 0) {
                        if (size != 1) {
                            if (typeof(index1) == "number") {
                                data_ptr = b.assign(b.tmp("ptr"), "add", "i32", [data_ptr, index1 * size]);
                            } else {
                                let tmp = b.assign(b.tmp(), "mul", "i32", [index1, size]);
                                data_ptr = b.assign(b.tmp("ptr"), "add", "i32", [data_ptr, tmp]);
                            }
                        } else {
                            data_ptr = b.assign(b.tmp("ptr"), "add", "i32", [data_ptr, index1]);
                        }
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [data_ptr, l, c]);
                    */
                } else if (t == this.tc.t_string) {
                    let ptr = this.processExpression(f, scope, enode.lhs, b, vars, this.tc.t_string);
                    let len = b.assign(b.tmp(), "load", "int", [ptr, -4]);
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "int", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "int", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "sint", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    let ptr3 = b.assign(b.tmp(), "add", "addr", [ptr, index1]);
                    let l = b.assign(b.tmp(), "sub", "sint", [index2, index1]);
                    return b.call(b.tmp(), this.makeStringFunctionType, [SystemCalls.makeString, ptr3, l]);
                } else if (t instanceof ArrayType) {
                    /*
                    let ptr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                    let len = t.size;
                    if (enode.parameters[0] && index1 !== 0) {
                        // Compare 'index1' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index1, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    if (enode.parameters[1]) {
                        // Compare 'index2' with 'len'
                        let trap = b.assign(b.tmp(), "gt_u", "i32", [index2, len]);
                        b.ifBlock(trap);
                        b.assign(null, "trap", null, []);
                        b.end();
                    } else {
                        index2 = len;
                    }
                    if (index1 instanceof ssa.Variable || index2 instanceof ssa.Variable) {
                        let cmp = b.assign(b.tmp(), "gt_s", "i32", [index1, index2]);
                        b.ifBlock(cmp);
                        b.assign(null, "trap", null, []);
                        b.end();                        
                    }
                    let ptr2: ssa.Pointer;
                    if (ptr instanceof ssa.Variable) {
                        ptr2 = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "ptr", [ptr]), 0);
                    } else {
                        ptr2 = ptr;
                    }
                    let ptr3: ssa.Variable;
                    if (typeof(index1) == "number") {
                        if (index1 != 0 || ptr2.offset != 0) {
                            ptr3 = b.assign(b.tmp("ptr"), "add", "i32", [ptr2.variable, ptr2.offset + index1]);
                        } else {
                            ptr3 = ptr2.variable;
                        }
                    } else {
                        let tmp = ptr2.variable;
                        if (ptr2.offset != 0 ) {
                            tmp = b.assign(b.tmp("ptr"), "add", "i32", [ptr2.variable, ptr2.offset]);
                        }
                        ptr3 = b.assign(b.tmp("ptr"), "add", "i32", [tmp, index1]);
                    }
                    let l: ssa.Variable | number;
                    if (typeof(index1) == "number" && typeof(index2) == "number") {
                        l = index2 - index1;  
                    } else {
                        l = b.assign(b.tmp(), "sub", "i32", [index2, index1]);
                    }
                    let cap: ssa.Variable | number;
                    if (typeof(index1) == "number") {
                        cap = len - index1;
                    } else {
                        cap = b.assign(b.tmp(), "sub", "i32", [len, index1]);
                    }
                    return b.assign(b.tmp(), "struct", this.sliceHeader, [ptr3, l, cap]);
                    */
                   throw "TODO";
                } else {
                    throw "Implementation error";
                }                
            }
            case "[":
            {
                let t = this.tc.stripType(enode.lhs.type);
                if (t instanceof MapType) {                    
                    let m = this.processExpression(f, scope, enode.lhs, b, vars, t);
                    let key = this.processExpression(f, scope, enode.rhs, b, vars, t.keyType);
                    let result: ssa.Variable;
                    if (t.keyType == this.tc.t_string) {
                        result = b.call(b.tmp(), this.lookupMapFunctionType, [SystemCalls.lookupMap, m, key]);
                    } else {
                        let key64: ssa.Variable | number;
                        if (t.keyType == this.tc.t_int64 || t.keyType == this.tc.t_uint64) {
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
                let rtypecode = this.typecode(enode.rhs.type);
                if (this.tc.isStringOrType(enode.lhs.type)) {
                    let ltypecode = this.processExpression(f, scope, enode.lhs, b, vars, enode.lhs.type);                    
                    return b.assign(b.tmp(), "eq", "i32", [ltypecode, rtypecode]);
                }
                let ifaceAddr: ssa.Variable | ssa.Pointer;
                if (this.isLeftHandSide(enode.lhs)) {
                    ifaceAddr = this.processLeftHandExpression(f, scope, enode.lhs, b, vars);
                } else {
                    ifaceAddr = this.processExpression(f, scope, enode.lhs, b, vars, enode.lhs.type) as ssa.Variable;
                }
                if (ifaceAddr instanceof ssa.Variable) {
                    ifaceAddr = new ssa.Pointer(b.assign(b.tmp(), "addr_of", "addr", [ifaceAddr]), 0);
                }
                let ltypecode = b.assign(b.tmp(), "load", "i32", [ifaceAddr.variable, ifaceAddr.offset + this.ifaceHeader.fieldOffset("typecode")]);
                let cmp = b.assign(b.tmp(), "eq", "i32", [ltypecode, rtypecode]);
                return cmp;
            }
            case "typeCast":
            {
                let t = enode.type;
                let t2 = this.tc.stripType(enode.rhs.type);
                let expr = this.processExpression(f, scope, enode.rhs, b, vars, t2);
                let s = this.getSSAType(t);
                let s2 = this.getSSAType(enode.rhs.type);
                if ((t == this.tc.t_float || t == this.tc.t_double) && this.tc.isIntNumber(t2)) {
                    // Ints can be converted to floats
                    let to = this.getSSAType(t);
                    let op: "convert64_s" | "convert64_u" | "convert32_u" | "convert32_s";
                    if (t2 == this.tc.t_uint64) {
                        op = "convert64_u";
                    } else if (t2 == this.tc.t_int64) {
                        op = "convert64_s";
                    } else {
                        op = this.isSigned(t2) ? "convert32_s" : "convert32_u";
                    }
                    return b.assign(b.tmp(), op, to, [expr]);
                } else if (this.tc.isIntNumber(t) && (t2 == this.tc.t_float || t2 == this.tc.t_double)) {
                    // Floats can be converted to ints
                    let to = this.getSSAType(t);
                    let op: "trunc64" | "trunc32";
                    if (t2 == this.tc.t_double) {
                        op = "trunc64";
                    } else {
                        op = "trunc32";
                    }
                    return b.assign(b.tmp(), op, to, [expr]);                    
                } else if (t == this.tc.t_float && t2 == this.tc.t_double) {
                    // Doubles can be converted to floats
                    return b.assign(b.tmp(), "demote", "f32", [expr]);
                } else if (t == this.tc.t_double && t2 == this.tc.t_float) {
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
                } else if (t instanceof UnsafePointerType && (t2 instanceof UnsafePointerType || t2 instanceof PointerType || t2 == this.tc.t_string)) {
                    // Convert pointer or string to unsafe pointer
                    return expr;
                } else if (t == this.tc.t_string && t2 instanceof UnsafePointerType) {
                    // Convert unsafe pointer to string
                    return expr;
                } else if (t == this.tc.t_string && t2 instanceof SliceType) {
                    let head = b.assign(b.tmp(), "addr_of", "addr", [expr]);
                    let ptr = b.assign(b.tmp(), "load", "addr", [head, this.localSlicePointer.fieldOffset("data_ptr")]);
                    let l = b.assign(b.tmp(), "load", "sint", [head, this.localSlicePointer.fieldOffset("data_length")]);
                    return b.call(b.tmp(), this.makeStringFunctionType, [SystemCalls.makeString, ptr, l]);
                } else if ((t == this.tc.t_bool || t == this.tc.t_rune || this.tc.isIntNumber(t)) && (t2 == this.tc.t_bool || t2 == this.tc.t_rune || this.tc.checkIsIntNumber(enode.rhs, false))) {
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
                } else if (t instanceof SliceType && t.getElementType() == this.tc.t_byte && t2 == this.tc.t_string) {
                    // Convert string to a slice
                    let sizePointer = b.assign(b.tmp(), "sub", "addr", [expr, ssa.sizeOf("sint")]);
                    let size = b.assign(b.tmp(), "load", "sint", [sizePointer, 0]);
                    let src = b.assign(b.tmp(), "add", "i32", [expr, 4]);
                    let mem = b.assign(b.tmp(), "alloc_arr", "addr", [size, 1]);
                    b.call(null, this.copyFunctionType, [SystemCalls.copy, mem, src, size]);
                    return b.assign(b.tmp(), "struct", this.strongSlicePointer, [mem, mem, size]);
                } else if (t2 == this.tc.t_null) {
                    return expr;
                } else if (this.tc.isComplexOrType(t2)) {
                    return this.processUnboxInterface(t, expr, b);
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
        if (t == this.tc.t_string) {
            let cmp = b.call(b.tmp(), this.compareStringFunctionType, [SystemCalls.compareString, p1, p2]);
            switch(opcode) {
                case "eq":
                    return b.assign(b.tmp(), "eqz", "i32", [cmp]);
                case "ne":
                    return b.assign(b.tmp(), "ne", "i32", [cmp, 0]);
                case "lt":
                    return b.assign(b.tmp(), "lt_s", "i32", [cmp, 0]);
                case "le":
                    return b.assign(b.tmp(), "le_s", "i32", [cmp, 0]);
                case "gt":
                    return b.assign(b.tmp(), "gt_s", "i32", [cmp, 0]);
                case "ge":
                    return b.assign(b.tmp(), "ge_s", "i32", [cmp, 0]);
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
        if (t == this.tc.t_int8 || t == this.tc.t_int16 || t == this.tc.t_int32 || t == this.tc.t_int64 || t == this.tc.t_float || t == this.tc.t_double) {
            return true;
        }
        if (t == this.tc.t_uint8 || t == this.tc.t_uint16 || t == this.tc.t_uint32 || t == this.tc.t_uint64) {
            return false;
        }
        if (this.tc.isUnsafePointer(t)) {
            return true;
        }
        throw "CodeGen: Implementation error: signed check on non number type " + t.toString();       
    }

    private generateZeroStruct(st: ssa.StructType): Array<ssa.Variable | number> {
        let args = [];
        for(let f of st.fields) {
            for(let i = 0; i < f[2]; i++) {
                args.push(0);
            }
        }
        return args;
    }

    private typecode(t: Type): number {
        // TODO: String addresses and type code numbers must not overlap
        if (t instanceof StringLiteralType) {
            let off = this.backend.addString(t.name);
            if (typeof(off) == "number") {
                return off;
            }
        }
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
                            if (!this.isPureLiteral((t as ArrayType).elementType, p)) {
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

    private generateSliceDestructor(t: SliceType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = "dtr_" + (this.destructors.size).toString();
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let st = this.getSSAType(t) as ssa.StructType;
        // Load pointer to the underlying array, which is a size-prefixed array
        let arrPointer = b.assign(b.tmp(), "load", "addr", [pointer, st.fieldOffset("array_ptr")]);
        if (t.mode == "strong" || t.mode == "unique") {
            this.callDestructor(t.arrayType, arrPointer, 0, b, false, "free");
        } else if (t.mode == "reference") {
            this.callDestructor(t.arrayType, arrPointer, 0, b, false, "decref");
        }

        /*
        // Check whether this is a null slice
        let cond = b.assign(b.tmp(), "ne", "addr", [arrPointer, 0]);
        b.ifBlock(cond);
        if (!this.tc.isPureValue(t.getElementType())) {
            // Load the size
            let countPointer = b.assign(b.tmp(), "sub", "sint", [arrPointer, ssa.sizeOf("sint")]);
            let count = b.assign(b.tmp(), "load", "sint", [countPointer, 0]);
            // Call the destructor for the array elements
            let arrDtr = this.generateArrayDestructor(RestrictedType.strip(t.arrayType) as ArrayType);
            b.call(null, new ssa.FunctionType(["addr", "sint"], null), [arrDtr.getIndex(), arrPointer, count]);
        }
        if (t.mode == "strong" || t.mode == "unique") {
            b.assign(null, "free_arr", "addr", [arrPointer]);
        } else {
            b.assign(null, "decref_arr", "addr", [arrPointer]);
        }
        b.end();
        */
        b.end();
        this.backend.defineFunction(dtrNode, bf, false);
        return bf;
    }

    private generateTupleDestructor(t: TupleType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = "dtr_" + (this.destructors.size).toString();
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let st = this.getSSAType(t) as ssa.StructType;
        let i = 0;
        for (let e of t.types) {
            this.callDestructor(e, pointer, st.fieldOffset("t" + i.toString()), b, true, "no");
            i++;
        }
        b.end();
        this.backend.defineFunction(dtrNode, bf, false);
        return bf;
    }

    private generateStructDestructor(t: StructType): backend.Function {
        let tc = this.typecode(t).toString();
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = "dtr_" + (this.destructors.size).toString() + "_" + t.name;
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let st = this.getSSAType(t) as ssa.StructType;
        for (let f of t.fields) {
            this.callDestructor(f.type, pointer, st.fieldOffset(f.name), b, true, "no");
        }
        b.end();
        this.backend.defineFunction(dtrNode, bf, false);
        return bf;
    }

    private generateArrayDestructor(t: ArrayType): backend.Function {
        let tc = this.typecode(t).toString();
        let elementType = RestrictedType.strip(t.elementType);
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }
        let dtrName = "dtr_" + (this.destructors.size).toString();
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
        this.callDestructor(elementType, pointer, 0, b, true, 'no');
        let st = this.getSSAType(elementType);
        b.assign(pointer, "add", "addr", [pointer, ssa.alignedSizeOf(st)]);
        b.assign(counter, "add", "addr", [counter, 1]);
        b.end();
        b.end();
        b.end();
        this.backend.defineFunction(dtrNode, bf, false);
        return bf;
    }

    private generatePointerDestructor(t: PointerType): backend.Function {
        let tc = this.typecode(t).toString() + "//pointer";
        let bf = this.destructors.get(tc);
        if (bf) {
            return bf;
        }

        let elementType = RestrictedType.strip(t.elementType);
        let dtrName = "dtr_" + (this.destructors.size).toString();
        let dtrType = new ssa.FunctionType(["addr"], null);
        let b = new ssa.Builder();
        bf = this.backend.declareFunction(dtrName);
        let dtrNode = b.define(dtrName, dtrType);
        let pointer = b.declareParam("addr", "pointer");
        this.destructors.set(tc, bf);
        let obj = b.assign(b.tmp(), "load", "addr", [pointer, 0]);
        if (t.mode == "strong" || t.mode == "unique") {
            this.callDestructor(t.elementType, obj, 0, b, false, "free");
        } else if (t.mode == "reference") {
            this.callDestructor(t.elementType, obj, 0, b, false, "decref");
        }
        b.end();
        this.backend.defineFunction(dtrNode, bf, false);
        return bf;    
    }

    /**
     * pointer is the address of a value and t is the type of the value being pointed to.
     */
    private callDestructor(typ: Type, pointer: ssa.Variable, offset: number, b: ssa.Builder, avoidNullCheck: boolean, free: "no" | "free" | "decref") {
        if (!avoidNullCheck) {
            let cond = b.assign(b.tmp(), "ne", "addr", [pointer, 0]);
            b.ifBlock(cond);
        }
        let dtr: backend.Function;
        let obj = pointer;
        if (!this.tc.isPureValue(typ) && !TypeChecker.isLocalReference(typ)) {
            let t = RestrictedType.strip(typ);
            if (t instanceof PointerType) {
                if (free == "decref") {
                    if (offset) {
                        obj = b.assign(b.tmp(), "add", "addr", [pointer, offset]);
                    }
                    dtr = this.generatePointerDestructor(t);
                } else {
                    let val = b.assign(b.tmp(), "load", "addr", [pointer, offset]);
                    if (t.mode == "strong" || t.mode == "unique") {
                        this.callDestructor(t.elementType, val, 0, b, false, "free");
                    } else if (t.mode == "reference")
                        this.callDestructor(t.elementType, val, 0, b, false, "decref");
                }
            } else if (t instanceof StructType) {
                if (offset) {
                    obj = b.assign(b.tmp(), "add", "addr", [pointer, offset]);
                }
                dtr = this.generateStructDestructor(t);
                if (free != "decref") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), obj]);
                }
            } else if (t instanceof ArrayType) {
                if (offset) {
                    obj = b.assign(b.tmp(), "add", "addr", [pointer, offset]);
                }
                dtr = this.generateArrayDestructor(t);
                if (free != "decref") {
                    let size: number | ssa.Variable = t.size;
                    if (t.size < 0) {
                        size = b.assign(b.tmp(), "load", "sint", [obj, -ssa.sizeOf("sint")]);
                    }
                    b.call(null, new ssa.FunctionType(["addr", "sint"], null), [dtr.getIndex(), obj, size]);
                }
            } else if (t instanceof TupleType) {
                if (offset) {
                    obj = b.assign(b.tmp(), "add", "addr", [pointer, offset]);
                }
                dtr = this.generateTupleDestructor(t);
                if (free != "decref") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), obj]);
                }
            } else if (t instanceof SliceType) {
                if (offset) {
                    obj = b.assign(b.tmp(), "add", "addr", [pointer, offset]);
                }
                dtr = this.generateSliceDestructor(t);
                if (free != "decref") {
                    b.call(null, new ssa.FunctionType(["addr"], null), [dtr.getIndex(), obj]);
                }
            } else {
                throw "Implementation error";
            }
        }
        if (free == "free") {
            if (this.tc.isArray(typ)) {
                b.assign(null, "free_arr", null, [obj]);
            } else {
                b.assign(null, "free", null, [obj]);
            }
        } else if (free == "decref") {
            if (this.tc.isArray(typ)) {
                b.assign(null, "decref_arr", null, [obj, dtr ? dtr.getIndex() : -1]);
            } else {
                b.assign(null, "decref", null, [obj, dtr ? dtr.getIndex() : -1]);
            }
        }
        if (!avoidNullCheck) {
            b.end();
        }
    }

    private scopeNeedsDestructors(scope: Scope): boolean {
        while(scope) {
            for(let e of scope.elements.values()) {
                // FunctionParameters marked with isConst are not destructed by the function but by their caller
                if ((e instanceof Variable && !e.isResult) || (e instanceof FunctionParameter && !e.isConst)) {
                    if (!this.tc.isPureValue(e.type)) {
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

    private functionArgumentIncref(rhs: ssa.Variable | ssa.Pointer | number, rhsNode: Node, rhsData: ssa.Variable | number, targetType: Type, scope: Scope, b: ssa.Builder): [ssa.Variable | number, ssa.Variable] {
        let decrefVar: ssa.Variable;
        /*
        // Reference counting for pointers
        if (this.tc.isSafePointer(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type) || !TypeChecker.isTakeExpression(rhsNode))) {
            // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
            rhsData = b.assign(b.tmp(), "incref", "addr", [rhsData]);
        } else if (this.tc.isSlice(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type) || !TypeChecker.isTakeExpression(rhsNode))) {
            // Reference counting for slices
            let st = this.getSSAType(targetType) as ssa.StructType;
            let arrayPointer: ssa.Variable;
            if (rhs instanceof ssa.Pointer) {
                arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
            } else {
                arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
            }
            b.assign(null, "incref_arr", "addr", [arrayPointer]);
        */
        if (this.tc.isSafePointer(targetType) && (TypeChecker.isLocalReference(targetType) || TypeChecker.isReference(targetType))) {
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if (result[0] != "no") {
                b.assign(null, 'incref', "addr", [rhsData]);
                decrefVar = rhsData as ssa.Variable;
            } else {
                result[1].localReferenceCount++;    
            }
        } else if (this.tc.isSlice(targetType) && (TypeChecker.isLocalReference(targetType) || TypeChecker.isReference(targetType))) {
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if (result[0] != "no") {
                let st = this.getSSAType(rhsNode.type) as ssa.StructType;
                let arrayPointer: ssa.Variable;
                if (rhs instanceof ssa.Pointer) {
                    arrayPointer = b.assign(b.tmp(), "load", "addr", [rhs.variable, rhs.offset + st.fieldOffset("array_ptr")]);
                } else {
                    arrayPointer = b.assign(b.tmp(), "member", "addr", [rhs, st.fieldIndexByName("array_ptr")]);
                }
                b.assign(null, "incref_arr", "addr", [arrayPointer]);
                decrefVar = arrayPointer;
            } else {
                result[1].localReferenceCount++;
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

        return [rhsData, decrefVar];
    }

    private functionArgumentDecref(decrefVar: ssa.Variable, rhsNode: Node, targetType: Type, scope: Scope, b: ssa.Builder): void {
        if (this.tc.isSafePointer(targetType) && (TypeChecker.isLocalReference(targetType) || TypeChecker.isReference(targetType))) {
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if (result[0] != "no") {
                this.callDestructor(rhsNode.type, decrefVar, 0, b, true, "decref");
            } else {
                result[1].localReferenceCount--;
            }        
        } else if (this.tc.isSlice(targetType) && (TypeChecker.isLocalReference(targetType) || TypeChecker.isReference(targetType))) {
            let result = this.functionArgumentIncrefIntern(rhsNode, scope);
            if (result[0] != "no") {
                let sliceType = RestrictedType.strip(rhsNode.type);
                let arrayType = RestrictedType.strip(sliceType);
                this.callDestructor(arrayType, decrefVar, 0, b, true, "decref");
            } else {
                result[1].localReferenceCount--;
            }
        }
    }

    private functionArgumentIncrefIntern(enode: Node, scope: Scope): ["yes" | "one_indirection" | "no", Variable | FunctionParameter] {
        switch(enode.op) {
            case "(":
            case "unary*":
            case "take":
                return ["yes", null];
            case ".":
            {
                let lhs = this.functionArgumentIncrefIntern(enode.lhs, scope);
                if (lhs[0] == "yes") {
                    return lhs;
                }
                let type: Type = RestrictedType.strip(enode.lhs.type);
                if (this.tc.isStruct(type) || this.tc.isUnsafePointer(type)) {
                    return lhs;
                }
                if (type instanceof PointerType && (type.mode == "unique" || type.mode == "strong") && lhs[0] == "no" && lhs[1].localReferenceCount == 0) {
                    return ["one_indirection", lhs[1]];
                }
                return ["yes", null];
            }
            case "[":
            {
                let lhs = this.functionArgumentIncrefIntern(enode.lhs, scope);
                if (lhs[0] == "yes") {
                    return lhs;
                }
                let type: Type = RestrictedType.strip(enode.lhs.type);
                if (this.tc.isArray(type) || this.tc.isUnsafePointer(type)) {
                    return lhs;
                }
                if (type instanceof SliceType && (type.mode == "unique" || type.mode == "strong") && lhs[0] == "no" && lhs[1].localReferenceCount == 0) {
                    return ["one_indirection", lhs[1]];
                }
                return ["yes", null];
            }
            case "unary&":
            {
                let result = this.functionArgumentIncrefIntern(enode.rhs, scope);
                if (result[0] == "one_indirection") {
                    result[0] == "no";
                }
                return result;
            }
            case "id":
            {
                let e = scope.resolveElement(enode.value);
                if (!e) {
                    throw "Implementation error";
                }
                if ((e instanceof Variable || e instanceof FunctionParameter)) {
                    return ["no", e];
                }
                return ["yes", null];
            }
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
        if (this.tc.isSafePointer(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type) || !TypeChecker.isTakeExpression(rhsNode))) {
            // Assigning to ~ptr means that the reference count needs to be increased unless the RHS is a take expressions which yields ownership
            data = b.assign(b.tmp(), "incref", "addr", [data]);
        }
        // Reference counting for slices
        if (this.tc.isSlice(targetType) && TypeChecker.isReference(targetType) && (TypeChecker.isStrong(rhsNode.type) || TypeChecker.isUnique(rhsNode.type) || !TypeChecker.isTakeExpression(rhsNode))) {
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

    private optimizer: ssa.Optimizer;
    private backend: backend.Backend;
    private tc: TypeChecker;
    private imports: Map<string, backend.FunctionImport>;
    private funcs: Map<Function, backend.Function | backend.FunctionImport> = new Map<Function, backend.Function | backend.FunctionImport>();
    private globalVars = new Map<ScopeElement, ssa.Variable>();
    private strongSlicePointer: ssa.StructType;
    private localSlicePointer: ssa.StructType;
    // private sliceHeader: ssa.StructType;
    private ifaceHeader: ssa.StructType;
    private ifaceHeader32: ssa.StructType;
    private ifaceHeaderFloat: ssa.StructType;
    private ifaceHeaderDouble: ssa.StructType;
    private ifaceHeaderSlice: ssa.StructType;
    private mapHead: ssa.StructType;
    private emitIR: boolean;
    private emitNoWasm: boolean;
    private emitFunction: string | null;
    private emitC: boolean;
    private disableNullCheck: boolean;
    private concatStringFunctionType: ssa.FunctionType;
    private compareStringFunctionType: ssa.FunctionType;
    private makeStringFunctionType: ssa.FunctionType;
    private createMapFunctionType: ssa.FunctionType;
    private setMapFunctionType: ssa.FunctionType;
    private hashStringFunctionType: ssa.FunctionType;
    private lookupMapFunctionType: ssa.FunctionType;
    private removeMapKeyFunctionType: ssa.FunctionType;
    private setNumericMapFunctionType: ssa.FunctionType;
    private lookupNumericMapFunctionType: ssa.FunctionType;
    private removeNumericMapKeyFunctionType: ssa.FunctionType;
    private decodeUtf8FunctionType: ssa.FunctionType;
    private copyFunctionType: ssa.FunctionType;
    private interfaceTableNames: Array<string> = [];
    private interfaceTableIndex: Map<string, number> = new Map<string, number>();
    private interfaceTableLength: number = 0;
    private typeCodeMap: Map<string,number> = new Map<string, number>();
    private destructors: Map<string, backend.Function> = new Map<string, backend.Function>();
}

