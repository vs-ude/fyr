import { Package } from '../pkg'
import { Location } from '../ast'
import { ImplementationError } from '../errors'

import { Type } from './Type'

export class PackageType extends Type {
    constructor(name: string, pkg: Package, loc: Location) {
        super()
        this.name = name
        this.loc = loc
        this.pkg = pkg
    }

    public toString(): string {
        return "package " + this.name
    }

    public toTypeCodeString(): string {
        throw new ImplementationError()
    }

    public pkg: Package
}
