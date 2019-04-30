import { Node } from '../parser'
import { TemplateFunction, Scope } from '../scope'
import { Package } from '../pkg'
import { ImplementationError } from '../errors';

import { Type } from './Type'

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
        throw new ImplementationError("Typecode of template type is not allowed")
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

    /**
     * Optional ASTs of template parameters constraints, e.g. in "func<A is int|float, B>()",
     * these are constraints are "int|float" and "null".
     */
    public templateParameterTypes: Array<Node | null>
    /**
     * Names of the template parameters, e.g. in "func<A,B>(a A, b B)" these are [A.B]
     */
    public templateParameterNames: Array<string>
    // The AST of the template
    public node: Node
    public parentScope: Scope
    public registerScope: Scope
    public methods: Array<TemplateFunction> = []
    public pkg: Package
}
