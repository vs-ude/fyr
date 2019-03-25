import { Type } from './Type'
import { MapType } from './MapType'
import { RestrictedType } from './RestrictedType'
import { ImplementationError } from '../errors'

/**
 * ^ptr is unique. In this case only one pointer to an object exists and the pointer owns the data.
 * If more exist then the compiler knows them all.
 * 
 * *ptr is strong. The data is owned by this pointer.
 * 
 * ~ptr is reference. That pointer becomes null if nobody owns the data any more.
 * 
 * &ptr is a local reference. This is pointer that is only valid during lifetime of a function call.
 * It is impossible to derive a strong, unique or reference pointer from a local reference.
 * The object being pointed to can live on the stack or on the heap.
 */
export type PointerMode = "unique" | "strong" | "reference" | "local_reference"

export class PointerType extends Type {
    constructor(elementType: Type, mode: PointerMode) {
        super()
        this.elementType = elementType
        this.mode = mode
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        let op = ''
        if (this.mode == "local_reference") {
            op = "&"
        } else if (this.mode == "reference") {
            op = "~"
        } else if (this.mode == "unique") {
            op = "^"
        } else if (this.mode == "strong") {
            if (!(RestrictedType.strip(this.elementType) instanceof MapType)) {
                op = "*"
            }
        } else {
            throw new ImplementationError()
        }
        if (this.elementType instanceof RestrictedType) {
            return this.elementType.toString(true) + op + this.elementType.elementType.toString()
        }
        return op + this.elementType.toString()
    }

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name
        }
        let op = ''
        if (this.mode == "local_reference") {
            op = "&"
        } else if (this.mode == "reference") {
            op = "~"
        } else if (this.mode == "unique") {
            op = "^"
        } else if (this.mode == "strong") {
            if (!(RestrictedType.strip(this.elementType) instanceof MapType)) {
                op = "*"
            }
        } else {
            throw new ImplementationError()
        }
        return op + this.elementType.toTypeCodeString()
    }

    public elementType: Type
    /**
     * Determines whether the pointer is an owning pointer, a reference, or a unique pointer.
     */
    public mode: PointerMode
}
