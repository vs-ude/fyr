import { Type } from './Type'

// ObjectLiteralTypes are created while parsing and are then unified.
// They are gone after type checking.
export class ObjectLiteralType extends Type {
    constructor(types: Map<string, Type>) {
        super()
        this.types = types;        
    }

    public toTypeCodeString(): string {
        throw "Implemention error"
    }

    public toString() : string {
        let name = "literal{"
        for(let t of this.types.keys()) {
            if (name == "literal{") {
                name += t + ": " + this.types.get(t).toString()
            } else {
                name += "," + t + ": " + this.types.get(t).toString()
            }
        }
        name += "}"
        return name
    }

    public types: Map<string, Type>
}