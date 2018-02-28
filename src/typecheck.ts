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
    // Variable is the named return variable of a function, e.g. "count" or "error" in "func foo() (count int, err error) { }"
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
        this.box = new Box();
    }

    public get isImported(): boolean {
        return this.importFromModule !== undefined;
    }

    public name: string;
    public type: FunctionType;
    public namedReturnTypes: boolean;
    // The scope containing FunctionParameters and local Variables of the function.
    public scope: Scope;
    public box: Box;
    public node: Node;
    public loc: Location;
    public importFromModule: string;
    public isExported: boolean;
}

// FunctionParameter is the parameter of a function inside a function's body.
export class FunctionParameter implements ScopeElement {
    public name: string;
    public ellipsis: boolean;
    public type: Type;
    public loc: Location;
}

/**
 * TemplateFunctions are registered in a scope.
 * They represent a TemplateType which yields a TemplateFunctionType when instantiated.
 * Unlike normal Function objects, TemplateFunctions are not fully parsed and type checked.
 * This happens only upon instantiation.
 */
export class TemplateFunction implements ScopeElement {
    public node: Node;
    public name: string;
    public type: TemplateType;
    public namedReturnTypes: boolean;
    public loc: Location;   
    public importFromModule: string;
    public isExported: boolean;
    // If the TemplateFunction represents a method of a template struct,
    // this is the corresponding struct template.
    public owner?: TemplateType;
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
        this.boxes = new Map<string, Box>();
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

    public registerBox(name: string, box: Box, loc: Location): void {
        if (this.boxes.has(name)) {
            throw "Implementation error";
        }
        this.boxes.set(name, box);
    }

    public lookupBox(name: string): Box {
        if (this.boxes.has(name)) {
            return this.boxes.get(name);
        }
        if (this.parent && !this.func) {
            return this.parent.lookupBox(name);
        }
        return null;
    }

    /*
    public boxOf(t: Type): Box {
        if (t instanceof RestrictedType && t.box) {
            return t.box;
        }
        return this.envelopingFunction().box;
    }
    */

    public envelopingFunction(): Function {
        if (this.func) {
            return this.func;
        }
        if (this.parent) {
            return this.parent.envelopingFunction();
        }
        return null;
    }

    // TODO: If in closure, stop at function boundary?
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
    public boxes: Map<string, Box>;
    public parent: Scope | null = null;
}

/**
 * Type is the base class for all types.
 */
export abstract class Type {
    public name: string;
    public loc: Location;

    public toString(): string {
        return this.name
    }

    public abstract toTypeCodeString(): string;
}

/**
 * BasicType represents all built-in types.
 */
export class BasicType extends Type {
    constructor(name: "void" | "bool" | "float" | "double" | "null" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "rune" | "any") {
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

    public extendsInterfaces: Array<Type | InterfaceType> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();
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

// TODO: Rename generic
export class GenericParameter extends Type {
    public toTypeCodeString(): string {
        throw "Implementation error";
    }
}

/**
 * TemplateType can either be a template function or a template structs.
 * Template types have template parameters which are type-wildcards with optional constraints.
 * The template type can be instantiated to become a TemplateFunctionType or a TemplateStructType
 * by assigning concrete types to these type-wildcards.
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
        if (this.mode == "weak") {
            op = "weak *";
        } else if (this.mode == "reference") {
            op = "&";
        } else if (this.mode == "unique") {
            op = "^";
        } else if (this.mode == "strong") {
            op = "*";
        } else {
            throw "Implementation error";
        }
        if (this.elementType instanceof RestrictedType) {
            return this.elementType.toString(true) + op + this.elementType.elementType.toString();
        }
        return op + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        if (this.mode != "strong") {
            return this.mode.toString() + "*" + this.elementType.toString();    
        }
        return "*" + this.elementType.toString();
    }

    public elementType: Type;
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
        return "#" + this.elementType.toString();
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

export class Box {
    constructor() {
        this.name = "$unnamed" + Box.counter++;
    }

    private static counter = 1;
    /**
     * If a Box is marked as extern, then it owned by the function caller.
     * All other boxes are owned (directly or indirectly) by variables on the
     * current function's stack frame.
     */
    public isExtern: boolean = false;
    /**
     * joinedBox pointing to 'this' means that the group has not yet joined any other box.
     * So it can either join another box or stay a box by itself.
     */
    public joinedBox: Box;
    public name: string;
    /**
     * scope is not null for variables which are located on the stack.
     */
//    scope: Scope | null;
//    private _isFrozen: boolean;

    public canonical(): Box {
        let t: Box = this;
        while (t.joinedBox) {
            t = t.joinedBox;
        }
        return t;
    }

    public join(box: Box, loc: Location, doThrow: boolean): boolean {
        let b1 = this.canonical();
        let b2 = box.canonical();
        if (b1 == b2) {
            return true;
        }
        if (b1.isExtern && b2.isExtern) {
            if (doThrow) {
                throw new TypeError("Two boxes cannot be merged", loc);
            }
            return false;
        }
        if (b1.isExtern) {
            b2.joinedBox = b1;
        } else {
            b1.joinedBox = b2;
        }
        return true;
    }

    /*
    public isFrozen(): boolean {
        return this.canonical()._isFrozen;
    }

    public freeze(): void {
        this.canonical()._isFrozen = true;
    }
    */
}

export type Restrictions = {
    isConst?: boolean;
    boxes?: Array<Box>;
}

export function combineRestrictions(r1: Restrictions, r2: Restrictions): Restrictions {
    if (!r1) {
        return r2;
    }
    if (!r2) {
        return r1;
    }
    return {
        isConst: r1.isConst || r2.isConst,
        boxes: r1.boxes ? r1.boxes : r2.boxes
    };
}

// Implements restrictions
export class RestrictedType extends Type {
    constructor(elementType: Type, r: Restrictions | null = null) {
        super();
        this.elementType = elementType;
        if (r) {
            this.isConst = r.isConst;
            this.boxes = r.boxes;
        } else {
            this.isConst = false;
            this.boxes = null;
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
        /*
        if (this.boxes) {
            str += "box("
            str += this.boxes.map(function(value: Box, index: number, arr: Box[]): any {
                return value.name;
            }).join(",");
            str += ") ";
        }
        */
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
    public boxes?: Array<Box>;
}

export type PointerMode = "unique" | "strong" | "weak" | "reference";

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
        if (this.mode == "reference") {
            mode = "&";
        } else if (this.mode == "weak") {
            mode = "weak ";
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
        this.t_any = new BasicType("any");
        let b = new Box();
//        b.freeze();
        let str = new SliceType(new ArrayType(this.t_byte, -1), "strong");
        str.name = "string";
        this.t_string = new RestrictedType(str, {isConst: true, boxes: [b]});
        
        this.t_void = new BasicType("void");
        this.t_rune = new BasicType("rune");
        
        this.t_error = new InterfaceType();
        this.t_error.name = "error";
        let toError = new FunctionType();
        toError.name = "toError";
        toError.returnType = this.t_string;
        toError.objectType = new RestrictedType(this.t_error, {isConst: true, boxes: null});
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

        this.globalBox = new Box();
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

    public createType(tnode: Node, scope: Scope, mode: "default" | "parameter" | "variable" = "default"): Type {
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
            if (mode == "variable") {
                if (this.isSafePointer(t)) {
                    throw "TODO: Make boxed recursively"
                } else if (this.isSlice(t)) {
                    throw "TODO: Make boxed recursively"
                }
            }
            return t;
        } else if (tnode.op == "str") {
            let t = this.stringLiteralType(tnode.value);
            return t;
        } else if (tnode.op == "constType") {
            let c = this.createType(tnode.rhs, scope, mode);
            if (this.isSafePointer(c)) {
                let ptr = RestrictedType.strip(c) as PointerType;
                ptr.elementType = this.makeConst(ptr.elementType, tnode.loc);
                return c;
            } else if (this.isSlice(c)) {
                let ptr = RestrictedType.strip(c) as SliceType;
                ptr.arrayType = this.makeConst(ptr.arrayType, tnode.loc) as RestrictedType;
                return c;
            }
            // TODO: Map
            return this.makeConst(c, tnode.loc)
        } else if (tnode.op == "weakType") {
            let c = this.createType(tnode.rhs, scope, mode);
            return this.makeWeak(c, tnode.loc);
        } else if (tnode.op == "boxType") {
            if (mode == "variable") {
                throw new TypeError("'box' must not be used in variable type definitions", tnode.loc);
            }
            let c = this.createType(tnode.rhs, scope, mode);
            if (this.isUnique(c)) {
                throw new TypeError("'box' must not be used together with the '^' operator", tnode.loc);
            }
            // A named box?
            let boxes: Array<Box>;
            if (tnode.parameters && tnode.parameters.length > 0) {
                if (mode == "default") {
                    throw new TypeError("Named boxes must not be used in this type definition", tnode.loc);
                }
                if (this.isStrong(c)) {
                    throw new TypeError("Named boxes on strong pointers are not allowed", tnode.loc);
                }
                boxes = [];
                for(let b of tnode.parameters) {
                    let box = scope.lookupBox(b.value);
                    if (!box) {
                        box = new Box();
                        box.name = b.value;
                        box.isExtern = this.isWeak(c);
                        scope.registerBox(box.name, box, tnode.loc);
                    }
                    boxes.push(box);
                }
            } else {
                boxes = [new Box()];
            }
            if (this.isSafePointer(c)) {
                let ptr = RestrictedType.strip(c) as PointerType;
                ptr.elementType = this.makeBox(ptr.elementType, boxes, tnode.loc);
                return c;
            } else if (this.isSlice(c)) {
                let ptr = RestrictedType.strip(c) as SliceType;
                ptr.arrayType = this.makeBox(ptr.arrayType, boxes, tnode.loc);
                return c;
            }
            throw new TypeError("The keyword 'box' can only be used on pointers, interfaces and slices", tnode.loc);
            // TODO: Map
        } else if (tnode.op == "pointerType") {
            let t = this.createType(tnode.rhs, scope, mode);
            if (mode == "variable") {
                t = new RestrictedType(t, {isConst: false, boxes: [new Box()]});
            }
            return new PointerType(t, "strong");
        } else if (tnode.op == "uniquePointerType") {
            let c = this.createType(tnode.rhs, scope, mode);
            if (mode == "variable") {
                c = new RestrictedType(c, {isConst: false, boxes: [new Box()]});
            }
            return new PointerType(c, "unique");
        } else if (tnode.op == "referenceType") {
            let c = this.createType(tnode.rhs, scope, mode);
            if (mode == "variable") {
                c = new RestrictedType(c, {isConst: false, boxes: [new Box()]});
            }
            return new PointerType(c, "reference");
        } else if (tnode.op == "unsafePointerType") {
            let t = this.createType(tnode.rhs, scope, mode);
            return new UnsafePointerType(t);
        } else if (tnode.op == "sliceType") {
            let t = this.createType(tnode.rhs, scope, mode);
            if (mode == "variable") {
                t = new RestrictedType(t, {isConst: false, boxes: [new Box()]});
            }
            let s = new SliceType(new ArrayType(t, -1), "strong");
            if (tnode.value == "^[]") {
                s.mode = "unique";
            } else if (tnode.value == "&[]") {
                s.mode = "reference";
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
            this.checkExpression(tnode.lhs, scope);
            if (tnode.lhs.op != "int") {
                throw new TypeError("Expected a constant number for array size", tnode.lhs.loc);
            }
            // TODO: Check range before parseInt
            return new ArrayType(this.createType(tnode.rhs, scope, mode), parseInt(tnode.lhs.value));
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
                    p.type = this.createType(pnode, scope, mode);
                    if (p.ellipsis && !(p.type instanceof SliceType)) {
                        throw new TypeError("Ellipsis parameters must be of a slice type", pnode.loc);
                    }
                    p.loc = pnode.loc;
                    t.parameters.push(p);
                }
            }
            if (tnode.rhs) {
                t.returnType = this.createType(tnode.rhs, scope, mode);
            } else {
                t.returnType = this.t_void;
            }
            return t;
        } else if (tnode.op == "genericType" && tnode.lhs.op == "id" && tnode.lhs.value == "map") {
            if (tnode.genericParameters.length != 2) {
                throw new TypeError("Supplied type arguments do not match signature of map", tnode.loc);
            }
            // TODO: Allow all types in maps?
            let k = this.createType(tnode.genericParameters[0], scope, mode);
            let v = this.createType(tnode.genericParameters[1], scope, mode);
            if (!this.isIntNumber(k) && !this.isString(k) && !this.isSafePointer(k) && !this.isUnsafePointer(k)) {
                throw new TypeError("Map keys must be integers, strings, or pointers", tnode.loc);
            }
            return new MapType(k, v);
        } else if (tnode.op == "genericType") {
            let baset = scope.resolveType(tnode.lhs.value);
            if (!baset) {
                throw new TypeError("Unknown type " + tnode.lhs.value, tnode.loc);
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
        } else if (tnode.op == "interfaceType") {
            let iface: Type = this.createInterfaceType(tnode, scope, null, mode);
            if (mode == "variable") {
                iface = new RestrictedType(null, {isConst: false, boxes: [new Box()]});
            }
            return new PointerType(iface, "strong");
        }
        throw "Implementation error for type " + tnode.op
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
            } else if (mnode.op == "funcType" || mnode.op == "asyncFuncType") {
                let ft = this.createType(mnode, scope, mode ? mode : "default") as FunctionType;
                ft.name = mnode.name.value;
                if (iface.methods.has(ft.name)) {
                    throw new TypeError("Duplicate member name " + ft.name, mnode.loc);
                }
                iface.methods.set(ft.name, ft);
                let fscope = new Scope(scope); // This scope is required for box names
                let r = this.createType(mnode.lhs, fscope, "default");
                let ptr = r;
                if (!(ptr instanceof PointerType)) {
                    throw "Implementation error";
                }
                if (ptr.elementType instanceof RestrictedType) {
                    ptr = ptr.elementType;
                }
                (ptr as PointerType | RestrictedType).elementType = iface;
                ft.objectType = r;
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
            s.loc = tnode.loc;
            this.structs.push(s);
        }
                
        for(let fnode of tnode.parameters) {
            if (fnode.op == "extends") {
                let ext: Type = this.createType(fnode.rhs, scope, mode ? mode : "default");
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
            this.checkIsAssignableType(new PointerType(iface, "strong"), new PointerType(s, "strong"), s.loc, "assign", true);
        }
    }
    
    private instantiateTemplateType(t: TemplateType, types: Array<Type>, loc: Location, mode: "default" | "parameter" | "variable"): Type {
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

        if (t.node.rhs.op == "structType") {
            let s = new TemplateStructType();
            s.base = t;
            s.name = t.name;
            s.loc = t.loc;
            s.templateParameterTypes = types;

            if (a) {
                a.push(s);
            } else {
                this.templateTypeInstantiations.set(t, [s]);
            }
    
            this.createStructType(t.node.rhs, scope, s);
            for(let m of t.methods) {
                this.instantiateTemplateMemberFunction(t, s, m);
            }
            return s;
        } else if (t.node.rhs.op == "interfaceType" || t.node.rhs.op == "andType") {
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
    
            this.createInterfaceType(t.node.rhs, scope, s);
            return s;
        } else if (t.node.rhs.op == "funcType") {
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

            throw "TODO";
        } else if (t.node.rhs.op == "orType") {
            throw "TODO";
        }
        throw "Implementation error";
    }

    private instantiateTemplateMemberFunction(t: TemplateType, s: TemplateStructType, m: TemplateFunction): Function | TemplateFunction {
        let scope = new Scope(t.parentScope);
        // TODO: Register the fully qualified name, too
        scope.registerType(s.name, s);
        for(let i = 0; i < t.templateParameterNames.length; i++) {
            scope.registerType(t.templateParameterNames[i], s.templateParameterTypes[i]);
        }
        let node = m.node.clone();        
        let f = this.createFunction(node, scope, t.registerScope);
        if (f instanceof Function) {
            this.checkFunctionBody(f);
        }
        return f;
    }

    /**
     * Parses the instantiation of a template function, e.g. in "max<int>(4,5)" this function parses "max<int>".
     */
    private instantiateTemplateFunctionFromNode(tnode: Node, scope: Scope): Function {
        if (tnode.op != "genericInstance") {
            throw "Implementation error";
        }
        let baset = tnode.lhs.type;
        // Is the type a template type?
        if (!(baset instanceof TemplateType)) {
            throw new TypeError("Type " + baset.toString() + " is not a template function", tnode.loc);
        }
        // Is the type a function template type?
        if (baset.node.op != "func" && baset.node.op != "export_func" && baset.node.op != "asyncFunc") {
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
        let f = this.createFunction(node, scope, t.registerScope, true);
        if (!(f instanceof Function)) {
            throw "Implementation error";
        }
        if (!(f.type instanceof TemplateFunctionType)) {
            throw "Implementation error";
        }
        f.type.base = t;
        f.type.templateParameterTypes = types;
        if (a) {
            a.push(f);
        } else {
            this.templateFunctionInstantiations.set(t, [f]);
        }

        // Typecheck the template function body.
        this.checkFunctionBody(f);
        return f;
    }

    public createFunction(fnode: Node, parentScope: Scope, registerScope: Scope, instantiateTemplate: boolean = false): Function | TemplateFunction {
        if (!fnode.name) {
            throw new TypeError("Function must be named", fnode.loc);
        }
        let objectType: Type;
        let structType: StructType;
        // A member function?
        if (fnode.lhs) {
            objectType = this.createType(fnode.lhs, parentScope, "parameter");
            if (!(objectType instanceof PointerType)) {
                throw new TypeError(objectType.toString() + " is not a pointer", fnode.lhs.loc);
            }
            let obj = RestrictedType.strip(objectType.elementType);
            if (!(obj instanceof StructType) || obj.name == "") {
                throw new TypeError(obj.toString() + " is not a named struct", fnode.lhs.loc);
            }
            structType = obj;
        }
        let f: Function | TemplateFunction;
        if ((fnode.genericParameters && !instantiateTemplate) || this.isTemplateType(objectType)) {
            f = new TemplateFunction();
            f.node = fnode;
            if (this.isTemplateType(objectType)) {
                let tt = this.stripType(objectType) as TemplateType;
                f.owner = tt;
                tt.methods.push(f);
            }
        } else {
            f = new Function();
        }
        f.name = fnode.name.value;
        f.node = fnode;
        f.loc = fnode.loc;
        f.isExported = (fnode.op == "export_func");

        if (f instanceof TemplateFunction) {
            let gt = new TemplateType();   
            gt.name = fnode.name.value;         
            gt.node = fnode;
            gt.parentScope = parentScope;
            gt.registerScope = registerScope;
            let scope = new Scope(parentScope);
            if (fnode.genericParameters && !instantiateTemplate) {
                for(let g of fnode.genericParameters) {
                    gt.templateParameterTypes.push(g.condition ? g.condition : null);
                    gt.templateParameterNames.push(g.value);
                }            
            }
            f.type = gt;
            f.type.loc = fnode.loc;
            registerScope.registerElement(f.name, f);            
            // Do not process any further. This is done upon template instantiation
            return f;
        }

        f.scope.parent = parentScope;        
        if (fnode.genericParameters) {
            f.type = new TemplateFunctionType();
            f.name += "<";
            for(let g of fnode.genericParameters) {
                let t = f.scope.resolveType(g.value);
                f.name += t.toString() + ",";
            }
            f.name += ">";
        } else {
            f.type = new FunctionType();
        }
        f.type.loc = fnode.loc;
        if (fnode.op == "asyncFunc") {
            f.type.callingConvention = "fyrCoroutine";
        }
        // A member function?
        if (objectType) {
            f.type.objectType = objectType;
            let p = new FunctionParameter();
            p.name = "this";            
            p.loc = fnode.lhs.loc;
            p.type = objectType;
            f.scope.registerElement("this", p);
        }
        if (fnode.parameters) {
            let boxes = new Map<string, Box>();
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
                p.type = this.createType(pnode, f.scope.parent, "parameter");
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
            f.type.returnType = this.createType(fnode.rhs, f.scope, "parameter");
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
            registerScope.registerElement(this.qualifiedTypeName(structType) + "." + f.name, f);
        } else {
            registerScope.registerElement(f.name, f);
        }

        return f;
    }

    private createVar(vnode: Node, scope: Scope, needType: boolean = true, isConst: boolean = false, isGlobal: boolean = false): Variable {
        let v = new Variable();
        v.loc = vnode.loc;
        v.name = vnode.value;
        if (!vnode.rhs) {
            if (needType) {
                throw new TypeError("Variable declaration of " + vnode.value + " without type information", vnode.loc);
            }
        } else {
            v.type = this.createType(vnode.rhs, scope, "variable");
            if (isConst) {
                v.type = this.makeConst(v.type, vnode.loc);
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

        if (t.node.genericParameters) {
            let tmpl = new TemplateType();
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
        } else if (t.node.rhs.op == "structType") {
            let s = new StructType();
            s.loc = t.node.loc;
            s.name = t.name;
            this.structs.push(s);
            t.type = s;
            scope.registerType(t.name, s, tnode.loc);
        } else if (t.node.rhs.op == "interfaceType" || t.node.rhs.op == "andType") {
            let iface = new InterfaceType();
            iface.loc = t.node.loc;
            iface.name = t.name;
            this.ifaces.push(iface);
            t.type = iface;
            scope.registerType(t.name, iface, tnode.loc);
        } else if (t.node.rhs.op == "orType") {
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
                p.type = this.createType(pnode, f.scope, "parameter");
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
                    if (f instanceof Function) {
                        functions.push(f);
                    }
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
                    this.checkIsAssignableNode(v.type, rnode);
                } else {
                    this.checkIsAssignableType(v.type, rtype, vnode.loc, "assign", true);
                }
            }
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
                            v.type = new RestrictedType(v.type, {isConst: true, boxes: null});
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
                                this.checkIsAssignableNode(lt.types[j-i], r);
                            }
                        } else {
                            this.checkIsAssignableType(v.type, new TupleType(rtypeStripped.types.slice(i)), vnode.loc, "assign", true);
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
//                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j]);
//                                rtype.types[j] = rnode.parameters[j].type;
                            }
//                            v.type = new SliceType(this.t_json);
                            throw "TODO";
                        } else if (rtypeStripped instanceof ArrayType) {
                            v.type = new ArrayType(rtypeStripped.elementType, rtypeStripped.size - i);
                            // TODO: Check whether the array slice can be copied at all
                            // TODO; Clone the restrictions of the array
                            throw "TODO"
                        } else if (rtypeStripped instanceof SliceType) {
                            // TODO; Clone the restrictions of the array
                            v.type = rtype;
                            throw "TODO"
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
                                this.checkIsAssignableNode(rt, rnode.parameters[j]);
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
            if (!(rtypeStripped instanceof ObjectLiteralType) && (!(rtypeStripped instanceof MapType) || this.isString(rtypeStripped.keyType))) {
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
                        if (rtypeStripped instanceof ObjectLiteralType) {
                            let valueType: Type = null; // TODO
                            for(let j = i; j < rnode.parameters.length; j++) {
//                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j].lhs);
                            }
                            v.type = new MapType(this.t_string, valueType);
                            throw "TODO";
                        } else if (rtypeStripped instanceof TemplateStructType) {
                            v.type = rtype;
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (rtypeStripped instanceof ObjectLiteralType) {
                            let rt: Type;
                            if (lt instanceof MapType && this.isString(lt.keyType)) {
                                rt = lt.valueType;
                            } else {
                                throw new TypeError("Ellipsis identifier must be of map type", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j].lhs);
                            }
                        } else if (rtypeStripped instanceof MapType) {
                            if (!(lt instanceof MapType) || !this.isString(lt.keyType)) {
                                throw new TypeError("Ellipsis identifier must be of type map<string, ...>", vnode.loc);
                            }
                            this.checkIsAssignableType(lt.valueType, rtypeStripped.valueType, vnode.loc, "assign", true);
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
                    } else if (rtype instanceof MapType) {
                        rt = rtype.valueType;
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
                    this.checkIsMutable(p.lhs, scope);
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
                            this.checkIsAssignableNode(p.lhs.type.types[j-i], r);
                        }
                    } else {
                        this.checkIsAssignableType(p.lhs.type, new TupleType(rtypeStripped.types.slice(i)), vnode.loc, "assign", true);
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
                    this.checkIsMutable(p.lhs, scope);
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
                            this.checkIsAssignableNode(rt, rnode.parameters[j]);
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
            if (!(rtypeStripped instanceof ObjectLiteralType) && (!(rtype instanceof MapType) || !this.isString(rtype.keyType))) {
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
                        if (kv.lhs.type instanceof MapType && this.isString(kv.lhs.type.keyType)) {
                            rt = kv.lhs.type.valueType;
                        } else {
                            throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j].lhs);
                        }
                    } else if (rtypeStripped instanceof MapType) {
                        if (!(kv.lhs.type instanceof MapType) || !this.isString(kv.lhs.type.keyType)) {
                            throw new TypeError("Ellipsis identifier must be of type map<string,...>", vnode.loc);
                        }
                        this.checkIsAssignableType(kv.lhs.type.valueType, rtypeStripped.valueType, vnode.loc, "assign", true);
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
                        throw "TODO: Find matching node in literal"
                    } else if (rtypeStripped instanceof MapType) {
                        rt = rtypeStripped.valueType;
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
                this.checkIsAssignableType(vnode.type, rtype, vnode.loc, "assign", true);
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
                this.checkIsAssignableType(this.t_bool, snode.condition.type, snode.condition.loc, "assign", true);
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
                            this.checkIsAssignableType(this.t_bool, snode.condition.condition.type, snode.condition.condition.loc, "assign", true);
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
                            let v = this.createVar(p, scope, true);
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
                        this.checkIsAssignableType(snode.lhs.type, snode.rhs.type, snode.loc, "assign", true);
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
                        this.checkIsAssignableType(this.t_int, snode.rhs.type, snode.loc, "assign", true);
                    }
                } else {
                    this.checkIsIntNumber(snode.lhs);
                    this.checkIsIntNumber(snode.rhs);
                    if (snode.rhs.op == "int" || snode.rhs.op == "float") {
                        this.unifyLiterals(snode.lhs.type, snode.rhs, snode.loc);
                    } else {
                        this.checkIsAssignableType(snode.lhs.type, snode.rhs.type, snode.loc, "assign", true);
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
                break;
            case "var_in":
            {
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
                    if (snode.lhs.parameters[0].value != "_") {
                        let v1 = this.createVar(snode.lhs.parameters[0], scope, false);
                        if (v1.type) {
                            this.checkIsAssignableType(v1.type, tindex1, snode.loc, "assign", true);
                        } else {
                            v1.type = tindex1
                        }
                    }
                    if (snode.lhs.parameters[1].value != "_") {
                        let v2 = this.createVar(snode.lhs.parameters[1], scope, false);
                        if (v2.type) {
                            this.checkIsAssignableType(v2.type, tindex2, snode.loc, "assign", true);
                        } else {
                            v2.type = tindex2;
                        }
                    }
                } else {
                    let v = this.createVar(snode.lhs, scope, false);
                    if (v.type) {
                        this.checkIsAssignableType(v.type, tindex1, snode.loc, "assign", true);
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
                let t = this.stripType(enode.rhs.type);
                enode.type = (t as (PointerType | UnsafePointerType)).elementType;
                if (this.isInterface(enode.type)) {
                    throw new TypeError("Interfaces cannot be dereferenced", enode.loc);
                }
                break;
            }
            case "unary&":
            {
                this.checkExpression(enode.rhs, scope);
                if (enode.isUnifyableLiteral()) {
                    enode.type = this.defaultLiteralType(enode);
                } else {
                    this.checkIsAddressable(enode.rhs, scope, true, true);
                    enode.type = new PointerType(enode.rhs.type, "reference");
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
                if ((enode.op == "+" || enode.op == ">" || enode.op == "<" || enode.op == ">=" || enode.op == "<=") && this.isString(enode.lhs.type)) {
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
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
                    }
                    enode.type = this.stripType(enode.lhs.type);
                } else if (this.isUnsafePointer(enode.rhs.type)) {
                    if (enode.op == "*" || enode.op == "/") {
                        throw new TypeError("'" + enode.op + "' is an invalid operation on pointers", enode.loc);
                    }
                    if (enode.op == "+" || enode.op == "-") {
                        this.checkIsInt32Number(enode.lhs);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
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
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
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
                        this.checkIsAssignableType(this.t_uint, enode.rhs.type, enode.rhs.loc, "assign", true);
                    } else {
                        this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
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
                let tr = this.stripType(enode.rhs.type);
                if (tr instanceof OrType && !tr.stringsOnly()) {
                    throw new TypeError("Or'ed types cannot be compared", enode.rhs.loc);
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
                    this.checkIsAssignableType(enode.lhs.type, enode.rhs.type, enode.loc, "assign", true);
                }
                enode.type = this.t_bool;
                break;
            case ".":
            {
                this.checkExpression(enode.lhs, scope);
                let type: Type = this.stripType(enode.lhs.type);
                let name = enode.name.value;
                if (type instanceof PackageType) {
                    if (!type.elements.has(name)) {
                        throw new TypeError("Unknown identifier " + name + " in " + type.toString(), enode.name.loc);                        
                    }
                    enode.type = type.elements.get(name);
                    break;
                }
                let method = this.getBuiltinFunction(enode.lhs.type, name, enode.name.loc);
                if (method) {
                    enode.type = method;
                    break;
                }
                let objectType = type;
                let isConst = this.isConst(enode.lhs.type);
                if (type instanceof PointerType || type instanceof UnsafePointerType) {
                    isConst = this.isConst(type.elementType);
                    objectType = this.stripType(type.elementType);
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
                            enode.type = this.applyConst(enode.type, enode.loc);
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
                let isConst = this.isConst(enode.lhs.type);
                let t: Type = this.stripType(enode.lhs.type);
                let elementType = this.checkIsIndexable(enode.lhs, index1);
                if (t instanceof ArrayType) {
                    this.checkIsAddressable(enode.lhs, scope, false);
                    this.checkIsIndexable(enode.lhs, index2, true);
                    enode.type = new SliceType(t, "strong");
                } else if (t instanceof UnsafePointerType) {
                    enode.type = new SliceType(enode.lhs.type as (ArrayType | RestrictedType), "reference");
                    if (isConst) {
                        enode.type = this.applyConst(enode.type, enode.loc);
                    }
                } else if (t instanceof MapType) {
                    throw new TypeError("Ranges are not supported on maps", enode.loc);
                } else {
                    // For slices the type remains the same
                    enode.type = enode.lhs.type;
                }
                break;
            }
            case "[":
            {
                this.checkExpression(enode.lhs, scope);
                this.checkExpression(enode.rhs, scope);
                let isConst = this.isConst(enode.lhs.type);
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
                        this.checkIsAssignableType(t.keyType, enode.rhs.type, enode.rhs.loc, "assign", true);
                    }
                    enode.type = t.valueType;
                } else if (t instanceof SliceType) {
                    enode.type = t.getElementType();
                    isConst = isConst || this.isConst(t.arrayType);
                } else if (t instanceof UnsafePointerType) {
                    enode.type = t.elementType;
                } else {
                    throw new TypeError("[] operator is not allowed on " + enode.lhs.type.toString(), enode.loc);
                }
                if (isConst) {
                    enode.type = this.applyConst(enode.type, enode.loc);
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
                if (t instanceof TemplateType) {
                    let result = this.checkTemplateFunctionArguments(t, enode.parameters, scope, enode.loc);
                    let types: Array<Type> = [];
                    for(let i = 0; i < t.templateParameterNames.length; i++) {
                        let tt = result.get(t.templateParameterNames[i]);
                        types.push(tt);
                    }
                    let f = this.instantiateTemplateFunction(t, types, enode.loc);
                    enode.type = f.type.returnType;
                    enode.lhs.type = f.type;
                } else if (t instanceof PolymorphFunctionType) {
                    var ok = false;
                    for(let it of t.instances) {
                        if (this.checkFunctionArguments(it, enode.parameters, scope, enode.loc, false)) {
                            ok = true;
                            enode.lhs.type = it;
                            enode.type = it.returnType;
                            break;
                        }                        
                    }
                    if (!ok) {
                        throw new TypeError("Parameters match no instance of the polymorphic function " + t.name, enode.loc);
                    }
                } else if (t instanceof FunctionType) {
                    this.checkFunctionArguments(t, enode.parameters, scope, enode.loc);                    
                    enode.type = t.returnType;
                } else {
                    throw new TypeError("Expression is not a function", enode.loc);
                }
                break;
            }
            case "genericInstance":
                this.checkExpression(enode.lhs, scope);
                // enode.type = this.createType(enode, scope);
                enode.type = this.instantiateTemplateFunctionFromNode(enode, scope).type;
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
                    let ct = this.createType(enode.lhs, scope, "variable");
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
                    let ct = this.createType(enode.lhs, scope, "variable");
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
                    let ct = this.createType(enode.lhs, scope, "variable");
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
                        p.type = this.createType(pnode, enode.scope, "parameter");
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
                let t = this.createType(enode.rhs, scope, "variable");
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
                let t = this.createType(enode.lhs, scope, "variable");
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
                } else if (t instanceof UnsafePointerType && (right instanceof UnsafePointerType || right instanceof PointerType || this.isString(right) || this.isInt32Number(right))) {
                    // Unsafe pointers to anything, safe pointers to anything, strings and 32-bit integers can be converted to any unsafe pointer
                    enode.type = t;
                } else if ((t == this.t_bool || this.isIntNumber(t)) && (right == this.t_bool || this.isIntNumber(right)) && t != right) {
                    // bool and all integers can be converted into each other
                    enode.type = t;
                } else if (this.isString(t) && right instanceof UnsafePointerType) {
                    // An unsafe pointer can be converted to a string by doing nothing. This is an unsafe cast.
                    enode.type = t;
                } else if (this.isString(t) && right instanceof SliceType && right.getElementType() == this.t_byte) {
                    // A slice of bytes can be converted to a string by copying it by copying it.
                    // Restrictions are irrelevant.
                    enode.type = t;
                } else if (t instanceof SliceType && t.getElementType() == this.t_byte && this.isString(right)) {
                    // A string can be casted into a sequence of bytes by copying it
                    enode.type = t;
                } else if (this.isComplexOrType(right)) {
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
                } else if (this.checkIsAssignableType(t, right, enode.loc, "assign", false)) {
                    // null can be casted, especially when it is assigned to interface{}
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
            case "take":
                this.checkExpression(enode.lhs, scope);
                this.checkIsMutable(enode.lhs, scope);
                let takeType = RestrictedType.strip(enode.lhs.type);
                if (!(takeType instanceof PointerType || takeType instanceof SliceType) || takeType.mode == "reference") {
                    throw new TypeError("take() can only be applied to non-reference pointer types", enode.lhs.loc);
                }
                enode.type = enode.lhs.type;
                break;
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
                if (v.node.rhs.isUnifyableLiteral()) {
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
        if (node.op == "unary&") {
            let t = this.defaultLiteralType(node.rhs);
            if (t instanceof ArrayType) {
                node.type = new SliceType(t, "strong");
            } else {
                node.type = new PointerType(t, "strong");
            }
            return node.type;
        } else if (node.type instanceof ArrayLiteralType) {
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode);
            }
            if (node.parameters.length == 0) {
                throw new TypeError("Cannot infer type of []", node.loc);
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

    private unifyLiterals(t: Type, node: Node, loc: Location, doThrow: boolean = true, templateParams: Map<string, Type> = null): boolean {
        if (templateParams && t instanceof GenericParameter && templateParams.has(t.name)) {
            t = templateParams.get(t.name);
        }

        if (t instanceof RestrictedType) {
            t = t.elementType;
        }  

        if (t instanceof OrType) {
            for(let o of t.types) {
                if (this.unifyLiterals(o, node, loc, false)) {
                    return true;
                }
            }
            if (doThrow) {
                throw new TypeError("Literal of type " + node.type.toString() + " is not an option of " + t.toString(), node.loc);                    
            }
            return false;
        }

        if (t == this.t_any) {
            node.type = this.defaultLiteralType(node);
            return true;
        }

        if (t instanceof PointerType && (t.mode == "strong" || t.mode == "reference") && node.op == "object") {
            if (!this.unifyLiterals(t.elementType, node, loc, doThrow, templateParams)) {
                return false;
            }
            node.type = new PointerType(node.type, t.mode);
            return true;
        }

        // TODO: Map

        if (t instanceof SliceType && (t.mode == "strong" || t.mode == "reference") && node.op == "array" && t.name != "string") {
            if (!this.unifyLiterals(t.arrayType, node, loc, doThrow, templateParams)) {
                return false;
            }
            node.type = new SliceType(node.type as ArrayType, t.mode);
            return true;
        }

        if (templateParams && t instanceof GenericParameter) {
            node.type = this.defaultLiteralType(node);
            templateParams.set(t.name, node.type);
            return true;
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
                if (this.isString(t)) {
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
                    if (node.parameters.length != t.size && t.size != -1) {
                        throw new TypeError("Mismatch in array size", node.loc);                                                
                    }
                    for(let pnode of node.parameters) {
                        if (!this.checkIsAssignableNode(t.elementType, pnode, doThrow)) {
                            return false;
                        }
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
                        if (!this.checkIsAssignableNode(t.types[i], pnode, doThrow)) {
                            return false;
                        }
                    }
                    node.type = t;
                    return true;                    
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between tuple literal and " + t.toString(), loc);                
            case "object":
                if (t instanceof MapType && this.isString(t.keyType)) {
                    // A map, e.g. "{foo: 42}"
                    if (node.parameters) {
                        for(let pnode of node.parameters) {
                            if (!this.checkIsAssignableNode(t.valueType, pnode.lhs, doThrow)) {
                                return false;
                            }
                        }
                    }
                    node.type = t;
                    return true;
                } else if (t instanceof MapType && (!node.parameters || node.parameters.length == 0)) {
                    // An empty map, e.g. "{}"
                    node.type = t;
                    return true;
                } else if (t instanceof StructType) {
                    // A struct initialization
                    if (node.parameters) {
                        for(let pnode of node.parameters) {
                            let field = t.field(pnode.name.value);
                            if (!field) {
                                throw new TypeError("Unknown field " + pnode.name.value + " in " + t.toString(), pnode.name.loc);
                            }
                            if (!this.checkIsAssignableNode(field.type, pnode.lhs, doThrow)) {
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
                    let r = this.unifyLiterals(t, node.rhs, loc, doThrow, templateParams);
                    node.type = node.rhs.type;
                    return r;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between object literal and " + t.toString(), loc);
            default:
                throw "Implementation error";
        }
    }

    // Checks whether the type of 'from' can be assigned to the type 'to'.
    public checkIsAssignableNode(to: Type, from: Node, doThrow: boolean = true, templateParams: Map<string, Type> = null): boolean {
        if (from.isUnifyableLiteral()) {
            return this.unifyLiterals(to, from, from.loc, doThrow, templateParams);
        }
        return this.checkIsAssignableType(to, from.type, from.loc, "assign", doThrow, null, null, templateParams);
    }

    // TODO: Remove unbox
    // Checks whether the type 'from' can be assigned to the type 'to'.
    public checkIsAssignableType(to: Type, from: Type, loc: Location, mode: "assign" | "equal" | "pointer", doThrow: boolean = true, toRestrictions: Restrictions = null, fromRestrictions: Restrictions = null, templateParams: Map<string, Type> = null): boolean {
        if (toRestrictions == null) {
            toRestrictions = {isConst: false, boxes: null}
        }
        if (fromRestrictions == null) {
            fromRestrictions = {isConst: false, boxes: null}
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
        if (!toRestrictions.isConst && !!fromRestrictions.isConst && (mode != "assign" || !this.isPureValue(to))) {
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

        if (mode == "pointer") {
            if (to instanceof StructType && from instanceof StructType && to != from && from.doesExtend(to)) {
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
        } else if (to instanceof PointerType && from == this.t_null) {
            // null can be assigned to any pointer type
            if (mode == "assign") {
                return true;
            }
        } else if (to instanceof PointerType && from instanceof UnsafePointerType) {
            if (mode == "assign" && this.checkIsAssignableType(to.elementType, from.elementType, loc, "pointer", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }
        } else if (to instanceof PointerType && from instanceof PointerType) {
            if (to.mode == from.mode || (mode == "assign" &&
                (to.mode == "reference" ||
                (to.mode == "weak" && (from.mode == "weak" || from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "strong" && (from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "unique" && (from.mode == "strong" || from.mode == "unique"))))) {
                if (this.checkIsAssignableType(to.elementType, from.elementType, loc, mode == "assign" ? "pointer" : "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    return true;
                }            
            }
        } else if (to instanceof UnsafePointerType && (from == this.t_int || from == this.t_uint || from == this.t_null)) {
            // integers and null can be assigned to an usafe pointer type
            if (mode == "assign") {
                return true;
            }
        } else if (to instanceof UnsafePointerType && (from instanceof UnsafePointerType || from instanceof PointerType)) {            
            if (to.elementType == this.t_void) {
                // Safe and unsafe pointers to anything can be assigned to #void
                if (mode == "assign") {
                    return true;
                }
            }
            if (from.elementType == this.t_void) {
                // #void can be assigned to any unsafe pointer
                if (mode == "assign") {
                    return true;
                }
            }
            if (this.checkIsAssignableType(to.elementType, from.elementType, loc, mode == "assign" ? "pointer" : "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }            
        } else if (to instanceof ArrayType && from instanceof ArrayType) {
            if (to.size == from.size && this.checkIsAssignableType(to.elementType, from.elementType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                return true;
            }
        } else if (to instanceof SliceType && from instanceof SliceType) {
            if (to.mode == from.mode || (mode == "assign" && 
                (to.mode == "reference" ||
                (to.mode == "weak" && (from.mode == "weak" || from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "strong" && (from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "unique" && (from.mode == "strong" || from.mode == "unique"))))) {
                if (this.checkIsAssignableType(to.arrayType, from.arrayType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    return true;
                }            
            }
        } else if (to instanceof MapType && from instanceof MapType) {
            if (this.checkIsAssignableType(to.keyType, from.keyType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams) &&
                this.checkIsAssignableType(to.valueType, from.valueType, loc, "equal", false, toRestrictions, fromRestrictions, templateParams)) {
                    return true;
            }
        } else if (to == this.t_any) {
            // Everything can be asssigned to the empty interface
            return true;
        } else if (to instanceof InterfaceType) {
            if (from instanceof InterfaceType) {
                // Check two interfaces (which are not the same InterfaceType objects)
                let fromMethods = from.getAllMethods();
                let toMethods = to.getAllMethods();
                if ((mode == "assign" && fromMethods.size >= toMethods.size) || fromMethods.size == toMethods.size) {
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
            } else if (from instanceof StructType && mode == "pointer") {
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
        throw new TypeError("Type " + from.toString() + " cannot be assigned to type " + to.toString(), loc);        
    }

    public checkFunctionArguments(ft: FunctionType, args: Array<Node> | null, scope: Scope, loc: Location, doThrow: boolean = true): boolean {
        // Type check all parameters
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
                    if (!this.checkIsAssignableNode(ft.lastParameter().type, pnode.rhs, doThrow)) {
                        return false;
                    }
                } else {
                    if (ft.hasEllipsis() && i >= ft.parameters.length - 1) {
                        if (!this.checkIsAssignableNode((ft.lastParameter().type as SliceType).getElementType(), pnode, doThrow)) {
                            return false;
                        }
                    } else {
                        if (!this.checkIsAssignableNode(ft.parameters[i].type, pnode, doThrow)) {
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
            throw "Implementation error";
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
                this.checkIsAssignableNode(this.createType(lastParameter, s, "parameter"), pnode.rhs, true, result);
            } else {
                if (ellipsis && i >= t.node.parameters.length - 1) {
                    this.checkIsAssignableNode((this.createType(lastParameter, s, "parameter") as SliceType).getElementType(), pnode, true, result);
                } else {
                    this.checkIsAssignableNode(this.createType(t.node.parameters[i], s, "parameter"), pnode, true, result);
                }
            }
        }
    
        for(let n of t.templateParameterNames) {
            if (!result.has(n)) {
                result.set(n, this.t_void);
            }
        }

        return result;
    }

    public checkIsEnumerable(node: Node): [Type, Type] {
        let t = this.stripType(node.type);
        if (t instanceof MapType) {
            return [t.keyType, t.valueType];
        } else if (t instanceof ArrayType) {
            return [this.t_int, t.elementType];
        } else if (t instanceof SliceType) {
            return [this.t_int, t.getElementType()];
        }
        throw new TypeError("The type " + t.toString() + " is not enumerable", node.loc);
    }

    public checkIsIndexable(node: Node, index: number, indexCanBeLength: boolean = false): Type {
        let t = this.stripType(node.type);
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
        if (this.isString(node.type)) {
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
                    if (allowMoreRestrictions && (this.isConst(a.objectType) && !this.isConst(b.objectType))) {
                        ok = false;
                    } else if (!allowMoreRestrictions && this.isConst(a.objectType) != this.isConst(b.objectType)) {
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

    private isLeftHandSide(node: Node): boolean {
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

    public checkIsMutable(node: Node, scope: Scope) {
        if (node.type instanceof RestrictedType && node.type.isConst) {
            throw new TypeError("The expression is not mutable because is const", node.loc);
        }

        if (!this.isLeftHandSide(node)) {
            throw new TypeError("The expression is not mutable because it is an intermediate value", node.loc);
        }
    }

    public stripType(t: Type): Type {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        return t;
    }
    
    public isString(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType.name == "string";
        }
        return t.name == "string";
    }
    
    public isStringLike(t: Type): boolean {
        // A string is a frozen slice of bytes
        return t instanceof RestrictedType && t.boxes.length > 0 && t.isConst && t.elementType instanceof SliceType && t.elementType.mode == "strong" && t.elementType.getElementType() == this.t_byte;
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

    public isTemplateType(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof TemplateType;
    }

    public isMutableValue(t: Type): boolean {
        t = this.stripType(t);
        return t instanceof StructType || t instanceof TupleType || t instanceof ArrayType;
    }

    public isWeak(t: Type): boolean {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        if (t instanceof PointerType && t.mode == "weak") {
            return true;
        }
        if (t instanceof SliceType && t.mode == "weak") {
            return true;
        }
        return false;
    }

    public isStrong(t: Type): boolean {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        if (t instanceof PointerType && t.mode == "strong") {
            return true;
        }
        if (t instanceof SliceType && t.mode == "strong") {
            return true;
        }
        return false;
    }

    public isUnique(t: Type): boolean {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        if (t instanceof PointerType && t.mode == "unique") {
            return true;
        }
        if (t instanceof SliceType && t.mode == "unique") {
            return true;
        }
        return false;
    }

    public isConst(t: Type): boolean {
        if (t instanceof RestrictedType) {
            if (t.isConst) {
                return true;
            }
            t = t.elementType;
        }
        return false;
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
            
    public isSafePointer(t: Type): boolean {
        t = this.stripType(t);
        return (t instanceof PointerType);
    }
    
    /**
     * A pure value contains no pointers and can be copied byte by byte.
     */
    public isPureValue(t: Type): boolean {
        t = this.stripType(t);
        if (t == this.t_rune || t == this.t_bool || t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64 || t == this.t_null || t == this.t_void) {
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
            if (t.extends && !this.isPureValue(t.extends)) {
                return false;
            }
            return true;
        }
        return false;
    }

    public applyConst(t: Type, loc: Location): Type {
        if (this.isSafePointer(t)) {
            let ptr = RestrictedType.strip(t) as PointerType;
            ptr.elementType = this.makeConst(ptr.elementType, loc);
        } else if (this.isSlice(t)) {
            let ptr = RestrictedType.strip(t) as SliceType;
            ptr.arrayType = this.makeConst(ptr.arrayType, loc) as RestrictedType;
        }
        return this.makeConst(t, loc);
    }

    public makeConst(t: Type, loc: Location): Type {
        if (t instanceof RestrictedType) {
            if (t.isConst) {
                return t;
            }
            return new RestrictedType(t.elementType, {isConst: true, boxes: t.boxes});
        }
//        if (this.isPrimitive(t)) {
//            return t;
//        }
        return new RestrictedType(t, {isConst: true, boxes: null});
    }

    public makeBox(t: Type, boxes: Array<Box>, loc: Location): RestrictedType {
        if (t instanceof RestrictedType) {
            if (t.boxes) {
                throw "Implementation error";
            }
            return new RestrictedType(t.elementType, {isConst: t.isConst, boxes: boxes});
        }
        return new RestrictedType(t, {isConst: false, boxes: boxes});
    }

    public makeWeak(t: Type, loc: Location): Type {
        if (!this.isSafePointer(t) && !this.isSlice(t)) {
            throw new TypeError("The keyword 'weak' can only be used on pointers, interfaces and slices", loc);
        }
        let p = RestrictedType.strip(t) as PointerType | SliceType;
        if (p.mode != "strong") {
            throw new TypeError("The keyword 'weak' must not be used together with '&' or '^", loc);
        }
        p.mode = "weak";
        return t;
    }

    public pointerElementType(t: Type): Type {
        t = RestrictedType.strip(t);
        if (t instanceof PointerType || t instanceof UnsafePointerType) {
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

    private getBuiltinFunction(t: Type, name: string, loc: Location): FunctionType | null {
        let type = this.stripType(t);
        if (type instanceof SliceType) {
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
                ft.returnType = new SliceType(new ArrayType(type.getElementType(), -1), "strong");
                if (this.isConst(t) && !this.isPureValue(type.getElementType())) {
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

    public qualifiedTypeName(t: Type): string {
        return t.toString();
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
    public t_void: Type;
    public t_any: Type;
    public t_error: InterfaceType;

    public builtin_len: FunctionType;
    public builtin_cap: FunctionType;

    // List of all interfaces. These are checked for possible errors after they have been defined.
    public ifaces: Array<InterfaceType> = [];
    public structs: Array<StructType> = [];
    public templateTypeInstantiations: Map<TemplateType, Array<TemplateStructType | TemplateInterfaceType | TemplateFunctionType>> = new Map<TemplateType, Array<TemplateStructType | TemplateInterfaceType | TemplateFunctionType>>();
    public templateFunctionInstantiations: Map<TemplateType, Array<Function>> = new Map<TemplateType, Array<Function>>();
    
//    private callGraph: Map<Function, Array<FunctionType>> = new Map<Function, Array<FunctionType>>();
    private stringLiteralTypes: Map<string, StringLiteralType> = new Map<string, StringLiteralType>();

    private globalBox: Box;
}

export class TypeError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}