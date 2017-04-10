import {Node, NodeOp, Location} from "./ast"

export interface ScopeElement {
    name: string;
    type: Type;
    loc: Location;
}

export class Variable implements ScopeElement {
    public isConst: boolean;
    public name: string;
    public type: Type;
    public loc: Location;
}

export class Function implements ScopeElement {
    constructor() {
        this.scope = new Scope(null);
        this.scope.func = this;
    }

    public name: string;
    public type: FunctionType;
    public namedReturnTypes: boolean;
    public scope: Scope;
    public node: Node;
    public loc: Location;
}

export class TypeDef implements ScopeElement {
    public name: string;
    public type: Type;
    public loc: Location;
}

export class Scope {
    constructor(parent: Scope) {
        this.parent = parent;
        this.elements = new Map<string, ScopeElement>();
        this.types = new Map<string, Type>();
    }

    public resolveElement(name: string): ScopeElement {
        let t = this.elements.get(name);
        if (!t) {
            if (this.parent) {
                return this.parent.resolveElement(name);
            }
            return null;
        }
        return t;
    }

    public resolveType(name: string): Type {
        let t = this.types.get(name);
        if (!t) {
            if (this.parent) {
                return this.parent.resolveType(name);
            }
            return null;
        }
        return t;
    }

    /**
     * @param name
     * @param element 
     */
    public registerType(name: string, type: Type, loc: Location = null) {
        if (this.elements.has(name)) {
            // TODO: Output file name
            throw new TypeError("Duplicate type " + name + "." + this.elements.get(name).loc ? "Already defined in " + this.elements.get(name).loc.start.line : "", loc);
        }
        this.types.set(name, type);
        return null;
    }

    /**
     * @param name
     * @param element 
     */
    public registerElement(name: string, element: ScopeElement) {
        if (this.elements.has(name)) {
            // TODO: Output file name
            throw new TypeError("Duplicate identifier " + name + ", already defined in " + this.elements.get(name).loc.start.line, element.loc);
        }
        this.elements.set(name, element);
        return null;
    }

    public envelopingFunction(): Function {
        if (this.func) {
            return this.func;
        }
        if (this.parent) {
            return this.parent.envelopingFunction();
        }
        return null;
    }

    public isInForLoop(): boolean {
        if (this.forLoop) {
            return true;
        }
        if (this.parent) {
            return this.parent.isInForLoop();
        }
        return false;
    }

    public func: Function;
    public forLoop: boolean;
    public elements: Map<string, ScopeElement>;
    public types: Map<string, Type>;
    public parent: Scope | undefined;
}

export interface GenericType {
    genericParameterNames: Array<string>;
    genericParameterTypes: Array<Type>;
}

export interface GenericInstanceType {
    genericParameterTypes: Array<Type>;
}

export abstract class Type {
    public name: string;
    public loc: Location;
}

export class BasicType extends Type {
    constructor(name: "void" | "string" | "bool" | "float" | "double" | "null" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64") {
        super();
        this.name = name;
    }
}

export class GenericConstraintType extends Type {
    constructor(name: "any" | "number" | "snumber" | "struct" | "class") {
        super();
        this.name = name;
    }
}

export class InterfaceType extends Type {
}

export class FunctionParameter implements ScopeElement {
    public name: string;
    public ellipsis: boolean;
    public optional: boolean;
    public type: Type;
    public loc: Location;
}

export class FunctionType extends Type {
    constructor() {
        super();
        this.parameters = [];
    }

    public get name(): string {
        let name = "("
        for(let p of this.parameters) {
            if (name != "(") {
                name += ",";
            }
            if (p.ellipsis) {
                name += "...";
            }
            name += p.type.name;
            if (p.optional) {
                name += "?";
            }
        }
        name += ") => " + this.returnType.name;
        return name;
    }

    public hasEllipsis(): boolean {
        return (this.parameters.length > 0 && this.parameters[this.parameters.length - 1].ellipsis)
    }

    public lastParameter(): FunctionParameter {
        return this.parameters[this.parameters.length - 1];
    }

    public requiredParameterCount(): number {
        let i = 0;
        for(let t of this.parameters) {
            if (!t.optional && !t.ellipsis) {
                i++;
            }
        }
        return i;
    }

    public returnType: Type;
    public parameters: Array<FunctionParameter>;
}

export class GenericFunctionType extends FunctionType implements GenericType {
    constructor() {
        super();
        this.genericParameterNames = [];
        this.genericParameterTypes = [];
    }

    public genericParameterNames: Array<string>;
    public genericParameterTypes: Array<Type>;
    public node: Node;
}

export class GenericFunctionInstanceType extends FunctionType {
    constructor() {
        super();
        this.genericParameterTypes = [];
    }

    public base: GenericFunctionType;
    public genericParameterTypes: Array<Type>;    
}

export class ClassType extends Type {
    // TODO
}

export class GenericClassType extends ClassType implements GenericType {
    constructor() {
        super();
        this.genericParameterTypes = [];
        this.genericParameterNames = [];
    }

    public genericParameterTypes: Array<Type>;
    public genericParameterNames: Array<string>;
}

export class GenericClassInstanceType extends ClassType {
    constructor() {
        super();
        this.genericParameterTypes = [];
    }

    public base: GenericClassType;
    public genericParameterTypes: Array<Type>;    
}

export class PointerType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
        this.name = "*" + this.elementType.name;
    }

    public elementType: Type;
}

export class ArrayType extends Type {
    constructor(elementType: Type, size: number) {
        super();
        this.elementType = elementType;
        this.size = size;
        this.name = "[" + size.toString() + "]" + this.elementType.name;
    }

    public elementType: Type;
    public size: number;
}

export class SliceType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
        this.name = "[]" + this.elementType.name;
    }

    public elementType: Type;
}

export class ArrayLiteralType extends Type {
    constructor(types: Array<Type>) {
        super();
        this.types = types;        
    }

    public get name() : string {
        let name = "literal[";
        for(let t of this.types) {
            if (name == "literal[") {
                name += t.name;
            } else {
                name += "," + t.name;
            }
        }
        name += "]";
        return name;
    }

    public types: Array<Type>;
}

export class ObjectLiteralType extends Type {
    constructor(types: Map<string, Type>) {
        super();
        this.types = types;        
    }

    public get name() : string {
        let name = "literal{";
        for(let t of this.types.keys()) {
            if (name == "literal{") {
                name += t + ": " + this.types.get(t).name;
            } else {
                name += "," + t + ": " + this.types.get(t).name;
            }
        }
        name += "}";
        return name;
    }

    public types: Map<string, Type>;
}

export class TupleType extends Type {
    constructor(types: Array<Type>) {
        super();
        this.types = types;
    }

    public get name(): string {
        let name = "(";
        for(let t of this.types) {
            if (name == "(") {
                name += t.name;
            } else {
                name += "," + t.name;
            }
        }
        name += ")";
        return name;
    }

    public types: Array<Type>;
}

export class TupleLiteralType extends Type {
    constructor(types: Array<Type>) {
        super();
        this.types = types;
    }

    public get name(): string {
        let name = "literal(";
        for(let t of this.types) {
            if (name == "literal(") {
                name += t.name;
            } else {
                name += "," + t.name;
            }
        }
        name += ")";
        return name;
    }

    public types: Array<Type>;
}

export class OrType extends Type {
    public types: Array<Type> = [];

    public get name(): string {
        let name = "";
        for(let v of this.types) {
            if (name == "") {
                name += v.name;
            } else {
                name += " | " + v.name;
            }
        }
        return name;
    }
}

export class AndType extends Type {
    public types: Array<Type> = [];

    public get name(): string {
        let name = "";
        for(let v of this.types) {
            if (name == "") {
                name += v.name;
            } else {
                name += " & " + v.name;
            }
        }
        return name;
    }
}

export class StringEnumType extends Type {
    public values: Map<string, number> = new Map<string, number>();

    public get name(): string {
        let name = "";
        for(let v of this.values.keys()) {
            if (name == "") {
                name += "\"" + v + "\"";
            } else {
                name += " | \"" + v + "\"";
            }
        }
        return name;
    }
}

export class TypeChecker {
    constructor() {
        this.t_bool = new BasicType("bool");
        this.t_float = new BasicType("float");
        this.t_double = new BasicType("double");
        this.t_any = new GenericConstraintType("any");
        this.t_null = new BasicType("null");
        this.t_int8 = new BasicType("int8");
        this.t_int16 = new BasicType("int8");
        this.t_int32 = new BasicType("int32");
        this.t_int = this.t_int32;
        this.t_int64 = new BasicType("int64");
        this.t_uint8 = new BasicType("uint8");
        this.t_byte = this.t_uint8;
        this.t_uint16 = new BasicType("uint16");
        this.t_uint32 = new BasicType("uint32");
        this.t_uint = this.t_uint32;
        this.t_uint64 = new BasicType("uint64");
        this.t_string = new BasicType("string");
        this.t_map = new GenericClassType();
        this.t_map.name = "map";
        this.t_map.genericParameterTypes.push(this.t_any);
        this.t_map.genericParameterNames.push("Key");
        this.t_map.genericParameterTypes.push(this.t_any);
        this.t_map.genericParameterNames.push("Value");
        this.t_json = new ClassType();
        this.t_json.name = "json";
        this.t_void = new BasicType("void");
        this.t_error = new InterfaceType();
        this.t_error.name = "error";
    }

    public createScope(): Scope {
        let s = new Scope(null);
        s.registerType("bool", this.t_bool);
        s.registerType("float", this.t_float);
        s.registerType("double", this.t_double);
        s.registerType("null", this.t_null);
        s.registerType("byte", this.t_byte);
        s.registerType("int8", this.t_int8);
        s.registerType("int16", this.t_int16);
        s.registerType("int32", this.t_int32);
        s.registerType("int", this.t_int);
        s.registerType("int64", this.t_int64);
        s.registerType("uint8", this.t_uint8);
        s.registerType("uint16", this.t_uint16);
        s.registerType("uint32", this.t_uint32);
        s.registerType("uint", this.t_uint32);
        s.registerType("uint64", this.t_uint64);
        s.registerType("string", this.t_string);
        s.registerType("map", this.t_map);
        s.registerType("json", this.t_json);
        s.registerType("void", this.t_void);
        s.registerType("error", this.t_error);
        return s;
    }

    public createType(tnode: Node, scope: Scope): Type {
        if (tnode.op == "basicType") {
            let t = scope.resolveType(tnode.value);
            if (!t) {
                throw new TypeError("Unknown type " + tnode.value, tnode.loc);
            }
            return t;
        } else if (tnode.op == "pointerType") {
            let t = new PointerType(this.createType(tnode.rhs, scope));
            t.name = "*" + t.elementType.name;
            return t;
        } else if (tnode.op == "sliceType") {
            let t = new SliceType(this.createType(tnode.rhs, scope));
            t.name = "[]" + t.elementType.name;
            return t
        } else if (tnode.op == "tupleType") {
            let types: Array<Type> = [];
            for(let p of tnode.parameters) {
                let pt = this.createType(p, scope);
                types.push(pt);
            }
            let t = new TupleType(types);
            return t;
        } else if (tnode.op == "arrayType") {
            this.checkExpression(tnode.lhs, scope);
            if (tnode.lhs.op != "int") {
                throw new TypeError("Expected a constant number for array size", tnode.lhs.loc);
            }
            // TODO: Check range before parseInt
            let t = new ArrayType(this.createType(tnode.rhs, scope), parseInt(tnode.lhs.value));
            t.name = "[" + t.size.toString() + "]" + t.elementType.name;
            return t;
        } else if (tnode.op == "funcType") {
            let t = new FunctionType();
            t.loc = tnode.loc;
            let hasOptional = false;
            if (tnode.parameters) {
                for(let pnode of tnode.parameters) {
                    var p = new FunctionParameter();
                    if (pnode.op == "ellipsisParam") {
                        p.ellipsis = true;
                        pnode = pnode.lhs;
                    } else if (pnode.op == "defaultParam") {
                        p.optional = true;
                        pnode = pnode.lhs;
                        hasOptional = true;
                    } else if (hasOptional) {
                        throw new TypeError("Required function parameter following optional function parameter", pnode.loc);
                    }
                    if (pnode.name) {
                        p.name = pnode.name.value;
                        for(let param of t.parameters) {
                            if (param.name == p.name) {
                                throw new TypeError("Duplicate parameter name " + p.name, pnode.loc);
                            }
                        }
                    }
                    p.type = this.createType(pnode, scope);
                    if (p.ellipsis && !(p.type instanceof SliceType)) {
                        throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                    }
                    p.loc = pnode.loc;
                    t.parameters.push(p);
                }
            }
            if (tnode.rhs) {
                t.returnType = this.createType(tnode.rhs, scope);
            }
            return t;
        } else if (tnode.op == "genericType" || tnode.op == "genericInstance") {
            let baset: Type;
            if (tnode.op == "genericType") {
                baset = scope.resolveType(tnode.lhs.value);
                if (!baset) {
                    throw new TypeError("Unknown type " + tnode.lhs.value, tnode.loc);
                }
            } else {
                baset = tnode.lhs.type;
            }
            if (baset instanceof GenericClassType) {
                let ct = new GenericClassInstanceType();
                if (baset.genericParameterTypes.length != tnode.genericParameters.length) {
                    throw new TypeError("Supplied parameters do not match generic parameter types of " + baset.name, tnode.loc);
                }
                let mapping = new Map<Type, Type>();
                ct.loc = tnode.loc;
                ct.base = baset;
                ct.name = baset.name + "<";
                for(let i = 0; i < tnode.genericParameters.length; i++) {
                    let pnode = tnode.genericParameters[i];
                    let pt = this.createType(pnode, scope);
                    ct.genericParameterTypes.push(pt);
                    // TODO: Check that pt extends baset.genericParameterTypes[i]
                    mapping.set(pt, baset.genericParameterTypes[i]);
                    if (i == 0) {
                        ct.name += pt.name;
                    } else {
                        ct.name += "," + pt.name;
                    }
                }
                ct.name += ">"
                // TODO: Instantiate the type of ct, e.g. all function signatures and properties.
                return ct;
            } else if (baset instanceof GenericFunctionType) {
                let ft = new GenericFunctionInstanceType();
                let s = new Scope(scope);
                ft.base = baset;
                ft.loc = tnode.loc;
                for(let i = 0; i < tnode.genericParameters.length; i++) {
                    let pnode = tnode.genericParameters[i];
                    let pt = this.createType(pnode, scope);
                    ft.genericParameterTypes.push(pt);
                    // TODO: Check that pt extends baset.genericParameterTypes[i]
                    s.registerType(baset.genericParameterNames[i], pt);
                }
                let fnode = baset.node;
                if (fnode.parameters) {
                    for(let pnode of fnode.parameters) {
                        var p = new FunctionParameter();
                        if (pnode.op == "ellipsisParam") {
                            p.ellipsis = true;
                            pnode = pnode.lhs;
                        } else if (pnode.op == "defaultParam") {
                            p.optional = true;
                            pnode = pnode.lhs;
                        }
                        if (pnode.name) {
                            p.name = pnode.name.value;
                        }
                        p.type = this.createType(pnode, s);
                        p.loc = pnode.loc;
                        ft.parameters.push(p);
                    }
                }
                if (fnode.rhs) {
                    ft.returnType = this.createType(fnode.rhs, s);
                }
                return ft;
            }
            throw new TypeError("Type " + baset.name + " is not a generic type", tnode.loc);
        } else if (tnode.op == "orType") {
            let stringCount = 0;
            let stringEnumCount = 0;
            for(let pnode of tnode.parameters) {
                if (pnode.op == "strType") {
                    stringCount++;
                } else if (pnode.op == "id") {
                    let t = scope.resolveType(pnode.value);
                    if (t instanceof StringEnumType) {
                        stringEnumCount++;
                    }
                }
            }
            if (stringCount + stringEnumCount == tnode.parameters.length) {
                let t = new StringEnumType();
                let j = 0;
                for(let i = 0; i < tnode.parameters.length; i++) {
                    let pnode = tnode.parameters[i];
                    if (pnode.op == "strType") {
                        t.values.set(pnode.value, j++);
                    } else {
                        let se = scope.resolveType(pnode.value) as StringEnumType;
                        for(let key of se.values.keys()) {
                            t.values.set(key, j++);
                        } 
                    }
                }
                return t;
            }
            let stype: StringEnumType;
            if (stringCount > 0) {
                stype = new StringEnumType();
                for(let i = 0; i < tnode.parameters.length; i++) {
                    let pnode = tnode.parameters[i];
                    if (pnode.op == "strType") {
                        stype.values.set(pnode.value, i);
//                        tnode.parameters.splice(i, 1);
//                    } else {
//                        i++;
                    }
                }
            }
            let t = new OrType();
            if (stype) {
                t.types.push(stype);
            }
            for(let i = 0; i < tnode.parameters.length; i++) {
                let pnode = tnode.parameters[i];
                if (pnode.op == "strType") {
                    continue;
                }
                let pt = this.createType(pnode, scope);
                if (pt instanceof OrType) {
                    t.types = t.types.concat(pt.types);
                }
                t.types.push(pt);
            }
            return t;
        } else if (tnode.op == "andType") {
            let t = new AndType();
            for(let i = 0; i < tnode.parameters.length; i++) {
                let pnode = tnode.parameters[i];
                let pt = this.createType(pnode, scope);
                if (pt instanceof OrType) {
                    t.types = t.types.concat(pt.types);
                }
                t.types.push(pt);
            }
            return t;
        }
        throw "TODO type " + tnode.op
    }
    
    public createFunction(fnode: Node, scope: Scope): Function {
        var f: Function = new Function();
        f.name = fnode.name.value;
        f.scope.parent = scope;
        f.node = fnode;
        f.loc = fnode.loc;
        if (fnode.genericParameters) {
            let gt = new GenericFunctionType();
            gt.node = fnode;
            for(let g of fnode.genericParameters) {
                let t: Type;
                if (!g.condition) {
                    t = this.t_any;
                } else {
                    t = this.createType(g.condition, f.scope);
                }
                f.scope.registerType(g.value, t, fnode.loc);
                gt.genericParameterNames.push(g.value);
                gt.genericParameterTypes.push(t);
            }            
            f.type = gt;
        } else {
            f.type = new FunctionType();
        }
        f.type.loc = fnode.loc;
        if (fnode.parameters) {
            for(let pnode of fnode.parameters) {
                let original_pnode = pnode;
                var p = new FunctionParameter();
                if (pnode.op == "ellipsisParam") {
                    p.ellipsis = true;
                    pnode = pnode.lhs;
                } else if (pnode.op == "defaultParam") {
                    p.optional = true;
                    this.checkExpression(pnode.rhs, f.scope);
                    pnode = pnode.lhs;
                }
                if (pnode.name) {
                    p.name = pnode.name.value;
                    for(let param of f.type.parameters) {
                        if (param.name == p.name) {
                            throw new TypeError("Duplicate parameter name " + p.name, pnode.loc);
                        }
                    }
                }
                p.type = this.createType(pnode, f.scope);
                if (p.ellipsis && !(p.type instanceof SliceType)) {
                    throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                }
                if (p.optional) {
                    this.checkIsAssignableNode(p.type, original_pnode.rhs);
                }
                p.loc = pnode.loc;
                f.type.parameters.push(p);
                f.scope.registerElement(p.name, p);
            }
        }
        if (fnode.rhs) {
            f.type.returnType = this.createType(fnode.rhs, f.scope);
            if (fnode.rhs.op == "tupleType") {
                for(let i = 0; i < fnode.rhs.parameters.length; i++) {
                    let pnode = fnode.rhs.parameters[i];
                    if (pnode.name) {
                        let v = new Variable();
                        v.loc = pnode.loc;
                        v.name = pnode.name.value;
                        v.type = (f.type.returnType as TupleType).types[i];
                        f.scope.registerElement(v.name, v);
                    }
                }
                f.namedReturnTypes = true;
            }
        } else {
            f.type.returnType = this.t_void;
        }

        scope.registerElement(f.name, f);
        this.checkFunctionBody(f);

        return f;
    }

    private createVar(vnode: Node, scope: Scope, needType: boolean = true): Variable {
        let v = new Variable();
        v.loc = vnode.loc;
        v.name = vnode.value;
        if (!vnode.rhs) {
            if (needType) {
                throw new TypeError("Variable declaration of " + vnode.value + " without type information", vnode.loc);
            }
        } else {
            v.type = this.createType(vnode.rhs, scope);
        }
        if (v.name != "_") {
            scope.registerElement(v.name, v);
        }
        return v;
    }

    public checkFunctionBody(f: Function) {
        if (f.node.statements) {
            for(let snode of f.node.statements) {
                this.checkStatement(snode, f.scope);
            }
        }
        let needsReturn = !!f.node.rhs;
        if (needsReturn) {
            if (!f.node.statements) {
                throw new TypeError("Mising return at end of function", {start: f.loc.end, end: f.loc.end});
            }
            let hasReturn = false;
            for(let i = f.node.statements.length - 1; i >= 0; i--) {
                let s = f.node.statements[i];
                if (s.op == "comment") {
                    continue;
                }
                if (s.op == "return") {
                    hasReturn = true;
                    break;
                }
            }
            if (!hasReturn) {
                throw new TypeError("Mising return at end of function", {start: f.loc.end, end: f.loc.end});
            }
        }
    }

    public checkVarAssignment(isConst: boolean, scope: Scope, vnode: Node, rtype: Type, rnode: Node = null, jsonErrorIsHandled: boolean = false) {
        if (vnode.op == "id" || vnode.op == "optionalId") {
            let v = this.createVar(vnode, scope, false);
            v.isConst = isConst;
            if (!v.type) {
                if (rtype instanceof ArrayLiteralType || rtype instanceof TupleLiteralType || rtype instanceof ObjectLiteralType) {
                    v.type = this.defaultLiteralType(rnode);
                } else {
                    v.type = rtype;
                }
            } else {
                if (rnode) {
                    this.checkIsAssignableNode(v.type, rnode, jsonErrorIsHandled);
                } else {
                    this.checkIsAssignableType(v.type, rtype, vnode.loc, true, jsonErrorIsHandled);
                }
            }
        } else if (vnode.op == "tuple") {
            if (rtype == this.t_json) {
                if (vnode.parameters.length != 2) {
                    throw new TypeError("Expected a tuple of length two", vnode.loc);
                }
                this.checkVarAssignment(isConst, scope, vnode.parameters[0], this.t_json, null, true);
                return;
            }
            if (!(rtype instanceof TupleType) && !(rtype instanceof TupleLiteralType)) {
                throw new TypeError("Expected tuple expression or json on right hand side", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (i >= rtype.types.length) {
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
                    let v = this.createVar(p, scope, false);
                    v.isConst = isConst;
                    if (!v.type) {
                        v.type = new TupleType(rtype.types.slice(i));
                    } else {
                        if (!(v.type instanceof TupleType)) {
                            throw new TypeError("Ellipsis identifier in a tuple context must be of tuple type", vnode.loc);
                        }
                        if (v.type.types.length != rtype.types.length - i) {
                            throw new TypeError("Mismatch in tuple type length", vnode.loc);                                                
                        }
                        if (rnode && rnode.op == "tuple") {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                let r = rnode.parameters[j];
                                this.checkIsAssignableNode(v.type.types[j-i], r);
                            }
                        } else {
                            this.checkIsAssignableType(v.type, new TupleType(rtype.types.slice(i)), vnode.loc);
                        }
                    }
                    break;
                } else {
                    let r: Node;
                    if (rnode && rnode.op == "tuple") {
                        r = rnode.parameters[i];
                    }
                    this.checkVarAssignment(isConst, scope, p, rtype.types[i], r);
                }
            }
            if (!hasEllipsis && rtype.types.length != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "array") {
            if (!(rtype instanceof ArrayLiteralType) && !(rtype instanceof ArrayType) && !(rtype instanceof SliceType) && rtype != this.t_json && rtype != this.t_string) {
                throw new TypeError("Expected an expression of array type, slice type, or string or json", vnode.loc);
            }
            if (rtype == this.t_json && !jsonErrorIsHandled) {
                throw new TypeError("Right-hand value of type 'json' must be assigned to a tuple, where the second parameter is of type 'error'", vnode.loc);
            }
            let hasEllipsis = false;
            let hasOptional = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (rtype instanceof ArrayType && i >= rtype.size) {
                    throw new TypeError("Mismatch in array type length", vnode.loc);
                }
                let p = vnode.parameters[i];
                if (p.op == "ellipsisId") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in array", vnode.loc);
                    }
                    hasEllipsis = true;
                    let v = this.createVar(p, scope, false);
                    v.isConst = isConst;
                    if (!v.type) {
                        if (rtype instanceof ArrayLiteralType) {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j]);
                                rtype.types[j] = rnode.parameters[j].type;
                            }
                            v.type = new SliceType(this.t_json);
                        } else if (rtype instanceof ArrayType) {
                            v.type = new ArrayType(rtype.elementType, rtype.size - i);
                        } else if (rtype instanceof SliceType) {
                            v.type = new SliceType(rtype.elementType);
                        } else if (rtype == this.t_string) {
                            v.type = this.t_string;
                        } else if (rtype == this.t_json) {
                            v.type = new SliceType(this.t_json);
                        }
                    } else {
                        if (rtype instanceof ArrayLiteralType) {
                            let rt: Type;
                            if (v.type instanceof ArrayType) {
                                if (rtype.types.length - i != v.type.size) {
                                    throw new TypeError("Mismatch in array type length", vnode.loc);
                                }
                                rt = v.type.elementType;
                            } else if (v.type instanceof SliceType) {
                                rt = v.type.elementType;
                            } else if (v.type == this.t_string) {
                                rt = this.t_byte;
                            } else if (v.type == this.t_json) {
                                rt = this.t_json;
                            } else {
                                throw new TypeError("Ellipsis identifier must be of array type, slice type, string or json", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j]);
                            }
                        } else if (rtype instanceof ArrayType) {
                            if (!(v.type instanceof ArrayType)) {
                                throw new TypeError("Ellipsis identifier must be of array type", vnode.loc);
                            }
                            if (v.type.size != rtype.size - i) {
                                throw new TypeError("Mismatch in array size", vnode.loc);                                                
                            }
                            this.checkTypeEquality(v.type.elementType, rtype.elementType, vnode.loc);
                        } else if (rtype instanceof SliceType) {
                            if (!(v.type instanceof SliceType)) {
                                throw new TypeError("Ellipsis identifier must be of slice type", vnode.loc);
                            }
                            this.checkTypeEquality(v.type.elementType, rtype.elementType, vnode.loc);
                        } else if (rtype == this.t_string) {
                            this.checkTypeEquality(v.type, this.t_string, vnode.loc);
                        } else if (rtype == this.t_json) {
                            if (v.type instanceof SliceType) {
                                this.checkIsAssignableType(v.type.elementType, this.t_json, vnode.loc, true, jsonErrorIsHandled);
                            } else {
                                this.checkTypeEquality(v.type, this.t_json, vnode.loc);
                            }
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
                        rt = rtype.elementType;
                    } else if (rtype == this.t_string) {
                        rt = this.t_byte;
                    } else if (rtype == this.t_json) {
                        rt = this.t_json;
                    }
                    this.checkVarAssignment(isConst, scope, p, rt, r, jsonErrorIsHandled);
                }
            }
            if (!hasEllipsis && rtype instanceof ArrayType && rtype.size != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "object") {
            if (!(rtype instanceof ObjectLiteralType) && rtype != this.t_json && !(rtype instanceof GenericClassInstanceType && rtype.base == this.t_map && rtype.genericParameterTypes[0] != this.t_string)) {
                throw new TypeError("Expected an expression of object type, map or json", vnode.loc);
            }
            if (rtype == this.t_json && !jsonErrorIsHandled) {
                throw new TypeError("Right-hand value of type 'json' must be assigned to a tuple, where the second parameter is of type 'error'", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                let kv = vnode.parameters[i];
                if (kv.op == "ellipsisId") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in object", vnode.loc);
                    }
                    hasEllipsis = true;
                    let v = this.createVar(kv, scope, false);
                    v.isConst = isConst;
                    if (!v.type) {
                        if (rtype instanceof ObjectLiteralType) {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j].lhs);
                            }
                            let t = new GenericClassInstanceType();
                            t.base = this.t_map;
                            t.genericParameterTypes.push(this.t_string, this.t_json);
                            v.type = t;
                        } else if (rtype instanceof GenericClassInstanceType) {
                            v.type = rtype;
                        } else if (rtype == this.t_json) {
                            let t = new GenericClassInstanceType();
                            t.base = this.t_map;
                            t.genericParameterTypes.push(this.t_string, this.t_json);
                            v.type = t;
                        }
                    } else {
                        if (rtype instanceof ObjectLiteralType) {
                            let rt: Type;
                            if (v.type instanceof GenericClassInstanceType && v.type.base == this.t_map && v.type.genericParameterTypes[0] == this.t_string) {
                                rt = v.type.genericParameterTypes[1];
                            } else if (v.type == this.t_json) {
                                rt = this.t_json;
                            } else {
                                throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j].lhs);
                            }
                        } else if (rtype instanceof GenericClassInstanceType) {
                            if (!(v.type instanceof GenericClassInstanceType && v.type.base == this.t_map && v.type.genericParameterTypes[0] == this.t_string)) {
                                throw new TypeError("Ellipsis identifier must be of map type", vnode.loc);
                            }
                            this.checkTypeEquality(v.type.genericParameterTypes[1], rtype.genericParameterTypes[1], vnode.loc);
                        } else if (rtype == this.t_json) {
                            if (v.type instanceof GenericClassInstanceType && v.type.base == this.t_map && v.type.genericParameterTypes[0] == this.t_string) {
                                this.checkIsAssignableType(v.type.genericParameterTypes[1], this.t_json, vnode.loc, true, jsonErrorIsHandled);
                            } else {
                                this.checkTypeEquality(v.type, this.t_json, vnode.loc);
                            }
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
                        throw "TODO: Find matching node in literal"
                    } else if (rtype instanceof GenericClassInstanceType) {
                        rt = rtype.genericParameterTypes[1];
                    } else if (rtype == this.t_json) {
                        rt = this.t_json;
                    }
                    this.checkVarAssignment(isConst, scope, p, rt, r, jsonErrorIsHandled);
                }
            }
        }
    }

    public checkAssignment(scope: Scope, vnode: Node, rtype: Type, rnode: Node = null, jsonErrorIsHandled: boolean = false) {
        if (vnode.op == "tuple") {
            if (rtype == this.t_json) {
                if (vnode.parameters.length != 2) {
                    throw new TypeError("Expected a tuple of length two", vnode.loc);
                }
//                this.checkExpression(vnode.parameters[0], scope);
//                this.checkIsLeftHandSide(vnode.parameters[0]);
                this.checkAssignment(scope, vnode.parameters[0], this.t_json, null, true);
                return;
            }
            if (!(rtype instanceof TupleType) && !(rtype instanceof TupleLiteralType)) {
                throw new TypeError("Expected tuple expression or json on right hand side", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (i >= rtype.types.length) {
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
                    this.checkIsLeftHandSide(p.lhs);
                    hasEllipsis = true;
                    if (!(p.lhs.type instanceof TupleType)) {
                        throw new TypeError("Ellipsis identifier in a tuple context must be of tuple type", vnode.loc);
                    }
                    if (p.lhs.type.types.length != rtype.types.length - i) {
                        throw new TypeError("Mismatch in tuple type length", vnode.loc);                                                
                    }
                    if (rnode && rnode.op == "tuple") {
                        for(let j = i; j < rnode.parameters.length; j++) {
                            let r = rnode.parameters[j];
                            this.checkIsAssignableNode(p.lhs.type.types[j-i], r);
                        }
                    } else {
                        this.checkIsAssignableType(p.lhs.type, new TupleType(rtype.types.slice(i)), vnode.loc);
                    }
                    break;
                } else {
                    let r: Node;
                    if (rnode && rnode.op == "tuple") {
                        r = rnode.parameters[i];
                    }
                    this.checkAssignment(scope, p, rtype.types[i], r);
                }
            }
            if (!hasEllipsis && rtype.types.length != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "array") {
            if (!(rtype instanceof ArrayLiteralType) && !(rtype instanceof ArrayType) && !(rtype instanceof SliceType) && rtype != this.t_json && rtype != this.t_string) {
                throw new TypeError("Expected an expression of array type, slice type, or string or json", vnode.loc);
            }
            if (rtype == this.t_json && !jsonErrorIsHandled) {
                throw new TypeError("Right-hand value of type 'json' must be assigned to a tuple, where the second parameter is of type 'error'", vnode.loc);
            }
            let hasEllipsis = false;
            let hasOptional = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                if (rtype instanceof ArrayType && i >= rtype.size) {
                    throw new TypeError("Mismatch in array type length", vnode.loc);
                }
                let p = vnode.parameters[i];
                if (p.op == "ellipsisAssign") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in array", vnode.loc);
                    }
                    hasEllipsis = true;
                    this.checkExpression(p.lhs, scope);
                    this.checkIsLeftHandSide(p.lhs);
                    if (rtype instanceof ArrayLiteralType) {
                        let rt: Type;
                        if (p.lhs.type instanceof ArrayType) {
                            if (rtype.types.length - i != p.lhs.type.size) {
                                throw new TypeError("Mismatch in array type length", vnode.loc);
                            }
                            rt = p.lhs.type.elementType;
                        } else if (p.lhs.type instanceof SliceType) {
                            rt = p.lhs.type.elementType;
                        } else if (p.lhs.type == this.t_string) {
                            rt = this.t_byte;
                        } else if (p.lhs.type == this.t_json) {
                            rt = this.t_json;
                        } else {
                            throw new TypeError("Ellipsis identifier must be of array type, slice type, string or json", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j]);
                        }
                    } else if (rtype instanceof ArrayType) {
                        if (!(p.lhs.type instanceof ArrayType)) {
                            throw new TypeError("Ellipsis identifier must be of array type", vnode.loc);
                        }
                        if (p.lhs.type.size != rtype.size - i) {
                            throw new TypeError("Mismatch in array size", vnode.loc);                                                
                        }
                        this.checkTypeEquality(p.lhs.type.elementType, rtype.elementType, vnode.loc);
                    } else if (rtype instanceof SliceType) {
                        if (!(p.lhs.type instanceof SliceType)) {
                            throw new TypeError("Ellipsis identifier must be of slice type", vnode.loc);
                        }
                        this.checkTypeEquality(p.lhs.type.elementType, rtype.elementType, vnode.loc);
                    } else if (rtype == this.t_string) {
                        this.checkTypeEquality(p.lhs.type, this.t_string, vnode.loc);
                    } else if (rtype == this.t_json) {
                        if (p.lhs.type instanceof SliceType) {
                            this.checkIsAssignableType(p.lhs.type.elementType, this.t_json, vnode.loc, true, jsonErrorIsHandled);
                        } else {
                            this.checkTypeEquality(p.lhs.type, this.t_json, vnode.loc);
                        }
                    }
                    break;
                } else {
                    if (p.op == "optionalAssign") {
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
                        rt = rtype.elementType;
                    } else if (rtype == this.t_string) {
                        rt = this.t_byte;
                    } else if (rtype == this.t_json) {
                        rt = this.t_json;
                    }
                    this.checkAssignment(scope, p, rt, r, jsonErrorIsHandled);
                }
            }
            if (!hasEllipsis && rtype instanceof ArrayType && rtype.size != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "object") {
            if (!(rtype instanceof ObjectLiteralType) && rtype != this.t_json && !(rtype instanceof GenericClassInstanceType && rtype.base == this.t_map && rtype.genericParameterTypes[0] != this.t_string)) {
                throw new TypeError("Expected an expression of object type, map or json", vnode.loc);
            }
            if (rtype == this.t_json && !jsonErrorIsHandled) {
                throw new TypeError("Right-hand value of type 'json' must be assigned to a tuple, where the second parameter is of type 'error'", vnode.loc);
            }
            let hasEllipsis = false;
            for (let i = 0; i < vnode.parameters.length; i++) {
                let kv = vnode.parameters[i];
                if (kv.op == "ellipsisAssign") {
                    if (i + 1 != vnode.parameters.length) {
                        throw new TypeError("Ellipsis identifier must be at last position in object", vnode.loc);
                    }
                    hasEllipsis = true;
                    this.checkExpression(kv.lhs, scope);
                    this.checkIsLeftHandSide(kv.lhs);
                    if (rtype instanceof ObjectLiteralType) {
                        let rt: Type;
                        if (kv.lhs.type instanceof GenericClassInstanceType && kv.lhs.type.base == this.t_map && kv.lhs.type.genericParameterTypes[0] == this.t_string) {
                            rt = kv.lhs.type.genericParameterTypes[1];
                        } else if (kv.lhs.type == this.t_json) {
                            rt = this.t_json;
                        } else {
                            throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j].lhs);
                        }
                    } else if (rtype instanceof GenericClassInstanceType) {
                        if (!(kv.lhs.type instanceof GenericClassInstanceType && kv.lhs.type.base == this.t_map && kv.lhs.type.genericParameterTypes[0] == this.t_string)) {
                            throw new TypeError("Ellipsis identifier must be of map type", vnode.loc);
                        }
                        this.checkTypeEquality(kv.lhs.type.genericParameterTypes[1], rtype.genericParameterTypes[1], vnode.loc);
                    } else if (rtype == this.t_json) {
                        if (kv.lhs.type instanceof GenericClassInstanceType && kv.lhs.type.base == this.t_map && kv.lhs.type.genericParameterTypes[0] == this.t_string) {
                            this.checkIsAssignableType(kv.lhs.type.genericParameterTypes[1], this.t_json, vnode.loc, true, jsonErrorIsHandled);
                        } else {
                            this.checkTypeEquality(kv.lhs.type, this.t_json, vnode.loc);
                        }
                    }
                } else {
                    let p = kv.lhs;
                    let name = kv.name.value;
                    let optional = (p.op == "optionalKeyValue");
                    let r: Node;
                    let rt: Type;
                    if (rtype instanceof ObjectLiteralType) {
                        if (!optional && !rtype.types.has(name)) {
                            throw new TypeError("Object literal has no key '" + name + "'", p.loc);
                        }
                        rt = rtype.types.get(name);
                        r = rnode.parameters[i].lhs;
                        throw "TODO: Find matching node in literal"
                    } else if (rtype instanceof GenericClassInstanceType) {
                        rt = rtype.genericParameterTypes[1];
                    } else if (rtype == this.t_json) {
                        rt = this.t_json;
                    }
                    this.checkAssignment(scope, p, rt, r, jsonErrorIsHandled);
                }
            }
        } else {
            this.checkExpression(vnode, scope);
            this.checkIsLeftHandSide(vnode);
            if (rnode) {
                this.checkIsAssignableNode(vnode.type, rnode, jsonErrorIsHandled);
            } else {
                this.checkIsAssignableType(vnode.type, rtype, vnode.loc, true, jsonErrorIsHandled);
            }
        }
    }

    public checkStatement(snode: Node, scope: Scope) {
        switch (snode.op) {
        // TODO
            case "comment":
                break;
            case "return":
                let f = scope.envelopingFunction();
                if (!f) {
                    throw new TypeError("'return' outside of function body", snode.loc);                    
                }
                if (!snode.lhs) {
                    if (f.type.returnType != this.t_void && !f.namedReturnTypes) {
                        throw new TypeError("Mismatch in return type", snode.loc);
                    }
                } else {
                    this.checkExpression(snode.lhs, scope);
                    if (snode.lhs.op == "tuple") {
                        if (!(f.type.returnType instanceof TupleType)) {
                            throw new TypeError("Mismatch in return type", snode.loc);                            
                        }
                        for(let i = 0; i < snode.lhs.parameters.length; i++) {
                            let pnode = snode.lhs.parameters[i];
                            this.checkIsAssignableNode(f.type.returnType.types[i], pnode);
                        }
                    } else {
                        this.checkIsAssignableNode(f.type.returnType, snode.lhs);
                    }
                }
                break;
            case "break":
                if (!scope.isInForLoop()) {
                    throw new TypeError("'break' outside of loop", snode.loc);
                }
                break;
            case "continue":
                if (!scope.isInForLoop()) {
                    throw new TypeError("'continue' outside of loop", snode.loc);
                }
                break;
            case "if":
                let s = new Scope(scope);
                if (snode.lhs) {
                    this.checkStatement(snode.lhs, s);
                }
                this.checkExpression(snode.condition, s);
                this.checkTypeEquality(snode.condition.type, this.t_bool, snode.condition.loc);
                for(let st of snode.statements) {
                    this.checkStatement(st, s);
                }
                if (snode.elseBranch) {
                    this.checkStatement(snode.elseBranch, scope);
                }
                break;
            case "else":
                let s2 = new Scope(scope);
                for(let st of snode.statements) {
                    this.checkStatement(st, s2);
                }
                break;       
            case "for":
                let forScope = new Scope(scope);
                forScope.forLoop = true;
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        this.checkStatement(snode.condition.lhs, forScope);
                        this.checkExpression(snode.condition.condition, forScope);
                        this.checkTypeEquality(this.t_bool, snode.condition.condition.type, snode.condition.condition.loc);
                        this.checkStatement(snode.condition.rhs, forScope);
                    } else {
                        this.checkStatement(snode.condition, forScope);
                    }
                }
                for(let st of snode.statements) {
                    this.checkStatement(st, forScope);
                }
                break;
            case "var":
            case "const":
                if (!snode.rhs) {
                    if (snode.lhs.op == "id") {
                        let v = this.createVar(snode.lhs, scope);
                        v.isConst = snode.op == "const";
                    } else {
                        for (let p of snode.lhs.parameters) {
                            let v = this.createVar(p, scope);                            
                            v.isConst = snode.op == "const";
                        }
                    }
                } else {
                    this.checkExpression(snode.rhs, scope);
                    this.checkVarAssignment(snode.op == "const", scope, snode.lhs, snode.rhs.type, snode.rhs);
                }
                break;
            case "=":
                this.checkExpression(snode.rhs, scope);
                this.checkAssignment(scope, snode.lhs, snode.rhs.type, snode.rhs);
                break;                
            case "+=":                                             
            case "*=":
            case "/=":
            case "-=":
                this.checkExpression(snode.lhs, scope);
                this.checkIsLeftHandSide(snode.lhs);
                this.checkExpression(snode.rhs, scope);
                if (snode.op == "+=" && snode.lhs.type == this.t_string) {
                    this.checkIsString(snode.rhs);
                } else {
                    this.checkIsNumber(snode.lhs);
                    this.checkIsNumber(snode.rhs);
                    if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                    } else {
                        this.checkTypeEquality(snode.lhs.type, snode.rhs.type, snode.loc);
                    }
                }
                break;                
            case "<<=":
            case ">>=":
            case "%=":
            case "&=":
            case "&^=":
            case "|=":
            case "^=":
                this.checkExpression(snode.lhs, scope);
                this.checkIsLeftHandSide(snode.lhs);
                this.checkExpression(snode.rhs, scope);
                this.checkIsIntNumber(snode.lhs);
                this.checkIsIntNumber(snode.rhs);
                if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                    this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                } else {
                    this.checkTypeEquality(snode.lhs.type, snode.rhs.type, snode.loc);
                }
                break;
            case "in":
                this.checkExpression(snode.rhs, scope);
                // TODO: Check type for enumerability
                if (snode.lhs.op == "tuple") {
                    this.checkExpression(snode.lhs.parameters[0], scope);
                    this.checkExpression(snode.lhs.parameters[1], scope);
                    // TODO: Check type
                } else {
                    this.checkExpression(snode.lhs, scope);
                    this.checkIsLeftHandSide(snode.lhs);
                    // TODO: Check type
                }
                break;
            case "var_in":
            case "const_in":
                throw "TODO"
            default:
                this.checkExpression(snode, scope);
        }
    }

    public checkExpression(enode: Node, scope: Scope) {
        switch (enode.op) {
            case "bool":
                enode.type = this.t_bool;
                break;
            case "str":
                enode.type = this.t_string;
                break;
            case "int":
                // TODO: Check ranges and use t_uint if required
                enode.type = this.t_int;
                break;
            case "float":
                // TODO: Check ranges
                enode.type = this.t_double;
                break;
            case "id":
                // TODO: ellipsis, optional
                var element = scope.resolveElement(enode.value);
                if (!element) {
                    throw new TypeError("Unknown identifier " + enode.value, enode.loc);
                }
                enode.type = element.type;
                break;
            case "++":
            case "--":
                this.checkExpression(enode.lhs, scope);
                this.checkIsIntNumber(enode.lhs);
                // TODO: Check that the LHS is assignable
                enode.type = enode.lhs.type;
                break;
            case "unary-":
                this.checkExpression(enode.rhs, scope);
                this.checkIsSignedNumber(enode.rhs);
                if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                    enode.op = enode.rhs.op;
                    enode.value = (-parseFloat(enode.rhs.value)).toString(); // TODO: BigNumber
                }
                enode.type = enode.rhs.type;
                break;
            case "unary+":
                this.checkExpression(enode.rhs, scope);
                this.checkIsNumber(enode.rhs);
                if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                    enode.op = enode.rhs.op;
                    enode.value = enode.rhs.value;
                }
                enode.type = enode.rhs.type;
                break;
            case "unary^":
                this.checkExpression(enode.rhs, scope);
                this.checkIsIntNumber(enode.rhs);
                if (enode.rhs.op == "int") {
                    enode.op = enode.rhs.op;
                    enode.value = (~parseInt(enode.rhs.value)).toString();
                }
                enode.type = enode.rhs.type;
                break;
            case "unary!":
                this.checkExpression(enode.rhs, scope);
                this.checkIsBool(enode.rhs);
                if (enode.rhs.op == "bool") {
                    enode.op = enode.rhs.op;
                    enode.value = enode.rhs.value == "true" ? "false" : "true";
                }
                enode.type = enode.rhs.type;
                break;
            case "unary*":
                this.checkExpression(enode.rhs, scope);
                this.checkIsPointer(enode.rhs);
                enode.type = (enode.rhs.type as PointerType).elementType;
                break;
            case "unary&":
                this.checkExpression(enode.rhs, scope);
                this.checkIsAdressable(enode.rhs);
                enode.type = new PointerType(enode.rhs.type);
                break;
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
                if ((enode.op == "+" || enode.op == ">" || enode.op == "<" || enode.op == ">=" || enode.op == "<=") && enode.lhs.type == this.t_string) {
                    this.checkIsString(enode.rhs);
                    if (enode.lhs.op == "str" && enode.rhs.op == "str") {
                        enode.op = "str";
                        enode.value = enode.lhs.value + enode.rhs.value;
                    }
                    if (enode.op == "+" || enode.op == "str") {
                        enode.type = this.t_string;
                    } else {
                        enode.type = this.t_bool;
                    }
                } else {
                    this.checkIsNumber(enode.lhs);
                    this.checkIsNumber(enode.rhs);
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
                            enode.lhs.type = this.t_double;
                        } else {
                            enode.op = "int";
                        }
                    } else if (enode.lhs.op == "int" || enode.lhs.op == "float") {
                        this.unifyLiterals(enode.rhs.type, enode.lhs, enode.loc);
                    } else if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, enode.loc);
                    } else {
                        this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-" || enode.op == "*" || enode.op == "/" || enode.op == "float" || enode.op == "int") {
                        enode.type = enode.lhs.type;
                    } else {
                        enode.type = this.t_bool;
                    }
                }
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
                this.checkIsIntNumber(enode.lhs);
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
                    this.unifyLiterals(enode.rhs.type, enode.lhs, enode.loc);
                } else if (enode.rhs.op == "int") {
                    this.unifyLiterals(enode.lhs.type, enode.rhs, enode.loc);
                } else {
                    this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                }
                enode.type = enode.lhs.type;
                break;
            case "==":
            case "!=":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                if ((enode.lhs.op == "int" || enode.lhs.op == "float") && (enode.rhs.op == "int" || enode.rhs.op == "float")) {
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
                    if (enode.op == "==") {
                        enode.value = (enode.lhs.value == enode.rhs.value) ? "true" : "false";
                    } else {
                        enode.value = (enode.lhs.value != enode.rhs.value) ? "true" : "false";                        
                    }
                    enode.op = "bool";                    
                } else if (enode.lhs.op == "int" || enode.lhs.op == "float" || enode.lhs.op == "str") {
                    this.unifyLiterals(enode.rhs.type, enode.lhs, enode.loc);
                } else if  (enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "str") {
                    this.unifyLiterals(enode.lhs.type, enode.rhs, enode.loc);
                } else {
                    this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                }
                enode.type = this.t_bool;
                break;
            case "[":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let index = 0;
                if (enode.lhs.type instanceof TupleType) {
                    // TODO: Check range on parseInt
                    if (enode.rhs.op != "int") {
                        throw new TypeError("Index inside a tuple must be a constant number", enode.lhs.loc);
                    }
                    index = parseInt(enode.rhs.value);
                }  
                let elementType = this.checkIsIndexable(enode.lhs, index);
                // TODO: In case of a map, lhs must equal the map type
                if (enode.lhs.type instanceof GenericClassInstanceType && enode.lhs.type.base == this.t_map) {
                    if (enode.rhs.isUnifyableLiteral()) {
                        this.unifyLiterals(enode.lhs.type.genericParameterTypes[0], enode.rhs, enode.rhs.loc);
                    } else {
                        this.checkTypeEquality(enode.lhs.type.genericParameterTypes[0], enode.rhs.type, enode.rhs.loc);
                    }
                } else {
                    this.checkIsIntNumber(enode.rhs);
                }
                enode.type = elementType;
                break;
            case "(":
                this.checkExpression(enode.lhs, scope);
                if (!(enode.lhs.type instanceof FunctionType)) {
                    throw new TypeError("Expression is not a function", enode.loc);
                }
                if (enode.parameters) {
                    for(let p of enode.parameters) {
                        this.checkExpression(p, scope);                
                    }
                }
                let ft: FunctionType = enode.lhs.type;
                if (enode.parameters) {
                    if (ft.parameters.length != enode.parameters.length) {
                        if (ft.requiredParameterCount() > enode.parameters.length || (enode.parameters.length > ft.parameters.length && !ft.hasEllipsis())) {
                            throw new TypeError("Supplied parameters do not match function signature " + ft.name, enode.loc);
                        }
                    }
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let pnode = enode.parameters[i];
                        this.checkExpression(pnode, scope);
                        if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                            this.checkIsAssignableNode((ft.lastParameter().type as SliceType).elementType, pnode);
                        } else {
                            this.checkIsAssignableNode(ft.parameters[i].type, pnode);
                        }
                    }
                } else if (ft.parameters.length != 0) {
                    throw new TypeError("Supplied parameters do not match function signature " + ft.name, enode.loc);                    
                }
                if (enode.lhs.type instanceof GenericFunctionType) {
                    throw "TODO: Derive the generic parameters"
                }
                enode.type = ft.returnType;
                break;
            case "genericInstance":
                this.checkExpression(enode.lhs, scope);
                enode.type = this.createType(enode, scope);
                break;
            case "tuple":
                let types: Array<Type> = [];
                for(let p of enode.parameters) {
                    this.checkExpression(p, scope);
                    types.push(p.type);
                }
                let t = new TupleLiteralType(types);
                enode.type = t;
                break;
            case "array":
                {
                let types: Array<Type> = [];
                for(let p of enode.parameters) {
                    this.checkExpression(p, scope);
                    types.push(p.type);
                }
                let t = new ArrayLiteralType(types);
                enode.type = t;
                }
                break;
            case "object":
                {
                let types = new Map<string, Type>();
                for(let p of enode.parameters) {
                    this.checkExpression(p.lhs, scope);
                    types.set(p.name.value, p.lhs.type);
                }
                let t = new ObjectLiteralType(types);
                enode.type = t;
                }
                break;
            case "ellipsisId":
                throw new TypeError("'...' is not allowed in this context", enode.loc);
            case "optionalId":
                throw new TypeError("'?' is not allowed in this context", enode.loc);
            default:
                throw "Implementation error " + enode.op;
        }
    }

    private defaultLiteralType(node: Node): Type {
        if (node.type instanceof ArrayLiteralType) {
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode);
            }
            return this.t_json;
        } else if (node.type instanceof TupleLiteralType) {
            let types: Array<Type> = [];
            for(let pnode of node.parameters) {
                types.push(this.defaultLiteralType(pnode));
            }
            return new TupleType(types);
        } else if (node.type instanceof ObjectLiteralType) {
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode.lhs);
            }
            return this.t_json;
        }
        return node.type;
    }

    private unifyLiterals(t: Type, node: Node, loc: Location, doThrow: boolean = true): boolean {
        if (t instanceof OrType) {
            for(let o of t.types) {
                if (this.unifyLiterals(o, node, loc, false)) {
                    return true;
                }
            }
        }

        switch (node.op) {
            case "int":
                // TODO: Check range
                if (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64) {
                    node.type = t;
                    return true;
                }
                if (t == this.t_json) {
                    // TODO: Check range
                    node.type = t;
                    return true;                    
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between integer number and " + t.name, loc);                
            case "float":
                // TODO: Check range
                if (t == this.t_float || t == this.t_double) {
                    node.type = t;
                    return true;
                }
                if (t == this.t_json) {
                    // TODO: Check range
                    node.type = t;
                    return true;                    
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between floating point number and " + t.name, loc);                
            case "str":
                if (t == this.t_string || t == this.t_json) {
                    node.type = t;
                    return true;
                } else if (t instanceof StringEnumType) {
                    if (t.values.has(node.value)) {
                        node.type = t;
                        return true;
                    }
                } else if (t instanceof OrType) {
                    let ok = false;
                    for(let ot of t.types) {
                        if (this.unifyLiterals(ot, node, loc, false)) {
                            node.type = ot;
                            ok = true;
                            break;
                        }
                    }
                    if (ok) {
                        return true;
                    }
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between string and " + t.name, loc);   
            case "array":
                let at: ArrayLiteralType = node.type as ArrayLiteralType;
                if (t instanceof ArrayType) {
                    if (at.types.length != t.size) {
                        throw new TypeError("Mismatch in array size", node.loc);                                                
                    }
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(t.elementType, pnode);
                    }
                    return true;
                } else if (t instanceof SliceType) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(t.elementType, pnode);
                    }
                    return true;
                } else if (t == this.t_json) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(this.t_json, pnode);
                    }
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between array literal and " + t.name, loc);
            case "tuple":
                let tt: TupleLiteralType = node.type as TupleLiteralType;
                if (t instanceof TupleType) {
                    if (tt.types.length != t.types.length) {
                        throw new TypeError("Mismatch in tuple length", node.loc);                                                
                    }
                    for(let i = 0; i < node.parameters.length; i++) {
                        let pnode = node.parameters[i];
                        this.checkIsAssignableNode(t.types[i], pnode);
                    }
                    return true;                    
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between tuple literal and " + t.name, loc);                
            case "object":
                let ot = node.type as ObjectLiteralType;
                if (t instanceof GenericClassInstanceType && t.base == this.t_map && t.genericParameterTypes[0] == this.t_string) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode((t as GenericClassInstanceType).genericParameterTypes[1], pnode.lhs);
                    }
                    return true;
                } else if (t == this.t_json) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(this.t_json, pnode.rhs);
                    }
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between object literal and " + t.name, loc);
            default:
                throw "Implementation error";
        }
    }

    public checkIsAssignableNode(to: Type, from: Node, jsonErrorIsHandled: boolean = false) {
        if (from.isUnifyableLiteral()) {
            this.unifyLiterals(to, from, from.loc);
            return;
        }
        this.checkIsAssignableType(to, from.type, from.loc, true, jsonErrorIsHandled);
    }

    public checkIsAssignableType(to: Type, from: Type, loc: Location, doThrow: boolean = true, jsonErrorIsHandled: boolean = false): boolean {
        if (this.checkTypeEquality(to, from, loc, false)) {
            return true;
        }
        if (from == this.t_json && jsonErrorIsHandled && (to == this.t_float || to == this.t_double || to == this.t_int8 || to == this.t_int16 || to == this.t_int32 || to == this.t_int64 || to == this.t_uint8 || to == this.t_uint16 || to == this.t_uint32 || to == this.t_uint64 || to == this.t_string || to == this.t_bool || to == this.t_null)) {
            return true;
        } else if (to == this.t_json) {
            if (from == this.t_json || from == this.t_string || from == this.t_null || from == this.t_bool || this.isNumber(from)) {
                return true;
            } else if (from instanceof SliceType && (from.elementType == this.t_json || from.elementType == this.t_string || from.elementType == this.t_null || from.elementType == this.t_bool || this.isNumber(from.elementType))) {
                return true;
            } else if (from instanceof GenericClassInstanceType && from.base == this.t_map && from.genericParameterTypes[0] == this.t_string && from.genericParameterTypes[0] == this.t_null && from.genericParameterTypes[0] == this.t_bool && (from.genericParameterTypes[1] == this.t_json || from.genericParameterTypes[1] == this.t_string || this.isNumber(from.genericParameterTypes[1]))) {
                return true;
            }
        } else if (to instanceof TupleType && from instanceof TupleType && to.types.length == from.types.length) {
            let ok = true;
            for(let i = 0; i < to.types.length; i++) {
                if (!this.checkIsAssignableType(to.types[i], from.types[i], loc, false, jsonErrorIsHandled)) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return true;
            }
        } else if (to instanceof OrType) {
            if (from instanceof OrType) {
                let ok = true;
                for(let f of from.types) {
                    let ok2 = false;
                    for(let t of to.types) {
                        if (this.checkIsAssignableType(t, f, loc, false, jsonErrorIsHandled)) {
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
            } else {
                for(let o of to.types) {
                    if (this.checkIsAssignableType(o, from, loc, false, jsonErrorIsHandled)) {
                        return true;
                    }
                }
            }
        } else if (to instanceof AndType) {
            if (from instanceof AndType) {
                let ok = true;
                for(let f of from.types) {
                    let ok2 = false;
                    for(let t of to.types) {
                        if (this.checkIsAssignableType(t, f, loc, false, jsonErrorIsHandled)) {
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
        }
        if (!doThrow) {
            return false;
        }
        throw new TypeError("Type " + from.name + " cannot be assigned to type " + to.name, loc);        
    }

    public checkIsIndexable(node: Node, index: number): Type {
        if (node.type instanceof GenericClassInstanceType) {
            if (node.type.base == this.t_map) {
                return node.type.genericParameterTypes[1];
            }
        } else if (node.type == this.t_string) {
            return this.t_byte;
        } else if (node.type instanceof ArrayType) {
            return node.type.elementType;
        } else if (node.type instanceof SliceType) {
            return node.type.elementType;
        } else if (node.type instanceof TupleType) {
            if (index < 0 || index >= node.type.types.length) {
                throw new TypeError("The index " + index + " does not exist in the tuple " + node.type.name, node.loc);
            }
            return node.type.types[index];
        } else if (node.type == this.t_json) {
            return new TupleType([this.t_json, this.t_error]);
        }
        throw new TypeError("The type " + node.type.name + " is not indexable", node.loc);
    }

    public checkIsAdressable(node: Node) {
        switch (node.op) {
            case "id":
                return;
            case ".":
                this.checkIsAdressable(node.lhs);
                return;
            case "[":
                this.checkIsAdressable(node.lhs);
                if (node.lhs.type instanceof ArrayType || node.lhs.type instanceof SliceType || node.lhs.type instanceof TupleType) {
                    return;
                }
        }
        throw new TypeError("Cannot take an adress of an immediate", node.loc);
    }

    public checkIsPointer(node: Node) {
        if (node.type instanceof PointerType) {
            return;
        }
        throw new TypeError("Expected a pointer, but got " + node.type.name, node.loc);
    }

    public checkIsString(node: Node) {
        if (node.type == this.t_string) {
            return;
        }
        throw new TypeError("Expected a string, but got " + node.type.name, node.loc);
    }

    public checkIsBool(node: Node) {
        if (node.type == this.t_bool) {
            return;
        }
        throw new TypeError("Expected a bool, but got " + node.type.name, node.loc);
    }

    public checkIsSignedNumber(node: Node) {
        if (node.type == this.t_float || node.type == this.t_double || node.type == this.t_int8 || node.type == this.t_int16 || node.type == this.t_int32 || node.type == this.t_int64) {
            return;
        }
        throw new TypeError("Expected a signed numeric type, but got " + node.type.name, node.loc);
    }

    public checkIsNumber(node: Node) {
        if (node.type == this.t_float || node.type == this.t_double || node.type == this.t_int8 || node.type == this.t_int16 || node.type == this.t_int32 || node.type == this.t_int64 || node.type == this.t_uint8 || node.type == this.t_uint16 || node.type == this.t_uint32 || node.type == this.t_uint64) {
            return;
        }
        throw new TypeError("Expected a numeric type, but got " + node.type.name, node.loc);
    }

    public checkIsIntNumber(node: Node) {
        if (node.type == this.t_int8 || node.type == this.t_int16 || node.type == this.t_int32 || node.type == this.t_int64 || node.type == this.t_uint8 || node.type == this.t_uint16 || node.type == this.t_uint32 || node.type == this.t_uint64) {
            return;
        }
        throw new TypeError("Expected a numeric type, but got " + node.type.name, node.loc);
    }

    public checkTypeEquality(a: Type, b: Type, loc: Location, doThrow: boolean = true): boolean {
        if (a == b) {
            return true;
        }
        if (a instanceof PointerType && b instanceof PointerType) {
            if (this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
                return true;
            }
        } else if (a instanceof SliceType && b instanceof SliceType) {
            if (this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
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
        } else if (a instanceof GenericClassInstanceType && b instanceof GenericClassInstanceType) {
            if (this.checkTypeEquality(a.base, b.base, loc, false)) {
                let ok = true;
                for(let i = 0; ok && i < a.genericParameterTypes.length; i++) {
                    ok = ok && this.checkTypeEquality(a.genericParameterTypes[i], b.genericParameterTypes[i], loc, false);
                }
                if (ok) {
                    return true;
                }
            }
        } else if (a instanceof StringEnumType && b instanceof StringEnumType) {
            if (a.values.size == b.values.size) {
                let ok = true;
                for(let s of a.values.keys()) {
                    if (!b.values.has(s)) {
                        ok = false;
                        break;
                    }
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
        } else if (a instanceof AndType && b instanceof AndType) {
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
            if (a.parameters.length == b.parameters.length) {
                this.checkTypeEquality(a.returnType, b.returnType, loc);
                for(let i = 0; i < a.parameters.length; i++) {
                    // TODO: Check for ellipsis
                    this.checkTypeEquality(a.parameters[i].type, b.parameters[i].type, loc);                    
                }
                return true;
            }
        }

        if (doThrow) {
            throw new TypeError("Type mismatch between " + a.name + " and " + b.name, loc);
        }
        return false;
    }

    public isNumber(t: Type): boolean {
        return (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64);
    }

    public checkIsLeftHandSide(node: Node, doNotThrow: boolean = false): boolean {
        if (node.op == "id" || node.op == ".") {
            return true;
        }
        if (node.op == "[" && node.type != this.t_string) {
            return true;
        }
        if (doNotThrow) {
            return false;
        }
        throw new TypeError("The expression is not assignable", node.loc);
    }

    public t_bool: Type;
    public t_float: Type;
    public t_double: Type;
    public t_null: Type;
    public t_int8: Type;
    public t_int16: Type;
    public t_int32: Type;
    public t_int64: Type;
    public t_uint8: Type;
    public t_byte: Type;
    public t_int: Type;
    public t_uint16: Type;
    public t_uint32: Type;
    public t_uint64: Type;
    public t_uint: Type;
    public t_string: Type;
    public t_map: GenericClassType;
    public t_any: Type;
    public t_json: ClassType;
    public t_void: Type;
    public t_error: InterfaceType;
}

export class TypeError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}