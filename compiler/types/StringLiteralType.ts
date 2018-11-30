import { Type } from './Type'

export class StringLiteralType extends Type {
    constructor(name: string) {
        super();
        this.name = name;
    }

    public toString(): string {
        return "\"" + this.name + "\"";
    }

    public toTypeCodeString(): string {
        return this.toString();
    }
}