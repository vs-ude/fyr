import { Type, FunctionType } from '../types'
import { Node, Location } from '../ast'

import { Scope, ScopeElement, Variable } from './'

// Function is a named function inside a scope.
export class Function implements ScopeElement {
    constructor() {
        this.scope = new Scope(null)
        this.scope.func = this
    }

    public get isNative(): boolean {
        return this.nativePackageName !== undefined
    }

    public name: string
    public type: FunctionType
    /**
     * True, if the function returns a tuple and names have been assigned to all tuple elements.
     * In this case the function can exit with just "return", i.e. without specifying explicit return values.
     */
    public hasNamedReturnVariables: boolean
    /**
     * If the function returns a tuple, this array holds one variable for each element of the array.
     * If the tuple elements have no name, one is automatically generated.
     */
    public namedReturnVariables: null | Array<Variable>
    public unnamedReturnVariable: Variable | null
    // The scope containing FunctionParameters and local Variables of the function.
    public scope: Scope
    // Node that defined the function
    public node: Node
    // Location where the function has been defined.
    public loc: Location
    public nativePackageName: string | undefined
    public isExported: boolean
    public isTemplateInstance: boolean
}

// FunctionParameter is the parameter of a function inside a function's body.
export class FunctionParameter implements ScopeElement {
    public name: string
    public ellipsis: boolean
    public type: Type
    public loc: Location
    public isConst: boolean
    public isReferenced: boolean
}