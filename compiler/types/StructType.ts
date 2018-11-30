import { Package } from '../pkg'
import { Type } from './Type'
import { FunctionType } from './FunctionType'
import { InterfaceType } from './InterfaceType'

export class StructType extends Type {
    constructor() {
        super()
    }

    public field(name: string, ownFieldsOnly: boolean = false): StructField {
        for(let f of this.fields) {
            if (f.name == name) {
                return f
            }
        }
        if (!ownFieldsOnly && this.extends) {
            return this.extends.field(name)
        }
        return null
    }

    public method(name: string): FunctionType {
        if (this.methods.has(name)) {
            return this.methods.get(name)
        }
        if (this.extends) {
            return this.extends.method(name)
        }
        return null
    }

    public toString(): string {
        if (this.name) {
            return this.name
        }
        let str = "struct{"
        str += this.fields.join(",")
        str += "}"
        return str
    }

    public toTypeCodeString(): string {
        if (this.name) {
            return this.name
        }
        let str = "struct{"
        str += this.fields.map(function (f: StructField): string { return f.toTypeCodeString(); }).join(",")
        str += "}"
        return str
    }

    public getAllMethodsAndFields(map?: Map<string, FunctionType | StructField>): Map<string, FunctionType | StructField> {
        if (!map) {
            map = new Map<string, FunctionType | StructField>()
        }
        for(let key of this.methods.keys()) {
            map.set(key, this.methods.get(key))
        }
        for(let f of this.fields) {
            map.set(f.name, f)
        }
        return map
    }

    public getAllBaseTypes(base?: Array<StructType>): Array<StructType> {
        if (base && base.indexOf(this) != -1) {
            return base
        }
        if (this.extends) {
            if (!base) {
                base = [this.extends]
            } else {
                base.push(this.extends)
            }
            base = this.extends.getAllBaseTypes(base)
        }
        return base
    }

    public doesExtend(parent: StructType): boolean {
        if (this.extends == parent) {
            return true
        } else if (this.extends) {
            return this.doesExtend(parent)
        }
        return false
    }

    // Package the type has been defined in.
    public pkg: Package
    public extends: StructType
    public implements: Array<InterfaceType> = []
    // Fields of the struct, ordered by their appearance in the code
    public fields: Array<StructField> = []
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>()
    /**
     * An opaque struct cannot be instantiated, because the compiler does not know the size and layout of the struct.
     * Opaque structs can therefore only be handled via pointers.
     */
    public opaque: boolean
    /**
     * A native struct is for example provided by a C-library.
     * In this case, the compiler will use the native struct definition (as defined by some C-include) instead of generating
     * a defintion for the struct.
     */
    public native: boolean

    public _markChecked: boolean
}

// StructField describes the field of a StructType.
export class StructField {
    public toString(): string {
        if (!this.name) {
            return this.type.toString()
        }
        return this.name + " " + this.type.toString()
    }

    public toTypeCodeString(): string {
        if (!this.name) {
            return this.type.toTypeCodeString()
        }
        return this.name
    }

    public name: string
    public type: Type
}