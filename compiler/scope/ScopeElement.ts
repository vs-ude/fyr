import { Type } from '../types'
import { Location } from '../parser'

// ScopeElement is implemented by Variable and Function, FunctionParameter.
// A Scope contains ScopeElements.
export interface ScopeElement {
    name: string
    type: Type
    loc: Location
}
