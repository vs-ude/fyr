import { Type } from './Type'
import { PointerMode } from './PointerType'
import { ArrayType } from './ArrayType'
import { RestrictedType } from './RestrictedType'
import { ImplementationError } from '../errors';

export class SliceType extends Type {
    constructor(arrayType: ArrayType | RestrictedType, mode: PointerMode) {
        super()
        if (arrayType instanceof RestrictedType && !(RestrictedType.strip(arrayType) instanceof ArrayType)) {
            throw new ImplementationError('slice of a non-array')
        }
        this.arrayType = arrayType
        this.mode = mode
    }

    public array(): ArrayType {
        if (this.arrayType instanceof ArrayType) {
            return this.arrayType
        }
        return this.arrayType.elementType as ArrayType
    }

    public getElementType(): Type {
        if (this.arrayType instanceof ArrayType) {
            return this.arrayType.elementType
        }
        return (this.arrayType.elementType as ArrayType).elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        let mode = ""
        if (this.mode == "local_reference") {
            mode = "&"
        } else if (this.mode == "reference") {
            mode = "~"
        } else if (this.mode == "unique") {
            mode = "^"
        }
        return mode + "[]" + this.array().elementType.toString()
    }

    public toTypeCodeString(): string {
        return this.mode.toString() + "[]" + this.array().elementType.toString()
    }

    public mode: PointerMode
    // If the size of the underlying array is -1, then its size is dynamic
    public arrayType: ArrayType | RestrictedType
}
