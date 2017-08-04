import {Node, NodeOp, Location} from "./ast"
import pkg = require("./pkg");

// ScopeElement is implemented by Variable and Function, FunctionParameter.
// A Scope contains ScopeElements.
export interface ScopeElement {
    name: string;
    type: Type;
    loc: Location;
}

export class ImportedPackage implements ScopeElement {
    constructor(name: string, loc: Location) {
        this.name = name;
        this.loc = loc;
        this.scope = new Scope(null);
        this.type = new PackageType(name, loc);
    }

    public addElement(name: string, element: ScopeElement, loc: Location) {
        this.scope.registerElement(name, element, loc);
        (this.type as PackageType).elements.set(name, element.type);
    }

    public addType(name: string, type: Type, loc: Location) {
        this.scope.registerType(name, type, loc);
        (this.type as PackageType).types.set(name, type);
    }

    public name: string;
    public type: Type;
    public loc: Location;
    // The scope containing the elements of the package.
    public scope: Scope;
}

// Variable is a global or function-local variable.
export class Variable implements ScopeElement {
    // A variable is const if its value cannot be assigned to except during its initial definition.
    public isConst: boolean;
    public isGlobal: boolean;
    public name: string;
    public type: Type;
    public loc: Location;
    public isResult: boolean = false;
    public heapAlloc: boolean = false;
    public node: Node;
}

// Function is a named function inside a scope.
export class Function implements ScopeElement {
    constructor() {
        this.scope = new Scope(null);
        this.scope.func = this;
    }

    public get isImported(): boolean {
        return this.importFromModule !== undefined;
    }

    public name: string;
    public type: FunctionType;
    public namedReturnTypes: boolean;
    // The scope containing FunctionParameters and local Variables of the function.
    public scope: Scope;
    public node: Node;
    public loc: Location;
    public importFromModule: string;
}

export class FunctionParameter implements ScopeElement {
    public name: string;
    public ellipsis: boolean;
    public type: Type;
    public loc: Location;   
    // 'this' is const, because the function parameter cannot be assigned to
    public isConst: boolean;
}

// Typedef represents the result of a 'type' statement, i.e.
// a named type which is of course subject to a scope.
export class Typedef implements ScopeElement {
    public instantiate(): Type {
        return this._tc.instantiateTypedef(this);
    }

    // The name of the Typedef
    public name: string;
    // The Type defined by the Typedef
    public type: Type;
    public loc: Location;
    // The AST of the Typedef
    public node: Node;
    // The scope to which the typedef belongs
    public scope: Scope;

    public _tc: TypeChecker;
    public _mark: boolean;
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
        } else if (t instanceof Typedef) {
            let newt = t.instantiate();
            return newt;
        }
        return t;
    }

    /**
     * @param name
     * @param element 
     */
    public registerType(name: string, type: Type, loc: Location = null): void {
        if (this.elements.has(name)) {
            // TODO: Output file name
            throw new TypeError("Duplicate type " + name + "." + this.elements.get(name).loc ? "Already defined in " + this.elements.get(name).loc.start.line : "", loc);
        }
        this.types.set(name, type);
    }

    public replaceType(name: string, type: Type): void {
        this.types.set(name, type);
    }

    /**
     * @param name
     * @param element 
     */
    public registerElement(name: string, element: ScopeElement, loc: Location = null): void {
        if (this.elements.has(name)) {
            // TODO: Output file name
            throw new TypeError("Duplicate identifier " + name + ", already defined in " + this.elements.get(name).loc.start.line, loc ? loc : element.loc);
        }
        this.elements.set(name, element);
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

    public toString(): string {
        return this.name
    }
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
    // TODO
}

export class StructType extends Type {
    constructor() {
        super();
    }

    public field(name: string): StructField {
        for(let f of this.fields) {
            if (f.name == name) {
                return f;
            }
        }
        if (this.extends) {
            return this.extends.field(name);
        }
        return null;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let str = "struct{";
        str += this.fields.join(",");
        str += "}";
        return str;
    }

    // TODO: Remove
    public extends: StructType;
    // Fields of the struct, ordered by their appearance in the code
    public fields: Array<StructField> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();
}

// StructField describes the field of a StructType.
export class StructField {
    public toString(): string {
        if (!this.name) {
            return this.type.toString();
        }
        return this.name + " " + this.type.toString();
    }

    public name: string;
    public type: Type;
}

// CallingConvention is part of a FunctionType.
// It defines how the function is to be called.
export type CallingConvention = "fyr" | "fyrCoroutine" | "system";

export class FunctionType extends Type {
    constructor() {
        super();
        this.parameters = [];
    }

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name;
            }
            return this.name;
        }
        let name = "("
        for(let p of this.parameters) {
            if (name != "(") {
                name += ",";
            }
            if (p.ellipsis) {
                name += "...";
            }
            name += p.type.toString();
        }
        name += ") => " + this.returnType.toString();
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
            if (!t.ellipsis) {
                i++;
            }
        }
        return i;
    }

    public returnType: Type;
    public parameters: Array<FunctionParameter>;
    public callingConvention: CallingConvention = "fyr";
    public objectType: Type;
    // Only used when the callingConvention is "system"
    public systemCallType: number;
// Enable this line to measure coroutines
//    public callingConvention: CallingConvention = "fyrCoroutine";
}

export class GenericFunctionType extends FunctionType implements GenericType {
    constructor() {
        super();
        this.genericParameterNames = [];
        this.genericParameterTypes = [];
    }

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name;
            }
            return this.name;
        }
        let name = "<";
        for(let i = 0; i < this.genericParameterNames.length; i++) {
            if (i != 0) {
                name += ",";
            }
            name += this.genericParameterNames[i];
            if (this.genericParameterTypes[i]) {
                name += " is " + this.genericParameterTypes[i].toString();
            }
        }
        name += ">(";
        let j = 0;
        for(let p of this.parameters) {
            if (j != 0) {
                name += ",";
            }
            if (p.ellipsis) {
                name += "...";
            }
            name += p.type.toString();
            j++
        }
        name += ") => " + this.returnType.toString();
        return name;
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

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name;
            }
            return this.name;
        }
        let name = "<";
        for(let i = 0; i < this.base.genericParameterNames.length; i++) {
            if (i != 0) {
                name += ",";
            }
            name += this.base.genericParameterNames[i];
            name += "=" + this.genericParameterTypes[i].toString();
        }
        name += ">(";
        let j = 0;
        for(let p of this.parameters) {
            if (j != 0) {
                name += ",";
            }
            if (p.ellipsis) {
                name += "...";
            }
            name += p.type.toString();
            j++
        }
        name += ") => " + this.returnType.toString();
        return name;
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

    // TODO: toString()

    public genericParameterTypes: Array<Type>;
    public genericParameterNames: Array<string>;
}

export class GenericClassInstanceType extends ClassType {
    constructor() {
        super();
        this.genericParameterTypes = [];
    }

    public toString(): string {
        let str = this.base.toString() + "<";
        for(let i = 0; i < this.genericParameterTypes.length; i++) {
            if (i == 0) {
                str += this.genericParameterTypes[i].toString();
            } else {
                str += "," + this.genericParameterTypes[i].toString();
            }
        }
        str += ">"
        return str;
    }

    public base: GenericClassType;
    public genericParameterTypes: Array<Type>;    
}

export class PointerType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "*" + this.elementType.toString();
    }

    public elementType: Type;
}

export class UnsafePointerType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "#" + this.elementType.toString();
    }

    public elementType: Type;
}

export class GuardedPointerType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "@" + this.elementType.toString();
    }

    public elementType: Type;
}

export type Restrictions = {
    isConst: boolean;
    isVolatile: boolean;
    isImmutable: boolean;
}

// Implements restrictions
export class RestrictedType extends Type {
    constructor(elementType: Type, r: Restrictions | null = null) {
        super();
        this.elementType = elementType;
        if (r) {
            this.isConst = r.isConst;
            this.isVolatile = r.isVolatile;
            this.isImmutable = r.isImmutable;
        }
    }

    public static combineRestrictions(r1: Restrictions | null, r2: Restrictions | null): Restrictions | null {
        if (!r1) {
            return r2;
        }
        if (!r2) {
            return r1;
        }
        return {
            isConst : r1.isConst || r2.isConst,
            isVolatile : r1.isVolatile || r2.isVolatile,
            isImmutable : r1.isImmutable || r2.isImmutable
        }
    }

    public static strip(t: Type): Type {
        if (t instanceof RestrictedType) {
            return t.elementType;
        }
        return t;
    }

    public static isLess(r1: Restrictions | null, r2: Restrictions | null): boolean {
        if (!r1 && !r2) {
            return false;
        }
        if (!r2) {
            return false;
        }
        if (!r1) {
            return true;
        }
        if (!r1.isConst && r2.isConst) {
            return true;
        }
        if (!r1.isVolatile && r2.isVolatile) {
            return true;
        }
        if (!r1.isImmutable && r2.isImmutable) {
            return true;
        }
        return false;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let str = "";
        if (this.isConst) {
            str += "const ";
        }
        if (this.isVolatile) {
            str += "volatile ";
        }
        if (this.isImmutable) {
            str += "immutable ";
        }
        return str + this.elementType.toString();
    }

    public elementType: Type;
    public isConst: boolean;
    public isVolatile: boolean;
    public isImmutable: boolean;
}

export class ArrayType extends Type {
    constructor(elementType: Type, size: number) {
        super();
        this.elementType = elementType;
        this.size = size;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString();
    }

    public elementType: Type;
    public size: number;
}

export class SliceType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "[]" + this.elementType.name;
    }

    public elementType: Type;
}

// ArrayLiteralTypes are created while parsing and are then unified.
// They are gone after type checking.
export class ArrayLiteralType extends Type {
    constructor(types: Array<Type>) {
        super();
        this.types = types;        
    }

    public toString() : string {
        let name = "literal[";
        for(let t of this.types) {
            if (name == "literal[") {
                name += t.toString();
            } else {
                name += "," + t.toString();
            }
        }
        name += "]";
        return name;
    }

    public types: Array<Type>;
}

// ObjectLiteralTypes are created while parsing and are then unified.
// They are gone after type checking.
export class ObjectLiteralType extends Type {
    constructor(types: Map<string, Type>) {
        super();
        this.types = types;        
    }

    public toString() : string {
        let name = "literal{";
        for(let t of this.types.keys()) {
            if (name == "literal{") {
                name += t + ": " + this.types.get(t).toString();
            } else {
                name += "," + t + ": " + this.types.get(t).toString();
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

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let name = "(";
        for(let t of this.types) {
            if (name == "(") {
                name += t.toString();
            } else {
                name += "," + t.toString();
            }
        }
        name += ")";
        return name;
    }

    public types: Array<Type>;
}

// TupleLiteralTypes are created while parsing and are then unified.
// They are gone after type checking.
export class TupleLiteralType extends Type {
    constructor(types: Array<Type>) {
        super();
        this.types = types;
    }

    public toString(): string {
        let name = "literal(";
        for(let t of this.types) {
            if (name == "literal(") {
                name += t.toString();
            } else {
                name += "," + t.toString();
            }
        }
        name += ")";
        return name;
    }

    public types: Array<Type>;
}

export class OrType extends Type {
    public types: Array<Type> = [];

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let name = "";
        for(let v of this.types) {
            if (name == "") {
                name += v.toString();
            } else {
                name += " | " + v.toString();
            }
        }
        return name;
    }
}

export class AndType extends Type {
    public types: Array<Type> = [];

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let name = "";
        for(let v of this.types) {
            if (name == "") {
                name += v.toString();
            } else {
                name += " & " + v.toString();
            }
        }
        return name;
    }
}

export class StringEnumType extends Type {
    public values: Map<string, number> = new Map<string, number>();

    public toString(): string {
        if (this.name) {
            return this.name;
        }
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

export class PackageType extends Type {
    constructor(name: string, loc: Location) {
        super();
        this.name = name;
        this.loc = loc;
    }

    public toString(): string {
        return "package " + this.name;
    }

    public elements: Map<string, Type> = new Map<string, Type>();
    public types: Map<string, Type> = new Map<string, Type>();
}

export class TypeChecker {
    constructor() {
        this.t_bool = new BasicType("bool");
        this.t_float = new BasicType("float");
        this.t_double = new BasicType("double");
        this.t_any = new GenericConstraintType("any");
        this.t_null = new BasicType("null");
        this.t_int8 = new BasicType("int8");
        this.t_int16 = new BasicType("int16");
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

        this.builtin_len = new FunctionType();
        this.builtin_len.callingConvention = "system";
        this.builtin_len.name = "len";
        this.builtin_len.returnType = this.t_int;

        this.builtin_cap = new FunctionType();
        this.builtin_cap.callingConvention = "system";
        this.builtin_cap.name = "cap";
        this.builtin_cap.returnType = this.t_int;
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

    public createType(tnode: Node, scope: Scope, noStructBody: boolean = false, allowVolatile: boolean = false): Type {
        if (tnode.op == "basicType") {
            let t = scope.resolveType(tnode.value);
            if (!t) {
                throw new TypeError("Unknown type " + tnode.value, tnode.loc);
            }
            return t;
        } else if (tnode.op == "constType") {
            let c = this.createType(tnode.rhs, scope, noStructBody, allowVolatile);
            if (c instanceof RestrictedType) {
                let r = new RestrictedType(c.elementType);
                r.isImmutable = c.isImmutable;
                r.isVolatile = c.isVolatile;
                r.isConst = true;
                return r;
            }
            let r = new RestrictedType(c);
            r.isConst = true;
            return r;
        } else if (tnode.op == "volatileType") {
            if (!allowVolatile) {
                throw new TypeError("Volatile types are not allowed in this context", tnode.loc);
            }
            let c = this.createType(tnode.rhs, scope, noStructBody, allowVolatile);
            if (c instanceof RestrictedType) {
                let r = new RestrictedType(c.elementType);
                r.isImmutable = c.isImmutable;
                r.isConst = c.isConst;
                r.isVolatile = true;
                return r;
            }
            let r = new RestrictedType(c);
            r.isVolatile = true;
            return r;
        } else if (tnode.op == "immutableType") {
            let c = this.createType(tnode.rhs, scope, noStructBody, allowVolatile);
            if (c instanceof RestrictedType) {
                let r = new RestrictedType(c.elementType);
                r.isVolatile = c.isVolatile;
                r.isImmutable = true;
                r.isConst = true;
                return r;
            }
            let r = new RestrictedType(c);
            r.isConst = true;
            r.isImmutable = true;
            return r;
        } else if (tnode.op == "pointerType") {
            let t = new PointerType(this.createType(tnode.rhs, scope, noStructBody, allowVolatile));
            return t;
        } else if (tnode.op == "unsafePointerType") {
            let t = new UnsafePointerType(this.createType(tnode.rhs, scope, noStructBody, allowVolatile));
            return t;
        } else if (tnode.op == "sliceType") {
            let t = new SliceType(this.createType(tnode.rhs, scope, noStructBody, allowVolatile));
            return t
        } else if (tnode.op == "tupleType") {
            let types: Array<Type> = [];
            for(let p of tnode.parameters) {
                let pt = this.createType(p, scope, noStructBody, allowVolatile);
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
            let t = new ArrayType(this.createType(tnode.rhs, scope, noStructBody, allowVolatile), parseInt(tnode.lhs.value));
            return t;
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
                    p.type = this.createType(pnode, scope, noStructBody, allowVolatile);
                    if (p.ellipsis && !(p.type instanceof SliceType)) {
                        throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                    }
                    p.loc = pnode.loc;
                    t.parameters.push(p);
                }
            }
            if (tnode.rhs) {
                t.returnType = this.createType(tnode.rhs, scope, noStructBody, allowVolatile);
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
                    throw new TypeError("Supplied parameters do not match generic parameter types of " + baset.toString(), tnode.loc);
                }
                let mapping = new Map<Type, Type>();
                ct.loc = tnode.loc;
                ct.base = baset;
//                ct.name = baset.name + "<";
                for(let i = 0; i < tnode.genericParameters.length; i++) {
                    let pnode = tnode.genericParameters[i];
                    let pt = this.createType(pnode, scope, noStructBody, allowVolatile);
                    ct.genericParameterTypes.push(pt);
                    // TODO: Check that pt extends baset.genericParameterTypes[i]
                    mapping.set(pt, baset.genericParameterTypes[i]);
//                    if (i == 0) {
//                        ct.name += pt.name;
//                    } else {
//                        ct.name += "," + pt.name;
//                    }
                }
//                ct.name += ">"
                // TODO: Instantiate the type of ct, e.g. all function signatures and properties.
                return ct;
            } else if (baset instanceof GenericFunctionType) {
                let ft = new GenericFunctionInstanceType();
                let s = new Scope(scope);
                ft.base = baset;
                ft.loc = tnode.loc;
                for(let i = 0; i < tnode.genericParameters.length; i++) {
                    let pnode = tnode.genericParameters[i];
                    let pt = this.createType(pnode, scope, noStructBody, allowVolatile);
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
                        }
                        p.name = pnode.name.value;
                        p.type = this.createType(pnode, s, noStructBody, allowVolatile);
                        p.loc = pnode.loc;
                        ft.parameters.push(p);
                    }
                }
                if (fnode.rhs) {
                    ft.returnType = this.createType(fnode.rhs, s, noStructBody, allowVolatile);
                }
                return ft;
            }
            throw new TypeError("Type " + baset.toString() + " is not a generic type", tnode.loc);
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
                let pt = this.createType(pnode, scope, noStructBody, allowVolatile);
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
                let pt = this.createType(pnode, scope, noStructBody, allowVolatile);
                if (pt instanceof OrType) {
                    t.types = t.types.concat(pt.types);
                }
                t.types.push(pt);
            }
            return t;
        } else if (tnode.op == "structType") {
            if (noStructBody) {
                return new StructType();
            }
            return this.createStructType(tnode, scope);
        }
        throw "Implementation error for type " + tnode.op
    }
    
    private createStructType(tnode: Node, scope: Scope, s?: StructType): StructType {
        if (!s) {
            s = new StructType();
        }
        if (tnode.lhs) {
            let ext: Type = this.createType(tnode.lhs, scope);
            if (!(ext instanceof StructType)) {
                throw new TypeError("Struct can only extend another struct", tnode.lhs.loc);
            }
            s.extends = ext;
            // TODO: Avoid circular dependencies
        }
        for(let fnode of tnode.parameters) {
            if (fnode.op != "structField") {
                throw "Implementation error";
            }
            if (s.field(fnode.lhs.value)) {
                throw new TypeError("Duplicate field name " + fnode.lhs.value, fnode.lhs.loc);
            }
            // TODO: Check for duplicate names in the structs extends by this struct
            let field = new StructField();
            field.name = fnode.lhs.value;
            field.type = this.createType(fnode.rhs, scope);
            s.fields.push(field);
        }

        return s;
    }

    public createFunction(fnode: Node, parentScope: Scope, registerScope: Scope): Function {
        if (!fnode.name) {
            throw new TypeError("Function must be named", fnode.loc);
        }
        let f: Function = new Function();
        f.name = fnode.name.value;
        f.scope.parent = parentScope;
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
        // A member function?
        if (fnode.lhs) {
            let obj = fnode.lhs;
            f.type.objectType = this.createType(obj, f.scope, true, true);
            // TODO: Lift this limitation eventually
            if (!(f.type.objectType instanceof StructType) && (!(f.type.objectType instanceof RestrictedType) || !(f.type.objectType.elementType instanceof StructType))) {
                throw new TypeError("Functions cannot be attached to " + f.type.objectType.toString(), fnode.lhs.loc);
            }
            let p = new FunctionParameter();
            p.name = "this";            
            p.loc = fnode.lhs.loc;
            p.isConst = true;
            if (f.type.objectType instanceof RestrictedType) {
                p.type = new RestrictedType(new PointerType(f.type.objectType.elementType), f.type.objectType);
            } else {
                p.type = new PointerType(f.type.objectType);
            }
            f.scope.registerElement("this", p);
        }
        if (fnode.parameters) {
            for(let pnode of fnode.parameters) {
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
                p.type = this.createType(pnode, f.scope, false, true);
                if (p.ellipsis && !(p.type instanceof SliceType)) {
                    throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                }
                p.loc = pnode.loc;
                f.type.parameters.push(p);
                f.scope.registerElement(p.name, p);
            }
        }
        // A return type?
        if (fnode.rhs) {
            f.type.returnType = this.createType(fnode.rhs, f.scope);
            if (fnode.rhs.op == "tupleType") {
                for(let i = 0; i < fnode.rhs.parameters.length; i++) {
                    let pnode = fnode.rhs.parameters[i];
                    if (pnode.name) {
                        let v = new Variable();
                        v.isResult = true;
                        v.loc = pnode.loc;
                        v.name = pnode.name.value;
                        v.type = (f.type.returnType as TupleType).types[i];
                        f.scope.registerElement(v.name, v);
                        f.namedReturnTypes = true;
                    }
                }
            }
        } else {
            f.type.returnType = this.t_void;
        }

        let objType = f.type.objectType;
        if (objType instanceof RestrictedType) {
            objType = objType.elementType;
        }
        // The function is a member function
        if (objType instanceof StructType) {
            if (objType.methods.has(f.name)) {
                let loc = objType.methods.get(f.name).loc;
                throw new TypeError("Method " + objType.toString() + "." + f.name + " is already defined at " + loc.file + " (" + loc.start.line + "," + loc.start.column + ")", fnode.loc);
            }
            if (objType.field(f.name)) {
                throw new TypeError("Field " + objType.toString() + "." + f.name + " is already defined", fnode.loc);
            }
            objType.methods.set(f.name, f.type);
            registerScope.registerElement(objType.name + "." + f.name, f);
        } else if (objType) {
            throw "Implementation error";
        } else {
            registerScope.registerElement(f.name, f);
        }

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

    private createTypedef(tnode: Node, scope: Scope): Typedef {
        let t = new Typedef();
        t.loc = tnode.loc;
        t.name = tnode.name.value;
        t.node = tnode;
        t.scope = scope;
        t._tc = this;
        scope.registerType(t.name, t);
        return t;
    }

    public instantiateTypedef(t: Typedef): Type {
        if (t._mark) {
            throw new TypeError("Recursive type definition of " + t.name, t.node.loc);
        }
        if (t.node.rhs.op == "structType") {
            t.type = new StructType();
        } else if (t.node.rhs.op == "interfaceType") {
            t.type = new InterfaceType();
        } else {
            t._mark = true;
            t.type = this.createType(t.node.rhs, t.scope);
            t._mark = false;
        }
        t.type.name = t.name;
        t.scope.replaceType(t.name, t.type);
        return t.type;
    }

    private createImport(inode: Node, scope: Scope) {
        if (inode.rhs.op == "importWasm") {
            let ip: ImportedPackage;
            let importPath: string = inode.rhs.rhs.value;
            if (!inode.lhs) {
                // Syntax of the kind: import { func ... } from "imports"
                let importPathElements = importPath.split("/");
                let name = importPathElements[importPathElements.length - 1];
                // TODO: Sanitize the name
                ip = new ImportedPackage(name, inode.loc);
                scope.registerElement(name, ip);
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier { func ... } from "imports"
                ip = new ImportedPackage(inode.lhs.value, inode.loc);
                scope.registerElement(ip.name, ip);
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . { func ... } from "imports"
                // Do nothing by intention
            } else {
                throw "Implementation error in import lhs " + inode.lhs.op;                
            }
            for(let n of inode.rhs.parameters) {
                if (n.op == "funcType") {
                    let f = this.createFunctionImport(inode.rhs.rhs.value, n, ip ? ip.scope : scope);
                    if (ip) {
                        (ip.type as PackageType).elements.set(f.name, f.type);
                    }
                } else {
                    throw "Implementation error in import " + n.op;
                }
            }
        } else {
            let importPath: string = inode.rhs.value;
            let p = pkg.resolve(importPath, inode.rhs.loc);        
            let ip: ImportedPackage;
            if (!inode.lhs) {
                // Syntax of the kind: import "path/to/module"
                let importPathElements = importPath.split("/");
                let name = importPathElements[importPathElements.length - 1];
                // TODO: Sanitize the name
                ip = new ImportedPackage(name, inode.loc);
                scope.registerElement(name, ip);
            } else if (inode.lhs.op == "identifierList") {
                // Syntax of the kind: import (id1, id2, ...) "path/to/module"
                for(let pnode of inode.lhs.parameters) {
                    if (p.scope.elements.has(pnode.value)) {
                        var el = p.scope.elements.get(pnode.value);
                        scope.registerElement(pnode.value, el, pnode.loc);
                    } else if (p.scope.types.has(pnode.value)) {
                        var t = p.scope.types.get(pnode.value);
                        scope.registerType(pnode.value, t, pnode.loc);
                    } else {
                        throw new TypeError("Unknown identifier " + pnode.value + " in package \"" + p.path + "\"", pnode.loc);
                    }
                }
            } else if (inode.lhs.op == "id") {
                // Syntax of the kind: import identifier "path/to/module"
                ip = new ImportedPackage(inode.lhs.value, inode.loc);
                scope.registerElement(ip.name, ip);
            } else if (inode.lhs.op == ".") {
                // Syntax of the kind: import . "path/to/module"
                for(var key of p.scope.elements.keys()) {
                    var el = p.scope.elements.get(key);
                    scope.registerElement(key, el, inode.loc);
                }
                for(var key of p.scope.types.keys()) {
                    var t = p.scope.types.get(key);
                    scope.registerType(key, t, inode.loc);
                }
            } else {
                throw "Implementation error in import lhs " + inode.lhs.op;                
            }

            if (ip) {
                for(var key of p.scope.elements.keys()) {
                    var el = p.scope.elements.get(key);
                    ip.addElement(key, el, inode.loc);
                }
                for(var key of p.scope.types.keys()) {
                    var t = p.scope.types.get(key);
                    ip.addType(key, t, inode.loc);
                }
            }
        }
    }

    private createFunctionImport(namespace: string, fnode: Node, scope: Scope): Function {
        let f: Function = new Function();
        f.importFromModule = namespace;
        f.name = fnode.name.value;
        f.scope.parent = scope;
        f.node = fnode;
        f.loc = fnode.loc;
        f.type = new FunctionType();
//        f.type.callingConvention = "host";
        f.type.loc = fnode.loc;
        let i = 0;
        if (fnode.parameters) {
            for(let pnode of fnode.parameters) {
                let original_pnode = pnode;
                let p = new FunctionParameter();
                p.name = "p" + i.toString();
                i++;
                p.type = this.createType(pnode, f.scope);
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
                        v.isResult = true;
                        v.loc = pnode.loc;
                        v.name = "p" + i.toString();
                        i++;
                        v.name = pnode.name.value;
                        v.type = (f.type.returnType as TupleType).types[i];
                        f.scope.registerElement(v.name, v);
                        f.namedReturnTypes = true;
                    }
                }
            }
        } else {
            f.type.returnType = this.t_void;
        }
        scope.registerElement(f.name, f);
        return f;
    }

    // The main function of the Typechecker that checks the types of an entire module.
    public checkModule(mnode: Node): Scope {
        let typedefs: Array<Typedef> = [];
        let functions: Array<Function> = [];
        let globalVariables: Array<Variable> = [];

        let scope = this.createScope();
        mnode.scope = scope;
        // Iterate over all files and declare all types
        for(let fnode of mnode.statements) {
            fnode.scope = new Scope(scope);
            for (let snode of fnode.statements) {
                if (snode.op == "typedef") {
                    let t = this.createTypedef(snode, scope);
                    typedefs.push(t);
                }
            }
        }

        // Iterate over all files and declare all functions and global variables
        // and andle all imports
        for(let fnode of mnode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "func") {
                    let f = this.createFunction(snode, fnode.scope, scope);
                    functions.push(f);
                } else if (snode.op == "var") {
                    let v = this.createVar(snode.lhs, scope, false);
                    v.node = snode;
                    v.isGlobal = true;
                    globalVariables.push(v);
                } else if (snode.op == "const") {
                    let v = this.createVar(snode.lhs, scope, false);
                    v.node = snode;
                    v.isGlobal = true;
                    v.isConst = true;
                    globalVariables.push(v);
                } else if (snode.op == "import") {
                    this.createImport(snode, fnode.scope);
                } else if (snode.op == "typedef") {
                    // Do nothing by intention
                } else if (snode.op == "comment") {
                    // Do nothing by intention
                } else {
                    throw "Implementation error " + snode.op;
                }
            }
        }

        // Instantiate the typedefs.
        // Only the body of structs is not instantiated here to allow for recursion in StructType.
        for(let t of typedefs) {
            if (!t.type) {
                this.instantiateTypedef(t);
            }
        }

        // Check fields of structs and interfaces
        for(let t of typedefs) {
            if (t.type instanceof StructType) {
                this.createStructType(t.node.rhs, t.scope, t.type);
            } else if (t.type instanceof InterfaceType) {
                // TODO
            }
        }

        // Check variable assignments
        for(let v of globalVariables) {
            this.checkGlobalVariable(v, scope);
        }

        // Check function bodies
        for(let e of functions) {
            this.checkFunctionBody(e);
        }

        // Determine which functions could block and hence needs special coroutine treatment.
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

        return scope;
    }

    private checkFunctionBody(f: Function) {
        if (f.node.statements) {
            for(let snode of f.node.statements) {
                this.checkStatement(snode, f.scope);
            }
        }
        let needsReturn = !!f.node.rhs;
        if (needsReturn) {
            if (!f.node.statements) {
                throw new TypeError("Missing return at end of function", f.loc);
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
                throw new TypeError("Missing return at end of function", f.loc);
            }
        }
    }

    public checkVarAssignment(isConst: boolean, scope: Scope, vnode: Node, rtype: Type, rnode: Node = null, jsonErrorIsHandled: boolean = false) {
        if (vnode.op == "id" || vnode.op == "optionalId") {
            let v = this.createVar(vnode, scope, false);
            v.isConst = isConst;
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
                    this.checkIsMutable(p.lhs, scope);
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
                    this.checkIsMutable(p.lhs, scope);
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
                    this.checkIsMutable(kv.lhs, scope);
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
            this.checkIsMutable(vnode, scope);
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
/*                    if (snode.lhs.op == "tuple") {
                        if (!(f.type.returnType instanceof TupleType)) {
                            throw new TypeError("Mismatch in return type", snode.loc);                            
                        }
                        if (f.type.returnType.types.length != snode.lhs.parameters.length) {
                            throw new TypeError("Mismatch in return type. Tuples have different length", snode.loc);                                
                        }
                        for(let i = 0; i < snode.lhs.parameters.length; i++) {
                            let pnode = snode.lhs.parameters[i];
                            this.checkIsAssignableNode(f.type.returnType.types[i], pnode);
                        }
                    } else { */
                    this.checkIsAssignableNode(f.type.returnType, snode.lhs);
//                    }
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
                snode.scope = s;
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
                snode.scope = s2;
                for(let st of snode.statements) {
                    this.checkStatement(st, s2);
                }
                break;       
            case "for":
                let forScope = new Scope(scope);
                snode.scope = forScope;
                forScope.forLoop = true;
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.lhs) {
                            this.checkStatement(snode.condition.lhs, forScope);
                        }
                        if (snode.condition.condition) {
                            this.checkExpression(snode.condition.condition, forScope);
                            this.checkTypeEquality(this.t_bool, snode.condition.condition.type, snode.condition.condition.loc);
                        }
                        if (snode.condition.rhs) {
                            this.checkStatement(snode.condition.rhs, forScope);
                        }
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
                this.checkIsMutable(snode.lhs, scope);
                this.checkExpression(snode.rhs, scope);
                if (snode.op == "+=" && snode.lhs.type == this.t_string) {
                    this.checkIsString(snode.rhs);
                } else if (snode.lhs.type instanceof UnsafePointerType) {
                    if (snode.op == "*=" || snode.op == "/=") {
                        throw new TypeError("'" + snode.op + "' is an invalid operation on pointers", snode.loc);
                    }
                    this.checkIsInt32Number(snode.rhs);
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
                this.checkIsMutable(snode.lhs, scope);
                this.checkExpression(snode.rhs, scope);
                if (snode.lhs.type instanceof PointerType || snode.rhs.type instanceof UnsafePointerType) {
                    if (snode.op == "%=") {
                        throw new TypeError("'%=' is an invalid operation on pointers", snode.loc);
                    }
                    if (snode.rhs.op == "int") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                    } else {
                        this.checkTypeEquality(this.t_int, snode.rhs.type, snode.loc);
                    }
                } else {
                    this.checkIsIntNumber(snode.lhs);
                    this.checkIsIntNumber(snode.rhs);
                    if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                    } else {
                        this.checkTypeEquality(snode.lhs.type, snode.rhs.type, snode.loc);
                    }
                }
                break;
            case "in":
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
//                    if (snode.lhs.parameters[0].op != "id" || snode.lhs.parameters[0].value != "_") {
                    if (snode.lhs.parameters[0].value != "_") {
                        this.checkExpression(snode.lhs.parameters[0], scope);
                        this.checkIsAssignable(snode.lhs.parameters[0], scope);
                        this.checkIsAssignableType(snode.lhs.parameters[0].type, tindex1, snode.loc);
                    } 
                    this.checkExpression(snode.lhs.parameters[1], scope);
                    this.checkIsAssignable(snode.lhs.parameters[1], scope);
                    this.checkIsAssignableType(snode.lhs.parameters[1].type, tindex2, snode.loc);
                } else {
                    this.checkExpression(snode.lhs, scope);
                    this.checkIsAssignable(snode.lhs, scope);
                    this.checkIsAssignableType(snode.lhs.type, tindex1, snode.loc);
                }
                break;
            case "var_in":
            {
                // TODO: underscore as in "for(var _, x in foo)"
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
                    let v1 = this.createVar(snode.lhs.parameters[0], scope, false);
                    if (v1.type) {
                        this.checkIsAssignableType(v1.type, tindex1, snode.loc);
                    } else {
                        v1.type = tindex1
                    }
                    let v2 = this.createVar(snode.lhs.parameters[1], scope, false);
                    if (v2.type) {
                        this.checkIsAssignableType(v2.type, tindex2, snode.loc);
                    } else {
                        v2.type = tindex2;
                    }
                } else {
                    let v = this.createVar(snode.lhs, scope, false);
                    if (v.type) {
                        this.checkIsAssignableType(v.type, tindex1, snode.loc);
                    } else {
                        v.type = tindex1;
                    }
                }
                break;
            }
            case "yield":
            {
                let f = scope.envelopingFunction();
                f.type.callingConvention = "fyrCoroutine";
                break;
            }
            default:
                this.checkExpression(snode, scope);
                if (snode.type instanceof ArrayLiteralType || snode.type instanceof ObjectLiteralType || snode.type instanceof TupleLiteralType) {
                    throw new TypeError("Cannot infer type", snode.loc);
                }
        }
    }

    public checkExpression(enode: Node, scope: Scope) {
        switch (enode.op) {
            case "null":
                enode.type = this.t_null;
                break;
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
                let element = scope.resolveElement(enode.value);
                if (!element) {
                    throw new TypeError("Unknown identifier " + enode.value, enode.loc);
                }
                enode.type = element.type;
                break;
            case "++":
            case "--":
                this.checkExpression(enode.lhs, scope);
                if (enode.lhs.type instanceof UnsafePointerType || enode.lhs.type instanceof PointerType) {
                    // Do nothing by intention
                } else {
                    this.checkIsIntNumber(enode.lhs);
                }
                this.checkIsMutable(enode.lhs, scope);
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
            {
                this.checkExpression(enode.rhs, scope);
                this.checkIsPointer(enode.rhs);
                let t = enode.rhs.type;
                let restrictions: Restrictions = null;
                if (t instanceof RestrictedType) {
                    restrictions = t;
                    if (!restrictions.isConst && !restrictions.isImmutable) {
                        restrictions = null;
                    } else if (restrictions.isVolatile) {
                        restrictions = {isConst: restrictions.isConst, isImmutable: restrictions.isImmutable, isVolatile: false};
                    }
                    t = RestrictedType.strip(t);
                }
                enode.type = (t as PointerType).elementType;
                if (restrictions) {
                    enode.type = new RestrictedType(enode.type, restrictions);
                }
                break;
            }
            case "unary&":
                this.checkExpression(enode.rhs, scope);
                this.checkIsAddressable(enode.rhs, scope);
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
                } else if (enode.lhs.type instanceof UnsafePointerType) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsInt32Number(enode.rhs);
                    } else {
                        this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                    enode.type = enode.lhs.type;
                } else if (enode.rhs.type instanceof UnsafePointerType) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsInt32Number(enode.lhs);
                    } else {
                        this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                    enode.type = enode.rhs.type;
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
            case "||":
            case "&&":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                this.checkIsBool(enode.lhs);
                this.checkIsBool(enode.rhs);
                enode.type = this.t_bool;
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
                this.checkIsIntOrPointerNumber(enode.lhs);
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
                        this.unifyLiterals(this.t_uint, enode.lhs, enode.loc);
                        this.checkIsUnsignedNumber(enode.rhs);
                    } else {
                        this.unifyLiterals(enode.rhs.type, enode.lhs, enode.loc);
                    }
                } else if (enode.rhs.op == "int") {
                    if (enode.op == "<<" || enode.op == ">>") {
                        this.unifyLiterals(this.t_uint, enode.rhs, enode.loc);
                    } else {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, enode.loc);
                    }
                } else {
                    if (enode.op == "<<" || enode.op == ">>") {
                        this.checkIsUnsignedNumber(enode.rhs);
                    } else if (enode.lhs.type instanceof PointerType || enode.lhs.type instanceof UnsafePointerType) {
                        this.checkTypeEquality(this.t_uint, enode.rhs.type, enode.rhs.loc);
                    } else {
                        this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
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
                } else if (enode.lhs.op == "null" && enode.rhs.op == "null") {
                    enode.value = (enode.op == "==" ? "true" : "false");
                    enode.op = "bool";                    
                } else if (enode.lhs.op == "int" || enode.lhs.op == "float" || enode.lhs.op == "str" || enode.lhs.op == "null") {
                    this.unifyLiterals(enode.rhs.type, enode.lhs, enode.loc);
                } else if  (enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "str" || enode.rhs.op == "null") {
                    this.unifyLiterals(enode.lhs.type, enode.rhs, enode.loc);
                } else {
                    this.checkTypeEquality(enode.lhs.type, enode.rhs.type, enode.loc);
                }
                enode.type = this.t_bool;
                break;
            case ".":
            {
                this.checkExpression(enode.lhs, scope);
                let type: Type = enode.lhs.type;
                let restrictions: Restrictions;
                if (type instanceof RestrictedType) {
                    restrictions = type;
                    type = type.elementType;
                }
                if (type instanceof PointerType || type instanceof UnsafePointerType || type instanceof GuardedPointerType) {
                    type = type.elementType;
                }
                if (type instanceof RestrictedType) {
                    restrictions = RestrictedType.combineRestrictions(type, restrictions);
                    type = type.elementType;
                }
                if (type instanceof StructType) {
                    let name = enode.name.value;
                    let field = type.field(name);
                    if (field) {
                        enode.type = field.type;
                        if (this.checkIsIntermediate(enode.lhs) && this.isStruct(enode.type)) {
                            if (restrictions) {
                                restrictions.isVolatile = true;
                            } else {
                                restrictions = {isConst: false, isImmutable: false, isVolatile: true};
                            }
                        }
                        if (restrictions && !this.isPrimitive(enode.type)) {
                            enode.type = new RestrictedType(enode.type, restrictions);
                        }
                    } else {
                        let method = type.methods.get(name);
                        if (!method) {
                            throw new TypeError("Unknown field " + name + " in " + type.toString(), enode.name.loc);
                        }
                        // Does the object type specified by the method match the object being used here?
                        if (this.checkIsIntermediate(enode.lhs)) {
                            if (restrictions) {
                                restrictions.isVolatile = true;
                            } else {
                                restrictions = {isConst: false, isImmutable: false, isVolatile: true};
                            }
                        }
                        if (restrictions && (!(method.objectType instanceof RestrictedType) || RestrictedType.isLess(method.objectType, restrictions))) {
                            throw new TypeError("Method " + name + " is not allowed for object type " + enode.lhs.type.toString(), enode.lhs.loc);
                        }
                        enode.type = method;
                    }
                } else if (type instanceof InterfaceType) {
                    throw "TODO"
                } else if (type instanceof ClassType) {
                    throw "TODO"
                } else if (type instanceof PackageType) {
                    if (!type.elements.has(enode.name.value)) {
                        throw new TypeError("Unknown identifier " + enode.name.value + " in " + type.toString(), enode.name.loc);                        
                    }
                    enode.type = type.elements.get(enode.name.value);
                } else {
                    let name = enode.name.value;
                    let method = this.getBuiltinFunction(type, name);
                    if (!method) {
                        throw new TypeError("Unknown method " + name + " in " + type.toString(), enode.name.loc);
                    }
                    enode.type = method;
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
                let elementType = this.checkIsIndexable(enode.lhs, index1);
                if (enode.lhs.type instanceof ArrayType) {
                    this.checkIsAddressable(enode.lhs, scope, false);
                    this.checkIsIndexable(enode.lhs, index2, true);
                    enode.type = new SliceType(enode.lhs.type.elementType);
                } else if (enode.lhs.type instanceof UnsafePointerType) {
                    enode.type = new SliceType(enode.lhs.type.elementType);
                } else {
                    // For strings and slices the type remains the same
                    enode.type = enode.lhs.type;
                }
                break;
            }
            case "[":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let index = 0;
                if (enode.lhs.type instanceof TupleType) {
                    if (enode.rhs.op != "int") {
                        throw new TypeError("Index inside a tuple must be a constant number", enode.lhs.loc);
                    }
                    index = parseInt(enode.rhs.value);
                } else if (enode.lhs.type instanceof ArrayType && enode.rhs.op == "int") {
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
//                if (enode.parameters) {
//                    for(let p of enode.parameters) {
//                        this.checkExpression(p, scope);                
//                    }
//                }
                let ft: FunctionType = enode.lhs.type;
                if (enode.lhs.type instanceof GenericFunctionType) {
                    throw "TODO: Derive the generic parameters"
                }
                // Type check all parameters
                if (enode.parameters) {
                    if (ft.parameters.length != enode.parameters.length) {
                        if (ft.requiredParameterCount() > enode.parameters.length || (enode.parameters.length > ft.parameters.length && !ft.hasEllipsis())) {
                            throw new TypeError("Supplied parameter count does not match function signature " + ft.toString(), enode.loc);
                        }
                    }
                    for(let i = 0; i < enode.parameters.length; i++) {
                        let pnode = enode.parameters[i];
                        if (pnode.op == "unary...") {
                            if (!ft.hasEllipsis()) {
                                throw new TypeError("Ellipsis not allowed here. Function is not variadic", pnode.loc);
                            }
                            if (i != ft.parameters.length - 1 || i != enode.parameters.length - 1) {
                                throw new TypeError("Ellipsis must only appear with the last parameter", pnode.loc);
                            }
                            this.checkExpression(pnode.rhs, scope);
                            this.checkIsAssignableNode(ft.lastParameter().type, pnode.rhs);
                        } else {
                            this.checkExpression(pnode, scope);
                            if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                                this.checkIsAssignableNode((ft.lastParameter().type as SliceType).elementType, pnode);
                            } else {
                                this.checkIsAssignableNode(ft.parameters[i].type, pnode);
                            }
                        }
                    }
                } else if (ft.parameters.length != 0 && (!ft.hasEllipsis || ft.parameters.length > 1)) {
                    throw new TypeError("Supplied parameters do not match function signature " + ft.toString(), enode.loc);                    
                }
                enode.type = ft.returnType;
                let f = scope.envelopingFunction();
                if (f) {
                    // Function call happens inside a function body and not during the evaluation of a global function
                    let calls: Array<FunctionType>;
                    if (this.callGraph.has(f)) {
                        calls = this.callGraph.get(f);
                        calls.push(ft);
                    } else {
                        calls = [ft];
                        this.callGraph.set(f, calls);
                    }
                }
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
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope);
                    this.unifyLiterals(ct, enode, enode.loc);
                }
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
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope);
                    this.unifyLiterals(ct, enode, enode.loc);
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
                    let ct = this.createType(enode.lhs, scope);
                    this.unifyLiterals(ct, enode, enode.loc);
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
                        p.type = this.createType(pnode, enode.scope);
                        if (p.ellipsis && !(p.type instanceof SliceType)) {
                            throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                        }
                        p.loc = pnode.loc;
                        f.type.parameters.push(p);
                        f.scope.registerElement(p.name, p);
                    }
                }
                if (enode.lhs) {
                    f.type.returnType = this.createType(enode.lhs, f.scope);
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
                        this.checkIsAssignableNode(f.type.returnType, enode.rhs, false);
                    }
                } else {
                    for(let s of enode.statements) {
                        this.checkStatement(s, enode.scope);
                    }
                }
                break;
            }
            case "typeCast":
            {
                let t = this.createType(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                if (this.isIntNumber(t) && enode.rhs.type instanceof UnsafePointerType) {
                    enode.type = t;
                } else if (this.checkIsIntNumber(enode.rhs, false) && t instanceof UnsafePointerType) {
                    enode.type = t;
                } else if (t instanceof UnsafePointerType && (enode.rhs.type instanceof UnsafePointerType || enode.rhs.type instanceof PointerType || enode.rhs.type == this.t_string)) {
                    enode.type = t;
                } else if ((t == this.t_bool || this.isIntNumber(t)) && (enode.rhs.type == this.t_bool || this.checkIsIntNumber(enode.rhs, false))) {
                    enode.type = t;
                } else if (t == this.t_string && enode.rhs.type instanceof UnsafePointerType) {
                    enode.type = t;
                } else if (t == this.t_string && enode.rhs.type instanceof SliceType && enode.rhs.type.elementType == this.t_byte) {
                    enode.type = t;
                } else if (t instanceof PointerType && enode.rhs.type instanceof UnsafePointerType && t.elementType == enode.rhs.type.elementType) {
                    enode.type = t;
                } else if (t instanceof SliceType && t.elementType == this.t_byte && enode.rhs.type == this.t_string) {
                    enode.type = t;
                } else if (t instanceof RestrictedType && t.elementType == enode.rhs.type && this.isPrimitive(enode.rhs.type)) {
                    enode.type = t;
                } else if (enode.rhs.type instanceof RestrictedType && enode.rhs.type.elementType == t && this.isPrimitive(t)) {
                    enode.type = t;
                } else if (t instanceof RestrictedType && enode.rhs.type instanceof RestrictedType && t.elementType == enode.rhs.type.elementType && this.isPrimitive(t.elementType)) {
                    enode.type = t;
                } else {
                    throw new TypeError("Conversion from " + enode.rhs.type.toString() + " to " + t.toString() + " is not possible", enode.loc);
//                    throw "TODO: conversion not possible or not implemented";
                }
                break;
            }
            case "ellipsisId":
                throw new TypeError("'...' is not allowed in this context", enode.loc);
            case "optionalId":
                throw new TypeError("'?' is not allowed in this context", enode.loc);
            default:
                throw "Implementation error " + enode.op;
        }
    }

    private checkGlobalVariable(v: Variable, scope: Scope) {
        if (v.node.rhs) {
            this.checkExpression(v.node.rhs, scope);
            if (!v.type) {
                if (v.node.rhs.type instanceof ArrayLiteralType || v.node.rhs.type instanceof TupleLiteralType || v.node.rhs.type instanceof ObjectLiteralType) {
                    v.type = this.defaultLiteralType(v.node.rhs);
                } else {
                    v.type = v.node.rhs.type;
                }
            } else {
                this.checkIsAssignableNode(v.type, v.node.rhs, false);
            }
        }
    }

    private defaultLiteralType(node: Node): Type {
        if (node.type instanceof ArrayLiteralType) {
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode);
            }
            if (node.parameters.length == 0) {
                node.type = this.t_json;
            } else {
                let t = node.parameters[0].type;
                for(let i = 1; i < node.parameters.length; i++) {
                    if (!this.checkIsAssignableType(t, node.parameters[i].type, node.loc, false, false)) {
                        if (!(t instanceof OrType)) {
                            let o = new OrType();
                            o.types.push(t);
                            t = o;
                        } 
                        (t as OrType).types.push(node.parameters[i].type);
                    }
                }
                node.type = new SliceType(t);
            }
            return node.type;
        } else if (node.type instanceof TupleLiteralType) {
            let types: Array<Type> = [];
            for(let pnode of node.parameters) {
                types.push(this.defaultLiteralType(pnode));
            }
            let tt = new TupleType(types);
            node.type = tt;
            return tt;
        } else if (node.type instanceof ObjectLiteralType) {
            node.type = new StructType();
            for(let i = 0; i < node.parameters.length; i++) {
                let pnode = node.parameters[i];
                this.defaultLiteralType(pnode.lhs);
                let f = new StructField();
                f.type = pnode.lhs.type;
                f.name = pnode.name.value;
                (node.type as StructType).fields.push(f);
            }
            return node.type;
        }
        return node.type;
    }

    private unifyLiterals(t: Type, node: Node, loc: Location, doThrow: boolean = true): boolean {
        if (t instanceof OrType) {
            let count = 0;
            for(let o of t.types) {
                if (this.unifyLiterals(o, node, loc, false)) {
                    count++;
                }
            }
            if (count == 1) {
                return true;
            }
            if (count > 1) {
                if (doThrow) {
                    throw new TypeError("Ambiguous type inference", node.loc);
                }
                return false;
            }
        }

        if (t instanceof RestrictedType) {
            let result = this.unifyLiterals(t.elementType, node, loc, doThrow);
            if (result) {
                let r = new RestrictedType(node.type);
                r.isConst = t.isConst;
                r.isVolatile = t.isVolatile;
                r.isImmutable = t.isImmutable;
                node.type = r;
            }
            return result;
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
                if (t instanceof UnsafePointerType) {
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between integer number and " + t.toString(), loc);                
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
                throw new TypeError("Type mismatch between floating point number and " + t.toString(), loc);                
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
                throw new TypeError("Type mismatch between string and " + t.toString(), loc);   
            case "array":
                if (t instanceof ArrayType) {
                    if (node.parameters.length != t.size) {
                        throw new TypeError("Mismatch in array size", node.loc);                                                
                    }
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(t.elementType, pnode);
                    }
                    node.type = t;
                    return true;
                } else if (t instanceof SliceType) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(t.elementType, pnode);
                    }
                    node.type = t;
                    return true;
                } else if (t == this.t_json) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(this.t_json, pnode);
                    }
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between array literal and " + t.toString(), loc);
            case "tuple":
                if (t instanceof TupleType) {
                    if (node.parameters.length != t.types.length) {
                        throw new TypeError("Mismatch in tuple length", node.loc);                                                
                    }
                    for(let i = 0; i < node.parameters.length; i++) {
                        let pnode = node.parameters[i];
                        this.checkIsAssignableNode(t.types[i], pnode);
                    }
                    node.type = t;
                    return true;                    
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between tuple literal and " + t.toString(), loc);                
            case "object":
                if (t instanceof GenericClassInstanceType && t.base == this.t_map && t.genericParameterTypes[0] == this.t_string) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode((t as GenericClassInstanceType).genericParameterTypes[1], pnode.lhs);
                    }
                    node.type = t;
                    return true;
                } else if (t instanceof StructType) {
                    if (node.parameters) {
                        for(let pnode of node.parameters) {
                            let field = t.field(pnode.name.value);
                            if (!field) {
                                throw new TypeError("Unknown field " + pnode.name.value + " in " + t.toString(), pnode.name.loc);
                            }
                            this.checkIsAssignableNode(field.type, pnode.lhs);
                        }
                    }
                    node.type = t;
                    return true;                    
                } else if (t == this.t_json) {
                    for(let pnode of node.parameters) {
                        this.checkIsAssignableNode(this.t_json, pnode.rhs);
                    }
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between object literal and " + t.toString(), loc);
            case "unary&":
                if (t instanceof PointerType || t instanceof UnsafePointerType) {
                    let r = this.unifyLiterals(t.elementType, node.rhs, loc, doThrow);
                    node.type = t;
                    return r;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between object literal and " + t.toString(), loc);
            case "null":
                if (t instanceof PointerType || t instanceof UnsafePointerType || t instanceof GuardedPointerType) {
                    node.type = t;
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between null literal and " + t.toString(), loc);
            default:
                throw "Implementation error";
        }
    }

    // Checks whether the type of 'from' can be assigned to the type 'to'.
    public checkIsAssignableNode(to: Type, from: Node, jsonErrorIsHandled: boolean = false) {
        if (from.isUnifyableLiteral()) {
            this.unifyLiterals(to, from, from.loc);
            return;
        }
        this.checkIsAssignableType(to, from.type, from.loc, true, jsonErrorIsHandled);
    }

    // Checks whether the type 'from' can be assigned to the type 'to'.
    public checkIsAssignableType(to: Type, from: Type, loc: Location, doThrow: boolean = true, jsonErrorIsHandled: boolean = false): boolean {
        if (this.checkTypeEquality(to, from, loc, false)) {
            return true;
        }
        if (from instanceof RestrictedType && this.isPrimitive(from.elementType)) {
            if (from.elementType == to || (to instanceof RestrictedType && from.elementType == to.elementType)) {
                return true;
            }
        } else if (to instanceof RestrictedType && from instanceof RestrictedType) {
            if ((to.isVolatile || !from.isVolatile) && (to.isConst || !from.isConst) && to.isImmutable == from.isImmutable) {
                return this.checkIsAssignableType(to.elementType, from.elementType, loc, doThrow, jsonErrorIsHandled);
            }
        } else if (to instanceof RestrictedType) {
            if (!to.isImmutable) {
                return this.checkIsAssignableType(to.elementType, from, loc, doThrow, jsonErrorIsHandled);                
            }
        } else if (from == this.t_json && jsonErrorIsHandled && (to == this.t_float || to == this.t_double || to == this.t_int8 || to == this.t_int16 || to == this.t_int32 || to == this.t_int64 || to == this.t_uint8 || to == this.t_uint16 || to == this.t_uint32 || to == this.t_uint64 || to == this.t_string || to == this.t_bool || to == this.t_null)) {
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
        } else if (to instanceof UnsafePointerType) {
            if (from == this.t_int || from == this.t_uint) {
                return true;
            }
            if (to.elementType == this.t_void && (from instanceof UnsafePointerType || from instanceof PointerType || from instanceof GuardedPointerType)) {
                return true;
            }
        }
        if (!doThrow) {
            return false;
        }
        throw new TypeError("Type " + from.toString() + " cannot be assigned to type " + to.toString(), loc);        
    }

    public checkIsEnumerable(node: Node): [Type, Type] {
        if (node.type instanceof GenericClassInstanceType) {
            if (node.type.base == this.t_map) {
                return [node.type.genericParameterTypes[0], node.type.genericParameterTypes[1]];
            }
        } else if (node.type == this.t_string) {
            return [this.t_int, this.t_byte];
        } else if (node.type instanceof ArrayType) {
            return [this.t_int, node.type.elementType];
        } else if (node.type instanceof SliceType) {
            return [this.t_int, node.type.elementType];
        }
        throw new TypeError("The type " + node.type.name + " is not enumerable", node.loc);
    }

    public checkIsIndexable(node: Node, index: number, indexCanBeLength: boolean = false): Type {
        if (node.type instanceof GenericClassInstanceType) {
            if (node.type.base == this.t_map) {
                return node.type.genericParameterTypes[1];
            }
        } else if (node.type == this.t_string) {
            if (index < 0) {
                throw new TypeError("Index out of range", node.loc);
            }
            return this.t_byte;
        } else if (node.type instanceof ArrayType) {
            if (index < 0 || (!indexCanBeLength && index >= node.type.size) || (indexCanBeLength && index > node.type.size)) {
                throw new TypeError("Index out of range", node.loc);
            }
            return node.type.elementType;
        } else if (node.type instanceof SliceType) {
            if (index < 0) {
                throw new TypeError("Index out of range", node.loc);
            }
            return node.type.elementType;
        } else if (node.type instanceof TupleType) {
            if (index < 0 || index >= node.type.types.length) {
                throw new TypeError("The index " + index + " does not exist in the tuple " + node.type.name, node.loc);
            }
            return node.type.types[index];
        } else if (node.type == this.t_json) {
            return new TupleType([this.t_json, this.t_error]);
        } else if (node.type instanceof UnsafePointerType || node.type instanceof PointerType) {
            return node.type.elementType;
        }
        throw new TypeError("The type " + node.type.name + " is not indexable", node.loc);
    }

    public checkIsAddressable(node: Node, scope: Scope, direct: boolean = true): boolean {
        switch (node.op) {
            case "id":
                let element = scope.resolveElement(node.value);
                if (element instanceof Variable) {
//                    if (element.isConst && !(element.))
                    if (element.isGlobal) {
                        return true;
                    }                
                    element.heapAlloc = true;
                    return true;
                }
                if (element instanceof FunctionParameter) {
                    throw new TypeError("Cannot take address of function parameter", node.loc);
                }
                break;
            case ".":
                if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof GuardedPointerType) {
                    return true;
                }
                return this.checkIsAddressable(node.lhs, scope, false);
            case "[":
                if (node.lhs.type instanceof SliceType) {
                    return true;
                }
                if (node.lhs.type instanceof ArrayType || node.lhs.type instanceof TupleType) {
                    return this.checkIsAddressable(node.lhs, scope, false);
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
                if (direct) {
                    return false;
                }
        }
        throw new TypeError("Cannot take address of intermediate value", node.loc);
    }

    public checkIsPointer(node: Node, doThrow: boolean = true): boolean {
        if (node.type instanceof RestrictedType && (node.type.elementType instanceof PointerType || node.type.elementType instanceof UnsafePointerType)) {
            return true;
        }
        if (node.type instanceof PointerType || node.type instanceof UnsafePointerType) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a pointer, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsString(node: Node, doThrow: boolean = true): boolean {
        if (node.type instanceof RestrictedType && node.type.elementType == this.t_string) {
            return true;
        }
        if (node.type == this.t_string) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a string, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsSignedNumber(node: Node, doThrow: boolean = true): boolean {
        if (node.type instanceof RestrictedType) {
            if (node.type.elementType == this.t_float || node.type.elementType == this.t_double || node.type.elementType == this.t_int8 || node.type.elementType == this.t_int16 || node.type.elementType == this.t_int32 || node.type.elementType == this.t_int64) {
                return true;
            }            
        }
        if (node.type == this.t_float || node.type == this.t_double || node.type == this.t_int8 || node.type == this.t_int16 || node.type == this.t_int32 || node.type == this.t_int64) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a signed numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsUnsignedNumber(node: Node, doThrow: boolean = true): boolean {
        if (node.type instanceof RestrictedType) {
            if (node.type.elementType == this.t_uint8 || node.type.elementType == this.t_uint16 || node.type.elementType == this.t_uint32 || node.type.elementType == this.t_uint64) {
                return true;
            }
        }
        if (node.type == this.t_uint8 || node.type == this.t_uint16 || node.type == this.t_uint32 || node.type == this.t_uint64) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an unsigned numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsBool(node: Node, doThrow: boolean = true): boolean {
        if (node.type instanceof RestrictedType && node.type.elementType == this.t_bool) {
            return true;
        }
        if (node.type == this.t_bool) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a boolean type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsNumber(node: Node, doThrow: boolean = true): boolean {
        if (this.isNumber(node.type)) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsIntNumber(node: Node, doThrow: boolean = true): boolean {
        if (this.isIntNumber(node.type)) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an integer type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsInt32Number(node: Node, doThrow: boolean = true): boolean {
        if (node.type instanceof RestrictedType) {
            if (node.type.elementType == this.t_int32 || node.type.elementType == this.t_uint32) {
                return true;
            }
        }
        if (node.type == this.t_int32 || node.type == this.t_uint32) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an 32-bit integer type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public isIntNumber(type: Type): boolean {
        if (type instanceof RestrictedType) {
            return this.isIntNumber(type.elementType);
        }
        if (type == this.t_int8 || type == this.t_int16 || type == this.t_int32 || type == this.t_int64 || type == this.t_uint8 || type == this.t_uint16 || type == this.t_uint32 || type == this.t_uint64) {
            return true;
        }
        return false;
    }

    public isNumber(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return this.isNumber(t.elementType);
        }
        return (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64);
    }

    public isPrimitive(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return this.isNumber(t.elementType);
        }
        return (t == this.t_bool || t == this.t_string || t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64);
    }

    public isStruct(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType instanceof StructType;
        }
        return t instanceof StructType;
    }

    public checkIsIntOrPointerNumber(node: Node, doThrow: boolean = true): boolean {
        if (node.type == this.t_int8 || node.type == this.t_int16 || node.type == this.t_int32 || node.type == this.t_int64 || node.type == this.t_uint8 || node.type == this.t_uint16 || node.type == this.t_uint32 || node.type == this.t_uint64) {
            return true;
        }
        if (node.type instanceof PointerType || node.type instanceof UnsafePointerType) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a numeric or pointer type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkTypeEquality(a: Type, b: Type, loc: Location, doThrow: boolean = true): boolean {
        if (a == b) {
            return true;
        }
        if (a instanceof RestrictedType && b instanceof RestrictedType) {
            if (a.isConst == b.isConst && a.isVolatile == b.isVolatile && a.isImmutable == b.isImmutable) {
                if (this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
                    return true;
                }
            }
        } else if (a instanceof PointerType && b instanceof PointerType) {
            if (this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
                return true;
            }
        } else if (a instanceof UnsafePointerType && b instanceof UnsafePointerType) {
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
            throw new TypeError("Type mismatch between " + a.toString() + " and " + b.toString(), loc);
        }
        return false;
    }

    public checkIsIntermediate(node: Node): boolean {
        if (node.op == "id") {
            return false;
        } else if (node.op == "unary*") {
            return false;
        } else if (node.op == ".") {
            if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof GuardedPointerType) {
                return false;
            }
            return this.checkIsIntermediate(node.lhs);
        } else if (node.op == "[" && node.lhs.type != this.t_string) {
            if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof GuardedPointerType || node.lhs.type instanceof SliceType) {
                return false;
            }
            return this.checkIsIntermediate(node.lhs);
        }
        return true;
    }

    public checkIsMutable(node: Node, scope: Scope): boolean {
        if (node.op == "id") {
            let element = scope.resolveElement(node.value);
            if ((!(element instanceof Variable) || !element.isConst) && (!(element instanceof FunctionParameter) || !element.isConst)) {
                return true;
            }
        } else if (node.op == "unary*") {
            if (!(node.type instanceof RestrictedType) || !node.type.isConst) {
                return true;
            }
        } else if (node.op == ".") {
            if (!(node.type instanceof RestrictedType) || !node.type.isConst) {
                if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof GuardedPointerType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        } else if (node.op == "[" && node.lhs.type != this.t_string) {
            if (!(node.type instanceof RestrictedType) || !node.type.isConst) {
                if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof GuardedPointerType || node.lhs.type instanceof SliceType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        }
        throw new TypeError("The expression is not mutable", node.loc);
    }

    // Returns true if a value can be assigned to this expression
    public checkIsAssignable(node: Node, scope: Scope): boolean {
        if (node.op == "id") {
            return true;
        } else if (node.op == "unary*") {
            if (!(node.type instanceof RestrictedType) || !node.type.isConst) {
                return true;
            }
        } else if (node.op == ".") {
            if (!(node.type instanceof RestrictedType) || !node.type.isConst) {
                if (node.rhs.type instanceof PointerType || node.rhs.type instanceof UnsafePointerType || node.rhs.type instanceof GuardedPointerType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        } else if (node.op == "[" && node.lhs.type != this.t_string) {
            if (!(node.type instanceof RestrictedType) || !node.type.isConst) {
                if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof GuardedPointerType || node.lhs.type instanceof SliceType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        }
        throw new TypeError("The expression is not assignable", node.loc);
    }

    private getBuiltinFunction(type: Type, name: string): FunctionType | null {
        if (type == this.t_string) {
            if (name == "len") {
                return this.builtin_len;
            }
        } else if (type instanceof SliceType) {
            if (name == "len") {
                return this.builtin_len;
            } else if (name == "cap") {
                return this.builtin_cap;
            } else if (name == "append") {
                let ft = new FunctionType()
                ft.name = "append";
                ft.callingConvention = "system";
                ft.objectType = type;
                let p = new FunctionParameter();
                p.name = "slice";
                p.type = type;
                p.ellipsis = true;
                ft.parameters.push(p);
                ft.returnType = type;
                return ft;
            }
        } else if (type instanceof ArrayType) {
            if (name == "len") {
                return this.builtin_len;
            }
        }
        return null;
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

    public builtin_len: FunctionType;
    public builtin_cap: FunctionType;

    private callGraph: Map<Function, Array<FunctionType>> = new Map<Function, Array<FunctionType>>();
}

export class TypeError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}