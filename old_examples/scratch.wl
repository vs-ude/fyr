(module
    (func $logString (import "imports" "logString") (param i32) )
    (func $logNumber (import "imports" "logNumber") (param i32 i32) )
    (import "imports" "mem" (memory 18))
    (global i32 (
        i32.const 584
    ))
    (global i32 (
        i32.const 328
    ))
    (global $root (mut i32) (i32.const 0))
    (global $heapStartBlockNr (mut i32) (i32.const 0))
    (global $heapEndBlockNr (mut i32) (i32.const 0))
    (global $gcEpoch (mut i32) (i32.const 0))
    (func $initializeMemory (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; $return = decl_result addr 
        ;; heap = decl_var addr 
        ;; heapEnd = decl_var addr 
        ;; b = decl_var addr 
        ;; stackBlockCount = decl_var i32 
        ;; f = decl_var addr 
        ;; freeBlockNr = decl_var i32 
        ;; stack_block_nr = decl_var i32 
        ;; gcEpoch = const i32 1
        i32.const 1
        set_global 5
        ;; heap = call () => (addr) -1
        get_global 0
        set_local 1
        ;; root = copy addr heap
        get_local 1
        set_global 2
        ;; heap = add addr heap, 32880
        get_local 1
        i32.const 32880
        i32.add
        set_local 1
        ;; b = add i32 (and i32 heap, (xor i32 65535, -1)), 65536
        get_local 1
        i32.const 65535
        i32.const -1
        i32.xor
        i32.and
        i32.const 65536
        i32.add
        set_local 3
        ;; stackBlockCount = shr_u i32 (add i32 (call () => (i32) -6), 65535), 16
        i32.const 65536
        i32.const 65535
        i32.add
        i32.const 16
        i32.shr_u
        set_local 4
        ;; heapStartBlockNr = shr_u i32 b, 16
        get_local 3
        i32.const 16
        i32.shr_u
        set_global 3
        ;; heapEndBlockNr = shr_u i32 (mul i32 (call () => (i32) -2), (call () => (i32) -5)), 16
        current_memory
        i32.const 65536
        i32.mul
        i32.const 16
        i32.shr_u
        set_global 4
        ;; if (ge_u i32 (%12 = shr_u i32 heapStartBlockNr, 1), 32768)
        get_global 3
        i32.const 1
        i32.shr_u
        tee_local 8
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store i8 (add ptr root, %12), 112, (shl i8 7, (shl i32 (and i32 heapStartBlockNr, 1), 2))
        get_global 2
        get_local 8
        i32.add
        i32.const 7
        get_global 3
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.store8 offset=112
        ;; call (addr) => () 3, b
        ;; parameter 0
        get_local 3
        get_local 0
        call 3
        ;; f = add i32 b, 65536
        get_local 3
        i32.const 65536
        i32.add
        set_local 5
        ;; freeBlockNr = add i32 heapStartBlockNr, 1
        get_global 3
        i32.const 1
        i32.add
        set_local 6
        ;; if (ge_u i32 (%21 = shr_u i32 freeBlockNr, 1), 32768)
        get_local 6
        i32.const 1
        i32.shr_u
        tee_local 9
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %25 = or i8 (load i8 (%23 = add ptr root, %21), 112), (shl i8 4, (shl i32 (and i32 freeBlockNr, 1), 2))
        get_global 2
        get_local 9
        i32.add
        tee_local 11
        i32.load8_u offset=112
        i32.const 4
        get_local 6
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 10
        ;; $mem = store i8 %23, 112, %25
        get_local 11
        get_local 10
        i32.store8 offset=112
        ;; $mem = store i32 f, 8, (sub i32 heapEndBlockNr, (sub i32 heapStartBlockNr, (sub i32 1, stackBlockCount)))
        get_local 5
        get_global 4
        get_global 3
        i32.const 1
        get_local 4
        i32.sub
        i32.sub
        i32.sub
        i32.store offset=8
        ;; if (ge_u i32 (%33 = call (i32) => (i32) 9, (load i32 f, 8)), 15)
        ;; parameter 0
        get_local 5
        i32.load offset=8
        get_local 0
        call 9
        tee_local 12
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr (add ptr root, (mul i32 %33, 4)), 48, f
        get_global 2
        get_local 12
        i32.const 4
        i32.mul
        i32.add
        get_local 5
        i32.store offset=48
        ;; stack_block_nr = sub i32 heapEndBlockNr, stackBlockCount
        get_global 4
        get_local 4
        i32.sub
        set_local 7
        ;; $mem = store ptr (addr_of ptr coroutine), 0, (shl i32 stack_block_nr, 16)
        i32.const 320
        get_local 7
        i32.const 16
        i32.shl
        i32.store
        ;; $mem = store i32 (addr_of ptr coroutine), 4, (shl i32 stackBlockCount, 16)
        i32.const 320
        get_local 4
        i32.const 16
        i32.shl
        i32.store offset=4
        ;; if (eqz addr (%43 = load ptr (addr_of ptr coroutine), 0))
        i32.const 320
        i32.load
        tee_local 13
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr %43, 4, (shl i32 heapEndBlockNr, 16)
        get_local 13
        get_global 4
        i32.const 16
        i32.shl
        i32.store offset=4
        ;; if (ge_u i32 (%46 = shr_u i32 stack_block_nr, 1), 32768)
        get_local 7
        i32.const 1
        i32.shr_u
        tee_local 14
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %50 = or i8 (load i8 (%48 = add ptr root, %46), 112), (shl i8 (or i32 8, (or i32 4, gcEpoch)), (shl i32 (and i32 stack_block_nr, 1), 2))
        get_global 2
        get_local 14
        i32.add
        tee_local 16
        i32.load8_u offset=112
        i32.const 8
        i32.const 4
        get_global 5
        i32.or
        i32.or
        get_local 7
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 15
        ;; $mem = store i8 %48, 112, %50
        get_local 16
        get_local 15
        i32.store8 offset=112
        ;; if (eqz addr (%57 = load ptr (addr_of ptr coroutine), 0))
        i32.const 320
        i32.load
        tee_local 17
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; return addr (load addr %57, 4)
        get_local 17
        i32.load offset=4
        return
        ;; end 
    )
    (func $initializeBlock (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; b = decl_param addr 
        ;; ptr = decl_var addr 
        ;; ptr = copy addr b
        get_local 0
        set_local 2
        ;; i = decl_var s32 
        ;; i = const s32 0
        i32.const 0
        set_local 3
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 i, 128)), 1
                get_local 3
                i32.const 128
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (eqz addr ptr)
                    get_local 2
                    i32.eqz
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store i64 ptr, 0, 0
                    get_local 2
                    i64.const 0
                    i64.store
                    ;; ptr = add addr ptr, 8
                    get_local 2
                    i32.const 8
                    i32.add
                    set_local 2
                end
                ;; i = add s32 i, 1
                get_local 3
                i32.const 1
                i32.add
                set_local 3
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
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, 11)), 1
                get_local 4
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; f = add i32 (shl i32 1, (add i32 5, i)), b
                    i32.const 1
                    i32.const 5
                    get_local 4
                    i32.add
                    i32.shl
                    get_local 0
                    i32.add
                    set_local 5
                    ;; if (ge_u i32 i, 11)
                    get_local 4
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr f, 0, (load addr (add ptr root, (mul i32 i, 4)), 0)
                    get_local 5
                    get_global 2
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    i32.store
                    ;; $mem = store addr f, 4, 0
                    get_local 5
                    i32.const 0
                    i32.store offset=4
                    ;; $mem = store i32 f, 8, (shl i32 1, (add i32 5, i))
                    get_local 5
                    i32.const 1
                    i32.const 5
                    get_local 4
                    i32.add
                    i32.shl
                    i32.store offset=8
                    ;; if (ne addr (load addr f, 0), 0)
                    get_local 5
                    i32.load
                    i32.const 0
                    i32.ne
                    if
                        ;; $mem = store addr (load addr f, 0), 4, f
                        get_local 5
                        i32.load
                        get_local 5
                        i32.store offset=4
                    end
                    ;; if (ge_u i32 i, 11)
                    get_local 4
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 i, 4)), 0, f
                    get_global 2
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 5
                    i32.store
                    ;; area_nr = shl i32 1, i
                    i32.const 1
                    get_local 4
                    i32.shl
                    set_local 6
                    ;; if (ge_u i32 (%81 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %85 = or i8 (load i8 (%83 = add ptr b, %81), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 0
                    get_local 7
                    i32.add
                    tee_local 9
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
                    ;; $mem = store i8 %83, 0, %85
                    get_local 9
                    get_local 8
                    i32.store8
                end
                ;; i = add i32 i, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $split (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
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
        set_local 3
        ;; if (ge_u i32 index, 11)
        get_local 1
        i32.const 11
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr f2, 0, (load addr (add ptr root, (mul i32 index, 4)), 0)
        get_local 3
        get_global 2
        get_local 1
        i32.const 4
        i32.mul
        i32.add
        i32.load
        i32.store
        ;; $mem = store addr f2, 4, 0
        get_local 3
        i32.const 0
        i32.store offset=4
        ;; if (ne addr (load addr f2, 0), 0)
        get_local 3
        i32.load
        i32.const 0
        i32.ne
        if
            ;; $mem = store addr (load addr f2, 0), 4, f2
            get_local 3
            i32.load
            get_local 3
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
        get_global 2
        get_local 1
        i32.const 4
        i32.mul
        i32.add
        get_local 3
        i32.store
        ;; block = and i32 f2, (xor i32 65535, -1)
        get_local 3
        i32.const 65535
        i32.const -1
        i32.xor
        i32.and
        set_local 4
        ;; area_nr = shr_u i32 (and i32 f2, 65535), 5
        get_local 3
        i32.const 65535
        i32.and
        i32.const 5
        i32.shr_u
        set_local 5
        ;; if (ge_u i32 (%106 = shr_u i32 area_nr, 1), 1024)
        get_local 5
        i32.const 1
        i32.shr_u
        tee_local 6
        i32.const 1024
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %110 = or i8 (load i8 (%108 = add ptr block, %106), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
        get_local 4
        get_local 6
        i32.add
        tee_local 8
        i32.load8_u
        i32.const 4
        get_local 5
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 7
        ;; $mem = store i8 %108, 0, %110
        get_local 8
        get_local 7
        i32.store8
        ;; end 
    )
    (func $allocBlocks (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; elementCount = decl_param i32 
        ;; elementSize = decl_param i32 
        ;; typeMap = decl_param addr 
        ;; headSize = decl_param i32 
        ;; headTypeMap = decl_param addr 
        ;; epoch = decl_param i32 
        ;; has_gc = decl_param i8 
        ;; $return = decl_result addr 
        ;; size = decl_var i32 
        ;; flags = decl_var i32 
        ;; count = decl_var i32 
        ;; index = decl_var i32 
        ;; f = decl_var addr 
        ;; block_nr = decl_var i32 
        ;; size = add i32 (mul i32 elementCount, elementSize), headSize
        get_local 0
        get_local 1
        i32.mul
        get_local 3
        i32.add
        set_local 8
        ;; flags = or i32 epoch, 4
        get_local 5
        i32.const 4
        i32.or
        set_local 9
        ;; if (ne addr typeMap, 0)
        get_local 2
        i32.const 0
        i32.ne
        if
            ;; size = add i32 size, 4
            get_local 8
            i32.const 4
            i32.add
            set_local 8
            ;; if (ne i32 elementCount, 1)
            get_local 0
            i32.const 1
            i32.ne
            if
                ;; size = add i32 size, 4
                get_local 8
                i32.const 4
                i32.add
                set_local 8
            end
            ;; flags = or i32 flags, 8
            get_local 9
            i32.const 8
            i32.or
            set_local 9
        end
        ;; if (ne addr headTypeMap, 0)
        get_local 4
        i32.const 0
        i32.ne
        if
            ;; size = add i32 size, 4
            get_local 8
            i32.const 4
            i32.add
            set_local 8
        end
        ;; count = div_u i32 (add i32 size, 65535), 65536
        get_local 8
        i32.const 65535
        i32.add
        i32.const 65536
        i32.div_u
        set_local 10
        ;; index = const i32 14
        i32.const 14
        set_local 11
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ge_u i32 index, 0)), 1
                get_local 11
                i32.const 0
                i32.ge_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (le_u i32 (shl i32 1, index), count)
                    i32.const 1
                    get_local 11
                    i32.shl
                    get_local 10
                    i32.le_u
                    if
                        ;; br 3
                        br 3
                    end
                end
                ;; index = sub i32 index, 1
                get_local 11
                i32.const 1
                i32.sub
                set_local 11
                ;; br 0
                br 0
            end
        end
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 index, 15)), 1
                get_local 11
                i32.const 15
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 index, 15)
                    get_local 11
                    i32.const 15
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; if (ne addr (load addr (add ptr root, (mul i32 index, 4)), 48), 0)
                    get_global 2
                    get_local 11
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
                get_local 11
                i32.const 1
                i32.add
                set_local 11
                ;; br 0
                br 0
            end
        end
        ;; if (eq i32 index, 15)
        get_local 11
        i32.const 15
        i32.eq
        if
            ;; if has_gc
            get_local 6
            if
                ;; return addr 0
                i32.const 0
                return
            end
            ;; call () => () 13
            get_local 7
            call 13
            ;; return addr (call (i32,i32,addr,i32,addr,i32,i8) => (addr) 5, elementCount, elementSize, typeMap, headSize, headTypeMap, epoch, 1)
            ;; parameter 0
            get_local 0
            ;; parameter 1
            get_local 1
            ;; parameter 2
            get_local 2
            ;; parameter 3
            get_local 3
            ;; parameter 4
            get_local 4
            ;; parameter 5
            get_local 5
            ;; parameter 6
            i32.const 1
            get_local 7
            call 5
            return
        end
        ;; if (ge_u i32 index, 15)
        get_local 11
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; f = load addr (add ptr root, (mul i32 index, 4)), 48
        get_global 2
        get_local 11
        i32.const 4
        i32.mul
        i32.add
        i32.load offset=48
        set_local 12
        ;; if (eq i32 (load i32 f, 8), count)
        get_local 12
        i32.load offset=8
        get_local 10
        i32.eq
        if
            ;; if (eqz addr (load addr f, 4))
            get_local 12
            i32.load offset=4
            i32.eqz
            if
                ;; if (ge_u i32 index, 15)
                get_local 11
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr f, 0)
                get_global 2
                get_local 11
                i32.const 4
                i32.mul
                i32.add
                get_local 12
                i32.load
                i32.store offset=48
            else
                ;; $mem = store addr (load addr f, 4), 0, (load addr f, 0)
                get_local 12
                i32.load offset=4
                get_local 12
                i32.load
                i32.store
            end
            ;; if (ne addr (load addr f, 0), 0)
            get_local 12
            i32.load
            i32.const 0
            i32.ne
            if
                ;; $mem = store addr (load addr f, 0), 4, (load addr f, 4)
                get_local 12
                i32.load
                get_local 12
                i32.load offset=4
                i32.store offset=4
            end
        else
            ;; f2 = decl_var addr 
            ;; index2 = decl_var i32 
            ;; f2 = copy addr f
            get_local 12
            set_local 14
            ;; $mem = store i32 f2, 8, (sub i32 (load i32 f2, 8), count)
            get_local 14
            get_local 14
            i32.load offset=8
            get_local 10
            i32.sub
            i32.store offset=8
            ;; f = add i32 f, (mul i32 65536, (load i32 f2, 8))
            get_local 12
            i32.const 65536
            get_local 14
            i32.load offset=8
            i32.mul
            i32.add
            set_local 12
            ;; index2 = const i32 14
            i32.const 14
            set_local 15
            ;; block 
            block
                ;; loop 
                loop
                    ;; br_if (eqz i8 (ge_u i32 index2, 0)), 1
                    get_local 15
                    i32.const 0
                    i32.ge_u
                    i32.eqz
                    br_if 1
                    ;; block 
                    block
                        ;; if (le_u i32 (shl i32 1, index2), (load i32 f2, 8))
                        i32.const 1
                        get_local 15
                        i32.shl
                        get_local 14
                        i32.load offset=8
                        i32.le_u
                        if
                            ;; br 3
                            br 3
                        end
                    end
                    ;; index2 = sub i32 index2, 1
                    get_local 15
                    i32.const 1
                    i32.sub
                    set_local 15
                    ;; br 0
                    br 0
                end
            end
            ;; if (ne i32 index2, index)
            get_local 15
            get_local 11
            i32.ne
            if
                ;; if (eqz addr (load addr f, 4))
                get_local 12
                i32.load offset=4
                i32.eqz
                if
                    ;; if (ge_u i32 index, 15)
                    get_local 11
                    i32.const 15
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr f, 0)
                    get_global 2
                    get_local 11
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 12
                    i32.load
                    i32.store offset=48
                else
                    ;; $mem = store addr (load addr f, 4), 0, (load addr f, 0)
                    get_local 12
                    i32.load offset=4
                    get_local 12
                    i32.load
                    i32.store
                end
                ;; if (ne addr (load addr f, 0), 0)
                get_local 12
                i32.load
                i32.const 0
                i32.ne
                if
                    ;; $mem = store addr (load addr f, 0), 4, (load addr f, 4)
                    get_local 12
                    i32.load
                    get_local 12
                    i32.load offset=4
                    i32.store offset=4
                end
                ;; $mem = store addr f2, 4, 0
                get_local 14
                i32.const 0
                i32.store offset=4
                ;; if (ge_u i32 index2, 15)
                get_local 15
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr f2, 0, (load addr (add ptr root, (mul i32 index2, 4)), 48)
                get_local 14
                get_global 2
                get_local 15
                i32.const 4
                i32.mul
                i32.add
                i32.load offset=48
                i32.store
                ;; if (ne addr (load addr f2, 0), 0)
                get_local 14
                i32.load
                i32.const 0
                i32.ne
                if
                    ;; $mem = store addr (load addr f2, 0), 4, f2
                    get_local 14
                    i32.load
                    get_local 14
                    i32.store offset=4
                end
                ;; if (ge_u i32 index2, 15)
                get_local 15
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr (add ptr root, (mul i32 index2, 4)), 48, f2
                get_global 2
                get_local 15
                i32.const 4
                i32.mul
                i32.add
                get_local 14
                i32.store offset=48
            end
        end
        ;; block_nr = sub i32 (shr_u i32 (sub i32 f, root), 16), 1
        get_local 12
        get_global 2
        i32.sub
        i32.const 16
        i32.shr_u
        i32.const 1
        i32.sub
        set_local 13
        ;; if (ge_u i32 (%190 = shr_u i32 block_nr, 1), 32768)
        get_local 13
        i32.const 1
        i32.shr_u
        tee_local 16
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %194 = or i8 (load i8 (%192 = add ptr root, %190), 112), (shl i32 flags, (shl i32 (and i32 block_nr, 1), 2))
        get_global 2
        get_local 16
        i32.add
        tee_local 18
        i32.load8_u offset=112
        get_local 9
        get_local 13
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 17
        ;; $mem = store i8 %192, 112, %194
        get_local 18
        get_local 17
        i32.store8 offset=112
        ;; start = decl_var addr 
        ;; if (ne addr typeMap, 0)
        get_local 2
        i32.const 0
        i32.ne
        if
            ;; start = copy addr f
            get_local 12
            set_local 19
            ;; if (eq i32 elementCount, 1)
            get_local 0
            i32.const 1
            i32.eq
            if
                ;; %199 = eqz addr headTypeMap
                get_local 4
                i32.eqz
                set_local 21
            else
                ;; %199 = const i8 0
                i32.const 0
                set_local 21
            end
            ;; if %199
            get_local 21
            if
                ;; if (eqz addr start)
                get_local 19
                i32.eqz
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store s32 start, 0, typeMap
                get_local 19
                get_local 2
                i32.store
                ;; f = add i32 f, 4
                get_local 12
                i32.const 4
                i32.add
                set_local 12
            else
                ;; if (eqz addr headTypeMap)
                get_local 4
                i32.eqz
                if
                    ;; if (eqz addr start)
                    get_local 19
                    i32.eqz
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store s32 start, 0, (add s32 (xor s32 elementCount, -1), 1)
                    get_local 19
                    get_local 0
                    i32.const -1
                    i32.xor
                    i32.const 1
                    i32.add
                    i32.store
                    ;; start = add addr start, 4
                    get_local 19
                    i32.const 4
                    i32.add
                    set_local 19
                    ;; if (eqz addr start)
                    get_local 19
                    i32.eqz
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store s32 start, 0, typeMap
                    get_local 19
                    get_local 2
                    i32.store
                    ;; f = add i32 f, 8
                    get_local 12
                    i32.const 8
                    i32.add
                    set_local 12
                else
                    ;; if (eqz addr start)
                    get_local 19
                    i32.eqz
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store s32 start, 0, (add s32 (xor s32 elementCount, -1), 1)
                    get_local 19
                    get_local 0
                    i32.const -1
                    i32.xor
                    i32.const 1
                    i32.add
                    i32.store
                    ;; start = add addr start, 4
                    get_local 19
                    i32.const 4
                    i32.add
                    set_local 19
                    ;; if (eqz addr start)
                    get_local 19
                    i32.eqz
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store s32 start, 0, (add s32 (xor s32 typeMap, -1), 1)
                    get_local 19
                    get_local 2
                    i32.const -1
                    i32.xor
                    i32.const 1
                    i32.add
                    i32.store
                    ;; start = add addr start, 4
                    get_local 19
                    i32.const 4
                    i32.add
                    set_local 19
                    ;; if (eqz addr start)
                    get_local 19
                    i32.eqz
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store s32 start, 0, (add s32 (xor s32 headTypeMap, -1), 1)
                    get_local 19
                    get_local 4
                    i32.const -1
                    i32.xor
                    i32.const 1
                    i32.add
                    i32.store
                    ;; f = add i32 f, 12
                    get_local 12
                    i32.const 12
                    i32.add
                    set_local 12
                end
            end
        else
            ;; start = decl_var addr 
            ;; if (ne addr headTypeMap, 0)
            get_local 4
            i32.const 0
            i32.ne
            if
                ;; start = copy addr f
                get_local 12
                set_local 20
                ;; if (eqz addr start)
                get_local 20
                i32.eqz
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store s32 start, 0, headTypeMap
                get_local 20
                get_local 4
                i32.store
                ;; f = add i32 f, 4
                get_local 12
                i32.const 4
                i32.add
                set_local 12
            end
        end
        ;; return addr f
        get_local 12
        return
        ;; end 
    )
    (func $alloc (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; elementCount = decl_param i32 
        ;; elementSize = decl_param i32 
        ;; typeMap = decl_param addr 
        ;; headSize = decl_param i32 
        ;; headTypeMap = decl_param addr 
        ;; $return = decl_result addr 
        ;; size = decl_var i32 
        ;; flags = decl_var i32 
        ;; index = decl_var i32 
        ;; targetIndex = decl_var i32 
        ;; size = add i32 (mul i32 elementCount, elementSize), headSize
        get_local 0
        get_local 1
        i32.mul
        get_local 3
        i32.add
        set_local 6
        ;; flags = or i32 4, gcEpoch
        i32.const 4
        get_global 5
        i32.or
        set_local 7
        ;; if (ne addr typeMap, 0)
        get_local 2
        i32.const 0
        i32.ne
        if
            ;; size = add i32 size, 4
            get_local 6
            i32.const 4
            i32.add
            set_local 6
            ;; if (ne i32 elementCount, 1)
            get_local 0
            i32.const 1
            i32.ne
            if
                ;; size = add i32 size, 4
                get_local 6
                i32.const 4
                i32.add
                set_local 6
            end
            ;; flags = or i32 flags, 8
            get_local 7
            i32.const 8
            i32.or
            set_local 7
        end
        ;; if (ne addr headTypeMap, 0)
        get_local 4
        i32.const 0
        i32.ne
        if
            ;; size = add i32 size, 4
            get_local 6
            i32.const 4
            i32.add
            set_local 6
        end
        ;; if (gt_u i32 size, 32768)
        get_local 6
        i32.const 32768
        i32.gt_u
        if
            ;; return addr (call (i32,i32,addr,i32,addr,i32,i8) => (addr) 5, elementCount, elementSize, typeMap, headSize, headTypeMap, gcEpoch, 0)
            ;; parameter 0
            get_local 0
            ;; parameter 1
            get_local 1
            ;; parameter 2
            get_local 2
            ;; parameter 3
            get_local 3
            ;; parameter 4
            get_local 4
            ;; parameter 5
            get_global 5
            ;; parameter 6
            i32.const 0
            get_local 5
            call 5
            return
        end
        ;; if (gt_u i32 size, 16384)
        get_local 6
        i32.const 16384
        i32.gt_u
        if
            ;; index = const i32 10
            i32.const 10
            set_local 8
        else
            ;; if (gt_u i32 size, 8192)
            get_local 6
            i32.const 8192
            i32.gt_u
            if
                ;; index = const i32 9
                i32.const 9
                set_local 8
            else
                ;; if (gt_u i32 size, 4096)
                get_local 6
                i32.const 4096
                i32.gt_u
                if
                    ;; index = const i32 8
                    i32.const 8
                    set_local 8
                else
                    ;; if (gt_u i32 size, 2048)
                    get_local 6
                    i32.const 2048
                    i32.gt_u
                    if
                        ;; index = const i32 7
                        i32.const 7
                        set_local 8
                    else
                        ;; if (gt_u i32 size, 1024)
                        get_local 6
                        i32.const 1024
                        i32.gt_u
                        if
                            ;; index = const i32 6
                            i32.const 6
                            set_local 8
                        else
                            ;; if (gt_u i32 size, 512)
                            get_local 6
                            i32.const 512
                            i32.gt_u
                            if
                                ;; index = const i32 5
                                i32.const 5
                                set_local 8
                            else
                                ;; if (gt_u i32 size, 256)
                                get_local 6
                                i32.const 256
                                i32.gt_u
                                if
                                    ;; index = const i32 4
                                    i32.const 4
                                    set_local 8
                                else
                                    ;; if (gt_u i32 size, 128)
                                    get_local 6
                                    i32.const 128
                                    i32.gt_u
                                    if
                                        ;; index = const i32 3
                                        i32.const 3
                                        set_local 8
                                    else
                                        ;; if (gt_u i32 size, 64)
                                        get_local 6
                                        i32.const 64
                                        i32.gt_u
                                        if
                                            ;; index = const i32 2
                                            i32.const 2
                                            set_local 8
                                        else
                                            ;; if (gt_u i32 size, 32)
                                            get_local 6
                                            i32.const 32
                                            i32.gt_u
                                            if
                                                ;; index = const i32 1
                                                i32.const 1
                                                set_local 8
                                            else
                                                ;; index = const i32 0
                                                i32.const 0
                                                set_local 8
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
        get_local 8
        set_local 9
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
                get_local 8
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 index, 11)
                    get_local 8
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; f = load addr (add ptr root, (mul i32 index, 4)), 0
                    get_global 2
                    get_local 8
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    set_local 10
                    ;; if (eqz addr f)
                    get_local 10
                    i32.eqz
                    if
                        ;; br 1
                        br 1
                    end
                    ;; if (ge_u i32 index, 11)
                    get_local 8
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, (load addr f, 0)
                    get_global 2
                    get_local 8
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 10
                    i32.load
                    i32.store
                    ;; if (ne addr (load addr f, 0), 0)
                    get_local 10
                    i32.load
                    i32.const 0
                    i32.ne
                    if
                        ;; $mem = store addr (load addr f, 0), 4, 0
                        get_local 10
                        i32.load
                        i32.const 0
                        i32.store offset=4
                    end
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (gt_u i32 index, targetIndex)), 1
                            get_local 8
                            get_local 9
                            i32.gt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; call (addr,i32) => () 4, f, index
                                ;; parameter 0
                                get_local 10
                                ;; parameter 1
                                get_local 8
                                get_local 5
                                call 4
                            end
                            ;; index = sub i32 index, 1
                            get_local 8
                            i32.const 1
                            i32.sub
                            set_local 8
                            ;; br 0
                            br 0
                        end
                    end
                    ;; block = and i32 f, (xor i32 65535, -1)
                    get_local 10
                    i32.const 65535
                    i32.const -1
                    i32.xor
                    i32.and
                    set_local 11
                    ;; area_nr = shr_u i32 (and i32 f, 65535), 5
                    get_local 10
                    i32.const 65535
                    i32.and
                    i32.const 5
                    i32.shr_u
                    set_local 12
                    ;; if (ge_u i32 (%262 = shr_u i32 area_nr, 1), 1024)
                    get_local 12
                    i32.const 1
                    i32.shr_u
                    tee_local 15
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %266 = or i8 (load i8 (%264 = add ptr block, %262), 0), (shl i32 flags, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 11
                    get_local 15
                    i32.add
                    tee_local 17
                    i32.load8_u
                    get_local 7
                    get_local 12
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.or
                    set_local 16
                    ;; $mem = store i8 %264, 0, %266
                    get_local 17
                    get_local 16
                    i32.store8
                    ;; ptr = copy addr f
                    get_local 10
                    set_local 13
                    ;; iterations = div_u i32 (add i32 size, 7), 8
                    get_local 6
                    i32.const 7
                    i32.add
                    i32.const 8
                    i32.div_u
                    set_local 14
                    ;; i = decl_var i32 
                    ;; i = const i32 0
                    i32.const 0
                    set_local 18
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (lt_u i32 i, iterations)), 1
                            get_local 18
                            get_local 14
                            i32.lt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; if (eqz addr ptr)
                                get_local 13
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store i64 ptr, 0, 0
                                get_local 13
                                i64.const 0
                                i64.store
                                ;; ptr = add addr ptr, 8
                                get_local 13
                                i32.const 8
                                i32.add
                                set_local 13
                            end
                            ;; i = add i32 i, 1
                            get_local 18
                            i32.const 1
                            i32.add
                            set_local 18
                            ;; br 0
                            br 0
                        end
                    end
                    ;; start = decl_var addr 
                    ;; if (ne addr typeMap, 0)
                    get_local 2
                    i32.const 0
                    i32.ne
                    if
                        ;; start = copy addr f
                        get_local 10
                        set_local 19
                        ;; if (eq i32 elementCount, 1)
                        get_local 0
                        i32.const 1
                        i32.eq
                        if
                            ;; %276 = eqz addr headTypeMap
                            get_local 4
                            i32.eqz
                            set_local 21
                        else
                            ;; %276 = const i8 0
                            i32.const 0
                            set_local 21
                        end
                        ;; if %276
                        get_local 21
                        if
                            ;; if (eqz addr start)
                            get_local 19
                            i32.eqz
                            if
                                ;; trap 
                                unreachable
                            end
                            ;; $mem = store s32 start, 0, typeMap
                            get_local 19
                            get_local 2
                            i32.store
                            ;; f = add i32 f, 4
                            get_local 10
                            i32.const 4
                            i32.add
                            set_local 10
                        else
                            ;; if (eqz addr headTypeMap)
                            get_local 4
                            i32.eqz
                            if
                                ;; if (eqz addr start)
                                get_local 19
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store s32 start, 0, (add s32 (xor s32 elementCount, -1), 1)
                                get_local 19
                                get_local 0
                                i32.const -1
                                i32.xor
                                i32.const 1
                                i32.add
                                i32.store
                                ;; start = add addr start, 4
                                get_local 19
                                i32.const 4
                                i32.add
                                set_local 19
                                ;; if (eqz addr start)
                                get_local 19
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store s32 start, 0, typeMap
                                get_local 19
                                get_local 2
                                i32.store
                                ;; f = add i32 f, 8
                                get_local 10
                                i32.const 8
                                i32.add
                                set_local 10
                            else
                                ;; if (eqz addr start)
                                get_local 19
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store s32 start, 0, (add s32 (xor s32 elementCount, -1), 1)
                                get_local 19
                                get_local 0
                                i32.const -1
                                i32.xor
                                i32.const 1
                                i32.add
                                i32.store
                                ;; start = add addr start, 4
                                get_local 19
                                i32.const 4
                                i32.add
                                set_local 19
                                ;; if (eqz addr start)
                                get_local 19
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store s32 start, 0, (add s32 (xor s32 typeMap, -1), 1)
                                get_local 19
                                get_local 2
                                i32.const -1
                                i32.xor
                                i32.const 1
                                i32.add
                                i32.store
                                ;; start = add addr start, 4
                                get_local 19
                                i32.const 4
                                i32.add
                                set_local 19
                                ;; if (eqz addr start)
                                get_local 19
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store s32 start, 0, (add s32 (xor s32 headTypeMap, -1), 1)
                                get_local 19
                                get_local 4
                                i32.const -1
                                i32.xor
                                i32.const 1
                                i32.add
                                i32.store
                                ;; f = add i32 f, 12
                                get_local 10
                                i32.const 12
                                i32.add
                                set_local 10
                            end
                        end
                    else
                        ;; start = decl_var addr 
                        ;; if (ne addr headTypeMap, 0)
                        get_local 4
                        i32.const 0
                        i32.ne
                        if
                            ;; start = copy addr f
                            get_local 10
                            set_local 20
                            ;; if (eqz addr start)
                            get_local 20
                            i32.eqz
                            if
                                ;; trap 
                                unreachable
                            end
                            ;; $mem = store s32 start, 0, headTypeMap
                            get_local 20
                            get_local 4
                            i32.store
                            ;; f = add i32 f, 4
                            get_local 10
                            i32.const 4
                            i32.add
                            set_local 10
                        end
                    end
                    ;; $mem = store i32 block, 4, (add i32 (load i32 block, 4), 1)
                    get_local 11
                    get_local 11
                    i32.load offset=4
                    i32.const 1
                    i32.add
                    i32.store offset=4
                    ;; return addr f
                    get_local 10
                    return
                end
                ;; index = add i32 index, 1
                get_local 8
                i32.const 1
                i32.add
                set_local 8
                ;; br 0
                br 0
            end
        end
        ;; call (addr) => () 3, (call (i32,i32,addr,i32,addr,i32,i8) => (addr) 5, 1, 65536, 0, 0, 0, 3, 0)
        ;; parameter 0
        ;; parameter 0
        i32.const 1
        ;; parameter 1
        i32.const 65536
        ;; parameter 2
        i32.const 0
        ;; parameter 3
        i32.const 0
        ;; parameter 4
        i32.const 0
        ;; parameter 5
        i32.const 3
        ;; parameter 6
        i32.const 0
        get_local 5
        call 5
        get_local 5
        call 3
        ;; return addr (call (i32,i32,addr,i32,addr) => (addr) 6, elementCount, elementSize, typeMap, headSize, headTypeMap)
        ;; parameter 0
        get_local 0
        ;; parameter 1
        get_local 1
        ;; parameter 2
        get_local 2
        ;; parameter 3
        get_local 3
        ;; parameter 4
        get_local 4
        get_local 5
        call 6
        return
        ;; end 
    )
    (func $free (param i32) (param i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; block = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; call (addr,i32) => () 8, (and i32 ptr, (xor i32 65535, -1)), (shr_u i32 (and i32 ptr, 65535), 5)
        ;; parameter 0
        get_local 0
        i32.const 65535
        i32.const -1
        i32.xor
        i32.and
        ;; parameter 1
        get_local 0
        i32.const 65535
        i32.and
        i32.const 5
        i32.shr_u
        get_local 1
        call 8
        ;; end 
    )
    (func $free_intern (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; block = decl_param addr 
        ;; area_nr = decl_param i32 
        ;; i = decl_var i32 
        ;; index = decl_var i32 
        ;; f = decl_var addr 
        ;; i = const i32 0
        i32.const 0
        set_local 3
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, 11)), 1
                get_local 3
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%312 = shr_u i32 area_nr, 1), 1024)
                    get_local 1
                    i32.const 1
                    i32.shr_u
                    tee_local 6
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; if (eqz i8 (and i8 (load i8 (add ptr block, %312), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))))
                    get_local 0
                    get_local 6
                    i32.add
                    i32.load8_u
                    i32.const 4
                    get_local 1
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.and
                    i32.eqz
                    if
                        ;; area_nr = and i32 area_nr, (xor i32 (shl i32 1, i), -1)
                        get_local 1
                        i32.const 1
                        get_local 3
                        i32.shl
                        i32.const -1
                        i32.xor
                        i32.and
                        set_local 1
                        ;; br 1
                        br 1
                    end
                    ;; index = const i32 0
                    i32.const 0
                    set_local 4
                    ;; next_area_nr = decl_var i32 
                    ;; next_area_nr = add i32 area_nr, 1
                    get_local 1
                    i32.const 1
                    i32.add
                    set_local 7
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (lt_u i32 next_area_nr, 2048)), 1
                            get_local 7
                            i32.const 2048
                            i32.lt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; if (ge_u i32 (%326 = shr_u i32 next_area_nr, 1), 1024)
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
                                ;; if (ne i8 (and i8 (load i8 (add ptr block, %326), 0), (shl i32 4, (shl i32 (and i32 next_area_nr, 1), 2))), 0)
                                get_local 0
                                get_local 8
                                i32.add
                                i32.load8_u
                                i32.const 4
                                get_local 7
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
                                get_local 4
                                i32.const 1
                                i32.add
                                set_local 4
                            end
                            ;; next_area_nr = add i32 area_nr, (shl i32 1, index)
                            get_local 1
                            i32.const 1
                            get_local 4
                            i32.shl
                            i32.add
                            set_local 7
                            ;; br 0
                            br 0
                        end
                    end
                    ;; if (ge_u i32 (%337 = shr_u i32 area_nr, 1), 1024)
                    get_local 1
                    i32.const 1
                    i32.shr_u
                    tee_local 9
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %341 = and i8 (load i8 (%339 = add ptr block, %337), 0), (xor i8 (shl i32 15, (shl i32 (and i32 area_nr, 1), 2)), -1)
                    get_local 0
                    get_local 9
                    i32.add
                    tee_local 11
                    i32.load8_u
                    i32.const 15
                    get_local 1
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.const -1
                    i32.xor
                    i32.and
                    set_local 10
                    ;; $mem = store i8 %339, 0, %341
                    get_local 11
                    get_local 10
                    i32.store8
                    ;; f = add i32 block, (shl i32 area_nr, 5)
                    get_local 0
                    get_local 1
                    i32.const 5
                    i32.shl
                    i32.add
                    set_local 5
                    ;; buddy_area_nr = decl_var i32 
                    ;; f_buddy = decl_var addr 
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (lt_u i32 index, 10)), 1
                            get_local 4
                            i32.const 10
                            i32.lt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; buddy_area_nr = xor i32 area_nr, (shl i32 1, index)
                                get_local 1
                                i32.const 1
                                get_local 4
                                i32.shl
                                i32.xor
                                set_local 12
                                ;; if (ge_u i32 (%352 = shr_u i32 buddy_area_nr, 1), 1024)
                                get_local 12
                                i32.const 1
                                i32.shr_u
                                tee_local 14
                                i32.const 1024
                                i32.ge_u
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; if (ne i8 (and i8 (load i8 (add ptr block, %352), 0), (shl i32 3, (shl i32 (and i32 buddy_area_nr, 1), 2))), 0)
                                get_local 0
                                get_local 14
                                i32.add
                                i32.load8_u
                                i32.const 3
                                get_local 12
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
                                get_local 0
                                get_local 12
                                i32.const 5
                                i32.shl
                                i32.add
                                set_local 13
                                ;; if (ne addr (load addr f_buddy, 0), 0)
                                get_local 13
                                i32.load
                                i32.const 0
                                i32.ne
                                if
                                    ;; $mem = store addr (load addr f_buddy, 0), 4, (load addr f_buddy, 4)
                                    get_local 13
                                    i32.load
                                    get_local 13
                                    i32.load offset=4
                                    i32.store offset=4
                                end
                                ;; if (ne addr (load addr f_buddy, 4), 0)
                                get_local 13
                                i32.load offset=4
                                i32.const 0
                                i32.ne
                                if
                                    ;; $mem = store addr (load addr f_buddy, 4), 0, (load addr f_buddy, 0)
                                    get_local 13
                                    i32.load offset=4
                                    get_local 13
                                    i32.load
                                    i32.store
                                else
                                    ;; if (ge_u i32 index, 11)
                                    get_local 4
                                    i32.const 11
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, (load addr f_buddy, 0)
                                    get_global 2
                                    get_local 4
                                    i32.const 4
                                    i32.mul
                                    i32.add
                                    get_local 13
                                    i32.load
                                    i32.store
                                end
                                ;; if (lt_u i32 buddy_area_nr, area_nr)
                                get_local 12
                                get_local 1
                                i32.lt_u
                                if
                                    ;; if (ge_u i32 (%376 = shr_u i32 area_nr, 1), 1024)
                                    get_local 1
                                    i32.const 1
                                    i32.shr_u
                                    tee_local 15
                                    i32.const 1024
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; %380 = and i8 (load i8 (%378 = add ptr block, %376), 0), (xor i8 (shl i32 4, (shl i32 (and i32 area_nr, 1), 2)), -1)
                                    get_local 0
                                    get_local 15
                                    i32.add
                                    tee_local 19
                                    i32.load8_u
                                    i32.const 4
                                    get_local 1
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shl
                                    i32.const -1
                                    i32.xor
                                    i32.and
                                    set_local 18
                                    ;; $mem = store i8 %378, 0, %380
                                    get_local 19
                                    get_local 18
                                    i32.store8
                                    ;; area_nr = copy i32 buddy_area_nr
                                    get_local 12
                                    set_local 1
                                    ;; f = copy addr f_buddy
                                    get_local 13
                                    set_local 5
                                else
                                    ;; if (ge_u i32 (%385 = shr_u i32 buddy_area_nr, 3), 1024)
                                    get_local 12
                                    i32.const 3
                                    i32.shr_u
                                    tee_local 15
                                    i32.const 1024
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; %389 = and i8 (load i8 (%387 = add ptr block, %385), 0), (xor i8 (shl i32 4, (shl i32 (and i32 buddy_area_nr, 1), 2)), -1)
                                    get_local 0
                                    get_local 15
                                    i32.add
                                    tee_local 17
                                    i32.load8_u
                                    i32.const 4
                                    get_local 12
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shl
                                    i32.const -1
                                    i32.xor
                                    i32.and
                                    set_local 16
                                    ;; $mem = store i8 %387, 0, %389
                                    get_local 17
                                    get_local 16
                                    i32.store8
                                end
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
                    ;; if (ge_u i32 index, 11)
                    get_local 4
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr f, 0, (load addr (add ptr root, (mul i32 index, 4)), 0)
                    get_local 5
                    get_global 2
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    i32.store
                    ;; $mem = store addr f, 4, 0
                    get_local 5
                    i32.const 0
                    i32.store offset=4
                    ;; if (ne addr (load addr f, 0), 0)
                    get_local 5
                    i32.load
                    i32.const 0
                    i32.ne
                    if
                        ;; $mem = store addr (load addr f, 0), 4, f
                        get_local 5
                        i32.load
                        get_local 5
                        i32.store offset=4
                    end
                    ;; if (ge_u i32 index, 11)
                    get_local 4
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, f
                    get_global 2
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 5
                    i32.store
                    ;; $mem = store i32 block, 4, (sub i32 (load i32 block, 4), 1)
                    get_local 0
                    get_local 0
                    i32.load offset=4
                    i32.const 1
                    i32.sub
                    i32.store offset=4
                    ;; return 
                    return
                end
                ;; i = add i32 i, 1
                get_local 3
                i32.const 1
                i32.add
                set_local 3
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $blockCountToIndex (param i32) (param i32) (result i32) (local i32) (local i32)
        ;; count = decl_param i32 
        ;; $return = decl_result i32 
        ;; limit = decl_var i32 
        ;; limit = const i32 2
        i32.const 2
        set_local 2
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 3
        ;; block 
        block
            ;; loop 
            loop
                ;; block 
                block
                    ;; if (lt_u i32 count, limit)
                    get_local 0
                    get_local 2
                    i32.lt_u
                    if
                        ;; return i32 i
                        get_local 3
                        return
                    end
                    ;; limit = shl i32 limit, 1
                    get_local 2
                    i32.const 1
                    i32.shl
                    set_local 2
                end
                ;; i = add i32 i, 1
                get_local 3
                i32.const 1
                i32.add
                set_local 3
                ;; br 0
                br 0
            end
        end
        ;; return i32 14
        i32.const 14
        return
        ;; end 
    )
    (func $countBlocks (param i32) (param i32) (result i32) (local i32) (local i32)
        ;; block_nr = decl_param i32 
        ;; $return = decl_result i32 
        ;; end_block_nr = decl_var i32 
        ;; end_block_nr = add i32 block_nr, 1
        get_local 0
        i32.const 1
        i32.add
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 end_block_nr, heapEndBlockNr)), 1
                get_local 2
                get_global 4
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%410 = shr_u i32 end_block_nr, 1), 32768)
                    get_local 2
                    i32.const 1
                    i32.shr_u
                    tee_local 3
                    i32.const 32768
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; if (eq i8 (and i8 (load i8 (add ptr root, %410), 112), (shl i8 4, (shl i32 (and i32 end_block_nr, 1), 2))), 4)
                    get_global 2
                    get_local 3
                    i32.add
                    i32.load8_u offset=112
                    i32.const 4
                    get_local 2
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.and
                    i32.const 4
                    i32.eq
                    if
                        ;; br 3
                        br 3
                    end
                end
                ;; end_block_nr = add i32 end_block_nr, 1
                get_local 2
                i32.const 1
                i32.add
                set_local 2
                ;; br 0
                br 0
            end
        end
        ;; return i32 (sub i32 end_block_nr, block_nr)
        get_local 2
        get_local 0
        i32.sub
        return
        ;; end 
    )
    (func $freeBlocks (param i32) (param i32) (local i32) (local i32) (local i32)
        ;; block_nr = decl_param i32 
        ;; count = decl_var i32 
        ;; index = decl_var i32 
        ;; free = decl_var addr 
        ;; count = call (i32) => (i32) 10, block_nr
        ;; parameter 0
        get_local 0
        get_local 1
        call 10
        set_local 2
        ;; index = call (i32) => (i32) 9, count
        ;; parameter 0
        get_local 2
        get_local 1
        call 9
        set_local 3
        ;; free = shr_u i32 block_nr, 16
        get_local 0
        i32.const 16
        i32.shr_u
        set_local 4
        ;; $mem = store i32 free, 8, count
        get_local 4
        get_local 2
        i32.store offset=8
        ;; if (ge_u i32 index, 15)
        get_local 3
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr free, 0, (load addr (add ptr root, (mul i32 index, 4)), 48)
        get_local 4
        get_global 2
        get_local 3
        i32.const 4
        i32.mul
        i32.add
        i32.load offset=48
        i32.store
        ;; $mem = store addr free, 4, 0
        get_local 4
        i32.const 0
        i32.store offset=4
        ;; if (ne addr (load addr free, 0), 0)
        get_local 4
        i32.load
        i32.const 0
        i32.ne
        if
            ;; $mem = store addr (load addr free, 0), 4, free
            get_local 4
            i32.load
            get_local 4
            i32.store offset=4
        end
        ;; if (ge_u i32 index, 15)
        get_local 3
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, free
        get_global 2
        get_local 3
        i32.const 4
        i32.mul
        i32.add
        get_local 4
        i32.store offset=48
        ;; end 
    )
    (func $mergeAndFreeBlocks (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; free_nr = decl_param i32 
        ;; block_nr = decl_param i32 
        ;; count = decl_var i32 
        ;; free = decl_var addr 
        ;; index = decl_var i32 
        ;; count = call (i32) => (i32) 10, block_nr
        ;; parameter 0
        get_local 1
        get_local 2
        call 10
        set_local 3
        ;; if (ge_u i32 (%434 = shr_u i32 block_nr, 1), 32768)
        get_local 1
        i32.const 1
        i32.shr_u
        tee_local 6
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %438 = and i8 (load i8 (%436 = add ptr root, %434), 112), (xor i8 (shl i8 4, (shl i32 (and i32 block_nr, 1), 2)), -1)
        get_global 2
        get_local 6
        i32.add
        tee_local 8
        i32.load8_u offset=112
        i32.const 4
        get_local 1
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.const -1
        i32.xor
        i32.and
        set_local 7
        ;; $mem = store i8 %436, 112, %438
        get_local 8
        get_local 7
        i32.store8 offset=112
        ;; free = shr_u i32 free_nr, 16
        get_local 0
        i32.const 16
        i32.shr_u
        set_local 4
        ;; if (ne addr (load addr free, 0), 0)
        get_local 4
        i32.load
        i32.const 0
        i32.ne
        if
            ;; $mem = store addr (load addr free, 0), 4, (load addr free, 4)
            get_local 4
            i32.load
            get_local 4
            i32.load offset=4
            i32.store offset=4
        end
        ;; if (ne addr (load addr free, 4), 0)
        get_local 4
        i32.load offset=4
        i32.const 0
        i32.ne
        if
            ;; $mem = store addr (load addr free, 4), 0, (load addr free, 0)
            get_local 4
            i32.load offset=4
            get_local 4
            i32.load
            i32.store
        else
            ;; index = decl_var i32 
            ;; index = call (i32) => (i32) 9, (load i32 free, 8)
            ;; parameter 0
            get_local 4
            i32.load offset=8
            get_local 2
            call 9
            set_local 9
            ;; if (ge_u i32 index, 15)
            get_local 9
            i32.const 15
            i32.ge_u
            if
                ;; trap 
                unreachable
            end
            ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr free, 0)
            get_global 2
            get_local 9
            i32.const 4
            i32.mul
            i32.add
            get_local 4
            i32.load
            i32.store offset=48
        end
        ;; $mem = store i32 free, 8, (add i32 (load i32 free, 8), count)
        get_local 4
        get_local 4
        i32.load offset=8
        get_local 3
        i32.add
        i32.store offset=8
        ;; index = call (i32) => (i32) 9, (load i32 free, 8)
        ;; parameter 0
        get_local 4
        i32.load offset=8
        get_local 2
        call 9
        set_local 5
        ;; if (ge_u i32 index, 15)
        get_local 5
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr free, 0, (load addr (add ptr root, (mul i32 index, 4)), 48)
        get_local 4
        get_global 2
        get_local 5
        i32.const 4
        i32.mul
        i32.add
        i32.load offset=48
        i32.store
        ;; $mem = store addr free, 4, 0
        get_local 4
        i32.const 0
        i32.store offset=4
        ;; if (ne addr (load addr free, 0), 0)
        get_local 4
        i32.load
        i32.const 0
        i32.ne
        if
            ;; $mem = store addr (load addr free, 0), 4, free
            get_local 4
            i32.load
            get_local 4
            i32.store offset=4
        end
        ;; if (ge_u i32 index, 15)
        get_local 5
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, free
        get_global 2
        get_local 5
        i32.const 4
        i32.mul
        i32.add
        get_local 4
        i32.store offset=48
        ;; end 
    )
    (func $garbageCollect (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; typemap = decl_var addr 
        ;; latestFreeBlock_nr = decl_var i32 
        ;; gcEpoch = xor i32 gcEpoch, 3
        get_global 5
        i32.const 3
        i32.xor
        set_global 5
        ;; if (eqz addr (%474 = load ptr (addr_of ptr coroutine), 0))
        i32.const 320
        i32.load
        tee_local 3
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr %474, 8, (call () => (addr) -8)
        get_local 3
        get_local 0
        i32.store offset=8
        ;; call (addr,addr) => () 19, 0, (call () => (addr) -4)
        ;; parameter 0
        i32.const 0
        ;; parameter 1
        get_global 1
        get_local 0
        call 19
        ;; call (ptr) => () 0, 8
        ;; Create stack frame for 0
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; Store typemap
        get_local 0
        i32.const 344
        i32.store offset=4
        ;; parameter 0
        get_local 0
        i32.const 8
        i32.store
        get_local 0
        call 0
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        ;; block_nr = decl_var i32 
        ;; flags = decl_var i8 
        ;; block_nr = copy i32 heapStartBlockNr
        get_global 3
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 block_nr, heapEndBlockNr)), 1
                get_local 4
                get_global 4
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%482 = shr_u i32 block_nr, 1), 32768)
                    get_local 4
                    i32.const 1
                    i32.shr_u
                    tee_local 6
                    i32.const 32768
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; flags = and i8 (shr_u i8 (load i8 (add ptr root, %482), 112), (shl i32 (and i32 block_nr, 1), 2)), 15
                    get_global 2
                    get_local 6
                    i32.add
                    i32.load8_u offset=112
                    get_local 4
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shr_u
                    i32.const 15
                    i32.and
                    set_local 5
                    ;; block = decl_var addr 
                    ;; if (eq i8 (and i8 flags, 3), 3)
                    get_local 5
                    i32.const 3
                    i32.and
                    i32.const 3
                    i32.eq
                    if
                        ;; call (ptr) => () 0, 32
                        ;; Create stack frame for 0
                        get_local 0
                        i32.const 8
                        i32.sub
                        set_local 0
                        ;; Store typemap
                        get_local 0
                        i32.const 360
                        i32.store offset=4
                        ;; parameter 0
                        get_local 0
                        i32.const 32
                        i32.store
                        get_local 0
                        call 0
                        ;; Remove parameters
                        get_local 0
                        i32.const 8
                        i32.add
                        set_local 0
                        ;; call (i32) => () 1, block_nr
                        ;; parameter 0
                        get_local 4
                        get_local 0
                        call 1
                        ;; latestFreeBlock_nr = const i32 0
                        i32.const 0
                        set_local 2
                        ;; block = shl i32 block_nr, 16
                        get_local 4
                        i32.const 16
                        i32.shl
                        set_local 7
                        ;; call (i32) => () 1, (load i32 block, 4)
                        ;; parameter 0
                        get_local 7
                        i32.load offset=4
                        get_local 0
                        call 1
                        ;; call (i32) => () 1, (load i32 block, 8)
                        ;; parameter 0
                        get_local 7
                        i32.load offset=8
                        get_local 0
                        call 1
                        ;; if (eq i32 (load i32 block, 4), (load i32 block, 8))
                        get_local 7
                        i32.load offset=4
                        get_local 7
                        i32.load offset=8
                        i32.eq
                        if
                            ;; call (ptr) => () 0, 48
                            ;; Create stack frame for 0
                            get_local 0
                            i32.const 8
                            i32.sub
                            set_local 0
                            ;; Store typemap
                            get_local 0
                            i32.const 376
                            i32.store offset=4
                            ;; parameter 0
                            get_local 0
                            i32.const 48
                            i32.store
                            get_local 0
                            call 0
                            ;; Remove parameters
                            get_local 0
                            i32.const 8
                            i32.add
                            set_local 0
                            ;; $mem = store i32 block, 8, 0
                            get_local 7
                            i32.const 0
                            i32.store offset=8
                            ;; br 2
                            br 2
                        end
                        ;; call (ptr) => () 0, 72
                        ;; Create stack frame for 0
                        get_local 0
                        i32.const 8
                        i32.sub
                        set_local 0
                        ;; Store typemap
                        get_local 0
                        i32.const 392
                        i32.store offset=4
                        ;; parameter 0
                        get_local 0
                        i32.const 72
                        i32.store
                        get_local 0
                        call 0
                        ;; Remove parameters
                        get_local 0
                        i32.const 8
                        i32.add
                        set_local 0
                        ;; call (i32) => () 1, block_nr
                        ;; parameter 0
                        get_local 4
                        get_local 0
                        call 1
                        ;; area_nr = decl_var i32 
                        ;; area_flags = decl_var i8 
                        ;; area_nr = const i32 32
                        i32.const 32
                        set_local 8
                        ;; block 
                        block
                            ;; loop 
                            loop
                                ;; br_if (eqz i8 (lt_u i32 area_nr, 2048)), 1
                                get_local 8
                                i32.const 2048
                                i32.lt_u
                                i32.eqz
                                br_if 1
                                ;; block 
                                block
                                    ;; if (ge_u i32 (%507 = shr_u i32 area_nr, 1), 1024)
                                    get_local 8
                                    i32.const 1
                                    i32.shr_u
                                    tee_local 10
                                    i32.const 1024
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; area_flags = and i8 (shr_u i8 (load i8 (add ptr block, %507), 0), (shl i32 (and i32 area_nr, 1), 2)), 15
                                    get_local 7
                                    get_local 10
                                    i32.add
                                    i32.load8_u
                                    get_local 8
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shr_u
                                    i32.const 15
                                    i32.and
                                    set_local 11
                                    ;; if (eqz i8 (and i8 area_flags, 4))
                                    get_local 11
                                    i32.const 4
                                    i32.and
                                    i32.eqz
                                    if
                                        ;; br 1
                                        br 1
                                    end
                                    ;; call (i32) => () 1, (add i32 (shl i32 block_nr, 16), (shl i32 area_nr, 5))
                                    ;; parameter 0
                                    get_local 4
                                    i32.const 16
                                    i32.shl
                                    get_local 8
                                    i32.const 5
                                    i32.shl
                                    i32.add
                                    get_local 0
                                    call 1
                                    ;; call (i32) => () 1, area_flags
                                    ;; parameter 0
                                    get_local 11
                                    get_local 0
                                    call 1
                                    ;; if (eqz i8 (and i8 area_flags, 3))
                                    get_local 11
                                    i32.const 3
                                    i32.and
                                    i32.eqz
                                    if
                                        ;; br 1
                                        br 1
                                    end
                                    ;; if (ne i8 (and i8 area_flags, 3), gcEpoch)
                                    get_local 11
                                    i32.const 3
                                    i32.and
                                    get_global 5
                                    i32.ne
                                    if
                                        ;; call (ptr) => () 0, 96
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 408
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 96
                                        i32.store
                                        get_local 0
                                        call 0
                                        ;; Remove parameters
                                        get_local 0
                                        i32.const 8
                                        i32.add
                                        set_local 0
                                        ;; call (i32) => () 1, (add i32 (shl i32 block_nr, 16), (shl i32 area_nr, 5))
                                        ;; parameter 0
                                        get_local 4
                                        i32.const 16
                                        i32.shl
                                        get_local 8
                                        i32.const 5
                                        i32.shl
                                        i32.add
                                        get_local 0
                                        call 1
                                        ;; call (addr,i32) => () 8, block, area_nr
                                        ;; parameter 0
                                        get_local 7
                                        ;; parameter 1
                                        get_local 8
                                        get_local 0
                                        call 8
                                        ;; call (ptr) => () 0, 120
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 424
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 120
                                        i32.store
                                        get_local 0
                                        call 0
                                        ;; Remove parameters
                                        get_local 0
                                        i32.const 8
                                        i32.add
                                        set_local 0
                                    end
                                end
                                ;; area_nr = add i32 area_nr, 1
                                get_local 8
                                i32.const 1
                                i32.add
                                set_local 8
                                ;; br 0
                                br 0
                            end
                        end
                    else
                        ;; if (eqz i8 (and i8 flags, 3))
                        get_local 5
                        i32.const 3
                        i32.and
                        i32.eqz
                        if
                            ;; if (eqz i32 latestFreeBlock_nr)
                            get_local 2
                            i32.eqz
                            if
                                ;; latestFreeBlock_nr = copy i32 block_nr
                                get_local 4
                                set_local 2
                            end
                        else
                            ;; if (ne i8 (and i8 flags, 3), gcEpoch)
                            get_local 5
                            i32.const 3
                            i32.and
                            get_global 5
                            i32.ne
                            if
                                ;; call (ptr) => () 0, 136
                                ;; Create stack frame for 0
                                get_local 0
                                i32.const 8
                                i32.sub
                                set_local 0
                                ;; Store typemap
                                get_local 0
                                i32.const 440
                                i32.store offset=4
                                ;; parameter 0
                                get_local 0
                                i32.const 136
                                i32.store
                                get_local 0
                                call 0
                                ;; Remove parameters
                                get_local 0
                                i32.const 8
                                i32.add
                                set_local 0
                                ;; call (i32) => () 1, block_nr
                                ;; parameter 0
                                get_local 4
                                get_local 0
                                call 1
                                ;; if (ge_u i32 (%540 = shr_u i32 block_nr, 1), 32768)
                                get_local 4
                                i32.const 1
                                i32.shr_u
                                tee_local 8
                                i32.const 32768
                                i32.ge_u
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; %544 = and i8 (load i8 (%542 = add ptr root, %540), 112), (xor i8 (shl i32 3, (shl i32 (and i32 block_nr, 1), 2)), -1)
                                get_global 2
                                get_local 8
                                i32.add
                                tee_local 10
                                i32.load8_u offset=112
                                i32.const 3
                                get_local 4
                                i32.const 1
                                i32.and
                                i32.const 2
                                i32.shl
                                i32.shl
                                i32.const -1
                                i32.xor
                                i32.and
                                set_local 9
                                ;; $mem = store i8 %542, 112, %544
                                get_local 10
                                get_local 9
                                i32.store8 offset=112
                                ;; if (eq i8 (and i8 flags, 4), 4)
                                get_local 5
                                i32.const 4
                                i32.and
                                i32.const 4
                                i32.eq
                                if
                                    ;; if (eqz i32 latestFreeBlock_nr)
                                    get_local 2
                                    i32.eqz
                                    if
                                        ;; call (ptr) => () 0, 168
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 456
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 168
                                        i32.store
                                        get_local 0
                                        call 0
                                        ;; Remove parameters
                                        get_local 0
                                        i32.const 8
                                        i32.add
                                        set_local 0
                                        ;; latestFreeBlock_nr = copy i32 block_nr
                                        get_local 4
                                        set_local 2
                                        ;; call (i32) => () 11, latestFreeBlock_nr
                                        ;; parameter 0
                                        get_local 2
                                        get_local 0
                                        call 11
                                    else
                                        ;; call (ptr) => () 0, 200
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 472
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 200
                                        i32.store
                                        get_local 0
                                        call 0
                                        ;; Remove parameters
                                        get_local 0
                                        i32.const 8
                                        i32.add
                                        set_local 0
                                        ;; call (i32) => () 1, latestFreeBlock_nr
                                        ;; parameter 0
                                        get_local 2
                                        get_local 0
                                        call 1
                                        ;; call (i32,i32) => () 12, latestFreeBlock_nr, block_nr
                                        ;; parameter 0
                                        get_local 2
                                        ;; parameter 1
                                        get_local 4
                                        get_local 0
                                        call 12
                                    end
                                end
                            end
                        end
                    end
                end
                ;; block_nr = add i32 block_nr, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $mark (param i32) (param i32) (local i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; block_nr = decl_var i32 
        ;; flags = decl_var i8 
        ;; block_nr = shr_u i32 ptr, 16
        get_local 0
        i32.const 16
        i32.shr_u
        set_local 2
        ;; if (lt_u i32 block_nr, heapStartBlockNr)
        get_local 2
        get_global 3
        i32.lt_u
        if
            ;; return 
            return
        end
        ;; if (ge_u i32 (%559 = shr_u i32 block_nr, 1), 32768)
        get_local 2
        i32.const 1
        i32.shr_u
        tee_local 4
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; flags = and i8 (shr_u i8 (load i8 (add ptr root, %559), 112), (shl i32 (and i32 block_nr, 1), 2)), 15
        get_global 2
        get_local 4
        i32.add
        i32.load8_u offset=112
        get_local 2
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shr_u
        i32.const 15
        i32.and
        set_local 3
        ;; if (eq i8 (and i8 flags, 3), gcEpoch)
        get_local 3
        i32.const 3
        i32.and
        get_global 5
        i32.eq
        if
            ;; return 
            return
        end
        ;; if (eq i8 (and i8 flags, 3), 3)
        get_local 3
        i32.const 3
        i32.and
        i32.const 3
        i32.eq
        if
            ;; call (addr,i32) => () 15, (shl i32 block_nr, 16), (shr_u i32 (and addr ptr, 65535), 5)
            ;; parameter 0
            get_local 2
            i32.const 16
            i32.shl
            ;; parameter 1
            get_local 0
            i32.const 65535
            i32.and
            i32.const 5
            i32.shr_u
            get_local 1
            call 15
        else
            ;; if (ne i8 (and i8 flags, 3), 0)
            get_local 3
            i32.const 3
            i32.and
            i32.const 0
            i32.ne
            if
                ;; call (i32) => () 16, block_nr
                ;; parameter 0
                get_local 2
                get_local 1
                call 16
            end
        end
        ;; end 
    )
    (func $markArea (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; block = decl_param addr 
        ;; area_nr = decl_param i32 
        ;; i = decl_var i32 
        ;; area_flags = decl_var i8 
        ;; i = const i32 0
        i32.const 0
        set_local 3
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, 11)), 1
                get_local 3
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%580 = shr_u i32 area_nr, 1), 1024)
                    get_local 1
                    i32.const 1
                    i32.shr_u
                    tee_local 5
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; area_flags = and i8 (shr_u i8 (load i8 (add ptr block, %580), 0), (shl i32 (and i32 area_nr, 1), 2)), 15
                    get_local 0
                    get_local 5
                    i32.add
                    i32.load8_u
                    get_local 1
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shr_u
                    i32.const 15
                    i32.and
                    set_local 4
                    ;; if (eqz i8 (and i8 area_flags, 4))
                    get_local 4
                    i32.const 4
                    i32.and
                    i32.eqz
                    if
                        ;; area_nr = and i32 area_nr, (xor i32 (shl i32 1, i), -1)
                        get_local 1
                        i32.const 1
                        get_local 3
                        i32.shl
                        i32.const -1
                        i32.xor
                        i32.and
                        set_local 1
                        ;; br 1
                        br 1
                    end
                    ;; if (eq i8 (and i8 area_flags, 3), gcEpoch)
                    get_local 4
                    i32.const 3
                    i32.and
                    get_global 5
                    i32.eq
                    if
                        ;; return 
                        return
                    end
                    ;; if (ge_u i32 (%594 = shr_u i32 area_nr, 1), 1024)
                    get_local 1
                    i32.const 1
                    i32.shr_u
                    tee_local 6
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %598 = xor i8 (load i8 (%596 = add ptr block, %594), 0), (shl i8 3, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 0
                    get_local 6
                    i32.add
                    tee_local 8
                    i32.load8_u
                    i32.const 3
                    get_local 1
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.xor
                    set_local 7
                    ;; $mem = store i8 %596, 0, %598
                    get_local 8
                    get_local 7
                    i32.store8
                    ;; $mem = store i32 block, 8, (add i32 (load i32 block, 8), 1)
                    get_local 0
                    get_local 0
                    i32.load offset=8
                    i32.const 1
                    i32.add
                    i32.store offset=8
                    ;; if (eq i8 (and i8 area_flags, 8), 8)
                    get_local 4
                    i32.const 8
                    i32.and
                    i32.const 8
                    i32.eq
                    if
                        ;; call (addr) => () 17, (add i32 block, (shl i32 area_nr, 5))
                        ;; parameter 0
                        get_local 0
                        get_local 1
                        i32.const 5
                        i32.shl
                        i32.add
                        get_local 2
                        call 17
                    end
                    ;; return 
                    return
                end
                ;; i = add i32 i, 1
                get_local 3
                i32.const 1
                i32.add
                set_local 3
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $markBlocks (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; block_nr = decl_param i32 
        ;; flags = decl_var i8 
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ge_u i32 block_nr, heapStartBlockNr)), 1
                get_local 0
                get_global 3
                i32.ge_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%611 = shr_u i32 block_nr, 1), 32768)
                    get_local 0
                    i32.const 1
                    i32.shr_u
                    tee_local 3
                    i32.const 32768
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; flags = and i8 (shr_u i8 (load i8 (add ptr root, %611), 112), (shl i32 (and i32 block_nr, 1), 2)), 15
                    get_global 2
                    get_local 3
                    i32.add
                    i32.load8_u offset=112
                    get_local 0
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shr_u
                    i32.const 15
                    i32.and
                    set_local 2
                    ;; if (eq i8 (and i8 flags, 4), 4)
                    get_local 2
                    i32.const 4
                    i32.and
                    i32.const 4
                    i32.eq
                    if
                        ;; if (ge_u i32 (%621 = shr_u i32 block_nr, 1), 32768)
                        get_local 0
                        i32.const 1
                        i32.shr_u
                        tee_local 4
                        i32.const 32768
                        i32.ge_u
                        if
                            ;; trap 
                            unreachable
                        end
                        ;; %625 = xor i8 (load i8 (%623 = add ptr root, %621), 112), (shl i8 3, (shl i32 (and i32 block_nr, 1), 2))
                        get_global 2
                        get_local 4
                        i32.add
                        tee_local 8
                        i32.load8_u offset=112
                        i32.const 3
                        get_local 0
                        i32.const 1
                        i32.and
                        i32.const 2
                        i32.shl
                        i32.shl
                        i32.xor
                        set_local 7
                        ;; $mem = store i8 %623, 112, %625
                        get_local 8
                        get_local 7
                        i32.store8 offset=112
                        ;; if (eq i8 (and i8 flags, 8), 8)
                        get_local 2
                        i32.const 8
                        i32.and
                        i32.const 8
                        i32.eq
                        if
                            ;; call (addr) => () 17, (shl i32 block_nr, 16)
                            ;; parameter 0
                            get_local 0
                            i32.const 16
                            i32.shl
                            get_local 1
                            call 17
                        end
                        ;; return 
                        return
                    else
                        ;; if (eq i8 (and i8 flags, 3), gcEpoch)
                        get_local 2
                        i32.const 3
                        i32.and
                        get_global 5
                        i32.eq
                        if
                            ;; return 
                            return
                        else
                            ;; if (ge_u i32 (%635 = shr_u i32 block_nr, 1), 32768)
                            get_local 0
                            i32.const 1
                            i32.shr_u
                            tee_local 4
                            i32.const 32768
                            i32.ge_u
                            if
                                ;; trap 
                                unreachable
                            end
                            ;; %639 = or i8 (load i8 (%637 = add ptr root, %635), 112), (shl i8 gcEpoch, (shl i32 (and i32 block_nr, 1), 2))
                            get_global 2
                            get_local 4
                            i32.add
                            tee_local 6
                            i32.load8_u offset=112
                            get_global 5
                            get_local 0
                            i32.const 1
                            i32.and
                            i32.const 2
                            i32.shl
                            i32.shl
                            i32.or
                            set_local 5
                            ;; $mem = store i8 %637, 112, %639
                            get_local 6
                            get_local 5
                            i32.store8 offset=112
                        end
                    end
                end
                ;; block_nr = sub i32 block_nr, 1
                get_local 0
                i32.const 1
                i32.sub
                set_local 0
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $traverseHeapArea (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; iptr = decl_var addr 
        ;; first = decl_var s32 
        ;; elementCount = decl_var s32 
        ;; typemap = decl_var addr 
        ;; data = decl_var addr 
        ;; size = decl_var i32 
        ;; iptr = copy addr ptr
        get_local 0
        set_local 2
        ;; first = load s32 iptr, 0
        get_local 2
        i32.load
        set_local 3
        ;; iptr = add addr iptr, 4
        get_local 2
        i32.const 4
        i32.add
        set_local 2
        ;; typemap = decl_var addr 
        ;; if (gt_s s32 first, 0)
        get_local 3
        i32.const 0
        i32.gt_s
        if
            ;; call (addr,addr) => () 19, iptr, (copy addr first)
            ;; parameter 0
            get_local 2
            ;; parameter 1
            get_local 3
            get_local 1
            call 19
            ;; return 
            return
        end
        ;; if (eqz s32 first)
        get_local 3
        i32.eqz
        if
            ;; call (addr) => () 18, ptr
            ;; parameter 0
            get_local 0
            get_local 1
            call 18
            ;; return 
            return
        end
        ;; elementCount = add s32 (xor s32 first, -1), 1
        get_local 3
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        set_local 4
        ;; typemap = load s32 iptr, 0
        get_local 2
        i32.load
        set_local 5
        ;; iptr = add addr iptr, 4
        get_local 2
        i32.const 4
        i32.add
        set_local 2
        ;; data = copy addr iptr
        get_local 2
        set_local 6
        ;; typemap2 = decl_var s32 
        ;; if (lt_s s32 typemap, 0)
        get_local 5
        i32.const 0
        i32.lt_s
        if
            ;; typemap = add s32 (xor s32 typemap, -1), 1
            get_local 5
            i32.const -1
            i32.xor
            i32.const 1
            i32.add
            set_local 5
            ;; data = add addr data, 4
            get_local 6
            i32.const 4
            i32.add
            set_local 6
            ;; call (addr,addr) => () 19, data, (load s32 iptr, 0)
            ;; parameter 0
            get_local 6
            ;; parameter 1
            get_local 2
            i32.load
            get_local 1
            call 19
            ;; data = add addr data, (load s32 typemap, 0)
            get_local 6
            get_local 5
            i32.load
            i32.add
            set_local 6
        end
        ;; size = load s32 typemap, 0
        get_local 5
        i32.load
        set_local 7
        ;; i = decl_var s32 
        ;; i = const s32 0
        i32.const 0
        set_local 10
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 i, elementCount)), 1
                get_local 10
                get_local 4
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; call (addr,addr) => () 19, data, typemap
                    ;; parameter 0
                    get_local 6
                    ;; parameter 1
                    get_local 5
                    get_local 1
                    call 19
                    ;; data = add addr data, size
                    get_local 6
                    get_local 7
                    i32.add
                    set_local 6
                end
                ;; i = add s32 i, 1
                get_local 10
                i32.const 1
                i32.add
                set_local 10
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $traverseStack (param i32) (param i32) (local i32) (local i32) (local i32) (local i32)
        ;; stack = decl_param addr 
        ;; tos = decl_var addr 
        ;; ptr = decl_var addr 
        ;; call (ptr) => () 0, 224
        ;; Create stack frame for 0
        get_local 1
        i32.const 8
        i32.sub
        set_local 1
        ;; Store typemap
        get_local 1
        i32.const 488
        i32.store offset=4
        ;; parameter 0
        get_local 1
        i32.const 224
        i32.store
        get_local 1
        call 0
        ;; Remove parameters
        get_local 1
        i32.const 8
        i32.add
        set_local 1
        ;; call (i32) => () 1, stack
        ;; parameter 0
        get_local 0
        get_local 1
        call 1
        ;; tos = load addr stack, 8
        get_local 0
        i32.load offset=8
        set_local 2
        ;; call (i32) => () 1, tos
        ;; parameter 0
        get_local 2
        get_local 1
        call 1
        ;; ptr = load addr stack, 4
        get_local 0
        i32.load offset=4
        set_local 3
        ;; typemapOrSize = decl_var s32 
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (gt_u addr ptr, tos)), 1
                get_local 3
                get_local 2
                i32.gt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; call (ptr) => () 0, 248
                    ;; Create stack frame for 0
                    get_local 1
                    i32.const 8
                    i32.sub
                    set_local 1
                    ;; Store typemap
                    get_local 1
                    i32.const 504
                    i32.store offset=4
                    ;; parameter 0
                    get_local 1
                    i32.const 248
                    i32.store
                    get_local 1
                    call 0
                    ;; Remove parameters
                    get_local 1
                    i32.const 8
                    i32.add
                    set_local 1
                    ;; call (i32) => () 1, ptr
                    ;; parameter 0
                    get_local 3
                    get_local 1
                    call 1
                    ;; typemapOrSize = load s32 (sub addr ptr, (mul i32 1, 4)), 0
                    get_local 3
                    i32.const 1
                    i32.const 4
                    i32.mul
                    i32.sub
                    i32.load
                    set_local 4
                    ;; if (lt_s s32 typemapOrSize, 0)
                    get_local 4
                    i32.const 0
                    i32.lt_s
                    if
                        ;; ptr = add addr ptr, typemapOrSize
                        get_local 3
                        get_local 4
                        i32.add
                        set_local 3
                    else
                        ;; typemap = decl_var addr 
                        ;; typemap = load s32 (sub addr ptr, (mul i32 1, 4)), 0
                        get_local 3
                        i32.const 1
                        i32.const 4
                        i32.mul
                        i32.sub
                        i32.load
                        set_local 5
                        ;; ptr = sub addr ptr, (load s32 typemap, 0)
                        get_local 3
                        get_local 5
                        i32.load
                        i32.sub
                        set_local 3
                        ;; call (i32) => () 1, ptr
                        ;; parameter 0
                        get_local 3
                        get_local 1
                        call 1
                        ;; call (i32) => () 1, typemap
                        ;; parameter 0
                        get_local 5
                        get_local 1
                        call 1
                        ;; call (i32) => () 1, (load s32 typemap, 0)
                        ;; parameter 0
                        get_local 5
                        i32.load
                        get_local 1
                        call 1
                        ;; call (addr,addr) => () 19, ptr, typemap
                        ;; parameter 0
                        get_local 3
                        ;; parameter 1
                        get_local 5
                        get_local 1
                        call 19
                    end
                    ;; call (ptr) => () 0, 264
                    ;; Create stack frame for 0
                    get_local 1
                    i32.const 8
                    i32.sub
                    set_local 1
                    ;; Store typemap
                    get_local 1
                    i32.const 520
                    i32.store offset=4
                    ;; parameter 0
                    get_local 1
                    i32.const 264
                    i32.store
                    get_local 1
                    call 0
                    ;; Remove parameters
                    get_local 1
                    i32.const 8
                    i32.add
                    set_local 1
                end
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $traverseType (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; typemap = decl_param addr 
        ;; entries_end = decl_var s32 
        ;; call (ptr) => () 0, 288
        ;; Create stack frame for 0
        get_local 2
        i32.const 8
        i32.sub
        set_local 2
        ;; Store typemap
        get_local 2
        i32.const 536
        i32.store offset=4
        ;; parameter 0
        get_local 2
        i32.const 288
        i32.store
        get_local 2
        call 0
        ;; Remove parameters
        get_local 2
        i32.const 8
        i32.add
        set_local 2
        ;; call (i32) => () 1, (load s32 (add addr typemap, (mul i32 1, 4)), 0)
        ;; parameter 0
        get_local 1
        i32.const 1
        i32.const 4
        i32.mul
        i32.add
        i32.load
        get_local 2
        call 1
        ;; entries_end = add s32 (load s32 (add addr typemap, (mul i32 1, 4)), 0), 2
        get_local 1
        i32.const 1
        i32.const 4
        i32.mul
        i32.add
        i32.load
        i32.const 2
        i32.add
        set_local 3
        ;; i = decl_var s32 
        ;; a = decl_var s32 
        ;; i = const s32 2
        i32.const 2
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 i, entries_end)), 1
                get_local 4
                get_local 3
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; a = load s32 (add addr typemap, (mul i32 i, 4)), 0
                    get_local 1
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    set_local 5
                    ;; count = decl_var s32 
                    ;; b = decl_var s32 
                    ;; if (lt_s s32 a, 0)
                    get_local 5
                    i32.const 0
                    i32.lt_s
                    if
                        ;; count = add s32 (xor s32 a, -1), 1
                        get_local 5
                        i32.const -1
                        i32.xor
                        i32.const 1
                        i32.add
                        set_local 6
                        ;; i = add s32 i, 1
                        get_local 4
                        i32.const 1
                        i32.add
                        set_local 4
                        ;; b = load s32 (add addr typemap, (mul i32 i, 4)), 0
                        get_local 1
                        get_local 4
                        i32.const 4
                        i32.mul
                        i32.add
                        i32.load
                        set_local 7
                        ;; typemap2 = decl_var addr 
                        ;; ptr2 = decl_var addr 
                        ;; size = decl_var i32 
                        ;; if (lt_s s32 b, 0)
                        get_local 7
                        i32.const 0
                        i32.lt_s
                        if
                            ;; typemap2 = add s32 (xor s32 b, -1), 1
                            get_local 7
                            i32.const -1
                            i32.xor
                            i32.const 1
                            i32.add
                            set_local 9
                            ;; i = add s32 i, 1
                            get_local 4
                            i32.const 1
                            i32.add
                            set_local 4
                            ;; ptr2 = add i32 ptr, (load s32 (add addr typemap, (mul i32 i, 4)), 0)
                            get_local 0
                            get_local 1
                            get_local 4
                            i32.const 4
                            i32.mul
                            i32.add
                            i32.load
                            i32.add
                            set_local 10
                            ;; size = load s32 typemap2, 0
                            get_local 9
                            i32.load
                            set_local 10
                            ;; k = decl_var s32 
                            ;; k = const s32 0
                            i32.const 0
                            set_local 13
                            ;; block 
                            block
                                ;; loop 
                                loop
                                    ;; br_if (eqz i8 (lt_s s32 k, count)), 1
                                    get_local 13
                                    get_local 6
                                    i32.lt_s
                                    i32.eqz
                                    br_if 1
                                    ;; block 
                                    block
                                        ;; call (addr,addr) => () 19, ptr2, typemap2
                                        ;; parameter 0
                                        get_local 10
                                        ;; parameter 1
                                        get_local 9
                                        get_local 2
                                        call 19
                                        ;; ptr2 = add addr ptr2, size
                                        get_local 10
                                        get_local 10
                                        i32.add
                                        set_local 10
                                    end
                                    ;; k = add s32 k, 1
                                    get_local 13
                                    i32.const 1
                                    i32.add
                                    set_local 13
                                    ;; br 0
                                    br 0
                                end
                            end
                        else
                            ;; ptr2 = decl_var addr 
                            ;; ptr2 = add i32 ptr, b
                            get_local 0
                            get_local 7
                            i32.add
                            set_local 11
                            ;; k = decl_var s32 
                            ;; k = const s32 0
                            i32.const 0
                            set_local 12
                            ;; block 
                            block
                                ;; loop 
                                loop
                                    ;; br_if (eqz i8 (lt_s s32 k, count)), 1
                                    get_local 12
                                    get_local 6
                                    i32.lt_s
                                    i32.eqz
                                    br_if 1
                                    ;; block 
                                    block
                                        ;; call (addr) => () 14, ptr2
                                        ;; parameter 0
                                        get_local 11
                                        get_local 2
                                        call 14
                                        ;; ptr2 = add addr ptr2, 4
                                        get_local 11
                                        i32.const 4
                                        i32.add
                                        set_local 11
                                    end
                                    ;; k = add s32 k, 1
                                    get_local 12
                                    i32.const 1
                                    i32.add
                                    set_local 12
                                    ;; br 0
                                    br 0
                                end
                            end
                        end
                    else
                        ;; p = decl_var addr 
                        ;; call (i32) => () 1, (add i32 ptr, a)
                        ;; parameter 0
                        get_local 0
                        get_local 5
                        i32.add
                        get_local 2
                        call 1
                        ;; call (addr) => () 14, (load addr (add i32 ptr, a), 0)
                        ;; parameter 0
                        get_local 0
                        get_local 5
                        i32.add
                        i32.load
                        get_local 2
                        call 14
                    end
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
        ;; end 
    )
    (func $copy (param i32) (param i32) (param i32) (param i32) (local i32)
        ;; dest = decl_param addr 
        ;; src = decl_param addr 
        ;; count = decl_param i32 
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, count)), 1
                get_local 4
                get_local 2
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; $mem = store i8 (add addr dest, i), 0, (load i8 (add addr src, i), 0)
                    get_local 0
                    get_local 4
                    i32.add
                    get_local 1
                    get_local 4
                    i32.add
                    i32.load8_u
                    i32.store8
                end
                ;; i = add i32 i, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; end 
    )
    (func $concatString (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 0
        set_local 1
        ;; str1 = decl_param ptr 
        ;; str2 = decl_param ptr 
        ;; $return = decl_result ptr 
        ;; s1 = decl_var i32 
        ;; s2 = decl_var i32 
        ;; p = decl_var addr 
        ;; dest = decl_var addr 
        ;; src = decl_var addr 
        ;; s1 = load i32 str1, 0
        get_local 1
        i32.load
        i32.load
        set_local 2
        ;; s2 = load i32 str2, 0
        get_local 1
        i32.load offset=4
        i32.load
        set_local 3
        ;; p = call (i32,i32,addr,i32,addr) => (addr) 6, (add i32 4, (add i32 s1, s2)), 1, 0, 0, 0
        ;; parameter 0
        i32.const 4
        get_local 2
        get_local 3
        i32.add
        i32.add
        ;; parameter 1
        i32.const 1
        ;; parameter 2
        i32.const 0
        ;; parameter 3
        i32.const 0
        ;; parameter 4
        i32.const 0
        get_local 0
        call 6
        set_local 4
        ;; if (eqz addr p)
        get_local 4
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store i32 p, 0, (add i32 s1, s2)
        get_local 4
        get_local 2
        get_local 3
        i32.add
        i32.store
        ;; dest = add addr p, 4
        get_local 4
        i32.const 4
        i32.add
        set_local 5
        ;; src = add addr str1, 4
        get_local 1
        i32.load
        i32.const 4
        i32.add
        set_local 6
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 7
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, s1)), 1
                get_local 7
                get_local 2
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; $mem = store i8 (add addr dest, i), 0, (load i8 (add addr src, i), 0)
                    get_local 5
                    get_local 7
                    i32.add
                    get_local 6
                    get_local 7
                    i32.add
                    i32.load8_u
                    i32.store8
                end
                ;; i = add i32 i, 1
                get_local 7
                i32.const 1
                i32.add
                set_local 7
                ;; br 0
                br 0
            end
        end
        ;; dest = add addr dest, s1
        get_local 5
        get_local 2
        i32.add
        set_local 5
        ;; src = add addr str2, 4
        get_local 1
        i32.load offset=4
        i32.const 4
        i32.add
        set_local 6
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 8
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, s2)), 1
                get_local 8
                get_local 3
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; $mem = store i8 (add addr dest, i), 0, (load i8 (add addr src, i), 0)
                    get_local 5
                    get_local 8
                    i32.add
                    get_local 6
                    get_local 8
                    i32.add
                    i32.load8_u
                    i32.store8
                end
                ;; i = add i32 i, 1
                get_local 8
                i32.const 1
                i32.add
                set_local 8
                ;; br 0
                br 0
            end
        end
        ;; return ptr p
        get_local 4
        return
        ;; end 
    )
    (func $compareString (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 0
        set_local 1
        ;; str1 = decl_param ptr 
        ;; str2 = decl_param ptr 
        ;; $return = decl_result s32 
        ;; s1 = decl_var i32 
        ;; s2 = decl_var i32 
        ;; ptr1 = decl_var addr 
        ;; ptr2 = decl_var addr 
        ;; min = decl_var i32 
        ;; s1 = load i32 str1, 0
        get_local 1
        i32.load
        i32.load
        set_local 2
        ;; s2 = load i32 str2, 0
        get_local 1
        i32.load offset=4
        i32.load
        set_local 3
        ;; ptr1 = add addr str1, 4
        get_local 1
        i32.load
        i32.const 4
        i32.add
        set_local 4
        ;; ptr2 = add addr str2, 4
        get_local 1
        i32.load offset=4
        i32.const 4
        i32.add
        set_local 5
        ;; min = copy i32 s2
        get_local 3
        set_local 6
        ;; if (lt_u i32 s1, s2)
        get_local 2
        get_local 3
        i32.lt_u
        if
            ;; min = copy i32 s1
            get_local 2
            set_local 6
        end
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 7
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, min)), 1
                get_local 7
                get_local 6
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (lt_u i8 (load i8 (add addr ptr1, i), 0), (load i8 (add addr ptr2, i), 0))
                    get_local 4
                    get_local 7
                    i32.add
                    i32.load8_u
                    get_local 5
                    get_local 7
                    i32.add
                    i32.load8_u
                    i32.lt_u
                    if
                        ;; return s32 -1
                        i32.const -1
                        return
                    else
                        ;; if (gt_u i8 (load i8 (add addr ptr1, i), 0), (load i8 (add addr ptr2, i), 0))
                        get_local 4
                        get_local 7
                        i32.add
                        i32.load8_u
                        get_local 5
                        get_local 7
                        i32.add
                        i32.load8_u
                        i32.gt_u
                        if
                            ;; return s32 1
                            i32.const 1
                            return
                        end
                    end
                end
                ;; i = add i32 i, 1
                get_local 7
                i32.const 1
                i32.add
                set_local 7
                ;; br 0
                br 0
            end
        end
        ;; if (eq i32 s1, s2)
        get_local 2
        get_local 3
        i32.eq
        if
            ;; return s32 0
            i32.const 0
            return
        end
        ;; if (lt_u i32 s1, s2)
        get_local 2
        get_local 3
        i32.lt_u
        if
            ;; return s32 -1
            i32.const -1
            return
        end
        ;; return s32 1
        i32.const 1
        return
        ;; end 
    )
    (func $makeString (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32)
        ;; src = decl_param addr 
        ;; length = decl_param i32 
        ;; $return = decl_result ptr 
        ;; p = decl_var addr 
        ;; dest = decl_var addr 
        ;; p = call (i32,i32,addr,i32,addr) => (addr) 6, (add i32 4, length), 1, 0, 0, 0
        ;; parameter 0
        i32.const 4
        get_local 1
        i32.add
        ;; parameter 1
        i32.const 1
        ;; parameter 2
        i32.const 0
        ;; parameter 3
        i32.const 0
        ;; parameter 4
        i32.const 0
        get_local 2
        call 6
        set_local 3
        ;; if (eqz addr p)
        get_local 3
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store i32 p, 0, length
        get_local 3
        get_local 1
        i32.store
        ;; dest = add addr p, 4
        get_local 3
        i32.const 4
        i32.add
        set_local 4
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 5
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, length)), 1
                get_local 5
                get_local 1
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; $mem = store i8 (add addr dest, i), 0, (load i8 (add addr src, i), 0)
                    get_local 4
                    get_local 5
                    i32.add
                    get_local 0
                    get_local 5
                    i32.add
                    i32.load8_u
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
        ;; return ptr p
        get_local 3
        return
        ;; end 
    )
    (func $appendSlice (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 6
        set_local 7
        ;; a = decl_param ptr 
        ;; alen = decl_param i32 
        ;; acap = decl_param i32 
        ;; b = decl_param ptr 
        ;; blen = decl_param i32 
        ;; bcap = decl_param s32 
        ;; elementSize = decl_param i32 
        ;; typemap = decl_param addr 
        ;; $return = decl_result Slice 
        ;; aptr = decl_var addr 
        ;; bptr = decl_var addr 
        ;; l = decl_var i32 
        ;; aptr = copy addr a
        get_local 7
        i32.load
        set_local 8
        ;; bptr = copy addr b
        get_local 7
        i32.load offset=4
        set_local 9
        ;; if (eqz ptr a)
        get_local 7
        i32.load
        i32.eqz
        if
            ;; newptr = decl_var addr 
            ;; if (lt_s s32 bcap, 0)
            get_local 3
            i32.const 0
            i32.lt_s
            if
                ;; %779 = ne ptr b, 0
                get_local 7
                i32.load offset=4
                i32.const 0
                i32.ne
                set_local 12
            else
                ;; %779 = const i8 0
                i32.const 0
                set_local 12
            end
            ;; if %779
            get_local 12
            if
                ;; newptr = call (i32,i32,addr,i32,addr) => (addr) 6, blen, elementSize, typemap, 0, 0
                ;; parameter 0
                get_local 2
                ;; parameter 1
                get_local 4
                ;; parameter 2
                get_local 5
                ;; parameter 3
                i32.const 0
                ;; parameter 4
                i32.const 0
                get_local 6
                call 6
                set_local 11
                ;; call (addr,addr,i32) => () 20, newptr, bptr, (mul i32 blen, elementSize)
                ;; parameter 0
                get_local 11
                ;; parameter 1
                get_local 9
                ;; parameter 2
                get_local 2
                get_local 4
                i32.mul
                get_local 6
                call 20
                ;; return Slice (struct Slice newptr, blen, blen)
                get_local 6
                get_local 11
                i32.store offset=8
                get_local 6
                get_local 2
                i32.store offset=12
                get_local 6
                get_local 2
                i32.store offset=16
                return
            end
            ;; return Slice (struct Slice bptr, blen, bcap)
            get_local 6
            get_local 9
            i32.store offset=8
            get_local 6
            get_local 2
            i32.store offset=12
            get_local 6
            get_local 3
            i32.store offset=16
            return
        end
        ;; if (eqz ptr b)
        get_local 7
        i32.load offset=4
        i32.eqz
        if
            ;; return Slice (struct Slice aptr, alen, acap)
            get_local 6
            get_local 8
            i32.store offset=8
            get_local 6
            get_local 0
            i32.store offset=12
            get_local 6
            get_local 1
            i32.store offset=16
            return
        end
        ;; l = add i32 alen, blen
        get_local 0
        get_local 2
        i32.add
        set_local 10
        ;; newptr = decl_var addr 
        ;; if (gt_u i32 (add i32 alen, blen), acap)
        get_local 0
        get_local 2
        i32.add
        get_local 1
        i32.gt_u
        if
            ;; newptr = call (i32,i32,addr,i32,addr) => (addr) 6, l, elementSize, typemap, 0, 0
            ;; parameter 0
            get_local 10
            ;; parameter 1
            get_local 4
            ;; parameter 2
            get_local 5
            ;; parameter 3
            i32.const 0
            ;; parameter 4
            i32.const 0
            get_local 6
            call 6
            set_local 13
            ;; call (addr,addr,i32) => () 20, newptr, aptr, (mul i32 alen, elementSize)
            ;; parameter 0
            get_local 13
            ;; parameter 1
            get_local 8
            ;; parameter 2
            get_local 0
            get_local 4
            i32.mul
            get_local 6
            call 20
            ;; call (addr,addr,i32) => () 20, (add addr newptr, (mul i32 alen, elementSize)), bptr, (mul i32 blen, elementSize)
            ;; parameter 0
            get_local 13
            get_local 0
            get_local 4
            i32.mul
            i32.add
            ;; parameter 1
            get_local 9
            ;; parameter 2
            get_local 2
            get_local 4
            i32.mul
            get_local 6
            call 20
            ;; return Slice (struct Slice newptr, l, l)
            get_local 6
            get_local 13
            i32.store offset=8
            get_local 6
            get_local 10
            i32.store offset=12
            get_local 6
            get_local 10
            i32.store offset=16
            return
        end
        ;; call (addr,addr,i32) => () 20, (add addr aptr, (mul i32 alen, elementSize)), bptr, (mul i32 blen, elementSize)
        ;; parameter 0
        get_local 8
        get_local 0
        get_local 4
        i32.mul
        i32.add
        ;; parameter 1
        get_local 9
        ;; parameter 2
        get_local 2
        get_local 4
        i32.mul
        get_local 6
        call 20
        ;; return Slice (struct Slice aptr, l, acap)
        get_local 6
        get_local 8
        i32.store offset=8
        get_local 6
        get_local 10
        i32.store offset=12
        get_local 6
        get_local 1
        i32.store offset=16
        return
        ;; end 
    )
    (func $growSlice (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (local i32) (local i32) (local i32)
        get_local 5
        set_local 6
        ;; ptr = decl_param ptr 
        ;; len = decl_param i32 
        ;; cap = decl_param i32 
        ;; add = decl_param i32 
        ;; elementSize = decl_param i32 
        ;; typemap = decl_param addr 
        ;; $return = decl_result Slice 
        ;; l = decl_var i32 
        ;; l = add i32 len, add
        get_local 0
        get_local 2
        i32.add
        set_local 7
        ;; newptr = decl_var addr 
        ;; if (gt_u i32 l, cap)
        get_local 7
        get_local 1
        i32.gt_u
        if
            ;; cap = mul i32 cap, 2
            get_local 1
            i32.const 2
            i32.mul
            set_local 1
            ;; if (gt_u i32 l, cap)
            get_local 7
            get_local 1
            i32.gt_u
            if
                ;; cap = copy i32 l
                get_local 7
                set_local 1
            end
            ;; newptr = call (i32,i32,addr,i32,addr) => (addr) 6, cap, elementSize, typemap, 0, 0
            ;; parameter 0
            get_local 1
            ;; parameter 1
            get_local 3
            ;; parameter 2
            get_local 4
            ;; parameter 3
            i32.const 0
            ;; parameter 4
            i32.const 0
            get_local 5
            call 6
            set_local 8
            ;; call (addr,addr,i32) => () 20, newptr, ptr, (mul i32 len, elementSize)
            ;; parameter 0
            get_local 8
            ;; parameter 1
            get_local 6
            i32.load
            ;; parameter 2
            get_local 0
            get_local 3
            i32.mul
            get_local 5
            call 20
            ;; ptr = copy ptr newptr
            get_local 6
            get_local 8
            i32.store
        end
        ;; return Slice (struct Slice ptr, l, cap)
        get_local 5
        get_local 6
        i32.load
        i32.store offset=4
        get_local 5
        get_local 7
        i32.store offset=8
        get_local 5
        get_local 1
        i32.store offset=12
        return
        ;; end 
    )
    (func $hashString (param i32) (param i32) (result i64) (local i32) (local i64) (local i32)
        ;; ptr = decl_param addr 
        ;; $return = decl_result i64 
        ;; len = decl_var i32 
        ;; result = decl_var i64 
        ;; if (eqz addr ptr)
        get_local 0
        i32.eqz
        if
            ;; return i64 1
            i64.const 1
            return
        end
        ;; len = load i32 ptr, 0
        get_local 0
        i32.load
        set_local 2
        ;; ptr = add addr ptr, 4
        get_local 0
        i32.const 4
        i32.add
        set_local 0
        ;; result = extend i32 len
        get_local 2
        i64.extend_u/i32
        set_local 3
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 4
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, len)), 1
                get_local 4
                get_local 2
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; result = add i64 (mul i64 31, result), (extend i8 (load i8 (add addr ptr, i), 0))
                    i64.const 31
                    get_local 3
                    i64.mul
                    get_local 0
                    get_local 4
                    i32.add
                    i32.load8_u
                    i64.extend_u/i32
                    i64.add
                    set_local 3
                end
                ;; i = add i32 i, 1
                get_local 4
                i32.const 1
                i32.add
                set_local 4
                ;; br 0
                br 0
            end
        end
        ;; if (eqz i64 result)
        get_local 3
        i64.eqz
        if
            ;; return i64 1
            i64.const 1
            return
        end
        ;; return i64 result
        get_local 3
        return
        ;; end 
    )
    (func $createMap (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; headTypeMap = decl_param addr 
        ;; count = decl_param s32 
        ;; entryTypeMap = decl_param addr 
        ;; $return = decl_result ptr 
        ;; entrySize = decl_var i32 
        ;; headSize = decl_var i32 
        ;; h = decl_var addr 
        ;; m = decl_var addr 
        ;; entrySize = shl i32 (load s32 entryTypeMap, 0), 2
        get_local 2
        i32.load
        i32.const 2
        i32.shl
        set_local 4
        ;; h = call (i32,i32,addr,i32,addr) => (addr) 6, count, entrySize, entryTypeMap, (shl i32 (load s32 headTypeMap, 0), 2), headTypeMap
        ;; parameter 0
        get_local 1
        ;; parameter 1
        get_local 4
        ;; parameter 2
        get_local 2
        ;; parameter 3
        get_local 0
        i32.load
        i32.const 2
        i32.shl
        ;; parameter 4
        get_local 0
        get_local 3
        call 6
        set_local 6
        ;; m = add addr h, (mul i32 1, 16)
        get_local 6
        i32.const 1
        i32.const 16
        i32.mul
        i32.add
        set_local 7
        ;; $mem = store s32 h, 4, count
        get_local 6
        get_local 1
        i32.store offset=4
        ;; $mem = store s32 h, 8, count
        get_local 6
        get_local 1
        i32.store offset=8
        ;; $mem = store addr h, 12, m
        get_local 6
        get_local 7
        i32.store offset=12
        ;; i = decl_var s32 
        ;; m2 = decl_var addr 
        ;; i = const s32 1
        i32.const 1
        set_local 8
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_s s32 i, count)), 1
                get_local 8
                get_local 1
                i32.lt_s
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; m2 = add addr m, entrySize
                    get_local 7
                    get_local 4
                    i32.add
                    set_local 9
                    ;; $mem = store addr m, 4, m2
                    get_local 7
                    get_local 9
                    i32.store offset=4
                    ;; m = copy addr m2
                    get_local 9
                    set_local 7
                end
                ;; i = add s32 i, 1
                get_local 8
                i32.const 1
                i32.add
                set_local 8
                ;; br 0
                br 0
            end
        end
        ;; $mem = store addr m, 4, 0
        get_local 7
        i32.const 0
        i32.store offset=4
        ;; return ptr h
        get_local 6
        return
        ;; end 
    )
    (func $createMapEntry (param i32) (param i64) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; head = decl_param addr 
        ;; hash = decl_param i64 
        ;; $return = decl_result addr 
        ;; h = decl_var addr 
        ;; iptr = decl_var addr 
        ;; entryTypeMap = decl_var addr 
        ;; entrySize = decl_var i32 
        ;; p = decl_var addr 
        ;; index = decl_var i32 
        ;; p2 = decl_var addr 
        ;; h = copy addr head
        get_local 0
        set_local 3
        ;; if (eqz addr h)
        get_local 3
        i32.eqz
        if
        else
            ;; if (ne ptr (load ptr h, 0), 0)
            get_local 3
            i32.load
            i32.const 0
            i32.ne
            if
                ;; h = load ptr h, 0
                get_local 3
                i32.load
                set_local 3
            end
        end
        ;; iptr = sub addr h, (mul i32 1, 4)
        get_local 3
        i32.const 1
        i32.const 4
        i32.mul
        i32.sub
        set_local 4
        ;; entryTypeMap = add s32 (xor s32 (load s32 (sub addr iptr, (mul i32 1, 4)), 0), -1), 1
        get_local 4
        i32.const 1
        i32.const 4
        i32.mul
        i32.sub
        i32.load
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        set_local 5
        ;; entrySize = shl i32 (load s32 entryTypeMap, 0), 2
        get_local 5
        i32.load
        i32.const 2
        i32.shl
        set_local 6
        ;; headTypeMap = decl_var addr 
        ;; head2 = decl_var ptr 
        ;; h2 = decl_var addr 
        ;; m2 = decl_var addr 
        ;; if (eqz s32 (load s32 h, 8))
        get_local 3
        i32.load offset=8
        i32.eqz
        if
            ;; head2 = call (addr,s32,addr) => (ptr) 27, (add s32 (xor s32 (load s32 iptr, 0), -1), 1), (mul s32 (load s32 h, 4), 2), entryTypeMap
            ;; parameter 0
            get_local 4
            i32.load
            i32.const -1
            i32.xor
            i32.const 1
            i32.add
            ;; parameter 1
            get_local 3
            i32.load offset=4
            i32.const 2
            i32.mul
            ;; parameter 2
            get_local 5
            get_local 2
            call 27
            set_local 11
            ;; h2 = copy addr head2
            get_local 11
            set_local 12
            ;; m2 = add addr h2, (mul i32 1, 16)
            get_local 12
            i32.const 1
            i32.const 16
            i32.mul
            i32.add
            set_local 13
            ;; mh = decl_var addr 
            ;; oldEntry = decl_var addr 
            ;; mh = copy addr h
            get_local 3
            set_local 14
            ;; block 
            block
                ;; loop 
                loop
                    ;; br_if (eqz i8 (ne addr mh, 0)), 1
                    get_local 14
                    i32.const 0
                    i32.ne
                    i32.eqz
                    br_if 1
                    ;; block 
                    block
                        ;; oldEntry = add addr mh, (mul i32 1, 16)
                        get_local 14
                        i32.const 1
                        i32.const 16
                        i32.mul
                        i32.add
                        set_local 15
                        ;; i = decl_var s32 
                        ;; index = decl_var i32 
                        ;; newEntry = decl_var addr 
                        ;; i = const s32 0
                        i32.const 0
                        set_local 16
                        ;; block 
                        block
                            ;; loop 
                            loop
                                ;; br_if (eqz i8 (lt_s s32 i, (load s32 mh, 4))), 1
                                get_local 16
                                get_local 14
                                i32.load offset=4
                                i32.lt_s
                                i32.eqz
                                br_if 1
                                ;; block 
                                block
                                    ;; newEntry = add addr m2, (mul i32 (wrap i64 (rem_u i64 (load i64 oldEntry, 8), (extend s32 (load s32 h2, 4)))), entrySize)
                                    get_local 13
                                    get_local 15
                                    i64.load offset=8
                                    get_local 12
                                    i32.load offset=4
                                    i64.extend_s/i32
                                    i64.rem_u
                                    i32.wrap/i64
                                    get_local 6
                                    i32.mul
                                    i32.add
                                    set_local 18
                                    ;; $mem = store addr oldEntry, 4, (load addr newEntry, 0)
                                    get_local 15
                                    get_local 18
                                    i32.load
                                    i32.store offset=4
                                    ;; $mem = store addr newEntry, 0, oldEntry
                                    get_local 18
                                    get_local 15
                                    i32.store
                                    ;; oldEntry = add addr oldEntry, entrySize
                                    get_local 15
                                    get_local 6
                                    i32.add
                                    set_local 15
                                end
                                ;; i = add s32 i, 1
                                get_local 16
                                i32.const 1
                                i32.add
                                set_local 16
                                ;; br 0
                                br 0
                            end
                        end
                    end
                    ;; mh = load ptr mh, 0
                    get_local 14
                    i32.load
                    set_local 14
                    ;; br 0
                    br 0
                end
            end
            ;; $mem = store ptr h2, 0, (load ptr h, 0)
            get_local 12
            get_local 3
            i32.load
            i32.store
            ;; $mem = store ptr h, 0, h2
            get_local 3
            get_local 12
            i32.store
            ;; head = copy addr head2
            get_local 11
            set_local 0
            ;; h = copy addr h2
            get_local 12
            set_local 3
        end
        ;; p = load addr h, 12
        get_local 3
        i32.load offset=12
        set_local 7
        ;; $mem = store addr h, 12, (load addr p, 4)
        get_local 3
        get_local 7
        i32.load offset=4
        i32.store offset=12
        ;; $mem = store i64 p, 8, hash
        get_local 7
        get_local 1
        i64.store offset=8
        ;; p2 = add addr (add addr h, (mul i32 1, 16)), (mul i32 (wrap i64 (rem_u i64 hash, (extend s32 (load s32 h, 4)))), entrySize)
        get_local 3
        i32.const 1
        i32.const 16
        i32.mul
        i32.add
        get_local 1
        get_local 3
        i32.load offset=4
        i64.extend_s/i32
        i64.rem_u
        i32.wrap/i64
        get_local 6
        i32.mul
        i32.add
        set_local 9
        ;; $mem = store addr p, 4, (load addr p2, 0)
        get_local 7
        get_local 9
        i32.load
        i32.store offset=4
        ;; $mem = store addr p2, 0, p
        get_local 9
        get_local 7
        i32.store
        ;; $mem = store s32 h, 8, (sub s32 (load s32 h, 8), 1)
        get_local 3
        get_local 3
        i32.load offset=8
        i32.const 1
        i32.sub
        i32.store offset=8
        ;; return addr p
        get_local 7
        return
        ;; end 
    )
    (func $setMap (param i32) (result i32) (local i32) (local i32) (local i64) (local i32)
        get_local 0
        set_local 1
        ;; head = decl_param ptr 
        ;; key = decl_param ptr 
        ;; $return = decl_result addr 
        ;; valuePtr = decl_var addr 
        ;; hash = decl_var i64 
        ;; p = decl_var addr 
        ;; valuePtr = call (addr,addr) => (addr) 30, head, key
        ;; parameter 0
        get_local 1
        i32.load
        ;; parameter 1
        get_local 1
        i32.load offset=4
        get_local 0
        call 30
        set_local 2
        ;; if (ne addr valuePtr, 0)
        get_local 2
        i32.const 0
        i32.ne
        if
            ;; return addr valuePtr
            get_local 2
            return
        end
        ;; p = call (addr,i64) => (addr) 28, head, (call (addr) => (i64) 26, key)
        ;; parameter 0
        get_local 1
        i32.load
        ;; parameter 1
        ;; parameter 0
        get_local 1
        i32.load offset=4
        get_local 0
        call 26
        get_local 0
        call 28
        set_local 4
        ;; $mem = store ptr p, 16, key
        get_local 4
        get_local 1
        i32.load offset=4
        i32.store offset=16
        ;; return addr (add ptr p, 20)
        get_local 4
        i32.const 20
        i32.add
        return
        ;; end 
    )
    (func $lookupMap (param i32) (param i32) (param i32) (result i32) (local i64) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; h = decl_param addr 
        ;; key = decl_param addr 
        ;; $return = decl_result addr 
        ;; hash = decl_var i64 
        ;; iptr = decl_var addr 
        ;; entryTypeMap = decl_var addr 
        ;; m = decl_var addr 
        ;; entrySize = decl_var i32 
        ;; if (eqz addr h)
        get_local 0
        i32.eqz
        if
            ;; return addr 0
            i32.const 0
            return
        else
            ;; if (ne ptr (load ptr h, 0), 0)
            get_local 0
            i32.load
            i32.const 0
            i32.ne
            if
                ;; h = load ptr h, 0
                get_local 0
                i32.load
                set_local 0
            end
        end
        ;; hash = call (addr) => (i64) 26, key
        ;; parameter 0
        get_local 1
        get_local 2
        call 26
        set_local 3
        ;; p = decl_var addr 
        ;; p = load addr (add addr (add addr h, (mul i32 1, 16)), (mul i32 (wrap i64 (rem_u i64 hash, (extend s32 (load s32 h, 4)))), (shl i32 (load s32 (add s32 (xor s32 (load s32 (sub addr h, (mul i32 2, 4)), 0), -1), 1), 0), 2))), 0
        get_local 0
        i32.const 1
        i32.const 16
        i32.mul
        i32.add
        get_local 3
        get_local 0
        i32.load offset=4
        i64.extend_s/i32
        i64.rem_u
        i32.wrap/i64
        get_local 0
        i32.const 2
        i32.const 4
        i32.mul
        i32.sub
        i32.load
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        i32.load
        i32.const 2
        i32.shl
        i32.mul
        i32.add
        i32.load
        set_local 8
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ne addr p, 0)), 1
                get_local 8
                i32.const 0
                i32.ne
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (eq i64 (load i64 p, 8), hash)
                    get_local 8
                    i64.load offset=8
                    get_local 3
                    i64.eq
                    if
                        ;; %915 = eqz i32 (call (ptr,ptr) => (i32) -14, (load ptr p, 16), key)
                        ;; Create stack frame for -14
                        get_local 2
                        i32.const 12
                        i32.sub
                        set_local 2
                        ;; Store typemap
                        get_local 2
                        i32.const 552
                        i32.store offset=8
                        ;; parameter 0
                        get_local 2
                        get_local 8
                        i32.load offset=16
                        i32.store
                        ;; parameter 1
                        get_local 2
                        get_local 1
                        i32.store offset=4
                        get_local 2
                        call $compareString
                        ;; Remove parameters
                        get_local 2
                        i32.const 12
                        i32.add
                        set_local 2
                        i32.eqz
                        set_local 9
                    else
                        ;; %915 = const i8 0
                        i32.const 0
                        set_local 9
                    end
                    ;; if %915
                    get_local 9
                    if
                        ;; return addr (add ptr p, 20)
                        get_local 8
                        i32.const 20
                        i32.add
                        return
                    end
                end
                ;; p = load addr p, 4
                get_local 8
                i32.load offset=4
                set_local 8
                ;; br 0
                br 0
            end
        end
        ;; return addr 0
        i32.const 0
        return
        ;; end 
    )
    (func $removeMapKey (param i32) (param i32) (param i32) (result i32) (local i64) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; h = decl_param addr 
        ;; key = decl_param addr 
        ;; $return = decl_result i8 
        ;; hash = decl_var i64 
        ;; iptr = decl_var addr 
        ;; entryTypeMap = decl_var addr 
        ;; entrySize = decl_var i32 
        ;; m = decl_var addr 
        ;; prev = decl_var addr 
        ;; if (eqz addr h)
        get_local 0
        i32.eqz
        if
            ;; return i8 0
            i32.const 0
            return
        else
            ;; if (ne ptr (load ptr h, 0), 0)
            get_local 0
            i32.load
            i32.const 0
            i32.ne
            if
                ;; h = load ptr h, 0
                get_local 0
                i32.load
                set_local 0
            end
        end
        ;; hash = call (addr) => (i64) 26, key
        ;; parameter 0
        get_local 1
        get_local 2
        call 26
        set_local 3
        ;; entryTypeMap = add s32 (xor s32 (load s32 (sub addr (sub addr h, (mul i32 1, 4)), (mul i32 1, 4)), 0), -1), 1
        get_local 0
        i32.const 1
        i32.const 4
        i32.mul
        i32.sub
        i32.const 1
        i32.const 4
        i32.mul
        i32.sub
        i32.load
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        set_local 5
        ;; m = add addr h, (mul i32 1, 16)
        get_local 0
        i32.const 1
        i32.const 16
        i32.mul
        i32.add
        set_local 7
        ;; p = decl_var addr 
        ;; p = load addr (add addr m, (mul i32 (wrap i64 (rem_u i64 hash, (extend s32 (load s32 h, 4)))), (shl i32 (load s32 entryTypeMap, 0), 2))), 0
        get_local 7
        get_local 3
        get_local 0
        i32.load offset=4
        i64.extend_s/i32
        i64.rem_u
        i32.wrap/i64
        get_local 5
        i32.load
        i32.const 2
        i32.shl
        i32.mul
        i32.add
        i32.load
        set_local 9
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ne addr p, 0)), 1
                get_local 9
                i32.const 0
                i32.ne
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (eq i64 (load i64 p, 8), hash)
                    get_local 9
                    i64.load offset=8
                    get_local 3
                    i64.eq
                    if
                        ;; %948 = eqz i32 (call (ptr,ptr) => (i32) -14, (load ptr p, 16), key)
                        ;; Create stack frame for -14
                        get_local 2
                        i32.const 12
                        i32.sub
                        set_local 2
                        ;; Store typemap
                        get_local 2
                        i32.const 552
                        i32.store offset=8
                        ;; parameter 0
                        get_local 2
                        get_local 9
                        i32.load offset=16
                        i32.store
                        ;; parameter 1
                        get_local 2
                        get_local 1
                        i32.store offset=4
                        get_local 2
                        call $compareString
                        ;; Remove parameters
                        get_local 2
                        i32.const 12
                        i32.add
                        set_local 2
                        i32.eqz
                        set_local 10
                    else
                        ;; %948 = const i8 0
                        i32.const 0
                        set_local 10
                    end
                    ;; if %948
                    get_local 10
                    if
                        ;; if (ne addr prev, 0)
                        get_local 8
                        i32.const 0
                        i32.ne
                        if
                            ;; $mem = store addr prev, 4, (load addr p, 4)
                            get_local 8
                            get_local 9
                            i32.load offset=4
                            i32.store offset=4
                        else
                            ;; $mem = store addr (add addr m, (mul i32 (wrap i64 (rem_u i64 hash, (extend s32 (load s32 h, 4)))), (load s32 entryTypeMap, 0))), 0, (load addr p, 4)
                            get_local 7
                            get_local 3
                            get_local 0
                            i32.load offset=4
                            i64.extend_s/i32
                            i64.rem_u
                            i32.wrap/i64
                            get_local 5
                            i32.load
                            i32.mul
                            i32.add
                            get_local 9
                            i32.load offset=4
                            i32.store
                        end
                        ;; $mem = store i64 p, 8, 0
                        get_local 9
                        i64.const 0
                        i64.store offset=8
                        ;; $mem = store addr p, 4, (load addr h, 12)
                        get_local 9
                        get_local 0
                        i32.load offset=12
                        i32.store offset=4
                        ;; $mem = store addr h, 12, p
                        get_local 0
                        get_local 9
                        i32.store offset=12
                        ;; $mem = store s32 h, 8, (add s32 (load s32 h, 8), 1)
                        get_local 0
                        get_local 0
                        i32.load offset=8
                        i32.const 1
                        i32.add
                        i32.store offset=8
                        ;; return i8 1
                        i32.const 1
                        return
                    end
                    ;; prev = copy addr p
                    get_local 9
                    set_local 8
                end
                ;; p = load addr p, 4
                get_local 9
                i32.load offset=4
                set_local 9
                ;; br 0
                br 0
            end
        end
        ;; return i8 0
        i32.const 0
        return
        ;; end 
    )
    (func $setNumericMap (param i64) (param i32) (result i32) (local i32) (local i32) (local i32)
        get_local 1
        set_local 2
        ;; head = decl_param ptr 
        ;; key = decl_param i64 
        ;; $return = decl_result addr 
        ;; valuePtr = decl_var addr 
        ;; p = decl_var addr 
        ;; valuePtr = call (addr,i64) => (addr) 33, head, key
        ;; parameter 0
        get_local 2
        i32.load
        ;; parameter 1
        get_local 0
        get_local 1
        call 33
        set_local 3
        ;; if (ne addr valuePtr, 0)
        get_local 3
        i32.const 0
        i32.ne
        if
            ;; return addr valuePtr
            get_local 3
            return
        end
        ;; return addr (add ptr (call (addr,i64) => (addr) 28, head, key), 16)
        ;; parameter 0
        get_local 2
        i32.load
        ;; parameter 1
        get_local 0
        get_local 1
        call 28
        i32.const 16
        i32.add
        return
        ;; end 
    )
    (func $lookupNumericMap (param i32) (param i64) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; h = decl_param addr 
        ;; key = decl_param i64 
        ;; $return = decl_result addr 
        ;; iptr = decl_var addr 
        ;; entryTypeMap = decl_var addr 
        ;; m = decl_var addr 
        ;; entrySize = decl_var i32 
        ;; if (eqz addr h)
        get_local 0
        i32.eqz
        if
            ;; return addr 0
            i32.const 0
            return
        else
            ;; if (ne ptr (load ptr h, 0), 0)
            get_local 0
            i32.load
            i32.const 0
            i32.ne
            if
                ;; h = load ptr h, 0
                get_local 0
                i32.load
                set_local 0
            end
        end
        ;; p = decl_var addr 
        ;; p = load addr (add addr (add addr h, (mul i32 1, 16)), (mul i32 (wrap i64 (rem_u i64 key, (extend s32 (load s32 h, 4)))), (shl i32 (load s32 (add s32 (xor s32 (load s32 (sub addr h, (mul i32 2, 4)), 0), -1), 1), 0), 2))), 0
        get_local 0
        i32.const 1
        i32.const 16
        i32.mul
        i32.add
        get_local 1
        get_local 0
        i32.load offset=4
        i64.extend_s/i32
        i64.rem_u
        i32.wrap/i64
        get_local 0
        i32.const 2
        i32.const 4
        i32.mul
        i32.sub
        i32.load
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        i32.load
        i32.const 2
        i32.shl
        i32.mul
        i32.add
        i32.load
        set_local 7
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ne addr p, 0)), 1
                get_local 7
                i32.const 0
                i32.ne
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (eq i64 (load i64 p, 8), key)
                    get_local 7
                    i64.load offset=8
                    get_local 1
                    i64.eq
                    if
                        ;; return addr (add ptr p, 16)
                        get_local 7
                        i32.const 16
                        i32.add
                        return
                    end
                end
                ;; p = load addr p, 4
                get_local 7
                i32.load offset=4
                set_local 7
                ;; br 0
                br 0
            end
        end
        ;; return addr 0
        i32.const 0
        return
        ;; end 
    )
    (func $removeNumericMapKey (param i32) (param i64) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; h = decl_param addr 
        ;; key = decl_param i64 
        ;; $return = decl_result i8 
        ;; iptr = decl_var addr 
        ;; entryTypeMap = decl_var addr 
        ;; entrySize = decl_var i32 
        ;; m = decl_var addr 
        ;; prev = decl_var addr 
        ;; if (eqz addr h)
        get_local 0
        i32.eqz
        if
            ;; return i8 0
            i32.const 0
            return
        else
            ;; if (ne ptr (load ptr h, 0), 0)
            get_local 0
            i32.load
            i32.const 0
            i32.ne
            if
                ;; h = load ptr h, 0
                get_local 0
                i32.load
                set_local 0
            end
        end
        ;; entryTypeMap = add s32 (xor s32 (load s32 (sub addr (sub addr h, (mul i32 1, 4)), (mul i32 1, 4)), 0), -1), 1
        get_local 0
        i32.const 1
        i32.const 4
        i32.mul
        i32.sub
        i32.const 1
        i32.const 4
        i32.mul
        i32.sub
        i32.load
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        set_local 4
        ;; m = add addr h, (mul i32 1, 16)
        get_local 0
        i32.const 1
        i32.const 16
        i32.mul
        i32.add
        set_local 6
        ;; p = decl_var addr 
        ;; p = load addr (add addr m, (mul i32 (wrap i64 (rem_u i64 key, (extend s32 (load s32 h, 4)))), (shl i32 (load s32 entryTypeMap, 0), 2))), 0
        get_local 6
        get_local 1
        get_local 0
        i32.load offset=4
        i64.extend_s/i32
        i64.rem_u
        i32.wrap/i64
        get_local 4
        i32.load
        i32.const 2
        i32.shl
        i32.mul
        i32.add
        i32.load
        set_local 8
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ne addr p, 0)), 1
                get_local 8
                i32.const 0
                i32.ne
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (eq i64 (load i64 p, 8), key)
                    get_local 8
                    i64.load offset=8
                    get_local 1
                    i64.eq
                    if
                        ;; call (ptr) => () 0, 304
                        ;; Create stack frame for 0
                        get_local 2
                        i32.const 8
                        i32.sub
                        set_local 2
                        ;; Store typemap
                        get_local 2
                        i32.const 568
                        i32.store offset=4
                        ;; parameter 0
                        get_local 2
                        i32.const 304
                        i32.store
                        get_local 2
                        call 0
                        ;; Remove parameters
                        get_local 2
                        i32.const 8
                        i32.add
                        set_local 2
                        ;; call (i32) => () 1, (wrap i64 key)
                        ;; parameter 0
                        get_local 1
                        i32.wrap/i64
                        get_local 2
                        call 1
                        ;; if (ne addr prev, 0)
                        get_local 7
                        i32.const 0
                        i32.ne
                        if
                            ;; $mem = store addr prev, 4, (load addr p, 4)
                            get_local 7
                            get_local 8
                            i32.load offset=4
                            i32.store offset=4
                        else
                            ;; $mem = store addr (add addr m, (mul i32 (wrap i64 (rem_u i64 key, (extend s32 (load s32 h, 4)))), (load s32 entryTypeMap, 0))), 0, (load addr p, 4)
                            get_local 6
                            get_local 1
                            get_local 0
                            i32.load offset=4
                            i64.extend_s/i32
                            i64.rem_u
                            i32.wrap/i64
                            get_local 4
                            i32.load
                            i32.mul
                            i32.add
                            get_local 8
                            i32.load offset=4
                            i32.store
                        end
                        ;; $mem = store i64 p, 8, 0
                        get_local 8
                        i64.const 0
                        i64.store offset=8
                        ;; $mem = store addr p, 4, (load addr h, 12)
                        get_local 8
                        get_local 0
                        i32.load offset=12
                        i32.store offset=4
                        ;; $mem = store addr h, 12, p
                        get_local 0
                        get_local 8
                        i32.store offset=12
                        ;; $mem = store s32 h, 8, (add s32 (load s32 h, 8), 1)
                        get_local 0
                        get_local 0
                        i32.load offset=8
                        i32.const 1
                        i32.add
                        i32.store offset=8
                        ;; return i8 1
                        i32.const 1
                        return
                    end
                    ;; prev = copy addr p
                    get_local 8
                    set_local 7
                end
                ;; p = load addr p, 4
                get_local 8
                i32.load offset=4
                set_local 8
                ;; br 0
                br 0
            end
        end
        ;; return i8 0
        i32.const 0
        return
        ;; end 
    )
    (data (i32.const 0) "\00\00\00\00")
    (data (i32.const 8) "\0e\00\00\00\2e\2e\2e\20\67\63\20\72\75\6e\6e\69\6e\67")
    (data (i32.const 32) "\0a\00\00\00\41\72\65\61\20\62\6c\6f\63\6b")
    (data (i32.const 48) "\10\00\00\00\41\6c\6c\20\61\72\65\61\73\20\6d\61\72\6b\65\64")
    (data (i32.const 72) "\0e\00\00\00\42\6c\6f\63\6b\20\6e\65\65\64\73\20\67\63")
    (data (i32.const 96) "\0f\00\00\00\20\20\20\66\72\65\65\69\6e\67\20\61\72\65\61")
    (data (i32.const 120) "\07\00\00\00\20\20\20\66\72\65\65")
    (data (i32.const 136) "\17\00\00\00\46\72\65\65\20\73\65\71\75\65\6e\63\65\20\6f\66\20\62\6c\6f\63\6b\73")
    (data (i32.const 168) "\1a\00\00\00\46\72\65\65\20\73\69\6e\67\6c\65\20\62\6c\6f\63\6b\20\73\65\71\75\65\6e\63\65")
    (data (i32.const 200) "\14\00\00\00\4d\65\72\67\65\20\62\6c\6f\63\6b\20\73\65\71\75\65\6e\63\65")
    (data (i32.const 224) "\0f\00\00\00\74\72\61\76\65\72\73\69\6e\67\53\74\61\63\6b")
    (data (i32.const 248) "\0b\00\00\00\73\74\61\63\6b\20\66\72\61\6d\65")
    (data (i32.const 264) "\11\00\00\00\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d")
    (data (i32.const 288) "\0c\00\00\00\74\72\61\76\65\72\73\65\54\79\70\65")
    (data (i32.const 304) "\09\00\00\00\46\6f\75\6e\64\20\6b\65\79")
    (data (i32.const 328) "\00\00\00\00\01\00\00\00\40\01\00\00")
    (data (i32.const 344) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 360) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 376) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 392) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 408) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 424) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 440) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 456) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 472) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 488) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 504) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 520) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 536) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 552) "\03\00\00\00\02\00\00\00\00\00\00\00\04\00\00\00")
    (data (i32.const 568) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (export "initializeMemory" (func 2))
    (export "initializeBlock" (func 3))
    (export "split" (func 4))
    (export "allocBlocks" (func 5))
    (export "alloc" (func 6))
    (export "free" (func 7))
    (export "free_intern" (func 8))
    (export "blockCountToIndex" (func 9))
    (export "countBlocks" (func 10))
    (export "freeBlocks" (func 11))
    (export "mergeAndFreeBlocks" (func 12))
    (export "garbageCollect" (func 13))
    (export "mark" (func 14))
    (export "markArea" (func 15))
    (export "markBlocks" (func 16))
    (export "traverseHeapArea" (func 17))
    (export "traverseStack" (func 18))
    (export "traverseType" (func 19))
    (export "copy" (func 20))
    (export "concatString" (func 21))
    (export "compareString" (func 22))
    (export "makeString" (func 23))
    (export "appendSlice" (func 24))
    (export "growSlice" (func 25))
    (export "hashString" (func 26))
    (export "createMap" (func 27))
    (export "createMapEntry" (func 28))
    (export "setMap" (func 29))
    (export "lookupMap" (func 30))
    (export "removeMapKey" (func 31))
    (export "setNumericMap" (func 32))
    (export "lookupNumericMap" (func 33))
    (export "removeNumericMapKey" (func 34))
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
