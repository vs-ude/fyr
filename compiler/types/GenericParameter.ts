import { ImplementationError } from '../errors';
import { Type } from './Type'

// TODO: Rename generic
export class GenericParameter extends Type {
    public toTypeCodeString(): string {
        throw new ImplementationError()
    }
}
