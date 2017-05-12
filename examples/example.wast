(module
    (memory 1)
    (func $main (result f32)
        f32.const 42
        f32.const 0.5
        i32.const 65536
        call $f1
        return
    )

    (func $f1 (param f32) (param f32) (param i32) (result f32)
        get_local 0
        get_local 1
        f32.mul
        return
    )

    (func $f2 (param f32) (param f32) (param i32) (param i32) (result i32) (local i32)
        get_local 3
        i32.const 12
        i32.sub
        tee_local 3
        set_local 4
        block
            loop
                block
                    get_local 2
                    br_table 0 1
                    ;; STEP 0
                end
                get_local 0
                get_local 1
                f32.eq
                if
                    get_local 4
                    i32.const 12
                    i32.add
                    f32.const -1
                    f32.store
                    i32.const 0
                    return
                end
                get_local 4
                i32.const 12
                i32.add
                get_local 0
                get_local 1
                f32.mul
                f32.store
                i32.const 0
                return
                i32.const 0
                return
            end
        end
        get_local 4
        get_local 2
        i32.store offset=8
        get_local 4
        get_local 3
        i32.store offset=4
        get_local 4
        get_local 4
        i32.store
        i32.const 1
        return
    )

    (export "main" (func 0))
)
