import { Node, Location } from "./ast"
import { Package, SystemCalls } from "./pkg";
import { TypeChecker, Group, GroupKind, Scope, FunctionParameter, TemplateFunction, Restrictions, TypeError } from "./typecheck"

/**
 * Type is the base class for all types.
 */
export abstract class Type {
    public name: string;
    public loc: Location;
    public groupName: string;

    public toString(): string {
        return this.name
    }

    public get isImported(): boolean {
        return this.importFromModule !== undefined;
    }

    public abstract toTypeCodeString(): string;

    public importFromModule: string;
}

/**
 * BasicType represents all built-in types.
 */
export class BasicType extends Type {
    constructor(name: "void" | "bool" | "float" | "double" | "null" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "rune" | "any" | "string" | "int" | "uint" | "byte" | "char") {
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

    public hasBaseType(b: InterfaceType): boolean {
        for(let i of this.extendsInterfaces) {
            if (i == b) {
                return true;
            }
            if (i.hasBaseType(b)) {
                return true;
            }
        }
        return false;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
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

    public methodIndex(name: string): number {
        this.sortMethodNames();
        let index = this.sortedMethodNames.indexOf(name);
        if (index == -1) {
            throw "Implementation error " + name;
        }
        return index;
    }

    public sortMethodNames(): Array<string> {
        if (this.sortedMethodNames.length != 0) {
            return this.sortedMethodNames;
        }
        for(let i = 0; i < this.extendsInterfaces.length; i++) {
            let iface = this.extendsInterfaces[i];
            if (iface instanceof InterfaceType) {
                iface.sortMethodNames();
            }
            this.sortedMethodNames = this.sortedMethodNames.concat(iface.sortedMethodNames);
        }

        if (this.sortedMethodNames.length == 0) {
            this.sortedMethodNames.push("__dtr__");
        }
        let names: Array<string> = [];
        for(let name of this.methods.keys()) {
            names.push(name);
        }
        names.sort();
        this.sortedMethodNames = this.sortedMethodNames.concat(names);
        return this.sortedMethodNames;
    }

    // Package the type has been defined in.
    // For global types sich as "int" the package is undefined.
    public pkg?: Package;
    public extendsInterfaces: Array<InterfaceType> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();
    private sortedMethodNames: Array<string> = [];

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
        str += this.fields.map(function (f: StructField): string { return f.toTypeCodeString(); }).join(",");
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

    // Package the type has been defined in.
    public pkg: Package;
    public extends: StructType;
    public implements: Array<InterfaceType> = [];
    // Fields of the struct, ordered by their appearance in the code
    public fields: Array<StructField> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();
    /**
     * An opaque struct cannot be instantiated, because the compiler does not know the size and layout of the struct.
     * Opaque structs can therefore only be handled via pointers.
     */
    public opaque: boolean;
    /**
     * A native struct is for example provided by a C-library.
     * In this case, the compiler will use the native struct definition (as defined by some C-include) instead of generating
     * a defintion for the struct.
     */
    public native: boolean;

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

    public toTypeCodeString(): string {
        if (!this.name) {
            return this.type.toTypeCodeString();
        }
        return this.name;
    }

    public name: string;
    public type: Type;
}

// CallingConvention is part of a FunctionType.
// It defines how the function is to be called.
export type CallingConvention = "fyr" | "fyrCoroutine" | "system" | "native";

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
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toTypeCodeString() + "." + this.name;
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
            name += p.type.toTypeCodeString();
        }
        name += ") => " + this.returnType.toTypeCodeString();
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

    public isAsync(): boolean {
        return this.callingConvention == "fyrCoroutine";
    }

    public createGroups(): Map<string, Group> {
        let defaultGroup = new Group(GroupKind.Bound);
        let groups = new Map<string, Group>();
        let groupNames = new Map<string, Group>();
        for (let p of this.parameters) {
            if (p.type.groupName) {
                if (TypeChecker.isUnique(p.type)) {
                    throw new TypeError("Unique pointers must not be marked with a group name", p.loc);
                }
                let g = groupNames.get(p.type.groupName);
                if (!g) {
                    g = new Group(GroupKind.Bound);
                    groupNames.set(p.type.groupName, g);
                }
                groups.set(p.name, g);
            } else {
                if (TypeChecker.isUnique(p.type)) {
                    groups.set(p.name, new Group(GroupKind.Free));
                } else {
                    groups.set(p.name, defaultGroup);
                }
            }
        }

        if (this.returnType) {
            if (this.returnType instanceof TupleType) {
                for(let i = 0; i <this.returnType.types.length; i++) {
                    let t = this.returnType.types[i];
                    if (t.groupName) {
                        if (TypeChecker.isUnique(t)) {
                            throw new TypeError("Unique pointers must not be marked with a group name", t.loc);
                        }    
                        let g = groupNames.get(t.groupName);
                        if (!g) {
                            g = new Group(GroupKind.Bound);
                            groupNames.set(t.groupName, g);
                        }
                        groups.set("return " + i.toString(), g);
                    } else {
                        if (TypeChecker.isUnique(t)) {
                            groups.set("return " + i.toString(), new Group(GroupKind.Free));
                        } else {
                            groups.set("return " + i.toString(), defaultGroup);
                        }
                    }                                            
                }
            } else {
                if (this.returnType.groupName) {
                    if (TypeChecker.isUnique(this.returnType)) {
                        throw new TypeError("Unique pointers must not be marked with a group name", this.returnType.loc);
                    }    
                    let g = groupNames.get(this.returnType.groupName);
                    if (!g) {
                        g = new Group(GroupKind.Bound);
                        groupNames.set(this.returnType.groupName, g);
                    }
                    groups.set("return", g);
                } else {
                    if (TypeChecker.isUnique(this.returnType)) {
                        groups.set("return", new Group(GroupKind.Free));
                    } else {
                        groups.set("return", defaultGroup);
                    }
                }                    
            }
        }

        if (this.objectType) {
            groups.set("this", defaultGroup);
        }
        
        return groups;
    }

    public returnType: Type;
    public parameters: Array<FunctionParameter>;
    public callingConvention: CallingConvention = "fyr";
    public objectType: Type;
    // Only used when the callingConvention is "system"
    public systemCallType: SystemCalls;
// Enable this line to measure coroutines
//    public callingConvention: CallingConvention = "fyrCoroutine";
}


// TODO: Rename generic
export class GenericParameter extends Type {
    public toTypeCodeString(): string {
        throw "Implementation error";
    }
}

/**
 * TemplateType can either be a template function or a template struct.
 * Template types have template parameters which are type-wildcards with optional constraints.
 * The template type can be instantiated to become a TemplateFunctionType or a TemplateStructType
 * by binding concrete types to these type-wildcards.
 */
export class TemplateType extends Type {
    constructor() {
        super();
        this.templateParameterTypes = [];
        this.templateParameterNames = [];
    }

    public toTypeCodeString(): string {
        throw "Implementation error: Typecode of template type is not allowed";
    }

    public toString(): string {
        let g = "<";
        let lst = [];
        for(let i = 0; i < this.templateParameterNames.length; i++) {
            let s = this.templateParameterNames[i];            
            if (this.templateParameterTypes[i]) {
                s += " is " + this.templateParameterTypes[i].toString();
            }
            lst.push(s);
        }
        g += lst.join(",");
        g += ">";
        if (this.name) {
            return this.name + g;
        }
        return "template" + g;
    }

    // Optional ASTs of template parameters constraints, e.g. in "func<A is int|float, B>()",
    // these are constraints are "int|float" and "null".
    public templateParameterTypes: Array<Node | null>;
    // Names of the template parameters, e.g. in "func<A,B>(a A, b B)" these are [A.B]
    public templateParameterNames: Array<string>;
    // The AST of the template
    public node: Node;
    public parentScope: Scope;
    public registerScope: Scope;
    public methods: Array<TemplateFunction> = [];
    public pkg: Package;
}

/**
 * TemplateFunctionType is the instance of a TemplateType.
 */
export class TemplateFunctionType extends FunctionType {
    constructor() {
        super();
        this.templateParameterTypes = [];
    }

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name;
            }
            return this.name;
        }
        let name = "<";
        for(let i = 0; i < this.templateParameterTypes.length; i++) {
            if (i != 0) {
                name += ",";
            }
            name += this.templateParameterTypes[i];
            if (this.templateParameterTypes[i]) {
                name += " is " + this.templateParameterTypes[i].toString();
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

    public templateParameterTypes: Array<Type>;
    public base: TemplateType;
}

/**
 * TemplateStructType is the instance of a TemplateType.
 */
export class TemplateStructType extends StructType {
    constructor() {
        super();
        this.templateParameterTypes = [];
    }

    public toString(): string {
        let g = "<";
        let lst = [];
        for(let s of this.templateParameterTypes) {
            lst.push(s.toString());
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

    public templateParameterTypes: Array<Type>;
    public base: TemplateType;
}

/**
 * TemplateInterfaceType is the instance of a TemplateType.
 */
export class TemplateInterfaceType extends InterfaceType {
    constructor() {
        super();
        this.templateParameterTypes = [];
    }

    public toString(): string {
        let g = "<";
        let lst = [];
        for(let s of this.templateParameterTypes) {
            lst.push(s.toString());
        }
        g += lst.join(",");
        g += ">";
        if (this.name) {
            return this.name + g;
        }
        let str = "interface" + g + "{";
        let m: Array<string> = [];
        for(let mt of this.methods.values()) {
            m.push(mt.toString());
        }
        str += m.join(";");
        str += "}";
        return str;
    }

    public templateParameterTypes: Array<Type>;
    public base: TemplateType;
}

export class PointerType extends Type {
    constructor(elementType: Type, mode: PointerMode) {
        super();
        this.elementType = elementType;
        this.mode = mode;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let op;
        if (RestrictedType.strip(this.elementType) instanceof MapType) {
            if (this.mode == "local_reference") {
                op = "&";
            } else if (this.mode == "reference") {
                op = "~";
            } else if (this.mode == "unique") {
                op = "^";
            } else if (this.mode == "strong") {
                op = "";
            } else {
                throw "Implementation error";
            }
        } else {
            if (this.mode == "local_reference") {
                op = "&";
            } else if (this.mode == "reference") {
                op = "~";
            } else if (this.mode == "unique") {
                op = "^";
            } else if (this.mode == "strong") {
                op = "*";
            } else {
                throw "Implementation error";
            }
        }
        if (this.elementType instanceof RestrictedType) {
            return this.elementType.toString(true) + op + this.elementType.elementType.toString();
        }
        return op + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name;
        }
        let op;
        if (RestrictedType.strip(this.elementType) instanceof MapType) {
            if (this.mode == "local_reference") {
                op = "&";
            } else if (this.mode == "reference") {
                op = "~";
            } else if (this.mode == "unique") {
                op = "^";
            } else if (this.mode == "strong") {
                op = "";
            } else {
                throw "Implementation error";
            }
        } else {
            if (this.mode == "local_reference") {
                op = "&";
            } else if (this.mode == "reference") {
                op = "~";
            } else if (this.mode == "unique") {
                op = "^";
            } else if (this.mode == "strong") {
                op = "*";
            } else {
                throw "Implementation error";
            }
        }
        return op + this.elementType.toTypeCodeString();
    }

    public elementType: Type;
    /**
     * Determines whether the pointer is an owning pointer, a reference, or a unique pointer.
     */
    public mode: PointerMode;
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
        return "#" + this.elementType.toTypeCodeString();
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
        return "map[" + this.keyType.toString() + "]" + this.valueType.toString();
    }

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name;
        }
        return "map[" + this.keyType.toTypeCodeString() + "]" + this.valueType.toTypeCodeString();
    }

    public keyType: Type;
    public valueType: Type;
}


// Implements restrictions
export class RestrictedType extends Type {
    constructor(elementType: Type, r: Restrictions | null = null) {
        super();
        this.elementType = elementType;
        if (r) {
            this.isConst = r.isConst;
        } else {
            this.isConst = false;
        }
    }

    public static strip(t: Type): Type {
        if (t instanceof RestrictedType) {
            return t.elementType;
        }
        return t;
    }

    public toString(omitElement?: boolean): string {
        if (this.name) {
            return this.name;
        }
        if (this.elementType.name == "string") {
            return "string";
        }
        let str = "";
        if (this.isConst && this.elementType.name != "string") {
            str += "const ";
        }
        if (omitElement) {
            return str;
        }
        return str + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        let str = "";
        if (this.isConst) {
            str += "const ";
        }
        return str + this.elementType.toString();
    }
    
    public elementType: Type;
    public isConst?: boolean;
}

export type PointerMode = "unique" | "strong" | "reference" | "local_reference";

export class ArrayType extends Type {
    constructor(elementType: Type, size: number) {
        super();
        this.elementType = elementType;
        this.size = size;
    }

    public getElementType(): Type {
        return this.elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        if (this.size === null) {
            return "[...]" + this.elementType.toString();    
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        if (this.size === null) {
            return "[...]" + this.elementType.toString();
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString();
    }

    public elementType: Type;
    public size: number;
}

export class SliceType extends Type {
    constructor(arrayType: ArrayType | RestrictedType, mode: PointerMode) {
        super();
        this.arrayType = arrayType;
        this.mode = mode;
    }
    
    public array(): ArrayType {
        if (this.arrayType instanceof ArrayType) {
            return this.arrayType;
        }
        return this.arrayType.elementType as ArrayType;
    }

    public getElementType(): Type {
        if (this.arrayType instanceof ArrayType) {
            return this.arrayType.elementType;
        }
        return (this.arrayType.elementType as ArrayType).elementType;    
    }
    
    public toString(): string {
        if (this.name) {
            return this.name;
        }
        let mode = "";
        if (this.mode == "local_reference") {
            mode = "&";
        } else if (this.mode == "reference") {
            mode = "~";
        } else if (this.mode == "unique") {
            mode = "^";
        }
        return mode + "[]" + this.array().elementType.toString();
    }

    public toTypeCodeString(): string {
        return this.mode.toString() + "[]" + this.array().elementType.toString();
    }
    
    public mode: PointerMode;
    // If the size of the underlying array is -1, then its size is dynamic
    public arrayType: ArrayType | RestrictedType;
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
    constructor(types?: Array<Type>) {
        super();
        if (types) {
            this.types = types;
        } else {
            this.types = [];
        }
    }

    public types: Array<Type>;

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

    public isPureValue(): boolean {
        for(let t of this.types) {
            if (TypeChecker.isPureValue(t)) {
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
    constructor(name: string, pkg: Package, loc: Location) {
        super();
        this.name = name;
        this.loc = loc;
        this.pkg = pkg;
    }

    public toString(): string {
        return "package " + this.name;
    }

    public toTypeCodeString(): string {
        throw "Implementation error";
    }

    public pkg: Package;
}
