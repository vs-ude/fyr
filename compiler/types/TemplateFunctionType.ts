import { Type } from './Type'
import { FunctionType } from './FunctionType'
import { TemplateType } from './TemplateType'

/**
 * TemplateFunctionType is the instance of a TemplateType.
 */
export class TemplateFunctionType extends FunctionType {
    constructor() {
        super()
        this.templateParameterTypes = []
    }

    public toString(): string {
        if (this.name) {
            if (this.objectType) {
                return this.objectType.toString() + "." + this.name
            }
            return this.name
        }
        let name = "<"
        for(let i = 0; i < this.templateParameterTypes.length; i++) {
            if (i != 0) {
                name += ","
            }
            name += this.templateParameterTypes[i]
            if (this.templateParameterTypes[i]) {
                name += " is " + this.templateParameterTypes[i].toString()
            }
        }
        name += ">("
        let j = 0
        for(let p of this.parameters) {
            if (j != 0) {
                name += ","
            }
            if (p.ellipsis) {
                name += "..."
            }
            name += p.type.toString()
            j++
        }
        name += ") => " + this.returnType.toString()
        return name
    }

    public templateParameterTypes: Array<Type>
    public base: TemplateType
}
