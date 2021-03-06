import { Type } from './Type'

export class TupleType extends Type {
    constructor(types: Array<Type>) {
        super()
        this.types = types
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        let name = "("
        for(let t of this.types) {
            if (name == "(") {
                name += t.toString()
            } else {
                name += "," + t.toString()
            }
        }
        name += ")"
        return name
    }

    public toTypeCodeString(): string {
        let name = "("
        for(let t of this.types) {
            if (name == "(") {
                name += t.toString()
            } else {
                name += "," + t.toString()
            }
        }
        name += ")"
        return name
    }

    public types: Array<Type>
}

