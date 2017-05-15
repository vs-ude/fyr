(module
    (memory 1)
    
    (type $type_callbackFn (func (param i32 i32) (result i32)))

    (func $main (result i32)
        f32.const 42
        f32.const 0.5
        i32.const 0
        i32.const 65532
        call $f1
        ;; i32.const 65532
        ;; f32.load
        return
    )

    (func $mainResume (result i32)
        i32.const 65524
        call $resume
        return
    )

    (func $resume (param $sp i32) (result i32) (local $func i32) (local $step i32)
        block
            ;; Test whether recursion ends, because $sp points inside the top-most frame.
            get_local $sp
            i32.load offset=8
            i32.const 0
            i32.eq
            br_if 0
            block
                ;; Recursion
                get_local $sp
                i32.load offset=8
                call $resume
                br_if 0
                ;; No yield so far. The topmost frame has executed
                br 1
            end
            ;; Tell the caller that a yield has been encountered
            i32.const 1
            return
        end
        ;; Call the interrupted function
        ;; The last step
        get_local $sp
        i32.load offset=4
        ;; The sp
        get_local $sp
        i32.load offset=8
        ;; The function index
        get_local $sp
        i32.load offset=12
        call_indirect $type_callbackFn
        return
    )

    (func $point (param i32)
    )

    (func $f1 (param f32) (param f32) (param i32) (param i32) (result i32) (local i32) (local f32) (local f32)
        get_local 3
        i32.const 20
        i32.sub
        tee_local 3
        set_local 4
        block
            loop
                block
                    get_local 2
                    br_table 0 2
                    ;; STEP 0
                end
                ;; $1 = decl_param f32 
                ;; $2 = decl_param f32 
                ;; $r = decl_result f32 
                ;; if (eq f32 $1, $2)
                get_local 0
                get_local 1
                f32.eq
                if
                    ;; $r = return f32 -1
                    get_local 4
                    f32.const -1
                    f32.store offset=20
                    i32.const 0
                    return
                end
                ;; $2 = neg f32 $2
                get_local 1
                f32.neg
                set_local 1
                ;; %2 = mul f32 $1, $2
                get_local 0
                get_local 1
                f32.mul
                set_local 5
                ;; %3 = call () => ([object Object]) 13
                get_local 4
                i32.const 12
                i32.add
                get_local 3
                i32.const 8
                i32.sub
                set_local 3
                get_local 3
                call $point
                get_local 3
                i64.load
                i64.store
                get_local 3
                i32.const 8
                i32.add
                set_local 3
                ;; %7 = add f32 (load f32 %3, 0), (load f32 %3, 4)
                get_local 4
                i32.load offset=12
                f32.load
                get_local 4
                i32.load offset=12
                f32.load offset=4
                f32.add
                set_local 6
                ;; $r = return f32 (sub f32 %2, %7)
                get_local 4
                get_local 5
                get_local 6
                f32.sub
                f32.store offset=20
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

    (func $f1_callback (param i32) (result i32)
        get_local 0
        f32.load
        get_local 0
        f32.load offset=4
        get_local 0
        i32.load offset=28
        get_local 0
        call $f1
        return
    )

    (table 1 anyfunc)
    (elem (i32.const 0) $f1_callback)

    (export "main" (func 0))
    (export "mainResume" (func $mainResume))
)
