import { Type } from './Type'

/**
 * BasicType represents all built-in types.
 */
export class BasicType extends Type {
    constructor(name: "void" | "bool" | "float" | "double" | "null" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "rune" | "any" | "string" | "int" | "uint" | "byte" | "char") {
        super()
        this.name = name
    }

    public toTypeCodeString(): string {
        return this.name
    }
}
