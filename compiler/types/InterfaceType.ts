import { Package } from '../pkg'
import { Type } from './Type'
import { FunctionType } from './FunctionType'

export class InterfaceType extends Type {
    public getAllMethods(map?: Map<string, FunctionType>): Map<string, FunctionType> {
        if (!map) {
            map = new Map<string, FunctionType>();
        }
        for(let key of this.methods.keys()) {
            map.set(key, this.methods.get(key));
        }
        for(let b of this.extendsInterfaces) {
            if (!(b instanceof InterfaceType)) {
                continue;
            }
            b.getAllMethods(map);
        }
        return map;
    }

    public getAllBaseTypes(base?: Array<InterfaceType>): Array<InterfaceType> {
        if (base && base.indexOf(this) != -1) {
            return base;
        }
        for(let b of this.extendsInterfaces) {
            if (!(b instanceof InterfaceType)) {
                continue;
            }
            if (!base) {
                base = [b];
            } else {
                base.push(b);
            }
            base = b.getAllBaseTypes(base);
        }
        return base;
    }

    public hasBaseType(b: InterfaceType): boolean {
        for(let i of this.extendsInterfaces) {
            if (i == b) {
                return true;
            }
            if (i.hasBaseType(b)) {
                return true;
            }
        }
        return false;
    }

    public toString(): string {
        if (this.name) {
            return this.name;
        }
        if (this.extendsInterfaces.length > 0 || this.methods.size > 0) {
            return "interface{...}";
        }
        return "interface{}";
    }

    // TODO: Scoping
    // TODO: Unnamned interfaces
    public toTypeCodeString(): string {
        if (this.name) {
            return this.name;
        }
        throw "TODO"
    }

    public method(name: string): FunctionType {
        if (this.methods.has(name)) {
            return this.methods.get(name);
        }
        for(let iface of this.extendsInterfaces) {
            if (iface instanceof InterfaceType) {
                let m = iface.method(name);
                if (m) {
                    return m;
                }
            }
        }
        return null;
    }

    public methodIndex(name: string): number {
        this.sortMethodNames();
        let index = this.sortedMethodNames.indexOf(name);
        if (index == -1) {
            throw "Implementation error " + name;
        }
        return index;
    }

    public sortMethodNames(): Array<string> {
        if (this.sortedMethodNames.length != 0) {
            return this.sortedMethodNames;
        }
        for(let i = 0; i < this.extendsInterfaces.length; i++) {
            let iface = this.extendsInterfaces[i];
            if (iface instanceof InterfaceType) {
                iface.sortMethodNames();
            }
            this.sortedMethodNames = this.sortedMethodNames.concat(iface.sortedMethodNames);
        }

        if (this.sortedMethodNames.length == 0) {
            this.sortedMethodNames.push("__dtr__");
        }
        let names: Array<string> = [];
        for(let name of this.methods.keys()) {
            names.push(name);
        }
        names.sort();
        this.sortedMethodNames = this.sortedMethodNames.concat(names);
        return this.sortedMethodNames;
    }

    // Package the type has been defined in.
    // For global types sich as "int" the package is undefined.
    public pkg?: Package;
    public extendsInterfaces: Array<InterfaceType> = [];
    // Member methods indexed by their name
    public methods: Map<string, FunctionType> = new Map<string, FunctionType>();
    private sortedMethodNames: Array<string> = [];

    // Required during recursive checking
    public _markChecked: boolean = false;
}