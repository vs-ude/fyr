import { Type } from './Type'
import { StructType } from './StructType'
import { TemplateType } from './TemplateType'

/**
 * TemplateStructType is the instance of a TemplateType.
 */
export class TemplateStructType extends StructType {
    constructor() {
        super()
        this.templateParameterTypes = []
    }

    public toString(): string {
        let g = "<"
        let lst = []
        for(let s of this.templateParameterTypes) {
            lst.push(s.toString())
        }
        g += lst.join(",")
        g += ">"
        if (this.name) {
            return this.name + g
        }
        let str = "struct" + g + "{"
        str += this.fields.join(",")
        str += "}"
        return str
    }

    public templateParameterTypes: Array<Type>
    public base: TemplateType
}
