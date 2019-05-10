import {Node, Location, AstFlags} from "../parser"
import { Package } from "../pkg"
import {
    ArrayLiteralType, ArrayType, FunctionType, GenericParameter,
    InterfaceType, MapType, ObjectLiteralType, OrType, PackageType,
    PointerType, RestrictedType, SliceType, StringLiteralType, StructField,
    StructType, TemplateFunctionType, TemplateInterfaceType, TemplateStructType, TemplateType,
    TupleLiteralType, TupleType, Type, UnsafePointerType, PointerMode
} from "../types/";
import {
    Group, GroupKind, TupleGroup, GroupCheckFlags, Restrictions, combineRestrictions
} from './group'
import {
    Scope, ScopeElement, Function, FunctionParameter, TemplateFunction,
    Variable, ImportedPackage, ScopeExit
} from '../scope'
import { ImplementationError, TodoError, TypeError } from '../errors'
import {createHash} from "crypto";

import * as helper from './helper'
import { Static } from './Static'
import { endianness } from "os";

/**
 * Typedef represents the result of a 'type' statement, i.e.
 * a named type which is of course subject to a scope.
 */
export class Typedef {
    // The name of the Typedef
    public name: string;
    // The Type defined by the Typedef
    public type: Type;
    // The AST of the Typedef
    public node: Node;
    // The scope to which the typedef belongs
    public scope: Scope;

    public _tc: TypeChecker;
    public _mark: boolean;
}

export class TypeChecker {
    constructor(pkg: Package) {
        if (!Static.isInitialized()) {
            Static.init()
            this.ifaces.push(Static.t_error);
        }
        this.pkg = pkg;
        this.globalGroup = new Group(GroupKind.Bound, "$global");
    }

    public createType(tnode: Node, scope: Scope, mode: "default" | "parameter" | "variable" | "variable_toplevel" | "parameter_toplevel" = "default"): Type {
        let t = this.createTypeIntern(tnode, scope, mode);
        if (tnode.groupName) {
            t.groupName = tnode.groupName.value;
        }
        return t;
    }

    private createTypeIntern(tnode: Node, scope: Scope, mode: "default" | "parameter" | "variable" | "variable_toplevel" | "parameter_toplevel" = "default"): Type {
        let originalMode = mode;
        if (mode == "parameter_toplevel") {
            mode = "parameter";
        }
        if (mode == "variable_toplevel") {
            mode = "variable";
        }
        if (tnode.op == "basicType") {
            if (tnode.nspace) {
                let p = scope.resolveElement(tnode.nspace);
                if (!p) {
                    throw new TypeError("Unknown package " + tnode.nspace, tnode.loc);
                }
                if (!(p.type instanceof PackageType)) {
                    throw new TypeError(tnode.nspace + " is not a package", tnode.loc);
                }
                let t =  p.type.pkg.scope.resolveType(tnode.value);
                if (!t) {
                    throw new TypeError("Unknown type " + tnode.value + " in package " + p.type.pkg.pkgPath, tnode.loc);
                }
                return t;
            }
            let t = scope.resolveType(tnode.value);
            if (!t) {
                throw new TypeError("Unknown type " + tnode.value, tnode.loc);
            }
            return t;
        } else if (tnode.op == "str") {
            let t = this.stringLiteralType(tnode.value);
            return t;
        } else if (tnode.op == "constType") {
            let c = this.createType(tnode.rhs, scope, originalMode);
            if (helper.isSafePointer(c)) {
                let ptr = RestrictedType.strip(c) as PointerType;
                ptr.elementType = helper.makeConst(ptr.elementType, tnode.loc);
                return c;
            } else if (helper.isSlice(c)) {
                let ptr = RestrictedType.strip(c) as SliceType;
                ptr.arrayType = helper.makeConst(ptr.arrayType, tnode.loc) as RestrictedType;
                return c;
            }
            // TODO: Map
            return helper.makeConst(c, tnode.loc)
        } else if (tnode.op == "pointerType") {
            let t = this.createType(tnode.rhs, scope, mode);
            return new PointerType(t, "strong");
        } else if (tnode.op == "uniquePointerType") {
            let c = this.createType(tnode.rhs, scope, mode);
            return new PointerType(c, "unique");
        } else if (tnode.op == "referenceType") {
            let c = this.createType(tnode.rhs, scope, mode);
            return new PointerType(c, "reference");
        } else if (tnode.op == "localReferenceType") {
            if (originalMode != "parameter_toplevel") {
                throw new TypeError("A local reference is not allowed in this place", tnode.loc);
            }
            let c = this.createType(tnode.rhs, scope, mode);
            return new PointerType(c, "local_reference");
        } else if (tnode.op == "unsafePointerType") {
            let t = this.createType(tnode.rhs, scope, mode);
            if (helper.isInterface(t)) {
                throw new TypeError("Unsafe pointers to interfaces are not possible", tnode.loc);
            }
            return new UnsafePointerType(t);
        } else if (tnode.op == "sliceType") {
            let t = this.createType(tnode.rhs, scope, mode);
            let s = new SliceType(t as ArrayType | RestrictedType, "strong");
            if (tnode.value == "^[]") {
                s.mode = "unique";
            } else if (tnode.value == "~[]") {
                s.mode = "reference";
            } else if (tnode.value == "&[]") {
                if (originalMode != "parameter_toplevel") {
                    throw new TypeError("A local reference slice is not allowed in this place", tnode.loc);
                }
                s.mode = "local_reference";
            }
            return s;
        } else if (tnode.op == "tupleType") {
            let types: Array<Type> = [];
            for(let p of tnode.parameters) {
                let pt = this.createType(p, scope, mode);
                types.push(pt);
            }
            let t = new TupleType(types);
            return t;
        } else if (tnode.op == "arrayType") {
            if (tnode.lhs === null) {
                return new ArrayType(this.createType(tnode.rhs, scope, mode), -1);
            }
            this.checkExpression(tnode.lhs, scope);
            if (tnode.lhs.op != "int") {
                throw new TypeError("Expected a constant number for array size", tnode.lhs.loc);
            }
            // TODO: Check range before parseInt
            return new ArrayType(this.createType(tnode.rhs, scope, mode), parseInt(tnode.lhs.value));
        } else if (tnode.op == "funcType") {
            let t = new FunctionType();
            t.loc = tnode.loc;
            if (tnode.parameters) {
                for(let pnode of tnode.parameters) {
                    var p = new FunctionParameter();
                    if (pnode.op == "ellipsisParam") {
                        p.ellipsis = true;
                        pnode = pnode.lhs;
                    }
                    p.type = this.createType(pnode, scope, "parameter_toplevel");
                    if (helper.isReference(p.type) || helper.isLocalReference(p.type) || helper.isString(p.type)) {
                        p.isConst = true;
                    }
                    if (p.ellipsis && !(p.type instanceof SliceType)) {
                        throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                    }
                    this.checkVariableType(p.type, pnode.loc);
                    p.loc = pnode.loc;
                    t.parameters.push(p);
                }
            }
            if (tnode.rhs) {
                t.returnType = this.createType(tnode.rhs, scope, "parameter");
                this.checkVariableType(t.returnType, tnode.rhs.loc);
            } else {
                t.returnType = Static.t_void;
            }
            return t;
        } else if (tnode.op == "mapType") {
            let k = this.createType(tnode.lhs, scope, mode);
            let v = this.createType(tnode.rhs, scope, mode);
            if (!helper.isIntNumber(k) && !helper.isString(k) && !helper.isSafePointer(k) && !helper.isUnsafePointer(k)) {
                throw new TypeError("Map keys must be integers, strings, or pointers", tnode.loc);
            }
            return new MapType(k, v);
        } else if (tnode.op == "genericType") {
            let baset: Type;
            if (tnode.nspace) {
                let p = scope.resolveElement(tnode.nspace);
                if (!p) {
                    throw new TypeError("Unknown package " + tnode.nspace, tnode.loc);
                }
                if (!(p.type instanceof PackageType)) {
                    throw new TypeError(tnode.nspace + " is not a package", tnode.loc);
                }
                baset =  p.type.pkg.scope.resolveType(tnode.lhs.value);
                if (!baset) {
                    throw new TypeError("Unknown type " + tnode.lhs.value + " in package " + p.type.pkg.pkgPath, tnode.loc);
                }
            } else {
                baset = scope.resolveType(tnode.lhs.value);
                if (!baset) {
                    throw new TypeError("Unknown type " + tnode.lhs.value, tnode.loc);
                }
            }
            if (!(baset instanceof TemplateType)) {
                throw new TypeError("Type " + baset.toString() + " is not a template type", tnode.loc);
            }
            let types: Array<Type> = [];
            for(let i = 0; i < tnode.genericParameters.length; i++) {
                let t = this.createType(tnode.genericParameters[i], scope, mode);
                types.push(t);
            }
            return this.instantiateTemplateType(baset, types, tnode.loc, mode);
        } else if (tnode.op == "orType") {
            return this.createOrType(tnode, scope, null, mode);
        } else if (tnode.op == "andType") {
            return this.createInterfaceType(tnode, scope, null, mode);
        } else if (tnode.op == "structType") {
            return this.createStructType(tnode, scope, null, mode);
        } else if (tnode.op == "interfaceType" || tnode.op == "componentInterfaceType") {
            if (originalMode == "parameter_toplevel" || originalMode == "variable_toplevel") {
                throw new TypeError("Interface types are not allowed in this place. Use a pointer to an interface instead", tnode.loc);
            }
            let iface: Type = this.createInterfaceType(tnode, scope, null, mode);
            return new PointerType(iface, "strong");
        } else if (tnode.op == "copyType") {
            let t = this.createType(tnode.lhs, scope, mode);
            return this.createCopyType(t, tnode.loc);
        } else if (tnode.op == "opaqueType") {
            if (originalMode == "parameter_toplevel" || originalMode == "variable_toplevel") {
                throw new TypeError("Opaque types are not allowed in this place. Use a pointer to the type instead", tnode.loc);
            }
            let s = new StructType();
            s.pkg = this.pkg;
            s.loc = tnode.loc;
            s.opaque = true;
            return s;
        }
        throw new ImplementationError("type " + tnode.op)
    }

    private createCopyType(t: Type, loc: Location): Type {
        if (helper.isUnsafePointer(t)) {
            return t;
        }
        if (helper.isSafePointer(t)) {
            if (helper.isStrong(t) || helper.isUnique(t)) {
                let stripped = RestrictedType.strip(t) as PointerType;
                let t2: Type = new PointerType(stripped.elementType, "reference");
                if (helper.isConst(t)) {
                    t2 = helper.makeConst(t2, loc);
                }
                return t2;
            }
            return t;
        }
        if (helper.isSlice(t)) {
            if (helper.isStrong(t) || helper.isUnique(t)) {
                let stripped = RestrictedType.strip(t) as SliceType;
                let t2: Type = new SliceType(stripped.arrayType, "reference");
                if (helper.isConst(t)) {
                    t2 = helper.makeConst(t2, loc);
                }
                return t2;
            }
            return t;
        }
        if (helper.isArray(t) || helper.isStruct(t) || helper.isTuple(t)) {
            if (helper.isPureValue(t)) {
                throw new TypeError("The type " + t.toString() + " cannot be copied", loc);
            }
            return t;
        }
        if (helper.isNumber(t)) {
            return t;
        }
        throw new ImplementationError()
    }

    private createArrayType(tnode: Node, scope: Scope, t: ArrayType, mode?: "default" | "parameter" | "variable"): Type {
        let e = this.createType(tnode.rhs, scope, mode ? mode : "default");
        t.elementType = e;
        return t;
    }

    private createOrType(tnode: Node, scope: Scope, t?: OrType, mode?: "default" | "parameter" | "variable"): Type {
        // TODO: Avoid double entries
        if (!t) {
            t = new OrType();
        }
        for(let i = 0; i < tnode.parameters.length; i++) {
            let pnode = tnode.parameters[i];
            let pt = this.createType(pnode, scope, mode ? mode : "default");
            if (pt instanceof OrType) {
                t.types = t.types.concat(pt.types);
            } else {
                t.types.push(pt);
            }
        }
        return t;
    }

    private createInterfaceType(tnode: Node, scope: Scope, iface?: InterfaceType, mode?: "default" | "parameter" | "variable"): InterfaceType {
        if (!iface) {
            iface = new InterfaceType();
            iface.isComponent = (tnode.op == "componentInterfaceType");
            iface.pkg = this.pkg;
            iface.loc = tnode.loc;
            this.ifaces.push(iface);
        }
        iface.loc = tnode.loc;

        if (tnode.op == "andType") {
            for(let i = 0; i < tnode.parameters.length; i++) {
                let pnode = tnode.parameters[i];
                let pt = this.createType(pnode, scope, mode ? mode : "default");
                if (!(pt instanceof InterfaceType)) {
                    throw new TypeError(pt.toString() + " is not an interface", pnode.loc);
                }
                iface.extendsInterfaces.push(pt);
            }
            return iface;
        }

        for(let mnode of tnode.parameters) {
            if (mnode.op == "extends") {
                let t = this.createType(mnode.rhs, scope, mode ? mode : "default");
                if (!(t instanceof InterfaceType)) {
                    throw new TypeError(t.toString() + " is not an interface", mnode.loc);
                }
                iface.extendsInterfaces.push(t);
            }
        }
        for(let mnode of tnode.parameters) {
            if (mnode.op == "extends") {
                // Do nothing by intention
            } else if (mnode.op == "funcType") {
                let ft = this.createType(mnode, scope, mode ? mode : "default") as FunctionType;
                ft.name = mnode.name.value;
                if (iface.methods.has(ft.name)) {
                    throw new TypeError("Duplicate member name " + ft.name, mnode.loc);
                }
                iface.methods.set(ft.name, ft);
                let fscope = new Scope(scope); // This scope is required for box names
                let ptrMode: PointerMode = "reference";
                if ((mnode.lhs.flags & AstFlags.ReferenceObjectMember) == AstFlags.ReferenceObjectMember) {
                    ptrMode = "local_reference";
                }
                let isConst = false;
                if (mnode.lhs.op == "constType") {
                    isConst = true;
                }
                ft.objectType = new PointerType(iface, ptrMode);
                if (isConst) {
                    ft.objectType = helper.makeConst(ft.objectType, mnode.loc);
                }
            } else {
                throw new ImplementationError(mnode.op + " " + iface.name)
            }
        }
        return iface;
    }

    private checkInterfaceType(iface: InterfaceType) {
        if (iface._markChecked) {
            return;
        }
        iface._markChecked = true;

        let bases = iface.getAllBaseTypes();
        if (bases && bases.indexOf(iface) != -1) {
            throw new TypeError("Interface " + iface.name + " is extending itself", iface.loc);
        }

        // Find all methods that exist in more than one inherited interface or are defined on this interface.
        // These method types must be equal
        let methodNames: Map<string, boolean> = new Map<string, boolean>();
        let maps: Map<InterfaceType, Map<string, FunctionType>> = new Map<InterfaceType, Map<string, FunctionType>>()
        maps.set(iface, iface.methods);
        for(let b of iface.extendsInterfaces) {
            maps.set(b as InterfaceType, (b as InterfaceType).getAllMethods());
        }
        for(let m of maps.values()) {
            for(let key of m.keys()) {
                methodNames.set(key, true);
            }
        }
        for(let key of methodNames.keys()) {
            let ft: FunctionType = null;
            let ft_iface: InterfaceType;
            for(let entry of maps.entries()) {
                if (entry[1].has(key)) {
                    if (ft) {
                        let ft2: FunctionType = entry[1].get(key)
                        // Both functions must have the same signatures and either they are both const or both non-const (the only restriction possible on interface functions)
                        if (!this.checkTypeEquality(ft, ft2, iface.loc, false)) {
                            throw new TypeError("Incompatible definition of " + key + " in " + ft_iface.toString() + " and " + entry[0].toString(), iface.loc);
                        }
                    } else {
                        ft = entry[1].get(key);
                        ft_iface = entry[0];
                    }
                }
            }
        }
    }

    private createStructType(tnode: Node, scope: Scope, s?: StructType, mode?: "default" | "parameter" | "variable"): Type {
        if (!s) {
            s = new StructType();
            s.pkg = this.pkg;
            s.loc = tnode.loc;
            this.structs.push(s);
        }

        if (tnode.op == "opaqueType") {
            return s;
        }

        for(let fnode of tnode.parameters) {
            if (fnode.op == "extends") {
                let ext: Type = this.createType(fnode.rhs, scope, mode ? mode : "default");
                if (s.extends) {
                    throw new TypeError("Struct cannot extend only one type", fnode.loc);
                }
                s.extends = ext;
                if (s.extends.name != "") {
                    if (s.field(s.extends.name)) {
                        throw new TypeError("Duplicate field name " + s.extends.name, fnode.loc);
                    }
                }
                if (s.field("base", true)) {
                    throw new TypeError("Duplicate field name base", fnode.loc);
                }
                let f = new StructField();
                f.name = "base";
                f.type = s.extends;
                s.fields.unshift(f);
            } else if (fnode.op == "implements") {
                let ext: Type = this.createType(fnode.rhs, scope, mode ? mode : "default");
                if (!(ext instanceof InterfaceType)) {
                    throw new TypeError(ext.toString() + " is not an interface type", tnode.rhs.loc);
                }
                s.implements.push(ext);
            } else if (fnode.op == "structField") {
                if (s.field(fnode.lhs.value, true)) {
                    throw new TypeError("Duplicate field name " + fnode.lhs.value, fnode.lhs.loc);
                }
                // TODO: Check for duplicate names in the structs extends by this struct
                let field = new StructField();
                field.name = fnode.lhs.value;
                field.type = this.createType(fnode.rhs, scope, mode ? mode : "default");
                s.fields.push(field);
            } else {
                throw new ImplementationError()
            }
        }

        return s;
    }

    public checkStructType(s: StructType) {
        if (s._markChecked) {
            return;
        }
        s._markChecked = true;

        if (s.extends) {
            let bases = s.getAllBaseTypes();
            if (bases && bases.indexOf(s) != -1) {
                throw new TypeError("Struct " + s.name + " is extending itself", s.loc);
            }
            if (s.extends instanceof StructType) {
                if (s.extends.opaque) {
                    throw new TypeError("Cannot extend opaque type " + s.extends.toString(), s.loc);
                }
                this.checkStructType(s.extends);
                let inheritedMethods = s.extends.getAllMethodsAndFields();

                for(let key of s.methods.keys()) {
                    if (inheritedMethods.has(key)) {
                        throw new TypeError("Method " + key + " shadows field or method of " + s.extends.toString(), s.loc);
                    }
                }

                for(let f of s.fields) {
                    if (inheritedMethods.has(f.name)) {
                        throw new TypeError("Field " + f.name + " shadows field or method of " + s.extends.toString(), s.loc);
                    }
                }
            }
        }
        for(let iface of s.implements) {
            this.checkIsAssignableType(new PointerType(iface, "strong"), new PointerType(s, "strong"), s.loc, "assign", true);
        }
    }

    private instantiateTemplateType(t: TemplateType, types: Array<Type>, loc: Location, mode: "default" | "parameter" | "variable"): Type {
        // Check whether the template has already been instantiated with these type parameters
        let a = this.templateTypeInstantiations.get(t);
        if (a) {
            for(let s of a) {
                let ok = true;
                for(let k = 0; k < types.length; k++) {
                    let type = types[k];
                    let hasType = s.templateParameterTypes[k];
                    if (!this.checkTypeEquality(type, hasType, loc, false)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    return s;
                }
            }
        }

        if (types.length != t.templateParameterNames.length) {
            throw new TypeError("Mismatch in template parameter types while instantiating " + t.toString(), loc);
        }

        let scope = new Scope(t.parentScope);
        for(let i = 0; i < t.templateParameterNames.length; i++) {
            if (t.templateParameterTypes[i]) {
                let tp = this.createType(t.templateParameterTypes[i], scope, mode);
                if (!(tp instanceof OrType)) {
                    throw new TypeError("Template parameter type constraints must be an or'ed type", loc);
                }
                let ok = false;
                for(let o of tp.types) {
                    if (this.checkTypeEquality(o, types[i], loc, false)) {
                        ok = true;
                        break;
                    }
                }
                if (!ok) {
                    throw new TypeError(types[i].toString() + " does not match with template parameter constraint " + tp.toString() + " of template parameter " + t.templateParameterNames[i] + " of template type " + t.name, loc);
                }
            }
            scope.registerType(t.templateParameterNames[i], types[i]);
        }
        let node = t.node.rhs.clone();

        if (node.op == "structType") {
            let s = new TemplateStructType();
            s.pkg = this.pkg;
            s.base = t;
            s.name = t.name;
            s.loc = t.loc;
            s.templateParameterTypes = types;

            if (a) {
                a.push(s);
            } else {
                this.templateTypeInstantiations.set(t, [s]);
            }

            this.createStructType(node, scope, s);
            for(let m of t.methods) {
                this.instantiateTemplateMemberFunction(t, s, m);
            }
            return s;
        } else if (node.op == "interfaceType" || node.op == "andType" || node.op == "componentInterfaceType") {
            let s = new TemplateInterfaceType();
            s.base = t;
            s.name = t.name;
            s.loc = t.loc;
            s.templateParameterTypes = types;

            if (a) {
                a.push(s);
            } else {
                this.templateTypeInstantiations.set(t, [s]);
            }

            this.createInterfaceType(node, scope, s);
            return s;
        } else if (node.op == "funcType") {
            let s = new TemplateFunctionType();
            s.base = t;
            s.name = t.name;
            s.loc = t.loc;
            s.templateParameterTypes = types;

            if (a) {
                a.push(s);
            } else {
                this.templateTypeInstantiations.set(t, [s]);
            }

            throw new TodoError()
        } else if (node.op == "orType") {
            throw new TodoError()
        }
        throw new ImplementationError()
    }

    private instantiateTemplateMemberFunction(t: TemplateType, s: TemplateStructType, m: TemplateFunction): Function | TemplateFunction {
        let scope = new Scope(t.parentScope);
        // TODO: Register the fully qualified name, too
        // scope.registerType(s.name, s);
        for(let i = 0; i < t.templateParameterNames.length; i++) {
            scope.registerType(t.templateParameterNames[i], s.templateParameterTypes[i]);
        }
        let node = m.node.clone();
        let f = this.createFunction(node, scope, this.moduleNode.scope, null, null, s);
        if (f instanceof Function) {
            f.isTemplateInstance = true;
            this.checkFunctionBody(f);
        }
        return f;
    }

    /**
     * Parses the instantiation of a template function, e.g. in "max<int>(4,5)" this function parses "max<int>".
     */
    private instantiateTemplateFunctionFromNode(tnode: Node, scope: Scope): Function {
        if (tnode.op != "genericInstance") {
            throw new ImplementationError()
        }
        let baset = tnode.lhs.type;
        // Is the type a template type?
        if (!(baset instanceof TemplateType)) {
            throw new TypeError("Type " + baset.toString() + " is not a template function", tnode.loc);
        }
        // Is the type a function template type?
        if (baset.node.op != "func" && baset.node.op != "export_func") {
            throw new TypeError("Type " + baset.toString() + " is not a template function", tnode.loc);
        }
        if (tnode.genericParameters.length != baset.templateParameterNames.length) {
            throw new TypeError("Mismatch in template parameter types while instantiating " + baset.toString(), tnode.loc);
        }
        // Parse the types in brackets as in max<int>(4,5)
        let types: Array<Type> = [];
        for(let i = 0; i < tnode.genericParameters.length; i++) {
            let pnode = tnode.genericParameters[i];
            let pt = this.createType(pnode, scope, "parameter");
            pnode.type = pt;
            types.push(pt);
        }
        return this.instantiateTemplateFunction(baset, types, tnode.loc);
    }

    /**
     * Instantiates a template function.
     */
    private instantiateTemplateFunction(t: TemplateType, types: Array<Type>, loc: Location): Function {
        // Check whether this function has already been instantiated.
        let a = this.templateFunctionInstantiations.get(t);
        if (a) {
            for(let f of a) {
                let ok = true;
                for(let k = 0; k < types.length; k++) {
                    let type = types[k];
                    let hasType = (f.type as TemplateFunctionType).templateParameterTypes[k];
                    if (!this.checkTypeEquality(type, hasType, loc, false)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    return f;
                }
            }
        }

        // Check whether the template instantiation is consistent with the template parameter types.
        // Register the template parameters as types.
        // Non-exported templates can see package variables via t.parentScope. Exported templates cannot do this.
        // TODO: Need a vanilla scope
        // let scope = new Scope(t.node.op == "export_func" ? null : t.parentScope);
        let scope = new Scope(t.parentScope);
        for(let i = 0; i < t.templateParameterNames.length; i++) {
            if (t.templateParameterTypes[i]) {
                let tp = this.createType(t.templateParameterTypes[i], scope, "parameter");
                if (!(tp instanceof OrType)) {
                    throw new TypeError("Template parameter type constraints must be an or'ed type", loc);
                }
                let ok = false;
                for(let o of tp.types) {
                    if (this.checkTypeEquality(o, types[i], loc, false)) {
                        ok = true;
                        break;
                    }
                }
                if (!ok) {
                    throw new TypeError(types[i].toString() + " does not match with template parameter constraint " + tp.toString() + " of parameter " + t.templateParameterNames[i] + " of template function " + t.name, loc);
                }
            }
            scope.registerType(t.templateParameterNames[i], types[i]);
        }

        // Create a copy the template AST and parse the template function's type signature.
        // Store the type, so that the same template instantiation does not occur twice.
        let node = t.node.clone();
        let f = this.createFunction(node, scope, this.moduleNode.scope, t, types);
        if (!(f instanceof Function)) {
            throw new ImplementationError()
        }
//        if (!(f.type instanceof TemplateFunctionType)) {
//            throw new ImplementationError()
//        }
//        f.isTemplateInstance = true;
//        f.type.base = t;
//        f.type.templateParameterTypes = types;
        if (a) {
            a.push(f);
        } else {
            this.templateFunctionInstantiations.set(t, [f]);
        }

        // Typecheck the template function body.
        this.checkFunctionBody(f);
        return f;
    }

    // TODO: move to helper.ts
    public static mangleTemplateParameters(types: Array<Type>): string {
        let str = "<";
        for(let g of types) {
            str += g.toTypeCodeString() + ",";
        }
        str += ">";
        let hash = createHash("md5");
        hash.update(str);
        return "_" + hash.digest("hex");
    }

    // TODO: move to helper.ts
    public static mangledTypeName(t: Type): string {
        if (t instanceof TemplateStructType) {
            return t.base.pkg.pkgPath + "/" + t.name + TypeChecker.mangleTemplateParameters(t.templateParameterTypes);
        }
        if (t instanceof StructType) {
            return t.pkg.pkgPath + "/" + t.name;
        }
        return t.name;
    }

    public createFunction(fnode: Node, parentScope: Scope, registerScope: Scope, templateBase: TemplateType = null, templateParameterTypes: Array<Type> = null, templateTypeInstance: TemplateStructType = null): Function | TemplateFunction {
        if (!fnode.name) {
            throw new TypeError("Function must be named", fnode.loc);
        }
        let objectType: Type;
        let structType: StructType;
        let templateType: TemplateType;
        // A member function?
        if (fnode.lhs) {
            var obj: Type;
            if (templateTypeInstance) {
                let s = new Scope(parentScope);
                s.registerType(templateTypeInstance.name, templateTypeInstance);
                obj = this.createType(fnode.lhs, s, "parameter");
            } else {
                obj = this.createType(fnode.lhs, parentScope, "parameter");
            }
            let obj2 = RestrictedType.strip(obj);
            if (obj2.name == "") {
                throw new TypeError(obj.toString() + " is not a named struct", fnode.lhs.loc);
            }
            if (obj2 instanceof StructType) {
                structType = obj2;
            } else if (obj2 instanceof TemplateType) {
                templateType = obj2;
            } else {
                throw new TypeError(obj.toString() + " is not a named struct", fnode.lhs.loc);
            }
            let mode: PointerMode = "reference";
            if ((fnode.lhs.flags & AstFlags.ReferenceObjectMember) == AstFlags.ReferenceObjectMember) {
                mode = "local_reference";
            }
            objectType = new PointerType(obj, mode);
        }
        let f: Function | TemplateFunction;
        if ((fnode.genericParameters && !templateBase) || helper.isTemplateType(templateType)) {
            f = new TemplateFunction();
            f.node = fnode;
            if (templateType) {
                f.owner = templateType;
                templateType.methods.push(f);
            }
            f.name = fnode.name.value;
        } else if (templateBase) {
            f = new Function();
            fnode.scope = f.scope;
            let tt = new TemplateFunctionType();
            tt.templateParameterTypes = templateParameterTypes;
            tt.base = templateBase;
            f.type = tt;
            f.isTemplateInstance = true;
            f.name = templateBase.pkg.pkgPath + "/" + fnode.name.value + TypeChecker.mangleTemplateParameters(templateParameterTypes);
        } else {
            f = new Function();
            fnode.scope = f.scope;
            f.type = new FunctionType();
            f.name = fnode.name.value;
        }
        f.node = fnode;
        f.loc = fnode.loc;
        f.isExported = (fnode.op == "export_func");

        if (f instanceof TemplateFunction) {
            let gt = new TemplateType();
            gt.pkg = this.pkg;
            gt.name = fnode.name.value;
            gt.node = fnode;
            gt.parentScope = parentScope;
            gt.registerScope = registerScope;
            // let scope = new Scope(parentScope);
            if (fnode.genericParameters && !templateBase) {
                for(let g of fnode.genericParameters) {
                    gt.templateParameterTypes.push(g.condition ? g.condition : null);
                    gt.templateParameterNames.push(g.value);
                }
            }
            f.type = gt;
            f.type.loc = fnode.loc;
            if (!templateType) {
                registerScope.registerElement(f.name, f);
            }
            // Do not process any further. This is done upon template instantiation
            return f;
        }

        f.scope.parent = parentScope;
        f.type.loc = fnode.loc;
        // A member function?
        if (objectType) {
            f.type.objectType = objectType;
            let p = new FunctionParameter();
            p.name = "this";
            p.loc = fnode.lhs.loc;
            p.type = objectType;
            p.isConst = true;
            f.scope.registerElement("this", p);
        }
        if (fnode.parameters) {
            for(let pnode of fnode.parameters) {
                let original_pnode = pnode;
                var p = new FunctionParameter();
                if (pnode.op == "ellipsisParam") {
                    // TODO: Ellipsis must be the last parameter
                    p.ellipsis = true;
                    pnode = pnode.lhs;
                }
                p.name = pnode.name.value;
                for(let param of f.type.parameters) {
                    if (param.name == p.name) {
                        throw new TypeError("Duplicate parameter name " + p.name, pnode.loc);
                    }
                }
                p.type = this.createType(pnode, f.scope, "parameter_toplevel");
                if (helper.isReference(p.type) || helper.isLocalReference(p.type) || helper.isString(p.type)) {
                    p.isConst = true;
                }
                if (p.ellipsis && (!(p.type instanceof SliceType) || p.type.mode != "local_reference")) {
                    throw new TypeError("Ellipsis parameters must be of a local reference slice type, i.e. &[]", pnode.loc);
                }
                this.checkVariableType(p.type, pnode.loc);
                p.loc = pnode.loc;
                f.type.parameters.push(p);
                f.scope.registerElement(p.name, p);
            }
        }
        f.hasNamedReturnVariables = false;
        // A return type?
        if (fnode.rhs) {
            f.type.returnType = this.createType(fnode.rhs, f.scope, "parameter");
            if (fnode.rhs.op == "tupleType") {
                for(let i = 0; i < fnode.rhs.parameters.length; i++) {
                    let pnode = fnode.rhs.parameters[i];
                    if (i == 0) {
                        f.hasNamedReturnVariables = !!pnode.name;
                    } else if ((f.hasNamedReturnVariables && !pnode.name) || (!f.hasNamedReturnVariables && !!pnode.name)) {
                        throw new TypeError("Either all or no return variables are named", pnode.loc);
                    }
                }
            }
            if (fnode.rhs.op == "tupleType") {
                for(let i = 0; i < fnode.rhs.parameters.length; i++) {
                    let pnode = fnode.rhs.parameters[i];
                    let v = new Variable();
                    v.isResult = true;
                    v.loc = pnode.loc;
                    if (pnode.name) {
                        v.name = pnode.name.value;
                    } else {
                        v.name = "return " + i.toString();
                    }
                    v.type = (f.type.returnType as TupleType).types[i];
                    f.scope.registerElement(v.name, v);
                    if (!f.namedReturnVariables) {
                        f.namedReturnVariables = [];
                    }
                    f.namedReturnVariables.push(v);
                    (f.type.returnType as TupleType).types[i] = v.type;
                }
            } else {
                let v = new Variable();
                v.isResult = true;
                v.loc = fnode.loc;
                v.name = "return";
                v.type = f.type.returnType;
                f.unnamedReturnVariable = v;
            }
            this.checkVariableType(f.type.returnType, fnode.rhs.loc);
        } else {
            f.type.returnType = Static.t_void;
        }

        // The function is a member function
        if (structType) {
            if (structType.methods.has(f.name)) {
                let loc = structType.methods.get(f.name).loc;
                throw new TypeError("Method " + structType.toString() + "." + f.name + " is already defined at " + loc.file + " (" + loc.start.line + "," + loc.start.column + ")", fnode.loc);
            }
            if (structType.field(f.name)) {
                throw new TypeError("Field " + structType.toString() + "." + f.name + " is already defined", fnode.loc);
            }
            structType.methods.set(f.name, f.type);
            registerScope.registerElement(TypeChecker.mangledTypeName(structType) + "." + f.name, f);
        } else {
            registerScope.registerElement(f.name, f);
            registerScope.setGroup(f, new Group(GroupKind.Free));
        }

        return f;
    }

    private createVar(vnode: Node, scope: Scope, needType: boolean = true, isConst: boolean = false, isGlobal: boolean = false): Variable {
        let v = new Variable();
        v.loc = vnode.loc;
        v.name = vnode.value;
        v.isGlobal = isGlobal;
        v.isConst = isConst;
        if (!vnode.rhs) {
            if (needType) {
                throw new TypeError("Variable declaration of " + vnode.value + " without type information", vnode.loc);
            }
        } else {
            v.type = this.createType(vnode.rhs, scope, "variable_toplevel");
            this.checkVariableType(v.type, vnode.loc);
        }
        if (v.name != "_") {
            scope.registerElement(v.name, v);
        }
        return v;
    }

    private createTypedef(tnode: Node, scope: Scope): Typedef {
        let t = new Typedef();
        t.name = tnode.name.value;
        t.node = tnode;
        t.scope = scope;

        if (t.node.genericParameters) {
            let tmpl = new TemplateType();
            tmpl.pkg = this.pkg
            tmpl.node = tnode;
            tmpl.name = t.name;
            tmpl.loc = tnode.loc;
            tmpl.parentScope = scope;
            tmpl.registerScope = scope;
            for(let g of tnode.genericParameters) {
                tmpl.templateParameterNames.push(g.value);
                tmpl.templateParameterTypes.push(g.condition ? g.condition : null);
            }
            t.type = tmpl;
            scope.registerType(t.name, tmpl, tnode.loc);
        } else if (t.node.rhs.op == "structType" || t.node.rhs.op == "opaqueType") {
            let s = new StructType();
            s.pkg = this.pkg;
            s.loc = t.node.loc;
            s.name = t.name;
            this.structs.push(s);
            t.type = s;
            scope.registerType(t.name, s, tnode.loc);
        } else if (t.node.rhs.op == "interfaceType" || t.node.rhs.op == "andType" || t.node.rhs.op == "componentInterfaceType") {
            let iface = new InterfaceType();
            iface.pkg = this.pkg;
            iface.loc = t.node.loc;
            iface.name = t.name;
            iface.isComponent = (t.node.rhs.op == "interfaceType");
            this.ifaces.push(iface);
            t.type = iface;
            scope.registerType(t.name, iface, tnode.loc);
        } else if (t.node.rhs.op == "orType") {
            let newt = new OrType();
            newt.loc = t.node.loc;
            newt.name = t.name;
            t.type = newt;
            scope.registerType(t.name, newt, tnode.loc);
        } else if (t.node.rhs.op == "arrayType") {
            let newt = new ArrayType(null, parseInt(t.node.rhs.lhs.value));
            newt.loc = t.node.loc;
            newt.name = t.name;
            t.type = newt;
            scope.registerType(t.name, newt, tnode.loc);
        } else {
            throw new TypeError("A type must be a struct, interface, array-type, or or-type", tnode.loc);
        }
        return t;
    }

    private createImport(inode: Node, scope: Scope) {
        if (inode.rhs.op == "importNative") {
            let ip: ImportedPackage;
            let importPath: string = inode.rhs.rhs.value;
            if (!inode.lhs) {
                // Syntax of the kind: import "<include.h>" { func ... }
                let name: string;
                if (inode.name) {
                    name = inode.name.value;
                } else {
                    let importPathElements = importPath.split("/");
                    // TODO: Sanitize the name
                    name = importPathElements[importPathElements.length - 1];
                }
                let pkg = new Package();
                pkg.scope = new Scope(null);
                // TODO: Sanitize the name
                ip = new ImportedPackage(name, pkg, inode.loc);
                scope.registerElement(name, ip);
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier from "<include.h>" { func ... }
                if (inode.name) {
                    throw new TypeError("An import selection must not be used together with an import alias", inode.name.loc);
                }
                let pkg = new Package();
                pkg.scope = new Scope(null);
                ip = new ImportedPackage(inode.lhs.value, pkg, inode.loc);
                scope.registerElement(ip.name, ip);
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . from "<include.h>" { func ... }
                if (inode.name) {
                    throw new TypeError("An import selection must not be used together with an import alias", inode.name.loc);
                }
                // Do nothing by intention
            } else if (inode.lhs.op == "identifierList") {
                // Syntax of the kind: import {id1, id2, ...} from "path/to/module"
                if (inode.name) {
                    throw new TypeError("An import selection must not be used together with an import alias", inode.name.loc);
                }
                // Do nothing by intention
            } else {
                throw new ImplementationError("import lhs " + inode.lhs.op)
            }
        } else {
            let importPath: string = inode.rhs.value;
            let p = Package.resolve(importPath, inode.rhs.loc);
            let ip: ImportedPackage;
            if (!inode.lhs) {
                // Syntax of the kind: import "path/to/module"
                let name: string;
                if (inode.name) {
                    name = inode.name.value;
                } else {
                    let importPathElements = importPath.split("/");
                    // TODO: Sanitize the name
                    name = importPathElements[importPathElements.length - 1];
                }
                ip = new ImportedPackage(name, p, inode.loc);
                scope.registerElement(name, ip);
            } else if (inode.lhs.op == "identifierList") {
                // Syntax of the kind: import {id1, id2, ...} from "path/to/module"
                if (inode.name) {
                    throw new TypeError("An import selection must not be used together with an import alias", inode.name.loc);
                }
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier from "path/to/module"
                ip = new ImportedPackage(inode.lhs.value, p, inode.loc);
                scope.registerElement(ip.name, ip);
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . from "path/to/module"
            } else {
                throw new ImplementationError("import lhs " + inode.lhs.op)
            }
        }
    }

    private createNativeConstImport(nativePackageName: string, node: Node, scope: Scope): Variable {
        let v: Variable = new Variable();
        v.nativePackageName = nativePackageName;
        v.name = node.name.value;
        v.node = node;
        v.loc = node.loc;
        v.type = this.createType(node.lhs, scope, "variable_toplevel");
        v.isConst = true;
        v.isGlobal = true;
        scope.registerElement(v.name, v);
        // Imported variables are considered to be free.
        // This can lead to race conditions.
        scope.setGroup(v, new Group(GroupKind.Free));
        return v;
    }

    private createNativeFunctionImport(nativePackageName: string, fnode: Node, scope: Scope): Function {
        let f: Function = new Function();
        f.nativePackageName = nativePackageName;
        f.name = fnode.name.value;
        f.scope.parent = scope;
        f.node = fnode;
        f.loc = fnode.loc;
        f.type = new FunctionType();
        f.type.callingConvention = "native";
        f.type.loc = fnode.loc;
//        f.type.callingConvention = "system";
        let i = 0;
        if (fnode.parameters) {
            for(let pnode of fnode.parameters) {
                let p = new FunctionParameter();
                p.name = "p" + i.toString();
                i++;
                p.type = this.createType(pnode, f.scope, "parameter_toplevel");
                p.loc = pnode.loc;
                f.type.parameters.push(p);
                f.scope.registerElement(p.name, p);
            }
        }
        if (fnode.rhs) {
            f.type.returnType = this.createType(fnode.rhs, f.scope, "parameter");
            if (fnode.rhs.op == "tupleType") {
                for(let i = 0; i < fnode.rhs.parameters.length; i++) {
                    let pnode = fnode.rhs.parameters[i];
                    if (pnode.name) {
                        let v = new Variable();
                        v.isResult = true;
                        v.loc = pnode.loc;
                        v.name = "p" + i.toString();
                        i++;
                        v.name = pnode.name.value;
                        v.type = (f.type.returnType as TupleType).types[i];
                        f.scope.registerElement(v.name, v);
                        if (!f.namedReturnVariables) {
                            f.namedReturnVariables = [];
                        }
                        f.namedReturnVariables.push(v);
                        (f.type.returnType as TupleType).types[i] = v.type;
                    }
                }
            } else {
                f.type.returnType = f.type.returnType;
                let v = new Variable();
                v.isResult = true;
                v.loc = fnode.loc;
                v.name = "return";
                v.type = f.type.returnType;
                f.unnamedReturnVariable = v;
            }
        } else {
            f.type.returnType = Static.t_void;
        }
        scope.registerElement(f.name, f);
        scope.setGroup(f, new Group(GroupKind.Free));
        return f;
    }

    private importTypes(inode: Node, scope: Scope) {
        if (inode.rhs.op == "importNative") {
            let ip: ImportedPackage;
            let importPath: string = inode.rhs.rhs.value;
            if (!inode.lhs) {
                // Syntax of the kind: import "native/path" { func ... }
                let importPathElements = importPath.split("/");
                let name = importPathElements[importPathElements.length - 1];
                // TODO: Sanitize the name
                let e = scope.resolveElement(name);
                if (!(e instanceof ImportedPackage)) {
                    throw new ImplementationError()
                }
                ip = e;
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier from "native/path" { func ... }
                // TODO: Sanitize the name
                let e = scope.resolveElement(inode.lhs.value);
                if (!(e instanceof ImportedPackage)) {
                    throw new ImplementationError()
                }
                ip = e;
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . from "native/path" { func ... }
            } else {
                throw new ImplementationError("import lhs " + inode.lhs.op)
            }
            for(let n of inode.rhs.parameters) {
                if (n.op == "funcType") {
                    // Do nothing by intention
                } else if (n.op == "typedef") {
                    this.typedefs.push(this.createTypedef(n, ip ? ip.pkg.scope : scope));
                } else if (n.op == "constValue") {
                    // Do nothing by intention
                } else {
                    throw new ImplementationError("import " + n.op)
                }
            }
        } else {
            let importPath: string = inode.rhs.value;
            let p = Package.resolve(importPath, inode.rhs.loc);
            let ip: ImportedPackage;
            if (!inode.lhs) {
                // Syntax of the kind: import "path/to/module"
            } else if (inode.lhs.op == "identifierList") {
                // Syntax of the kind: import (id1, id2, ...) "path/to/module"
                for(let pnode of inode.lhs.parameters) {
                    if (p.scope.types.has(pnode.value)) {
                        var t = p.scope.types.get(pnode.value);
                        scope.registerType(pnode.value, t, pnode.loc);
                    }
                }
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier "path/to/module"
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . "path/to/module"
                for(var key of p.scope.types.keys()) {
                    var t = p.scope.types.get(key);
                    scope.registerType(key, t, inode.loc);
                }
            } else {
                throw new ImplementationError("import lhs " + inode.lhs.op)
            }
        }
    }

    private importFunctionsAndVariables(inode: Node, scope: Scope) {
        if (inode.rhs.op == "importNative") {
            let ip: ImportedPackage;
            let importPath: string = inode.rhs.rhs.value;
            if (!inode.lhs) {
                // Syntax of the kind: import "native/path" { func ... }
                let importPathElements = importPath.split("/");
                let name = importPathElements[importPathElements.length - 1];
                // TODO: Sanitize the name
                let e = scope.resolveElement(name);
                if (!(e instanceof ImportedPackage)) {
                    throw new ImplementationError()
                }
                ip = e;
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier from "native/path" { func ... }
                // TODO: Sanitize the name
                let e = scope.resolveElement(inode.lhs.value);
                if (!(e instanceof ImportedPackage)) {
                    throw new ImplementationError()
                }
                ip = e;
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . from "native/path" { func ... }
            } else {
                throw new ImplementationError("import lhs " + inode.lhs.op)
            }
            for(let n of inode.rhs.parameters) {
                if (n.op == "funcType") {
                    this.createNativeFunctionImport(inode.rhs.rhs.value, n, ip ? ip.pkg.scope : scope);
                } else if (n.op == "typedef") {
                    // Do nothing by intention
                } else if (n.op == "constValue") {
                    this.createNativeConstImport(inode.rhs.rhs.value, n, ip ? ip.pkg.scope : scope);
                } else {
                    throw new ImplementationError("import " + n.op)
                }
            }
        } else {
            let importPath: string = inode.rhs.value;
            let p = Package.resolve(importPath, inode.rhs.loc);
            let ip: ImportedPackage;
            if (!inode.lhs) {
                // Syntax of the kind: import "path/to/module"
            } else if (inode.lhs.op == "identifierList") {
                // Syntax of the kind: import (id1, id2, ...) "path/to/module"
                for(let pnode of inode.lhs.parameters) {
                    if (p.scope.elements.has(pnode.value)) {
                        var el = p.scope.elements.get(pnode.value);
                        scope.registerElement(pnode.value, el, pnode.loc);
                        scope.setGroup(el, new Group(GroupKind.Free));
                    } else if (p.scope.types.has(pnode.value)) {
                        // Do nothing by intention
                    } else {
                        throw new TypeError("Unknown identifier " + pnode.value + " in package \"" + p.pkgPath + "\"", pnode.loc);
                    }
                }
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier "path/to/module"
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . "path/to/module"
                for(var key of p.scope.elements.keys()) {
                    var el = p.scope.elements.get(key);
                    scope.registerElement(key, el, inode.loc);
                    scope.setGroup(el, new Group(GroupKind.Free));
                }
            } else {
                throw new ImplementationError("import lhs " + inode.lhs.op)
            }
        }
    }

    private processBuildInstructions(snode: Node, pkg: Package) {
        if (snode.parameters) {
            for(let p of snode.parameters) {
                if (p.op == "build_link") {
                    if (p.parameters) {
                        let args: Array<string> = [];
                        for(let a of p.parameters) {
                            args.push(a.value);
                        }
                        pkg.linkCmdLineArgs = pkg.linkCmdLineArgs ? pkg.linkCmdLineArgs.concat(args) : args;
                    }
                } else if (p.op == "build_compile") {
                    if (p.parameters) {
                        let args: Array<string> = [];
                        for(let a of p.parameters) {
                            args.push(a.value);
                        }
                        pkg.compileCmdLineArgs = pkg.compileCmdLineArgs ? pkg.compileCmdLineArgs.concat(args) : args;
                    }
                } else {
                    throw new ImplementationError(snode.op)
                }
            }
        }
    }

    /**
     * The main function of the Typechecker that checks the types of an entire module.
     * However, this function just handles all imports and declares typedefs (but does not yet define them).
     *
     * Use checkModulePassTwo() and checkModulePassThree() to complete type checking.
     * The reason for splitting type checking in phases is that each phase is applied to all imported packages first,
     * before proceeding with the next phase.
     */
    public checkModule(pkg: Package): Scope {

        let scope = new Scope(null);
        scope.pkg = pkg;

        scope.registerType("bool", Static.t_bool);
        scope.registerType("float", Static.t_float);
        scope.registerType("double", Static.t_double);
        scope.registerType("null", Static.t_null);
        scope.registerType("byte", Static.t_byte);
        scope.registerType("char", Static.t_char);
        scope.registerType("int8", Static.t_int8);
        scope.registerType("int16", Static.t_int16);
        scope.registerType("int32", Static.t_int32);
        scope.registerType("int64", Static.t_int64);
        scope.registerType("int", Static.t_int);
        scope.registerType("uint8", Static.t_uint8);
        scope.registerType("uint16", Static.t_uint16);
        scope.registerType("uint32", Static.t_uint32);
        scope.registerType("uint64", Static.t_uint64);
        scope.registerType("uint", Static.t_uint);
        scope.registerType("string", Static.t_string);
        scope.registerType("void", Static.t_void);
        scope.registerType("error", Static.t_error);
        scope.registerType("rune", Static.t_rune);
        scope.registerType("coroutine", Static.t_coroutine);
        pkg.pkgNode.scope = scope;
        this.moduleNode = pkg.pkgNode;

        // Iterate over all files and process all imports
        for(let fnode of this.moduleNode.statements) {
            fnode.scope = new Scope(scope);
            for (let snode of fnode.statements) {
                if (snode.op == "import") {
                    this.createImport(snode, fnode.scope);
                } else if (snode.op == "build") {
                    this.processBuildInstructions(snode, pkg);
                }
            }
        }

        // Iterate over all files and declare all types.
        // The body of structs and interfaces is processed after all types are declared,
        // because types can reference themselves or each other cross-wise.
        for(let fnode of this.moduleNode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "typedef") {
                    let t = this.createTypedef(snode, scope);
                    this.typedefs.push(t);
                }
            }
        }

        return scope;
    }

    /**
     * Imports types from other modules, defines typedefs, defines global variables
     * and declares functions.
     */
    public checkModulePassTwo() {
        let scope = this.moduleNode.scope;

        // Iterate over all files and process all imports
        for(let fnode of this.moduleNode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "import") {
                    this.importTypes(snode, fnode.scope);
                }
            }
        }

        // Define all types which have been declared before
        for(let t of this.typedefs) {
            if (t.type instanceof StructType) {
                this.createStructType(t.node.rhs, t.scope, t.type);
            } else if (t.type instanceof InterfaceType) {
                this.createInterfaceType(t.node.rhs, t.scope, t.type);
            } else if (t.type instanceof OrType) {
                this.createOrType(t.node.rhs, t.scope, t.type);
            } else if (t.type instanceof ArrayType) {
                this.createArrayType(t.node.rhs, t.scope, t.type);
            }
        }

        // Iterate over all files and declare all functions and global variables.
        for(let fnode of this.moduleNode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "func" || snode.op == "export_func") {
                    let f = this.createFunction(snode, fnode.scope, scope);
                    if (f instanceof Function) {
                        this.functions.push(f);
                    }
                } else if (snode.op == "var") {
                    let v = this.createVar(snode.lhs, scope, false, false, true);
                    v.node = snode;
                    this.globalVariables.push(v);
                } else if (snode.op == "let") {
                    let v = this.createVar(snode.lhs, scope, false, true, true);
                    v.node = snode;
                    this.globalVariables.push(v);
                } else if (snode.op == "import") {
                    // Do nothing by intention
                } else if (snode.op == "typedef") {
                    // Do nothing by intention
                } else if (snode.op == "comment") {
                    // Do nothing by intention
                } else if (snode.op == "build") {
                    // Do nothing by intention
                } else if (snode.op == "export_as") {
                    // Do nothing by intention
                } else {
                    throw new ImplementationError(snode.op)
                }
            }
        }
    }

    /**
     * Imports functions from other modules, checks interfaces and structs for errors,
     * checks global variables.
     */
    public checkModulePassThree() {
        let scope = this.moduleNode.scope;

        // Iterate over all files and process all imports for functions and variables
        for(let fnode of this.moduleNode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "import") {
                    this.importFunctionsAndVariables(snode, fnode.scope);
                }
            }
        }

        // Check all interfaces for conflicting names
        for(let iface of this.ifaces) {
            this.checkInterfaceType(iface);
        }

        // Check all structs for conflicting names and whether they implement the promised interfaces
        for(let s of this.structs) {
            this.checkStructType(s);
        }

        // Check global variable assignments and determine the type of the global variables
        for(let v of this.globalVariables) {
            // Unique global pointers are subject to their own group.
            // All other global variables belong to the same group.
            if (helper.isUnique(v.type)) {
                scope.setGroup(v, new Group(GroupKind.Free, v.name));
            } else {
                scope.setGroup(v, this.globalGroup);
            }
            this.checkGlobalVariable(v, scope);
        }

        // Rename elements for export
        for(let fnode of this.moduleNode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "export_as") {
                    for(let exp of snode.parameters) {
                        if (exp.op == "exportFuncAs" || exp.op == "exportConstAs" || exp.op == "exportVarAs") {
                            let e = fnode.scope.resolveElement(exp.lhs.value);
                            if (!e) {
                                throw new TypeError("Unknown function/const/variable " + exp.lhs.value, exp.loc);
                            }
                            if (exp.lhs.value != exp.rhs.value) {
                                if (scope.resolveElement(exp.rhs.value)) {
                                    throw new TypeError("A function/const/variable of name " + exp.rhs.value + " is already exported", exp.rhs.loc);
                                }
                                scope.registerElement(exp.rhs.value, e, exp.loc);
                            }
                        } else if (exp.op == "exportTypeAs") {
                            let t = fnode.scope.resolveType(exp.lhs.value);
                            if (!t) {
                                throw new TypeError("Unknown type " + exp.lhs.value, exp.loc);
                            }
                            if (exp.lhs.value != exp.rhs.value) {
                                if (scope.resolveType(exp.rhs.value)) {
                                    throw new TypeError("A type of name " + exp.rhs.value + " is already exported", exp.rhs.loc);
                                }
                                scope.registerType(exp.rhs.value, t, exp.loc);
                            }
                        } else {
                            throw new ImplementationError(exp.op)
                        }
                    }
                }
            }
        }
    }

    /**
     * Checks all function bodies
     */
    public checkModulePassFour() {
        // Check function bodies
        for(let e of this.functions) {
            this.checkFunctionBody(e);
        }

        // Determine which functions could block and hence needs special coroutine treatment.
        /*
        let changes = false;
        do {
            for(let f of this.callGraph.keys()) {
                if (f.type.callingConvention == "fyrCoroutine") {
                    continue;
                }
                if (!this.callGraph.has(f)) {
                    continue;
                }
                let arr = this.callGraph.get(f);
                for(let a of arr) {
                    if (a.callingConvention == "fyrCoroutine") {
                        f.type.callingConvention = "fyrCoroutine";
                        changes = true;
                        break;
                    }
                }
            }
        } while(changes);
        */
    }

    /**
     * Typecheck the template function body.
     */
    private checkFunctionBody(f: Function) {
        let scopeExit: ScopeExit;
        if (f.node.statements) {
            scopeExit = this.checkStatements(f.node.statements, f.scope);
        } else {
            scopeExit = new ScopeExit();
            scopeExit.fallthrough = f.scope;
        }
        let needsReturn = !!f.node.rhs;
        if (needsReturn) {
            if (scopeExit.fallthrough) {
                throw new TypeError("Missing return at end of function", f.loc);
            }
        }
        this.checkGroupsInFunction(f);
    }

    public checkVarAssignment(isConst: boolean, scope: Scope, vnode: Node, rtype: Type, rnode: Node = null) {
        // TODO: const and box are not handled properly here
        if (vnode.op == "id" || vnode.op == "optionalId") {
            let v = this.createVar(vnode, scope, false, isConst);
            if (!v.type) {
                if (rtype instanceof PackageType) {
                    throw new TypeError("Package types cannot be assigned", vnode.loc);
                }
                if (rtype instanceof ArrayLiteralType || rtype instanceof TupleLiteralType || rtype instanceof ObjectLiteralType) {
                    v.type = this.defaultLiteralType(rnode);
                } else {
                    v.type = rtype;
                }
            } else {
                if (rnode) {
                    this.checkIsAssignableNode(v.type, rnode, scope);
                } else {
                    this.checkIsAssignableType(v.type, rtype, vnode.loc, "assign", true);
                }
            }
            if (isConst && rnode && (rnode.op == "array" || rnode.op == "object")) {
                v.isNotNull = true;
            }
            vnode.type = v.type;
        } else if (vnode.op == "tuple") {
            let rtypeStripped = RestrictedType.strip(rtype);
            if (!(rtypeStripped instanceof TupleType) && !(rtypeStripped instanceof TupleLiteralType)) {
                throw new TypeError("Expected tuple expression or json on right hand side", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (i >= rtypeStripped.types.length) {
                    throw new TypeError("Mismatch in tuple type length", vnode.loc);
                }
                let p = vnode.parameters[i];
                if (p.op == "optionalId") {
                    throw new TypeError("Optional identifiers are not allowed in tuple context", vnode.loc);
                } else if (p.op == "ellipsisId") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in tuple", vnode.loc);
                    }
                    hasEllipsis = true;
                    let v = this.createVar(p, scope, false, isConst);
                    if (!v.type) {
                        v.type = new TupleType(rtypeStripped.types.slice(i));
                        if (isConst) {
                            v.type = new RestrictedType(v.type, {isConst: true});
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (!(lt instanceof TupleType)) {
                            throw new TypeError("Ellipsis identifier in a tuple context must be of tuple type", vnode.loc);
                        }
                        if (lt.types.length != rtypeStripped.types.length - i) {
                            throw new TypeError("Mismatch in tuple type length", vnode.loc);
                        }
                        if (rnode && rnode.op == "tuple") {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                let r = rnode.parameters[j];
                                this.checkIsAssignableNode(lt.types[j-i], r, scope);
                            }
                        } else {
                            let t = new TupleType(rtypeStripped.types.slice(i));
                            this.checkIsAssignableType(v.type, t, vnode.loc, "assign", true);
                        }
                    }
                    break;
                } else {
                    let r: Node;
                    if (rnode && rnode.op == "tuple") {
                        r = rnode.parameters[i];
                    }
                    this.checkVarAssignment(isConst, scope, p, rtypeStripped.types[i], r);
                }
            }
            if (!hasEllipsis && rtypeStripped.types.length != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "array") {
            let rtypeStripped = RestrictedType.strip(rtype);
            if (!(rtypeStripped instanceof ArrayLiteralType) && !(rtypeStripped instanceof ArrayType) && !(rtypeStripped instanceof SliceType)) {
                throw new TypeError("Expected an expression of array type or slice type", vnode.loc);
            }
            let hasEllipsis = false;
            let hasOptional = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (rtypeStripped instanceof ArrayType && i >= rtypeStripped.size) {
                    throw new TypeError("Mismatch in array type length", vnode.loc);
                }
                let p = vnode.parameters[i];
                if (p.op == "ellipsisId") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in array", vnode.loc);
                    }
                    hasEllipsis = true;
                    let v = this.createVar(p, scope, false, isConst);
                    if (!v.type) {
                        if (rtypeStripped instanceof ArrayLiteralType) {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                // TODO: Check that all elements of the array have the same type
//                                this.checkIsAssignableNode(Static.t_json, rnode.parameters[j]);
//                                rtype.types[j] = rnode.parameters[j].type;
                            }
//                            v.type = new SliceType(Static.t_json);
                            throw new TodoError()
                        } else if (rtypeStripped instanceof ArrayType) {
                            v.type = new ArrayType(rtypeStripped.elementType, rtypeStripped.size - i);
                            // TODO: Check whether the array slice can be copied at all
                            // TODO: Clone the restrictions of the array
                            throw new TodoError()
                        } else if (rtypeStripped instanceof SliceType) {
                            // TODO: Clone the restrictions of the array
                            v.type = rtype;
                            throw new TodoError()
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (rtypeStripped instanceof ArrayLiteralType) {
                            let rt: Type;
                            if (lt instanceof ArrayType) {
                                if (rtypeStripped.types.length - i != lt.size) {
                                    throw new TypeError("Mismatch in array type length", vnode.loc);
                                }
                                rt = lt.elementType;
                            } else if (lt instanceof SliceType) {
                                rt = lt.getElementType();
                            } else {
                                throw new TypeError("Ellipsis identifier must be of array type, slice type, string or json", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j], scope);
                            }
                        } else if (rtypeStripped instanceof ArrayType) {
                            if (!(lt instanceof ArrayType)) {
                                throw new TypeError("Ellipsis identifier must be of array type", vnode.loc);
                            }
                            if (lt.size != rtypeStripped.size - i) {
                                throw new TypeError("Mismatch in array size", vnode.loc);
                            }
                            this.checkIsAssignableType(lt.elementType, rtypeStripped.elementType, vnode.loc, "assign", true);
                        } else if (rtypeStripped instanceof SliceType) {
                            if (!(lt instanceof SliceType)) {
                                throw new TypeError("Ellipsis identifier must be of slice type", vnode.loc);
                            }
                            this.checkIsAssignableType(lt.getElementType(), rtypeStripped.getElementType(), vnode.loc, "assign", true);
                        }
                    }
                    break;
                } else {
                    if (p.op == "optionalId") {
                        if (rtype instanceof ArrayType || rtype instanceof ArrayLiteralType) {
                            throw new TypeError("Optional identifiers are not allowed in array context", vnode.loc);
                        }
                        hasOptional = true;
                    } else {
                        if (hasOptional) {
                            throw new TypeError("Non-optional identifier is not allowed after optional identifiers", vnode.loc);
                        }
                    }
                    let r: Node;
                    let rt: Type;
                    if (rtype instanceof ArrayLiteralType) {
                        rt = rtype.types[i];
                        r = rnode.parameters[i];
                    } else if (rtype instanceof ArrayType || rtype instanceof SliceType) {
                        rt = rtype.getElementType();
                    }
                    this.checkVarAssignment(isConst, scope, p, rt, r);
                }
            }
            if (!hasEllipsis && rtype instanceof ArrayType && rtype.size != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "object") {
            let rtypeStripped = RestrictedType.strip(rtype);
            if (!(rtypeStripped instanceof ObjectLiteralType) && (!helper.isMap(rtypeStripped) || helper.isString(this.mapKeyType(rtypeStripped)))) {
                throw new TypeError("Expected an expression of type object literal or map[string]...", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                let kv = vnode.parameters[i];
                if (kv.op == "ellipsisId") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in object", vnode.loc);
                    }
                    hasEllipsis = true;
                    let v = this.createVar(kv, scope, false, isConst);
                    if (!v.type) {
                        if (rtypeStripped instanceof ObjectLiteralType) {
                            let valueType: Type = null; // TODO
                            for(let j = i; j < rnode.parameters.length; j++) {
//                                this.checkIsAssignableNode(Static.t_json, rnode.parameters[j].lhs);
                            }
                            v.type = new PointerType(new MapType(Static.t_string, valueType), "strong");
                            throw new TodoError()
                        } else if (rtypeStripped instanceof TemplateStructType) {
                            v.type = rtype;
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (rtypeStripped instanceof ObjectLiteralType) {
                            let rt: Type;
                            if (helper.isMap(lt) && helper.isString(this.mapKeyType(lt))) {
                                rt = this.mapValueType(lt);
                            } else {
                                throw new TypeError("Ellipsis identifier must be of map type", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j].lhs, scope);
                            }
                        } else if (helper.isMap(rtypeStripped)) {
                            if (!helper.isMap(lt) || !helper.isString(this.mapKeyType(lt))) {
                                throw new TypeError("Ellipsis identifier must be of type map<string, ...>", vnode.loc);
                            }
                            this.checkIsAssignableType(this.mapKeyType(lt), this.mapValueType(rtypeStripped), vnode.loc, "assign", true);
                        }
                    }
                } else {
                    let p = kv.lhs;
                    let name = kv.name.value;
                    let optional = (kv.op == "optionalKeyValue");
                    let r: Node;
                    let rt: Type;
                    if (rtype instanceof ObjectLiteralType) {
                        if (!optional && !rtype.types.has(name)) {
                            throw new TypeError("Object literal has no key '" + name + "'", p.loc);
                        }
                        rt = rtype.types.get(name);
                        r = rnode.parameters[i].lhs;
                        throw new TodoError("Find matching node in literal")
                    } else if (helper.isMap(rtype)) {
                        rt = this.mapValueType(rtype);
                    }
                    this.checkVarAssignment(isConst, scope, p, rt, r);
                }
            }
        }
    }

    public checkAssignment(scope: Scope, vnode: Node, rtype: Type, rnode: Node = null) {
        let rtypeStripped = RestrictedType.strip(rtype);
        if (vnode.op == "tuple") {
            if (!(rtypeStripped instanceof TupleType) && !(rtypeStripped instanceof TupleLiteralType)) {
                throw new TypeError("Expected tuple expression on right hand side", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (i >= rtypeStripped.types.length) {
                    throw new TypeError("Mismatch in tuple type length", vnode.loc);
                }
                let p = vnode.parameters[i];
                if (p.op == "optionalAssign") {
                    throw new TypeError("Optional identifiers are not allowed in tuple context", vnode.loc);
                } else if (p.op == "ellipsisAssign") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in tuple", vnode.loc);
                    }
                    this.checkExpression(p.lhs, scope);
                    this.checkIsAssignable(p.lhs, scope);
                    hasEllipsis = true;
                    if (!(p.lhs.type instanceof TupleType)) {
                        throw new TypeError("Ellipsis identifier in a tuple context must be of tuple type", vnode.loc);
                    }
                    if (p.lhs.type.types.length != rtypeStripped.types.length - i) {
                        throw new TypeError("Mismatch in tuple type length", vnode.loc);
                    }
                    if (rnode && rnode.op == "tuple") {
                        for(let j = i; j < rnode.parameters.length; j++) {
                            let r = rnode.parameters[j];
                            this.checkIsAssignableNode(p.lhs.type.types[j-i], r, scope);
                        }
                    } else {
                        let t = new TupleType(rtypeStripped.types.slice(i));
                        this.checkIsAssignableType(p.lhs.type, t, vnode.loc, "assign", true);
                    }
                    break;
                } else {
                    let r: Node;
                    if (rnode && rnode.op == "tuple") {
                        r = rnode.parameters[i];
                    }
                    this.checkAssignment(scope, p, rtypeStripped.types[i], r);
                }
            }
            if (!hasEllipsis && rtypeStripped.types.length != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
            // The type of the right-hand side might have been inferred. In this case, compute the new type
            if (rnode && rnode.op == "tuple") {
                let types: Array<Type> = [];
                for(let p of rnode.parameters) {
                    types.push(p.type);
                }
                rnode.type = new TupleType(types);
            }
        } else if (vnode.op == "array") {
            if (!(rtypeStripped instanceof ArrayLiteralType) && !(rtypeStripped instanceof ArrayType) && !(rtypeStripped instanceof SliceType)) {
                throw new TypeError("Expected an expression of array type or slice type", vnode.loc);
            }
            let hasEllipsis = false;
            let hasOptional = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (rtypeStripped instanceof ArrayType && i >= rtypeStripped.size) {
                    throw new TypeError("Mismatch in array type length", vnode.loc);
                }
                let p = vnode.parameters[i];
                if (p.op == "ellipsisAssign") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in array", vnode.loc);
                    }
                    hasEllipsis = true;
                    this.checkExpression(p.lhs, scope);
                    this.checkIsAssignable(p.lhs, scope);
                    if (rtypeStripped instanceof ArrayLiteralType) {
                        let rt: Type;
                        if (p.lhs.type instanceof ArrayType) {
                            if (rtypeStripped.types.length - i != p.lhs.type.size) {
                                throw new TypeError("Mismatch in array type length", vnode.loc);
                            }
                            rt = p.lhs.type.elementType;
                        } else if (p.lhs.type instanceof SliceType) {
                            rt = p.lhs.type.getElementType();
                        } else {
                            throw new TypeError("Ellipsis identifier must be of array type or slice type", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j], scope);
                        }
                    } else if (rtypeStripped instanceof ArrayType) {
                        if (!(p.lhs.type instanceof ArrayType)) {
                            throw new TypeError("Ellipsis identifier must be of array type", vnode.loc);
                        }
                        if (p.lhs.type.size != rtypeStripped.size - i) {
                            throw new TypeError("Mismatch in array size", vnode.loc);
                        }
                        this.checkIsAssignableType(p.lhs.type.elementType, rtypeStripped.elementType, vnode.loc, "assign", true);
                    } else if (rtype instanceof SliceType) {
                        if (!(p.lhs.type instanceof SliceType)) {
                            throw new TypeError("Ellipsis identifier must be of slice type", vnode.loc);
                        }
                        this.checkIsAssignableType(p.lhs.type.getElementType(), rtypeStripped.getElementType(), vnode.loc, "assign", true);
                    }
                    break;
                } else {
                    if (p.op == "optionalAssign") {
                        if (rtypeStripped instanceof ArrayType || rtypeStripped instanceof ArrayLiteralType) {
                            throw new TypeError("Optional identifiers are not allowed in array context", vnode.loc);
                        }
                        hasOptional = true;
                    } else {
                        if (hasOptional) {
                            throw new TypeError("Non-optional identifier is not allowed after optional identifiers", vnode.loc);
                        }
                    }
                    let r: Node;
                    let rt: Type;
                    if (rtype instanceof ArrayLiteralType) {
                        rt = rtype.types[i];
                        r = rnode.parameters[i];
                    } else if (rtype instanceof ArrayType || rtype instanceof SliceType) {
                        rt = rtype.getElementType();
                    }
                    this.checkAssignment(scope, p, rt, r);
                }
            }
            if (!hasEllipsis && rtype instanceof ArrayType && rtype.size != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "object") {
            if (!(rtypeStripped instanceof ObjectLiteralType) && (!helper.isMap(rtype) || !helper.isString(this.mapKeyType(rtype)))) {
                throw new TypeError("Expected an expression of type object literal or map[string]...", vnode.loc);
            }
            for (let i = 0; i < vnode.parameters.length; i++) {
                let kv = vnode.parameters[i];
                if (kv.op == "ellipsisAssign") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in object", vnode.loc);
                    }
                    this.checkExpression(kv.lhs, scope);
                    this.checkIsAssignable(kv.lhs, scope);
                    if (rtype instanceof ObjectLiteralType) {
                        let rt: Type;
                        if (helper.isMap(kv.lhs.type) && helper.isString(this.mapKeyType(kv.lhs.type))) {
                            rt = this.mapValueType(kv.lhs.type);
                        } else {
                            throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j].lhs, scope);
                        }
                    } else if (helper.isMap(rtypeStripped)) {
                        if (!helper.isMap(kv.lhs.type) || !helper.isString(this.mapKeyType(kv.lhs.type))) {
                            throw new TypeError("Ellipsis identifier must be of type map[string]...", vnode.loc);
                        }
                        this.checkIsAssignableType(this.mapKeyType(kv.lhs.type), this.mapValueType(rtypeStripped), vnode.loc, "assign", true);
                    }
                } else {
                    let p = kv.lhs;
                    let name = kv.name.value;
                    let optional = (p.op == "optionalKeyValue");
                    let r: Node;
                    let rt: Type;
                    if (rtypeStripped instanceof ObjectLiteralType) {
                        if (!optional && !rtypeStripped.types.has(name)) {
                            throw new TypeError("Object literal has no key '" + name + "'", p.loc);
                        }
                        rt = rtypeStripped.types.get(name);
                        r = rnode.parameters[i].lhs;
                        throw new TodoError("Find matching node in literal")
                    } else if (helper.isMap(rtypeStripped)) {
                        rt = this.mapValueType(rtypeStripped);
                    }
                    this.checkAssignment(scope, p, rt, r);
                }
            }
        } else {
            this.checkExpression(vnode, scope);
            this.checkIsAssignable(vnode, scope);
            if (rnode) {
                this.checkIsAssignableNode(vnode.type, rnode, scope);
            } else {
                this.checkIsAssignableType(vnode.type, rtype, vnode.loc, "assign", true);
            }
        }
    }

    private checkStatements(statements: Array<Node>, scope: Scope): ScopeExit {
        let scopeExit: ScopeExit = new ScopeExit();
        scopeExit.fallthrough = scope;
        for(let i = 0; i < statements.length; i++) {
            let st = statements[i];
            this.checkStatement(st, scope, scopeExit);
        }
        return scopeExit;
    }

    public checkStatement(snode: Node, scope: Scope, scopeExit: ScopeExit): void {
        if (snode.op == "comment") {
            return;
        }
        if (!scopeExit.fallthrough) {
            throw new TypeError("Unreachable code", snode.loc);
        }
        switch (snode.op) {
            case "return":
                let f = scope.envelopingFunction();
                if (!f) {
                    throw new TypeError("'return' outside of function body", snode.loc);
                }
                if (!snode.lhs) {
                    if (f.type.returnType != Static.t_void && !f.hasNamedReturnVariables) {
                        throw new TypeError("Mismatch in return type", snode.loc);
                    }
                } else {
                    this.checkExpression(snode.lhs, scope);
                    this.checkIsAssignableNode(f.type.returnType, snode.lhs, scope);
                }
                if (!scopeExit.returns) scopeExit.returns = [];
                scopeExit.returns.push(scope);
                scopeExit.fallthrough = null;
                return;
            case "break":
                if (!scope.isInForLoop()) {
                    throw new TypeError("'break' outside of loop", snode.loc);
                }
                if (!scopeExit.breaks) scopeExit.breaks = [];
                scopeExit.breaks.push(scope);
                scopeExit.fallthrough = null;
                return;
            case "continue":
                if (!scope.isInForLoop()) {
                    throw new TypeError("'continue' outside of loop", snode.loc);
                }
                if (!scopeExit.continues) scopeExit.continues = [];
                scopeExit.continues.push(scope);
                scopeExit.fallthrough = null;
                return;
            case "if":
            {
                let s: Scope;
                // Assignment in the if-clause?
                if (snode.lhs) {
                    snode.lhs.scope = new Scope(scope)
                    let initScopeExit = new ScopeExit();
                    initScopeExit.fallthrough = scope;
                    this.checkStatement(snode.lhs, snode.lhs.scope, initScopeExit);
                    if (initScopeExit.returns || initScopeExit.breaks || initScopeExit.continues) {
                        throw new TypeError("break, return and continue are not allowed inside the initialization statement of an if clause.", snode.loc);
                    }
                    // initScopeExit can be ignored furtheron, since it does neither return nor break or continue.
                    s = new Scope(snode.lhs.scope);
                } else {
                    s = new Scope(scope);
                }
                snode.scope = s;
                // Check the if-clause
                this.checkExpression(snode.condition, s);
                this.checkIsAssignableType(Static.t_bool, snode.condition.type, snode.condition.loc, "assign", true);
                if (snode.condition.op == "bool" && snode.condition.value == "false") {
                    // Do not type check the if-clause, because it does not execute
                    snode.statements = [];
                }
                snode.scopeExit = this.checkStatements(snode.statements, s);
                scopeExit.merge(snode.scopeExit);
                // Check the else clause
                if (snode.elseBranch) {
                    this.checkStatement(snode.elseBranch, scope, scopeExit);
                    scopeExit.merge(snode.elseBranch.scopeExit);
                    if (!snode.scopeExit.fallthrough && !snode.elseBranch.scopeExit.fallthrough && snode.elseBranch.op == "else") {
                        scopeExit.fallthrough = null;
                    }
                }
                return;
            }
            case "else":
            {
                let s = new Scope(scope);
                snode.scope = s;
                snode.scopeExit = this.checkStatements(snode.statements, s);
                scopeExit.merge(snode.scopeExit);
                return;
            }
            case "for":
            {
                let forScope: Scope;
                if (snode.condition) {
                    snode.condition.scope = new Scope(scope);
                    if (snode.condition.op == ";;") {
                        if (snode.condition.lhs) {
                            let initScopeExit = new ScopeExit();
                            initScopeExit.fallthrough = scope;
                            this.checkStatement(snode.condition.lhs, snode.condition.scope, initScopeExit);
                            if (initScopeExit.returns || initScopeExit.breaks || initScopeExit.continues) {
                                throw new TypeError("break, return and continue are not allowed inside the initialization statement of a for loop.", snode.loc);
                            }
                        }
                        if (snode.condition.condition) {
                            this.checkExpression(snode.condition.condition, snode.condition.scope);
                            this.checkIsAssignableType(Static.t_bool, snode.condition.condition.type, snode.condition.condition.loc, "assign", true);
                        }
                        if (snode.condition.rhs) {
                            let loopScopeExit = new ScopeExit();
                            loopScopeExit.fallthrough = scope;
                            this.checkStatement(snode.condition.rhs, snode.condition.scope, loopScopeExit);
                            if (loopScopeExit.returns || loopScopeExit.breaks || loopScopeExit.continues) {
                                throw new TypeError("break, return and continue are not allowed inside the loop statement of a for loop.", snode.loc);
                            }
                        }
                    } else {
                        this.checkStatement(snode.condition, snode.condition.scope, scopeExit);
                    }
                    forScope = new Scope(snode.condition.scope);
                } else {
                    forScope = new Scope(scope);
                }
                forScope.forLoop = true;
                snode.scope = forScope;
                snode.scopeExit = this.checkStatements(snode.statements, forScope);
                scopeExit.merge(snode.scopeExit, true);
                return;
            }
            case "var":
            case "let":
                if (!snode.rhs) {
                    if (snode.op == "let") {
                        throw new ImplementationError("let without initialization")
                    }
                    if (snode.lhs.op == "id") {
                        let v = this.createVar(snode.lhs, scope, true);
                        snode.lhs.type = v.type;
                    } else if (snode.lhs.op == "tuple") {
                        for (let p of snode.lhs.parameters) {
                            let v = this.createVar(p, scope, true);
                            p.type = v.type;
                        }
                    } else {
                        throw new TodoError("Implementation error")
                    }
                } else {
                    this.checkExpression(snode.rhs, scope);
                    this.checkVarAssignment(snode.op == "let", scope, snode.lhs, snode.rhs.type, snode.rhs);
                    if (TypeChecker.hasLocalReference(snode.rhs.type)) {
                        throw new TypeError("Right hand side of assignment must not be a local reference", snode.rhs.loc);
                    }
                }
                break;
            case "=":
                this.checkExpression(snode.rhs, scope);
                this.checkAssignment(scope, snode.lhs, snode.rhs.type, snode.rhs);
                if (TypeChecker.hasLocalReference(snode.rhs.type)) {
                    throw new TypeError("Right hand side of assignment must not be a local reference", snode.rhs.loc);
                }
            break;
            case "+=":
            case "*=":
            case "/=":
            case "-=":
                this.checkExpression(snode.lhs, scope);
                this.checkIsAssignable(snode.lhs, scope);
                this.checkExpression(snode.rhs, scope);
                if (snode.op == "+=" && helper.isString(snode.lhs.type)) {
                    this.checkIsString(snode.rhs);
                } else if (helper.isUnsafePointer(snode.lhs.type)) {
                    if (snode.op == "*=" || snode.op == "/=") {
                        throw new TypeError("'" + snode.op + "' is an invalid operation on pointers", snode.loc);
                    }
                    this.checkIsIntNumber(snode.rhs);
                } else {
                    this.checkIsNumber(snode.lhs);
                    this.checkIsNumber(snode.rhs);
                    if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, scope, snode.loc);
                    } else {
                        this.checkIsAssignableType(snode.lhs.type, snode.rhs.type, snode.loc, "assign", true);
                    }
                }
                break;
            case "<<=":
            case ">>=":
            {
                this.checkExpression(snode.lhs, scope);
                this.checkIsAssignable(snode.lhs, scope);
                this.checkExpression(snode.rhs, scope);
                if (helper.isUnsafePointer(snode.lhs.type)) {
                    if (snode.rhs.op == "int") {
                        this.unifyLiterals(Static.t_uint, snode.rhs, scope, snode.loc);
                    } else {
                        this.checkIsAssignableType(Static.t_uint, snode.rhs.type, snode.loc, "assign", true);
                    }
                } else {
                    this.checkIsIntNumber(snode.lhs);
                    if (snode.rhs.op == "int") {
                        this.unifyLiterals(Static.t_uint, snode.rhs, scope, snode.loc);
                    } else {
                        this.checkIsAssignableType(Static.t_uint, snode.rhs.type, snode.loc, "assign", true);
                    }
                }
                break;
            }
            case "%=":
            case "&=":
            case "&^=":
            case "|=":
            case "^=":
                this.checkExpression(snode.lhs, scope);
                this.checkIsAssignable(snode.lhs, scope);
                this.checkExpression(snode.rhs, scope);
                if (helper.isUnsafePointer(snode.lhs.type)) {
                    if (snode.op == "%=") {
                        throw new TypeError("'%=' is an invalid operation on pointers", snode.loc);
                    }
                    if (snode.rhs.op == "int") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, scope, snode.loc);
                    } else {
                        this.checkIsAssignableType(Static.t_int, snode.rhs.type, snode.loc, "assign", true);
                    }
                } else {
                    this.checkIsIntNumber(snode.lhs);
                    this.checkIsIntNumber(snode.rhs);
                    if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, scope, snode.loc);
                    } else {
                        this.checkIsAssignableType(snode.lhs.type, snode.rhs.type, snode.loc, "assign", true);
                    }
                }
                break;
                /*
            case "in":
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
//                    if (snode.lhs.parameters[0].op != "id" || snode.lhs.parameters[0].value != "_") {
                    if (snode.lhs.parameters[0].value != "_") {
                        this.checkExpression(snode.lhs.parameters[0], scope);
                        this.checkIsMutable(snode.lhs.parameters[0], scope);
                        this.checkIsAssignableType(snode.lhs.parameters[0].type, tindex1, snode.loc, "assign", true);
                    }
                    if (snode.lhs.parameters[1].value != "_") {
                        this.checkExpression(snode.lhs.parameters[1], scope);
                        this.checkIsMutable(snode.lhs.parameters[1], scope);
                        this.checkIsAssignableType(snode.lhs.parameters[1].type, tindex2, snode.loc, "assign", true);
                    }
                } else {
                    if (snode.lhs.value != "_") {
                        this.checkExpression(snode.lhs, scope);
                        this.checkIsMutable(snode.lhs, scope);
                        this.checkIsAssignableType(snode.lhs.type, tindex1, snode.loc, "assign", true);
                    }
                }
                break; */
            case "let_in":
            {
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
                    if (snode.lhs.parameters[0].value != "_") {
                        let v1 = this.createVar(snode.lhs.parameters[0], scope, false, true);
                        if (v1.type) {
                            this.checkIsAssignableType(v1.type, tindex1, snode.loc, "assign", true);
                        } else {
                            v1.type = tindex1
                        }
                    }
                    if (snode.lhs.parameters[1].value != "_") {
                        let v2 = this.createVar(snode.lhs.parameters[1], scope, false, true);
                        if (v2.type) {
                            this.checkIsAssignableType(v2.type, tindex2, snode.loc, "assign", true);
                        } else {
                            v2.type = tindex2;
                        }
//                        if (v2.type != Static.t_string) {
                            v2.isForLoopPointer = true;
//                        }
                    }
                } else {
                    let v = this.createVar(snode.lhs, scope, false, true);
                    if (v.type) {
                        this.checkIsAssignableType(v.type, tindex1, snode.loc, "assign", true);
                    } else {
                        v.type = tindex1;
                    }
//                    if (v.type != Static.t_string) {
                        v.isForLoopPointer = true;
//                    }
                }
                break;
            }
            case "yield":
                break;
            case "yield_continue":
                break;
            case "spawn":
            {
                this.checkExpression(snode.rhs, scope);
                if (snode.rhs.op != "(") {
                    throw new ImplementationError()
                }
                if (!(snode.rhs.lhs.type instanceof FunctionType)) {
                    throw new ImplementationError()
                }
                if ((snode.rhs.lhs.type as FunctionType).returnType != Static.t_void) {
                    throw new TypeError("Functions invoked via 'spawn' must return void", snode.loc);
                }
                // Functions invoked via `spawn` must not accept local references.
                for(let p of (snode.rhs.lhs.type as FunctionType).parameters) {
                    if (helper.isLocalReference(p.type)) {
                        throw new TypeError("Functions invoked via 'spawn' must not use local references in parameter types", p.loc);
                    }
                }
                if (snode.rhs.lhs.op == "." && !helper.isSafePointer(snode.rhs.lhs.lhs.type)) {
                    throw new TypeError("Function calls via 'spawn' must use a pointer to the object", snode.loc);
                }
                if (snode.rhs.lhs.op == "." && helper.isLocalReference(snode.rhs.lhs.lhs.type)) {
                    throw new TypeError("Function calls via 'spawn' must use not use a local-pointer to the object ", snode.loc);
                }
                break;
            }
            case "copy":
            case "move":
                this.checkExpression(snode.lhs, scope);
                this.checkExpression(snode.rhs, scope);
                if (!helper.isSlice(snode.lhs.type) || !helper.isSlice(snode.rhs.type)) {
                    throw new TypeError("'" + snode.op + "' is only allowed on slices", snode.loc);
                }
                let t = RestrictedType.strip(snode.lhs.type) as SliceType;
                let e = RestrictedType.strip(t.getElementType());
                if (helper.isConst(snode.lhs.type)) {
                    throw new TypeError("'" + snode.op + "' requires a non-const slice as its first argument", snode.lhs.loc);
                }
                if (helper.isConst(t.arrayType)) {
                    throw new TypeError("'" + snode.op + "' requires a non-const slice as its first argument", snode.lhs.loc);
                }
                if (snode.op == "move" && !(helper.isPureValue(e) || helper.isConst(e) || e == Static.t_string) && helper.isConst(snode.rhs.type)) {
                    throw new TypeError("'move' requires a non-const slice as its second argument when slice elements are neither const nor pure values", snode.lhs.loc);
                }
                let t2 = RestrictedType.strip(snode.rhs.type) as SliceType;
                let e2 = RestrictedType.strip(t2.getElementType());
                if (!this.checkTypeEquality(e, e2, snode.loc, false)) {
                    throw new TypeError("'" + snode.op + "' requires two slices of the same type", snode.loc);
                }
                break;
            case "slice":
                this.checkExpression(snode.parameters[0], scope);
                this.checkExpression(snode.parameters[1], scope);
                this.checkExpression(snode.parameters[2], scope);
                if (!helper.isSlice(snode.parameters[0].type)) {
                    throw new TypeError("'slice' is only allowed on slices", snode.loc);
                }
                if (helper.isLocalReference(snode.parameters[0].type)) {
                    throw new TypeError("'slice' is not allowed on local references", snode.loc)
                }
                this.checkIsAssignable(snode.parameters[0], scope, true);
                this.checkIsPlatformIntNumber(snode.parameters[1]);
                this.checkIsPlatformIntNumber(snode.parameters[2]);
                break;
            case "println":
                for(let i = 0; i < snode.parameters.length; i++) {
                    this.checkExpression(snode.parameters[i], scope);
                }
                break;
            case "push": // Push is handled together with tryPush and append which are both expressions
            case "append":
            default:
                this.checkExpression(snode, scope);
                if (snode.type instanceof ArrayLiteralType || snode.type instanceof ObjectLiteralType || snode.type instanceof TupleLiteralType) {
                    throw new TypeError("Cannot infer type", snode.loc);
                }
        }
        return;
    }

    public checkExpression(enode: Node, scope: Scope) {
        switch (enode.op) {
            case "null":
                enode.type = Static.t_null;
                break;
            case "bool":
                enode.type = Static.t_bool;
                break;
            case "str":
                enode.type = Static.t_string;
                break;
            case "rune":
                enode.type = Static.t_rune;
                break;
            case "int":
                // TODO: Check ranges and use t_uint if required
                enode.type = Static.t_int;
                break;
            case "float":
                // TODO: Check ranges
                enode.type = Static.t_double;
                break;
            case "id":
                // TODO: ellipsis, optional
                let element = scope.resolveElement(enode.value);
                if (!element) {
                    throw new TypeError("Unknown identifier " + enode.value, enode.loc);
                }
                enode.type = element.type;
                break;
            case "++":
            case "--":
                this.checkExpression(enode.lhs, scope);
                if (helper.isUnsafePointer(enode.lhs.type)) {
                    // Do nothing by intention
                } else {
                    this.checkIsIntNumber(enode.lhs);
                }
                this.checkIsAssignable(enode.lhs, scope);
                enode.type = enode.lhs.type;
                break;
            case "unary-":
                this.checkExpression(enode.rhs, scope);
                this.checkIsSignedNumber(enode.rhs);
                if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                    enode.op = enode.rhs.op;
                    enode.value = (-parseFloat(enode.rhs.value)).toString(); // TODO: BigNumber
                }
                enode.type = helper.stripType(enode.rhs.type);
                break;
            case "unary+":
                this.checkExpression(enode.rhs, scope);
                this.checkIsNumber(enode.rhs);
                if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                    enode.op = enode.rhs.op;
                    enode.value = enode.rhs.value;
                }
                enode.type = helper.stripType(enode.rhs.type);
                break;
            case "unary^":
                this.checkExpression(enode.rhs, scope);
                this.checkIsIntNumber(enode.rhs);
                if (enode.rhs.op == "int") {
                    enode.op = enode.rhs.op;
                    enode.value = (~parseInt(enode.rhs.value)).toString();
                }
                enode.type = helper.stripType(enode.rhs.type);
                break;
            case "unary!":
                this.checkExpression(enode.rhs, scope);
                this.checkIsBool(enode.rhs);
                if (enode.rhs.op == "bool") {
                    enode.op = enode.rhs.op;
                    enode.value = enode.rhs.value == "true" ? "false" : "true";
                }
                enode.type = Static.t_bool;
                break;
            case "unary*":
            {
                this.checkExpression(enode.rhs, scope);
                this.checkIsPointer(enode.rhs);
                let t = helper.stripType(enode.rhs.type);
                enode.type = (t as (PointerType | UnsafePointerType)).elementType;
                if (helper.stripType(enode.type) instanceof InterfaceType) {
                    throw new TypeError("Interfaces cannot be dereferenced", enode.loc);
                }
                break;
            }
            case "unary&":
            {
                this.checkExpression(enode.rhs, scope);
                if (enode.isUnifyableLiteral()) {
                    enode.type = this.defaultLiteralType(enode);
                } else if (enode.rhs.isLiteral()) {
                    enode.type = new PointerType(enode.rhs.type, "strong");
                } else {
                    this.checkIsAddressable(enode.rhs, scope, true, true);
                    enode.type = new PointerType(enode.rhs.type, "local_reference");
                    // A reference to a non-mutable variable (e.g. 'let') must not be dereferenced and assigned to -> const
                    if (!this.checkIsAssignable(enode.rhs, scope, false)) {
                        enode.type = helper.applyConst(enode.type, enode.loc);
                    }
                }
                break;
            }
            case "+":
            case "*":
            case "/":
            case "-":
            case ">":
            case "<":
            case "<=":
            case ">=":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                if ((enode.op == "+" || enode.op == ">" || enode.op == "<" || enode.op == ">=" || enode.op == "<=") && helper.isString(enode.lhs.type)) {
                    this.checkIsString(enode.rhs);
                    if (enode.lhs.op == "str" && enode.rhs.op == "str") {
                        enode.op = "str";
                        enode.value = enode.lhs.value + enode.rhs.value;
                    }
                    if (enode.op == "+" || enode.op == "str") {
                        enode.type = Static.t_string;
                    } else {
                        enode.type = Static.t_bool;
                    }
                } else if (helper.isUnsafePointer(enode.lhs.type)) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsIntNumber(enode.rhs);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
                    }
                    enode.type = helper.stripType(enode.lhs.type);
                } else if (helper.isUnsafePointer(enode.rhs.type)) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsIntNumber(enode.lhs);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
                    }
                    enode.type = helper.stripType(enode.rhs.type);
                } else {
                    this.checkIsNumber(enode.lhs);
                    this.checkIsNumber(enode.rhs);
                    // If lhs and rhs are constants, compute at compile time
                    if ((enode.lhs.op == "int" || enode.lhs.op == "float") && (enode.rhs.op == "int" || enode.rhs.op == "float")) {
                        // TODO: parse in a BigNumber representation
                        let l: number = parseFloat(enode.lhs.value);
                        let r: number = parseFloat(enode.rhs.value);
                        switch(enode.op) {
                            case "+":
                                enode.value = (l + r).toString();
                                break;
                            case "*":
                                enode.value = (l * r).toString();
                                break;
                            case "/":
                                // TODO: integer division
                                enode.value = (l / r).toString();
                                break;
                            case "-":
                                enode.value = (l - r).toString();
                                break;
                            case ">":
                                enode.value = (l > r) ? "true" : "false";
                                break;
                            case "<":
                                enode.value = (l < r) ? "true" : "false";
                                break;
                            case "<=":
                                enode.value = (l <= r) ? "true" : "false";
                                break;
                            case ">=":
                                enode.value = (l >= r) ? "true" : "false";
                                break;
                        }
                        if (enode.lhs.op == "float" || enode.rhs.op == "float") {
                            enode.op = "float";
                            enode.lhs.type = Static.t_double;
                            enode.rhs.type = Static.t_double;
                        } else {
                            enode.op = "int";
                        }
                    } else if (enode.op == "<" && this.checkIsUnsignedNumber(enode.lhs, false) && enode.rhs.op == "int" && enode.rhs.value == "0") {
                        enode.op = "bool";
                        enode.value = "false";
                    } else if (enode.op == ">" && this.checkIsUnsignedNumber(enode.rhs, false) && enode.lhs.op == "int" && enode.lhs.value == "0") {
                        enode.op = "bool";
                        enode.value = "false";
                    } else if (enode.lhs.op == "int" || enode.lhs.op == "float" || enode.lhs.op == "rune") {
                        this.unifyLiterals(enode.rhs.type, enode.lhs, scope, enode.loc);
                    } else if (enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "rune") {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, scope, enode.loc);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
                    }
                    if (enode.op == "+" || enode.op == "-" || enode.op == "*" || enode.op == "/" || enode.op == "float" || enode.op == "int") {
                        enode.type = helper.stripType(enode.lhs.type);
                    } else {
                        enode.type = Static.t_bool;
                    }
                }
                break;
            case "||":
            case "&&":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                this.checkIsBool(enode.lhs);
                this.checkIsBool(enode.rhs);
                enode.type = Static.t_bool;
                break;
            case "&":
            case "|":
            case "^":
            case "&^":
            case "%":
            case "<<":
            case ">>":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                this.checkIsIntNumberOrUnsafePointer(enode.lhs);
                this.checkIsIntNumber(enode.rhs);
                if (enode.lhs.op == "int" && enode.rhs.op == "int") {
                    // TODO: parse in a BigNumber representation
                    let l: number = parseFloat(enode.lhs.value);
                    let r: number = parseFloat(enode.rhs.value);
                    switch(enode.op) {
                        case "&":
                            enode.value = (l & r).toString();
                            break;
                        case "|":
                            enode.value = (l | r).toString();
                            break;
                        case "^":
                            enode.value = (l ^ r).toString();
                            break;
                        case "&^":
                            enode.value = (l & ~r).toString();
                            break;
                        case "%":
                            enode.value = (l % r).toString();
                            break;
                        case "<<":
                            enode.value = (l << r).toString();
                            break;
                        case ">>":
                            enode.value = (l >> r).toString();
                            break;
                    }
                    enode.op = "int";
                } else if (enode.lhs.op == "int") {
                    if (enode.op == "<<" || enode.op == ">>") {
                        this.unifyLiterals(Static.t_uint, enode.lhs, scope, enode.loc);
                        this.checkIsUnsignedNumber(enode.rhs);
                    } else {
                        this.unifyLiterals(enode.rhs.type, enode.lhs, scope, enode.loc);
                    }
                } else if (enode.rhs.op == "int") {
                    if (enode.op == "<<" || enode.op == ">>") {
                        this.unifyLiterals(Static.t_uint, enode.rhs, scope, enode.loc);
                    } else {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, scope, enode.loc);
                    }
                } else {
                    if (enode.op == "<<" || enode.op == ">>") {
                        this.checkIsUnsignedNumber(enode.rhs);
                    } else if (helper.isUnsafePointer(enode.lhs.type)) {
                        this.checkIsAssignableType(Static.t_uint, enode.rhs.type, enode.rhs.loc, "assign", true);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
                    }
                }
                enode.type = helper.stripType(enode.lhs.type);
                break;
            case "==":
            case "!=":
            {
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let tl = helper.stripType(enode.lhs.type);
                if (tl instanceof OrType && !tl.stringsOnly()) {
                    throw new TypeError("Or'ed types cannot be compared", enode.lhs.loc);
                }
                let tr = helper.stripType(enode.rhs.type);
                if (tr instanceof OrType && !tr.stringsOnly()) {
                    throw new TypeError("Or'ed types cannot be compared", enode.rhs.loc);
                }
                if ((enode.lhs.op == "int" || enode.lhs.op == "float") && (enode.rhs.op == "int" || enode.rhs.op == "float")) {
                    // Compare two number literals
                    // TODO: parse in a BigNumber representation
                    let l: number = parseFloat(enode.lhs.value);
                    let r: number = parseFloat(enode.rhs.value);
                    if (enode.op == "==") {
                        enode.value = (l == r) ? "true" : "false";
                    } else {
                        enode.value = (l != r) ? "true" : "false";
                    }
                    enode.op = "bool";
                } else if (enode.lhs.op == "str" && enode.rhs.op == "str") {
                    // Compare two string literals?
                    if (enode.op == "==") {
                        enode.value = (enode.lhs.value == enode.rhs.value) ? "true" : "false";
                    } else {
                        enode.value = (enode.lhs.value != enode.rhs.value) ? "true" : "false";
                    }
                    enode.op = "bool";
                } else if (enode.lhs.op == "null" && enode.rhs.op == "null") {
                    // Compare two nulls?
                    enode.value = (enode.op == "==" ? "true" : "false");
                    enode.op = "bool";
                } else if (enode.lhs.isUnifyableLiteral()) {
                    if ((tr instanceof PointerType || tr instanceof SliceType) && enode.lhs.op != "null") {
                        throw new TypeError("Pointers and literals cannot be compared", enode.loc);
                    }
                    this.unifyLiterals(enode.rhs.type, enode.lhs, scope, enode.loc);
                } else if (enode.rhs.isUnifyableLiteral()) {
                    if ((tl instanceof PointerType || tl instanceof SliceType) && enode.rhs.op != "null") {
                        throw new TypeError("Pointers and literals cannot be compared", enode.loc);
                    }
                    this.unifyLiterals(enode.lhs.type, enode.rhs, scope, enode.loc);
                } else {
                    this.checkIsAssignableType(tl, tr, enode.loc, "compare", true);
                }
                enode.type = Static.t_bool;
                break;
            }
            case ".":
            {
                this.checkExpression(enode.lhs, scope);
                let type: Type = helper.stripType(enode.lhs.type);
                let name = enode.name.value;
                if (type instanceof PackageType) {
                    if (!type.pkg.scope.elements.has(name)) {
                        throw new TypeError("Unknown identifier " + name + " in package " + type.pkg.pkgPath, enode.name.loc);
                    }
                    enode.type = type.pkg.scope.elements.get(name).type;
                    break;
                }
                let objectType = type;
                let isConst = helper.isConst(enode.lhs.type);
                if (type instanceof PointerType || type instanceof UnsafePointerType) {
                    isConst = helper.isConst(type.elementType);
                    objectType = helper.stripType(type.elementType);
                } else if (type instanceof StructType) {
                    objectType = type;
                    type = new PointerType(type, "reference");
                } else {
                    throw new TypeError("Unknown field or method " + name + " in " + type.toString(), enode.name.loc);
                }
                if (objectType instanceof StructType) {
                    let field = objectType.field(name);
                    if (field) {
                        enode.type = field.type;
                        if (isConst) {
                            enode.type = helper.applyConst(enode.type, enode.loc);
                        }
                    } else {
                        let method = objectType.method(name);
                        if (!method) {
                            throw new TypeError("Unknown field or method " + name + " in " + objectType.toString(), enode.name.loc);
                        }
                        this.checkIsAssignableType(method.objectType, type, enode.loc, "assign", true);
                        enode.type = method;
                    }
                } else if (objectType instanceof InterfaceType) {
                    let method = objectType.method(name);
                    if (!method) {
                        throw new TypeError("Unknown method " + name + " in " + objectType.toString(), enode.name.loc);
                    }
                    this.checkIsAssignableType(method.objectType, type, enode.loc, "assign", true);
                    enode.type = method;
                } else {
                    throw new TypeError("Unknown field or method " + name + " in " + objectType.toString(), enode.name.loc);
                }
                break;
            }
            case ":":
            {
                this.checkExpression(enode.lhs, scope);
                let index1 = 0;
                let index2 = 0;
                let indicesAreNumbers = 0;
                if (enode.parameters[0]) {
                    this.checkExpression(enode.parameters[0], scope);
                    this.checkIsIntNumber(enode.parameters[0]);
                    if (enode.parameters[0].op == "int") {
                        index1 = parseInt(enode.parameters[0].value);
                        indicesAreNumbers++;
                    }
                }
                if (enode.parameters[1]) {
                    this.checkExpression(enode.parameters[1], scope);
                    this.checkIsIntNumber(enode.parameters[1]);
                    if (enode.parameters[1].op == "int") {
                        index2 = parseInt(enode.parameters[1].value);
                        indicesAreNumbers++;
                    }
                }
                if (indicesAreNumbers == 2 && index1 > index2) {
                    throw new TypeError("Index out of range", enode.rhs.loc);
                }
                let isConst = helper.isConst(enode.lhs.type);
                let t: Type = helper.stripType(enode.lhs.type);
                let elementType = this.checkIsIndexable(enode.lhs, index1);
                if (t instanceof ArrayType) {
                    this.checkIsAddressable(enode.lhs, scope, false);
                    this.checkIsIndexable(enode.lhs, index2, true);
                    enode.type = new SliceType(t, "local_reference");
                } else if (t instanceof UnsafePointerType) {
                    enode.type = new SliceType(enode.lhs.type as (ArrayType | RestrictedType), "local_reference");
                    if (isConst) {
                        enode.type = helper.applyConst(enode.type, enode.loc);
                    }
                } else if (helper.isMap(t)) {
                    throw new TypeError("Ranges are not supported on maps", enode.loc);
                } else if (t instanceof SliceType) {
                    let isTakeExpr = helper.isTakeExpression(enode.lhs);
                    if ((t.mode == "unique" || t.mode == "strong") && !isTakeExpr) {
                        enode.type = new SliceType(t.arrayType, "reference");
                    } else {
                        // For slices the type remains the same
                        enode.type = enode.lhs.type;
                    }
                } else if (t == Static.t_string) {
                    enode.type = Static.t_string;
                } else {
                    throw new ImplementationError()
                }
                break;
            }
            case "[":
            {
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let isConst = helper.isConst(enode.lhs.type);
                let t: Type = helper.stripType(enode.lhs.type);
                if (t instanceof TupleType) {
                    this.checkIsIntNumber(enode.rhs);
                    if (enode.rhs.op != "int") {
                        throw new TypeError("Index inside a tuple must be a constant number", enode.lhs.loc);
                    }
                    let index = parseInt(enode.rhs.value);
                    enode.type = this.checkIsIndexable(enode.lhs, index);
                } else if (t instanceof ArrayType) {
                    this.checkIsPlatformIntNumber(enode.rhs);
                    let index = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    }
                    enode.type = this.checkIsIndexable(enode.lhs, index);
                } else if (helper.isMap(t)) {
                    isConst = isConst || helper.isConst((t as PointerType).elementType);
                    if (enode.rhs.isUnifyableLiteral()) {
                        this.unifyLiterals(this.mapKeyType(t), enode.rhs, scope, enode.rhs.loc);
                    } else {
                        this.checkIsAssignableType(this.mapKeyType(t), enode.rhs.type, enode.rhs.loc, "assign", true);
                    }
                    enode.type = this.mapValueType(t);
                } else if (t instanceof SliceType) {
                    this.checkIsPlatformIntNumber(enode.rhs);
                    enode.type = t.getElementType();
                    isConst = isConst || helper.isConst(t.arrayType);
                } else if (t == Static.t_string) {
                    this.checkIsPlatformIntNumber(enode.rhs);
                    enode.type = Static.t_byte;
                } else if (t instanceof UnsafePointerType) {
                    this.checkIsPlatformIntNumber(enode.rhs);
                    enode.type = t.elementType;
                } else {
                    throw new TypeError("[] operator is not allowed on " + enode.lhs.type.toString(), enode.loc);
                }
                if (isConst) {
                    enode.type = helper.applyConst(enode.type, enode.loc);
                }
                break;
            }
            case "(":
            {
                this.checkExpression(enode.lhs, scope);
                if (enode.parameters) {
                    for(let pnode of enode.parameters) {
                        if (pnode.op == "unary...") {
                            this.checkExpression(pnode.rhs, scope);
                        } else {
                            this.checkExpression(pnode, scope);
                        }
                    }
                }
                let t = helper.stripType(enode.lhs.type);
                if (t instanceof TemplateType) {
                    let result = this.checkTemplateFunctionArguments(t, enode.parameters, scope, enode.loc);
                    let types: Array<Type> = [];
                    for(let i = 0; i < t.templateParameterNames.length; i++) {
                        let tt = result.get(t.templateParameterNames[i]);
                        types.push(tt);
                    }
                    let f = this.instantiateTemplateFunction(t, types, enode.loc);
//                    console.log("Instantiate template", f.name);
                    enode.type = f.type.returnType;
                    enode.lhs.type = f.type;
                    t = f.type;
                } else if (t instanceof FunctionType) {
                    this.checkFunctionArguments(t, enode.parameters, scope, enode.loc);
                    enode.type = t.returnType;
                } else {
                    throw new TypeError("Expression is not a function", enode.loc);
                }
                if (!helper.isConst((t as FunctionType).objectType) && enode.lhs.op == "." && !helper.isSafePointer(enode.lhs.lhs.type) && !helper.isUnsafePointer(enode.lhs.lhs.type)) {
                    this.checkIsMutable(enode.lhs.lhs, scope, true);
                }
                break;
            }
            case "genericInstance":
                this.checkExpression(enode.lhs, scope);
                enode.type = this.instantiateTemplateFunctionFromNode(enode, scope).type;
                break;
            case "make":
            {
                enode.lhs.type = this.createType(enode.lhs, scope);
                if (enode.parameters.length > 0) {
                    if (enode.parameters.length > 2) {
                        throw new TypeError("make accepts at most two parameters", enode.loc);
                    }
                    this.checkExpression(enode.parameters[0], scope);
                    this.checkIsPlatformIntNumber(enode.parameters[0], true);
                    if (enode.parameters.length == 2) {
                        this.checkExpression(enode.parameters[1], scope);
                        this.checkIsPlatformIntNumber(enode.parameters[1], true);
                    }
                    enode.type = new SliceType(new ArrayType(enode.lhs.type, -1), "strong");
                } else {
                    enode.type = new PointerType(enode.lhs.type, "strong");
                }
                break;
            }
            case "tuple":
            {
                let types: Array<Type> = [];
                for(let p of enode.parameters) {
                    this.checkExpression(p, scope);
                    types.push(p.type);
                }
                let t = new TupleLiteralType(types);
                enode.type = t;
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope, "variable_toplevel");
                    this.unifyLiterals(ct, enode, scope, enode.loc);
                }
                break;
            }
            case "array":
            {
                let types: Array<Type> = [];
                if (enode.parameters) {
                    for(var i = 0; i < enode.parameters.length; i++) {
                        let p = enode.parameters[i];
                        if (p.op == "...") {
                            // Do nothing by intention
                        } else {
                            this.checkExpression(p, scope);
                            types.push(p.type);
                        }
                    }
                }
                let t = new ArrayLiteralType(types);
                enode.type = t;
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope, "variable_toplevel");
                    this.unifyLiterals(ct, enode, scope, enode.loc);
                }
                break;
            }
            case "object":
            {
                let types = new Map<string, Type>();
                if (enode.parameters) {
                    for(let p of enode.parameters) {
                        this.checkExpression(p.lhs, scope);
                        types.set(p.name.value, p.lhs.type);
                    }
                }
                let t = new ObjectLiteralType(types);
                enode.type = t;
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope, "variable_toplevel");
                    this.unifyLiterals(ct, enode, scope, enode.loc);
                }
                break;
            }
            case "=>":
            {
                let f = new Function();
                f.loc = enode.loc;
                f.node = enode;
                f.scope = new Scope(scope);
                f.scope.func = f;
                f.type = new FunctionType();
                f.type.loc = enode.loc;
                enode.scope = f.scope;
                enode.type = f.type;
                if (enode.parameters) {
                    for(let pnode of enode.parameters) {
                        let original_pnode = pnode;
                        var p = new FunctionParameter();
                        if (pnode.op == "ellipsisParam") {
                            p.ellipsis = true;
                            pnode = pnode.lhs;
                        }
                        p.name = pnode.name.value;
                        for(let param of f.type.parameters) {
                            if (param.name == p.name) {
                                throw new TypeError("Duplicate parameter name " + p.name, pnode.loc);
                            }
                        }
                        p.type = this.createType(pnode, enode.scope, "parameter");
                        if (p.ellipsis && !(p.type instanceof SliceType)) {
                            throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                        }
                        p.loc = pnode.loc;
                        f.type.parameters.push(p);
                        f.scope.registerElement(p.name, p);
                    }
                }
                // Return type?
                if (enode.lhs) {
                    f.type.returnType = this.createType(enode.lhs, f.scope, "parameter_toplevel");
                    if (enode.lhs.op == "tupleType") {
                        for(let i = 0; i < enode.lhs.parameters.length; i++) {
                            let pnode = enode.lhs.parameters[i];
                            if (i == 0) {
                                f.hasNamedReturnVariables = !!pnode.name;
                            } else if ((f.hasNamedReturnVariables && !pnode.name) || (!f.hasNamedReturnVariables && !!pnode.name)) {
                                throw new TypeError("Either all or no return variables are named", pnode.loc);
                            }
                        }
                    }
                    if (enode.lhs.op == "tupleType") {
                        for(let i = 0; i < enode.lhs.parameters.length; i++) {
                            let pnode = enode.lhs.parameters[i];
                            if (pnode.name) {
                                let v = new Variable();
                                v.isResult = true;
                                v.loc = pnode.loc;
                                v.name = pnode.name.value;
                                v.type = (f.type.returnType as TupleType).types[i];
                                f.scope.registerElement(v.name, v);
                                if (!f.namedReturnVariables) {
                                    f.namedReturnVariables = [];
                                }
                                f.namedReturnVariables = [v];
                            }
                        }
                    } else {
                        let v = new Variable();
                        v.isResult = true;
                        v.loc = enode.loc;
                        v.name = "return";
                        v.type = f.type.returnType;
                        f.unnamedReturnVariable = v;
                    }
                }
                // Return expression or return statements?
                if (enode.rhs) {
                    this.checkExpression(enode.rhs, enode.scope);
                    if (!f.type.returnType) {
                        f.type.returnType = enode.rhs.type;
                        let v = new Variable();
                        v.isResult = true;
                        v.loc = enode.loc;
                        v.name = "return";
                        v.type = f.type.returnType;
                        f.unnamedReturnVariable = v;
                    } else {
                        this.checkIsAssignableNode(f.type.returnType, enode.rhs, scope);
                    }
                } else {
                    enode.scopeExit = this.checkStatements(enode.statements, enode.scope);
                }
                break;
            }
            case "is":
            {
                this.checkExpression(enode.lhs, scope);
                let t = this.createType(enode.rhs, scope, "variable_toplevel");
                enode.rhs.type = t
                if (helper.isOrType(enode.lhs.type)) {
                    let ot = helper.stripType(enode.lhs.type) as OrType;
                    let found = false;
                    for(var option of ot.types) {
                        if (this.checkTypeEquality(option, t, enode.loc, false)) {
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        throw new TypeError("Type " + t.toString() + " is not part of " + ot.toString(), enode.rhs.loc);
                    }
                } else {
                    this.checkIsInterface(enode.lhs);
                    if (!helper.isSafePointer(t) || !helper.isStruct(RestrictedType.strip((RestrictedType.strip(t) as PointerType).elementType))) {
                        throw new TypeError("Interface can only contain pointers to structs, but not " + t.toString(), enode.loc);
                    }
                }
                enode.type = Static.t_bool;
                break;
            }
            case "typeCast":
            {
                let t = this.createType(enode.lhs, scope, "parameter_toplevel");
                this.checkExpression(enode.rhs, scope);
                let right = RestrictedType.strip(enode.rhs.type);
                let left = RestrictedType.strip(t);
                if ((left == Static.t_float || left == Static.t_double) && helper.isIntNumber(right)) {
                    // Ints can be converted to floats
                    enode.type = t;
                } else if (helper.isIntNumber(left) && (right == Static.t_float || right == Static.t_double)) {
                    // Floats can be converted to ints
                    enode.type = t;
                } else if (left == Static.t_float && right == Static.t_double) {
                    // Doubles can be converted to floats
                    enode.type = t;
                } else if (left == Static.t_double && right == Static.t_float) {
                    // Floats can be converted to doubles
                    enode.type = t;
                } else if (left == Static.t_rune && helper.isUInt32Number(right)) {
                    // Runes can be converted to uint32
                    enode.type = t;
                } else if (helper.isUInt32Number(left) && right == Static.t_rune) {
                    // Uint32 can be converted to a rune
                    enode.type = t;
//                } else if (helper.isInt32Number(t) && right instanceof UnsafePointerType) {
//                    // Unsafe pointers can be converted to 32-bit integers
//                    enode.type = t;
                } else if (left instanceof UnsafePointerType && (right instanceof UnsafePointerType || right instanceof PointerType || helper.isString(right) || helper.isInt32Number(right))) {
                    // Unsafe pointers to anything, safe pointers to anything, strings and 32-bit integers can be converted to any unsafe pointer
                    enode.type = t;
                } else if ((left == Static.t_bool || helper.isIntNumber(left)) && (right == Static.t_bool || helper.isIntNumber(right)) && t != right) {
                    // bool and all integers can be converted into each other
                    enode.type = t;
                } else if (helper.isString(left) && right instanceof UnsafePointerType) {
                    // An unsafe pointer can be converted to a string by doing nothing. This is an unsafe cast.
                    enode.type = t;
                } else if (helper.isString(left) && right instanceof SliceType && !helper.isLocalReference(right) && !helper.isConst(enode.rhs.type) && (right.getElementType() == Static.t_byte || right.getElementType() == Static.t_char)) {
                    // A slice of bytes or chars can be converted to a string by taking ownership away from the slice
                    enode.type = t;
                } else if (left instanceof SliceType && (left.mode == "strong" || left.mode == "unique" || helper.isConst(left.arrayType)) && (left.getElementType() == Static.t_byte || left.getElementType() == Static.t_char) && helper.isString(right)) {
                    // A string can be casted into a unique or owning sequence of bytes or chars by copying it.
                    // A string can be casted to a const slice without copying it.
                    enode.type = t;
                } else if (helper.isComplexOrType(right)) {
                    let ok = false;
                    for(let ot of (right as OrType).types) {
                        if (this.checkIsAssignableType(t, ot, enode.loc, "assign", false)) {
                            enode.type = t;
                            ok = true;
                            break;
                        }
                    }
                    if (!ok) {
                        throw new TypeError("Conversion from " + right.toString() + " to " + t.toString() + " is not possible", enode.loc);
                    }
                } else if (this.checkIsAssignableType(t, enode.rhs.type, enode.loc, "assign", false)) {
                    /*
                    // null can be casted, especially when it is assigned to interface{}
                    if (right != Static.t_null) {
                        throw new TypeError("Conversion from " + right.toString() + " to " + t.toString() + " does not require a cast", enode.loc);
                    }
                    */
                    enode.type = t;
                } else {
                    throw new TypeError("Conversion from " + enode.rhs.type.toString() + " to " + t.toString() + " is not possible", enode.loc);
//                    throw new TodoError("conversion not possible or not implemented")
                }
                break;
            }
            case "take":
                this.checkExpression(enode.lhs, scope);
                switch(enode.lhs.op) {
                    case "id":
                    case "[":
                    case ".":
                        enode.lhs.flags |= AstFlags.ZeroAfterAssignment;
                        this.checkIsMutable(enode.lhs, scope);
                        break;
                    case "typeCast":
                        let n = enode.lhs;
                        while (n.op == "typeCast" && helper.isOrType(n.rhs.type)) {
                            n = n.rhs;
                        }
                        n.flags |= AstFlags.ZeroAfterAssignment;
                        this.checkIsMutable(n, scope);
                        break;
                    default:
                        throw new TypeError("take() can only be applied on variables, object fields or slice/array elements", enode.lhs.loc);
                }
                enode.type = enode.lhs.type;
                break;
            case "len":
                this.checkExpression(enode.lhs, scope);
                if (!helper.isString(enode.lhs.type) && !helper.isArray(enode.lhs.type) && !helper.isSlice(enode.lhs.type)) {
                    throw new TypeError("'len' is only allowed on strings, arrays and slices", enode.loc);
                }
                enode.type = Static.t_int;
                break;
            case "cap":
                this.checkExpression(enode.lhs, scope);
                if (!helper.isSlice(enode.lhs.type)) {
                    throw new TypeError("'cap' is only allowed on slices", enode.loc);
                }
                enode.type = Static.t_int;
                break;
            case "clone":
            {
                this.checkExpression(enode.lhs, scope);
                if (!helper.isSlice(enode.lhs.type)) {
                    throw new TypeError("'clone' is only allowed on slices", enode.loc);
                }
                let t = RestrictedType.strip(enode.lhs.type) as SliceType;
                if (!helper.isPureValue(t.getElementType())) {
                    throw new TypeError("'clone' cannot work on slices which contain pointer-like types", enode.loc);
                }
                enode.type = new SliceType(t.arrayType, "unique");
                break;
            }
            case "sizeof":
            case "aligned_sizeof":
                enode.lhs.type = this.createType(enode.lhs, scope, "default");
                enode.type = Static.t_int;
                break;
            case "max":
            case "min":
                enode.lhs.type = this.createType(enode.lhs, scope, "default");
                this.checkIsNumber(enode.lhs, true);
                enode.type = enode.lhs.type;
                break;
            case "pop": {
                this.checkExpression(enode.lhs, scope);
                if (!helper.isSlice(enode.lhs.type)) {
                    throw new TypeError("'pop' is only allowed on slices", enode.loc);
                }
                this.checkIsAssignable(enode.lhs, scope, true);
                let t = RestrictedType.strip(enode.lhs.type) as SliceType;
                enode.type = t.getElementType();
                break;
            }
            case "push":
            case "tryPush":
            case "append":
            {
                if (enode.parameters.length < 2) {
                    throw new TypeError("'" + enode.op + "' expects at least two arguments", enode.loc);
                }
                let e: Type;
                for(let i = 0; i < enode.parameters.length; i++) {
                    let p = enode.parameters[i];
                    let expand = false;
                    if (i > 0) {
                        if (p.op == "unary...") {
                            expand = true;
                            p = p.rhs;
                        }
                    }
                    this.checkExpression(p, scope);
                    if (i == 0) {
                        if (enode.op == "push" || enode.op == "tryPush" || enode.op == "append") {
                            this.checkIsAssignable(p, scope, true);
                        }
                        if (!helper.isSlice(p.type)) {
                            throw new TypeError("First argument to '" + enode.op + "' must be a slice", p.loc);
                        }
                        let t = RestrictedType.strip(p.type) as SliceType;
                        if (helper.isConst(t.arrayType)) {
                            throw new TypeError("First argument to '" + enode.op + "' must be a non-const slice", p.loc);
                        }
                        if (enode.op == "append") {
                            if (!helper.isUnique(t) && !helper.isStrong(t)) {
                                throw new TypeError("First argument to 'append' must be an owning pointer", p.loc);
                            }
                        }
                        e = t.getElementType();
                        if (helper.isPureValue(e)) {
                            // Remove constness in case of pure values.
                            e = RestrictedType.strip(e);
                        }
                    } else {
                        if (expand) {
                            if (!helper.isSlice(p.type)) {
                                throw new TypeError("'...' must be followed by a slice", p.loc);
                            }
                            let e2 = (RestrictedType.strip(p.type) as SliceType).getElementType();
                            if (helper.isPureValue(e)) {
                                // Remove constness in case of pure values.
                                e2 = RestrictedType.strip(e2);
                            }
                            this.checkTypeEquality(e, e2, p.loc, true);
                        } else {
                            this.checkIsAssignableNode(e, p, scope, true);
                        }
                    }
                }
                if (enode.op == "append") {
                    enode.type = Static.t_void;
                } else if (enode.op == "tryPush") {
                    enode.type = Static.t_bool;
                } else if (enode.op == "push") {
                    enode.type = Static.t_void;
                } else {
                    throw new ImplementationError()
                }
                break;
            }
            case "coroutine":
                enode.type = Static.t_coroutine;
                break;
            case "resume":
                enode.type = Static.t_void;
                this.checkExpression(enode.lhs, scope);
                this.checkTypeEquality(Static.t_coroutine, enode.lhs.type, enode.loc, true);
                break;
            case "ellipsisId":
            case "unary...":
                throw new TypeError("'...' is not allowed in this context", enode.loc);
            case "optionalId":
                throw new TypeError("'?' is not allowed in this context", enode.loc);
            default:
                throw new ImplementationError(enode.op)
        }
    }

    private checkGlobalVariable(v: Variable, scope: Scope) {
        if (v.node.rhs) {
            this.checkExpression(v.node.rhs, scope);
            if (!v.type) {
                if (v.node.rhs.isUnifyableLiteral()) {
                    v.type = this.defaultLiteralType(v.node.rhs);
                } else {
                    v.type = v.node.rhs.type;
                }
            } else {
                this.checkIsAssignableNode(v.type, v.node.rhs, scope);
            }
            /*
            if (helper.isSafePointer(v.node.rhs.type) || helper.isSlice(v.node.rhs.type)) {
                if (v.node.rhs.op != "id" && v.node.rhs.op != "take" && v.node.rhs.op != "array" && v.node.rhs.op != "object") {
                    throw new TypeError("Right hand side of assignment must be wrapped in take()", v.node.rhs.loc);
                }
            }
            */
            this.checkGroupsInSingleAssignment(v.type, scope.resolveGroup(v), null, v.node.rhs, false, scope, v.loc);
        } else {
            throw new TypeError("Global variable " + v.name + " must be initialized", v.node.loc);
        }
    }

    private defaultLiteralType(node: Node): Type {
        if (node.op == "unary&") {
            this.defaultLiteralType(node.rhs);
            if (node.rhs.type instanceof ArrayType) {
                node.type = new SliceType(node.rhs.type, "strong");
            } else {
                node.type = new PointerType(node.rhs.type, "strong");
            }
        } else if (node.type instanceof ArrayLiteralType) {
            for(let pnode of node.parameters) {
                if (pnode.op == "...") {
                    throw new TypeError("Cannot infer default type of array literal using the ... operator", pnode.loc);
                }
                this.defaultLiteralType(pnode);
            }
            if (node.parameters.length == 0) {
                throw new TypeError("Cannot infer default type of []", node.loc);
            } else {
                let t = node.parameters[0].type;
                for(let i = 1; i < node.parameters.length; i++) {
                    if (!this.checkIsAssignableType(t, node.parameters[i].type, node.loc, "assign", false)) {
                        if (!(t instanceof OrType)) {
                            let o = new OrType();
                            o.types.push(t);
                            t = o;
                        }
                        (t as OrType).types.push(node.parameters[i].type);
                    }
                }
                // TODO: Set the group of this new slice to unbound
                node.type = new SliceType(new ArrayType(t, -1), "strong");
            }
        } else if (node.type instanceof TupleLiteralType) {
            let types: Array<Type> = [];
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode);
                types.push(pnode.type);
            }
            node.type = new TupleType(types);
        } else if (node.type instanceof ObjectLiteralType) {
            throw new TypeError("Cannot infer default type of object literal", node.loc);
            /*
            let s = new StructType();
            this.structs.push(s);
            node.type = s;
            for(let i = 0; i < node.parameters.length; i++) {
                let pnode = node.parameters[i];
                this.defaultLiteralType(pnode.lhs);
                let f = new StructField();
                f.type = pnode.lhs.type;
                f.name = pnode.name.value;
                (node.type as StructType).fields.push(f);
            }
            */
        }
        return node.type;
    }

    private unifyLiterals(t: Type, node: Node, scope: Scope, loc: Location, doThrow: boolean = true, templateParams: Map<string, Type> = null, allowPointerIndirection: boolean = true): boolean {
        if (templateParams && t instanceof GenericParameter && templateParams.has(t.name)) {
            t = templateParams.get(t.name);
        }

        if (helper.isOrType(t)) {
            let orType = helper.stripType(t) as OrType;
            for(let o of orType.types) {
                if (this.unifyLiterals(o, node, scope, loc, false)) {
                    return true;
                }
            }
            if (doThrow) {
                throw new TypeError("Literal of type " + node.type.toString() + " is not an option of " + t.toString(), node.loc);
            }
            return false;
        }

        if (helper.isAny(t)) {
            node.type = this.defaultLiteralType(node);
            return true;
        }

        if (allowPointerIndirection && helper.isSafePointer(t) && node.op == "object") {
            if (!this.unifyLiterals(this.pointerElementType(t), node, scope, loc, doThrow, templateParams, false)) {
                return false;
            }
            node.type = new PointerType(this.pointerElementType(t), "strong");
            return true;
        }

        if (allowPointerIndirection && helper.isSlice(t) && node.op == "array") {
            if (!this.unifyLiterals(this.sliceArrayType(t), node, scope, loc, doThrow, templateParams, false)) {
                return false;
            }
            node.type = new SliceType(this.sliceArrayType(t) as ArrayType | RestrictedType, "strong");
            return true;
        }

        if (templateParams && t instanceof GenericParameter) {
            node.type = this.defaultLiteralType(node);
            templateParams.set(t.name, node.type);
            return true;
        }

        switch (node.op) {
            case "int":
                node.type = t;
                t = helper.stripType(t);
                // TODO: Check range
                if (helper.isNumber(t)) {
                    return true;
                }
                if (t instanceof UnsafePointerType) {
                    // TODO: Check range
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between integer number and " + t.toString(), loc);
            case "float":
                node.type = t;
                t = helper.stripType(t);
                // TODO: Check range
                if (t == Static.t_float || t == Static.t_double) {
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between floating point number and " + t.toString(), loc);
            case "str":
                node.type = t;
                if (helper.isString(t)) {
                    return true;
                } else if (helper.isStringLiteralType(t)) {
                    if (t.name == node.value) {
                        return true;
                    }
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between string and " + t.toString(), loc);
            case "rune":
                node.type = t;
                t = helper.stripType(t);
                if (t == Static.t_rune) {
                    return true;
                } else if ((t == Static.t_char || t == Static.t_int8) && node.numValue <= 127) {
                    node.value = node.numValue.toString();
                    return true;
                } else if ((t == Static.t_byte || t == Static.t_uint8) && node.numValue <= 255) {
                    node.value = node.numValue.toString();
                    return true;
                } else if (t == Static.t_uint16 && node.numValue <= 65535) {
                    node.value = node.numValue.toString();
                    return true;
                } else if (t == Static.t_int16 && node.numValue <= 32768) {
                    node.value = node.numValue.toString();
                    return true;
                } else if (t == Static.t_int32 && node.numValue <= 2147483647) {
                    node.value = node.numValue.toString();
                    return true;
                } else if (t == Static.t_uint32 || Static.t_uint64 || Static.t_int64) {
                    node.value = node.numValue.toString();
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between rune and " + t.toString(), loc);
            case "array":
            {
                if (helper.isArray(t)) {
                    let arrayType = helper.stripType(t) as ArrayType;
                    // An array?
                    if (arrayType.size != -1) {
                        // Count array elements
                        let count = 0;
                        let lastParameterIsEllipsis = false;
                        if (node.parameters) {
                            count = node.parameters.length;
                            for(var i = 0; i < node.parameters.length; i++) {
                                let pnode = node.parameters[i];
                                if (pnode.op == "...") {
                                    lastParameterIsEllipsis = true;
                                }
                            }
                        }
                        if (count != arrayType.size) {
                            if (!lastParameterIsEllipsis || count > arrayType.size ) {
                                throw new TypeError("Mismatch in array size", node.loc);
                            } else {
                                // Note that this literal is incomplete
                                node.flags |= AstFlags.FillArray;
                            }
                        }
                    }
                    if (node.parameters) {
                        let elementType = this.arrayElementType(t);
                        for(var i = 0; i < node.parameters.length; i++) {
                            let pnode = node.parameters[i];
                            node.flags |= (pnode.flags & AstFlags.FillArray);
                            if (pnode.op == "...") {
                                if (arrayType.size == -1) {
                                    throw new TypeError("The ... operator is not allowed in slice literals", pnode.loc);
                                }
                                continue;
                            }
                            if (!this.checkIsAssignableNode(elementType, pnode, scope, doThrow)) {
                                return false;
                            }
                        }
                    }
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between array literal and " + t.toString(), loc);
            }
            case "tuple":
                if (helper.isTupleType(t)) {
                    let tupleType = helper.stripType(t) as TupleType;
                    if (node.parameters.length != tupleType.types.length) {
                        throw new TypeError("Mismatch in tuple length", node.loc);
                    }
                    for(let i = 0; i < node.parameters.length; i++) {
                        let pnode = node.parameters[i];
                        if (!this.checkIsAssignableNode(tupleType.types[i], pnode, scope, doThrow)) {
                            return false;
                        }
                        node.flags |= (pnode.flags & AstFlags.FillArray);
                    }
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between tuple literal and " + t.toString(), loc);
            case "object":
                if (helper.isMap(t)) {
                    let valueType = this.mapValueType(t);
                    let keyType = this.mapKeyType(t);
                    if (!node.parameters || node.parameters.length == 0) {
                        // Empty map
                        node.type = t;
                    } else if (helper.isString(keyType)) {
                        // A map, e.g. "{foo: 42}"
                        for(let pnode of node.parameters) {
                            if (!this.checkIsAssignableNode(valueType, pnode.lhs, scope, doThrow)) {
                                return false;
                            }
                            node.flags |= (pnode.flags & AstFlags.FillArray);
                        }
                    }
                    node.type = t;
                    return true;
                } else if (helper.isStruct(t)) {
                    let structType = helper.stripType(t) as StructType;
                    // A struct initialization
                    if (node.parameters) {
                        for(let pnode of node.parameters) {
                            node.flags |= (pnode.flags & AstFlags.FillArray);
                            let field = structType.field(pnode.name.value);
                            if (!field) {
                                throw new TypeError("Unknown field " + pnode.name.value + " in " + t.toString(), pnode.name.loc);
                            }
                            if (!this.checkIsAssignableNode(field.type, pnode.lhs, scope, doThrow)) {
                                return false;
                            }
                        }
                    }
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between object literal and " + t.toString(), loc);
            case "unary&":
                if (t instanceof PointerType) {
//                    if (node.rhs.op == "id") {}
                    let r = this.unifyLiterals(t, node.rhs, scope, loc, doThrow, templateParams);
                    node.type = node.rhs.type;
                    return r;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between object literal and " + t.toString(), loc);
            case "null":
                if (helper.isSafePointer(t) || helper.isUnsafePointer(t) || helper.isSlice(t)) {
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between null and " + t.toString(), loc);
            default:
                throw new ImplementationError()
        }
    }

    /**
     * Checks whether the type of 'from' can be assigned to the type 'to'.
     */
    public checkIsAssignableNode(to: Type, from: Node, scope: Scope, doThrow: boolean = true, templateParams: Map<string, Type> = null): boolean {
        if (from.isUnifyableLiteral()) {
            return this.unifyLiterals(to, from, scope, from.loc, doThrow, templateParams);
        }
        // "&local" can be a reference or even strong pointer
        if (from.op == "unary&" && from.rhs.op == "id" && (helper.isStrong(to) || helper.isReference(to))) {
            let element = scope.resolveElement(from.rhs.value);
            if (!element) {
                throw new ImplementationError()
            }
            if (element instanceof Variable) {
                let ptr = new PointerType(element.type, helper.isStrong(to) ? "strong" : "reference");
                if (!this.checkIsAssignableType(to, ptr, from.loc, "assign", doThrow, null, null, templateParams)) {
                    return false;
                }
                from.type = ptr;
                element.isReferenced = true;
                element.isReferencedWithRefcounting = true;
                return true;
            }
            throw new TypeError("The & operator can produce a strong pointer or reference on local and global variables only", from.loc);
        }
        // For a stack-based array "local", the expression "local[:]" can be a reference or even strong slice pointer
        if (from.op == ":" && from.lhs.op == "id" && (helper.isStrong(to) || helper.isReference(to))) {
            let element = scope.resolveElement(from.lhs.value);
            if (!element) {
                throw new ImplementationError()
            }
            if (element instanceof Variable && helper.isArray(element.type)) {
                let ptr = new SliceType(element.type as ArrayType | RestrictedType, helper.isStrong(to) ? "strong" : "reference");
                if (!this.checkIsAssignableType(to, ptr, from.loc, "assign", doThrow, null, null, templateParams)) {
                    return false;
                }
                from.type = ptr;
                element.isReferenced = true;
                element.isReferencedWithRefcounting = true;
                return true;
            }
        }
        return this.checkIsAssignableType(to, from.type, from.loc, "assign", doThrow, null, null, templateParams);
    }

    /**
     * Checks whether the type 'from' can be assigned to the type 'to'.
     * TODO: Remove unbox
     */
    public checkIsAssignableType(to: Type, from: Type, loc: Location, mode: "assign" | "equal" | "pointer" | "compare", doThrow: boolean = true, toRestrictions: Restrictions = null, fromRestrictions: Restrictions = null, templateParams: Map<string, Type> = null): boolean {
        if (toRestrictions == null) {
            toRestrictions = {isConst: false};
        }
        if (fromRestrictions == null) {
            fromRestrictions = {isConst: false};
        }

        // Determine const
        if (to instanceof RestrictedType) {
            toRestrictions = combineRestrictions(toRestrictions, to);
            to = to.elementType;
        }
        if (from instanceof RestrictedType) {
            fromRestrictions = combineRestrictions(fromRestrictions, from);
            from = from.elementType;
        }

        // A const-mismatch can be tolerated if the value is a pure value and if it is being copied.
        if (!toRestrictions.isConst && !!fromRestrictions.isConst && (mode == "pointer" || mode == "equal" || !helper.isPureValue(to))) {
            if (doThrow) {
                throw new TypeError("Mismatch of const restriction on variables", loc);
            }
            return false;
        }

        if (templateParams && to instanceof GenericParameter) {
            if (templateParams.has(to.name)) {
                to = templateParams.get(to.name);
            } else {
                templateParams.set(to.name, from);
                return true;
            }
        }

        if (mode == "pointer" || mode == "compare") {
            if (from instanceof StructType && to != from && from.doesExtend(to)) {
                return true;
            }
        }

        if (to == from) {
            return true;
        } else if (to instanceof TupleType && from instanceof TupleType) {
            let ok = (to.types.length == from.types.length);
            for(let i = 0; i < to.types.length; i++) {
                if (!this.checkIsAssignableType(to.types[i], from.types[i], loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return true;
            }
        } else if (to instanceof OrType) {
            if (from instanceof OrType) {
                if ((mode == "assign" && from.types.length <= to.types.length) || from.types.length == to.types.length) {
                    let ok = true;
                    for(let f of from.types) {
                        let ok2 = false;
                        for(let t of to.types) {
                            if (this.checkTypeEquality(t, f, loc, false)) {
                                ok2 = true;
                                break;
                            }
                        }
                        if (!ok2) {
                            ok = false;
                            break;
                        }
                    }
                    if (ok) {
                        return true;
                    }
                }
            } else if (mode == "assign") {
                for(let o of to.types) {
                    if (this.checkIsAssignableType(o, from, loc, mode, false, toRestrictions, fromRestrictions, templateParams)) {
                        return true;
                    }
                }
            }
            // TODO: Else check for exact type equality
/*        } else if (to instanceof PointerType && from == Static.t_null) {
            // null can be assigned to any pointer type
            if (mode == "assign" || mode == "compare") {
                return true;
            }
        } else if (to == Static.t_null && from instanceof PointerType) {
            if (mode == "compare") {
                return true;
            } */
        } else if (to instanceof PointerType && from instanceof UnsafePointerType) {
            if ((mode == "assign" || mode == "compare") && this.checkIsAssignableType(to.elementType, from.elementType, loc, "pointer", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }
        } else if (to instanceof PointerType && from instanceof PointerType) {
            if (mode == "compare" || to.mode == from.mode || (mode == "assign" &&
                (to.mode == "local_reference" ||
                (to.mode == "reference" && (from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "strong" && from.mode == "unique") ||
                (to.mode == "unique" && from.mode == "strong")))) {
                if (this.checkIsAssignableType(to.elementType, from.elementType, loc, mode == "assign" ? "pointer" : "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    return true;
                }
            }
        } else if (to instanceof UnsafePointerType && (from == Static.t_int || from == Static.t_uint || from == Static.t_null)) {
            // integers and null can be assigned to an usafe pointer type
            if (mode == "assign" || mode == "compare") {
                return true;
            }
        } else if ((to == Static.t_int || to == Static.t_uint || to == Static.t_null) && from instanceof UnsafePointerType) {
            // integers and null can be assigned to an usafe pointer type
            if (mode == "compare") {
                return true;
            }
        } else if (to instanceof UnsafePointerType && (from instanceof UnsafePointerType || from instanceof PointerType)) {
            if (to.elementType == Static.t_void) {
                // Safe and unsafe pointers to anything can be assigned to #void
                if (mode == "assign" || mode == "compare") {
                    return true;
                }
            }
            if (from.elementType == Static.t_void) {
                // #void can be assigned to any unsafe pointer
                if (mode == "assign" || mode == "compare") {
                    return true;
                }
            }
            if (this.checkIsAssignableType(to.elementType, from.elementType, loc, (mode == "assign" || mode == "compare") ? "pointer" : "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }
        } else if (to instanceof PointerType && from instanceof UnsafePointerType) {
            if (mode == "compare" && this.checkIsAssignableType(to.elementType, from.elementType, loc, "pointer", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }
        } else if (to instanceof ArrayType && from instanceof ArrayType) {
            if ((to.size == from.size || to.size == -1 || from.size == -1) && this.checkIsAssignableType(to.elementType, from.elementType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }
        } else if (to instanceof SliceType && from instanceof SliceType) {
            if (mode == "compare" || to.mode == from.mode || (mode == "assign" &&
                (to.mode == "local_reference" ||
                (to.mode == "reference" && (from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "strong" && from.mode == "unique") ||
                (to.mode == "unique" && from.mode == "strong")))) {
                if (this.checkIsAssignableType(to.arrayType, from.arrayType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    return true;
                }
            }
/*        } else if (to instanceof SliceType && from == Static.t_null) {
            // null can be assigned to any pointer type
            if (mode == "assign" || mode == "compare") {
                return true;
            }
        } else if (to == Static.t_null && from instanceof SliceType) {
            // null can be assigned to any pointer type
            if (mode == "compare") {
                return true;
            } */
        } else if (to instanceof MapType && from instanceof MapType) {
            if (this.checkIsAssignableType(to.keyType, from.keyType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams) &&
                this.checkIsAssignableType(to.valueType, from.valueType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    return true;
            }
        } else if (to == Static.t_any) {
            // Everything can be asssigned to the empty interface
            if (mode == "assign" || mode == "compare") {
                return true;
            }
        } else if (from == Static.t_any) {
            // Everything can be asssigned to the empty interface
            if (mode == "compare") {
                return true;
            }
        } else if (to instanceof InterfaceType && mode == "pointer") {
            if (from instanceof InterfaceType) {
                // Check two interfaces
                if (from == to || from.hasBaseType(to)) {
                    return true;
                }
            } else if (from instanceof StructType) {
                let toMethods = to.getAllMethods();
                let fromMethods = from.getAllMethodsAndFields();
                let ok = true;
                for(let entry of toMethods.entries()) {
                    if (fromMethods.has(entry[0])) {
                        let fieldOrMethod = fromMethods.get(entry[0]);
                        if (!(fieldOrMethod instanceof FunctionType) || !this.checkFunctionEquality(entry[1], fieldOrMethod, loc, true, false)) {
                            ok = false;
                            if (doThrow) {
                                throw new TypeError("Incompatible method signature for " + entry[0] + " in types " + from.toString() + " and " + to.toString(), loc);
                            }
                            break;
                        }
                    } else {
                        ok = false;
                        if (doThrow) {
                            throw new TypeError("Type " + from.toString() + " is missing method " + entry[0] + " as required by " + to.toString(), loc);
                        }
                        break;
                    }
                }
                if (ok) {
                    return true;
                }
            }
        }
        if (!doThrow) {
            return false;
        }
        throw new TypeError("Type " + from.toString() + " cannot be " + (mode == "compare" ? "compared to type " : "assigned to type ") + to.toString(), loc);
    }

    /**
     * Type checks all parameters.
     */
    public checkFunctionArguments(ft: FunctionType, args: Array<Node> | null, scope: Scope, loc: Location, doThrow: boolean = true): boolean {
        if (args) {
            if (ft.parameters.length != args.length) {
                if (ft.requiredParameterCount() > args.length || (args.length > ft.parameters.length && !ft.hasEllipsis())) {
                    if (doThrow) {
                        throw new TypeError("Supplied parameter count does not match function signature " + ft.toString(), loc);
                    }
                    return false;
                }
            }
            for(let i = 0; i < args.length; i++) {
                let pnode = args[i];
                if (pnode.op == "unary...") {
                    if (!ft.hasEllipsis()) {
                        if (doThrow) {
                            throw new TypeError("Ellipsis not allowed here. Function is not variadic", pnode.loc);
                        }
                        return false;
                    }
                    if (i != ft.parameters.length - 1 || i != args.length - 1) {
                        if (doThrow) {
                            throw new TypeError("Ellipsis must only appear with the last parameter", pnode.loc);
                        }
                        return false;
                    }
                    if (!this.checkIsAssignableNode(ft.lastParameter().type, pnode.rhs, scope, doThrow)) {
                        return false;
                    }
                } else {
                    if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                        if (!this.checkIsAssignableNode((ft.lastParameter().type as SliceType).getElementType(), pnode, scope, doThrow)) {
                            return false;
                        }
                    } else {
                        if (!this.checkIsAssignableNode(ft.parameters[i].type, pnode, scope, doThrow)) {
                            return false;
                        }
                    }
                }
            }
        } else if (ft.parameters.length != 0 && (!ft.hasEllipsis || ft.parameters.length > 1)) {
            if (doThrow) {
                throw new TypeError("Supplied parameters do not match function signature " + ft.toString(), loc);
            }
            return false;
        }
        return true;
    }

    public checkTemplateFunctionArguments(t: TemplateType, args: Array<Node>, scope: Scope, loc: Location) : Map<string, Type> {
        if (t.node.parameters.length == 0) {
            throw new ImplementationError()
        }
        let s = new Scope(scope);
        let result = new Map<string, Type>();
        for(let n of t.templateParameterNames) {
            let g = new GenericParameter();
            g.name = n;
            s.registerType(n, g);
        }

        let requiredParameterCount = t.node.parameters.length;
        let ellipsis = false; // TODO
        if (ellipsis) {
            requiredParameterCount--;
        }
        let lastParameter: Node = t.node.parameters[t.node.parameters.length - 1];

        if (t.node.parameters.length != args.length) {
            if (requiredParameterCount > args.length || (args.length > t.node.parameters.length && !ellipsis)) {
                throw new TypeError("Supplied parameter count does not match function signature of " + t.toString(), loc);
            }
        }
        for(let i = 0; i < args.length; i++) {
            let pnode = args[i];
            if (pnode.op == "unary...") {
                if (!ellipsis) {
                    throw new TypeError("Ellipsis not allowed here. Function is not variadic", pnode.loc);
                }
                if (i != t.node.parameters.length - 1 || i != args.length - 1) {
                    throw new TypeError("Ellipsis must only appear with the last parameter", pnode.loc);
                }
                this.checkIsAssignableNode(this.createType(lastParameter, s, "parameter"), pnode.rhs, scope, true, result);
            } else {
                if (ellipsis && i >= t.node.parameters.length - 1) {
                    this.checkIsAssignableNode((this.createType(lastParameter, s, "parameter") as SliceType).getElementType(), pnode, scope, true, result);
                } else {
                    this.checkIsAssignableNode(this.createType(t.node.parameters[i], s, "parameter"), pnode, scope, true, result);
                }
            }
        }

        for(let n of t.templateParameterNames) {
            if (!result.has(n)) {
                result.set(n, Static.t_void);
            }
        }

        return result;
    }

    public checkIsEnumerable(node: Node): [Type, Type] {
        let t = helper.stripType(node.type);
        if (helper.isMap(t)) {
            return [this.mapKeyType(t), this.mapValueType(t)];
        } else if (t instanceof ArrayType) {
            return [Static.t_int, t.elementType];
        } else if (t instanceof SliceType) {
            return [Static.t_int, t.getElementType()];
        } else if (t == Static.t_string) {
            return [Static.t_int, Static.t_byte];
        }
        throw new TypeError("The type " + t.toString() + " is not enumerable", node.loc);
    }

    public checkIsIndexable(node: Node, index: number, indexCanBeLength: boolean = false): Type {
        let t = helper.stripType(node.type);
        if (t instanceof ArrayType) {
            if (index < 0 || (!indexCanBeLength && index >= t.size) || (indexCanBeLength && index > t.size)) {
                throw new TypeError("Index out of range", node.loc);
            }
            return t.elementType;
        } else if (t instanceof SliceType) {
            if (index < 0) {
                throw new TypeError("Index out of range", node.loc);
            }
            return t.getElementType();
        } else if (t instanceof TupleType) {
            if (index < 0 || index >= t.types.length) {
                throw new TypeError("The index " + index + " does not exist in the tuple " + t.name, node.loc);
            }
            return t.types[index];
        } else if (t instanceof UnsafePointerType || t instanceof PointerType) {
            return t.elementType;
        } else if (t == Static.t_string) {
            return Static.t_byte;
        }
        throw new TypeError("The type " + t.toString() + " is not indexable", node.loc);
    }

    public checkIsAddressable(node: Node, scope: Scope, withAmpersand: boolean, doThrow: boolean = true): boolean {
        switch (node.op) {
            case "id":
                let element = scope.resolveElement(node.value);
                if (element instanceof Variable) {
                    element.isReferenced = true;
                    return true;
                } else if (element instanceof FunctionParameter) {
                    element.isReferenced = true;
                    return true;
                }
                break;
            case ".":
            {
                let t = RestrictedType.strip(node.lhs.type);
                if (t instanceof PointerType || t instanceof UnsafePointerType) {
                    return true;
                }
                return this.checkIsAddressable(node.lhs, scope, false, doThrow);
            }
            case "[":
                let t = RestrictedType.strip(node.lhs.type);
                if (t instanceof SliceType || t instanceof UnsafePointerType) {
                    return true;
                }
                if (t instanceof ArrayType || t instanceof TupleType) {
                    return this.checkIsAddressable(node.lhs, scope, false, doThrow);
                }
                break;
            case "bool":
            case "int":
            case "float":
            case "str":
            case "array":
            case "tuple":
            case "object":
                // "&{x:1, y:2}" is allowed whereas "&({x:1, y:2}.x)"" is not allowed.
                if (withAmpersand) {
                    return true;
                }
        }
        if (doThrow) {
            throw new TypeError("Cannot take address of intermediate value", node.loc);
        }
        return false;
    }

    public checkIsPointer(node: Node, doThrow: boolean = true): boolean {
        let t = helper.stripType(node.type);
        if (t instanceof PointerType || t instanceof UnsafePointerType) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a pointer, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsString(node: Node, doThrow: boolean = true): boolean {
        if (helper.isString(node.type)) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a string, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsSignedNumber(node: Node, doThrow: boolean = true): boolean {
        let t = helper.stripType(node.type);
        if (t == Static.t_float || t == Static.t_double || t == Static.t_int || t == Static.t_char || t == Static.t_int8 || t == Static.t_int16 || t == Static.t_int32 || t == Static.t_int64) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a signed numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsUnsignedNumber(node: Node, doThrow: boolean = true): boolean {
        let t = helper.stripType(node.type);
        if (t == Static.t_uint || t == Static.t_byte || t == Static.t_uint8 || t == Static.t_uint16 || t == Static.t_uint32 || t == Static.t_uint64) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an unsigned numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsBool(node: Node, doThrow: boolean = true): boolean {
        let t = helper.stripType(node.type);
        if (t == Static.t_bool) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a boolean type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsNumber(node: Node, doThrow: boolean = true): boolean {
        if (helper.isNumber(node.type)) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsIntNumber(node: Node, doThrow: boolean = true): boolean {
        if (helper.isIntNumber(node.type)) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an integer type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsPlatformIntNumber(node: Node, doThrow: boolean = true): boolean {
        if (helper.isPlatformIntNumber(node.type)) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected type int, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsIntNumberOrUnsafePointer(node: Node, doThrow: boolean = true): boolean {
        let t = helper.stripType(node.type);
        if (helper.isIntNumber(t)) {
            return true;
        }
        if (t instanceof UnsafePointerType) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a numeric or pointer type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsInterface(node: Node, doThrow: boolean = true): boolean {
        if (helper.isInterface(node.type)) {
            return true;
        }
        if (!doThrow) {
            return false;
        }
        throw new TypeError("Expected an interface type", node.loc);
    }

    public checkFunctionEquality(a: FunctionType, b: FunctionType, loc: Location, allowMoreRestrictions: boolean, doThrow: boolean = true): boolean {
        if (a.parameters.length == b.parameters.length) {
            // Check the return type. And both functions are either both member functions or both non-member functions.
            if (this.checkTypeEquality(a.returnType, b.returnType, loc, false) && !!a.objectType == !!b.objectType) {
                let ok = true;
                for(let i = 0; i < a.parameters.length; i++) {
                    if (!this.checkTypeEquality(a.parameters[i].type, b.parameters[i].type, loc, false)) {
                        ok = false;
                        break;
                    }
                    if (a.parameters[i].ellipsis != b.parameters[i].ellipsis) {
                        ok = false;
                        break;
                    }
                }
                if (a.objectType) {
                    if (allowMoreRestrictions && (helper.isConst(a.objectType) && !helper.isConst(b.objectType))) {
                        ok = false;
                    } else if (!allowMoreRestrictions && helper.isConst(a.objectType) != helper.isConst(b.objectType)) {
                        ok = false;
                    }
                }
                if (a.callingConvention != b.callingConvention) {
                    ok = false;
                }
                if (ok) {
                    return true;
                }
            }
        }

        if (doThrow) {
            throw new TypeError("Type mismatch between " + a.toString() + " and " + b.toString(), loc);
        }
        return false;
    }

    public checkTypeEquality(a: Type, b: Type, loc: Location, doThrow: boolean = true): boolean {
        if (a == b) {
            return true;
        }
        if (a instanceof RestrictedType && b instanceof RestrictedType) {
            if (a.isConst == b.isConst) {
                if (this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
                    return true;
                }
            }
        } else if (a instanceof PointerType && b instanceof PointerType) {
            if (this.checkTypeEquality(a.elementType, b.elementType, loc, false) && a.mode == b.mode) {
                return true;
            }
        } else if (a instanceof UnsafePointerType && b instanceof UnsafePointerType) {
            if (this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
                return true;
            }
        } else if (a instanceof SliceType && b instanceof SliceType && a.mode == b.mode) {
            if (this.checkTypeEquality(a.getElementType(), b.getElementType(), loc, false)) {
                return true;
            }
        } else if (a instanceof ArrayType && b instanceof ArrayType) {
            if (a.size == b.size && this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
                return true;
            }
        } else if (a instanceof TupleType && b instanceof TupleType) {
            if (a.types.length == b.types.length) {
                let ok = true;
                for(let i = 0; ok && i < a.types.length; i++) {
                    ok = ok && this.checkTypeEquality(a.types[i], b.types[i], loc, false);
                }
                if (ok) {
                    return true;
                }
            }
        } else if (a instanceof TemplateStructType && b instanceof TemplateStructType) {
            if (a.base == b.base) {
                let ok = true;
                for(let i = 0; ok && i < a.templateParameterTypes.length; i++) {
                    ok = ok && this.checkTypeEquality(a.templateParameterTypes[i], b.templateParameterTypes[i], loc, false);
                }
                if (ok) {
                    return true;
                }
            }
        } else if (a instanceof OrType && b instanceof OrType) {
            if (a.types.length == b.types.length) {
                let ok = true;
                for(let t of a.types) {
                    let ok2 = false;
                    for(let t2 of b.types) {
                        let eq = this.checkTypeEquality(t, t2, loc, false);
                        if (eq) {
                            ok2 = true;
                            break;
                        }
                    }
                    if (!ok2) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    return true;
                }
            }
        } else if (a instanceof FunctionType && b instanceof FunctionType) {
            if (this.checkFunctionEquality(a, b, loc, false, doThrow)) {
                return true;
            }
        } else if (a instanceof InterfaceType && b instanceof InterfaceType) {
            let m1 = a.getAllMethods();
            let m2 = b.getAllMethods();
            if (m1.size == m2.size) {
                let ok = true;
                for(let entry of m1.entries()) {
                    if (!m2.has(entry[0]) || !this.checkTypeEquality(m2.get(entry[0]), entry[1], loc, false)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    return true;
                }
            }
        }

        if (doThrow) {
            throw new TypeError("Type mismatch between " + a.toString() + " and " + b.toString(), loc);
        }
        return false;
    }


    // TODO: Move to helper.ts
    /**
     * Returns true if the expression given by `node` can be the target of an assignment.
     */
    public checkIsAssignable(node: Node, scope: Scope, doThrow: boolean = true): boolean {
        if (!helper.isAssignable(node, scope)) {
            if (!doThrow) {
                return false;
            }
            throw new TypeError("The expression is not assignable, because it is an intermediate value, the underlying variable is not mutable, or the type is const", node.loc);
        }
        return true;
    }

    public checkIsMutable(node: Node, scope: Scope, doThrow: boolean = true): boolean {
        if (!helper.isMutable(node, scope)) {
            if (!doThrow) {
                return false;
            }
            throw new TypeError("The expression is not mutable, because the variable is not mutable or the type is const", node.loc);
        }
        return true;
    }

    private checkVariableType(t: Type, loc: Location) {
        if (RestrictedType.strip(t) instanceof InterfaceType) {
            throw new TypeError("Interface types must be used together with a pointer", loc);
        }
        if (RestrictedType.strip(t) instanceof MapType) {
            throw new TypeError("Map types must be used together with a pointer", loc);
        }
    }

    // TODO: Move to helper.ts
    private mapKeyType(t: Type): Type {
        t = helper.stripType(t);
        if (!(t instanceof PointerType)) {
            throw new ImplementationError("Internal error")
        }
        t = helper.stripType(t.elementType);
        if (!(t instanceof MapType)) {
            throw new ImplementationError("Internal error")
        }
        return t.keyType;
    }

    // TODO: Move to helper.ts
    private mapValueType(t: Type): Type {
        t = helper.stripType(t);
        if (!(t instanceof PointerType)) {
            throw new ImplementationError("Internal error")
        }
        t = helper.stripType(t.elementType);
        if (!(t instanceof MapType)) {
            throw new ImplementationError("Internal error")
        }
        return t.valueType;
    }

    public orTypeIndex(o: OrType, t: Type, exactMatch: boolean): number {
        let index = 0;
        for(let ot of o.types) {
            if (this.checkIsAssignableType(ot, t, null, exactMatch ? "compare" : "assign", false)) {
                return index;
            }
            index++;
        }
        throw new Error("Internal error")
    }

    public static hasStrongOrUniquePointers(t: Type): boolean {
        t = RestrictedType.strip(t);
        if ((t instanceof PointerType || t instanceof SliceType) && (t.mode == "strong" || t.mode == "unique")) {
            return true;
        }
        if (t instanceof TupleType) {
            for(let p of t.types) {
                if (this.hasStrongOrUniquePointers(p)) {
                    return true;
                }
            }
            return false;
        } else if (t instanceof ArrayType) {
            return this.hasStrongOrUniquePointers(t.elementType);
        } else if (t instanceof StructType) {
            for(let f of t.fields) {
                if (this.hasStrongOrUniquePointers(f.type)) {
                    return true;
                }
            }
            if (t.extends && this.hasStrongOrUniquePointers(t.extends)) {
                return true;
            }
            return false;
        }
        return false;
    }

    public static hasReferenceOrStrongPointers(t: Type): boolean {
        t = RestrictedType.strip(t);
        if ((t instanceof PointerType || t instanceof SliceType) && (t.mode == "strong" || t.mode == "reference")) {
            return true;
        }
        if (t instanceof TupleType) {
            for(let p of t.types) {
                if (this.hasReferenceOrStrongPointers(p)) {
                    return true;
                }
            }
            return false;
        } else if (t instanceof ArrayType) {
            return this.hasReferenceOrStrongPointers(t.elementType);
        } else if (t instanceof StructType) {
            for(let f of t.fields) {
                if (this.hasStrongOrUniquePointers(f.type)) {
                    return true;
                }
            }
            if (t.extends && this.hasReferenceOrStrongPointers(t.extends)) {
                return true;
            }
            return false;
        }
        return false;
    }

    public static hasLocalReference(t: Type): boolean {
        t = RestrictedType.strip(t);
        if ((t instanceof PointerType || t instanceof SliceType) && (t.mode == "local_reference")) {
            return true;
        }
        if (t instanceof TupleType) {
            for(let p of t.types) {
                if (this.hasLocalReference(p)) {
                    return true;
                }
            }
            return false;
        } else if (t instanceof ArrayType) {
            return this.hasLocalReference(t.elementType);
        } else if (t instanceof StructType) {
            for(let f of t.fields) {
                if (this.hasLocalReference(f.type)) {
                    return true;
                }
            }
            if (t.extends && this.hasLocalReference(t.extends)) {
                return true;
            }
            return false;
        }
        return false;
    }


    public pointerElementType(t: Type): Type {
        t = RestrictedType.strip(t);
        if (t instanceof PointerType || t instanceof UnsafePointerType) {
            return t.elementType;
        }
        return null;
    }

    public sliceArrayType(t: Type): Type {
        t = RestrictedType.strip(t);
        if (t instanceof SliceType) {
            return t.arrayType;
        }
        return null;
    }

    public arrayElementType(t: Type): Type {
        t = RestrictedType.strip(t);
        if (t instanceof ArrayType) {
            return t.elementType;
        }
        return null;
    }

    private stringLiteralType(name: string): StringLiteralType {
        if (this.stringLiteralTypes.has(name)) {
            return this.stringLiteralTypes.get(name);
        }
        let t = new StringLiteralType(name);
        this.stringLiteralTypes.set(name, t);
        return t;
    }

    private checkGroupsInFunction(f: Function) {
        if (!f.node.statements) {
            return;
        }

        let groups = f.type.createGroups();
        for(let pt of f.type.parameters) {
            let g = groups.get(pt.name);
            if (!g) {
                throw new ImplementationError()
            }
            f.scope.setGroup(pt, g);
        }

        if (f.type.objectType) {
            let th = f.scope.resolveElement("this");
            if (!th) {
                throw new ImplementationError()
            }
            let g = groups.get("this");
            if (!g) {
                throw new ImplementationError()
            }
            f.scope.setGroup(th, g);
        }

        if (f.namedReturnVariables) {
            for (let i = 0; i < f.namedReturnVariables.length; i++) {
                let r = f.namedReturnVariables[i];
                let g = groups.get("return " + i.toString());
                if (!g) {
                    throw new ImplementationError()
                }
                f.scope.setGroup(r, g);
            }
        } else if (f.unnamedReturnVariable) {
            let g = groups.get("return");
            if (!g) {
                throw new ImplementationError()
            }
            f.scope.setGroup(f.unnamedReturnVariable, g);
        }

        for(let snode of f.node.statements) {
            this.checkGroupsInStatement(snode, f.scope);
        }
    }

    private checkGroupsInStatement(snode: Node, scope: Scope): void {
        this.modifiedVariabes.clear();
        this.usedVariables.clear();
        switch (snode.op) {
            case "comment":
            case "yield":
                break;
            case "yield_continue":
                break;
            case "let_in": {
                let flags = TypeChecker.hasReferenceOrStrongPointers(snode.rhs.type) ? GroupCheckFlags.ForbidIsolates : GroupCheckFlags.AllowIsolates;
                let g = this.checkGroupsInExpression(snode.rhs, scope, flags);
                if (snode.lhs.op == "tuple") {
                    if (snode.lhs.parameters[0].value != "_") {
                        let v = scope.resolveElement(snode.lhs.parameters[0].value);
                        scope.setGroup(v, new Group(GroupKind.Free));
                    }
                    if (snode.lhs.parameters[1].value != "_") {
                        let v = scope.resolveElement(snode.lhs.parameters[1].value);
                        scope.setGroup(v, g ? g : new Group(GroupKind.Free));
                    }
                } else {
                    let v = scope.resolveElement(snode.lhs.value);
                    scope.setGroup(v, g ? g : new Group(GroupKind.Free));
                }
                break;
            }
            case "var":
            case "let":
                if (snode.rhs) {
                    this.checkGroupsInAssignment(snode, scope);
                }
                break;
            case "+=":
            case "*=":
            case "/=":
            case "-=":
            case "<<=":
            case ">>=":
            case "%=":
            case "&=":
            case "&^=":
            case "|=":
            case "^=":
            case "=":
                this.checkGroupsInAssignment(snode, scope);
                break;
            case "return": {
                let f = scope.envelopingFunction();
                if (!f) {
                    throw new ImplementationError()
                }
                if (snode.lhs) {
                    // Returning a tuple?
                    if (f.namedReturnVariables) {
                        if (snode.lhs.op == "tuple") {
                            for(let i = 0; i < f.namedReturnVariables.length; i++) {
                                let group = scope.resolveGroup(f.namedReturnVariables[i]);
                                if (helper.isUnique(f.namedReturnVariables[i].type)) {
                                    group = null;
                                }
                                this.checkGroupsInSingleAssignment(f.namedReturnVariables[i].type, group, null, snode.lhs.parameters[i], false, scope, snode.loc);
                            }
                        } else {
                            let flags = TypeChecker.hasReferenceOrStrongPointers(snode.lhs.type) ? GroupCheckFlags.ForbidIsolates : GroupCheckFlags.AllowIsolates;
                            let g = this.checkGroupsInExpression(snode.lhs, scope, flags);
                            for(let i = 0; i < f.namedReturnVariables.length; i++) {
                                let group = scope.resolveGroup(f.namedReturnVariables[i]);
                                if (helper.isUnique(f.namedReturnVariables[i].type)) {
                                    group = null;
                                }
                                this.checkGroupsInSingleAssignment(f.namedReturnVariables[i].type, group, g instanceof TupleGroup ? g.groups[i] : g, snode.lhs, i+1 < f.namedReturnVariables.length, scope, snode.loc);
                            }
                        }
                    } else {
                        if (!f.unnamedReturnVariable) {
                            throw new ImplementationError()
                        }
                        let group = scope.resolveGroup(f.unnamedReturnVariable);
                        if (helper.isUnique(f.unnamedReturnVariable.type)) {
                            group = null;
                        }
                        this.checkGroupsInSingleAssignment(f.type.returnType, group, null, snode.lhs, false, scope, snode.loc);
                    }
                }
                break;
            }
            case "break":
                break;
            case "continue":
                break;
            case "else":
                snode.scope.resetGroups();
                for(let st of snode.statements) {
                    this.checkGroupsInStatement(st, snode.scope);
                }
                break;
            case "if":
                snode.scope.resetGroups();
                if (snode.lhs) {
                    this.checkGroupsInStatement(snode.lhs, snode.scope);
                    this.modifiedVariabes.clear();
                    this.usedVariables.clear();
                }
                this.checkExpression(snode.condition, snode.scope);
                for(let st of snode.statements) {
                    this.checkGroupsInStatement(st, snode.scope);
                }
                if (snode.elseBranch) {
                    this.checkGroupsInStatement(snode.elseBranch, scope);
//                    snode.elseBranch.scope.resetGroups();
//                    for(let st of snode.elseBranch.statements) {
//                        this.checkGroupsInStatement(st, snode.elseBranch.scope);
//                    }
                }
                /*
                if (snode.scopeExit.breaks) {
                    for (let c of snode.scopeExit.breaks) {
                        c.mergeScopes(scope, "reverted_subsequent");
                    }
                }
                if (snode.scopeExit.continues) {
                    for (let c of snode.scopeExit.continues) {
                        c.mergeScopes(scope, "reverted_subsequent");
                    }
                }*/
                if (snode.elseBranch) {
//                    snode.elseBranch.scope.resetGroups();
//                    for(let st of snode.elseBranch.statements) {
//                        this.checkGroupsInStatement(st, snode.elseBranch.scope);
//                    }
                    /*
                    if (snode.elseBranch.scopeExit.breaks) {
                        for (let c of snode.elseBranch.scopeExit.breaks) {
                            c.mergeScopes(scope, "reverted_subsequent");
                        }
                    }
                    if (snode.elseBranch.scopeExit.continues) {
                        for (let c of snode.elseBranch.scopeExit.continues) {
                            c.mergeScopes(scope, "reverted_subsequent");
                        }
                    }
                    */
                    if (snode.scopeExit.fallthrough && snode.elseBranch.scopeExit.fallthrough) {
                        snode.scope.mergeScopes(snode.elseBranch.scope, "conditional");
                        scope.mergeScopes(snode.scope, "subsequent");
                    } else if (snode.scopeExit.fallthrough) {
                        scope.mergeScopes(snode.scope, "conditional");
                    } else if (snode.elseBranch.scopeExit.fallthrough) {
                        scope.mergeScopes(snode.elseBranch.scope, "conditional");
                    }
                } else if (snode.scopeExit.fallthrough) {
                    scope.mergeScopes(snode.scope, "conditional");
                }
                break;
            case "for":
            {
                // This line is required, because the check might run twice when inside a for loop.
                snode.scope.resetGroups();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.lhs) {
                            this.checkGroupsInStatement(snode.condition.lhs, snode.condition.scope);
                            this.modifiedVariabes.clear();
                            this.usedVariables.clear();
                        }
                        if (snode.condition.condition) {
                            this.checkGroupsInExpression(snode.condition.condition, snode.condition.scope, GroupCheckFlags.None);
                        }
                        if (snode.condition.rhs) {
                            this.checkGroupsInStatement(snode.condition.rhs, snode.condition.scope);
                        }
                    } else {
                        this.checkGroupsInStatement(snode.condition, snode.condition.scope);
                    }
                }
                for(let st of snode.statements) {
                    this.checkGroupsInStatement(st, snode.scope);
                }
                let s = snode.scope;
                // Join in all "continues"
                if (snode.scopeExit.continues) {
                    for (let c of snode.scopeExit.continues) {
                        snode.scope.mergeScopes(c, "conditional");
                    }
                }
                // Check groups for a second run.
                for(let st of snode.statements) {
                    this.checkGroupsInStatement(st, s);
                }
                // Join in all "breaks"
                if (snode.scopeExit.breaks) {
                    for (let c of snode.scopeExit.breaks) {
                        scope.mergeScopes(c, "conditional");
                    }
                }
                // Join in the for scope
                if (snode.scopeExit.fallthrough) {
                    scope.mergeScopes(snode.scope, "conditional");
                }
                break;
            }
            case "copy":
            case "move":
                this.checkGroupsInExpression(snode.lhs, scope, GroupCheckFlags.None);
                this.checkGroupsInExpression(snode.rhs, scope, GroupCheckFlags.None);
                break;
            case "slice":
                this.checkGroupsInExpression(snode.parameters[0], scope, GroupCheckFlags.None);
                this.checkGroupsInExpression(snode.parameters[1], scope, GroupCheckFlags.None);
                this.checkGroupsInExpression(snode.parameters[2], scope, GroupCheckFlags.None);
                break;
                /*
            case "spawn":
            {
                this.checkExpression(snode.rhs, scope);
                if (snode.rhs.op != "(") {
                    throw new ImplementationError()
                }
                if (!(snode.rhs.lhs.type instanceof FunctionType)) {
                    throw new ImplementationError()
                }
                if ((snode.rhs.lhs.type as FunctionType).returnType != Static.t_void) {
                    throw new TypeError("Functions invoked via 'spawn' must return void", snode.loc);
                }
                break;
            }
            */
            case "println":
                for(let i = 0; i < snode.parameters.length; i++) {
                    this.checkGroupsInExpression(snode.parameters[i], scope, GroupCheckFlags.None);
                }
                break;
            case "push":
            case "append":
            default:
                this.checkGroupsInExpression(snode, scope, GroupCheckFlags.None);
        }

//        return null;
    }

    private checkGroupsInAssignment(snode: Node, scope: Scope) {
        if (snode.lhs.op == "id") {
            this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
        } else if (snode.lhs.op == "tuple") {
            let t = helper.stripType(snode.rhs.type);
            if (snode.rhs.op == "tuple") {
                for(let i = 0; i < snode.rhs.parameters.length; i++) {
                    this.checkGroupsInSingleAssignment(snode.lhs.parameters[i].type, snode.lhs.parameters[i], null, snode.rhs.parameters[i], false, scope, snode.loc);
                }
            } else {
                let flags = TypeChecker.hasReferenceOrStrongPointers(snode.rhs.type) ? GroupCheckFlags.ForbidIsolates : GroupCheckFlags.AllowIsolates;
                let g = this.checkGroupsInExpression(snode.rhs, scope, flags);
                for (let i = 0; i < snode.lhs.parameters.length; i++) {
                    this.checkGroupsInSingleAssignment(snode.lhs.parameters[i].type, snode.lhs.parameters[i], g instanceof TupleGroup ? g.groups[i] : g, snode.rhs, i+1 < snode.lhs.parameters.length, scope, snode.loc);
                }
            }
        } else if (snode.lhs.op == ".") {
            if (helper.isUnsafePointer(snode.lhs.lhs.type)) {
                return;
            }
            if (helper.isSafePointer(snode.lhs.lhs.type) || helper.isStruct(snode.lhs.lhs.type)) {
                this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
            } else {
                throw new ImplementationError()
            }
        } else if (snode.lhs.op == "[") {
            this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
        } else if (snode.lhs.op == "unary*") {
            this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
        } else {
            throw new ImplementationError()
        }
    }

    private checkGroupsInSingleAssignment(ltype: Type, lnode: Node | Group, rightGroup: Group, rnode: Node, rnodeReuse: boolean, scope: Scope, loc: Location) {
        if (!rnode) {
            throw new ImplementationError()
        }
        // Determine the groups of the LHS and the RHS
        if (!rightGroup) {
            // let isPointer = !helper.isPureValue(rnode.type);
            let flags = TypeChecker.hasReferenceOrStrongPointers(rnode.type) ? GroupCheckFlags.ForbidIsolates : GroupCheckFlags.AllowIsolates;
            rightGroup = this.checkGroupsInExpression(rnode, scope, flags);
        }
        let leftGroup = lnode instanceof Node ? this.checkGroupsInExpression(lnode, scope, GroupCheckFlags.AllowIsolates | GroupCheckFlags.AllowUnavailableVariable) : lnode as Group;

        // What are we assigning to?
        let lhsIsVariable = lnode instanceof Node ? lnode.op == "id" : false;
        let lhsVariable: ScopeElement = null;
        let lhsVariableScope: Scope = null;
        if (lhsIsVariable) {
            [lhsVariable, lhsVariableScope] = scope.resolveElementWithScope((lnode as Node).value);
        }

        // Assigning to a value type? -> Nothing to do.
        // Assigning to a string? -> Nothing to do, because strings are not bound to any group.
        // Assigning to an unsafe pointer -> Nothing to do. Programmer hopefully knows what he is doing ...
        if (helper.isPureValue(ltype) || helper.isPureValue(rnode.type) || helper.isString(ltype) || helper.isUnsafePointer(ltype)) {
            // When assigning to a variable, set its group such that it becomes available
            if (lhsVariable) {
                if (lhsVariable instanceof Variable && lhsVariable.isReferencedWithRefcounting) {
                    // The address of the variable is taken. Therefore, it is restricted to its scope.
                    // Use the bound-group of its scope.
                    scope.setGroup(lhsVariable, lhsVariableScope.group);
                } else {
                    // The variable is free.
                    scope.setGroup(lhsVariable, new Group(GroupKind.Free, lhsVariable.name));
                }
            }
            return;
        }

        // What is assigned?
        let rhsVariableName: string;
        let rhsIsVariable: boolean = false;
        if (rnode.op == "id" || (rnode.op == "take" && rnode.lhs.op == "id")) {
            rhsIsVariable = true;
            rhsVariableName = rnode.op == "id" ? rnode.value : rnode.lhs.value;
        } else if (rnode.op == ":" && (helper.isUnique(rnode.type) || helper.isStrong(rnode.type))) {
            let r = rnode;
            while (r.op == ":" || r.op == "take") {
                r = r.lhs;
            }
            if (r.op == "id") {
                rhsIsVariable = true;
                rhsVariableName = r.value;
            }
        }
        let rhsIsTakeExpr = helper.isTakeExpression(rnode);

        // The right hand side is an expression that evaluates to an isolate, and therefore the group is null
        if (!rightGroup) {
            // The isolate must be taken, even when assigned to a reference
            if (!rhsIsVariable && !rhsIsTakeExpr) {
                throw new TypeError("Assignment of an expression that evaluates to an isolate is only allowed via a variable or take expression", loc);
            }
            if (TypeChecker.hasReferenceOrStrongPointers(rnode.type)) {
                // Accessing a strong pointer or reference inside an isolate is not allowed.
                // This should be guarded by the GroupCheckFlags.ForbidIsolates above. Just being paranoid here.
                throw new ImplementationError()
            }
            rightGroup = new Group(GroupKind.Free);
        }
        let isArrayVariable = function(name: string): boolean {
            let variable = scope.resolveElement(name);
            if (!(variable instanceof Variable)) {
                return false;
            }
            return helper.isArray(variable.type);
        };

        // Assigning to a strong or unique pointer? Then the RHS must let go of its ownership.
        if (TypeChecker.hasStrongOrUniquePointers(ltype) || (!helper.isSafePointer(ltype) && !helper.isSlice(ltype) && !helper.isPureValue(ltype))) {
            if (rhsIsVariable) {
                // Make the RHS variable unavailable, since the LHS is now the owner and there can be one owner only
                if (!rnodeReuse) {
                    let rhsVariable = scope.resolveElement(rhsVariableName);
                    scope.setGroup(rhsVariable, null);
                }
                rnode.flags |= AstFlags.ZeroAfterAssignment;
            } else if (rhsIsTakeExpr) {
                // Nothing special todo
            } else if (rnode.op == "unary&" && rnode.rhs.op == "id") {
                // Nothing special todo. We are referencing a stack variable and this variable remains accessible.
                // The variable may even have multiple owners. No owner can hold it longer than the stack frame exists
                // and the memory is free'd when the stack frame is removed.
            } else if (rnode.op == ":" && rnode.lhs.op == "id" && isArrayVariable(rnode.lhs.value)) {
                // Nothing special todo. We are slicing an array on the stack and this array remains accessible.
                // There may be multiple owning slices pointing to the array data. No owner can hold it longer than the stack frame exists
                // and the memory is free'd when the stack frame is removed.
            } else if (rnode.op == "typeCast" && rnode.rhs.op == "id" && helper.isOrType(rnode.rhs.type)) {
                // Taking ownership from an Or-Type? Then the underlying RHS variable is no longer accessible
                if (!rnodeReuse) {
                    let rhsVariable = scope.resolveElement(rhsVariableName);
                    scope.setGroup(rhsVariable, null);
                }
                rnode.rhs.flags |= AstFlags.ZeroAfterAssignment;
            } else {
                throw new TypeError("Assignment to an owning pointer (or data structure containing an owning pointer) is only allowed from a variable or take expression", loc);
            }
        }

        if (helper.isUnique(ltype)) {
            // Check that the RHS group is unbound, because the RHS is not neccessarily an isolate
            if (rightGroup.isBound(scope)) {
                throw new TypeError("Assignment of a bound group to an isolate is not allowed", loc);
            }
        }

        // Assigning to a variable for the first time, and the unary& operator has been applied on it to create a reference or strong pointer to a stack variable?
        if (!leftGroup && lhsIsVariable && lhsVariable instanceof Variable && lhsVariable.isReferencedWithRefcounting) {
            leftGroup = lhsVariableScope.group;
            scope.setGroup(lhsVariable, leftGroup);
        }

        // The if-clause is true when assigning to a variable that is not global.
        // The purpose of ignoring global is that setGroup should not be executed on a global variable.
        if (lhsIsVariable && (!(lhsVariable instanceof Variable) || (!lhsVariable.isGlobal && !lhsVariable.isReferencedWithRefcounting))) {
            // Determine whether the variable being assigned to holds a value that needs destruction before assigning to it.
            if (scope.elementNeedsDestruction.get(lhsVariable)) {
                (lnode as Node).flags &= ~AstFlags.EmptyOnAssignment;
            } else {
                // The variable being assigned to is currently not accessible.
                // Hence, it has no value that needs to be destructed before assignment.
                (lnode as Node).flags |= AstFlags.EmptyOnAssignment;
            }
            // Set the group of the LHS variable to the RHS group
            scope.setGroup(lhsVariable, rightGroup);
        } else {
            // Assigning to an expression of type unique pointer?
            if (!leftGroup) {
                // Check that the RHS group is unbound
                if (rightGroup.isBound(scope)) {
                    throw new TypeError("Assignment of a bound group to an isolate is not allowed", loc);
                }
                // Make the RHS group unavailable
                scope.makeGroupUnavailable(rightGroup);
            } else {
                // Join RHS and LHS
                scope.joinGroups(leftGroup, rightGroup, loc, true);
            }
        }
    }

    private checkGroupsInExpression(enode: Node, scope: Scope, flags: GroupCheckFlags): Group {
        let origFlags = flags;
        /*
        if ((flags & GroupCheckFlags.IsolatesMask) == 0) {
            if (this.checkIsPointer(enode, false)) {
                flags |= GroupCheckFlags.ForbidIsolates;
            } else {
                flags |= GroupCheckFlags.AllowIsolates;
            }
        }
        */
        flags = flags & GroupCheckFlags.AllowUnavailableVariableMask;

        switch (enode.op) {
            case "null":
                return new Group(GroupKind.Free);
            case "bool":
                break;
            case "str":
                break;
            case "rune":
                break;
            case "int":
                break;
            case "float":
                break;
            case "id":
                // TODO: ellipsis, optional
                let element = scope.resolveElement(enode.value);
                if (!element) {
                    throw new ImplementationError()
                }
                if (element instanceof TemplateFunction) {
                    return new Group(GroupKind.Free);
                }
                let g = scope.resolveGroup(element);
                if (!g || !scope.isGroupAvailable(g)) {
                    if ((origFlags & GroupCheckFlags.AllowUnavailableVariable) == 0) {
                        throw new TypeError("Variable " + element.name + " is not available in this place", enode.loc);
                    }
//                    console.log(element.name + " is not available, but do not care");
                }
                if (element instanceof Variable) {
                    if ((enode.flags & AstFlags.ZeroAfterAssignment) == AstFlags.ZeroAfterAssignment) {
                        if (this.modifiedVariabes.has(element)) {
                            throw new TypeError("Variable " + element.name + " is taken more than once in the same statement", enode.loc);
                        }
                        if (this.usedVariables.has(element)) {
                            throw new TypeError("Variable " + element.name + " is read and taken in the same statement", enode.loc);
                        }
                        this.modifiedVariabes.add(element);
                    } else {
                        if (this.modifiedVariabes.has(element)) {
                            throw new TypeError("Variable " + element.name + " is taken and read in the same statement", enode.loc);
                        }
                        this.usedVariables.add(element);
                    }
                }
                // Accessing a global isolate is like an expression that evaluates to an isolate. Therefore its Group is null
                if (element instanceof Variable && element.isGlobal && helper.isUnique(element.type)) {
                    return null;
                }
//                console.log("Group of " + element.name + " is " + (g ? g.name : null), scope.unavailableGroups);
                return g;
            case "++":
            case "--":
                return this.checkGroupsInExpression(enode.lhs, scope, flags);
            case "unary-":
            case "unary+":
            case "unary^":
            case "unary!":
                return this.checkGroupsInExpression(enode.rhs, scope, flags);
            case "unary&":
            {
                if (helper.isUnique(enode.rhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0) {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                return this.checkGroupsInExpression(enode.rhs, scope, flags | GroupCheckFlags.ForbidIsolates);
            }
            case "unary*":
            {
                if (helper.isUnique(enode.rhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0) {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                let g = this.checkGroupsInExpression(enode.rhs, scope, flags);
                if (helper.isUnique(enode.type)) {
                    return null;
                }
                return g;
            }
            case "+":
            case "*":
            case "/":
            case "-":
            case ">":
            case "<":
            case "<=":
            case ">=":
            case "||":
            case "&&":
            case "&":
            case "|":
            case "^":
            case "&^":
            case "%":
            case "<<":
            case ">>":
            case "==":
            case "!=":
                this.checkGroupsInExpression(enode.lhs, scope, flags);
                this.checkGroupsInExpression(enode.rhs, scope, flags);
                break;
            case ".":
            {
                let type: Type = helper.stripType(enode.lhs.type);
                if (type instanceof PackageType) {
                    break;
                }
                if (helper.isUnique(enode.lhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0 && enode.lhs.op != "id" && enode.lhs.op != "(") {
                    throw new TypeError("Accessing a member in an isolate is not allowed in this place", enode.loc);
                }
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags);
                if (helper.isUnique(enode.type)) {
                    return null;
                }
                return g;
            }
            case ":":
            {
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags);
                if (enode.parameters[0]) {
                    this.checkGroupsInExpression(enode.parameters[0], scope, (flags | GroupCheckFlags.NoSideEffects) & GroupCheckFlags.NotIsolateMask);
                }
                if (enode.parameters[1]) {
                    this.checkGroupsInExpression(enode.parameters[1], scope, (flags | GroupCheckFlags.NoSideEffects) & GroupCheckFlags.NotIsolateMask);
                }
                if (helper.isUnique(enode.lhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0 && enode.lhs.op != "id" && enode.lhs.op != "(") {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                return g;
            }
            case "[":
            {
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags);
                this.checkGroupsInExpression(enode.rhs, scope, (flags | GroupCheckFlags.NoSideEffects) & GroupCheckFlags.NotIsolateMask);
                if (helper.isUnique(enode.lhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0 && enode.lhs.op != "id" && enode.lhs.op != "(") {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                if (helper.isUnique(enode.type)) {
                    return null;
                }
                return g;
            }
            case "spawn":
            case "(":
            {
                if (enode.op == "spawn") {
                    enode = enode.rhs;
                }
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags | GroupCheckFlags.ForbidIsolates);
//                if (!g) {
//                    throw new ImplementationError()
//                }
                // When calling a non-member function, the default group is determined by the first parameter.
                if (enode.lhs.op == "id") {
                    g = null;
                }
                let t = helper.stripType(enode.lhs.type);
                if (!(t instanceof FunctionType)) {
                    throw new ImplementationError()
                }
                return this.checkGroupsInFunctionArguments(t, g, enode.parameters, scope, enode.loc);
            }
            case "genericInstance":
                // return this.checkGroupsInExpression(enode.lhs, scope, flags);
                return new Group(GroupKind.Free);
            case "make":
            {
                if (enode.parameters.length > 0) {
                    this.checkGroupsInExpression(enode.parameters[0], scope, flags);
                    if (enode.parameters.length == 2) {
                        this.checkGroupsInExpression(enode.parameters[1], scope, flags);
                    }
                }
                // The new array has been created on the heap.
                // Therefore, it belongs to a new free group.
                return new Group(GroupKind.Free)
            }
            case "tuple":
            {
                let group: Group = null;
                for(let p of enode.parameters) {
                    let g = this.checkGroupsInExpression(p, scope, flags & GroupCheckFlags.NotIsolateMask);
                    if (!group) {
                        group = g;
                    } else {
                        group = scope.joinGroups(group, g, enode.loc, true);
                    }
                }
                if (!group) {
                    return new Group(GroupKind.Free);
                }
                return group;
            }
            case "array":
            {
                let t = enode.type;
                if (helper.isSlice(enode.type)) {
                    t = this.sliceArrayType(t);
                }
                let group: Group = null;
                if (enode.parameters) {
                    for(var i = 0; i < enode.parameters.length; i++) {
                        let p = enode.parameters[i];
                        if (p.op == "...") {
                            continue;
                        }
                        let g = this.checkGroupsInExpression(p, scope, flags & GroupCheckFlags.NotIsolateMask);
                        if (!group) {
                            group = g;
                        } else {
                            group = scope.joinGroups(group, g, enode.loc, true);
                        }
                    }
                }
                if (!group) {
                    return new Group(GroupKind.Free);
                }
                return group;
            }
            case "object":
            {
                let t = enode.type;
                if (helper.isSafePointer(enode.type)) {
                    t = this.pointerElementType(t);
                }
                t = helper.stripType(t);
                let group: Group = null;
                if (t instanceof StructType) {
                    if (enode.parameters) {
                        for(let p of enode.parameters) {
                            let g = this.checkGroupsInExpression(p.lhs, scope, flags & GroupCheckFlags.NotIsolateMask);
                            if (!group) {
                                group = g;
                            } else {
                                group = scope.joinGroups(group, g, enode.loc, true);
                            }
                        }
                    }
                } else if (t instanceof MapType) {
                    throw new TodoError()
                }
                if (!group) {
                    return new Group(GroupKind.Free);
                }
                return group;
            }
            /*
            case "=>":
            {
                let f = new Function();
                f.loc = enode.loc;
                f.node = enode;
                f.scope = new Scope(scope);
                f.scope.func = f;
                f.type = new FunctionType();
                f.type.loc = enode.loc;
                enode.scope = f.scope;
                enode.type = f.type;
                if (enode.parameters) {
                    for(let pnode of enode.parameters) {
                        let original_pnode = pnode;
                        var p = new FunctionParameter();
                        if (pnode.op == "ellipsisParam") {
                            p.ellipsis = true;
                            pnode = pnode.lhs;
                        }
                        p.name = pnode.name.value;
                        for(let param of f.type.parameters) {
                            if (param.name == p.name) {
                                throw new TypeError("Duplicate parameter name " + p.name, pnode.loc);
                            }
                        }
                        p.type = this.injectVariableBoxes(this.createType(pnode, enode.scope, "parameter"), "parameter");
                        if (p.ellipsis && !(p.type instanceof SliceType)) {
                            throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                        }
                        p.loc = pnode.loc;
                        f.type.parameters.push(p);
                        f.scope.registerElement(p.name, p);
                    }
                }
                if (enode.lhs) {
                    f.type.returnType = this.createType(enode.lhs, f.scope, "parameter");
                    if (enode.lhs.op == "tupleType") {
                        for(let i = 0; i < enode.lhs.parameters.length; i++) {
                            let pnode = enode.lhs.parameters[i];
                            if (pnode.name) {
                                let v = new Variable();
                                v.isResult = true;
                                v.loc = pnode.loc;
                                v.name = pnode.name.value;
                                v.type = this.injectVariableBoxes((f.type.returnType as TupleType).types[i], "variable");
                                f.scope.registerElement(v.name, v);
                                f.namedReturnTypes = true;
                            }
                        }
                    }
                }
                if (enode.rhs) {
                    this.checkExpression(enode.rhs, enode.scope);
                    if (!f.type.returnType) {
                        f.type.returnType = enode.rhs.type;
                    } else {
                        this.checkIsAssignableNode(f.type.returnType, enode.rhs);
                    }
                } else {
                    for(let s of enode.statements) {
                        this.checkStatement(s, enode.scope);
                    }
                }
                break;
            }
            */
            case "is":
            {
                this.checkGroupsInExpression(enode.lhs, scope, flags);
                break;
            }
            case "typeCast":
            {
                // Converting a slice of bytes to a string, freezes the slice.
                // This is similar to assigning the slice to a unique slice.
                if (enode.type == Static.t_string && helper.isSlice(enode.rhs.type)) {
                    let g = this.checkGroupsInExpression(enode.rhs, scope, flags);
                    this.checkGroupsInSingleAssignment(new SliceType(new ArrayType(Static.t_byte, -1), "unique"), null, g, enode.rhs, false, scope, enode.loc);
                    return null;
                }
                if (helper.isSlice(enode.type) && enode.rhs.type == Static.t_string && !helper.isConst(enode.type)) {
                    // Converting a string to a non-const slice implies copying it.
                    // The returned copy belongs to a free group.
                    return new Group(GroupKind.Free);
                }
                return this.checkGroupsInExpression(enode.rhs, scope, flags);
            }
            case "take":
                if ((flags & GroupCheckFlags.NoSideEffects) != 0) {
                    throw new TypeError("Expression with side effects is not allowed in this place", enode.loc);
                }
                return this.checkGroupsInExpression(enode.lhs, scope, flags);
            case "cap":
            case "len":
                this.checkGroupsInExpression(enode.lhs, scope, flags);
                return null;
            case "sizeof":
            case "aligned_sizeof":
            case "max":
            case "min":
                return null;
            case "clone":
                this.checkGroupsInExpression(enode.lhs, scope, flags);
                return new Group(GroupKind.Free);
            case "pop":
                return this.checkGroupsInExpression(enode.lhs, scope, flags);
            case "push":
            case "tryPush":
            case "append":
            {
                let group: Group;
                let ltype: Type;
                for(let i = 0; i < enode.parameters.length; i++) {
                    let p = enode.parameters[i];
                    let g = this.checkGroupsInExpression(p.op == "unary..." ? p.rhs : p, scope, GroupCheckFlags.None);
                    if (i == 0) {
                        group = g;
                        ltype = (RestrictedType.strip(p.type) as SliceType).getElementType();
                    } else {
                        if (p.op == "unary...") {
                            if (!helper.isPureValue(ltype)) {
                                // TODO: Could be realized. Might need to zero the slice
                                throw new TypeError("Appending a slice of pointers is not supported.", p.loc);
                            }
                        } else {
                            // Appending a pointer-like type? Then we must care about the groups involved
                            if (helper.isSafePointer(p.type) || helper.isSlice(p.type)) {
                                this.checkGroupsInSingleAssignment(ltype, group, g, p, false, scope, p.loc);
                            }
                        }
                    }
                }
                if (enode.op == "append") {
                    return group;
                }
                return null;
            }
            case "resume":
                this.checkGroupsInExpression(enode.lhs, scope, flags);
                return null;
            case "coroutine":
                return this.globalGroup;
            default:
                throw new ImplementationError(enode.op)
        }
        return null;
    }

    public checkGroupsInFunctionArguments(ft: FunctionType, defaultGroup: Group, args: Array<Node> | null, scope: Scope, loc: Location): Group {
        let groups: Map<string, Group> = new Map<string, Group>();
        if (defaultGroup) {
            groups.set("default", defaultGroup);
        }
        if (args) {
            for(let i = 0; i < args.length; i++) {
                let rnode: Node;
                let ltype: Type;
                let param: FunctionParameter;
                if (args[i].op == "unary...") {
                    param = ft.lastParameter();
                    rnode = args[i].rhs;
                    ltype = param.type;
                } else {
                    if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                        param = ft.lastParameter();
                        ltype = this.arrayElementType(this.sliceArrayType(param.type as SliceType));
                    } else {
                        param = ft.parameters[i];
                        ltype = param.type;
                    }
                    rnode = args[i];
                }
                let name = param.type.groupName;
                if (!name || name == "") {
                    name = "default";
                }
                let g: Group;
                if (helper.isUnique(ltype)) {
                    g = null;
                } else if (groups.has(name)) {
                    g = groups.get(name);
                } else {
                    g = new Group(GroupKind.Free, param.name);
                    groups.set(name, g);
                }
                this.checkGroupsInSingleAssignment(ltype, g, null, rnode, false, scope, loc);
            }
        }

        // Void function?
        if (!ft.returnType || ft.returnType == Static.t_void) {
            return null;
        }
        // The function returns a tuple type?
        if (ft.returnType instanceof TupleType) {
            let tupleg = new TupleGroup(GroupKind.Free);
            for(let i = 0; i < ft.returnType.types.length; i++) {
                let t = ft.returnType.types[i];
                let name = t.groupName;
                if (!name || name == "") {
                    name = "default";
                }
                let g: Group;
                if (helper.isUnique(t)) {
                    g = new Group(GroupKind.Free);
                } else if (groups.has(name)) {
                    g = groups.get(name);
                } else {
                    let kind = GroupKind.Free;
                    if (TypeChecker.hasReferenceOrStrongPointers(t)) {
                        kind = GroupKind.Bound;
                    }
                    g = new Group(kind);
                    groups.set(name, g);
                }
                tupleg.groups.push(g);
            }
            return tupleg;
        }
        // Only one type is returned
        let name = ft.returnType.groupName;
        if (!name || name == "") {
            name = "default";
        }
        let g: Group;
        if (groups.has(name) && !helper.isUnique(ft.returnType)) {
            return groups.get(name);
        }
        let kind = GroupKind.Free;
        if (TypeChecker.hasReferenceOrStrongPointers(ft.returnType)) {
            kind = GroupKind.Bound;
        }
        return new Group(kind, "return");
    }

    public hasTemplateInstantiations(): boolean {
        return (this.templateFunctionInstantiations.size != 0 || this.templateTypeInstantiations.size != 0);
    }

    /**
     * List of all interfaces. These are checked for possible errors after they have been defined.
     */
    public ifaces: Array<InterfaceType> = [];
    public structs: Array<StructType> = [];
    public templateTypeInstantiations: Map<TemplateType, Array<TemplateStructType | TemplateInterfaceType | TemplateFunctionType>> = new Map<TemplateType, Array<TemplateStructType | TemplateInterfaceType | TemplateFunctionType>>();
    public templateFunctionInstantiations: Map<TemplateType, Array<Function>> = new Map<TemplateType, Array<Function>>();
    public pkg: Package;

    private typedefs: Array<Typedef> = [];
    private functions: Array<Function> = [];
    public globalVariables: Array<Variable> = [];

    private stringLiteralTypes: Map<string, StringLiteralType> = new Map<string, StringLiteralType>();
    private moduleNode: Node;

    private globalGroup: Group;
    /**
     * During group checking, the compiler verifies that a variable that is taken in a statement,
     * is not used a second time in the statement.
     */
    private modifiedVariabes: Set<Variable> = new Set<Variable>();
    /**
     * During group checking, the compiler verifies that a variable that is taken in a statement,
     * is not used a second time in the statement.
     */
    private usedVariables: Set<Variable> = new Set<Variable>();
}
