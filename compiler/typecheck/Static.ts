import { Type, BasicType, FunctionType, InterfaceType, RestrictedType, PointerType, UnsafePointerType } from '../types'

/**
 * The types defined here must be registered in TypeChecker.checkModule.
 */
export class Static {
    public static init() {
        Static.t_bool = new BasicType("bool");
        Static.t_float = new BasicType("float");
        Static.t_double = new BasicType("double");
        Static.t_null = new BasicType("null");
        Static.t_int8 = new BasicType("int8");
        Static.t_char = new BasicType("char");
        Static.t_int16 = new BasicType("int16");
        Static.t_int32 = new BasicType("int32");
        Static.t_int64 = new BasicType("int64");
        Static.t_int = new BasicType("int");
        Static.t_uint8 = new BasicType("uint8");
        Static.t_byte = new BasicType("byte");
        Static.t_uint16 = new BasicType("uint16");
        Static.t_uint32 = new BasicType("uint32");
        Static.t_uint64 = new BasicType("uint64");
        // TODO: Depends on arch
        Static.t_uint = new BasicType("uint");
        Static.t_any = new BasicType("any");
        Static.t_string = new BasicType("string");
        Static.t_void = new BasicType("void");
        Static.t_rune = new BasicType("rune");

        Static.t_error = new InterfaceType();
        Static.t_error.name = "error";

        Static.t_voidPtr = new UnsafePointerType(this.t_void);

        let toError = new FunctionType();
        toError.name = "toError";
        toError.returnType = Static.t_string;
        toError.objectType = new RestrictedType(Static.t_error, {isConst: true});
        Static.t_error.methods.set("toError", toError);

        Static.t_coroutine = new PointerType(Static.t_void, "reference");
    }

    public static isInitialized() {
        return Static.t_bool ? true : false
    }

    public static initIfRequired() {
        if (!Static.isInitialized()) {
            Static.init()
        }
    }

    public static t_bool: Type;
    public static t_float: Type;
    public static t_double: Type;
    public static t_null: Type;
    public static t_int8: Type;
    public static t_int16: Type;
    public static t_int32: Type;
    public static t_int64: Type;
    public static t_uint8: Type;
    public static t_byte: Type;
    public static t_char: Type;
    public static t_int: Type;
    public static t_uint16: Type;
    public static t_uint32: Type;
    public static t_uint64: Type;
    public static t_uint: Type;
    public static t_string: Type;
    public static t_rune: Type;
    public static t_void: Type;
    public static t_any: Type;
    public static t_error: InterfaceType;
    public static t_coroutine: PointerType;
    // For convenience, because it is often required
    public static t_voidPtr: UnsafePointerType;
}
