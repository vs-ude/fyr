import { Location } from "../parser"

/**
 * Type is the base class for all types.
 */
export abstract class Type {
    public name: string
    public loc: Location
    public groupName: string

    public toString(): string {
        return this.name
    }

    public get isImported(): boolean {
        return this.importFromModule !== undefined
    }

    public abstract toTypeCodeString(): string

    public importFromModule: string
}
