(module
    (import "imports" "mem" (memory 1))
    
    (type $type_callbackFn (func (param i32) (result i32)))

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
        i32.const 65532
        call $resume
        return
    )

    (func $resume (param $sp i32) (result i32) (local $func i32)
        block
            ;; Test whether recursion ends, because $sp points inside the top-most frame.
            get_local $sp
            i32.const 8
            i32.sub
            i32.load
            i32.const 0
            i32.eq
            br_if 0
            block
                ;; Recursion
                get_local $sp
                i32.const 8
                i32.sub
                i32.load
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
        ;; The sp
        get_local $sp
        ;; The function index
        get_local $sp
        i32.const 12
        i32.sub
        i32.load
        tee_local $func
        call_indirect $type_callbackFn
        return
    )

(func $f1 (param f32) (param f32) (param i32) (param i32) (result i32) (local i32)
        get_local 3
        i32.const 28
        i32.sub
        tee_local 3
        tee_local 4
        i32.const 0
        i32.store offset=20
        block
            loop
                block
                    block
                        block
                            block
                                block
                                    get_local 2
                                    br_table 0 1 2 4
                                    ;; STEP 0
                                end
                                ;; $1 = decl_param f32 
                                ;; $2 = decl_param f32 
                                ;; $r = decl_result f32 
                                ;; %0 = add f32 $1, $2
                                get_local 4
                                get_local 0
                                get_local 1
                                f32.add
                                f32.store offset=8
                                ;; yield 
                                br 2
                                ;; goto_step s1 
                                ;; STEP 1
                            end
                            ;; %1 = add f32 %0, 1
                            get_local 4
                            get_local 4
                            f32.load offset=8
                            f32.const 1
                            f32.add
                            f32.store offset=12
                            ;; yield 
                            br 2
                            ;; goto_step s2 
                            ;; STEP 2
                        end
                        ;; $r = return f32 (add f32 %1, 1)
                        get_local 4
                        get_local 4
                        f32.load offset=12
                        f32.const 1
                        f32.add
                        f32.store offset=28
                        i32.const 0
                        return
                        ;; ASYNC CALL 0
                    end
                    i32.const 1
                    set_local 2
                    i32.const 0
                    set_local 3
                    br 2
                    ;; ASYNC CALL 1
                end
                i32.const 2
                set_local 2
                i32.const 0
                set_local 3
                br 1
            end
        end
        get_local 4
        get_local 2
        i32.store offset=24
        get_local 4
        get_local 3
        i32.store offset=20
        get_local 4
        get_local 0
        f32.store
        get_local 4
        get_local 1
        f32.store offset=4
        get_local 4
        i32.const 0
        i32.store offset=16
        i32.const 1
        return
    )

    (func $f1_callback (param i32) (result i32)
        get_local 0
        i32.const 28
        i32.sub
        f32.load
        get_local 0
        i32.const 24
        i32.sub
        f32.load
        get_local 0
        i32.const 4
        i32.sub
        i32.load
        get_local 0
        call $f1
        return
    )

    (table 1 anyfunc)
    (elem (i32.const 0) $f1_callback)

    (export "main" (func 0))
    (export "mainResume" (func $mainResume))
)
