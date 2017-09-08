import * as ssa from "./ssa"
import * as wasm from "./wasm"

export class TypeMapper {
    constructor(module: wasm.Module) {
        this.module = module;
        this.globalMapping = new TypeMap();
    }

    public mapStack(stackMap: TypeMap, t: ssa.Type | ssa.StructType, offset: number) {
        this.mapTypeIntern(stackMap, t, offset);
    }

    public mapGlobal(offset: number, t: ssa.Type | ssa.StructType): TypeMap {
        this.mapTypeIntern(this.globalMapping, t, offset);
        return this.globalMapping;
    }

    public mapType(t: ssa.Type | ssa.StructType): TypeMap | null {
        if (t != "ptr" && !(t instanceof ssa.StructType)) {
            return null;
        }
        if (this.mappings.has(t)) {
            return this.mappings.get(t);
        }

        let m = new TypeMap();
        m.typeSize = ssa.sizeOf(t)
        this.mapTypeIntern(m, t, 0); 
        if (m.offsets.length == 0) {
            this.mappings.set(t, null);
            return null;
        }
        this.mappings.set(t, m);
        m.declare(this.module);
        return m;
    }

    private mapTypeIntern(m: TypeMap, t: ssa.Type | ssa.StructType, offset: number): void {
        if (t == "ptr") {
            m.offsets.push(offset);
            return;
        }
        if (!(t instanceof ssa.StructType)) {
            return;
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
                    m.offsets.push(offset + foffset);
                }
            }
        }
//        this.mappings.set(t, m);
        return;
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
        this.globalMapping.define();
        for(var m of this.mappings.values()) {
            if (m != null) {
                m.define();
            }
        }
    }

    private module: wasm.Module;
    private mappings: Map<ssa.Type | ssa.StructType, TypeMap> = new Map<ssa.Type | ssa.StructType, TypeMap>();
    public globalMapping: TypeMap; 
}

/**
 * A typemap is a list of 32-bit signed integers.
 * The first integer defines the size of the type in multiples of 4 bytes, since all types with pointers are at least 32-bit aligned.
 * The second integer denotes the number of further entries in the typemap.
 * All following integers are offsets (positive), counts (negativ) or pointers to other typemaps (negative).
 * An offset is an offset inside a type instance where a pointer can be found.
 * A count (negative) is always followed by a pointer to another typemap (negative).
 * The meaning is that the type instance contains "-count" instances of a type described by the following typemap.
 * The MSB of the count must be cleared to obtain the real count value. 
 * A pointer to another typemap is negative, hence its MSB must be cleared to obtain the real pointer.
 * This real pointer is the address of another typemap.
 * A pointer to another typemap can only be encountered following a count.
 */
export class TypeMap {

    public declare(module: wasm.Module) {
        this.module = module;
        this.addr = module.addGlobalStruct(4 + 4 + this.offsets.length * 4);
    }

    public define() {
        let arr = new ArrayBuffer(4 + 4 + this.offsets.length * 4);
        let a32 = new Int32Array(arr);
        a32[0] = Math.floor((this.typeSize + 3) / 4); // Size of a type instance as multiple of 4 bytes
        a32[1] = this.offsets.length;     // Number of locations where pointers can be found
        for(let i = 0; i < this.offsets.length; i++) {
            let o = this.offsets[i];
            if (o instanceof TypeMap) {
                a32[2 + i] = -o.addr;     // Pointer to another typemap?
            } else {
                a32[2 + i] = o;
            }
        }
        this.module.defineGlobalStruct(this.addr, new Uint8Array(arr));
    }

    public offsets: Array<number | TypeMap> = [];
    public typeSize: number;
    public addr: number;
    public module: wasm.Module;
}

export class StackMap {

}
