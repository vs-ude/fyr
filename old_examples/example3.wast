
(module
    (func $logNumber (import "imports" "logNumber")  (param i32))
    (import "imports" "mem" (memory 1))
    (func $demo (param i32) (param i32) (result i32) (local i32) (local i32)
        get_local 1
        i32.const 4
        i32.sub
        tee_local 1
        tee_local 2
        i32.const 0
        i32.store
        block
            loop
                block
                    block
                        block
                            get_local 0
                            br_table 0 1 3
                            ;; STEP 0
                        end
                        ;; $return = decl_result s32 
                        ;; x = decl_var s32 
                        ;; x = const s32 5
                        get_local 2
                        i32.const 5
                        i32.store
                        ;; if (ge_s s32 x, 5)
                        get_local 2
                        i32.load
                        i32.const 5
                        i32.ge_s
                        if
                            ;; x = const s32 10
                            get_local 2
                            i32.const 10
                            i32.store
                        else
                            ;; x = const s32 4
                            get_local 2
                            i32.const 4
                            i32.store
                        end
                        ;; call (s32) => () 0, x
                        get_local 2
                        i32.load
                        call 0
                        ;; yield 
                        br 1
                        ;; goto_step s1 
                        ;; STEP 1
                    end
                    ;; y = decl_var s32 
                    ;; if (eq s32 x, (const s32 10))
                    get_local 2
                    i32.load
                    i32.const 10
                    i32.eq
                    if
                        ;; x = const s32 1
                        get_local 2
                        i32.const 1
                        i32.store
                    end
                    ;; return s32 (call (s32,s32,s32) => (s32) 7, 6, 0, 1)
                    get_local 2
                    i32.const 6
                    i32.const 0
                    i32.const 1
                    get_local 1
                    call 7
                    i32.store offset=4
                    i32.const 0
                    return
                    ;; ASYNC CALL 0
                end
                i32.const 1
                set_local 0
                i32.const 0
                set_local 1
                br 1
            end
        end
        get_local 2
        get_local 0
        i32.store
        get_local 2
        get_local 1
        i32.store
        get_local 2
        i32.const 0
        i32.store
        i32.const 1
        return
    )
    (func $demo2 (param i32) (result i32) (local i32) (local i32)
        ;; $return = decl_result s32 
        ;; sum = decl_var s32 
        ;; sum = const s32 0
        i32.const 0
        set_local 1
        ;; x = decl_var s32 
        ;; x = const s32 1
        i32.const 1
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 x, 10)), 1
                get_local 2
                i32.const 10
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; sum = add s32 sum, x
                    get_local 1
                    get_local 2
                    i32.add
                    set_local 1
                end
                ;; x = add s32 x, 1
                get_local 2
                i32.const 1
                i32.add
                set_local 2
                ;; br 0
                br 0
            end
        end
        ;; return s32 sum
        get_local 1
        return
        ;; end 
    )
    (func $demo3 (param i32) (result i32) (local i32) (local i32)
        ;; $return = decl_result s32 
        ;; sum = decl_var s32 
        ;; sum = const s32 0
        i32.const 0
        set_local 1
        ;; x = decl_var s32 
        ;; x = const s32 1
        i32.const 1
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; block 
                block
                    ;; if (eq s32 x, 10)
                    get_local 2
                    i32.const 10
                    i32.eq
                    if
                        ;; br 3
                        br 3
                    end
                    ;; sum = add s32 sum, x
                    get_local 1
                    get_local 2
                    i32.add
                    set_local 1
                end
                ;; x = add s32 x, 1
                get_local 2
                i32.const 1
                i32.add
                set_local 2
                ;; br 0
                br 0
            end
        end
        ;; return s32 sum
        get_local 1
        return
        ;; end 
    )
    (func $demo4 (param i32) (result i32) (local i32) (local i32) (local i32) (local i32)
        ;; $return = decl_result i8 
        ;; ptr = decl_var addr 
        ;; b = decl_var i8 
        ;; ptr = const addr 0
        i32.const 0
        set_local 1
        ;; x = decl_var s32 
        ;; x = const s32 0
        i32.const 0
        set_local 3
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 x, 10)), 1
                get_local 3
                i32.const 10
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; mem = store i8 ptr, 0, 3
                    get_local 1
                    i32.const 3
                    i32.store8
                    ;; ptr = add addr ptr, 1
                    get_local 1
                    i32.const 1
                    i32.add
                    set_local 1
                end
                ;; x = add s32 x, 1
                get_local 3
                i32.const 1
                i32.add
                set_local 3
                ;; br 0
                br 0
            end
        end
        ;; ptr = const addr 0
        i32.const 0
        set_local 1
        ;; b = const i8 0
        i32.const 0
        set_local 2
        ;; x = decl_var s32 
        ;; x = const s32 0
        i32.const 0
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 x, 10)), 1
                get_local 4
                i32.const 10
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; b = add i8 b, (load i8 ptr, 0)
                    get_local 2
                    get_local 1
                    i32.load8_u
                    i32.add
                    set_local 2
                    ;; ptr = add addr ptr, 1
                    get_local 1
                    i32.const 1
                    i32.add
                    set_local 1
                end
                ;; x = add s32 x, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; return i8 b
        get_local 2
        return
        ;; end 
    )
    (func $demo5 (param i32) (result i32) (local i32) (local i32) (local i32) (local i32)
        ;; $return = decl_result s16 
        ;; ptr = decl_var addr 
        ;; b = decl_var s16 
        ;; ptr = const addr 0
        i32.const 0
        set_local 1
        ;; x = decl_var s32 
        ;; x = const s32 0
        i32.const 0
        set_local 3
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 x, 10)), 1
                get_local 3
                i32.const 10
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; mem = store s16 (add addr ptr, (mul addr x, 2)), 0, 4
                    get_local 1
                    get_local 3
                    i32.const 2
                    i32.mul
                    i32.add
                    i32.const 4
                    i32.store16
                end
                ;; x = add s32 x, 1
                get_local 3
                i32.const 1
                i32.add
                set_local 3
                ;; br 0
                br 0
            end
        end
        ;; ptr = const addr 0
        i32.const 0
        set_local 1
        ;; b = const s16 0
        i32.const 0
        set_local 2
        ;; x = decl_var s32 
        ;; x = const s32 0
        i32.const 0
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 x, 10)), 1
                get_local 4
                i32.const 10
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; b = add s16 b, (load s16 (add addr ptr, (mul addr x, 2)), 0)
                    get_local 2
                    get_local 1
                    get_local 4
                    i32.const 2
                    i32.mul
                    i32.add
                    i32.load16_s
                    i32.add
                    set_local 2
                end
                ;; x = add s32 x, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; return s16 b
        get_local 2
        return
        ;; end 
    )
    (func $strDemo (param i32)
        ;; end 
    )
    (func $fibonacci (param i32) (param i32) (param i32) (param i32) (result i32)
        ;; count = decl_param s32 
        ;; a = decl_param s32 
        ;; b = decl_param s32 
        ;; $return = decl_result s32 
        ;; if (eqz s32 count)
        get_local 0
        i32.eqz
        if
            ;; return s32 b
            get_local 2
            return
        end
        ;; return s32 (call (s32,s32,s32) => (s32) 7, (sub s32 count, 1), b, (add s32 a, b))
        get_local 0
        i32.const 1
        i32.sub
        get_local 2
        get_local 1
        get_local 2
        i32.add
        get_local 3
        call 7
        return
        ;; end 
    )
    (data (i32.const 0) "\0c\00\00\00\0c\00\00\00\05\00\00\00\48\61\6c\6c\6f")
    (export "demo" (func 1))
    (export "demo2" (func 2))
    (export "demo3" (func 3))
    (export "demo4" (func 4))
    (export "demo5" (func 5))
    (export "strDemo" (func 6))
    (export "fibonacci" (func 7))
    (table 1 anyfunc)
    (elem (i32.const 0) 1)
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
