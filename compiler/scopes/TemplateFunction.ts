import { TemplateType } from '../types'
import { Node, Location } from '../ast'

import { ScopeElement } from './'

/**
 * TemplateFunctions are registered in a scope.
 * They represent a TemplateType which yields a TemplateFunctionType when instantiated.
 * Unlike normal Function objects, TemplateFunctions are not fully parsed and type checked.
 * This happens only upon instantiation.
 */
export class TemplateFunction implements ScopeElement {
    public node: Node
    public name: string
    public type: TemplateType
    public namedReturnTypes: boolean
    public loc: Location;
    public importFromModule: string
    public isExported: boolean
    // If the TemplateFunction represents a method of a template struct,
    // this is the corresponding struct template.
    public owner?: TemplateType
}
