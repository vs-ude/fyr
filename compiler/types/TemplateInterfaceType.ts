import { Type } from './Type'
import { InterfaceType } from './InterfaceType'
import { TemplateType } from './TemplateType'

/**
 * TemplateInterfaceType is the instance of a TemplateType.
 */
export class TemplateInterfaceType extends InterfaceType {
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
        let str = "interface" + g + "{"
        let m: Array<string> = []
        for(let mt of this.methods.values()) {
            m.push(mt.toString())
        }
        str += m.join(";")
        str += "}"
        return str
    }

    public templateParameterTypes: Array<Type>
    public base: TemplateType
}
