import { Package } from '../pkg'
import { PackageType } from '../types'
import { Location } from '../ast'

import { ScopeElement } from './'

// A packages imported into a scope.
export class ImportedPackage implements ScopeElement {
    constructor(name: string, pkg: Package, loc: Location) {
        this.name = name
        this.loc = loc
        this.pkg = pkg
        this.type = new PackageType(name, pkg, loc)
    }

    // Name of the package as used in this scope.
    public name: string
    // An instance of PackageType
    public type: PackageType
    // Location of the import
    public loc: Location
    // The imported package
    public pkg: Package
}
