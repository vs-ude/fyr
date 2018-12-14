import { Type } from './Type'

export class MapType extends Type {
    constructor(keyType: Type, valueType: Type) {
        super()
        this.keyType = keyType
        this.valueType = valueType
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        return "map[" + this.keyType.toString() + "]" + this.valueType.toString()
    }

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name
        }
        return "map[" + this.keyType.toTypeCodeString() + "]" + this.valueType.toTypeCodeString()
    }

    public keyType: Type
    public valueType: Type
}
