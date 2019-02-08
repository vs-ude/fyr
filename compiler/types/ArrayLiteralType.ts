import { Type } from './Type'

// ArrayLiteralTypes are created while parsing and are then unified.
// They are gone after type checking.
export class ArrayLiteralType extends Type {
    constructor(types: Array<Type>) {
        super()
        this.types = types;
    }

    public toString() : string {
        let name = "literal["
        for(let t of this.types) {
            if (name == "literal[") {
                name += t.toString()
            } else {
                name += "," + t.toString()
            }
        }
        name += "]"
        return name
    }

    public toTypeCodeString(): string {
        throw "Implemention error"
    }

    public types: Array<Type>
}
