import { Type } from './Type'

export class ArrayType extends Type {
    constructor(elementType: Type, size: number) {
        super()
        this.elementType = elementType
        this.size = size
    }

    public getElementType(): Type {
        return this.elementType
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        if (this.size === null) {
            return "[...]" + this.elementType.toString();
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString()
    }

    public toTypeCodeString(): string {
        if (this.size === null) {
            return "[...]" + this.elementType.toString()
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString()
    }

    public elementType: Type
    public size: number
}
