(module
    (func $logNumber (import "imports" "logNumber")  (param i32))
    (import "imports" "mem" (memory 2))
    (global $root (mut i32) (i32.const 0))
    (global $gcEpoch (mut i32) (i32.const 0))
    (func $initializeRootBlock (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32)
        ;; r = decl_param addr 
        ;; blockCount = decl_param i32 
        ;; b = decl_var addr 
        ;; f = decl_var addr 
        ;; root = copy addr r
        get_local 0
        set_global 0
        ;; b = add i32 (and i32 r, (xor i32 65535, -1)), 65536
        get_local 0
        i32.const 65535
        i32.const -1
        i32.xor
        i32.and
        i32.const 65536
        i32.add
        set_local 3
        ;; $mem = store i8 r, 112, 7
        get_local 0
        i32.const 7
        i32.store8 offset=112
        ;; call (addr) => () 2, b
        get_local 3
        get_local 2
        call 2
        ;; f = add i32 b, 65536
        get_local 3
        i32.const 65536
        i32.add
        set_local 4
        ;; $mem = store i8 r, 112, (or i8 (load i8 r, 112), 64)
        get_local 0
        get_local 0
        i32.load8_u offset=112
        i32.const 64
        i32.or
        i32.store8 offset=112
        ;; $mem = store i32 f, 8, (sub i32 blockCount, 1)
        get_local 4
        get_local 1
        i32.const 1
        i32.sub
        i32.store offset=8
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 5
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, 15)), 1
                get_local 5
                i32.const 15
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (le_u i32 (shl i32 1, i), blockCount)
                    i32.const 1
                    get_local 5
                    i32.shl
                    get_local 1
                    i32.le_u
                    if
                        ;; %10 = lt_u i32 blockCount, (shl i32 1, (add i32 i, 1))
                        get_local 1
                        i32.const 1
                        get_local 5
                        i32.const 1
                        i32.add
                        i32.shl
                        i32.lt_u
                        set_local 6
                    else
                        ;; %10 = const i8 0
                        i32.const 0
                        set_local 6
                    end
                    ;; if %10
                    get_local 6
                    if
                        ;; if (ge_u i32 i, 15)
                        get_local 5
                        i32.const 15
                        i32.ge_u
                        if
                            ;; trap 
                            unreachable
                        end
                        ;; $mem = store addr (add ptr r, (mul i32 i, 4)), 48, f
                        get_local 0
                        get_local 5
                        i32.const 4
                        i32.mul
                        i32.add
                        get_local 4
                        i32.store offset=48
                    else
                        ;; if (ge_u i32 i, 15)
                        get_local 5
                        i32.const 15
                        i32.ge_u
                        if
                            ;; trap 
                            unreachable
                        end
                        ;; $mem = store addr (add ptr r, (mul i32 i, 4)), 48, 0
                        get_local 0
                        get_local 5
                        i32.const 4
                        i32.mul
                        i32.add
                        i32.const 0
                        i32.store offset=48
                    end
                end
                ;; i = add i32 i, 1
                get_local 5
                i32.const 1
                i32.add
                set_local 5
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $initializeBlock (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 1
        i32.const 4
        i32.sub
        tee_local 1
        set_local 2
        ;; b = decl_param addr 
        ;; ptr = decl_var addr 
        ;; ptr = copy addr b
        get_local 0
        set_local 3
        ;; i = decl_var s32 
        ;; i = const s32 0
        i32.const 0
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 i, 128)), 1
                get_local 4
                i32.const 128
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; $mem = store i64 ptr, 0, 0
                    get_local 3
                    i64.const 0
                    i64.store
                    ;; ptr = add addr ptr, 8
                    get_local 3
                    i32.const 8
                    i32.add
                    set_local 3
                end
                ;; i = add s32 i, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; $mem = store i8 b, 0, 3
        get_local 0
        i32.const 3
        i32.store8
        ;; i = decl_var i32 
        ;; f = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; i = const i32 5
        i32.const 5
        set_local 5
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, 11)), 1
                get_local 5
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; f = add i32 (shl i32 1, (add i32 5, i)), b
                    i32.const 1
                    i32.const 5
                    get_local 5
                    i32.add
                    i32.shl
                    get_local 0
                    i32.add
                    set_local 6
                    ;; if (ge_u i32 i, 11)
                    get_local 5
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr f, 0, (load addr (add ptr root, (mul i32 i, 4)), 0)
                    get_local 6
                    get_global 0
                    get_local 5
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    i32.store
                    ;; $mem = store addr f, 4, 0
                    get_local 6
                    i32.const 0
                    i32.store offset=4
                    ;; $mem = store i32 f, 8, (shl i32 1, (add i32 5, i))
                    get_local 6
                    i32.const 1
                    i32.const 5
                    get_local 5
                    i32.add
                    i32.shl
                    i32.store offset=8
                    ;; if (ne addr (load addr f, 0), 0)
                    get_local 6
                    i32.load
                    i32.const 0
                    i32.ne
                    if
                        ;; $mem = store addr (load addr f, 0), 4, f
                        get_local 6
                        i32.load
                        get_local 6
                        i32.store offset=4
                    end
                    ;; if (ge_u i32 i, 11)
                    get_local 5
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 i, 4)), 0, f
                    get_global 0
                    get_local 5
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 6
                    i32.store
                    ;; area_nr = shl i32 1, i
                    i32.const 1
                    get_local 5
                    i32.shl
                    set_local 7
                    ;; if (ge_u i32 (%42 = shr_u i32 area_nr, 1), 1024)
                    get_local 7
                    i32.const 1
                    i32.shr_u
                    tee_local 8
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %46 = or i8 (load i8 (%44 = add ptr b, %42), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 2
                    get_local 0
                    get_local 8
                    i32.add
                    tee_local 10
                    i32.store
                    get_local 10
                    i32.load8_u
                    i32.const 4
                    get_local 7
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.or
                    set_local 9
                    ;; $mem = store i8 %44, 0, %46
                    get_local 2
                    i32.load
                    get_local 9
                    i32.store8
                end
                ;; i = add i32 i, 1
                get_local 5
                i32.const 1
                i32.add
                set_local 5
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $split (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 2
        i32.const 4
        i32.sub
        tee_local 2
        set_local 3
        ;; f = decl_param addr 
        ;; index = decl_param i32 
        ;; f2 = decl_var addr 
        ;; block = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; index = sub i32 index, 1
        get_local 1
        i32.const 1
        i32.sub
        set_local 1
        ;; f2 = add i32 f, (shl i32 1, (add i32 index, 5))
        get_local 0
        i32.const 1
        get_local 1
        i32.const 5
        i32.add
        i32.shl
        i32.add
        set_local 4
        ;; if (ge_u i32 index, 11)
        get_local 1
        i32.const 11
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr f2, 0, (load addr (add ptr root, (mul i32 index, 4)), 0)
        get_local 4
        get_global 0
        get_local 1
        i32.const 4
        i32.mul
        i32.add
        i32.load
        i32.store
        ;; $mem = store addr f2, 4, 0
        get_local 4
        i32.const 0
        i32.store offset=4
        ;; if (ne addr (load addr f2, 0), 0)
        get_local 4
        i32.load
        i32.const 0
        i32.ne
        if
            ;; $mem = store addr (load addr f2, 0), 4, f2
            get_local 4
            i32.load
            get_local 4
            i32.store offset=4
        end
        ;; if (ge_u i32 index, 11)
        get_local 1
        i32.const 11
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, f2
        get_global 0
        get_local 1
        i32.const 4
        i32.mul
        i32.add
        get_local 4
        i32.store
        ;; block = and i32 f2, (xor i32 65535, -1)
        get_local 4
        i32.const 65535
        i32.const -1
        i32.xor
        i32.and
        set_local 5
        ;; area_nr = shr_u i32 (and i32 f2, 65535), 5
        get_local 4
        i32.const 65535
        i32.and
        i32.const 5
        i32.shr_u
        set_local 6
        ;; if (ge_u i32 (%67 = shr_u i32 area_nr, 1), 1024)
        get_local 6
        i32.const 1
        i32.shr_u
        tee_local 7
        i32.const 1024
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %71 = or i8 (load i8 (%69 = add ptr block, %67), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
        get_local 3
        get_local 5
        get_local 7
        i32.add
        tee_local 9
        i32.store
        get_local 9
        i32.load8_u
        i32.const 4
        get_local 6
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 8
        ;; $mem = store i8 %69, 0, %71
        get_local 3
        i32.load
        get_local 8
        i32.store8
        ;; end 
    )
    (func $allocBlocks (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 3
        i32.const 4
        i32.sub
        tee_local 3
        set_local 4
        ;; count = decl_param i32 
        ;; epoch = decl_param i32 
        ;; gc_pointers = decl_param i8 
        ;; $return = decl_result addr 
        ;; index = decl_var i32 
        ;; f = decl_var addr 
        ;; block_nr = decl_var i32 
        ;; index = const i32 14
        i32.const 14
        set_local 5
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ge_u i32 index, 0)), 1
                get_local 5
                i32.const 0
                i32.ge_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (le_u i32 (shl i32 1, index), count)
                    i32.const 1
                    get_local 5
                    i32.shl
                    get_local 0
                    i32.le_u
                    if
                        ;; br 3
                        br 3
                    end
                end
                ;; index = sub i32 index, 1
                get_local 5
                i32.const 1
                i32.sub
                set_local 5
                ;; br 0
                br 0
            end
        end
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 index, 15)), 1
                get_local 5
                i32.const 15
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 index, 15)
                    get_local 5
                    i32.const 15
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; if (ne addr (load addr (add ptr root, (mul i32 index, 4)), 48), 0)
                    get_global 0
                    get_local 5
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load offset=48
                    i32.const 0
                    i32.ne
                    if
                        ;; br 3
                        br 3
                    end
                end
                ;; index = add i32 index, 1
                get_local 5
                i32.const 1
                i32.add
                set_local 5
                ;; br 0
                br 0
            end
        end
        ;; if (ge_u i32 index, 15)
        get_local 5
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; f = load addr (add ptr root, (mul i32 index, 4)), 48
        get_global 0
        get_local 5
        i32.const 4
        i32.mul
        i32.add
        i32.load offset=48
        set_local 6
        ;; if (eq i32 (load i32 f, 8), count)
        get_local 6
        i32.load offset=8
        get_local 0
        i32.eq
        if
            ;; if (eqz addr (load addr f, 4))
            get_local 6
            i32.load offset=4
            i32.eqz
            if
                ;; if (ge_u i32 index, 15)
                get_local 5
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr f, 0)
                get_global 0
                get_local 5
                i32.const 4
                i32.mul
                i32.add
                get_local 6
                i32.load
                i32.store offset=48
            else
                ;; $mem = store addr (load addr f, 4), 0, (load addr f, 0)
                get_local 6
                i32.load offset=4
                get_local 6
                i32.load
                i32.store
            end
            ;; if (ne addr (load addr f, 0), 0)
            get_local 6
            i32.load
            i32.const 0
            i32.ne
            if
                ;; $mem = store addr (load addr f, 0), 4, (load addr f, 4)
                get_local 6
                i32.load
                get_local 6
                i32.load offset=4
                i32.store offset=4
            end
        else
            ;; f2 = decl_var addr 
            ;; index2 = decl_var i32 
            ;; f2 = copy addr f
            get_local 6
            set_local 8
            ;; $mem = store i32 f2, 8, (sub i32 (load i32 f2, 8), count)
            get_local 8
            get_local 8
            i32.load offset=8
            get_local 0
            i32.sub
            i32.store offset=8
            ;; f = add i32 f, (mul i32 65536, (load i32 f2, 8))
            get_local 6
            i32.const 65536
            get_local 8
            i32.load offset=8
            i32.mul
            i32.add
            set_local 6
            ;; index2 = const i32 14
            i32.const 14
            set_local 9
            ;; block 
            block
                ;; loop 
                loop
                    ;; br_if (eqz i8 (ge_u i32 index2, 0)), 1
                    get_local 9
                    i32.const 0
                    i32.ge_u
                    i32.eqz
                    br_if 1
                    ;; block 
                    block
                        ;; if (le_u i32 (shl i32 1, index2), (load i32 f2, 8))
                        i32.const 1
                        get_local 9
                        i32.shl
                        get_local 8
                        i32.load offset=8
                        i32.le_u
                        if
                            ;; br 3
                            br 3
                        end
                    end
                    ;; index2 = sub i32 index2, 1
                    get_local 9
                    i32.const 1
                    i32.sub
                    set_local 9
                    ;; br 0
                    br 0
                end
            end
            ;; if (ne i32 index2, index)
            get_local 9
            get_local 5
            i32.ne
            if
                ;; if (eqz addr (load addr f, 4))
                get_local 6
                i32.load offset=4
                i32.eqz
                if
                    ;; if (ge_u i32 index, 15)
                    get_local 5
                    i32.const 15
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr f, 0)
                    get_global 0
                    get_local 5
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 6
                    i32.load
                    i32.store offset=48
                else
                    ;; $mem = store addr (load addr f, 4), 0, (load addr f, 0)
                    get_local 6
                    i32.load offset=4
                    get_local 6
                    i32.load
                    i32.store
                end
                ;; if (ne addr (load addr f, 0), 0)
                get_local 6
                i32.load
                i32.const 0
                i32.ne
                if
                    ;; $mem = store addr (load addr f, 0), 4, (load addr f, 4)
                    get_local 6
                    i32.load
                    get_local 6
                    i32.load offset=4
                    i32.store offset=4
                end
                ;; $mem = store addr f2, 4, 0
                get_local 8
                i32.const 0
                i32.store offset=4
                ;; if (ge_u i32 index2, 15)
                get_local 9
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr f2, 0, (load addr (add ptr root, (mul i32 index2, 4)), 48)
                get_local 8
                get_global 0
                get_local 9
                i32.const 4
                i32.mul
                i32.add
                i32.load offset=48
                i32.store
                ;; if (ne addr (load addr f2, 0), 0)
                get_local 8
                i32.load
                i32.const 0
                i32.ne
                if
                    ;; $mem = store addr (load addr f2, 0), 4, f2
                    get_local 8
                    i32.load
                    get_local 8
                    i32.store offset=4
                end
                ;; if (ge_u i32 index2, 15)
                get_local 9
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr (add ptr root, (mul i32 index2, 4)), 48, f2
                get_global 0
                get_local 9
                i32.const 4
                i32.mul
                i32.add
                get_local 8
                i32.store offset=48
            end
        end
        ;; block_nr = sub i32 (shr_u i32 (sub i32 f, root), 16), 1
        get_local 6
        get_global 0
        i32.sub
        i32.const 16
        i32.shr_u
        i32.const 1
        i32.sub
        set_local 7
        ;; if (ge_u i32 (%140 = shr_u i32 block_nr, 1), 32768)
        get_local 7
        i32.const 1
        i32.shr_u
        tee_local 10
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %144 = or i8 (load i8 (%142 = add ptr root, %140), 112), (shl i32 (or i32 (shl i32 gc_pointers, 3), (or i32 4, epoch)), (shl i32 (and i32 block_nr, 1), 2))
        get_local 4
        get_global 0
        get_local 10
        i32.add
        tee_local 12
        i32.store
        get_local 12
        i32.load8_u offset=112
        get_local 2
        i32.const 3
        i32.shl
        i32.const 4
        get_local 1
        i32.or
        i32.or
        get_local 7
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 11
        ;; $mem = store i8 %142, 112, %144
        get_local 4
        i32.load
        get_local 11
        i32.store8 offset=112
        ;; return addr f
        get_local 6
        return
        ;; end 
    )
    (func $alloc (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 2
        i32.const 4
        i32.sub
        tee_local 2
        set_local 3
        ;; size = decl_param i32 
        ;; gc_pointers = decl_param i8 
        ;; $return = decl_result addr 
        ;; index = decl_var i32 
        ;; targetIndex = decl_var i32 
        ;; if (gt_u i32 size, 32768)
        get_local 0
        i32.const 32768
        i32.gt_u
        if
            ;; return addr (call (i32,i32,i8) => (addr) 4, (div_u i32 (add i32 size, 65535), 65536), gcEpoch, gc_pointers)
            get_local 0
            i32.const 65535
            i32.add
            i32.const 65536
            i32.div_u
            get_global 1
            get_local 1
            get_local 2
            call 4
            return
        else
            ;; if (gt_u i32 size, 16384)
            get_local 0
            i32.const 16384
            i32.gt_u
            if
                ;; index = const i32 10
                i32.const 10
                set_local 4
            else
                ;; if (gt_u i32 size, 8192)
                get_local 0
                i32.const 8192
                i32.gt_u
                if
                    ;; index = const i32 9
                    i32.const 9
                    set_local 4
                else
                    ;; if (gt_u i32 size, 4096)
                    get_local 0
                    i32.const 4096
                    i32.gt_u
                    if
                        ;; index = const i32 8
                        i32.const 8
                        set_local 4
                    else
                        ;; if (gt_u i32 size, 2048)
                        get_local 0
                        i32.const 2048
                        i32.gt_u
                        if
                            ;; index = const i32 7
                            i32.const 7
                            set_local 4
                        else
                            ;; if (gt_u i32 size, 1024)
                            get_local 0
                            i32.const 1024
                            i32.gt_u
                            if
                                ;; index = const i32 6
                                i32.const 6
                                set_local 4
                            else
                                ;; if (gt_u i32 size, 512)
                                get_local 0
                                i32.const 512
                                i32.gt_u
                                if
                                    ;; index = const i32 5
                                    i32.const 5
                                    set_local 4
                                else
                                    ;; if (gt_u i32 size, 256)
                                    get_local 0
                                    i32.const 256
                                    i32.gt_u
                                    if
                                        ;; index = const i32 4
                                        i32.const 4
                                        set_local 4
                                    else
                                        ;; if (gt_u i32 size, 128)
                                        get_local 0
                                        i32.const 128
                                        i32.gt_u
                                        if
                                            ;; index = const i32 3
                                            i32.const 3
                                            set_local 4
                                        else
                                            ;; if (gt_u i32 size, 64)
                                            get_local 0
                                            i32.const 64
                                            i32.gt_u
                                            if
                                                ;; index = const i32 2
                                                i32.const 2
                                                set_local 4
                                            else
                                                ;; if (gt_u i32 size, 32)
                                                get_local 0
                                                i32.const 32
                                                i32.gt_u
                                                if
                                                    ;; index = const i32 1
                                                    i32.const 1
                                                    set_local 4
                                                else
                                                    ;; index = const i32 0
                                                    i32.const 0
                                                    set_local 4
                                                end
                                            end
                                        end
                                    end
                                end
                            end
                        end
                    end
                end
            end
        end
        ;; targetIndex = copy i32 index
        get_local 4
        set_local 5
        ;; f = decl_var addr 
        ;; block = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; ptr = decl_var addr 
        ;; iterations = decl_var i32 
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 index, 11)), 1
                get_local 4
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 index, 11)
                    get_local 4
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; f = load addr (add ptr root, (mul i32 index, 4)), 0
                    get_global 0
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    set_local 6
                    ;; if (eqz addr f)
                    get_local 6
                    i32.eqz
                    if
                        ;; br 1
                        br 1
                    end
                    ;; if (ge_u i32 index, 11)
                    get_local 4
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, (load addr f, 0)
                    get_global 0
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 6
                    i32.load
                    i32.store
                    ;; if (ne addr (load addr f, 0), 0)
                    get_local 6
                    i32.load
                    i32.const 0
                    i32.ne
                    if
                        ;; $mem = store addr (load addr f, 0), 4, 0
                        get_local 6
                        i32.load
                        i32.const 0
                        i32.store offset=4
                    end
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (gt_u i32 index, targetIndex)), 1
                            get_local 4
                            get_local 5
                            i32.gt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; call (addr,i32) => () 3, f, index
                                get_local 6
                                get_local 4
                                get_local 2
                                call 3
                            end
                            ;; index = sub i32 index, 1
                            get_local 4
                            i32.const 1
                            i32.sub
                            set_local 4
                            ;; br 0
                            br 0
                        end
                    end
                    ;; block = and i32 f, (xor i32 65535, -1)
                    get_local 6
                    i32.const 65535
                    i32.const -1
                    i32.xor
                    i32.and
                    set_local 7
                    ;; area_nr = shr_u i32 (and i32 f, 65535), 5
                    get_local 6
                    i32.const 65535
                    i32.and
                    i32.const 5
                    i32.shr_u
                    set_local 8
                    ;; if (ge_u i32 (%186 = shr_u i32 area_nr, 1), 1024)
                    get_local 8
                    i32.const 1
                    i32.shr_u
                    tee_local 11
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %190 = or i8 (load i8 (%188 = add ptr block, %186), 0), (shl i32 (or i32 (shl i32 gc_pointers, 3), (or i32 4, gcEpoch)), (shl i32 (and i32 area_nr, 1), 2))
                    get_local 3
                    get_local 7
                    get_local 11
                    i32.add
                    tee_local 14
                    i32.store
                    get_local 14
                    i32.load8_u
                    get_local 1
                    i32.const 3
                    i32.shl
                    i32.const 4
                    get_global 1
                    i32.or
                    i32.or
                    get_local 8
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.or
                    set_local 12
                    ;; $mem = store i8 %188, 0, %190
                    get_local 3
                    i32.load
                    get_local 12
                    i32.store8
                    ;; ptr = copy addr f
                    get_local 6
                    set_local 9
                    ;; iterations = div_u i32 (add i32 size, 7), 8
                    get_local 0
                    i32.const 7
                    i32.add
                    i32.const 8
                    i32.div_u
                    set_local 10
                    ;; i = decl_var i32 
                    ;; i = const i32 0
                    i32.const 0
                    set_local 13
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (lt_u i32 i, iterations)), 1
                            get_local 13
                            get_local 10
                            i32.lt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; $mem = store i64 ptr, 0, 0
                                get_local 9
                                i64.const 0
                                i64.store
                                ;; ptr = add addr ptr, 8
                                get_local 9
                                i32.const 8
                                i32.add
                                set_local 9
                            end
                            ;; i = add i32 i, 1
                            get_local 13
                            i32.const 1
                            i32.add
                            set_local 13
                            ;; br 0
                            br 0
                        end
                    end
                    ;; return addr f
                    get_local 6
                    return
                end
                ;; index = add i32 index, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; call (addr) => () 2, (call (i32,i32,i8) => (addr) 4, 1, 3, 0)
        i32.const 1
        i32.const 3
        i32.const 0
        get_local 2
        call 4
        get_local 2
        call 2
        ;; return addr (call (i32,i8) => (addr) 5, size, gc_pointers)
        get_local 0
        get_local 1
        get_local 2
        call 5
        return
        ;; end 
    )
    (func $free (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 1
        i32.const 12
        i32.sub
        tee_local 1
        set_local 2
        ;; ptr = decl_param addr 
        ;; block = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; block = and i32 ptr, (xor i32 65535, -1)
        get_local 0
        i32.const 65535
        i32.const -1
        i32.xor
        i32.and
        set_local 3
        ;; area_nr = shr_u i32 (and i32 ptr, 65535), 5
        get_local 0
        i32.const 65535
        i32.and
        i32.const 5
        i32.shr_u
        set_local 4
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 5
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, 11)), 1
                get_local 5
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; index = decl_var i32 
                    ;; f = decl_var addr 
                    ;; if (ge_u i32 (%210 = shr_u i32 area_nr, 1), 1024)
                    get_local 4
                    i32.const 1
                    i32.shr_u
                    tee_local 8
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; if (ne i8 (and i8 (load i8 (add ptr block, %210), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))), 0)
                    get_local 3
                    get_local 8
                    i32.add
                    i32.load8_u
                    i32.const 4
                    get_local 4
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.and
                    i32.const 0
                    i32.ne
                    if
                        ;; index = const i32 0
                        i32.const 0
                        set_local 6
                        ;; next_area_nr = decl_var i32 
                        ;; next_area_nr = add i32 area_nr, 1
                        get_local 4
                        i32.const 1
                        i32.add
                        set_local 9
                        ;; block 
                        block
                            ;; loop 
                            loop
                                ;; br_if (eqz i8 (lt_u i32 next_area_nr, 2048)), 1
                                get_local 9
                                i32.const 2048
                                i32.lt_u
                                i32.eqz
                                br_if 1
                                ;; block 
                                block
                                    ;; if (ge_u i32 (%222 = shr_u i32 next_area_nr, 1), 1024)
                                    get_local 9
                                    i32.const 1
                                    i32.shr_u
                                    tee_local 10
                                    i32.const 1024
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; if (ne i8 (and i8 (load i8 (add ptr block, %222), 0), (shl i32 4, (shl i32 (and i32 next_area_nr, 1), 2))), 0)
                                    get_local 3
                                    get_local 10
                                    i32.add
                                    i32.load8_u
                                    i32.const 4
                                    get_local 9
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shl
                                    i32.and
                                    i32.const 0
                                    i32.ne
                                    if
                                        ;; br 3
                                        br 3
                                    end
                                    ;; index = add i32 index, 1
                                    get_local 6
                                    i32.const 1
                                    i32.add
                                    set_local 6
                                end
                                ;; next_area_nr = add i32 area_nr, (shl i32 1, index)
                                get_local 4
                                i32.const 1
                                get_local 6
                                i32.shl
                                i32.add
                                set_local 9
                                ;; br 0
                                br 0
                            end
                        end
                        ;; if (ge_u i32 (%233 = shr_u i32 area_nr, 1), 1024)
                        get_local 4
                        i32.const 1
                        i32.shr_u
                        tee_local 11
                        i32.const 1024
                        i32.ge_u
                        if
                            ;; trap 
                            unreachable
                        end
                        ;; %237 = and i8 (load i8 (%235 = add ptr block, %233), 0), (xor i8 (shl i32 15, (shl i32 (and i32 area_nr, 1), 2)), -1)
                        get_local 2
                        get_local 3
                        get_local 11
                        i32.add
                        tee_local 19
                        i32.store
                        get_local 19
                        i32.load8_u
                        i32.const 15
                        get_local 4
                        i32.const 1
                        i32.and
                        i32.const 2
                        i32.shl
                        i32.shl
                        i32.const -1
                        i32.xor
                        i32.and
                        set_local 12
                        ;; $mem = store i8 %235, 0, %237
                        get_local 2
                        i32.load
                        get_local 12
                        i32.store8
                        ;; f = add i32 block, (shl i32 area_nr, 5)
                        get_local 3
                        get_local 4
                        i32.const 5
                        i32.shl
                        i32.add
                        set_local 7
                        ;; buddy_area_nr = decl_var i32 
                        ;; f_buddy = decl_var addr 
                        ;; block 
                        block
                            ;; loop 
                            loop
                                ;; br_if (eqz i8 (lt_u i32 index, 10)), 1
                                get_local 6
                                i32.const 10
                                i32.lt_u
                                i32.eqz
                                br_if 1
                                ;; block 
                                block
                                    ;; buddy_area_nr = xor i32 area_nr, (shl i32 1, index)
                                    get_local 4
                                    i32.const 1
                                    get_local 6
                                    i32.shl
                                    i32.xor
                                    set_local 13
                                    ;; if (ge_u i32 (%248 = shr_u i32 buddy_area_nr, 1), 1024)
                                    get_local 13
                                    i32.const 1
                                    i32.shr_u
                                    tee_local 15
                                    i32.const 1024
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; if (ne i8 (and i8 (load i8 (add ptr block, %248), 0), (shl i32 3, (shl i32 (and i32 buddy_area_nr, 1), 2))), 0)
                                    get_local 3
                                    get_local 15
                                    i32.add
                                    i32.load8_u
                                    i32.const 3
                                    get_local 13
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shl
                                    i32.and
                                    i32.const 0
                                    i32.ne
                                    if
                                        ;; br 3
                                        br 3
                                    end
                                    ;; f_buddy = add i32 block, (shl i32 buddy_area_nr, 5)
                                    get_local 3
                                    get_local 13
                                    i32.const 5
                                    i32.shl
                                    i32.add
                                    set_local 14
                                    ;; if (ne addr (load addr f_buddy, 0), 0)
                                    get_local 14
                                    i32.load
                                    i32.const 0
                                    i32.ne
                                    if
                                        ;; $mem = store addr (load addr f_buddy, 0), 4, (load addr f_buddy, 4)
                                        get_local 14
                                        i32.load
                                        get_local 14
                                        i32.load offset=4
                                        i32.store offset=4
                                    end
                                    ;; if (ne addr (load addr f_buddy, 4), 0)
                                    get_local 14
                                    i32.load offset=4
                                    i32.const 0
                                    i32.ne
                                    if
                                        ;; $mem = store addr (load addr f_buddy, 4), 0, (load addr f_buddy, 0)
                                        get_local 14
                                        i32.load offset=4
                                        get_local 14
                                        i32.load
                                        i32.store
                                    else
                                        ;; if (ge_u i32 index, 11)
                                        get_local 6
                                        i32.const 11
                                        i32.ge_u
                                        if
                                            ;; trap 
                                            unreachable
                                        end
                                        ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, (load addr f_buddy, 0)
                                        get_global 0
                                        get_local 6
                                        i32.const 4
                                        i32.mul
                                        i32.add
                                        get_local 14
                                        i32.load
                                        i32.store
                                    end
                                    ;; if (lt_u i32 buddy_area_nr, area_nr)
                                    get_local 13
                                    get_local 4
                                    i32.lt_u
                                    if
                                        ;; if (ge_u i32 (%272 = shr_u i32 area_nr, 1), 1024)
                                        get_local 4
                                        i32.const 1
                                        i32.shr_u
                                        tee_local 16
                                        i32.const 1024
                                        i32.ge_u
                                        if
                                            ;; trap 
                                            unreachable
                                        end
                                        ;; %276 = and i8 (load i8 (%274 = add ptr block, %272), 0), (xor i8 (shl i32 4, (shl i32 (and i32 area_nr, 1), 2)), -1)
                                        get_local 2
                                        get_local 3
                                        get_local 16
                                        i32.add
                                        tee_local 19
                                        i32.store offset=8
                                        get_local 19
                                        i32.load8_u
                                        i32.const 4
                                        get_local 4
                                        i32.const 1
                                        i32.and
                                        i32.const 2
                                        i32.shl
                                        i32.shl
                                        i32.const -1
                                        i32.xor
                                        i32.and
                                        set_local 18
                                        ;; $mem = store i8 %274, 0, %276
                                        get_local 2
                                        i32.load offset=8
                                        get_local 18
                                        i32.store8
                                        ;; area_nr = copy i32 buddy_area_nr
                                        get_local 13
                                        set_local 4
                                        ;; f = copy addr f_buddy
                                        get_local 14
                                        set_local 7
                                    else
                                        ;; if (ge_u i32 (%281 = shr_u i32 buddy_area_nr, 3), 1024)
                                        get_local 13
                                        i32.const 3
                                        i32.shr_u
                                        tee_local 16
                                        i32.const 1024
                                        i32.ge_u
                                        if
                                            ;; trap 
                                            unreachable
                                        end
                                        ;; %285 = and i8 (load i8 (%283 = add ptr block, %281), 0), (xor i8 (shl i32 4, (shl i32 (and i32 buddy_area_nr, 1), 2)), -1)
                                        get_local 2
                                        get_local 3
                                        get_local 16
                                        i32.add
                                        tee_local 19
                                        i32.store offset=4
                                        get_local 19
                                        i32.load8_u
                                        i32.const 4
                                        get_local 13
                                        i32.const 1
                                        i32.and
                                        i32.const 2
                                        i32.shl
                                        i32.shl
                                        i32.const -1
                                        i32.xor
                                        i32.and
                                        set_local 17
                                        ;; $mem = store i8 %283, 0, %285
                                        get_local 2
                                        i32.load offset=4
                                        get_local 17
                                        i32.store8
                                    end
                                end
                                ;; index = add i32 index, 1
                                get_local 6
                                i32.const 1
                                i32.add
                                set_local 6
                                ;; br 0
                                br 0
                            end
                        end
                        ;; if (ge_u i32 index, 11)
                        get_local 6
                        i32.const 11
                        i32.ge_u
                        if
                            ;; trap 
                            unreachable
                        end
                        ;; $mem = store addr f, 0, (load addr (add ptr root, (mul i32 index, 4)), 0)
                        get_local 7
                        get_global 0
                        get_local 6
                        i32.const 4
                        i32.mul
                        i32.add
                        i32.load
                        i32.store
                        ;; $mem = store addr f, 4, 0
                        get_local 7
                        i32.const 0
                        i32.store offset=4
                        ;; if (ne addr (load addr f, 0), 0)
                        get_local 7
                        i32.load
                        i32.const 0
                        i32.ne
                        if
                            ;; $mem = store addr (load addr f, 0), 4, f
                            get_local 7
                            i32.load
                            get_local 7
                            i32.store offset=4
                        end
                        ;; if (ge_u i32 index, 11)
                        get_local 6
                        i32.const 11
                        i32.ge_u
                        if
                            ;; trap 
                            unreachable
                        end
                        ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, f
                        get_global 0
                        get_local 6
                        i32.const 4
                        i32.mul
                        i32.add
                        get_local 7
                        i32.store
                        ;; return 
                        return
                    end
                    ;; area_nr = and i32 area_nr, (xor i32 (shl i32 1, i), -1)
                    get_local 4
                    i32.const 1
                    get_local 5
                    i32.shl
                    i32.const -1
                    i32.xor
                    i32.and
                    set_local 4
                end
                ;; i = add i32 i, 1
                get_local 5
                i32.const 1
                i32.add
                set_local 5
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $garbageCollect (param i32)
        ;; gcEpoch = xor i32 gcEpoch, 3
        get_global 1
        i32.const 3
        i32.xor
        set_global 1
        ;; end 
    )
    (func $copy (param i32) (param i32) (param i32) (param i32)
        ;; dest = decl_param addr 
        ;; src = decl_param addr 
        ;; count = decl_param s32 
        ;; count = sub s32 count, 1
        get_local 2
        i32.const 1
        i32.sub
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ge_s s32 count, 0)), 1
                get_local 2
                i32.const 0
                i32.ge_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; $mem = store i8 (add addr dest, count), 0, (load i8 (add addr src, count), 0)
                    get_local 0
                    get_local 2
                    i32.add
                    get_local 1
                    get_local 2
                    i32.add
                    i32.load8_u
                    i32.store8
                end
                ;; count = sub s32 count, 1
                get_local 2
                i32.const 1
                i32.sub
                set_local 2
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $loop1 (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 0
        i32.const 28
        i32.sub
        tee_local 0
        set_local 1
        ;; $return = decl_result s32 
        ;; arr = decl_var slice 
        ;; $mem = store s32 (%308 = alloc s32 24), 0, 2
        get_local 1
        i32.const 24
        i32.const 0
        get_local 0
        call $alloc
        tee_local 5
        i32.store offset=12
        get_local 5
        i32.const 2
        i32.store
        ;; $mem = store s32 %308, 4, 4
        get_local 1
        i32.load offset=12
        i32.const 4
        i32.store offset=4
        ;; $mem = store s32 %308, 8, 8
        get_local 1
        i32.load offset=12
        i32.const 8
        i32.store offset=8
        ;; $mem = store s32 %308, 12, 16
        get_local 1
        i32.load offset=12
        i32.const 16
        i32.store offset=12
        ;; $mem = store s32 %308, 16, 32
        get_local 1
        i32.load offset=12
        i32.const 32
        i32.store offset=16
        ;; $mem = store s32 %308, 20, 42
        get_local 1
        i32.load offset=12
        i32.const 42
        i32.store offset=20
        ;; arr = struct slice %308, 6, 6
        get_local 1
        get_local 1
        i32.load offset=12
        i32.store
        get_local 1
        i32.const 6
        i32.store offset=4
        get_local 1
        i32.const 6
        i32.store offset=8
        ;; v = decl_var s32 
        ;; %311 = load ptr (%310 = addr_of ptr arr), 0
        get_local 1
        get_local 1
        get_local 1
        tee_local 5
        i32.store offset=20
        get_local 5
        i32.load
        i32.store offset=16
        ;; %312 = load i32 %310, 4
        get_local 1
        i32.load offset=20
        i32.load offset=4
        set_local 3
        ;; $counter = decl_var s32 
        ;; $counter = const s32 0
        i32.const 0
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; v = load s32 (add ptr %311, (mul s32 $counter, 4)), 0
                get_local 1
                i32.load offset=16
                get_local 4
                i32.const 4
                i32.mul
                i32.add
                i32.load
                set_local 2
                ;; br_if (eq s32 %312, $counter), 1
                get_local 3
                get_local 4
                i32.eq
                br_if 1
                ;; block 
                block
                    ;; call (s32) => () 0, v
                    get_local 2
                    call 0
                end
                ;; $counter = add s32 $counter, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; %317 = load ptr arr, 0
        get_local 1
        get_local 1
        i32.load
        i32.load
        i32.store offset=24
        ;; if (ge_u i32 0, (load i32 arr, 4))
        i32.const 0
        get_local 1
        i32.load
        i32.load offset=4
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; return s32 (load s32 %317, 0)
        get_local 1
        i32.load offset=24
        i32.load
        return
        ;; end 
    )
    (func $loop2 (param i32) (result i32) (local i32) (local i32) (local i32)
        get_local 0
        i32.const 28
        i32.sub
        tee_local 0
        set_local 1
        ;; $return = decl_result s32 
        ;; arr = decl_var slice 
        ;; s = decl_var struct{...} 
        ;; $mem = store s32 (%321 = alloc s32 24), 0, 2
        get_local 1
        i32.const 24
        i32.const 0
        get_local 0
        call $alloc
        tee_local 3
        i32.store offset=16
        get_local 3
        i32.const 2
        i32.store
        ;; $mem = store s32 %321, 4, 4
        get_local 1
        i32.load offset=16
        i32.const 4
        i32.store offset=4
        ;; $mem = store s32 %321, 8, 8
        get_local 1
        i32.load offset=16
        i32.const 8
        i32.store offset=8
        ;; $mem = store s32 %321, 12, 16
        get_local 1
        i32.load offset=16
        i32.const 16
        i32.store offset=12
        ;; $mem = store s32 %321, 16, 32
        get_local 1
        i32.load offset=16
        i32.const 32
        i32.store offset=16
        ;; $mem = store s32 %321, 20, 42
        get_local 1
        i32.load offset=16
        i32.const 42
        i32.store offset=20
        ;; arr = struct slice %321, 6, 6
        get_local 1
        get_local 1
        i32.load offset=16
        i32.store
        get_local 1
        i32.const 6
        i32.store offset=4
        get_local 1
        i32.const 6
        i32.store offset=8
        ;; s = struct struct{...} 0
        get_local 1
        i32.const 0
        i32.store
        ;; %325 = load ptr (addr_of ptr arr), 0
        get_local 1
        get_local 1
        i32.load
        i32.store offset=20
        ;; $counter = decl_var s32 
        ;; $counter = const s32 0
        i32.const 0
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; $mem = store s32 (addr_of ptr s), 0, (load s32 (add ptr %325, (mul s32 $counter, 4)), 0)
                get_local 1
                i32.const 12
                i32.add
                get_local 1
                i32.load offset=20
                get_local 2
                i32.const 4
                i32.mul
                i32.add
                i32.load
                i32.store
                ;; block 
                block
                    ;; call (s32) => () 0, (load s32 (addr_of ptr s), 0)
                    get_local 1
                    i32.const 12
                    i32.add
                    i32.load
                    call 0
                end
                ;; $counter = add s32 $counter, 1
                get_local 2
                i32.const 1
                i32.add
                set_local 2
                ;; br 0
                br 0
            end
        end
        ;; %334 = load ptr arr, 0
        get_local 1
        get_local 1
        i32.load
        i32.load
        i32.store offset=24
        ;; if (ge_u i32 0, (load i32 arr, 4))
        i32.const 0
        get_local 1
        i32.load
        i32.load offset=4
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; return s32 (load s32 %334, 0)
        get_local 1
        i32.load offset=24
        i32.load
        return
        ;; end 
    )
    (func $loop3 (param i32) (result f64) (local i32) (local i32) (local f64) (local i32) (local i32)
        get_local 0
        i32.const 20
        i32.sub
        tee_local 0
        set_local 1
        ;; $return = decl_result f64 
        ;; arr = decl_var slice 
        ;; $mem = store f64 (%338 = alloc f64 32), 0, 2.1
        get_local 1
        i32.const 32
        i32.const 0
        get_local 0
        call $alloc
        tee_local 5
        i32.store offset=12
        get_local 5
        f64.const 2.1
        f64.store
        ;; $mem = store f64 %338, 8, 3.2
        get_local 1
        i32.load offset=12
        f64.const 3.2
        f64.store offset=8
        ;; $mem = store f64 %338, 16, 4.3
        get_local 1
        i32.load offset=12
        f64.const 4.3
        f64.store offset=16
        ;; $mem = store f64 %338, 24, 5.4
        get_local 1
        i32.load offset=12
        f64.const 5.4
        f64.store offset=24
        ;; arr = struct slice %338, 4, 4
        get_local 1
        get_local 1
        i32.load offset=12
        i32.store
        get_local 1
        i32.const 4
        i32.store offset=4
        get_local 1
        i32.const 4
        i32.store offset=8
        ;; i = decl_var s32 
        ;; v = decl_var f64 
        ;; %342 = load i32 (addr_of ptr arr), 4
        get_local 1
        i32.load offset=4
        set_local 4
        ;; i = const s32 0
        i32.const 0
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eq s32 %342, i), 1
                get_local 4
                get_local 2
                i32.eq
                br_if 1
                ;; block 
                block
                    ;; call (s32) => () 0, i
                    get_local 2
                    call 0
                end
                ;; i = add s32 i, 1
                get_local 2
                i32.const 1
                i32.add
                set_local 2
                ;; br 0
                br 0
            end
        end
        ;; %347 = load ptr arr, 0
        get_local 1
        get_local 1
        i32.load
        i32.load
        i32.store offset=16
        ;; if (ge_u i32 0, (load i32 arr, 4))
        i32.const 0
        get_local 1
        i32.load
        i32.load offset=4
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; return f64 (load f64 %347, 0)
        get_local 1
        i32.load offset=16
        f64.load
        return
        ;; end 
    )
    (export "initializeRootBlock" (func 1))
    (export "initializeBlock" (func 2))
    (export "split" (func 3))
    (export "allocBlocks" (func 4))
    (export "alloc" (func 5))
    (export "free" (func 6))
    (export "garbageCollect" (func 7))
    (export "copy" (func 8))
    (export "loop1" (func 9))
    (export "loop2" (func 10))
    (export "loop3" (func 11))
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
