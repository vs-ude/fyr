import {Type, StructType, PointerType, UnsafePointerType, TypeChecker, ArrayType, SliceType, TupleType} from "./typecheck"
import {CodeGenerator} from "./codegen"
import * as ssa from "./ssa"
import * as wasm from "./wasm"

export enum TypeFlags {
    IsPointer = 1,
    Inline = 2,
    IsSlice = 3
}

export type TypeMapEntry = {
    offset: number;
    type: TypeMap | null;
    count: number;
    flags: TypeFlags;
}

export class TypeMapper {
    constructor(tc: TypeChecker, cg: CodeGenerator) {
        this.tc = tc;
        this.cg = cg;
    }

    public mapType(t: Type, st: ssa.Type | ssa.StructType = null): TypeMap {
        if (this.mappings.has(t)) {
            return this.mappings.get(t);
        }
        if (t == this.tc.t_bool || t == this.tc.t_uint8 || t == this.tc.t_byte || t == this.tc.t_int8 || t == this.tc.t_int16 || t == this.tc.t_uint16 || t == this.tc.t_int32 || t == this.tc.t_uint32 || t == this.tc.t_int64 || t == this.tc.t_uint64 || t == this.tc.t_float || t == this.tc.t_double) {
            return null;
        }
        if (t instanceof PointerType) {
            let m = new TypeMap();
            this.mappings.set(t, m);
            m.entries.push({offset:0, type: this.mapType(t.elementType), flags: TypeFlags.IsPointer, count: 1});
            return m;
        }
        if (t instanceof UnsafePointerType) {
            return null;
        }
        if (t == this.tc.t_string) {
            let m = new TypeMap();
            this.mappings.set(t, m);
            m.entries.push({offset:0, type: null, flags: TypeFlags.IsPointer, count: 1});
            return m;
        }
        if (t instanceof SliceType) {
            let m = new TypeMap();
            this.mappings.set(t, m);
            m.entries.push({offset:0, type: this.mapType(t.elementType), flags: TypeFlags.IsSlice, count: 1});
            return m;
        }
        if (t instanceof StructType) {
            let m = new TypeMap();
            this.mappings.set(t, m);
            let s: ssa.StructType;
            if (st) {
                s = st as ssa.StructType;
            } else {
                st = this.cg.getSSAType(t) as ssa.StructType;
            }
            let i = 0;
            for(let f of t.fields) {
                let elm = this.mapType(f.type);
                if (elm) {
                    let offset = s.fieldOffset(f.name);
                    for(let elm_e of elm.entries) {
                        elm_e.offset += offset;
                        m.entries.push(elm_e);
                    }
                }
                i++;
            }
            if (m.entries.length == 0) {
                this.mappings.set(t, null);
                return null;
            }
            return m;            
        }
        if (t instanceof ArrayType) {
            let m = new TypeMap();
            this.mappings.set(t, m);
            m.entries.push({offset:0, type: this.mapType(t.elementType), flags: TypeFlags.Inline, count: t.size});
            return m;
        }
        if (t instanceof TupleType) {
            let m = new TypeMap();
            this.mappings.set(t, m);
            let s: ssa.StructType;
            if (st) {
                s = st as ssa.StructType;
            } else {
                st = this.cg.getSSAType(t) as ssa.StructType;
            }
            let i = 0;
            for(let el of t.types) {
                let elm = this.mapType(el);
                if (elm) {
                    let offset = s.fieldOffset("t" + i.toString());
                    for(let elm_e of elm.entries) {
                        elm_e.offset += offset;
                        m.entries.push(elm_e);
                    }
                }
                i++;
            }
            if (m.entries.length == 0) {
                this.mappings.set(t, null);
                return null;
            }
            return m;            
        }
        throw "TypeMapper: Implementation error: No mapping for " + t.toString();
    }

    public addToModule(module: wasm.Module) {
        for(var m of this.mappings.values()) {
            if (!m) {
                continue;
            }
            m.declare(module);
        }
        for(var m of this.mappings.values()) {
            if (!m) {
                continue;
            }
            m.define();
        }
    }

    private tc: TypeChecker;
    private cg: CodeGenerator;
    private mappings: Map<Type, TypeMap> = new Map<Type, TypeMap>(); 
}

export class TypeMap {

    public declare(module: wasm.Module) {
        this.module = module;
        this.addr = module.declareGlobalArray(4 + this.entries.length * (3 * 4));
    }

    public define() {
        let arr = new ArrayBuffer(4 + this.entries.length * (3 * 4));
        let a32 = new Uint32Array(arr);
        a32[0] = this.entries.length;
        for(let i = 0; i < this.entries.length; i++) {
            let e = this.entries[i];
            a32[1 + i * 4] = e.offset;
            a32[1 + i * 4 + 1] = e.count;
            a32[1 + i * 4 + 2] = e.type ? e.type.addr : 0;
            a32[1 + i * 4 + 3] = e.flags;
        }
        this.module.defineGlobalArray(this.addr, new Uint8Array(arr));
    }

    public entries: Array<TypeMapEntry> = [];
    public mapId: number;
    public addr: number;
    public module: wasm.Module;
}

export class StackMap {

}
