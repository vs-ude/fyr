import {Node, NodeOp, Location, AstFlags} from "./ast"
import pkg = require("./pkg");
import { doesNotThrow } from "assert";
import { isUndefined } from "util";
import { Pointer } from "./ssa";

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
    public isGlobal: boolean;
    // Variables declared with "let" are constant. Their type, however, is unaffected by this. It may be constant or not
    public isConst: boolean;
    public name: string;
    public type: Type;
    public loc: Location;
    public node: Node;
    public localReferenceCount: number = 0;
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
    /**
     * True, if the function returns a tuple and names have been assigned to all tuple elements.
     * In this case the function can exit with just "return", i.e. without specifying explicit return values.
     */
    public hasNamedReturnVariables: boolean;
    /**
     * If the function returns a tuple, this array holds one variable for each element of the array.
     * If the tuple elements have no name, one is automatically generated.
     */
    public namedReturnVariables: null | Array<Variable>;
    public unnamedReturnVariable: Variable | null;
    // The scope containing FunctionParameters and local Variables of the function.
    public scope: Scope;
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
    public localReferenceCount: number = 0;
    public isConst: boolean;
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

    public resetGroups() {
        if (this.elementGroups.size > 0) {
            this.elementGroups = new Map<ScopeElement, Group | null>();
        }
        if (this.unavailableGroups.size > 0) {
            this.unavailableGroups = new Set<Group>();
        }
        if (this.canonicalGroups.size > 0) {
            this.canonicalGroups = new Map<Group, Group>();
        }
    }

    public resolveGroup(element: ScopeElement): Group | null {
        if (this.elementGroups.has(element)) {
            return this.elementGroups.get(element);
        }
        if (this.parent) {
            let p = this.parent.resolveGroup(element);
            if (p) {
                return p;
            }
        }
        return null;
    }

    public setGroup(element: ScopeElement, group: Group | null) {
        this.elementGroups.set(element, group);
    }

    public makeGroupUnavailable(g: Group) {
        g = this.resolveCanonicalGroup(g);
        this.unavailableGroups.add(g);
    }

    public isGroupAvailable(g: Group): boolean {
        if (this.unavailableGroups.has(g)) {
            return false;
        }
        let s: Scope = this;
        while (s.parent) {
            if (s.unavailableGroups.has(g)) {
                return false;
            }
            s = s.parent;
        }
        let c = this.resolveCanonicalGroup(g);
        if (c != g) {
            if (this.unavailableGroups.has(c)) {
                return false;
            }
            let s: Scope = this;
            while (s.parent) {
                if (s.unavailableGroups.has(c)) {
                    return false;
                }
                s = s.parent;
            }
        }
        return true;
    }

    public resolveCanonicalGroup(g: Group): Group {
        if (this.canonicalGroups.has(g)) {
            return this.canonicalGroups.get(g);
        }
        if (this.parent) {
            let p = this.parent.resolveCanonicalGroup(g);
            if (p) {
                return p;
            }
        }
        return g;
    }

    public joinGroups(group1: Group | null, group2: Group | null, loc: Location, doThrow: boolean): Group {
        if (!group1) {
            if (!group2) {
                return new Group(GroupKind.Free);
            }
            return group2;
        }
        if (!group2) {
            return group1;
        }

        let b1 = this.resolveCanonicalGroup(group1);
        let b2 = this.resolveCanonicalGroup(group2);
        // No join necessary?
        if (b1 == b2) {
            return b1;
        }        

        b1 = b1.preJoin(this, loc, doThrow);
        b2 = b2.preJoin(this, loc, doThrow);

        if (b1 instanceof TupleGroup || b2 instanceof TupleGroup) {
            throw "Implementation error";
        }

        if ((b1.kind == GroupKind.Bound && b2.kind != GroupKind.Free) || (b2.kind == GroupKind.Bound && b1!.kind != GroupKind.Free)) {
            if (doThrow) {
                throw new TypeError("Groups cannot be unified", loc);
            }
            return null;
        }

        if (Group.isLess(b1, b2)) {
            let tmp = b1;
            b1 = b2;
            b2 = tmp;
        }

        if (!this.isGroupAvailable(b2)) {
            this.makeGroupUnavailable(b1);
        }
        this.canonicalGroups.set(b2, b1);
        return b1;
    }

    public mergeScopes(scope: Scope, mode: "conditional" | "subsequent" | "reverted_subsequent"): void {
        for(let g of scope.unavailableGroups) {
            this.unavailableGroups.add(g);
        }

        for(let g of scope.canonicalGroups.keys()) {
            let c1 = this.resolveCanonicalGroup(g);
            let c2 = scope.resolveCanonicalGroup(g);            
            if (g == c1) {
                this.canonicalGroups.set(g, c2);
            } else if (c1 != c2) {
                let newg = this.joinGroups(c1, c2, null, false);
                if (!newg) {
                    this.unavailableGroups.add(g);
                } else {
                    this.canonicalGroups.set(g, newg);
                }
            }
        }

        switch (mode) {
            case "subsequent":
            {
                for(let e of scope.elementGroups.keys()) {
                    let g1 = this.resolveGroup(e);
                    let g2 = scope.elementGroups.get(e);
                    // Does the "this" scope have a group for this element? If yes, then both have something -> merge
                    if (g1) {
                        g1 = this.resolveCanonicalGroup(g1);
                        // If the "scope" scope has a null group, the "this" scope gets a null group as well.
                        if (!g2) {
                            this.elementGroups.set(e, null);
                            continue;
                        }
                        g2 = scope.resolveCanonicalGroup(g2);
                        // Groups are different in the "this" scope and the "scope" scope? Then do nothing
                        if (g1 == g2) {
                            continue;
                        }
                        let newg = this.joinGroups(g1, g2, null, false);
                        if (!newg) {
                            this.elementGroups.set(e, null);
                        } else {
                            this.elementGroups.set(e, newg);
                        }
                    } else if (g2) {
                        // The "this" scope has no group, but the "scope" scope has a non-null group.
                        // If this is not conditional, the result is a non-null group.
                        // Otherwise we assume the worst and stick with the non-null group.
                        this.elementGroups.set(e, g2);
                    }
                }
                break;
            }
            case "conditional":
            {
                for(let e of scope.elementGroups.keys()) {
                    let g1 = this.resolveGroup(e);
                    let g2 = scope.elementGroups.get(e);
                    // Does the "this" scope have a group for this element? If yes, then both have something -> merge
                    if (g1) {
                        g1 = this.resolveCanonicalGroup(g1);
                        // If the "scope" scope has a null group, the "this" scope gets a null group as well.
                        if (!g2) {
                            this.elementGroups.set(e, null);
                            continue;
                        }
                        g2 = scope.resolveCanonicalGroup(g2);
                        // Groups are different in the "this" scope and the "scope" scope? Then do nothing
                        if (g1 == g2) {
                            continue;
                        }
                        let newg = this.joinGroups(g1, g2, null, false);
                        if (!newg) {
                            this.elementGroups.set(e, null);
                        } else {
                            this.elementGroups.set(e, newg);
                        }
                    }
                }
                break;
            }
            case "reverted_subsequent":
            {
                for(let e of scope.elementGroups.keys()) {
                    let g1 = this.elementGroups.get(e);
                    let g2 = scope.elementGroups.get(e);
                    // Does the "this" scope have a group for this element? If yes, then both have something -> merge
                    if (g1) {
                        continue;
                    } else if (g2) {
                        this.elementGroups.set(e, g2);
                    } else {
                        this.elementGroups.set(e, null);
                    }
                }        
            }
        }
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
    public canonicalGroups: Map<Group, Group> = new Map<Group, Group>();
    public unavailableGroups: Set<Group> = new Set<Group>();
    public elementGroups: Map<ScopeElement, Group | null> = new Map<ScopeElement, Group | null>();
    public parent: Scope | null = null;

    private static counter: number = 1;
}

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

    public abstract toTypeCodeString(): string;
}

/**
 * BasicType represents all built-in types.
 */
export class BasicType extends Type {
    constructor(name: "void" | "bool" | "float" | "double" | "null" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "rune" | "any" | "string") {
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

export enum GroupKind {
    Free = 0,
    Bound = 1,
}

export class Group {
    constructor(kind: GroupKind, name?: string) {
        this.kind = kind;
        if (name) {
            this.name = name;
        } else {
            this.name = "$unnamed" + Group.counter++;
        }
    }

    private static counter = 1;
    public kind: GroupKind;

    public name: string;

    public preJoin(scope: Scope, loc: Location, doThrow: boolean): Group {
        return this;
    }

    public static isLess(g1: Group, g2: Group) {
        if (g1.kind < g2.kind) {
            return true;
        }
        if (g1.kind == g2.kind && g1.counter < g2.counter) {
            return true;
        }
        return false;
    }

    public isBound(scope: Scope): boolean {
        let g = scope.resolveCanonicalGroup(this);
        return g.kind == GroupKind.Bound;
    }

    private counter: number = Group.groupCounter++;
    private static groupCounter = 0;
}

export class TupleGroup extends Group {
    constructor(kind: GroupKind, name?: string) {
        super(kind, name);
    }

    public preJoin(scope: Scope, loc: Location, doThrow: boolean): Group {
        let g: Group = null;
        for (let tg of this.groups) {
            g = g ? scope.joinGroups(g, tg, loc, doThrow) : tg;
        }
        return g;
    }

    public groups: Array<Group> = [];
}

export class Taint {
    constructor(group: Group, loc: Location) {
        this.loc = loc;
        this.group = group;
    }

    public loc: Location;
    public group: Group;
}

export type Restrictions = {
    isConst?: boolean;
}

export function combineRestrictions(r1: Restrictions, r2: Restrictions): Restrictions {
    if (!r1) {
        return r2;
    }
    if (!r2) {
        return r1;
    }
    return {
        isConst: r1.isConst || r2.isConst
    };
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

export class ScopeExit {
    public merge(s: ScopeExit) {
        if (!this.returns) {
            this.returns = s.returns;
        } else if (s.returns) {
            this.returns = this.returns.concat(s.returns);
        }
        if (!this.continues) {
            this.continues = s.continues;
        } else if (s.continues) {
            this.continues = this.continues.concat(s.continues);
        }
        if (!this.breaks) {
            this.breaks = s.breaks;
        } else if (s.breaks) {
            this.breaks = this.breaks.concat(s.breaks);
        }
    }
    
    public returns: Array<Scope>;
    public breaks: Array<Scope>;
    public continues: Array<Scope>;
    public fallthrough: Scope | null;
}

enum GroupCheckFlags {
    None = 0,
    AllowIsolates = 1,
    ForbidIsolates = 2,
    IsolatesMask = 3,
    NotIsolateMask = 255 - ForbidIsolates - AllowIsolates,
    NoSideEffects = 4,    
    AllowUnavailableVariable = 8,
    AllowUnavailableVariableMask = 255 - AllowUnavailableVariable,    
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
        this.t_int64 = new BasicType("int64");
        // TODO: Depends on arch
        this.t_int = this.t_int64;
        this.t_uint8 = new BasicType("uint8");
        this.t_byte = this.t_uint8;
        this.t_uint16 = new BasicType("uint16");
        this.t_uint32 = new BasicType("uint32");
        this.t_uint64 = new BasicType("uint64");
        // TODO: Depends on arch
        this.t_uint = this.t_uint64;
        this.t_any = new BasicType("any");
        this.t_string = new BasicType("string");
        this.t_void = new BasicType("void");
        this.t_rune = new BasicType("rune");
        
        this.t_error = new InterfaceType();
        this.t_error.name = "error";
        let toError = new FunctionType();
        toError.name = "toError";
        toError.returnType = this.t_string;
        toError.objectType = new RestrictedType(this.t_error, {isConst: true});
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

        this.globalGroup = new Group(GroupKind.Bound, "$global");
    }

    public createType(tnode: Node, scope: Scope, mode: "default" | "parameter" | "variable" | "parameter_toplevel" = "default"): Type {
        let t = this.createTypeIntern(tnode, scope, mode);
        if (tnode.groupName) {
            t.groupName = tnode.groupName.value;
        }
        return t;
    }

    private createTypeIntern(tnode: Node, scope: Scope, mode: "default" | "parameter" | "variable" | "parameter_toplevel" = "default"): Type {
        let originalMode = mode;
        if (mode == "parameter_toplevel") {
            mode = "parameter";
        }
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
            return new UnsafePointerType(t);
        } else if (tnode.op == "sliceType") {            
            let t = this.createType(tnode.rhs, scope, mode);
            let s = new SliceType(t as ArrayType | RestrictedType, "strong");
            if (tnode.value == "^[]") {
                s.mode = "unique";
            } else if (tnode.value == "~[]") {
                s.mode = "reference";
            } else if (tnode.value == "&[]") {
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
        } else if (tnode.op == "funcType" || tnode.op == "asyncFuncType") {
            let t = new FunctionType();
            if (tnode.op == "asyncFuncType") {
                t.callingConvention = "fyrCoroutine";
            }
            t.loc = tnode.loc;
//            let box = new Box(true)
            if (tnode.parameters) {
                for(let pnode of tnode.parameters) {
                    var p = new FunctionParameter();
                    if (pnode.op == "ellipsisParam") {
                        p.ellipsis = true;
                        pnode = pnode.lhs;
                    }
                    p.type = this.createType(pnode, scope, "parameter");
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
                t.returnType = this.t_void;
            }
            return t;
        } else if (tnode.op == "mapType") {
            let k = this.createType(tnode.lhs, scope, mode);
            let v = this.createType(tnode.rhs, scope, mode);
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
                    ft.objectType = this.makeConst(ft.objectType, mnode.loc);
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
            let obj = this.createType(fnode.lhs, parentScope, "parameter");
            let obj2 = RestrictedType.strip(obj);
            if (!(obj2 instanceof StructType) || obj2.name == "") {
                throw new TypeError(obj.toString() + " is not a named struct", fnode.lhs.loc);
            }
            structType = obj2;
            let mode: PointerMode = "reference";
            if ((fnode.lhs.flags & AstFlags.ReferenceObjectMember) == AstFlags.ReferenceObjectMember) {
                mode = "local_reference";
            }
            objectType = new PointerType(obj, mode);
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
            fnode.scope = f.scope;
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
                if (TypeChecker.isReference(p.type) || TypeChecker.isLocalReference(p.type) || this.isString(p.type)) {
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
            v.type = this.createType(vnode.rhs, scope, "variable");
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

        let scope = new Scope(null);
        scope.registerType("bool", this.t_bool);
        scope.registerType("float", this.t_float);
        scope.registerType("double", this.t_double);
        scope.registerType("null", this.t_null);
        scope.registerType("byte", this.t_byte);
        scope.registerType("int8", this.t_int8);
        scope.registerType("int16", this.t_int16);
        scope.registerType("int32", this.t_int32);
        scope.registerType("int64", this.t_int64);
        scope.registerType("int", this.t_int);
        scope.registerType("uint8", this.t_uint8);
        scope.registerType("uint16", this.t_uint16);
        scope.registerType("uint32", this.t_uint32);
        scope.registerType("uint64", this.t_uint64);
        scope.registerType("uint", this.t_uint);
        scope.registerType("string", this.t_string);
        scope.registerType("void", this.t_void);
        scope.registerType("error", this.t_error);
        scope.registerType("rune", this.t_rune);
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
                } else if (snode.op == "let") {
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
            // Unique global pointers are subject to their own group.
            // All other global variables belong to the same group.
            if (TypeChecker.isUnique(v.type)) {
                scope.setGroup(v, new Group(GroupKind.Free, v.name));                
            } else {
                scope.setGroup(v, this.globalGroup);
            }
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
            if (!(rtypeStripped instanceof ObjectLiteralType) && (!this.isMap(rtypeStripped) || this.isString(this.mapKeyType(rtypeStripped)))) {
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
//                                this.checkIsAssignableNode(this.t_json, rnode.parameters[j].lhs);
                            }
                            v.type = new PointerType(new MapType(this.t_string, valueType), "strong");
                            throw "TODO";
                        } else if (rtypeStripped instanceof TemplateStructType) {
                            v.type = rtype;
                        }
                    } else {
                        let lt = RestrictedType.strip(v.type);
                        if (rtypeStripped instanceof ObjectLiteralType) {
                            let rt: Type;
                            if (this.isMap(lt) && this.isString(this.mapKeyType(lt))) {
                                rt = this.mapValueType(lt);
                            } else {
                                throw new TypeError("Ellipsis identifier must be of map type", vnode.loc);
                            }
                            for(let j = i; j < rnode.parameters.length; j++) {
                                this.checkIsAssignableNode(rt, rnode.parameters[j].lhs, scope);
                            }
                        } else if (this.isMap(rtypeStripped)) {
                            if (!this.isMap(lt) || !this.isString(this.mapKeyType(lt))) {
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
                        throw "TODO: Find matching node in literal"
                    } else if (this.isMap(rtype)) {
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
                            this.checkIsAssignableNode(p.lhs.type.types[j-i], r, scope);
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
            if (!(rtypeStripped instanceof ObjectLiteralType) && (!this.isMap(rtype) || !this.isString(this.mapKeyType(rtype)))) {
                throw new TypeError("Expected an expression of type object literal or map[string]...", vnode.loc);
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
                        if (this.isMap(kv.lhs.type) && this.isString(this.mapKeyType(kv.lhs.type))) {
                            rt = this.mapValueType(kv.lhs.type);
                        } else {
                            throw new TypeError("Ellipsis identifier must be of map type or json", vnode.loc);
                        }
                        for(let j = i; j < rnode.parameters.length; j++) {
                            this.checkIsAssignableNode(rt, rnode.parameters[j].lhs, scope);
                        }
                    } else if (this.isMap(rtypeStripped)) {
                        if (!this.isMap(kv.lhs.type) || !this.isString(this.mapKeyType(kv.lhs.type))) {
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
                        throw "TODO: Find matching node in literal"
                    } else if (this.isMap(rtypeStripped)) {
                        rt = this.mapValueType(rtypeStripped);
                    }
                    this.checkAssignment(scope, p, rt, r);
                }
            }
        } else {
            this.checkExpression(vnode, scope);
            this.checkIsMutable(vnode, scope);
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
                    if (f.type.returnType != this.t_void && !f.hasNamedReturnVariables) {
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
                let s = new Scope(scope);
                snode.scope = s;
                if (snode.lhs) {
                    let initScopeExit = new ScopeExit();
                    initScopeExit.fallthrough = scope;
                    this.checkStatement(snode.lhs, s, initScopeExit);
                    if (initScopeExit.returns || initScopeExit.breaks || initScopeExit.continues) {
                        throw new TypeError("break, return and continue are not allowed inside the initialization statement of an if clause.", snode.loc);
                    }
                }
                this.checkExpression(snode.condition, s);
                this.checkIsAssignableType(this.t_bool, snode.condition.type, snode.condition.loc, "assign", true);
                snode.scopeExit = this.checkStatements(snode.statements, s);
                scopeExit.merge(snode.scopeExit);
                if (snode.elseBranch) {
                    let s2 = new Scope(scope);
                    snode.elseBranch.scope = s2;
                    snode.elseBranch.scopeExit = this.checkStatements(snode.elseBranch.statements, s2);
                    scopeExit.merge(snode.elseBranch.scopeExit);
                    if (!snode.scopeExit.fallthrough && !snode.elseBranch.scopeExit.fallthrough) {
                        scopeExit.fallthrough = null;
                    }
                }
                return;
            }
            case "else":
                throw "Implementation error";
            case "for":
                let forScope = new Scope(scope);
                snode.scope = forScope;
                forScope.forLoop = true;
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.lhs) {
                            let initScopeExit = new ScopeExit();
                            initScopeExit.fallthrough = scope;
                            this.checkStatement(snode.condition.lhs, forScope, initScopeExit);
                            if (initScopeExit.returns || initScopeExit.breaks || initScopeExit.continues) {
                                throw new TypeError("break, return and continue are not allowed inside the initialization statement of a for loop.", snode.loc);
                            }
                        }
                        if (snode.condition.condition) {
                            this.checkExpression(snode.condition.condition, forScope);
                            this.checkIsAssignableType(this.t_bool, snode.condition.condition.type, snode.condition.condition.loc, "assign", true);
                        }
                        if (snode.condition.rhs) {
                            let loopScopeExit = new ScopeExit();
                            loopScopeExit.fallthrough = scope;
                            this.checkStatement(snode.condition.rhs, forScope, loopScopeExit);
                            if (loopScopeExit.returns || loopScopeExit.breaks || loopScopeExit.continues) {
                                throw new TypeError("break, return and continue are not allowed inside the loop statement of a for loop.", snode.loc);
                            }
                        }
                    } else {
                        this.checkStatement(snode.condition, forScope, scopeExit);
                    }
                }
                snode.scopeExit = this.checkStatements(snode.statements, forScope);
                // TODO: Merge returns
                return;
            case "var":
            case "let":
                if (!snode.rhs) {
                    if (snode.op == "let") {
                        throw "Implementation error: let without initialization"
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
                        throw "TODO: Implementation error"
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
                        this.unifyLiterals(snode.lhs.type, snode.rhs, scope, snode.loc);
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
                        this.unifyLiterals(snode.lhs.type, snode.rhs, scope, snode.loc);
                    } else {
                        this.checkIsAssignableType(this.t_int, snode.rhs.type, snode.loc, "assign", true);
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
            case "let_in":
            {
                this.checkExpression(snode.rhs, scope);
                let [tindex1, tindex2] = this.checkIsEnumerable(snode.rhs);
                if (snode.lhs.op == "tuple") {
                    if (snode.lhs.parameters[0].value != "_") {
                        let v1 = this.createVar(snode.lhs.parameters[0], scope, false, snode.op == "let_in");
                        if (v1.type) {
                            this.checkIsAssignableType(v1.type, tindex1, snode.loc, "assign", true);
                        } else {
                            v1.type = tindex1
                        }
                    }
                    if (snode.lhs.parameters[1].value != "_") {
                        let v2 = this.createVar(snode.lhs.parameters[1], scope, false, snode.op == "let_in");
                        if (v2.type) {
                            this.checkIsAssignableType(v2.type, tindex2, snode.loc, "assign", true);
                        } else {
                            v2.type = tindex2;
                        }
                    }
                } else {
                    let v = this.createVar(snode.lhs, scope, false, snode.op == "let_in");
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
                    throw new TypeError("yield is only allowed in async functions", snode.loc);
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
        return;
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
                if (this.stripType(enode.type) instanceof InterfaceType) {
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
                    enode.type = new PointerType(enode.rhs.type, "local_reference");
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
                        this.unifyLiterals(enode.rhs.type, enode.lhs, scope, enode.loc);
                    } else if (enode.rhs.op == "int" || enode.rhs.op == "float") {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, scope, enode.loc);
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
                        this.unifyLiterals(this.t_uint, enode.lhs, scope, enode.loc);
                        this.checkIsUnsignedNumber(enode.rhs);
                    } else {
                        this.unifyLiterals(enode.rhs.type, enode.lhs, scope, enode.loc);
                    }
                } else if (enode.rhs.op == "int") {
                    if (enode.op == "<<" || enode.op == ">>") {
                        this.unifyLiterals(this.t_uint, enode.rhs, scope, enode.loc);
                    } else {
                        this.unifyLiterals(enode.lhs.type, enode.rhs, scope, enode.loc);
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
                    this.unifyLiterals(enode.rhs.type, enode.lhs, scope, enode.loc);
                } else if  (enode.rhs.op == "int" || enode.rhs.op == "float" || enode.rhs.op == "str" || enode.rhs.op == "null") {
                    this.unifyLiterals(enode.lhs.type, enode.rhs, scope, enode.loc);
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
                    enode.type = new SliceType(t, "local_reference");
                } else if (t instanceof UnsafePointerType) {
                    enode.type = new SliceType(enode.lhs.type as (ArrayType | RestrictedType), "local_reference");
                    if (isConst) {
                        enode.type = this.applyConst(enode.type, enode.loc);
                    }
                } else if (this.isMap(t)) {
                    throw new TypeError("Ranges are not supported on maps", enode.loc);
                } else if (t instanceof SliceType) {
                    let isTakeExpr = TypeChecker.isTakeExpression(enode.lhs);
                    if ((t.mode == "unique" || t.mode == "strong") && !isTakeExpr) {
                        enode.type = new SliceType(t.arrayType, "reference");
                    } else {
                        // For slices the type remains the same
                        enode.type = enode.lhs.type;
                    }
                } else {
                    throw "Implementation error";
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
                } else if (this.isMap(t)) {
                    isConst = isConst || this.isConst((t as PointerType).elementType);
                    if (enode.rhs.isUnifyableLiteral()) {
                        this.unifyLiterals(this.mapKeyType(t), enode.rhs, scope, enode.rhs.loc);
                    } else {
                        this.checkIsAssignableType(this.mapKeyType(t), enode.rhs.type, enode.rhs.loc, "assign", true);
                    }
                    enode.type = this.mapValueType(t);
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
            {
                let types: Array<Type> = [];
                for(let p of enode.parameters) {
                    this.checkExpression(p, scope);
                    types.push(p.type);
                }
                let t = new TupleLiteralType(types);
                enode.type = t;
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope, "variable");
                    this.unifyLiterals(ct, enode, scope, enode.loc);
                }
                break;
            }
            case "array":
            {
                let types: Array<Type> = [];
                if (enode.parameters) {
                    for(let p of enode.parameters) {
                        this.checkExpression(p, scope);
                        types.push(p.type);
                    }
                }
                let t = new ArrayLiteralType(types);
                enode.type = t;
                if (enode.lhs) {
                    let ct = this.createType(enode.lhs, scope, "variable");
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
                    let ct = this.createType(enode.lhs, scope, "variable");
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
                switch(enode.lhs.op) {
                    case "id":
                    case "[":
                    case ".":
                        break;
                    default:
                        throw new TypeError("take() can only be applied on variables, object fields or slice/array elements", enode.lhs.loc);
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
                this.checkIsAssignableNode(v.type, v.node.rhs, scope);
            }
            /*
            if (this.isSafePointer(v.node.rhs.type) || this.isSlice(v.node.rhs.type)) {
                if (v.node.rhs.op != "id" && v.node.rhs.op != "take" && v.node.rhs.op != "array" && v.node.rhs.op != "object") {
                    throw new TypeError("Right hand side of assignment must be wrapped in take()", v.node.rhs.loc);
                }
            }
            */
            this.checkGroupsInSingleAssignment(v.type, scope.resolveGroup(v), null, v.node.rhs, false, scope, v.loc);
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
        } else if (node.type instanceof TupleLiteralType) {
            let types: Array<Type> = [];
            for(let pnode of node.parameters) {
                this.defaultLiteralType(pnode);
                types.push(pnode.type);
            }            
            node.type = new TupleType(types);
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
        }
        return node.type;
    }

    private unifyLiterals(t: Type, node: Node, scope: Scope, loc: Location, doThrow: boolean = true, templateParams: Map<string, Type> = null, allowPointerIndirection: boolean = true): boolean {
        if (templateParams && t instanceof GenericParameter && templateParams.has(t.name)) {
            t = templateParams.get(t.name);
        }

        if (this.isOrType(t)) {
            let orType = this.stripType(t) as OrType;
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

        if (this.isAny(t)) {
            node.type = this.defaultLiteralType(node);
            return true;
        }

        if (allowPointerIndirection && this.isSafePointer(t) && node.op == "object") {
            if (!this.unifyLiterals(this.pointerElementType(t), node, scope, loc, doThrow, templateParams, false)) {
                return false;
            }
            node.type = t;
            return true;
        }

        if (allowPointerIndirection && this.isSlice(t) && node.op == "array" && t.name != "string") {
            if (!this.unifyLiterals(this.sliceArrayType(t), node, scope, loc, doThrow, templateParams, false)) {
                return false;
            }
            node.type = t;
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
                t = this.stripType(t);
                // TODO: Check range
                if (t == this.t_float || t == this.t_double || t == this.t_int8 || t == this.t_int16 || t == this.t_int32 || t == this.t_int64 || t == this.t_uint8 || t == this.t_uint16 || t == this.t_uint32 || t == this.t_uint64) {
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
                t = this.stripType(t);
                // TODO: Check range
                if (t == this.t_float || t == this.t_double) {
                    return true;
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between floating point number and " + t.toString(), loc);                
            case "str":
                node.type = t;
                if (this.isString(t)) {
                    return true;
                } else if (this.isStringLiteralType(t)) {
                    if (t.name == node.value) {
                        return true;
                    }
                }
                if (!doThrow) {
                    return false;
                }
                throw new TypeError("Type mismatch between string and " + t.toString(), loc);   
            case "array":
                if (this.isArray(t)) {
                    let arrayType = this.stripType(t) as ArrayType;
                    if (arrayType.size != -1) {
                        if (arrayType.size == 0 && (!node.parameters || node.parameters.length == 0)) {
                            // Ok
                        } else if (!node.parameters || node.parameters.length != arrayType.size) {
                            throw new TypeError("Mismatch in array size", node.loc);                                                
                        }
                    }
                    if (node.parameters) {
                        let elementType = this.arrayElementType(t);
                        for(let pnode of node.parameters) {
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
            case "tuple":
                if (this.isTupleType(t)) {
                    let tupleType = this.stripType(t) as TupleType;
                    if (node.parameters.length != tupleType.types.length) {
                        throw new TypeError("Mismatch in tuple length", node.loc);                                                
                    }
                    for(let i = 0; i < node.parameters.length; i++) {
                        let pnode = node.parameters[i];
                        if (!this.checkIsAssignableNode(tupleType.types[i], pnode, scope, doThrow)) {
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
                if (this.isMap(t)) {
                    let mapType = this.stripType(t) as MapType;
                    let valueType = this.mapValueType(t);
                    let keyType = this.mapKeyType(t);
                    if (!node.parameters || node.parameters.length == 0) {
                        // Empty map
                        node.type = t;
                    } else if (this.isString(keyType)) {
                        // A map, e.g. "{foo: 42}"
                        for(let pnode of node.parameters) {
                            if (!this.checkIsAssignableNode(valueType, pnode.lhs, scope, doThrow)) {
                                return false;
                            }
                        }
                    }
                    node.type = t;
                    return true;
                } else if (this.isStruct(t)) {
                    let structType = this.stripType(t) as StructType;
                    // A struct initialization
                    if (node.parameters) {
                        for(let pnode of node.parameters) {
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
                    let r = this.unifyLiterals(t, node.rhs, scope, loc, doThrow, templateParams);
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
    public checkIsAssignableNode(to: Type, from: Node, scope: Scope, doThrow: boolean = true, templateParams: Map<string, Type> = null): boolean {
        if (from.isUnifyableLiteral()) {
            return this.unifyLiterals(to, from, scope, from.loc, doThrow, templateParams);
        }
        return this.checkIsAssignableType(to, from.type, from.loc, "assign", doThrow, null, null, templateParams);
    }

    // TODO: Remove unbox
    // Checks whether the type 'from' can be assigned to the type 'to'.
    public checkIsAssignableType(to: Type, from: Type, loc: Location, mode: "assign" | "equal" | "pointer", doThrow: boolean = true, toRestrictions: Restrictions = null, fromRestrictions: Restrictions = null, templateParams: Map<string, Type> = null): boolean {
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
                (to.mode == "local_reference" ||
                (to.mode == "reference" && (from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "strong" && from.mode == "unique") ||
                (to.mode == "unique" && from.mode == "strong")))) {
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
                (to.mode == "local_reference" ||
                (to.mode == "reference" && (from.mode == "strong" || from.mode == "unique")) ||
                (to.mode == "strong" && from.mode == "unique") ||
                (to.mode == "unique" && from.mode == "strong")))) {
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
                result.set(n, this.t_void);
            }
        }

        return result;
    }

    public checkIsEnumerable(node: Node): [Type, Type] {
        let t = this.stripType(node.type);
        if (this.isMap(t)) {
            return [this.mapKeyType(t), this.mapValueType(t)];
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

    private isLeftHandSide(node: Node, scope: Scope, _allowConstVariable: boolean = false): boolean {
        if (node.op == "id") {
            if (!_allowConstVariable) {
                let e = scope.resolveElement(node.value);
                if (!e) {
                    throw "Implementation error";
                }
                if ((e instanceof Variable && e.isConst) || (e instanceof FunctionParameter && e.isConst)) {
                    return false;
                }
            }
            return true;
        } else if (node.op == "unary*") {
            return true;
        } else if (node.op == ".") {
            if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType) {
                return true;
            }
            return this.isLeftHandSide(node.lhs, scope, true);
        } else if (node.op == "[") {
            if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof SliceType) {
                return true;
            }
            return this.isLeftHandSide(node.lhs, scope, true);
        }
        return false;
    }

    public checkIsMutable(node: Node, scope: Scope) {
        if (node.type instanceof RestrictedType && node.type.isConst) {
            throw new TypeError("The expression is not mutable because it is const", node.loc);
        }

        if (!this.isLeftHandSide(node, scope)) {
            throw new TypeError("The expression is not mutable because it is an intermediate value or the variable is not mutable", node.loc);
        }
    }

    private checkVariableType(t: Type, loc: Location) {
        if (RestrictedType.strip(t) instanceof InterfaceType) {
            throw new TypeError("Interface types must be used together with a pointer", loc);
        }
        if (RestrictedType.strip(t) instanceof MapType) {
            throw new TypeError("Map types must be used together with a pointer", loc);
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
            return t.elementType == this.t_string;
        }
        return t == this.t_string;
    }
    
    public isTupleType(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType instanceof OrType;
        }
        return t instanceof TupleType;
    }

    public isStringLiteralType(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType instanceof OrType;
        }
        return t instanceof StringLiteralType;
    }

    public isAny(t: Type): boolean {
        if (t instanceof RestrictedType) {
            return t.elementType instanceof OrType;
        }
        return t == this.t_any;
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
        t = this.stripType(t);
        if (!(t instanceof PointerType)) {
            return false;
        }
        t = this.stripType(t.elementType);
        return t instanceof InterfaceType;
    }

    private isMap(t: Type): boolean {
        t = this.stripType(t);
        if (!(t instanceof PointerType)) {
            return false;
        }
        t = this.stripType(t.elementType);
        return t instanceof MapType;
    }

    private mapKeyType(t: Type): Type {
        t = this.stripType(t);
        if (!(t instanceof PointerType)) {
            throw "Internal error";
        }
        t = this.stripType(t.elementType);
        if (!(t instanceof MapType)) {
            throw "Internal error";
        }
        return t.keyType;
    }

    private mapValueType(t: Type): Type {
        t = this.stripType(t);
        if (!(t instanceof PointerType)) {
            throw "Internal error";
        }
        t = this.stripType(t.elementType);
        if (!(t instanceof MapType)) {
            throw "Internal error";
        }
        return t.valueType;
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

    public static isStrong(t: Type): boolean {
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

    public static isUnique(t: Type): boolean {
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

    public static isReference(t: Type): boolean {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        if (t instanceof PointerType && t.mode == "reference") {
            return true;
        }
        if (t instanceof SliceType && t.mode == "reference") {
            return true;
        }
        return false;
    }

    public static isLocalReference(t: Type): boolean {
        if (t instanceof RestrictedType) {
            t = t.elementType;
        }
        if (t instanceof PointerType && t.mode == "local_reference") {
            return true;
        }
        if (t instanceof SliceType && t.mode == "local_reference") {
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
            let r: RestrictedType;
            if (t instanceof RestrictedType) {
                r = t;
                t = t.elementType;
            }
            t = new PointerType(this.makeConst((t as PointerType).elementType, loc), (t as PointerType).mode);
            if (r) {
                t =  new RestrictedType(t, r);
            }
        } else if (this.isSlice(t)) {
            let r: RestrictedType;
            if (t instanceof RestrictedType) {
                r = t;
                t = t.elementType;
            }
            t = new SliceType(this.makeConst((t as SliceType).arrayType, loc) as ArrayType | RestrictedType, (t as SliceType).mode);
            if (r) {
                t =  new RestrictedType(t, r);
            }
        }
        return this.makeConst(t, loc);
    }

    public makeConst(t: Type, loc: Location): Type {
        if (t instanceof RestrictedType) {
            if (t.isConst) {
                return t;
            }
            return new RestrictedType(t.elementType, {isConst: true});
        }
//        if (this.isPrimitive(t)) {
//            return t;
//        }
        return new RestrictedType(t, {isConst: true});
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

    private getBuiltinFunction(t: Type, name: string, loc: Location): FunctionType | null {
        let type = this.stripType(t);
        if (type == this.t_string) {
            if (name == "len") {
                return this.builtin_len;
            } else if (name == "cap") {
                return this.builtin_cap;
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
        } else if (this.isMap(type)) {
            if (name == "remove") {
                let ft = new FunctionType()
                ft.name = "remove";
                ft.callingConvention = "system";
                ft.objectType = type;
                let p = new FunctionParameter();
                p.name = "key";
                p.type = this.mapKeyType(type);
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

    private checkGroupsInFunction(f: Function) {
        if (!f.node.statements) {
            return;
        }
        
        let groups = f.type.createGroups();
        for(let pt of f.type.parameters) {
            let g = groups.get(pt.name);
            if (!g) {
                throw "Implementation error";
            }
            f.scope.setGroup(pt, g);
        }

        if (f.type.objectType) {
            let th = f.scope.resolveElement("this");
            if (!th) {
                throw "Implementation error";
            }
            let g = groups.get("this");
            if (!g) {
                throw "Implementation error";
            }
            f.scope.setGroup(th, g);
        }

        if (f.namedReturnVariables) {
            for (let i = 0; i < f.namedReturnVariables.length; i++) {
                let r = f.namedReturnVariables[i];
                let g = groups.get("return " + i.toString());
                if (!g) {
                    throw "Implementation error";
                }
                f.scope.setGroup(r, g);                    
            }
        } else if (f.unnamedReturnVariable) {
            let g = groups.get("return");
            if (!g) {
                throw "Implementation error";
            }
            f.scope.setGroup(f.unnamedReturnVariable, g);
        }

        for(let snode of f.node.statements) {
            this.checkGroupsInStatement(snode, f.scope);
        }
    }
    
    private checkGroupsInStatement(snode: Node, scope: Scope): void {
        switch (snode.op) {
            case "comment":
            case "yield":
                break;
            case "let_in":
            case "var_in":
            case "var":
            case "let":
                if (snode.rhs) {
                    this.checkGroupsInAssignment(snode, scope);
                }
                break;
            case "in":
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
                    throw "Implementation error";
                }
                if (snode.lhs) {
                    if (f.namedReturnVariables) {
                        for(let i = 0; i < f.namedReturnVariables.length; i++) {
                            let group = scope.resolveGroup(f.namedReturnVariables[i]);
                            if (TypeChecker.isUnique(f.namedReturnVariables[i].type)) {
                                group = null;
                            }
                            this.checkGroupsInSingleAssignment(f.namedReturnVariables[i].type, group, null, snode.lhs.parameters[i], false, scope, snode.loc);
                        }
                    } else {
                        if (!f.unnamedReturnVariable) {
                            throw "Implementation error";
                        }
                        let group = scope.resolveGroup(f.unnamedReturnVariable);
                        if (TypeChecker.isUnique(f.unnamedReturnVariable.type)) {
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
            case "if":
                snode.scope.resetGroups();
                if (snode.lhs) {
                    this.checkGroupsInStatement(snode.lhs, snode.scope);
                }
                this.checkExpression(snode.condition, snode.scope);
                for(let st of snode.statements) {
                    this.checkGroupsInStatement(st, snode.scope);
                }
                if (snode.scopeExit.breaks) {
                    for (let c of snode.scopeExit.breaks) {
                        c.mergeScopes(scope, "reverted_subsequent");
                    }                    
                }
                if (snode.scopeExit.continues) {
                    for (let c of snode.scopeExit.continues) {
                        c.mergeScopes(scope, "reverted_subsequent");
                    }                    
                }
                if (snode.elseBranch) {
                    snode.elseBranch.scope.resetGroups();
                    for(let st of snode.elseBranch.statements) {
                        this.checkGroupsInStatement(st, snode.elseBranch.scope);
                    }
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
                snode.scope.resetGroups();
                if (snode.condition) {
                    if (snode.condition.op == ";;") {
                        if (snode.condition.lhs) {
                            this.checkGroupsInStatement(snode.condition.lhs, snode.scope);
                        }
                        if (snode.condition.condition) {
                            this.checkGroupsInExpression(snode.condition.condition, snode.scope, GroupCheckFlags.None);
                        }
                        if (snode.condition.rhs) {
                            this.checkGroupsInStatement(snode.condition.rhs, snode.scope);
                        }
                    } else {
                        this.checkGroupsInStatement(snode.condition, snode.scope);
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
                // This does either fail (-> TypeError) or le
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
                /*
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
            */
            default:
                this.checkGroupsInExpression(snode, scope, GroupCheckFlags.None);
        }

//        return null;
    }

    private checkGroupsInAssignment(snode: Node, scope: Scope) {
        if (snode.lhs.op == "id") {
            this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
        } else if (snode.lhs.op == "tuple") {
            let t = this.stripType(snode.rhs.type);
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
            if (this.isUnsafePointer(snode.lhs.lhs.type)) {
                return;
            }
            if (this.isSafePointer(snode.lhs.lhs.type) || this.isStruct(snode.lhs.lhs.type)) {
                this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
            } else {
                throw "Implementation error";
            }
        } else if (snode.lhs.op == "[") {
            this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
        } else if (snode.lhs.op == "unary*") {
            this.checkGroupsInSingleAssignment(snode.lhs.type, snode.lhs, null, snode.rhs, false, scope, snode.loc);
        } else {
            throw "Implementation error";
        }
    }

    private checkGroupsInSingleAssignment(ltype: Type, lnode: Node | Group, rightGroup: Group, rnode: Node, rnodeReuse: boolean, scope: Scope, loc: Location) {
        if (!rnode) {
            throw "Implementation error";
        }
        if (!rightGroup) {
            // let isPointer = !this.isPureValue(rnode.type);
            let flags = TypeChecker.hasReferenceOrStrongPointers(rnode.type) ? GroupCheckFlags.ForbidIsolates : GroupCheckFlags.AllowIsolates;
            rightGroup = this.checkGroupsInExpression(rnode, scope, flags);
        }
        let leftGroup = lnode instanceof Node ? this.checkGroupsInExpression(lnode, scope, GroupCheckFlags.AllowIsolates | GroupCheckFlags.AllowUnavailableVariable) : lnode as Group;

        let lhsIsVariable = lnode instanceof Node ? lnode.op == "id" : false;
        let lhsVariable: ScopeElement = null;
        if (lhsIsVariable) {
            lhsVariable = scope.resolveElement((lnode as Node).value);
        }

        // Assigning a value type? -> Nothing to do
        if (this.isPureValue(ltype)) {
            if (lhsVariable) {
                scope.setGroup(lhsVariable, new Group(GroupKind.Free, lhsVariable.name));
            }
            return;
        }

        let rhsVariableName: string;
        let rhsIsVariable: boolean = false;
        if (rnode.op == "id" || (rnode.op == "take" && rnode.lhs.op == "id")) {
            rhsIsVariable = true;
            rhsVariableName = rnode.op == "id" ? rnode.value : rnode.lhs.value;
        } else if (rnode.op == ":" && (TypeChecker.isUnique(rnode.type) || TypeChecker.isStrong(rnode.type))) {
            let r = rnode;
            while (r.op == ":" || r.op == "take") {
                r = r.lhs;
            }
            if (r.op == "id") {
                rhsIsVariable = true;
                rhsVariableName = r.value;
            }
        }
        let rhsIsTakeExpr = TypeChecker.isTakeExpression(rnode);
        // The right hand side is an expression that evaluates to an isolate, and therefore the group is null
        if (!rightGroup) {
            // The isolate must be taken, even when assigned to a reference
            if (!rhsIsVariable && !rhsIsTakeExpr) {
                throw new TypeError("Assignment of an expression that evaluates to an isolate is only allowed via a variable or take expression", loc);
            }
            if (TypeChecker.hasReferenceOrStrongPointers(rnode.type)) {
                // Accessing a strong pointer or reference inside an isolate is not allowed.
                throw "Implementation error";
            }
            rightGroup = new Group(GroupKind.Free);
        }

        if (TypeChecker.hasStrongOrUniquePointers(ltype)) {
            if (rhsIsVariable) {
                // Make the RHS variable unavailable
                if (!rnodeReuse) {
                    let rhsVariable = scope.resolveElement(rhsVariableName);
                    scope.setGroup(rhsVariable, null);
                }
                rnode.flags |= AstFlags.ZeroAfterAssignment;
            } else if (rhsIsTakeExpr) {
                // Nothing special todo
            } else {
                throw new TypeError("Assignment to an owning pointer is only allowed from a variable or take expression", loc);
            }
        }

        if (TypeChecker.isUnique(ltype)) {
            // Check that the RHS group is unbound, because the RHS is not neccessarily an isolate
            if (rightGroup.isBound(scope)) {
                throw new TypeError("Assignment of a bound group to an isolate is not allowed", loc);
            }
        }

        // The if-clause is true when assigning to a variable that is not global.
        // The purpose of ignoring global is that setGroup should not be executed on a global variable.
        if (lhsIsVariable && (!(lhsVariable instanceof Variable) || !lhsVariable.isGlobal)) {
            // Set the group of the LHS variable with the RHS group
            scope.setGroup(lhsVariable, rightGroup);
        } else {
            if (!leftGroup) {
                // Check that the RHS group is unbound
                if (rightGroup.isBound(scope)) {
                    throw new TypeError("Assignment of a bound group to an isolate is not allowed", loc);
                }
                // Make the RHS group unavailable
                scope.makeGroupUnavailable(rightGroup);
            } else {
                // Test whether LHS and RHS are equal or one of LHS or RHS are unbound
                // if (leftGroup != rightGroup && leftGroup.isBound && rightGroup.isBound) {
                //    throw new TypeError("Two distinct bound groups cannot be merged", loc);
                //}
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
                    throw "Implementation error";
                }
                let g = scope.resolveGroup(element);
                if (!g || !scope.isGroupAvailable(g)) {
                    if ((origFlags & GroupCheckFlags.AllowUnavailableVariable) == 0) {
                        throw new TypeError("Variable " + element.name + " is not available in this place", enode.loc);
                    }
//                    console.log(element.name + " is not available, but do not care");
                }                
                // Accessing a global isolate is like an expression that evaluates to an isolate. Therefore its Group is null
                if (element instanceof Variable && element.isGlobal && TypeChecker.isUnique(element.type)) {
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
                if (TypeChecker.isUnique(enode.rhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0) {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                return this.checkGroupsInExpression(enode.rhs, scope, flags | GroupCheckFlags.ForbidIsolates);
            }
            case "unary*":
            {
                if (TypeChecker.isUnique(enode.rhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0) {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                let g = this.checkGroupsInExpression(enode.rhs, scope, flags);
                if (TypeChecker.isUnique(enode.type)) {
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
                let type: Type = this.stripType(enode.lhs.type);
                if (type instanceof PackageType) {
                    break;
                }
                if (TypeChecker.isUnique(enode.lhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0 && enode.lhs.op != "id" && enode.lhs.op != "(") {
                    throw new TypeError("Accessing a member in an isolate is not allowed in this place", enode.loc);
                }
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags);
                if (TypeChecker.isUnique(enode.type)) {
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
                if (TypeChecker.isUnique(enode.lhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0 && enode.lhs.op != "id" && enode.lhs.op != "(") {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                return g;
            }            
            case "[":
            {
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags);
                this.checkGroupsInExpression(enode.rhs, scope, (flags | GroupCheckFlags.NoSideEffects) & GroupCheckFlags.NotIsolateMask);
                if (TypeChecker.isUnique(enode.lhs.type) && (flags & GroupCheckFlags.ForbidIsolates) != 0 && enode.lhs.op != "id" && enode.lhs.op != "(") {
                    throw new TypeError("Accessing a member in an isolate is not allowed", enode.loc);
                }
                if (TypeChecker.isUnique(enode.type)) {
                    return null;
                }
                return g;
            }
            case "(":
            {
                let g = this.checkGroupsInExpression(enode.lhs, scope, flags | GroupCheckFlags.ForbidIsolates);
//                if (!g) {
//                    throw "Implementation error";                    
//                }
                // When calling a non-member function, the default group is determined by the first parameter.
                if (enode.lhs.op == "id") {
                    g = null;
                }
                let t = this.stripType(enode.lhs.type);
                if (!(t instanceof FunctionType)) {
                    throw "Implementation error";
                }
                return this.checkGroupsInFunctionArguments(t, g, enode.parameters, scope, enode.loc);
            }
            /*
            case "genericInstance":
                this.checkExpression(enode.lhs, scope);
                // enode.type = this.createType(enode, scope);
                enode.type = this.instantiateTemplateFunctionFromNode(enode, scope).type;
                break;
                */
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
                if (this.isSlice(enode.type)) {
                    t = this.sliceArrayType(t);
                }
                let elementType = this.arrayElementType(t);
                let group: Group = null;
                if (enode.parameters) {
                    for(let p of enode.parameters) {
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
                if (this.isSafePointer(enode.type)) {
                    t = this.pointerElementType(t);
                }
                t = this.stripType(t);
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
                    throw "TODO";
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
                this.checkGroupsInExpression(enode.rhs, scope, flags);
                break;
            }            
            case "take":
                if ((flags & GroupCheckFlags.NoSideEffects) != 0) {
                    throw new TypeError("Expression with side effects is not allowed in this place", enode.loc);
                }
                return this.checkGroupsInExpression(enode.lhs, scope, flags);
            default:
                throw "Implementation error " + enode.op;
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
                if (TypeChecker.isUnique(ltype)) {
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
        if (!ft.returnType || ft.returnType == this.t_void) {
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
                if (TypeChecker.isUnique(t)) {
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
        if (groups.has(name) && !TypeChecker.isUnique(ft.returnType)) {
            return groups.get(name);
        }
        let kind = GroupKind.Free;
        if (TypeChecker.hasReferenceOrStrongPointers(ft.returnType)) {
            kind = GroupKind.Bound;
        }
        return new Group(kind, "return");
    }

    // Returns true ff the expression yields ownership of the object it is pointing to.
    // Call the function only on expressions of pointer type or expressions that can be assigned to a pointer type
    public static isTakeExpression(enode: Node): boolean {
        if (enode.op == "take" || enode.op == "(" || enode.op == "array" || enode.op == "object" || enode.op == "tuple" || enode.op == "null" || (enode.op == ":" && (TypeChecker.isStrong(enode.type) || TypeChecker.isUnique(enode.type)))) {
            return true;
        }
        return false;
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
    
    private stringLiteralTypes: Map<string, StringLiteralType> = new Map<string, StringLiteralType>();

    private globalGroup: Group;
}

export class TypeError {
    constructor(message: string, loc: Location) {
        this.message = message;
        this.location = loc;
    }

    public message: string;
    public location: Location;
}