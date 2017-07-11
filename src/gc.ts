import * as ssa from "./ssa"
import * as wasm from "./wasm"

export class TypeMapper {
    constructor(module: wasm.Module) {
        this.module = module;
    }

    public mapType(t: ssa.Type | ssa.StructType): TypeMap | null {
        if (t != "ptr" && !(t instanceof ssa.StructType)) {
            return null;
        }
        if (this.mappings.has(t)) {
            return this.mappings.get(t);
        }

        let m = new TypeMap();
        this.mapTypeIntern(m, t, 0); 
        if (m.offsets.length == 0) {
            this.mappings.set(t, null);
            return null;
        }
        this.mappings.set(t, m);
        m.declare(this.module);
        return m;
    }

    private mapTypeIntern(m: TypeMap, t: ssa.Type | ssa.StructType, offset: number): TypeMap | null {
        if (t == "ptr") {
            m.offsets.push(offset);
            return m;
        }
        if (!(t instanceof ssa.StructType)) {
            return null;
        }

        for(let f of t.fields) {
            let foffset = t.fieldOffset(f[0]);
            let ftype: ssa.Type | ssa.StructType = f[1];
            let fcount: number = f[2];
            if (ftype != "ptr" && !(ftype instanceof ssa.StructType)) {
                continue;
            }
            if (fcount == 0) {
                continue;
            }
            if (fcount == 1) {
                if (ftype == "ptr") {
                    m.offsets.push(offset + foffset);
                } else {
                    this.mapTypeIntern(m, ftype, offset + foffset);
                }
            } else {
                m.offsets.push(-fcount);
                if (ftype == "ptr") {
                    m.offsets.push(offset + foffset);
                } else if (this.hasPointer(ftype)) {
                    m.offsets.push(this.mapType(ftype));
                }
            }
        }
        this.mappings.set(t, m);
        return m;
    }

    private hasPointer(s: ssa.StructType): boolean {
        for(let f of s.fields) {
            let ftype: ssa.Type | ssa.StructType = f[1];
            if (ftype == "ptr") {
                return true;
            } else if (ftype instanceof ssa.StructType) {
                if (this.hasPointer(ftype)) {
                    return true;
                }
            }
        }
        return false;
    }

    public addToModule(module: wasm.Module) {
        for(var m of this.mappings.values()) {
            if (m != null) {
                m.define();
            }
        }
    }

    private module: wasm.Module;
    private mappings: Map<ssa.Type | ssa.StructType, TypeMap> = new Map<ssa.Type | ssa.StructType, TypeMap>(); 
}

export class TypeMap {

    public declare(module: wasm.Module) {
        this.module = module;
        this.addr = module.addGlobalStruct(4 + this.offsets.length * 4);
    }

    public define() {
        let arr = new ArrayBuffer(4 + this.offsets.length * 4);
        let a32 = new Int32Array(arr);
        a32[0] = this.offsets.length;
        for(let i = 0; i < this.offsets.length; i++) {
            let o = this.offsets[i];
            if (o instanceof TypeMap) {
                a32[1 + i] = -o.addr;
            } else {
                a32[1 + i] = o;
            }
        }
        this.module.defineGlobalStruct(this.addr, new Uint8Array(arr));
    }

    public offsets: Array<number | TypeMap> = [];
    public addr: number;
    public module: wasm.Module;
}

export class StackMap {

}
