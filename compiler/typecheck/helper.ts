import {Node, Location} from "../parser"
import {
    ArrayType, InterfaceType, MapType, OrType, PointerType,
    RestrictedType, SliceType, StringLiteralType, StructType, TemplateType,
    TupleType, Type, UnsafePointerType
} from "../types/";
import { Scope, FunctionParameter, Variable } from '../scope'
import { ImplementationError } from '../errors'

import { Static } from './'

export function stripType(t: Type): Type {
    if (t instanceof RestrictedType) {
        t = t.elementType;
    }
    return t;
}

export function isString(t: Type): boolean {
    if (t instanceof RestrictedType) {
        return t.elementType == Static.t_string;
    }
    return t == Static.t_string;
}

export function isTupleType(t: Type): boolean {
    if (t instanceof RestrictedType) {
        return t.elementType instanceof OrType;
    }
    return t instanceof TupleType;
}

export function isStringLiteralType(t: Type): boolean {
    if (t instanceof RestrictedType) {
        return t.elementType instanceof OrType;
    }
    return t instanceof StringLiteralType;
}

export function isAny(t: Type): boolean {
    if (t instanceof RestrictedType) {
        return t.elementType instanceof OrType;
    }
    return t == Static.t_any;
}

export function isOrType(t: Type): boolean {
    if (t instanceof RestrictedType) {
        return t.elementType instanceof OrType;
    }
    return t instanceof OrType;
}

export function isComplexOrType(t: Type): boolean {
    t = stripType(t);
    if (!(t instanceof OrType)) {
        return false;
    }
    return !t.stringsOnly();
}

export function isStringOrType(t: Type): boolean {
    t = stripType(t);
    if (!(t instanceof OrType)) {
        return false;
    }
    return t.stringsOnly();
}

export function isInterface(t: Type): boolean {
    t = stripType(t);
    if (!(t instanceof PointerType)) {
        return false;
    }
    t = stripType(t.elementType);
    return t instanceof InterfaceType;
}

export function isMap(t: Type): boolean {
    t = stripType(t);
    if (!(t instanceof PointerType)) {
        return false;
    }
    t = stripType(t.elementType);
    return t instanceof MapType;
    }

export function isSlice(t: Type): boolean {
    t = stripType(t);
    return t instanceof SliceType;
}

export function isArray(t: Type): boolean {
    t = stripType(t);
    return t instanceof ArrayType;
}

export function isUnsafePointer(t: Type): boolean {
    t = stripType(t);
    return t instanceof UnsafePointerType;
}

export function isNumber(t: Type): boolean {
    t = stripType(t);
    return (t == Static.t_rune || t == Static.t_float || t == Static.t_double || t == Static.t_int || t == Static.t_uint || t == Static.t_byte || t == Static.t_char || t == Static.t_int8 || t == Static.t_int16 || t == Static.t_int32 || t == Static.t_int64 || t == Static.t_uint8 || t == Static.t_uint16 || t == Static.t_uint32 || t == Static.t_uint64);
}

export function isStruct(t: Type): boolean {
    t = stripType(t);
    return t instanceof StructType;
}

export function isTuple(t: Type): boolean {
    t = stripType(t);
    return t instanceof TupleType;
}

export function isTemplateType(t: Type): boolean {
    t = stripType(t);
    return t instanceof TemplateType;
}

export function isMutableValue(t: Type): boolean {
    t = stripType(t);
    return t instanceof StructType || t instanceof TupleType || t instanceof ArrayType;
}

export function isStrong(t: Type): boolean {
    if (t instanceof RestrictedType) {
        t = t.elementType;
    }
    if (t instanceof PointerType && t.mode == "strong") {
        return true;
    }
    if (t instanceof SliceType && t.mode == "strong") {
        return true;
    }
    return false;
}

export function isUnique(t: Type): boolean {
    if (t instanceof RestrictedType) {
        t = t.elementType;
    }
    if (t instanceof PointerType && t.mode == "unique") {
        return true;
    }
    if (t instanceof SliceType && t.mode == "unique") {
        return true;
    }
    return false;
}

export function isReference(t: Type): boolean {
    if (t instanceof RestrictedType) {
        t = t.elementType;
    }
    if (t instanceof PointerType && t.mode == "reference") {
        return true;
    }
    if (t instanceof SliceType && t.mode == "reference") {
        return true;
    }
    return false;
}

export function isLocalReference(t: Type): boolean {
    if (t instanceof RestrictedType) {
        t = t.elementType;
    }
    if (t instanceof PointerType && t.mode == "local_reference") {
        return true;
    }
    if (t instanceof SliceType && t.mode == "local_reference") {
        return true;
    }
    return false;
}

export function isConst(t: Type): boolean {
    if (t instanceof RestrictedType) {
        if (t.isConst) {
            return true;
        }
        t = t.elementType;
    }
    return false;
}

export function isPlatformIntNumber(type: Type): boolean {
    type = stripType(type);
    return (type == Static.t_int || type == Static.t_uint);
}

export function isIntNumber(type: Type): boolean {
    type = stripType(type);
    if (type == Static.t_int || type == Static.t_uint || type == Static.t_byte || type == Static.t_char || type == Static.t_int8 || type == Static.t_int16 || type == Static.t_int32 || type == Static.t_int64 || type == Static.t_uint8 || type == Static.t_uint16 || type == Static.t_uint32 || type == Static.t_uint64) {
        return true;
    }
    return false;
}

// TODO: Platform specific
export function isInt32Number(t: Type): boolean {
    t = stripType(t);
    return t == Static.t_int32 || t == Static.t_uint32;
}

// TODO: Platform specific
export function isUInt32Number(t: Type): boolean {
    t = stripType(t);
    return t == Static.t_uint32;
}

export function isPrimitive(t: Type): boolean {
    t = stripType(t);
    return (t == Static.t_rune || t == Static.t_bool || t == Static.t_float || t == Static.t_double || t == Static.t_int8 || t == Static.t_int16 || t == Static.t_int32 || t == Static.t_int64 || t == Static.t_uint8 || t == Static.t_uint16 || t == Static.t_uint32 || t == Static.t_uint64 || t == Static.t_null || t == Static.t_void);
}

export function isSafePointer(t: Type): boolean {
    t = stripType(t);
    return (t instanceof PointerType);
}

/**
 * Returns true if the expression denoted by 'node' can be the left-hand-side of an assignment
 */
export function isLeftHandSide(node: Node, scope: Scope, _allowConstVariable: boolean = false): boolean {
    if (node.op == "id") {
        if (!_allowConstVariable) {
            let e = scope.resolveElement(node.value);
            if (!e) {
                throw new ImplementationError()
            }
            if ((e instanceof Variable && e.isConst) || (e instanceof FunctionParameter && e.isConst)) {
                return false;
            }
        }
        return true;
    } else if (node.op == "unary*") {
        return true;
    } else if (node.op == ".") {
        if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType) {
            return true;
        }
        return isLeftHandSide(node.lhs, scope/*, true*/);
    } else if (node.op == "[") {
        if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof SliceType) {
            return true;
        }
        if (node.lhs.type == Static.t_string) {
            return false;
        }
        return isLeftHandSide(node.lhs, scope/*, true*/);
    }
    return false;
}

/**
 * Returns true if the expression denoted by 'node' can be the left-hand-side of an assignment
 */
export function isMutable(node: Node, scope: Scope): boolean {
    if (node.op == "id") {
        let e = scope.resolveElement(node.value);
        if (!e) {
            throw new ImplementationError()
        }
        if ((e instanceof Variable && e.isConst) || (e instanceof FunctionParameter && e.isConst)) {
            return false;
        }
        return true;
    } else if (node.op == "unary*") {
        if (isConst(node.rhs.type)) {
            return false;
        }
        return true;
    } else if (node.op == ".") {
        if (isConst(node.lhs.type)) {
            return false;
        }
        if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType) {
            return true;
        }
        return isMutable(node.lhs, scope);
    } else if (node.op == "[") {
        if (isConst(node.lhs.type)) {
            return false;
        }
        if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof SliceType) {
            return true;
        }
        if (node.lhs.type == Static.t_string) {
            return false;
        }
        return isMutable(node.lhs, scope);
    }
    return !isConst(node.type);
}

export function isAssignable(node: Node, scope: Scope): boolean {
    if (node.op == "id") {
        let e = scope.resolveElement(node.value);
        if (!e) {
            throw new ImplementationError()
        }
        if ((e instanceof Variable && e.isConst) || (e instanceof FunctionParameter && e.isConst)) {
            return false;
        }
        return true;
    } else if (node.op == "unary*") {
        if (isConst(node.rhs.type)) {
            return false;
        }
        return true;
    } else if (node.op == ".") {
        if (node.lhs.type instanceof PointerType || node.lhs.type instanceof UnsafePointerType) {
            if (isConst(node.lhs.type)) {
                return false;
            }
            return true;
        }
        return isAssignable(node.lhs, scope);
    } else if (node.op == "[") {
        if (node.lhs.type instanceof UnsafePointerType || node.lhs.type instanceof SliceType) {
            if (isConst(node.lhs.type)) {
                return false;
            }
            return true;
        }
        if (node.lhs.type == Static.t_string) {
            return false;
        }
        return isAssignable(node.lhs, scope);
    }
    return false;
}
/**
 * A pure value contains no pointers and can be copied byte by byte.
 */
export function isPureValue(t: Type): boolean {
    t = RestrictedType.strip(t);
    if (t == Static.t_int || t == Static.t_uint || t == Static.t_byte || t == Static.t_char || t == Static.t_rune || t == Static.t_bool || t == Static.t_float || t == Static.t_double || t == Static.t_int8 || t == Static.t_int16 || t == Static.t_int32 || t == Static.t_int64 || t == Static.t_uint8 || t == Static.t_uint16 || t == Static.t_uint32 || t == Static.t_uint64 || t == Static.t_null || t == Static.t_void) {
        return true;
    }
    if (t instanceof TupleType) {
        for(let p of t.types) {
            if (!isPureValue(p)) {
                return false;
            }
        }
        return true;
    } else if (t instanceof ArrayType) {
        return isPureValue(t.elementType);
    } else if (t instanceof StructType) {
        for(let f of t.fields) {
            if (!isPureValue(f.type)) {
                return false;
            }
        }
        if (t.extends && !isPureValue(t.extends)) {
            return false;
        }
        return true;
    } else if (t instanceof OrType) {
        return t.isPureValue();
    }
    return false;
}

export function applyConst(t: Type, loc: Location): Type {
    if (isSafePointer(t)) {
//            let r: RestrictedType;
        if (t instanceof RestrictedType) {
//                r = t;
            t = t.elementType;
        }
        return new PointerType(makeConst((t as PointerType).elementType, loc), (t as PointerType).mode);
//            if (r) {
//                t =  new RestrictedType(t, r);
//            }
    } else if (isSlice(t)) {
//            let r: RestrictedType;
        if (t instanceof RestrictedType) {
//                r = t;
            t = t.elementType;
        }
        return new SliceType(makeConst((t as SliceType).arrayType, loc) as ArrayType | RestrictedType, (t as SliceType).mode);
//            if (r) {
//                t =  new RestrictedType(t, r);
//            }
    }
    return makeConst(t, loc);
}

/**
 * Returns true if the expression yields ownership of the object it is pointing to.
 * Call the function only on expressions of pointer type or expressions that can be assigned to a pointer type
 */
export function isTakeExpression(enode: Node): boolean {
    if (enode.op == "clone" || enode.op == "take" || enode.op == "pop" || enode.op == "array" || enode.op == "object" || enode.op == "tuple" || enode.op == "make" || enode.op == "null" || (enode.op == ":" && (isStrong(enode.type) || isUnique(enode.type)))) {
        return true;
    }
    if (enode.op == "(") {
        // If the function returns a reference pointer, it is not a take expression, since it does not yield ownership.
        // In this case it just yields a reference.
        if (isSlice(enode.type) || isSafePointer(enode.type)) {
            return isStrong(enode.type) || isUnique(enode.type);
        }
        return true;
    }
    // A slice operation on a string creates a new string which already has a reference count of 1.
    // Hence it behaves like a take expression.
    // Adding a string, or casting a slice to a string creates a new string, too. Hence, it behaves like a take expression
    if (enode.type == Static.t_string && (enode.op == ":" || enode.op == "+" || (enode.op == "typeCast" && isSlice(enode.rhs.type)))) {
        return true;
    }
    // Casting a string to a slice returns a new slice. Hence, it behaves like a take expression
    if (isSlice(enode.type) && enode.op == "typeCast" && enode.rhs.type == Static.t_string) {
        return true;
    }
    // An expression of the kind &StructType{...} is a take expression
    if (enode.op == "unary&" && enode.rhs.isLiteral()) {
        return true;
    }
    return false;
}

/**
 * Returns a Node with op == 'id' if enode is a local variable, or a (series of) typecasts of a local variable.
 * If enode is a part of a local variable (e.g. an array element and the array is a local variable),
 * the function returns null. It only returns true if enode represents the entire(!) value stored in a local variable.
 */
export function getUnderlyingLocalVariable(enode: Node): Node | null {
    while (enode.op == "typeCast" && !isTakeExpression(enode)) {
        enode = enode.rhs;
    }
    if (enode.op == "id") {
        return enode
    }
    return null
}

export function makeConst(t: Type, loc: Location): Type {
    if (t instanceof RestrictedType) {
        if (t.isConst) {
            return t;
        }
        return new RestrictedType(t.elementType, {isConst: true});
    }
//        if (Helper.isPrimitive(t)) {
//            return t;
//        }
    return new RestrictedType(t, {isConst: true});
}

export function isSigned(t: Type): boolean {
    t = stripType(t);
    if (t == Static.t_char || t == Static.t_int || t == Static.t_int8 || t == Static.t_int16 || t == Static.t_int32 || t == Static.t_int64 || t == Static.t_float || t == Static.t_double) {
        return true;
    }
    if (t == Static.t_byte || t == Static.t_uint || t == Static.t_uint8 || t == Static.t_uint16 || t == Static.t_uint32 || t == Static.t_uint64) {
        return false;
    }
    if (isUnsafePointer(t)) {
        return true;
    }
    throw new ImplementationError("CodeGen: Implementation error: signed check on non number type " + t.toString())
}

export function isPureLiteral(t: Type, n: Node): boolean {
    t = RestrictedType.strip(t);
    if (t instanceof InterfaceType) {
        return false;
    }
    switch (n.op) {
        case "int":
        case "bool":
        case "float":
        case "null":
        case "rune":
        case "str":
            return true;
        case "array":
        {
            if (isArray(t)) {
                if (n.parameters) {
                    for(let p of n.parameters) {
                        if (p.op == "unary...") {
                            continue;
                        } else if (!this.isPureLiteral((t as ArrayType).elementType, p)) {
                            return false;
                        }
                    }
                }
                return true;
            }
            break;
        }
        case "tuple":
        {
            let i = 0
            for(let p of n.parameters) {
                if (!this.isPureLiteral((t as TupleType).types[i], p)) {
                    return false;
                }
            }
            return true;
        }
        case "object":
        {
            if (isStruct(t)) {
                if (n.parameters) {
                    for(let p of n.parameters) {
                        let f = (t as StructType).field(p.name.value);
                        if (!this.isPureLiteral(f.type, p.lhs)) {
                            return false;
                        }
                    }
                }
                return true;
            }
            break;
        }
    }
    return false;
}

export class BinaryBuffer {
    constructor(size: number = 1024) {
        this.arrayBuf = new ArrayBuffer(size);
        this.buf = new Uint8Array(this.arrayBuf);
        this.numberBuf = new Uint8Array(this.numberArrayBuf);
        this.numberUint8 = new Uint8Array(this.numberArrayBuf);
        this.numberUint16 = new Uint16Array(this.numberArrayBuf);
        this.numberUint32 = new Uint32Array(this.numberArrayBuf);
        this.numberInt8 = new Int8Array(this.numberArrayBuf);
        this.numberInt16 = new Int16Array(this.numberArrayBuf);
        this.numberInt32 = new Int32Array(this.numberArrayBuf);
        this.numberFloat32 = new Float32Array(this.numberArrayBuf);
        this.numberFloat64 = new Float64Array(this.numberArrayBuf);
    }

    public get data(): Uint8Array {
        return new Uint8Array(this.arrayBuf, 0, this.len);
    }

    public get arrayBuffer(): ArrayBuffer {
        return this.arrayBuf;
    }

    public get length(): number {
        return this.len;
    }

    public fill(length: number) {
        if (this.buf.byteLength < this.offset + length) {
            this.resize(Math.max(this.buf.byteLength * 2, this.buf.byteLength + length));
        }
        for(let i = 0; i < length; i++) {
            this.buf[this.offset + i] = 0;
        }
        this.offset += length;
        this.len = Math.max(this.len, this.offset);
    }

    public appendUint8(n: number) {
        this.buf[this.offset] = n;
        this.offset++;
        this.len = Math.max(this.len, this.offset);
    }

    public appendInt8(n: number) {
        this.numberInt8[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.offset++;
        this.len = Math.max(this.len, this.offset);
    }

    public appendUint16(n: number) {
        this.numberUint16[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.offset += 2;
        this.len = Math.max(this.len, this.offset);
    }

    public appendInt16(n: number) {
        this.numberInt16[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.offset += 2;
        this.len = Math.max(this.len, this.offset);
    }

    public appendUint32(n: number) {
        this.numberUint32[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.buf[this.offset + 2] = this.numberBuf[2];
        this.buf[this.offset + 3] = this.numberBuf[3];
        this.offset += 4;
        this.len = Math.max(this.len, this.offset);
    }

    public appendInt32(n: number) {
        this.numberInt32[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.buf[this.offset + 2] = this.numberBuf[2];
        this.buf[this.offset + 3] = this.numberBuf[3];
        this.offset += 4;
        this.len = Math.max(this.len, this.offset);
    }

    // TODO: Big numbers
    public appendUint64(n: number) {
        this.numberUint32[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.buf[this.offset + 2] = this.numberBuf[2];
        this.buf[this.offset + 3] = this.numberBuf[3];
        this.buf[this.offset + 4] = 0;
        this.buf[this.offset + 5] = 0;
        this.buf[this.offset + 6] = 0;
        this.buf[this.offset + 7] = 0;
        this.offset += 8;
        this.len = Math.max(this.len, this.offset);
    }

    // TODO: Big numbers
    public appendInt64(n: number) {
        this.numberInt32[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.buf[this.offset + 2] = this.numberBuf[2];
        this.buf[this.offset + 3] = this.numberBuf[3];
        this.buf[this.offset + 4] = n < 0 ? 255 : 0;
        this.buf[this.offset + 5] = n < 0 ? 255 : 0;
        this.buf[this.offset + 6] = n < 0 ? 255 : 0;
        this.buf[this.offset + 7] = n < 0 ? 255 : 0;
        this.offset += 8;
        this.len = Math.max(this.len, this.offset);
    }

    public appendFloat32(n: number) {
        this.numberFloat32[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.buf[this.offset + 2] = this.numberBuf[2];
        this.buf[this.offset + 3] = this.numberBuf[3];
        this.offset += 4;
        this.len = Math.max(this.len, this.offset);
    }

    public appendFloat64(n: number) {
        this.numberFloat64[0] = n;
        this.buf[this.offset] = this.numberBuf[0];
        this.buf[this.offset + 1] = this.numberBuf[1];
        this.buf[this.offset + 2] = this.numberBuf[2];
        this.buf[this.offset + 3] = this.numberBuf[3];
        this.buf[this.offset + 4] = this.numberBuf[4];
        this.buf[this.offset + 5] = this.numberBuf[5];
        this.buf[this.offset + 6] = this.numberBuf[6];
        this.buf[this.offset + 7] = this.numberBuf[7];
        this.offset += 8;
        this.len = Math.max(this.len, this.offset);
    }

    // TODO: 64bit pointer support
    public appendPointer(n: number) {
        this.appendUint32(n);
    }

    private resize(size: number) {
        this.arrayBuf = transferArrayBuffer(this.buf.buffer, size);
        this.buf = new Uint8Array(this.arrayBuf)
    }

    private arrayBuf: ArrayBuffer;
    private buf: Uint8Array;
    private offset: number = 0;
    private len: number = 0;
    private numberArrayBuf: ArrayBuffer = new ArrayBuffer(8);
    private numberBuf: Uint8Array;
    private numberUint8: Uint8Array;
    private numberUint16: Uint16Array;
    private numberUint32: Uint32Array;
    private numberInt8: Int8Array;
    private numberInt16: Int16Array;
    private numberInt32: Int32Array;
    private numberFloat32: Float32Array;
    private numberFloat64: Float64Array;
}

function transferArrayBuffer(source: ArrayBuffer, length: number) {
    source = Object(source);
    var dest = new ArrayBuffer(length);
    if (!(source instanceof ArrayBuffer) || !(dest instanceof ArrayBuffer)) {
        throw new TypeError('Source and destination must be ArrayBuffer instances');
    }
    if (dest.byteLength >= source.byteLength) {
        var nextOffset = 0;
        var leftBytes = source.byteLength;
        var wordSizes = [8, 4, 2, 1];
        wordSizes.forEach(function(_wordSize_) {
            if (leftBytes >= _wordSize_) {
                var done = transferWith(_wordSize_, source, dest, nextOffset, leftBytes);
                nextOffset = done.nextOffset;
                leftBytes = done.leftBytes;
            }
        });
    }
    return dest;
    function transferWith(wordSize: number, source: ArrayBuffer, dest: ArrayBuffer, nextOffset: number, leftBytes: number) {
        var ViewClass: any = Uint8Array;
        switch (wordSize) {
            case 8:
                ViewClass = Float64Array;
                break;
            case 4:
                ViewClass = Float32Array;
                break;
            case 2:
                ViewClass = Uint16Array;
                break;
            case 1:
                ViewClass = Uint8Array;
                break;
            default:
                ViewClass = Uint8Array;
                break;
        }
        var view_source = new ViewClass(source, nextOffset, Math.trunc(leftBytes / wordSize));
        var view_dest = new ViewClass(dest, nextOffset, Math.trunc(leftBytes / wordSize));
        for (var i = 0; i < view_dest.length; i++) {
            view_dest[i] = view_source[i];
        }
        return {
            nextOffset : view_source.byteOffset + view_source.byteLength,
            leftBytes : source.byteLength - (view_source.byteOffset + view_source.byteLength)
        }
    }
}
