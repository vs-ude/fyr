import { Package } from '../pkg'
import { Type } from './Type'
import { FunctionType } from './FunctionType'
import { InterfaceType } from './InterfaceType'
import { StructField } from './StructType'

export class ComponentType extends Type {
    constructor() {
        super()
    }

    public field(name: string, ownFieldsOnly: boolean = false): StructField {
        for(let f of this.fields) {
            if (f.name == name) {
                return f
            }
        }
//        if (!ownFieldsOnly && this.extends && this.extends instanceof StructType) {
//            return this.extends.field(name)
//        }
        return null
    }

    public method(name: string): FunctionType {
        if (this.methods.has(name)) {
            return this.methods.get(name)
        }
//        if (this.extends && this.extends instanceof StructType) {
//            return this.extends.method(name)
//        }
        return null
    }

    public toString(): string {
        return "component " + this.name + "." + this.pkg.pkgPath + ";";
    }

    public toTypeCodeString(): string {
        return "component " + this.name + "." + this.pkg.pkgPath + ";";
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

    /*
    public getAllBaseTypes(base?: Array<Type>): Array<Type> {
        if (base && base.indexOf(this) != -1) {
            return base
        }
        if (this.extends) {
            if (!base) {
                base = [this.extends]
            } else {
                base.push(this.extends)
            }
            if (this.extends instanceof StructType) {
                base = this.extends.getAllBaseTypes(base)
            }
        }
        return base
    } */

/*    public doesExtend(parent: Type): boolean {
        if (this.extends == parent) {
            return true
       } else if (this.extends && (this.extends instanceof StructType)) {
            return this.extends.doesExtend(parent)
        }
        return false
    } */

    /**
     * Package the type has been defined in.
     */
    public pkg: Package
    public implements: Array<InterfaceType> = []
    /**
     * Fields of the component, ordered by their appearance in the code
     */
    public fields: Array<StructField> = []
    /**
     * Member methods indexed by their name
     */
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>()
}
