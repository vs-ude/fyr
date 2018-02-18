
(module
    (func $logNumber (import "imports" "logNumber")  (param i32))
    (import "imports" "mem" (memory 2))
    (func $measureRecursion (param i32) (param i32) (result i32) (local i32)
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
                            block
                                block
                                    block
                                        get_local 0
                                        br_table 0 1 2 3 4 6
                                        ;; STEP 0
                                    end
                                    ;; i = decl_var s32 
                                    ;; i = const s32 0
                                    get_local 2
                                    i32.const 0
                                    i32.store
                                    ;; goto_step s1 
                                    ;; STEP 1
                                end
                                ;; goto_step_if <end> (eqz i8 (lt_s s32 i, 1000))
                                get_local 2
                                i32.load
                                i32.const 100000
                                i32.lt_s
                                i32.eqz
                                if
                                    i32.const 0
                                    return
                                end
                                ;; goto_step s2 
                                ;; STEP 2
                            end
                            ;; call_begin (s32) => (s32) 2, 1000
                            get_local 1
                            i32.const 4
                            i32.sub
                            set_local 1
                            i32.const 1000
                            i32.const 0
                            get_local 1
                            call 2
                            br_if 2
                            ;; step s3 
                            ;; STEP 3
                        end
                        ;; call_end (s32) => (s32) 
                        get_local 1
                        i32.const 4
                        i32.add
                        set_local 1
                        ;; goto_step s4 
                        ;; STEP 4
                    end
                    ;; i = add s32 i, 1
                    get_local 2
                    get_local 2
                    i32.load
                    i32.const 1
                    i32.add
                    i32.store
                    ;; goto_step s1 
                    ;; goto_step s1
                    i32.const 1
                    set_local 0
                    br 1
                    ;; ASYNC CALL 0
                end
                i32.const 3
                set_local 0
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
    (func $recursion (param i32) (param i32) (param i32) (result i32) (local i32) (local i32)
        get_local 2
        i32.const 4
        i32.sub
        tee_local 2
        tee_local 3
        i32.const 0
        i32.store
        block
            loop
                block
                    block
                        block
                            get_local 1
                            br_table 0 1 3
                            ;; STEP 0
                        end
                        ;; a = decl_param s32 
                        ;; $return = decl_result s32 
                        ;; if (eqz s32 a)
                        get_local 0
                        i32.eqz
                        if
                            ;; return s32 0
                            get_local 3
                            i32.const 0
                            i32.store offset=4
                            i32.const 0
                            return
                        end
                        ;; call_begin (s32) => (s32) 2, (sub s32 a, 1)
                        get_local 2
                        i32.const 4
                        i32.sub
                        set_local 2
                        get_local 0
                        i32.const 1
                        i32.sub
                        i32.const 0
                        get_local 2
                        call 2
                        br_if 1
                        ;; step s6 
                        ;; STEP 1
                    end
                    ;; %5 = call_end (s32) => (s32) 
                    get_local 2
                    i32.load
                    set_local 4
                    get_local 2
                    i32.const 4
                    i32.add
                    set_local 2
                    ;; return s32 (add s32 a, %5)
                    get_local 3
                    get_local 0
                    get_local 4
                    i32.add
                    i32.store offset=4
                    i32.const 0
                    return
                    ;; ASYNC CALL 0
                end
                i32.const 1
                set_local 1
                br 1
            end
        end
        get_local 3
        get_local 1
        i32.store
        get_local 3
        get_local 2
        i32.store
        get_local 3
        get_local 0
        i32.store
        get_local 3
        i32.const 1
        i32.store
        i32.const 1
        return
    )
    (func $f0 (param i32) (param i32) (result i32) (local i32)
        get_local 1
        i32.const 4
        i32.sub
        set_local 2
        get_local 2
        i32.load
        get_local 0
        get_local 1
        call 2
        return
    )
    (export "measureRecursion" (func 1))
    (export "recursion" (func 2))
    (table 2 anyfunc)
    (elem (i32.const 0) 1 2)
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
