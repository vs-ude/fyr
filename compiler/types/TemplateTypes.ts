import { Node } from '../ast'
import { TemplateFunction, Scope } from '../scopes'
import { Package } from '../pkg'

import { Type } from './Type'
import { FunctionType } from './FunctionType'
import { InterfaceType } from './InterfaceType'
import { StructType } from './StructType'

/**
 * TemplateType can either be a template function or a template struct.
 * Template types have template parameters which are type-wildcards with optional constraints.
 * The template type can be instantiated to become a TemplateFunctionType or a TemplateStructType
 * by binding concrete types to these type-wildcards.
 */
export class TemplateType extends Type {
    constructor() {
        super()
        this.templateParameterTypes = []
        this.templateParameterNames = []
    }

    public toTypeCodeString(): string {
        throw "Implementation error: Typecode of template type is not allowed"
    }

    public toString(): string {
        let g = "<"
        let lst = []
        for(let i = 0; i < this.templateParameterNames.length; i++) {
            let s = this.templateParameterNames[i];            
            if (this.templateParameterTypes[i]) {
                s += " is " + this.templateParameterTypes[i].toString()
            }
            lst.push(s)
        }
        g += lst.join(",")
        g += ">"
        if (this.name) {
            return this.name + g
        }
        return "template" + g
    }

    // Optional ASTs of template parameters constraints, e.g. in "func<A is int|float, B>()",
    // these are constraints are "int|float" and "null".
    public templateParameterTypes: Array<Node | null>
    // Names of the template parameters, e.g. in "func<A,B>(a A, b B)" these are [A.B]
    public templateParameterNames: Array<string>
    // The AST of the template
    public node: Node
    public parentScope: Scope
    public registerScope: Scope
    public methods: Array<TemplateFunction> = []
    public pkg: Package
}

/**
 * TemplateFunctionType is the instance of a TemplateType.
 */
export class TemplateFunctionType extends FunctionType {
    constructor() {
        super()
        this.templateParameterTypes = []
    }

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name
            }
            return this.name
        }
        let name = "<"
        for(let i = 0; i < this.templateParameterTypes.length; i++) {
            if (i != 0) {
                name += ","
            }
            name += this.templateParameterTypes[i]
            if (this.templateParameterTypes[i]) {
                name += " is " + this.templateParameterTypes[i].toString()
            }
        }
        name += ">("
        let j = 0
        for(let p of this.parameters) {
            if (j != 0) {
                name += ","
            }
            if (p.ellipsis) {
                name += "..."
            }
            name += p.type.toString()
            j++
        }
        name += ") => " + this.returnType.toString()
        return name
    }

    public templateParameterTypes: Array<Type>
    public base: TemplateType
}

/**
 * TemplateStructType is the instance of a TemplateType.
 */
export class TemplateStructType extends StructType {
    constructor() {
        super()
        this.templateParameterTypes = []
    }

    public toString(): string {
        let g = "<"
        let lst = []
        for(let s of this.templateParameterTypes) {
            lst.push(s.toString())
        }
        g += lst.join(",")
        g += ">"
        if (this.name) {
            return this.name + g
        }
        let str = "struct" + g + "{"
        str += this.fields.join(",")
        str += "}"
        return str
    }

    public templateParameterTypes: Array<Type>
    public base: TemplateType
}

/**
 * TemplateInterfaceType is the instance of a TemplateType.
 */
export class TemplateInterfaceType extends InterfaceType {
    constructor() {
        super()
        this.templateParameterTypes = []
    }

    public toString(): string {
        let g = "<"
        let lst = []
        for(let s of this.templateParameterTypes) {
            lst.push(s.toString())
        }
        g += lst.join(",")
        g += ">"
        if (this.name) {
            return this.name + g
        }
        let str = "interface" + g + "{"
        let m: Array<string> = []
        for(let mt of this.methods.values()) {
            m.push(mt.toString())
        }
        str += m.join(";")
        str += "}"
        return str
    }

    public templateParameterTypes: Array<Type>
    public base: TemplateType
}