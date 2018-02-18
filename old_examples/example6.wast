
(module
    (func $logNumber (import "imports" "logNumber")  (param i32))
    (import "imports" "mem" (memory 100))
    (func $measureRecursion (param i32) (local i32)
        ;; i = decl_var s32 
        ;; i = const s32 0
        i32.const 0
        set_local 1
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 i, 1000)), 1
                get_local 1
                i32.const 100000
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; call (s32) => (s32) 2, 1000
                    i32.const 1000
                    get_local 0
                    call 2
                    drop
                end
                ;; i = add s32 i, 1
                get_local 1
                i32.const 1
                i32.add
                set_local 1
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $recursion (param i32) (param i32) (result i32)
        ;; a = decl_param s32 
        ;; $return = decl_result s32 
        ;; if (eqz s32 a)
        get_local 0
        i32.eqz
        if
            ;; return s32 0
            i32.const 0
            return
        end
        ;; return s32 (add s32 a, (call (s32) => (s32) 2, (sub s32 a, 1)))
        get_local 0
        get_local 0
        i32.const 1
        i32.sub
        get_local 1
        call 2
        i32.add
        return
        ;; end 
    )
    (export "measureRecursion" (func 1))
    (export "recursion" (func 2))
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
