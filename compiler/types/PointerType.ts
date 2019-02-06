import { Type } from './Type'
import { MapType } from './MapType'
import { RestrictedType } from './RestrictedType'

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
        let op
        if (RestrictedType.strip(this.elementType) instanceof MapType) {
            if (this.mode == "local_reference") {
                op = "&"
            } else if (this.mode == "reference") {
                op = "~"
            } else if (this.mode == "unique") {
                op = "^"
            } else if (this.mode == "strong") {
                op = ""
            } else {
                throw "Implementation error"
            }
        } else {
            if (this.mode == "local_reference") {
                op = "&"
            } else if (this.mode == "reference") {
                op = "~"
            } else if (this.mode == "unique") {
                op = "^"
            } else if (this.mode == "strong") {
                op = "*"
            } else {
                throw "Implementation error"
            }
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
        let op
        if (RestrictedType.strip(this.elementType) instanceof MapType) {
            if (this.mode == "local_reference") {
                op = "&"
            } else if (this.mode == "reference") {
                op = "~"
            } else if (this.mode == "unique") {
                op = "^"
            } else if (this.mode == "strong") {
                op = ""
            } else {
                throw "Implementation error"
            }
        } else {
            if (this.mode == "local_reference") {
                op = "&"
            } else if (this.mode == "reference") {
                op = "~"
            } else if (this.mode == "unique") {
                op = "^"
            } else if (this.mode == "strong") {
                op = "*"
            } else {
                throw "Implementation error"
            }
        }
        return op + this.elementType.toTypeCodeString()
    }

    public elementType: Type
    /**
     * Determines whether the pointer is an owning pointer, a reference, or a unique pointer.
     */
    public mode: PointerMode
}
