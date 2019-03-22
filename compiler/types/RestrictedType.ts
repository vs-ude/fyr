import { Restrictions } from '../group'
import { ImplementationError } from '../errors';

import { Type } from './Type'

// Implements restrictions
export class RestrictedType extends Type {
    constructor(elementType: Type, r: Restrictions | null = null) {
        super()
        this.elementType = elementType
        if (r) {
            this.isConst = r.isConst
        } else {
            this.isConst = false
        }
    }

    public static strip(t: Type): Type {
        if (t instanceof RestrictedType) {
            return t.elementType
        }
        return t
    }

    public toString(omitElement?: boolean): string {
        if (!this.elementType) {
            throw new ImplementationError('elementType not set')
        }
        if (this.name) {
            return this.name
        }
        let str = ""
        if (this.isConst && this.elementType.name != "string") {
            str += "const "
        }
        if (omitElement) {
            return str
        }
        return str + this.elementType.toString()
    }

    public toTypeCodeString(): string {
        if (!this.elementType) {
            throw new ImplementationError('elementType not set')
        }
        let str = ""
        if (this.isConst) {
            str += "const "
        }
        return str + this.elementType.toString()
    }

    public elementType: Type
    public isConst?: boolean
}
