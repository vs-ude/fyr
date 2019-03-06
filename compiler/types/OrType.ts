import { isPureValue } from '../typecheck/helper'

import { Type } from './Type'
import { StringLiteralType } from './StringLiteralType'

export class OrType extends Type {
    constructor(types?: Array<Type>) {
        super()
        if (types) {
            this.types = types
        } else {
            this.types = []
        }
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        let name = ""
        for(let v of this.types) {
            if (name == "") {
                name += v.toString()
            } else {
                name += " | " + v.toString()
            }
        }
        return name
    }

    // TODO: Scoping
    public toTypeCodeString(): string {
        return this.toString()
    }

    public stringsOnly(): boolean {
        for(let t of this.types) {
            if (!(t instanceof StringLiteralType)) {
                return false
            }
        }
        return true
    }

    public isPureValue(): boolean {
        for(let t of this.types) {
            if (!isPureValue(t)) {
                return false
            }
        }
        return true
    }

    public types: Array<Type>
}
