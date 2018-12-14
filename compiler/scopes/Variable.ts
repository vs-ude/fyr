import { Type } from '../types'
import { Node, Location } from '../ast'

import { ScopeElement } from './ScopeElement'

// Variable is a global or function-local variable.
export class Variable implements ScopeElement {
    public get isNative(): boolean {
        return this.nativePackageName !== undefined
    }

    // Variable is the named return variable of a function, e.g. "count" or "error" in "func foo() (count int, err error) { }"
    public isResult: boolean = false
    public isGlobal: boolean
    // Variables declared with "let" are constant. Their type, however, is unaffected by this. It may be constant or not
    public isConst: boolean
    // Variables initialized with "let x = ...not-null..." are statically known to be not null.
    public isNotNull: boolean
    // A variable is referenced with "&v". During code generation we can make some assumptions about when
    // the value of a variable might change. When a variable is referenced, this is harder to do.
    public isReferenced: boolean
    // A variable is referenced with "&v". It can be casted to a reference or strong pointer.
    // In this case the stack must provide extra space for the (unnecessary) reference counters.
    public isReferencedWithRefcounting: boolean
    /**
     * For cases like 'for(let x in list)' x is in reality just a pointer inside the array/slice/map.
     * However, for the user is feels like the variable is a value and not a pointer inside the array/slice/map.
     */
    public isForLoopPointer: boolean
    public name: string
    public type: Type
    public loc: Location
    public node: Node
    public nativePackageName: string | undefined
}
