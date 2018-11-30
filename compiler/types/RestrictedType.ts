import { Restrictions } from '../typecheck'

import { Type } from './Type'

// Implements restrictions
export class RestrictedType extends Type {
    constructor(elementType: Type, r: Restrictions | null = null) {
        super();
        this.elementType = elementType;
        if (r) {
            this.isConst = r.isConst;
        } else {
            this.isConst = false;
        }
    }

    public static strip(t: Type): Type {
        if (t instanceof RestrictedType) {
            return t.elementType;
        }
        return t;
    }

    public toString(omitElement?: boolean): string {
        if (this.name) {
            return this.name;
        }
        if (this.elementType.name == "string") {
            return "string";
        }
        let str = "";
        if (this.isConst && this.elementType.name != "string") {
            str += "const ";
        }
        if (omitElement) {
            return str;
        }
        return str + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        let str = "";
        if (this.isConst) {
            str += "const ";
        }
        return str + this.elementType.toString();
    }
    
    public elementType: Type;
    public isConst?: boolean;
}