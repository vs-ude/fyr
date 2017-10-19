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
    // Variable belongs to the global scope.
    // All other variables belong to a function scope.
    public isGlobal: boolean;
    // Variable is the return value of a function
    public isResult: boolean = false;
    public name: string;
    public type: Type;
    public loc: Location;
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
    public isExported: boolean;
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

    public isChildScope(parent: Scope): boolean {
        if (this.parent == parent) {
            return true;
        }
        if (this.parent) {
            return this.parent.isChildScope(parent);
        }
        return false;
    }

    public func: Function;
    public forLoop: boolean;
    public elements: Map<string, ScopeElement>;
    public types: Map<string, Type>;
    public parent: Scope | null = null;
    public isPseudoScope: boolean; 
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

    public abstract toTypeCodeString(): string;
}

export class BasicType extends Type {
    constructor(name: "void" | "string" | "bool" | "float" | "double" | "null" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "any" | "rune") {
        super();
        this.name = name;
    }

    public toTypeCodeString(): string {
        return this.name;
    }
}

export class InterfaceType extends Type {
    public getAllMethods(map?: Map<string, FunctionType>): Map<string, FunctionType> {
        if (!map) {
            map = new Map<string, FunctionType>();
        }
        for(let key of this.methods.keys()) {
            map.set(key, this.methods.get(key));
        }
        for(let b of this.extendsInterfaces) {
            if (!(b instanceof InterfaceType)) {
                continue;
            }
            b.getAllMethods(map);
        }
        return map;
    }

    public getAllBaseTypes(base?: Array<InterfaceType>): Array<InterfaceType> {
        if (base && base.indexOf(this) != -1) {
            return base;
        }
        for(let b of this.extendsInterfaces) {
            if (!(b instanceof InterfaceType)) {
                continue;
            }
            if (!base) {
                base = [b];
            } else {
                base.push(b);
            }
            base = b.getAllBaseTypes(base);
        }
        return base;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        if (this.isBoxedType()) {
            return "interface{" + this.unbox().toString() + "}";
        }
        if (this.extendsInterfaces.length > 0 || this.methods.size > 0) {
            return "interface{...}";
        }
        return "interface{}";
    }

    // TODO: Scoping
    // TODO: Unnamned interfaces
    public toTypeCodeString(): string {
        if (this.name) {
            return this.name;
        }
        throw "TODO"
    }

    public isPointerType(): boolean {
        return !this.isEmptyInterface() && !this.isBoxedType();
    }

    public isEmptyInterface(): boolean {
        return this.extendsInterfaces.length == 0 && this.methods.size == 0;
    }

    public isBoxedType(): boolean {
        if (this.extendsInterfaces.length == 1 && !(this.extendsInterfaces[0] instanceof InterfaceType)) {
            return true;
        }
        return false;
    }

    public unbox(): Type {
        if (this.extendsInterfaces.length == 1 && !(this.extendsInterfaces[0] instanceof InterfaceType)) {
            return this.extendsInterfaces[0];
        }
        return this;
    }

    public method(name: string): FunctionType {
        if (this.methods.has(name)) {
            return this.methods.get(name);
        }
        for(let iface of this.extendsInterfaces) {
            if (iface instanceof InterfaceType) {
                let m = iface.method(name);
                if (m) {
                    return m;
                }
            }
        }
        return null;
    }

    public extendsInterfaces: Array<Type | InterfaceType> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();
    public pointerScope: Scope | null = null;
    // Required during recursive checking
    public _markChecked: boolean = false;
}

export class StructType extends Type {
    constructor() {
        super();
    }

    public field(name: string, ownFieldsOnly: boolean = false): StructField {
        for(let f of this.fields) {
            if (f.name == name) {
                return f;
            }
        }
        if (!ownFieldsOnly && this.extends) {
            return this.extends.field(name);
        }
        return null;
    }

    public method(name: string): FunctionType {
        if (this.methods.has(name)) {
            return this.methods.get(name);
        }
        if (this.extends) {
            return this.extends.method(name);
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

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name;
        }
        let str = "struct{";
        str += this.fields.join(",");
        str += "}";
        return str;
    }

    public getAllMethodsAndFields(map?: Map<string, FunctionType | StructField>): Map<string, FunctionType | StructField> {
        if (!map) {
            map = new Map<string, FunctionType | StructField>();
        }
        for(let key of this.methods.keys()) {
            map.set(key, this.methods.get(key));
        }
        for(let f of this.fields) {
            map.set(f.name, f);
        }
        return map;
    }

    public getAllBaseTypes(base?: Array<StructType>): Array<StructType> {
        if (base && base.indexOf(this) != -1) {
            return base;
        }
        if (this.extends) {
            if (!base) {
                base = [this.extends];
            } else {
                base.push(this.extends);
            }
            base = this.extends.getAllBaseTypes(base);
        }
        return base;
    }

    public doesExtend(parent: StructType): boolean {
        if (this.extends == parent) {
            return true;
        } else if (this.extends) {
            return this.doesExtend(parent);
        }
        return false;
    }

    public extends: StructType;
    public implements: Array<InterfaceType> = [];
    // Fields of the struct, ordered by their appearance in the code
    public fields: Array<StructField> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();

    public _markChecked: boolean;
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

    public toTypeCodeString(): string {
        return this.toString();
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

    public isAsync(): boolean {
        return this.callingConvention == "fyrCoroutine";
    }

    public returnType: Type;
    public parameters: Array<FunctionParameter>;
    public callingConvention: CallingConvention = "fyr";
    public objectType: Type;
    public objectTypeIsScoped: boolean = false;
    public objectTypeIsConst: boolean = false;
    // Only used when the callingConvention is "system"
    public systemCallType: number;
// Enable this line to measure coroutines
//    public callingConvention: CallingConvention = "fyrCoroutine";
}

export class PolymorphFunctionType extends FunctionType {
    public instances: Array<FunctionType> = [];
    public genericParameters: Array<GenericParameter> = [];
    public node: Node;
}

export class GenericParameter extends Type {
    public toTypeCodeString(): string {
        throw "Implementation error";
    }
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

export class GenericFunctionInstanceType extends FunctionType implements GenericInstanceType {
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

export class GenericStructType extends StructType implements GenericType {
    constructor() {
        super();
        this.genericParameterTypes = [];
        this.genericParameterNames = [];
    }

    public toString(): string {
        let g = "<";
        let lst = [];
        for(let i = 0; i < this.genericParameterNames.length; i++) {
            let s = this.genericParameterNames[i];            
            if (this.genericParameterTypes[i]) {
                if (this.base) {
                    s = this.genericParameterTypes[i].toString();
                } else {
                    s += " is " + this.genericParameterTypes[i].toString();
                }
            }
            lst.push(s);
        }
        g += lst.join(",");
        g += ">";
        if (this.name) {
            return this.name + g;
        }
        let str = "struct" + g + "{";
        str += this.fields.join(",");
        str += "}";
        return str;
    }

    public genericParameterTypes: Array<Type>;
    public genericParameterNames: Array<string>;
    public base: GenericStructType;
}

/*
export class GenericStructInstanceType extends StructType {
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

    public base: GenericStructType;
    public genericParameterTypes: Array<Type>;    
}
*/

export class PointerType extends Type {
    constructor(elementType: Type) {
        super();
        this.elementType = elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        if (this.elementType instanceof RestrictedType && this.elementType.scope) {
            return "&" + this.elementType.toString();
        }
        return "*" + this.elementType.toString();
    }

    public toTypeCodeString(): string {
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

    public toTypeCodeString(): string {
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

    public toTypeCodeString(): string {
        return "@" + this.elementType.toString();
    }

    public elementType: Type;
}

export class MapType extends Type {
    constructor(keyType: Type, valueType: Type) {
        super();
        this.keyType = keyType;
        this.valueType = valueType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        return "map<" + this.keyType.toString() + "," + this.valueType.toString() + ">";
    }

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name;
        }
        return "map<" + this.keyType.toString() + "," + this.valueType.toString() + ">";
    }

    public keyType: Type;
    public valueType: Type;
}

export type Restrictions = {
    isConst: boolean;
    scope: Scope | null;
}

// Implements restrictions
export class RestrictedType extends Type {
    constructor(elementType: Type, r: Restrictions | null = null) {
        super();
        this.elementType = elementType;
        if (r) {
            this.isConst = r.isConst;
            this.scope = r.scope;
        } else {
            this.isConst = false;
            this.scope = null;
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
            scope: r2.scope ? r2.scope : r1.scope
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
        if (!r1.scope && r2.scope) {
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
        return str + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        let str = "";
        if (this.isConst) {
            str += "const ";
        }
        if (this.scope) {
            str += "&";
        }
        return str + this.elementType.toString();
    }
    
    public elementType: Type;
    public isConst: boolean;
    public scope: Scope;
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

    public toTypeCodeString(): string {
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
        if (this.elementType instanceof RestrictedType) {
            return "&[]" + this.elementType.toString();
        }
        return "[]" + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        return "[]" + this.elementType.toString();
    }
    
    public elementType: Type;
    public arrayScope: Scope | null = null;
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

    public toTypeCodeString(): string {
        throw "Implemention error";
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

    public toTypeCodeString(): string {
        throw "Implemention error";
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

    public toTypeCodeString(): string {
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

    public toTypeCodeString(): string {
        throw "Implemention error";
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

    // TODO: Scoping
    public toTypeCodeString(): string {
        return this.toString();
    }

    public stringsOnly(): boolean {
        for(let t of this.types) {
            if (!(t instanceof StringLiteralType)) {
                return false;
            }
        }
        return true;
    }
}

export class StringLiteralType extends Type {
    constructor(name: string) {
        super();
        this.name = name;
    }

    public toString(): string {
        return "\"" + this.name + "\"";
    }

    public toTypeCodeString(): string {
        return this.toString();
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

    public toTypeCodeString(): string {
        throw "Implementation error";
    }

    public resolveType(name: string, loc: Location): Type {
        let t = this.types.get(name);
        if (!t) {
            throw new TypeError("Unknown identifier " + name + " in package " + this.name, loc);
        }
        return t;
    }

    public elements: Map<string, Type> = new Map<string, Type>();
    public types: Map<string, Type> = new Map<string, Type>();
}

export class TypeChecker {
    constructor() {
        this.t_bool = new BasicType("bool");
        this.t_float = new BasicType("float");
        this.t_double = new BasicType("double");
        this.t_any = new BasicType("any");
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
        this.t_void = new BasicType("void");
        this.t_rune = new BasicType("rune");
        
        this.t_error = new InterfaceType();
        this.t_error.name = "error";
        let toError = new FunctionType();
        toError.name = "toError";
        toError.returnType = this.t_string;
        toError.objectType = this.t_error;
        toError.objectTypeIsConst = true;
        toError.objectTypeIsScoped = true;
        this.t_error.methods.set("toError", toError);
        this.ifaces.push(this.t_error);

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
        s.registerType("void", this.t_void);
        s.registerType("error", this.t_error);
        s.registerType("rune", this.t_rune);
        return s;
    }

    public createType(tnode: Node, scope: Scope): Type {
        if (tnode.op == "basicType") {
            if (tnode.nspace) {
                let p = scope.resolveType(tnode.nspace);
                if (!(p instanceof PackageType)) {
                    throw new TypeError(tnode.nspace + " is not a package", tnode.loc);                
                }
                return p.resolveType(tnode.value, tnode.loc);
            }
            let t = scope.resolveType(tnode.value);
            if (!t) {
                throw new TypeError("Unknown type " + tnode.value, tnode.loc);
            }
            return t;
        } else if (tnode.op == "str") {
            return this.stringLiteralType(tnode.value);
        } else if (tnode.op == "constType") {
            let c = this.createType(tnode.rhs, scope);
            return this.makeConst(c, tnode.loc);
        } else if (tnode.op == "referenceType") {
            let c = this.createType(tnode.rhs, scope);
            if (c instanceof SliceType && !c.arrayScope) {
                return this.makeSliceReference(c, scope, tnode.loc);
            } else if (c instanceof InterfaceType && !c.pointerScope) {
                return this.makeInterfaceReference(c, scope, tnode.loc);
            }
            return this.makePointerReference(c, scope, tnode.loc);
        } else if (tnode.op == "pointerType") {
            let t = this.createType(tnode.rhs, scope);
            return this.makePointer(t, tnode.loc);
        } else if (tnode.op == "unsafePointerType") {
            let t = this.createType(tnode.rhs, scope);
            return this.makeUnsafePointer(t, tnode.loc);
        } else if (tnode.op == "guardedPointerType") {
            let t = this.createType(tnode.rhs, scope);
            throw "TODO"
            // return this.makeGuardardPointer(t, tnode.loc);
        } else if (tnode.op == "sliceType") {
            let t = this.createType(tnode.rhs, scope);
            return this.makeSlice(t, tnode.loc);
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
            return t;
        } else if (tnode.op == "funcType" || tnode.op == "asyncFuncType") {
            let t = new FunctionType();
            if (tnode.op == "asyncFuncType") {
                t.callingConvention = "fyrCoroutine";
            }
            t.loc = tnode.loc;
            if (tnode.parameters) {
                for(let pnode of tnode.parameters) {
                    var p = new FunctionParameter();
                    if (pnode.op == "ellipsisParam") {
                        p.ellipsis = true;
                        pnode = pnode.lhs;
                    }
                    p.type = this.createType(pnode, scope);
                    if (p.ellipsis && !(p.type instanceof SliceType)) {
                        throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                    }
                    p.type = this.makeScoped(p.type, scope, pnode.loc);
                    p.loc = pnode.loc;
                    t.parameters.push(p);
                }
            }
            if (tnode.rhs) {
                t.returnType = this.createType(tnode.rhs, scope);
            } else {
                t.returnType = this.t_void;
            }
            return t;
        } else if (tnode.op == "genericType" && tnode.lhs.op == "id" && tnode.lhs.value == "map") {
            if (tnode.genericParameters.length != 2) {
                throw new TypeError("Supplied type arguments do not match signature of map", tnode.loc);
            }
            // TODO: Allow all types in maps?
            let k = this.createType(tnode.genericParameters[0], scope);
            let v = this.createType(tnode.genericParameters[1], scope);
            if (!this.isIntNumber(k) && k != this.t_string && !this.isPointer(k)) {
                throw new TypeError("Map keys must be integers, strings, or pointers", tnode.loc);
            }
            return new MapType(k, v);
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
            if (baset instanceof GenericStructType) {
                if (baset.base) {
                    throw new TypeError("Cannot instantiate an instantion of a generic struct", tnode.loc);
                }
                let types: Array<Type> = [];
                for(let i = 0; i < tnode.genericParameters.length; i++) {
                    types.push(this.makeBox(this.createType(tnode.genericParameters[i], scope), tnode.loc));
                }
                return this.instantiateGenericStructType(baset, types, tnode.loc);
/*                let ct = new GenericStructInstanceType();
                if (baset.genericParameterTypes.length != tnode.genericParameters.length) {
                    throw new TypeError("Supplied type arguments do not match signature of " + baset.toString(), tnode.loc);
                }
//                let mapping = new Map<Type, Type>();
                ct.loc = tnode.loc;
                ct.base = baset;
                for(let i = 0; i < tnode.genericParameters.length; i++) {
                    let pnode = tnode.genericParameters[i];
                    let pt = this.createType(pnode, scope);
                    ct.genericParameterTypes.push(pt);
                    // TODO: Check that pt extends baset.genericParameterTypes[i]
//                    mapping.set(pt, baset.genericParameterTypes[i]);
                }
                // TODO: Instantiate the type of ct, e.g. all function signatures and properties.
                return ct; */
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
                        }
                        p.name = pnode.name.value;
                        p.type = this.createType(pnode, s);
                        p.loc = pnode.loc;
                        ft.parameters.push(p);
                    }
                }
                if (fnode.rhs) {
                    ft.returnType = this.createType(fnode.rhs, s);
                } else {
                    ft.returnType = this.t_void;
                }
                return ft;
            }
            throw new TypeError("Type " + baset.toString() + " is not a generic type", tnode.loc);
        } else if (tnode.op == "orType") {
            return this.createOrType(tnode, scope);
        } else if (tnode.op == "andType") {
            return this.createInterfaceType(tnode, scope);
        } else if (tnode.op == "structType") {
            return this.createStructType(tnode, scope);
        } else if (tnode.op == "interfaceType") {
            return this.createInterfaceType(tnode, scope);
        }
        throw "Implementation error for type " + tnode.op
    }

    private createOrType(tnode: Node, scope: Scope, t?: OrType): Type {
        // TODO: Avoid double entries
        if (!t) {
            t = new OrType();
        }
        for(let i = 0; i < tnode.parameters.length; i++) {
            let pnode = tnode.parameters[i];
            let pt = this.createType(pnode, scope);
            if (pt instanceof OrType) {
                t.types = t.types.concat(pt.types);
            } else {
                t.types.push(pt);
            }
        }
        return t;
    }

    private createInterfaceType(tnode: Node, scope: Scope, iface?: InterfaceType): Type {
        if (!iface) {
            iface = new InterfaceType();
            iface.loc = tnode.loc;
            this.ifaces.push(iface);
        }
        iface.loc = tnode.loc;

        if (tnode.op == "andType") {
            for(let i = 0; i < tnode.parameters.length; i++) {
                let pnode = tnode.parameters[i];
                let pt = this.createType(pnode, scope);
                if (!(pt instanceof InterfaceType)) {
                    throw new TypeError(pt.toString() + " is not an interface", pnode.loc);
                }
                iface.extendsInterfaces.push(pt);
            }
            return iface;
        }

        if (tnode.parameters.length == 1 && tnode.parameters[0].op == "extends") {
            let t = this.createType(tnode.parameters[0].rhs, scope);
            return this.makeBox(t, tnode.parameters[0].rhs.loc, iface);
        }
        for(let mnode of tnode.parameters) {
            if (mnode.op == "extends") {
                let t = this.createType(mnode.rhs, scope);
                if (!(t instanceof InterfaceType)) {
                    throw new TypeError(t.toString() + " is not an interface", mnode.loc);
                }
                iface.extendsInterfaces.push(t);
            }
        }
        for(let mnode of tnode.parameters) {
            if (mnode.op == "extends") {
                // Do nothing by intention
            } else if (mnode.op == "funcType" || mnode.op == "asyncFuncType") {
                if (iface.isBoxedType()) {
                    throw new TypeError("Boxed types cannot have functions", mnode.loc);
                }
                let ft = this.createType(mnode, scope) as FunctionType;
                ft.name = mnode.name.value;
                if (iface.methods.has(ft.name)) {
                    throw new TypeError("Duplicate member name " + ft.name, mnode.loc);
                }
                iface.methods.set(ft.name, ft);
                ft.objectType = iface;
                if (mnode.lhs) {
                    if (mnode.lhs.op == "constType") {
                        if (ft.objectType instanceof RestrictedType) {
                            ft.objectType.isConst = true;
                        } else {
                            ft.objectType = new RestrictedType(ft.objectType, {isConst: true, scope: null});
                        }
                    } else if (mnode.lhs.op == "referenceType") {
                        if (ft.objectType instanceof RestrictedType) {
                            ft.objectType.scope = scope;
                        } else {
                            ft.objectType = new RestrictedType(ft.objectType, {isConst: false, scope: scope});                            
                        }
                    } else {
                        throw "Implementation error";
                    }
                }
            } else {
                throw "Implementation error " + mnode.op + " " + iface.name;
            }
        }
        return iface;
    }

    private checkInterfaceType(iface: InterfaceType) {
        if (iface._markChecked) {
            return;
        }
        iface._markChecked = true;

        if (iface.isBoxedType()) {
            return;
        }

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

    private createStructType(tnode: Node, scope: Scope, s?: StructType): StructType {
        if (!s) {
            s = new StructType();
            s.loc = tnode.loc;
            this.structs.push(s);
        }
                
        for(let fnode of tnode.parameters) {
            if (fnode.op == "extends") {
                let ext: Type = this.createType(fnode.rhs, scope);
                if (!(ext instanceof StructType)) {
                    throw new TypeError("Struct can only extend another struct", tnode.lhs.loc);
                }
                if (s.extends) {
                    throw new TypeError("Struct cannot extend multiple structs", fnode.loc);
                }
                s.extends = ext;
                if (s.extends.name != "") {
                    if (s.field(s.extends.name)) {
                        throw new TypeError("Duplicate field name " + s.extends.name, fnode.loc);                        
                    }
                }
                let f = new StructField();
                f.name = s.extends.name;
                f.type = s.extends;
                s.fields.unshift(f);
            } else if (fnode.op == "implements") {
                let ext: Type = this.createType(fnode.rhs, scope);
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
                field.type = this.createType(fnode.rhs, scope);
                s.fields.push(field);
            } else {
                throw "Implementation error";
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
            this.checkStructType(s.extends);
            let bases = s.getAllBaseTypes();
            if (bases && bases.indexOf(s) != -1) {
                throw new TypeError("Struct " + s.name + " is extending itself", s.loc);
            }
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
        for(let iface of s.implements) {
            this.checkIsAssignableType(iface, new PointerType(s), s.loc);
        }
    }

    private instantiateGenericStructType(s: GenericStructType, types: Array<Type>, loc: Location): GenericStructType {
        let a = this.genericStructs.get(s);
        if (a) {
            for(let g of a) {
                let ok = true;
                for(let k = 0; k < types.length; k++) {
                    let type = types[k];
                    let hasType = g.genericParameterTypes[k];
                    if (!this.checkTypeEquality(type, hasType, loc, false)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
//                    console.log("GENERIC found", types)
                    return g;
                }
            }
        }

        let g = new GenericStructType();
        g.base = s;
        g.genericParameterTypes = types;
        g.genericParameterNames = s.genericParameterNames;
        if (a) {
            a.push(g);
        } else {
            this.genericStructs.set(s, [g]);
        }
        let tr = new Map<Type, Type>();
        for(let i = 0; i < types.length; i++) {
            tr.set(s.genericParameterTypes[i], types[i]);
        }
//        console.log("===============>", types)
        this.translateType(s, tr, g);
//        console.log("<===============")
        return g;
    }

    public createFunction(fnode: Node, parentScope: Scope, registerScope: Scope): Function {
        if (!fnode.name) {
            throw new TypeError("Function must be named", fnode.loc);
        }
        let pseudoScope = new Scope(parentScope);  
        pseudoScope.isPseudoScope = true;      
        let f: Function = new Function();
        f.name = fnode.name.value;
        f.scope.parent = pseudoScope;
        f.node = fnode;
        f.loc = fnode.loc;
        f.isExported = (fnode.op == "export_func");
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
        if (fnode.op == "asyncFunc") {
            f.type.callingConvention = "fyrCoroutine";
        }
        // A member function?
        if (fnode.lhs) {
            let obj = fnode.lhs;
            if (obj.op == "constType") {
                f.type.objectTypeIsConst = true;
                obj = obj.rhs;
            }
            if (obj.op == "referenceType") {
                f.type.objectTypeIsScoped = true;
                obj = obj.rhs;
            }
            f.type.objectType = this.createType(obj, f.scope);
            if (!this.isStruct(f.type.objectType)) {
                throw new TypeError("Functions cannot be attached to " + f.type.objectType.toString(), fnode.lhs.loc);                
            }
            if (f.type.objectType instanceof GenericStructType) {
                if (f.type.objectType.base) {
                    throw new TypeError("Functions cannot be attached to instantiated generic types", fnode.lhs.loc);
                }
                for(let i = 0; i < f.type.objectType.genericParameterNames.length; i++) {
                    f.scope.registerType(f.type.objectType.genericParameterNames[i], f.type.objectType.genericParameterTypes[i]);
                    pseudoScope.registerType(f.type.objectType.genericParameterNames[i], f.type.objectType.genericParameterTypes[i]);
                }
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
                p.type = this.createType(pnode, pseudoScope);
                if (p.ellipsis && !(p.type instanceof SliceType)) {
                    throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                }
                p.type = this.makeScoped(p.type, f.scope, pnode.loc);
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

    // TODO: Remove isConst
    private createVar(vnode: Node, scope: Scope, needType: boolean = true, isConst: boolean = false, isGlobal: boolean = false): Variable {
        let v = new Variable();
        v.loc = vnode.loc;
        v.name = vnode.value;
        v.isConst = isConst;
        v.isGlobal = isGlobal;
        if (!vnode.rhs) {
            if (needType) {
                throw new TypeError("Variable declaration of " + vnode.value + " without type information", vnode.loc);
            }
        } else {
            v.type = this.createType(vnode.rhs, scope);
//            if (isConst) {
//                v.type = this.makeConst(v.type, vnode.loc);
//            }
            if (!isGlobal) {
                v.type = this.makeScoped(v.type, scope, vnode.loc);
            }
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
        if (t.node.rhs.op == "structType") {
            let s: StructType;
            if (t.node.genericParameters) {
                s = new GenericStructType();
                let isInterfaceGeneric = true;
                let i = 0;
                for(let g of tnode.genericParameters) {
                    (s as GenericStructType).genericParameterNames.push(g.value);
                    if (g.condition) {
                        let c = this.createType(g.condition, scope);
                        (s as GenericStructType).genericParameterTypes.push(c);
                        isInterfaceGeneric = isInterfaceGeneric && (this.isInterface(c));
                    } else {
                        (s as GenericStructType).genericParameterTypes.push(null);
                        isInterfaceGeneric = false;
                    }
                    i++;
                }
                if (isInterfaceGeneric) {
                    t.scope = new Scope(t.scope);
                    for(let i = 0; i < (s as GenericStructType).genericParameterNames.length; i++) {
                        t.scope.registerType((s as GenericStructType).genericParameterNames[i], (s as GenericStructType).genericParameterTypes[i]);
                    }
                    this.genericStructs.set(s as GenericStructType, [s as GenericStructType]);
                }
            } else {
                s = new StructType();
            }
            s.loc = t.node.loc;
            s.name = t.name;
            this.structs.push(s);
            t.type = s;
            scope.registerType(t.name, s, tnode.loc);
        } else if (t.node.rhs.op == "interfaceType" || t.node.rhs.op == "andType") {
            if (t.node.genericParameters) {
                throw "TODO";
            }
            let iface = new InterfaceType();
            iface.loc = t.node.loc;
            iface.name = t.name;
            this.ifaces.push(iface);
            t.type = iface;
            scope.registerType(t.name, iface, tnode.loc);
        } else if (t.node.rhs.op == "orType") {
            if (t.node.genericParameters) {
                throw "TODO";
            }
            let newt = new OrType();
            newt.loc = t.node.loc;
            newt.name = t.name;
            t.type = newt;
            scope.registerType(t.name, newt, tnode.loc);
        } else {
            throw new TypeError("A type must be a struct, interface, union type or an enum", tnode.loc);
        }
        return t;
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

        // Iterate over all files and process all imports
        for(let fnode of mnode.statements) {
            fnode.scope = new Scope(scope);
            for (let snode of fnode.statements) {
                if (snode.op == "import") {
                    this.createImport(snode, fnode.scope);
                }
            }
        }

        // Iterate over all files and declare all types.
        // The body of structs and interfaces is processed after all types are declared,
        // because types can reference themselves or each other cross-wise.
        for(let fnode of mnode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "typedef") {
                    let t = this.createTypedef(snode, scope);
                    typedefs.push(t);
                }
            }
        }

        // Define all types which have been declared before
        for(let t of typedefs) {
            if (t.type instanceof StructType) {
                this.createStructType(t.node.rhs, t.scope, t.type);
            } else if (t.type instanceof InterfaceType) {
                this.createInterfaceType(t.node.rhs, t.scope, t.type);
            } else if (t.type instanceof OrType) {
                this.createOrType(t.node.rhs, t.scope, t.type);
            }
        }

        // Iterate over all files and declare all functions and global variables
        // and handle all imports
        for(let fnode of mnode.statements) {
            for (let snode of fnode.statements) {
                if (snode.op == "func" || snode.op == "export_func" || snode.op == "asyncFunc") {
                    let f = this.createFunction(snode, fnode.scope, scope);                    
                    functions.push(f);
                } else if (snode.op == "var") {
                    let v = this.createVar(snode.lhs, scope, false, false, true);
                    v.node = snode;
                    globalVariables.push(v);
                } else if (snode.op == "const") {
                    let v = this.createVar(snode.lhs, scope, false, true, true);
                    v.node = snode;
                    globalVariables.push(v);
                } else if (snode.op == "import") {
                    // Do nothing by intention
                } else if (snode.op == "typedef") {
                    // Do nothing by intention
                } else if (snode.op == "comment") {
                    // Do nothing by intention
                } else {
                    throw "Implementation error " + snode.op;
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

        // Check variable assignments
        for(let v of globalVariables) {
            this.checkGlobalVariable(v, scope);
        }

        // Check function bodies
        for(let e of functions) {
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

    // TODO: Remove isConst
    public checkVarAssignment(isConst: boolean, scope: Scope, vnode: Node, rtype: Type, rnode: Node = null) {
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
//                if (isConst && this.isMutableValue(v.type)) {
//                    v.type = this.makeConst(v.type, vnode.loc);
//                }
            } else {
                if (rnode) {
                    this.checkIsAssignableNode(v.type, rnode);
                } else {
                    this.checkIsAssignableType(v.type, rtype, vnode.loc, true);
                }
            }
        } else if (vnode.op == "tuple") {
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
                    let v = this.createVar(p, scope, false, isConst);
                    if (!v.type) {
                        v.type = new TupleType(rtype.types.slice(i));
                        if (isConst) {
                            v.type = new RestrictedType(v.type, {isConst: true, scope: null});
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (!(lt instanceof TupleType)) {
                            throw new TypeError("Ellipsis identifier in a tuple context must be of tuple type", vnode.loc);
                        }
                        if (lt.types.length != rtype.types.length - i) {
                            throw new TypeError("Mismatch in tuple type length", vnode.loc);                                                
                        }
                        if (rnode && rnode.op == "tuple") {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                let r = rnode.parameters[j];
                                this.checkIsAssignableNode(lt.types[j-i], r);
                            }
                        } else {
                            this.checkIsAssignableType(v.type, new TupleType(rtype.types.slice(i)), vnode.loc);
                        }
                    }
//                    if (isConst && !this.isPrimitiveOrPointer(v.type)) {
//                        v.type = this.makeConst(v.type, vnode.loc);
//                    }
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
            if (!(rtype instanceof ArrayLiteralType) && !(rtype instanceof ArrayType) && !(rtype instanceof SliceType) && rtype != this.t_string) {
                throw new TypeError("Expected an expression of array type, slice type, or string or json", vnode.loc);
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
                    let v = this.createVar(p, scope, false, isConst);
                    if (!v.type) {
                        if (rtype instanceof ArrayLiteralType) {
                            for(let j = i; j < rnode.parameters.length; j++) {
                                // TODO: Check that all elements of the array have the same type
//                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j]);
//                                rtype.types[j] = rnode.parameters[j].type;
                            }
//                            v.type = new SliceType(this.t_json);
                            throw "TODO";
                        } else if (rtype instanceof ArrayType) {
                            v.type = new ArrayType(rtype.elementType, rtype.size - i);
                        } else if (rtype instanceof SliceType) {
                            v.type = new SliceType(rtype.elementType);
                        } else if (rtype == this.t_string) {
                            v.type = this.t_string;
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (rtype instanceof ArrayLiteralType) {
                            let rt: Type;
                            if (lt instanceof ArrayType) {
                                if (rtype.types.length - i != lt.size) {
                                    throw new TypeError("Mismatch in array type length", vnode.loc);
                                }
                                rt = lt.elementType;
                            } else if (lt instanceof SliceType) {
                                rt = lt.elementType;
                            } else if (lt == this.t_string) {
                                rt = this.t_byte;
                            } else {
                                throw new TypeError("Ellipsis identifier must be of array type, slice type, string or json", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j]);
                            }
                        } else if (rtype instanceof ArrayType) {
                            if (!(lt instanceof ArrayType)) {
                                throw new TypeError("Ellipsis identifier must be of array type", vnode.loc);
                            }
                            if (lt.size != rtype.size - i) {
                                throw new TypeError("Mismatch in array size", vnode.loc);                                                
                            }
                            this.checkIsAssignableType(lt.elementType, rtype.elementType, vnode.loc);
                        } else if (rtype instanceof SliceType) {
                            if (!(lt instanceof SliceType)) {
                                throw new TypeError("Ellipsis identifier must be of slice type", vnode.loc);
                            }
                            this.checkIsAssignableType(lt.elementType, rtype.elementType, vnode.loc);
                        } else if (rtype == this.t_string) {
                            this.checkIsAssignableType(v.type, this.t_string, vnode.loc);
                        }
                    }
//                    if (isConst && !this.isPrimitiveOrPointer(v.type)) {
//                        v.type = this.makeConst(v.type, vnode.loc);
//                    }
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
                    }
                    this.checkVarAssignment(isConst, scope, p, rt, r);
                }
            }
            if (!hasEllipsis && rtype instanceof ArrayType && rtype.size != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "object") {
            if (!(rtype instanceof ObjectLiteralType) && (!(rtype instanceof MapType) || rtype.keyType != this.t_string)) {
                throw new TypeError("Expected an expression of type object literal or map<string,...>", vnode.loc);
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
                        if (rtype instanceof ObjectLiteralType) {
                            let valueType: Type = null; // TODO
                            for(let j = i; j < rnode.parameters.length; j++) {
//                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j].lhs);
                            }
                            v.type = new MapType(this.t_string, valueType);
                            throw "TODO";
                        } else if (rtype instanceof GenericStructType) {
                            v.type = rtype;
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (rtype instanceof ObjectLiteralType) {
                            let rt: Type;
                            if (lt instanceof MapType && lt.keyType == this.t_string) {
                                rt = lt.valueType;
                            } else {
                                throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j].lhs);
                            }
                        } else if (rtype instanceof MapType) {
                            if (!(lt instanceof MapType) || lt.keyType != this.t_string) {
                                throw new TypeError("Ellipsis identifier must be of type map<string, ...>", vnode.loc);
                            }
                            this.checkIsAssignableType(lt.valueType, rtype.valueType, vnode.loc);
                        }
                    }
//                    if (isConst && !this.isPrimitiveOrPointer(v.type)) {
//                        v.type = this.makeConst(v.type, vnode.loc);
//                    }
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
                    } else if (rtype instanceof GenericStructType) {
                        rt = rtype.genericParameterTypes[1];
                    }
                    this.checkVarAssignment(isConst, scope, p, rt, r);
                }
            }
        }
    }

    public checkAssignment(scope: Scope, vnode: Node, rtype: Type, rnode: Node = null) {
        if (vnode.op == "tuple") {
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
            // The type of the right-hand side might have been inferred. In this case, compute the new type
            if (rnode && rnode.op == "tuple") {
                let types: Array<Type> = [];
                for(let p of rnode.parameters) {
                    types.push(p.type);
                }
                rnode.type = new TupleType(types);
            }
        } else if (vnode.op == "array") {
            if (!(rtype instanceof ArrayLiteralType) && !(rtype instanceof ArrayType) && !(rtype instanceof SliceType) && rtype != this.t_string) {
                throw new TypeError("Expected an expression of array type, slice type, or string or json", vnode.loc);
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
                        this.checkIsAssignableType(p.lhs.type.elementType, rtype.elementType, vnode.loc);
                    } else if (rtype instanceof SliceType) {
                        if (!(p.lhs.type instanceof SliceType)) {
                            throw new TypeError("Ellipsis identifier must be of slice type", vnode.loc);
                        }
                        this.checkIsAssignableType(p.lhs.type.elementType, rtype.elementType, vnode.loc);
                    } else if (rtype == this.t_string) {
                        this.checkIsAssignableType(p.lhs.type, this.t_string, vnode.loc);
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
                    }
                    this.checkAssignment(scope, p, rt, r);
                }
            }
            if (!hasEllipsis && rtype instanceof ArrayType && rtype.size != vnode.parameters.length) {
                throw new TypeError("Mismatch in tuple type length", vnode.loc);
            }
        } else if (vnode.op == "object") {
            if (!(rtype instanceof ObjectLiteralType) && (!(rtype instanceof MapType) || rtype.keyType != this.t_string)) {
                throw new TypeError("Expected an expression of type object literal or map<string, ...>", vnode.loc);
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
                        if (kv.lhs.type instanceof MapType && kv.lhs.type.keyType == this.t_string) {
                            rt = kv.lhs.type.valueType;
                        } else {
                            throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j].lhs);
                        }
                    } else if (rtype instanceof GenericStructType) {
                        if (!(kv.lhs.type instanceof MapType) || kv.lhs.type.keyType != this.t_string) {
                            throw new TypeError("Ellipsis identifier must be of type map<string,...>", vnode.loc);
                        }
                        this.checkIsAssignableType(kv.lhs.type.valueType, rtype.valueType, vnode.loc);
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
                    } else if (rtype instanceof GenericStructType) {
                        rt = rtype.genericParameterTypes[1];
                    }
                    this.checkAssignment(scope, p, rt, r);
                }
            }
        } else {
            this.checkExpression(vnode, scope);
            this.checkIsMutable(vnode, scope);
            if (rnode) {
                this.checkIsAssignableNode(vnode.type, rnode);
            } else {
                this.checkIsAssignableType(vnode.type, rtype, vnode.loc, true);
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
                this.checkIsAssignableType(this.t_bool, snode.condition.type, snode.condition.loc);
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
                            this.checkIsAssignableType(this.t_bool, snode.condition.condition.type, snode.condition.condition.loc);
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
                    if (snode.op == "const") {
                        throw "Implementation error: const without initialization"
                    }
                    if (snode.lhs.op == "id") {
                        let v = this.createVar(snode.lhs, scope, true);
                    } else {
                        for (let p of snode.lhs.parameters) {
                            let v = this.createVar(p, scope);                            
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
                if (snode.op == "+=" && this.isString(snode.lhs.type)) {
                    this.checkIsString(snode.rhs);
                } else if (this.isUnsafePointer(snode.lhs.type)) {
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
                        this.checkIsAssignableType(snode.lhs.type, snode.rhs.type, snode.loc);
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
                if (this.isUnsafePointer(snode.lhs.type)) {
                    if (snode.op == "%=") {
                        throw new TypeError("'%=' is an invalid operation on pointers", snode.loc);
                    }
                    if (snode.rhs.op == "int") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                    } else {
                        this.checkIsAssignableType(this.t_int, snode.rhs.type, snode.loc);
                    }
                } else {
                    this.checkIsIntNumber(snode.lhs);
                    this.checkIsIntNumber(snode.rhs);
                    if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                    } else {
                        this.checkIsAssignableType(snode.lhs.type, snode.rhs.type, snode.loc);
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
                    if (snode.lhs.parameters[1].value != "_") {
                        this.checkExpression(snode.lhs.parameters[1], scope);
                        this.checkIsAssignable(snode.lhs.parameters[1], scope);
                        this.checkIsAssignableType(snode.lhs.parameters[1].type, tindex2, snode.loc);
                    }
                } else {
                    if (snode.lhs.value != "_") {
                        this.checkExpression(snode.lhs, scope);
                        this.checkIsAssignable(snode.lhs, scope);
                        this.checkIsAssignableType(snode.lhs.type, tindex1, snode.loc);
                    }
                }
                break;
            case "var_in":
            {
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
                    if (snode.lhs.parameters[0].value != "_") {
                        let v1 = this.createVar(snode.lhs.parameters[0], scope, false);
                        if (v1.type) {
                            this.checkIsAssignableType(v1.type, tindex1, snode.loc);
                        } else {
                            v1.type = tindex1
                        }
                    }
                    if (snode.lhs.parameters[1].value != "_") {
                        let v2 = this.createVar(snode.lhs.parameters[1], scope, false);
                        if (v2.type) {
                            this.checkIsAssignableType(v2.type, tindex2, snode.loc);
                        } else {
                            v2.type = tindex2;
                        }
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
                if (f.type.callingConvention != "fyrCoroutine") {
                    throw new TypeError("yield is only allowed in async function", snode.loc);
                }
                break;
            }
            case "spawn":
            {
                this.checkExpression(snode.rhs, scope);
                if (snode.rhs.op != "(") {
                    throw "Implementation error";
                }
                if (!(snode.rhs.lhs.type instanceof FunctionType)) {
                    throw "Implementation error";
                }
                if ((snode.rhs.lhs.type as FunctionType).returnType != this.t_void) {
                    throw new TypeError("Functions invoked via 'spawn' must return void", snode.loc);
                }
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
            case "rune":
                enode.type = this.t_rune;
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
                if (this.isUnsafePointer(enode.lhs.type)) {
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
                enode.type = this.stripType(enode.rhs.type);
                break;
            case "unary+":
                this.checkExpression(enode.rhs, scope);
                this.checkIsNumber(enode.rhs);
                if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                    enode.op = enode.rhs.op;
                    enode.value = enode.rhs.value;
                }
                enode.type = this.stripType(enode.rhs.type);
                break;
            case "unary^":
                this.checkExpression(enode.rhs, scope);
                this.checkIsIntNumber(enode.rhs);
                if (enode.rhs.op == "int") {
                    enode.op = enode.rhs.op;
                    enode.value = (~parseInt(enode.rhs.value)).toString();
                }
                enode.type = this.stripType(enode.rhs.type);
                break;
            case "unary!":
                this.checkExpression(enode.rhs, scope);
                this.checkIsBool(enode.rhs);
                if (enode.rhs.op == "bool") {
                    enode.op = enode.rhs.op;
                    enode.value = enode.rhs.value == "true" ? "false" : "true";
                }
                enode.type = this.t_bool;
                break;
            case "unary*":
            {
                this.checkExpression(enode.rhs, scope);
                this.checkIsPointer(enode.rhs);
                let isConst = this.isConst(enode.rhs.type);
                let t = this.stripType(enode.rhs.type);
                enode.type = (t as PointerType).elementType;
                if (isConst) {
                    enode.type = this.makeConst(enode.type, enode.loc);
                }
                break;
            }
            case "unary&":
            {
                this.checkExpression(enode.rhs, scope);
                if (this.checkIsAddressable(enode.rhs, scope, true, false)) {
                    // The & operator does not perform automatic unboxing
                    enode.type = this.makePointer(enode.rhs.type, enode.loc);                
                } else {
                    enode.type = this.makePointerReference(enode.rhs.type, scope, enode.loc);
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
                } else if (this.isUnsafePointer(enode.lhs.type)) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsInt32Number(enode.rhs);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                    enode.type = this.stripType(enode.lhs.type);
                } else if (this.isUnsafePointer(enode.rhs.type)) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsInt32Number(enode.lhs);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                    enode.type = this.stripType(enode.rhs.type);
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
                            enode.lhs.type = this.t_double;
                        } else {
                            enode.op = "int";
                        }
                    } else if (enode.lhs.op == "int" || enode.lhs.op == "float") {
                        this.unifyLiterals(enode.rhs.type, enode.lhs, enode.loc);
                    } else if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, enode.loc);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-" || enode.op == "*" || enode.op == "/" || enode.op == "float" || enode.op == "int") {
                        enode.type = this.stripType(enode.lhs.type);
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
                    } else if (this.isUnsafePointer(enode.lhs.type)) {
                        this.checkIsAssignableType(this.t_uint, enode.rhs.type, enode.rhs.loc);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc);
                    }
                }
                enode.type = this.stripType(enode.lhs.type);
                break;
            case "==":
            case "!=":
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let tl = this.stripType(enode.lhs.type);
                if (tl instanceof OrType && !tl.stringsOnly()) {
                    throw new TypeError("Or'ed types cannot be compared", enode.lhs.loc);
                }
                if (tl instanceof InterfaceType && (tl.isBoxedType() || tl.isEmptyInterface())) {
                    throw new TypeError("Empty interfaces and boxed types cannot be compared", enode.lhs.loc);
                }
                let tr = this.stripType(enode.rhs.type);
                if (tr instanceof OrType && !tr.stringsOnly()) {
                    throw new TypeError("Or'ed types cannot be compared", enode.rhs.loc);
                }
                if (tr instanceof InterfaceType && (tr.isBoxedType() || tr.isEmptyInterface())) {
                    throw new TypeError("Empty interfaces and boxed types cannot be compared", enode.rhs.loc);
                }
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
                    this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc);
                }
                enode.type = this.t_bool;
                break;
            case ".":
            {
                this.checkExpression(enode.lhs, scope);
                let isConst = this.isConst(enode.lhs.type);
                let isScoped = this.isScoped(enode.lhs.type);
                let type: Type = this.stripType(enode.lhs.type);
                if (type instanceof PointerType || type instanceof UnsafePointerType || type instanceof GuardedPointerType) {
                    isConst = isConst || this.isConst(type.elementType);
                    isScoped = this.isScoped(type.elementType);
                    type = this.stripType(type.elementType);
                }
                if (type instanceof StructType) {
                    let name = enode.name.value;
                    let field = type.field(name);
                    if (field) {
                        enode.type = field.type;
                        if (isConst) {
                            enode.type = this.makeConst(enode.type, enode.loc);
                        }
                        if (isScoped) {
                            enode.type = this.makeScoped(enode.type, isScoped, enode.loc);
                        }
                    } else {
                        let method = type.method(name);
                        if (!method) {
                            throw new TypeError("Unknown field or method " + name + " in " + type.toString(), enode.name.loc);
                        }
                        if (isConst && !method.objectTypeIsConst) {
                            throw new TypeError("Method " + name + " is not const", enode.loc);
                        }
                        if (isScoped && !method.objectTypeIsScoped) {
                            throw new TypeError("Method " + name + " is not allowed on a reference", enode.loc);
                        }
                        enode.type = method;
                    }
                } else if (type instanceof InterfaceType) {
                    let name = enode.name.value;
                    let method = type.method(name);
                    if (!method) {
                        throw new TypeError("Unknown method " + name + " in " + type.toString(), enode.name.loc);
                    }
                    isScoped = type.pointerScope;
                    if (isConst && !method.objectTypeIsConst) {
                        throw new TypeError("Method " + name + " is not const", enode.loc);
                    }
                    if (isScoped && !method.objectTypeIsScoped) {
                        throw new TypeError("Method " + name + " is not allowed on interface reference", enode.loc);
                    }
                    enode.type = method;
                } else if (type instanceof PackageType) {
                    if (!type.elements.has(enode.name.value)) {
                        throw new TypeError("Unknown identifier " + enode.name.value + " in " + type.toString(), enode.name.loc);                        
                    }
                    enode.type = type.elements.get(enode.name.value);
                } else {
                    let name = enode.name.value;
                    let method = this.getBuiltinFunction(enode.lhs.type, name, enode.name.loc);
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
                let isConst = this.isConst(enode.lhs.type);
                let t: Type = this.stripType(enode.lhs.type);
                let elementType = this.checkIsIndexable(enode.lhs, index1);
                if (t instanceof ArrayType) {
                    this.checkIsAddressable(enode.lhs, scope, false);
                    this.checkIsIndexable(enode.lhs, index2, true);
                    let isScoped = this.isScoped(enode.lhs.type);
                    let s = this.makeSlice(elementType, enode.loc);
                    if (isScoped) {
                        s.arrayScope = isScoped;
                    }
                    enode.type = s;
                    if (isConst) {
                        enode.type = this.makeConst(enode.type, enode.loc);
                    }
                } else if (t instanceof UnsafePointerType || t instanceof GuardedPointerType) {
                    enode.type = this.makeSlice(elementType, enode.loc);
                    if (isConst) {
                        enode.type = this.makeConst(enode.type, enode.loc);
                    }
                } else if (t instanceof MapType) {
                    throw new TypeError("Ranges are not supported on maps", enode.loc);
                } else {
                    // For strings and slices the type remains the same
                    enode.type = enode.lhs.type;
                }
                break;
            }
            case "[":
            {
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let isConst = this.isConst(enode.lhs.type);
                let isScoped = this.isScoped(enode.lhs.type);
                let t: Type = this.stripType(enode.lhs.type);
                if (t instanceof TupleType) {
                    this.checkIsIntNumber(enode.rhs);
                    if (enode.rhs.op != "int") {
                        throw new TypeError("Index inside a tuple must be a constant number", enode.lhs.loc);
                    }
                    let index = parseInt(enode.rhs.value);
                    enode.type = this.checkIsIndexable(enode.lhs, index);
                } else if (t instanceof ArrayType) {
                    this.checkIsIntNumber(enode.rhs);
                    let index = 0;
                    if (enode.rhs.op == "int") {
                        index = parseInt(enode.rhs.value);
                    }
                    enode.type = this.checkIsIndexable(enode.lhs, index);
                } else if (t instanceof MapType) {
                    if (enode.rhs.isUnifyableLiteral()) {
                        this.unifyLiterals(t.keyType, enode.rhs, enode.rhs.loc);
                    } else {
                        this.checkIsAssignableType(t.keyType, enode.rhs.type, enode.rhs.loc);
                    }
                    enode.type = t.valueType;
                } else if (t instanceof SliceType) {
                    isScoped = t.arrayScope;
                    enode.type = t.elementType;
                } else if (t instanceof UnsafePointerType || t instanceof GuardedPointerType) {
                    isScoped = null;
                    enode.type = t.elementType;
                } else {
                    throw new TypeError("[] operator is not allowed on " + enode.lhs.type.toString(), enode.loc);
                }
                if (isConst) {
                    enode.type = this.makeConst(enode.type, enode.loc);
                }
                if (isScoped) {
                    enode.type = this.makeScoped(enode.type, isScoped, enode.loc);
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
                let t = this.stripType(enode.lhs.type);
                if (!(t instanceof FunctionType)) {
                    throw new TypeError("Expression is not a function", enode.loc);
                }
                let ft: FunctionType = t;
                if (ft instanceof GenericFunctionType) {
                    throw "TODO: Generics";
                } else if (ft instanceof PolymorphFunctionType) {
                    var ok = false;
                    for(let it of ft.instances) {
                        if (this.checkFunctionArguments(it, enode.parameters, scope, enode.loc, false)) {
                            ok = true;
                            ft = it;
                            enode.lhs.type = ft;    
                            break;
                        }                        
                    }
                    if (!ok) {
                        throw new TypeError("Parameters match no instance of the polymorphic function " + ft.name, enode.loc);
                    }
                } else {
                    this.checkFunctionArguments(ft, enode.parameters, scope, enode.loc);
                }
                /*
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
                            this.checkIsAssignableNode(ft.lastParameter().type, pnode.rhs, true);
                        } else {
                            this.checkExpression(pnode, scope);
                            if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                                this.checkIsAssignableNode((ft.lastParameter().type as SliceType).elementType, pnode);
                            } else {
                                this.checkIsAssignableNode(ft.parameters[i].type, pnode, true);
                            }
                        }
                    }
                } else if (ft.parameters.length != 0 && (!ft.hasEllipsis || ft.parameters.length > 1)) {
                    throw new TypeError("Supplied parameters do not match function signature " + ft.toString(), enode.loc);                    
                }
                */
                enode.type = this.makeScoped(ft.returnType, scope, enode.loc);
                /*
                // Construct the call graph
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
                */
                break;
            }
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
                        this.checkIsAssignableNode(f.type.returnType, enode.rhs);
                    }
                } else {
                    for(let s of enode.statements) {
                        this.checkStatement(s, enode.scope);
                    }
                }
                break;
            }
            case "is":
            {
                this.checkExpression(enode.lhs, scope);
                let t = this.createType(enode.rhs, scope);
                enode.rhs.type = t
                if (this.isOrType(enode.lhs.type)) {
                    let ot = this.stripType(enode.lhs.type) as OrType;
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
                    if (this.isInterface(t)) {
                        throw new TypeError("Interface cannot be contained by another interface", enode.loc);
                    }
                }
                enode.type = this.t_bool;
                break;
            }
            case "typeCast":
            {
                let t = this.createType(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let right = RestrictedType.strip(enode.rhs.type);
                // TODO: Casts remove restrictions
                if ((t == this.t_float || t == this.t_double) && this.isIntNumber(right)) {
                    // Ints can be converted to floats
                    enode.type = t;
                } else if (this.isIntNumber(t) && (right == this.t_float || right == this.t_double)) {
                    // Floats can be converted to ints
                    enode.type = t;
                } else if (t == this.t_float && right == this.t_double) {
                    // Doubles can be converted to floats
                    enode.type = t;
                } else if (t == this.t_double && right == this.t_float) {
                    // Floats can be converted to doubles
                    enode.type = t;
                } else if (t == this.t_rune && this.isUInt32Number(right)) {
                    // Ints can be converted to floats
                    enode.type = t;
                } else if (this.isUInt32Number(t) && right == this.t_rune) {
                    // Floats can be converted to ints
                    enode.type = t;
                } else if (this.isInt32Number(t) && right instanceof UnsafePointerType) {
                    // Unsafe pointers can be converted to 32-bit integers
                    enode.type = t;
                } else if (t instanceof UnsafePointerType && (right instanceof UnsafePointerType || right instanceof PointerType || right == this.t_string || this.isInt32Number(right))) {
                    // Unsafe pointers to anything, safe pointers to anything, strings and 32-bit integers can be converted to any unsafe pointer
                    enode.type = t;
                } else if ((t == this.t_bool || this.isIntNumber(t)) && (right == this.t_bool || this.isIntNumber(right)) && t != right) {
                    // bool and all integers can be converted into each other
                    enode.type = t;
                } else if (t == this.t_string && right instanceof UnsafePointerType) {
                    // An unsafe pointer can be converted to a string by doing nothing. This is an unsafe cast.
                    enode.type = t;
                } else if (t == this.t_string && right instanceof SliceType && right.elementType == this.t_byte) {
                    // A slice of bytes can be converted to a string by copying it by copying it.
                    // Restrictions are irrelevant.
                    enode.type = t;
                } else if (t instanceof SliceType && t.elementType == this.t_byte && right == this.t_string) {
                    // A string can be casted into a sequence of bytes by copying it
                    enode.type = t;
                } else if (this.isComplexOrType(right)) {
                    let ok = false;
                    for(let ot of (right as OrType).types) {
                        if (this.checkIsAssignableType(t, ot, enode.loc, false)) {
                            enode.type = t;
                            ok = true;
                            break;
                        }
                    }
                    if (!ok) {
                        throw new TypeError("Conversion from " + right.toString() + " to " + t.toString() + " is not possible", enode.loc);
                    }
                } else if (this.checkIsAssignableType(t, right, enode.loc, false)) {
                    if (right != this.t_null) {
                        throw new TypeError("Conversion from " + right.toString() + " to " + t.toString() + " does not require a cast", enode.loc);
                    }
                    enode.type = t;
                } else {
                    throw new TypeError("Conversion from " + right.toString() + " to " + t.toString() + " is not possible", enode.loc);
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
                this.checkIsAssignableNode(v.type, v.node.rhs);
            }
        }
    }

    private defaultLiteralType(node: Node): Type {
        if (node.type instanceof ArrayLiteralType) {
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode);
            }
            if (node.parameters.length == 0) {
                throw new TypeError("Cannot infer type of []", node.loc);
            } else {
                let t = node.parameters[0].type;
                for(let i = 1; i < node.parameters.length; i++) {
                    if (!this.checkIsAssignableType(t, node.parameters[i].type, node.loc, false)) {
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
            if (doThrow) {
                if (count == 0) {
                    throw new TypeError("Literal of type " + node.type.toString() + " is not an opton of " + t.toString(), node.loc);                    
                }
                throw new TypeError("Ambiguous type inference", node.loc);
            }
            return false;
        }

        if (t instanceof RestrictedType) {
            return this.unifyLiterals(t.elementType, node, loc, doThrow);
        }  

        if (t instanceof InterfaceType && t.isEmptyInterface()) {
            node.type = this.defaultLiteralType(node);
            return true;
        }

        if (t instanceof InterfaceType && t.isBoxedType()) {
            return this.unifyLiterals(t.extendsInterfaces[0], node, loc, doThrow);
        }

        switch (node.op) {
            case "int":
                // TODO: Check range
                if (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64) {
                    node.type = t;
                    return true;
                }
                if (t instanceof UnsafePointerType) {
                    // TODO: Check range
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
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between floating point number and " + t.toString(), loc);                
            case "str":
                if (t == this.t_string) {
                    node.type = t;
                    return true;
                } else if (t instanceof StringLiteralType) {
                    if (t.name == node.value) {
                        node.type = t;
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
                if (t instanceof MapType && t.keyType == this.t_string) {
                    if (node.parameters) {
                        for(let pnode of node.parameters) {
                            this.checkIsAssignableNode(t.valueType, pnode.lhs);
                        }
                    }
                    node.type = t;
                    return true;
                } else if (t instanceof MapType && (!node.parameters || node.parameters.length == 0)) {
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

    public checkIsAssignableScope(toScope: Scope | null, fromScope: Scope | null, loc: Location, doThrow: boolean = true, isFunctionParameter: boolean = false): boolean {
        // A non-scoped value can always be assigned to a scoped one. If both are scoped, the assigned scope must be the same or a more restritced one.
        if (!!fromScope && (!toScope || (toScope != fromScope && !toScope.isChildScope(fromScope) && !isFunctionParameter))) {
            if (doThrow) {            
                throw new TypeError("Mismatch of variable scope", loc);
            }
            return false;
        }
        if (!!toScope && toScope.isPseudoScope && !!fromScope && fromScope.isPseudoScope) {
            if (doThrow) {            
                throw new TypeError("Mismatch of variable scope", loc);
            }
            return false;            
        }
        return true;
    }

    // Checks whether the type of 'from' can be assigned to the type 'to'.
    public checkIsAssignableNode(to: Type, from: Node, isFunctionParameter: boolean = false, doThrow: boolean = true): boolean {
        if (from.isUnifyableLiteral()) {
            return this.unifyLiterals(to, from, from.loc, doThrow);
        }
        return this.checkIsAssignableType(to, from.type, from.loc, doThrow, true, true, false, false, isFunctionParameter);
    }

    // Checks whether the type 'from' can be assigned to the type 'to'.
    public checkIsAssignableType(to: Type, from: Type, loc: Location, doThrow: boolean = true, unbox: boolean = true, isCopied: boolean = true, toIsConst: boolean = false, fromIsConst: boolean = false, isFunctionParameter: boolean = false): boolean {
        // Determine const, scope and unbox
        let toIsScoped: Scope | null = null;
        if (to instanceof RestrictedType) {
            toIsScoped = to.scope;
            toIsConst = toIsConst || to.isConst;
            to = RestrictedType.strip(to);
        }
        let fromIsScoped: Scope | null = null;
        if (from instanceof RestrictedType) {
            fromIsScoped = from.scope;
            fromIsConst = fromIsConst || from.isConst;
            from = RestrictedType.strip(from);
        }
        if (unbox && to instanceof InterfaceType && to.isBoxedType()) {
            to = this.unbox(to.extendsInterfaces[0], loc);
            if (to instanceof RestrictedType) {
                toIsScoped = to.scope || toIsScoped;
                toIsConst = toIsConst || to.isConst;
                to = RestrictedType.strip(to);
            }
        }
        if (unbox && from instanceof InterfaceType && from.isBoxedType()) {
            from = this.unbox(from.extendsInterfaces[0], loc);
            if (from instanceof RestrictedType) {
                fromIsScoped = from.scope || fromIsScoped;
                fromIsConst = fromIsConst || from.isConst;
                from = RestrictedType.strip(from);
            }
        }

        if (!toIsConst && !!fromIsConst && (!isCopied || !this.isPureValue(to))) {
            if (doThrow) {
                throw new TypeError("Mismatch of const restriction on variables", loc);
            }
            return false;
        }
        if (!isCopied) {
            if (!this.checkIsAssignableScope(toIsScoped, fromIsScoped, loc, false, isFunctionParameter)) {
                throw new TypeError("Mismatch in variable scope. Cannot assign " + from.toString() + " to " + to.toString(), loc);
            }
        }

        if (to == from && (this.isPrimitive(to) || to == this.t_string || to instanceof StructType || to instanceof StringLiteralType)) {
            return true;
        } else if (to instanceof TupleType && from instanceof TupleType && to.types.length == from.types.length) {
            let ok = true;
            for(let i = 0; i < to.types.length; i++) {
                if (!this.checkIsAssignableType(to.types[i], from.types[i], loc, false, false, isCopied, toIsConst, fromIsConst, isFunctionParameter)) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return true;
            }
        } else if (to instanceof OrType) {
            if (from instanceof OrType) {
                if (from.types.length <= to.types.length) {
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
            } else {
                for(let o of to.types) {
                    if (this.checkTypeEquality(o, from, loc, false)) {
                        return true;
                    }
                }
            }
        } else if (to instanceof PointerType) {
            if (from == this.t_null) {
                // null can be assigned to any pointer type
                return true;
            } else if (from instanceof PointerType || from instanceof UnsafePointerType) {
                // Pointers to derived types can be assigned to pointers of the super type
                let fromElement = from.elementType;
                if (this.isStruct(to.elementType) && this.isStruct(fromElement)) {
                    let toStruct = this.stripType(to.elementType) as StructType;
                    let fromStruct = this.stripType(from.elementType) as StructType;
                    if (toStruct != fromStruct) {
                        if (fromStruct.doesExtend(toStruct)) {
                            fromElement = this.rebox(fromElement, toStruct);
                        }
                    }
                }
                if (this.checkIsAssignableType(to.elementType, fromElement, loc, false, false, false, toIsConst, fromIsConst, isFunctionParameter)) {
                    return true;
                }
            }
        } else if (to instanceof GuardedPointerType && from instanceof GuardedPointerType) {
            if (from == this.t_null) {
                // null can be assigned to any pointer type
                return true;
            }
            if (this.checkIsAssignableType(to.elementType, from.elementType, loc, false, false, false, toIsConst, fromIsConst, isFunctionParameter)) {
                return true;
            }            
        } else if (to instanceof UnsafePointerType) {
            if (from == this.t_int || from == this.t_uint || from == this.t_null) {
                // 32-bit integers and null can be assigned to an usafe pointer type
                return true;
            } else if (from instanceof UnsafePointerType || from instanceof PointerType) {                
                if (to.elementType == this.t_void) {
                    // Safe and unsafe pointers to anything can be assigned to #void
                    return true;
                } else if (from.elementType == this.t_void) {
                    // #void can be assigned to any unsafe pointer
                    return true;
                } else {
                    // Pointers to derived types can be assigned to pointers of the super type
                    let fromElement = from.elementType;
                    if (this.isStruct(to.elementType) && this.isStruct(fromElement)) {
                        let toStruct = this.stripType(to.elementType) as StructType;
                        let fromStruct = this.stripType(from.elementType) as StructType;
                        if (toStruct != fromStruct) {
                            if (fromStruct.doesExtend(toStruct)) {
                                fromElement = this.rebox(fromElement, toStruct);
                            }
                        }
                    }
                    if (this.checkIsAssignableType(to.elementType, from.elementType, loc, false, false, false, toIsConst, fromIsConst, isFunctionParameter)) {
                        return true;
                    }
                }
            }
        } else if (to instanceof ArrayType && from instanceof ArrayType) {
            if (this.checkIsAssignableType(to.elementType, from.elementType, loc, false, false, isCopied, toIsConst, fromIsConst, isFunctionParameter)) {
                return true;
            }
        } else if (to instanceof SliceType && from instanceof SliceType) {
            if (!this.checkIsAssignableScope(to.arrayScope, from.arrayScope, loc, false, isFunctionParameter)) {
                throw new TypeError("Mismatch in variable scope. Cannot assign " + from.toString() + " to " + to.toString(), loc);
            }
            if (this.checkIsAssignableType(to.elementType, from.elementType, loc, false, false, false, toIsConst, fromIsConst, isFunctionParameter)) {
                return true;
            }            
        } else if (to instanceof MapType && from instanceof MapType) {
            if (this.checkIsAssignableType(to.keyType, from.keyType, loc, false, false, false, toIsConst, fromIsConst) &&
                this.checkIsAssignableType(to.valueType, from.valueType, loc, false, false, false, toIsConst, fromIsConst, isFunctionParameter)) {
                    return true;
            }
        } else if (to == this.t_string && from == this.t_string) {
            return true;
        } else if (to instanceof InterfaceType) {
            if (to.isEmptyInterface()) {
                return true;
            }
            if (to.isBoxedType()) {
                return this.checkIsAssignableType(to.extendsInterfaces[0], from, loc, doThrow, false, isCopied, toIsConst, fromIsConst, isFunctionParameter);
            }
            if (from instanceof InterfaceType) {
                this.checkIsAssignableScope(to.pointerScope, from.pointerScope, loc);
                if (!from.isBoxedType()) {
                    // Check two interfaces
                    let fromMethods = from.getAllMethods();
                    let toMethods = to.getAllMethods();
                    if (fromMethods.size >= toMethods.size) {
                        let ok = true;
                        for(let entry of toMethods.entries()) {
                            if (!fromMethods.has(entry[0]) || !this.checkTypeEquality(fromMethods.get(entry[0]), entry[1], loc, false)) {
                                ok = false;
                                if (doThrow) {
                                    throw new TypeError("Incompatible method signature for " + entry[0] + " in types " + from.toString() + " and " + to.toString(), loc);
                                }
                                break;
                            }
                        }
                        if (ok) {
                            return true;
                        }
                    }
                } 
            } else if (from == this.t_null) {
                return true;
            } else {
                if (from instanceof PointerType || from instanceof UnsafePointerType) {
                    this.checkIsAssignableScope(to.pointerScope, this.isScoped(from.elementType), loc);
                    let fromElement = this.stripType(from.elementType);
                    if (fromElement instanceof StructType) {
                        let toMethods = to.getAllMethods();
                        let fromMethods = fromElement.getAllMethodsAndFields();
                        let ok = true;
                        for(let entry of toMethods.entries()) {
                            if (fromMethods.has(entry[0])) {
                                let fieldOrMethod = fromMethods.get(entry[0]);
                                if (!(fieldOrMethod instanceof FunctionType) || !this.checkFunctionEquality(entry[1], fieldOrMethod, loc, true, false)) {
                                    ok = false;
                                    if (doThrow) {
                                        throw new TypeError("Incompatible method signature for " + entry[0] + " in types " + fromElement.toString() + " and " + to.toString(), loc);
                                    }
                                    break;
                                }
                            } else {
                                ok = false;
                                if (doThrow) {
                                    throw new TypeError("Type " + fromElement.toString() + " is missing method " + entry[0] + " as required by " + to.toString(), loc);
                                }
                                break;
                            }
                        }
                        if (ok) {
                            return true;
                        }
                    }                
                }
            }
        }
        if (!doThrow) {
            return false;
        }
        throw new TypeError("Type " + from.toString() + " cannot be assigned to type " + to.toString(), loc);        
    }

    public checkFunctionArguments(ft: FunctionType, parameters: Array<Node> | null, scope: Scope, loc: Location, doThrow: boolean = true): boolean {
        // Type check all parameters
        if (parameters) {
            if (ft.parameters.length != parameters.length) {
                if (ft.requiredParameterCount() > parameters.length || (parameters.length > ft.parameters.length && !ft.hasEllipsis())) {
                    if (doThrow) {
                        throw new TypeError("Supplied parameter count does not match function signature " + ft.toString(), loc);
                    }
                    return false;
                }
            }
            for(let i = 0; i < parameters.length; i++) {
                let pnode = parameters[i];
                if (pnode.op == "unary...") {
                    if (!ft.hasEllipsis()) {
                        if (doThrow) {
                            throw new TypeError("Ellipsis not allowed here. Function is not variadic", pnode.loc);
                        }
                        return false;
                    }
                    if (i != ft.parameters.length - 1 || i != parameters.length - 1) {
                        if (doThrow) {
                            throw new TypeError("Ellipsis must only appear with the last parameter", pnode.loc);
                        }
                        return false;
                    }
                    if (!this.checkIsAssignableNode(ft.lastParameter().type, pnode.rhs, true, doThrow)) {
                        return false;
                    }
                } else {
                    if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                        if (!this.checkIsAssignableNode((ft.lastParameter().type as SliceType).elementType, pnode, true, doThrow)) {
                            return false;
                        }
                    } else {
                        if (!this.checkIsAssignableNode(ft.parameters[i].type, pnode, true, doThrow)) {
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

    public checkIsEnumerable(node: Node): [Type, Type] {
        let t = this.stripType(node.type);
        if (t instanceof MapType) {
            return [t.keyType, t.valueType];
        } else if (t == this.t_string) {
            return [this.t_int, this.t_rune];
        } else if (t instanceof ArrayType) {
            return [this.t_int, t.elementType];
        } else if (t instanceof SliceType) {
            return [this.t_int, t.elementType];
        }
        throw new TypeError("The type " + t.toString() + " is not enumerable", node.loc);
    }

    public checkIsIndexable(node: Node, index: number, indexCanBeLength: boolean = false): Type {
        let t = this.stripType(node.type);
        if (t == this.t_string) {
            if (index < 0) {
                throw new TypeError("Index out of range", node.loc);
            }
            return this.t_byte;
        } else if (t instanceof ArrayType) {
            if (index < 0 || (!indexCanBeLength && index >= t.size) || (indexCanBeLength && index > t.size)) {
                throw new TypeError("Index out of range", node.loc);
            }
            return t.elementType;
        } else if (t instanceof SliceType) {
            if (index < 0) {
                throw new TypeError("Index out of range", node.loc);
            }
            return t.elementType;
        } else if (t instanceof TupleType) {
            if (index < 0 || index >= t.types.length) {
                throw new TypeError("The index " + index + " does not exist in the tuple " + t.name, node.loc);
            }
            return t.types[index];
        } else if (t instanceof UnsafePointerType || t instanceof PointerType) {
            return t.elementType;
        }
        throw new TypeError("The type " + t.toString() + " is not indexable", node.loc);
    }

    public checkIsAddressable(node: Node, scope: Scope, withAmpersand: boolean, doThrow: boolean = true): boolean {
        switch (node.op) {
            case "id":
                let element = scope.resolveElement(node.value);
                if (element instanceof Variable) {
                    return true;
                } else if (element instanceof FunctionParameter) {
                    return true;
                }
                break;
            case ".":
            {
                let t = RestrictedType.strip(node.lhs.type);                
                if (t instanceof PointerType || t instanceof UnsafePointerType || t instanceof GuardedPointerType) {
                    return true;
                }
                return this.checkIsAddressable(node.lhs, scope, false, doThrow);
            }
            case "[":
                let t = RestrictedType.strip(node.lhs.type);                
                if (t instanceof SliceType || t instanceof GuardedPointerType || t instanceof UnsafePointerType) {
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
        let t = this.stripType(node.type);
        if (t instanceof PointerType || t instanceof UnsafePointerType) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a pointer, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsString(node: Node, doThrow: boolean = true): boolean {
        let t = this.stripType(node.type);
        if (t == this.t_string) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a string, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsSignedNumber(node: Node, doThrow: boolean = true): boolean {
        let t = this.stripType(node.type);
        if (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected a signed numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsUnsignedNumber(node: Node, doThrow: boolean = true): boolean {
        let t = this.stripType(node.type);
        if (t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an unsigned numeric type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }

    public checkIsBool(node: Node, doThrow: boolean = true): boolean {
        let t = this.stripType(node.type);
        if (t == this.t_bool) {
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

    // TODO: Rename to checkIsAddrInt
    public checkIsInt32Number(node: Node, doThrow: boolean = true): boolean {
        let t = this.stripType(node.type);
        if (t == this.t_int32 || t == this.t_uint32) {
            return true;
        }
        if (doThrow) {
            throw new TypeError("Expected an 32-bit integer type, but got " + node.type.toString(), node.loc);
        }
        return false;
    }
    
    public checkIsIntNumberOrUnsafePointer(node: Node, doThrow: boolean = true): boolean {
        let t = this.stripType(node.type);
        if (t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64) {
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
        if (this.isInterface(node.type)) {
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
                    if (allowMoreRestrictions && ((a.objectTypeIsScoped && !b.objectTypeIsScoped)) || (a.objectTypeIsConst && !b.objectTypeIsConst)) {
                        ok = false;
                    } else if (!allowMoreRestrictions && ((a.objectTypeIsScoped != b.objectTypeIsScoped) || a.objectTypeIsConst != b.objectTypeIsConst)) {
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
            if (a.isConst == b.isConst && !!a.scope == !!b.scope) {
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
            if (!!a.arrayScope == !!b.arrayScope && this.checkTypeEquality(a.elementType, b.elementType, loc, false)) {
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
        } else if (a instanceof GenericStructType && b instanceof GenericStructType) {
            if (a.base == b.base) {
                let ok = true;
                for(let i = 0; ok && i < a.genericParameterTypes.length; i++) {
                    ok = ok && this.checkTypeEquality(a.genericParameterTypes[i], b.genericParameterTypes[i], loc, false);
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
        } else if (a instanceof InterfaceType && b instanceof InterfaceType && a.isBoxedType() && b.isBoxedType()) {
            if (a.extendsInterfaces.length == b.extendsInterfaces.length && a.extendsInterfaces.length == 1) {
                return this.checkTypeEquality(a.extendsInterfaces[0], b.extendsInterfaces[0], loc, false);
            }
        } else if (a instanceof InterfaceType && b instanceof InterfaceType && !a.isBoxedType() && !b.isBoxedType()) {
            if (!!a.pointerScope == !!b.pointerScope) {
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
            if (!(node.lhs.type instanceof RestrictedType) || !node.lhs.type.isConst) {
                let t = RestrictedType.strip(node.lhs.type);
                if (t instanceof PointerType || t instanceof UnsafePointerType || t instanceof GuardedPointerType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        } else if (node.op == "[" && node.lhs.type != this.t_string) {
            if (!(node.lhs.type instanceof RestrictedType) || !node.lhs.type.isConst) {
                let t = RestrictedType.strip(node.lhs.type);
                if (t instanceof UnsafePointerType || t instanceof GuardedPointerType || t instanceof SliceType) {
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
            if (!(node.lhs.type instanceof RestrictedType) || !node.lhs.type.isConst) {
                let t = RestrictedType.strip(node.lhs.type);
                if (t instanceof PointerType || t instanceof UnsafePointerType || t instanceof GuardedPointerType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        } else if (node.op == "[" && node.lhs.type != this.t_string) {
            if (!(node.lhs.type instanceof RestrictedType) || !node.lhs.type.isConst) {
                let t = RestrictedType.strip(node.lhs.type);
                if (t instanceof UnsafePointerType || t instanceof GuardedPointerType || t instanceof SliceType) {
                    return true;
                }
                if (!this.checkIsIntermediate(node.lhs)) {
                    return true;
                }
            }
        }
        throw new TypeError("The expression is not assignable", node.loc);
    }

    // Removes const, scope and unboxes
    public stripType(t: Type): Type {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        if (t instanceof InterfaceType && t.isBoxedType()) {
            t = t.extendsInterfaces[0];
            if (t instanceof RestrictedType) {
                t = t.elementType;
            }
        }
        return t;
    }
    
    public isString(t: Type): boolean {
        t = this.stripType(t);
        return t == this.t_string;
    }

    public isOrType(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType instanceof OrType;
        }
        return t instanceof OrType;
    }

    public isComplexOrType(t: Type): boolean {
        t = this.stripType(t);
        if (!(t instanceof OrType)) {
            return false;
        }
        return !t.stringsOnly();
    }

    public isStringOrType(t: Type): boolean {
        t = this.stripType(t);
        if (!(t instanceof OrType)) {
            return false;
        }
        return t.stringsOnly();
    }

    public isInterface(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType instanceof InterfaceType;
        }
        return t instanceof InterfaceType;
    }

    public isSlice(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof SliceType;
    }

    public isArray(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof ArrayType;
    }

    public isGuardedPointer(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof GuardedPointerType;
    }

    public isUnsafePointer(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof UnsafePointerType;
    }

    public isNumber(t: Type): boolean {
        t = this.stripType(t);
        return (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64);
    }

    public isStruct(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof StructType;
    }

    public isTuple(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof TupleType;
    }

    public isMutableValue(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof StructType || t instanceof TupleType || t instanceof ArrayType;
    }

    public isConst(t: Type): boolean {
        if (t instanceof RestrictedType) {
            if (t.isConst) {
                return true;
            }
            t = t.elementType;
        }
        if (t instanceof InterfaceType && t.isBoxedType()) {
            t = t.extendsInterfaces[0];
            if (t instanceof RestrictedType) {
                if (t.isConst) {
                    return true;
                }
            }    
        }
        return false;
    }
    
    public isScoped(t: Type): Scope | null {
        if (t instanceof RestrictedType) {
            if (t.scope) {
                return t.scope;
            }
            t = t.elementType;
        }
        if (t instanceof InterfaceType && t.isBoxedType()) {
            t = t.extendsInterfaces[0];
            if (t instanceof RestrictedType && t.scope) {
                return t.scope;
            }
        }
        return null;
    }

    public isIntNumber(type: Type): boolean {
        type = this.stripType(type);
        if (type == this.t_int8 || type == this.t_int16 || type == this.t_int32 || type == this.t_int64 || type == this.t_uint8 || type == this.t_uint16 || type == this.t_uint32 || type == this.t_uint64) {
            return true;
        }
        return false;
    }

    public isInt32Number(t: Type): boolean {
        t = this.stripType(t);
        return t == this.t_int32 || t == this.t_uint32;
    }

    public isUInt32Number(t: Type): boolean {
        t = this.stripType(t);
        return t == this.t_uint32;
    }

    public isPrimitive(t: Type): boolean {
        t = this.stripType(t);
        return (t == this.t_rune || t == this.t_bool || t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64 || t == this.t_null || t == this.t_void);
    }
    
    public isPointer(t: Type): boolean {
        t = this.stripType(t);
        if (t instanceof PointerType || t instanceof UnsafePointerType || t instanceof GuardedPointerType || t instanceof MapType || t instanceof SliceType || t == this.t_string) {
            return true;
        }    
        return t instanceof InterfaceType && t.isPointerType();
    }
    
    public isReferencePointer(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof PointerType && t.elementType instanceof RestrictedType && t.elementType.scope != null;
    }
    
    public isSafePointer(t: Type): boolean {
        t = this.stripType(t);
        return (t instanceof PointerType);
    }
    
    public isPureValue(t: Type): boolean {
        t = this.stripType(t);
        if (t == this.t_rune || t == this.t_string || t == this.t_bool || t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64 || t == this.t_null || t == this.t_void) {
            return true;
        }
        if (t instanceof TupleType) {
            for(let p of t.types) {
                if (!this.isPureValue(p)) {
                    return false;
                }
            }
            return true;
        } else if (t instanceof ArrayType) {
            return this.isPureValue(t.elementType);
        } else if (t instanceof StructType) {
            for(let f of t.fields) {
                if (!this.isPureValue(f.type)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    public makeScoped(t: Type, scope: Scope, loc: Location): RestrictedType {
        if (t instanceof RestrictedType) {
            if (t.scope) {
                throw "Implementation error";
            }
            return new RestrictedType(t.elementType, {isConst: t.isConst, scope: scope});
        }
        return new RestrictedType(t, {isConst: false, scope: scope});
    }

    public makeConst(t: Type, loc: Location): Type {
        if (t instanceof RestrictedType) {
            if (t.isConst) {
                return t;
            }
            if (this.isPrimitive(t.elementType) || t.elementType == this.t_string) {
                return t;
            }
            return new RestrictedType(t.elementType, {isConst: true, scope: t.scope});
        }
        if (this.isPrimitive(t) || t == this.t_string) {
            return t;
        }
        return new RestrictedType(t, {isConst: true, scope: null});
    }
    
    public makeInterfaceReference(t: InterfaceType, scope: Scope, loc: Location): Type {
        let iface = new InterfaceType();
        iface.extendsInterfaces = t.extendsInterfaces;
        iface.loc = t.loc;
        iface.methods = t.methods;
        iface.name = t.name;
        iface.pointerScope = scope;
        return iface; 
    }

    public makeSliceReference(t: SliceType, scope: Scope, loc: Location): Type {
        let s = new SliceType(t.elementType);
        s.arrayScope = scope;
        return s;
    }

    public makePointerReference(t: Type, scope: Scope, loc: Location): Type {
        if (t instanceof RestrictedType) {
            if (t.scope) {
                return new PointerType(t);
            }
            return new PointerType(new RestrictedType(t.elementType, {isConst: t.isConst, scope: scope}));
        }
        return new PointerType(new RestrictedType(t, {isConst: false, scope: scope}));
    }

    public makePointer(t: Type, loc: Location): PointerType {
        return new PointerType(t);
    }

    public makeUnsafePointer(t: Type, loc: Location): Type {
        if (t instanceof RestrictedType) {
            if (t.scope) {
                throw "Implementation error"
            }
            return new RestrictedType(new UnsafePointerType(t.elementType), t);
        }
        return new UnsafePointerType(t);
    }

    public makeSlice(t: Type, loc: Location): SliceType {
        if (t instanceof RestrictedType && t.scope) {
            throw new TypeError("A slice of reference types is not allowed", loc);
        }
        return new SliceType(t);
    }
    
    public makeArray(t: Type, len: number, loc: Location): ArrayType {
        if (t instanceof RestrictedType && t.scope) {
            throw new TypeError("An array of reference types is not allowed", loc);
        }
        return new ArrayType(t, len);
    }
    
    public makeMap(key: Type, value: Type, loc: Location): Type {
        if (key instanceof RestrictedType && key.scope) {
            throw "Implementation error"
        }
        if (value instanceof RestrictedType && value.scope) {
            throw "Implementation error"
        }
        if (key != this.t_string && !this.isPrimitive(key) && !(key instanceof PointerType) && !(key instanceof GuardedPointerType) && !(key instanceof UnsafePointerType)) {
            throw new TypeError("The type " + key.toString() + " is not allowed as a map key", loc);
        }
        return new MapType(key, value);
    }
    
    public makeBox(t: Type, loc: Location, iface?: InterfaceType): Type {
        if (t instanceof RestrictedType && t.scope) {
            throw new TypeError("A reference type must not be boxed", loc);
        }
        if (!iface) {
            iface = new InterfaceType();
        }
        iface.loc = t.loc;
        if (t instanceof RestrictedType && t.isConst) {
            iface.extendsInterfaces.push(t.elementType);
            return new RestrictedType(iface, t);
        }
        iface.extendsInterfaces.push(t);  
        this.ifaces.push(iface);        
        return iface;
    }
    
    public unbox(t: Type, loc: Location): Type {
        if (t instanceof RestrictedType) {
            if (t.elementType instanceof InterfaceType && t.elementType.isBoxedType()) {
                let result = t.elementType.extendsInterfaces[0];
                if (t.isConst) {
                    result = this.makeConst(result, loc);
                }
                if (!!t.scope && (this.isPrimitive(result) || this.isPointer(result))) {
                    result = this.makeScoped(result, t.scope, loc);
                }
                return result;
            }
        }
        if (t instanceof InterfaceType && t.isBoxedType()) {
            return t.extendsInterfaces[0];
        }
        return t;
    }

    public rebox(oldT: Type, newT: Type): Type {
        let result = newT;
        if (oldT instanceof RestrictedType) {
            if (oldT.elementType instanceof InterfaceType && oldT.elementType.isBoxedType()) {
                let i = new InterfaceType();
                i.extendsInterfaces.push(result);
                result = i;
            }
            result = new RestrictedType(result, oldT);
        } else if (oldT instanceof InterfaceType && oldT.isBoxedType()) {
            let i = new InterfaceType();
            i.extendsInterfaces.push(result);
            result = i;
        }
        return result;
    }

    public pointerElementType(t: Type): Type {
        t = RestrictedType.strip(t);
        if (t instanceof PointerType || t instanceof GuardedPointerType || t instanceof UnsafePointerType) {
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

    private translateType(t: Type, tr: Map<Type, Type>, newT?: Type): Type {
        // Stop at named types
        if (t.name && !newT && !(t instanceof GenericStructType)) {
            return t;
        }
        let translated = tr.get(t);
        if (translated) {
            return translated;
        }
        if (t instanceof InterfaceType) {
            throw "TODO";
        } else if (t instanceof StructType) {
//            console.log("Translating", t.name, t.toString());
            let modified = false;
            let newStruct: StructType;
            if (newT) {
                newStruct = newT as StructType;
                modified = true;
            } else {
                if (t instanceof GenericStructType) {
                    let types: Array<Type> = [];
                    for(let p of t.genericParameterTypes) {
                        types.push(this.translateType(p, tr));
                    }
                    return this.instantiateGenericStructType(t, types, t.loc);
                }  else {
                    newStruct = new StructType();
                }
            }
            newStruct.loc = t.loc;
            newStruct.name = t.name;
            for(let f of t.fields) {
                let newField = new StructField();
                newField.name = f.name;
                newField.type = this.translateType(f.type, tr);
  //              console.log("FIELD", newField.name, newField.type);
//                console.log(".... from", f.type);
                modified = modified || (newField.type != f.type);
                newStruct.fields.push(newField);
            }
            if (t.extends) {
                newStruct.extends = this.translateType(t.extends, tr) as StructType;
                modified = modified || (newStruct.extends != t.extends);
            }
            for(let impl of t.implements) {
                let newImpl = this.translateType(impl, tr);
                modified = modified || newImpl != impl;
                newStruct.implements.push(newImpl as InterfaceType);
            }
            tr.set(t, newStruct);
            for(let m of t.methods.entries()) {
                let newMethod = this.translateType(m[1], tr) as FunctionType;
                newStruct.methods.set(m[0], newMethod);
                modified = modified || (newMethod != m[1]);
            }
//            console.log(".........<")
            if (modified) {
                return newStruct;
            }
            return t;
        } else if (t instanceof PointerType) {
            let e = this.translateType(t.elementType, tr);
            if (e == t.elementType) {
                return t;
            }
            return new PointerType(e);
        } else if (t instanceof UnsafePointerType) {
            let e = this.translateType(t.elementType, tr);
            if (e == t.elementType) {
                return t;
            }
            return new UnsafePointerType(e);
        } else if (t instanceof GuardedPointerType) {
            let e = this.translateType(t.elementType, tr);
            if (e == t.elementType) {
                return t;
            }
            return new GuardedPointerType(e);
        } else if (t instanceof RestrictedType) {
            let e = this.translateType(t.elementType, tr);
            if (e == t.elementType) {
                return t;
            }
            return new RestrictedType(e, t);
        } else if (t instanceof OrType) {
            throw "TODO";            
        } else if (t instanceof SliceType) {
            throw "TODO";            
        } else if (t instanceof ArrayType) {
            throw "TODO";            
        } else if (t instanceof MapType) {
            throw "TODO";            
        } else if (t instanceof TupleType) {
            throw "TODO";            
        } else if (t instanceof FunctionType) {
            let modified = false;
            let newF = new FunctionType();
            newF.loc = t.loc;
            for(let p of t.parameters) {
                let newP = new FunctionParameter();
                newP.ellipsis = p.ellipsis;
                newP.isConst = p.isConst;
                newP.loc = p.loc;
                newP.name = p.name;
                newP.type = this.translateType(p.type, tr);
                modified = modified || (newP.type != p.type);
                newF.parameters.push(newP);
            }
            newF.callingConvention = t.callingConvention;
            newF.name = t.name;
            newF.objectTypeIsConst = t.objectTypeIsConst;
            newF.objectTypeIsScoped = t.objectTypeIsScoped;
            newF.systemCallType = t.systemCallType;
            newF.returnType = this.translateType(t.returnType, tr);
            modified = modified || (newF.returnType != t.returnType);
            newF.objectType = this.translateType(t.objectType, tr);
            if (modified) {
                return newF;
            }
            return t;
        }
        throw "Implementation error";
    }

    private getBuiltinFunction(t: Type, name: string, loc: Location): FunctionType | null {
        let type = this.stripType(t);
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
                // TODO: Restriction can be lifted
                if (this.isConst(t)) {
                    throw new TypeError("append is not allowed on const slices", loc);
                }
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
            } else if (name == "clone") {
                let ft = new FunctionType()
                ft.name = "clone";
                ft.callingConvention = "system";
                ft.objectType = type;
                ft.returnType = new SliceType(type.elementType);
                if (this.isConst(t) && !this.isPureValue(type.elementType)) {
                    ft.returnType = this.makeConst(ft.returnType, loc);
                }
                return ft;                
            }
        } else if (type instanceof ArrayType) {
            if (name == "len") {
                return this.builtin_len;
            }
        } else if (type instanceof MapType) {
            if (name == "remove") {
                let ft = new FunctionType()
                ft.name = "remove";
                ft.callingConvention = "system";
                ft.objectType = type;
                let p = new FunctionParameter();
                p.name = "key";
                p.type = type.keyType;
                ft.parameters.push(p);
                ft.returnType = this.t_bool;
                return ft;                                
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
    public t_rune: Type;
    public t_any: Type;
    public t_void: Type;
    public t_error: InterfaceType;

    public builtin_len: FunctionType;
    public builtin_cap: FunctionType;

    // List of all interfaces. These are checked for possible errors after they have been defined.
    public ifaces: Array<InterfaceType> = [];
    public structs: Array<StructType> = [];
    public genericStructs: Map<GenericStructType, Array<GenericStructType>> = new Map<GenericStructType, Array<GenericStructType>>();

//    private callGraph: Map<Function, Array<FunctionType>> = new Map<Function, Array<FunctionType>>();
    private stringLiteralTypes: Map<string, StringLiteralType> = new Map<string, StringLiteralType>();
}

export class TypeError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}