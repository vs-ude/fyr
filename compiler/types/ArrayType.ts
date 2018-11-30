import { Type } from './Type'

export class ArrayType extends Type {
    constructor(elementType: Type, size: number) {
        super();
        this.elementType = elementType;
        this.size = size;
    }

    public getElementType(): Type {
        return this.elementType;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        if (this.size === null) {
            return "[...]" + this.elementType.toString();    
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString();
    }

    public toTypeCodeString(): string {
        if (this.size === null) {
            return "[...]" + this.elementType.toString();
        }
        return "[" + this.size.toString() + "]" + this.elementType.toString();
    }

    public elementType: Type;
    public size: number;
}

// ArrayLiteralTypes are created while parsing and are then unified.
// They are gone after type checking.
export class ArrayLiteralType extends Type {
    constructor(types: Array<Type>) {
        super();
        this.types = types;        
    }

    public toString() : string {
        let name = "literal[";
        for(let t of this.types) {
            if (name == "literal[") {
                name += t.toString();
            } else {
                name += "," + t.toString();
            }
        }
        name += "]";
        return name;
    }

    public toTypeCodeString(): string {
        throw "Implemention error";
    }

    public types: Array<Type>;
}