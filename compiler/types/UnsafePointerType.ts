import { Type } from './Type'

export class UnsafePointerType extends Type {
    constructor(elementType: Type) {
        super()
        this.elementType = elementType
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        return "#" + this.elementType.toString()
    }

    public toTypeCodeString(): string {
        return "#" + this.elementType.toTypeCodeString()
    }

    public elementType: Type
}
