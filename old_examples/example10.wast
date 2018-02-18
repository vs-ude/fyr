(module
    (func $logString (import "imports" "logString") (param i32) )
    (func $logNumber (import "imports" "logNumber") (param i32 i32) )
    (import "imports" "mem" (memory 18))
    (global i32 (
        i32.const 680
    ))
    (global i32 (
        i32.const 344
    ))
    (global $root (mut i32) (i32.const 0))
    (global $heapStartBlockNr (mut i32) (i32.const 0))
    (global $heapEndBlockNr (mut i32) (i32.const 0))
    (global $gcEpoch (mut i32) (i32.const 0))
    (func $main (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        get_local 0
        i32.const 8
        i32.sub
        tee_local 0
        set_local 1
        get_local 0
        i32.const 360
        i32.store offset=4
        ;; $return = decl_result ptr 
        ;; [gc]tmp = decl_var ptr 
        ;; call (ptr) => () 0, 8
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
        i32.const 8
        i32.store
        get_local 0
        call 0
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        ;; $mem = store Point (%2 = alloc Point 1), 0, (struct Point 20, 22, 0)
        i32.const 1
        i32.const 12
        i32.const 392
        get_local 0
        call $alloc
        tee_local 2
        tee_local 6
        get_local 6
        i32.const 20
        i32.store
        tee_local 6
        get_local 6
        i32.const 22
        i32.store offset=4
        tee_local 6
        get_local 6
        i32.const 0
        i32.store offset=8
        drop
        ;; [gc]tmp = copy ptr %2
        get_local 1
        get_local 2
        i32.store
        ;; call (i32) => () 1, [gc]tmp
        ;; parameter 0
        get_local 1
        i32.load
        get_local 0
        call 1
        ;; $mem = store Point (%5 = alloc Point 1), 0, (struct Point 10, 11, [gc]tmp)
        i32.const 1
        i32.const 12
        i32.const 408
        get_local 0
        call $alloc
        tee_local 3
        tee_local 6
        get_local 6
        i32.const 10
        i32.store
        tee_local 6
        get_local 6
        i32.const 11
        i32.store offset=4
        tee_local 6
        get_local 6
        get_local 1
        i32.load
        i32.store offset=8
        drop
        ;; [gc]p = copy ptr %5
        i32.const 328
        get_local 3
        i32.store
        ;; call (i32) => () 1, [gc]p
        ;; parameter 0
        i32.const 328
        i32.load
        get_local 0
        call 1
        ;; $mem = store Point (%8 = alloc Point 1), 0, (struct Point 20, 22, 0)
        i32.const 1
        i32.const 12
        i32.const 424
        get_local 0
        call $alloc
        tee_local 4
        tee_local 6
        get_local 6
        i32.const 20
        i32.store
        tee_local 6
        get_local 6
        i32.const 22
        i32.store offset=4
        tee_local 6
        get_local 6
        i32.const 0
        i32.store offset=8
        drop
        ;; [gc]tmp = copy ptr %8
        get_local 1
        get_local 4
        i32.store
        ;; call (i32) => () 1, [gc]tmp
        ;; parameter 0
        get_local 1
        i32.load
        get_local 0
        call 1
        ;; call (ptr) => () 3, [gc]tmp
        ;; Create stack frame for 3
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
        get_local 1
        i32.load
        i32.store
        get_local 0
        call 3
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        ;; $mem = store Point (%12 = alloc Point 1), 0, (struct Point 42, 84, [gc]tmp)
        i32.const 1
        i32.const 12
        i32.const 456
        get_local 0
        call $alloc
        tee_local 5
        tee_local 6
        get_local 6
        i32.const 42
        i32.store
        tee_local 6
        get_local 6
        i32.const 84
        i32.store offset=4
        tee_local 6
        get_local 6
        get_local 1
        i32.load
        i32.store offset=8
        drop
        ;; return ptr %12
        get_local 5
        return
        ;; end 
    )
    (func $useless (param i32) (local i32)
        get_local 0
        i32.const 260
        i32.sub
        tee_local 0
        set_local 1
        get_local 0
        i32.const -260
        i32.store offset=256
        ;; p = decl_param ptr 
        ;; arr = decl_var struct{...} 
        ;; call () => () -7
        get_local 0
        call $garbageCollect
        ;; end 
    )
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
        ;; if (ge_u i32 (%26 = shr_u i32 heapStartBlockNr, 1), 32768)
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
        ;; $mem = store i8 (add ptr root, %26), 112, (shl i8 7, (shl i32 (and i32 heapStartBlockNr, 1), 2))
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
        ;; call (addr) => () 5, b
        ;; parameter 0
        get_local 3
        get_local 0
        call 5
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
        ;; if (ge_u i32 (%35 = shr_u i32 freeBlockNr, 1), 32768)
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
        ;; %39 = or i8 (load i8 (%37 = add ptr root, %35), 112), (shl i8 4, (shl i32 (and i32 freeBlockNr, 1), 2))
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
        ;; $mem = store i8 %37, 112, %39
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
        ;; if (ge_u i32 (%47 = call (i32) => (i32) 11, (load i32 f, 8)), 15)
        ;; parameter 0
        get_local 5
        i32.load offset=8
        get_local 0
        call 11
        tee_local 12
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr (add ptr root, (mul i32 %47, 4)), 48, f
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
        i32.const 336
        get_local 7
        i32.const 16
        i32.shl
        i32.store
        ;; $mem = store i32 (addr_of ptr coroutine), 4, (shl i32 stackBlockCount, 16)
        i32.const 336
        get_local 4
        i32.const 16
        i32.shl
        i32.store offset=4
        ;; if (eqz addr (%57 = load ptr (addr_of ptr coroutine), 0))
        i32.const 336
        i32.load
        tee_local 13
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store i32 %57, 4, (shl i32 heapEndBlockNr, 16)
        get_local 13
        get_global 4
        i32.const 16
        i32.shl
        i32.store offset=4
        ;; if (ge_u i32 (%60 = shr_u i32 stack_block_nr, 1), 32768)
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
        ;; %64 = or i8 (load i8 (%62 = add ptr root, %60), 112), (shl i8 (or i32 8, (or i32 4, gcEpoch)), (shl i32 (and i32 stack_block_nr, 1), 2))
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
        ;; $mem = store i8 %62, 112, %64
        get_local 16
        get_local 15
        i32.store8 offset=112
        ;; if (eqz addr (%71 = load ptr (addr_of ptr coroutine), 0))
        i32.const 336
        i32.load
        tee_local 17
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; return addr (load addr %71, 4)
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
                    ;; if (ge_u i32 (%95 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %99 = or i8 (load i8 (%97 = add ptr b, %95), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
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
                    ;; $mem = store i8 %97, 0, %99
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
        ;; if (ge_u i32 (%120 = shr_u i32 area_nr, 1), 1024)
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
        ;; %124 = or i8 (load i8 (%122 = add ptr block, %120), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
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
        ;; $mem = store i8 %122, 0, %124
        get_local 8
        get_local 7
        i32.store8
        ;; end 
    )
    (func $allocBlocks (param i32) (param i32) (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; elementCount = decl_param i32 
        ;; elementSize = decl_param i32 
        ;; typeMap = decl_param addr 
        ;; epoch = decl_param i32 
        ;; has_gc = decl_param i8 
        ;; $return = decl_result addr 
        ;; size = decl_var i32 
        ;; flags = decl_var i32 
        ;; count = decl_var i32 
        ;; index = decl_var i32 
        ;; f = decl_var addr 
        ;; block_nr = decl_var i32 
        ;; size = mul i32 elementCount, elementSize
        get_local 0
        get_local 1
        i32.mul
        set_local 6
        ;; flags = or i32 epoch, 4
        get_local 3
        i32.const 4
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
        ;; count = div_u i32 (add i32 size, 65535), 65536
        get_local 6
        i32.const 65535
        i32.add
        i32.const 65536
        i32.div_u
        set_local 8
        ;; index = const i32 14
        i32.const 14
        set_local 9
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (ge_u i32 index, 0)), 1
                get_local 9
                i32.const 0
                i32.ge_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (le_u i32 (shl i32 1, index), count)
                    i32.const 1
                    get_local 9
                    i32.shl
                    get_local 8
                    i32.le_u
                    if
                        ;; br 3
                        br 3
                    end
                end
                ;; index = sub i32 index, 1
                get_local 9
                i32.const 1
                i32.sub
                set_local 9
                ;; br 0
                br 0
            end
        end
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 index, 15)), 1
                get_local 9
                i32.const 15
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 index, 15)
                    get_local 9
                    i32.const 15
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; if (ne addr (load addr (add ptr root, (mul i32 index, 4)), 48), 0)
                    get_global 2
                    get_local 9
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
                get_local 9
                i32.const 1
                i32.add
                set_local 9
                ;; br 0
                br 0
            end
        end
        ;; if (eq i32 index, 15)
        get_local 9
        i32.const 15
        i32.eq
        if
            ;; if has_gc
            get_local 4
            if
                ;; return addr 0
                i32.const 0
                return
            end
            ;; call () => () 15
            get_local 5
            call 15
            ;; return addr (call (i32,i32,addr,i32,i8) => (addr) 7, elementCount, elementSize, typeMap, epoch, 1)
            ;; parameter 0
            get_local 0
            ;; parameter 1
            get_local 1
            ;; parameter 2
            get_local 2
            ;; parameter 3
            get_local 3
            ;; parameter 4
            i32.const 1
            get_local 5
            call 7
            return
        end
        ;; if (ge_u i32 index, 15)
        get_local 9
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; f = load addr (add ptr root, (mul i32 index, 4)), 48
        get_global 2
        get_local 9
        i32.const 4
        i32.mul
        i32.add
        i32.load offset=48
        set_local 10
        ;; if (eq i32 (load i32 f, 8), count)
        get_local 10
        i32.load offset=8
        get_local 8
        i32.eq
        if
            ;; if (eqz addr (load addr f, 4))
            get_local 10
            i32.load offset=4
            i32.eqz
            if
                ;; if (ge_u i32 index, 15)
                get_local 9
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr f, 0)
                get_global 2
                get_local 9
                i32.const 4
                i32.mul
                i32.add
                get_local 10
                i32.load
                i32.store offset=48
            else
                ;; $mem = store addr (load addr f, 4), 0, (load addr f, 0)
                get_local 10
                i32.load offset=4
                get_local 10
                i32.load
                i32.store
            end
            ;; if (ne addr (load addr f, 0), 0)
            get_local 10
            i32.load
            i32.const 0
            i32.ne
            if
                ;; $mem = store addr (load addr f, 0), 4, (load addr f, 4)
                get_local 10
                i32.load
                get_local 10
                i32.load offset=4
                i32.store offset=4
            end
        else
            ;; f2 = decl_var addr 
            ;; index2 = decl_var i32 
            ;; f2 = copy addr f
            get_local 10
            set_local 12
            ;; $mem = store i32 f2, 8, (sub i32 (load i32 f2, 8), count)
            get_local 12
            get_local 12
            i32.load offset=8
            get_local 8
            i32.sub
            i32.store offset=8
            ;; f = add i32 f, (mul i32 65536, (load i32 f2, 8))
            get_local 10
            i32.const 65536
            get_local 12
            i32.load offset=8
            i32.mul
            i32.add
            set_local 10
            ;; index2 = const i32 14
            i32.const 14
            set_local 13
            ;; block 
            block
                ;; loop 
                loop
                    ;; br_if (eqz i8 (ge_u i32 index2, 0)), 1
                    get_local 13
                    i32.const 0
                    i32.ge_u
                    i32.eqz
                    br_if 1
                    ;; block 
                    block
                        ;; if (le_u i32 (shl i32 1, index2), (load i32 f2, 8))
                        i32.const 1
                        get_local 13
                        i32.shl
                        get_local 12
                        i32.load offset=8
                        i32.le_u
                        if
                            ;; br 3
                            br 3
                        end
                    end
                    ;; index2 = sub i32 index2, 1
                    get_local 13
                    i32.const 1
                    i32.sub
                    set_local 13
                    ;; br 0
                    br 0
                end
            end
            ;; if (ne i32 index2, index)
            get_local 13
            get_local 9
            i32.ne
            if
                ;; if (eqz addr (load addr f, 4))
                get_local 10
                i32.load offset=4
                i32.eqz
                if
                    ;; if (ge_u i32 index, 15)
                    get_local 9
                    i32.const 15
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 48, (load addr f, 0)
                    get_global 2
                    get_local 9
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 10
                    i32.load
                    i32.store offset=48
                else
                    ;; $mem = store addr (load addr f, 4), 0, (load addr f, 0)
                    get_local 10
                    i32.load offset=4
                    get_local 10
                    i32.load
                    i32.store
                end
                ;; if (ne addr (load addr f, 0), 0)
                get_local 10
                i32.load
                i32.const 0
                i32.ne
                if
                    ;; $mem = store addr (load addr f, 0), 4, (load addr f, 4)
                    get_local 10
                    i32.load
                    get_local 10
                    i32.load offset=4
                    i32.store offset=4
                end
                ;; $mem = store addr f2, 4, 0
                get_local 12
                i32.const 0
                i32.store offset=4
                ;; if (ge_u i32 index2, 15)
                get_local 13
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr f2, 0, (load addr (add ptr root, (mul i32 index2, 4)), 48)
                get_local 12
                get_global 2
                get_local 13
                i32.const 4
                i32.mul
                i32.add
                i32.load offset=48
                i32.store
                ;; if (ne addr (load addr f2, 0), 0)
                get_local 12
                i32.load
                i32.const 0
                i32.ne
                if
                    ;; $mem = store addr (load addr f2, 0), 4, f2
                    get_local 12
                    i32.load
                    get_local 12
                    i32.store offset=4
                end
                ;; if (ge_u i32 index2, 15)
                get_local 13
                i32.const 15
                i32.ge_u
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store addr (add ptr root, (mul i32 index2, 4)), 48, f2
                get_global 2
                get_local 13
                i32.const 4
                i32.mul
                i32.add
                get_local 12
                i32.store offset=48
            end
        end
        ;; block_nr = sub i32 (shr_u i32 (sub i32 f, root), 16), 1
        get_local 10
        get_global 2
        i32.sub
        i32.const 16
        i32.shr_u
        i32.const 1
        i32.sub
        set_local 11
        ;; if (ge_u i32 (%202 = shr_u i32 block_nr, 1), 32768)
        get_local 11
        i32.const 1
        i32.shr_u
        tee_local 14
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %206 = or i8 (load i8 (%204 = add ptr root, %202), 112), (shl i32 flags, (shl i32 (and i32 block_nr, 1), 2))
        get_global 2
        get_local 14
        i32.add
        tee_local 16
        i32.load8_u offset=112
        get_local 7
        get_local 11
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 15
        ;; $mem = store i8 %204, 112, %206
        get_local 16
        get_local 15
        i32.store8 offset=112
        ;; start = decl_var addr 
        ;; if (ne addr typeMap, 0)
        get_local 2
        i32.const 0
        i32.ne
        if
            ;; start = copy addr f
            get_local 10
            set_local 17
            ;; if (eq i32 elementCount, 1)
            get_local 0
            i32.const 1
            i32.eq
            if
                ;; if (eqz addr start)
                get_local 17
                i32.eqz
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store s32 start, 0, typeMap
                get_local 17
                get_local 2
                i32.store
                ;; f = add i32 f, 4
                get_local 10
                i32.const 4
                i32.add
                set_local 10
            else
                ;; if (eqz addr start)
                get_local 17
                i32.eqz
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store s32 start, 0, (add s32 (xor s32 elementCount, -1), 1)
                get_local 17
                get_local 0
                i32.const -1
                i32.xor
                i32.const 1
                i32.add
                i32.store
                ;; start = add addr start, 4
                get_local 17
                i32.const 4
                i32.add
                set_local 17
                ;; if (eqz addr start)
                get_local 17
                i32.eqz
                if
                    ;; trap 
                    unreachable
                end
                ;; $mem = store s32 start, 0, typeMap
                get_local 17
                get_local 2
                i32.store
                ;; f = add i32 f, 8
                get_local 10
                i32.const 8
                i32.add
                set_local 10
            end
        end
        ;; return addr f
        get_local 10
        return
        ;; end 
    )
    (func $alloc (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; elementCount = decl_param i32 
        ;; elementSize = decl_param i32 
        ;; typeMap = decl_param addr 
        ;; $return = decl_result addr 
        ;; size = decl_var i32 
        ;; flags = decl_var i32 
        ;; index = decl_var i32 
        ;; targetIndex = decl_var i32 
        ;; size = mul i32 elementCount, elementSize
        get_local 0
        get_local 1
        i32.mul
        set_local 4
        ;; flags = or i32 4, gcEpoch
        i32.const 4
        get_global 5
        i32.or
        set_local 5
        ;; if (ne addr typeMap, 0)
        get_local 2
        i32.const 0
        i32.ne
        if
            ;; size = add i32 size, 4
            get_local 4
            i32.const 4
            i32.add
            set_local 4
            ;; if (ne i32 elementCount, 1)
            get_local 0
            i32.const 1
            i32.ne
            if
                ;; size = add i32 size, 4
                get_local 4
                i32.const 4
                i32.add
                set_local 4
            end
            ;; flags = or i32 flags, 8
            get_local 5
            i32.const 8
            i32.or
            set_local 5
        end
        ;; if (gt_u i32 size, 32768)
        get_local 4
        i32.const 32768
        i32.gt_u
        if
            ;; return addr (call (i32,i32,addr,i32,i8) => (addr) 7, elementCount, elementSize, typeMap, gcEpoch, 0)
            ;; parameter 0
            get_local 0
            ;; parameter 1
            get_local 1
            ;; parameter 2
            get_local 2
            ;; parameter 3
            get_global 5
            ;; parameter 4
            i32.const 0
            get_local 3
            call 7
            return
        end
        ;; if (gt_u i32 size, 16384)
        get_local 4
        i32.const 16384
        i32.gt_u
        if
            ;; index = const i32 10
            i32.const 10
            set_local 6
        else
            ;; if (gt_u i32 size, 8192)
            get_local 4
            i32.const 8192
            i32.gt_u
            if
                ;; index = const i32 9
                i32.const 9
                set_local 6
            else
                ;; if (gt_u i32 size, 4096)
                get_local 4
                i32.const 4096
                i32.gt_u
                if
                    ;; index = const i32 8
                    i32.const 8
                    set_local 6
                else
                    ;; if (gt_u i32 size, 2048)
                    get_local 4
                    i32.const 2048
                    i32.gt_u
                    if
                        ;; index = const i32 7
                        i32.const 7
                        set_local 6
                    else
                        ;; if (gt_u i32 size, 1024)
                        get_local 4
                        i32.const 1024
                        i32.gt_u
                        if
                            ;; index = const i32 6
                            i32.const 6
                            set_local 6
                        else
                            ;; if (gt_u i32 size, 512)
                            get_local 4
                            i32.const 512
                            i32.gt_u
                            if
                                ;; index = const i32 5
                                i32.const 5
                                set_local 6
                            else
                                ;; if (gt_u i32 size, 256)
                                get_local 4
                                i32.const 256
                                i32.gt_u
                                if
                                    ;; index = const i32 4
                                    i32.const 4
                                    set_local 6
                                else
                                    ;; if (gt_u i32 size, 128)
                                    get_local 4
                                    i32.const 128
                                    i32.gt_u
                                    if
                                        ;; index = const i32 3
                                        i32.const 3
                                        set_local 6
                                    else
                                        ;; if (gt_u i32 size, 64)
                                        get_local 4
                                        i32.const 64
                                        i32.gt_u
                                        if
                                            ;; index = const i32 2
                                            i32.const 2
                                            set_local 6
                                        else
                                            ;; if (gt_u i32 size, 32)
                                            get_local 4
                                            i32.const 32
                                            i32.gt_u
                                            if
                                                ;; index = const i32 1
                                                i32.const 1
                                                set_local 6
                                            else
                                                ;; index = const i32 0
                                                i32.const 0
                                                set_local 6
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
        get_local 6
        set_local 7
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
                get_local 6
                i32.const 11
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 index, 11)
                    get_local 6
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; f = load addr (add ptr root, (mul i32 index, 4)), 0
                    get_global 2
                    get_local 6
                    i32.const 4
                    i32.mul
                    i32.add
                    i32.load
                    set_local 8
                    ;; if (eqz addr f)
                    get_local 8
                    i32.eqz
                    if
                        ;; br 1
                        br 1
                    end
                    ;; if (ge_u i32 index, 11)
                    get_local 6
                    i32.const 11
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; $mem = store addr (add ptr root, (mul i32 index, 4)), 0, (load addr f, 0)
                    get_global 2
                    get_local 6
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 8
                    i32.load
                    i32.store
                    ;; if (ne addr (load addr f, 0), 0)
                    get_local 8
                    i32.load
                    i32.const 0
                    i32.ne
                    if
                        ;; $mem = store addr (load addr f, 0), 4, 0
                        get_local 8
                        i32.load
                        i32.const 0
                        i32.store offset=4
                    end
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (gt_u i32 index, targetIndex)), 1
                            get_local 6
                            get_local 7
                            i32.gt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; call (addr,i32) => () 6, f, index
                                ;; parameter 0
                                get_local 8
                                ;; parameter 1
                                get_local 6
                                get_local 3
                                call 6
                            end
                            ;; index = sub i32 index, 1
                            get_local 6
                            i32.const 1
                            i32.sub
                            set_local 6
                            ;; br 0
                            br 0
                        end
                    end
                    ;; block = and i32 f, (xor i32 65535, -1)
                    get_local 8
                    i32.const 65535
                    i32.const -1
                    i32.xor
                    i32.and
                    set_local 9
                    ;; area_nr = shr_u i32 (and i32 f, 65535), 5
                    get_local 8
                    i32.const 65535
                    i32.and
                    i32.const 5
                    i32.shr_u
                    set_local 10
                    ;; if (ge_u i32 (%256 = shr_u i32 area_nr, 1), 1024)
                    get_local 10
                    i32.const 1
                    i32.shr_u
                    tee_local 13
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %260 = or i8 (load i8 (%258 = add ptr block, %256), 0), (shl i32 flags, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 9
                    get_local 13
                    i32.add
                    tee_local 15
                    i32.load8_u
                    get_local 5
                    get_local 10
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.or
                    set_local 14
                    ;; $mem = store i8 %258, 0, %260
                    get_local 15
                    get_local 14
                    i32.store8
                    ;; ptr = copy addr f
                    get_local 8
                    set_local 11
                    ;; iterations = div_u i32 (add i32 size, 7), 8
                    get_local 4
                    i32.const 7
                    i32.add
                    i32.const 8
                    i32.div_u
                    set_local 12
                    ;; i = decl_var i32 
                    ;; i = const i32 0
                    i32.const 0
                    set_local 16
                    ;; block 
                    block
                        ;; loop 
                        loop
                            ;; br_if (eqz i8 (lt_u i32 i, iterations)), 1
                            get_local 16
                            get_local 12
                            i32.lt_u
                            i32.eqz
                            br_if 1
                            ;; block 
                            block
                                ;; if (eqz addr ptr)
                                get_local 11
                                i32.eqz
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; $mem = store i64 ptr, 0, 0
                                get_local 11
                                i64.const 0
                                i64.store
                                ;; ptr = add addr ptr, 8
                                get_local 11
                                i32.const 8
                                i32.add
                                set_local 11
                            end
                            ;; i = add i32 i, 1
                            get_local 16
                            i32.const 1
                            i32.add
                            set_local 16
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
                        get_local 8
                        set_local 17
                        ;; if (eq i32 elementCount, 1)
                        get_local 0
                        i32.const 1
                        i32.eq
                        if
                            ;; if (eqz addr start)
                            get_local 17
                            i32.eqz
                            if
                                ;; trap 
                                unreachable
                            end
                            ;; $mem = store s32 start, 0, typeMap
                            get_local 17
                            get_local 2
                            i32.store
                            ;; f = add i32 f, 4
                            get_local 8
                            i32.const 4
                            i32.add
                            set_local 8
                        else
                            ;; if (eqz addr start)
                            get_local 17
                            i32.eqz
                            if
                                ;; trap 
                                unreachable
                            end
                            ;; $mem = store s32 start, 0, (add s32 (xor s32 elementCount, -1), 1)
                            get_local 17
                            get_local 0
                            i32.const -1
                            i32.xor
                            i32.const 1
                            i32.add
                            i32.store
                            ;; start = add addr start, 4
                            get_local 17
                            i32.const 4
                            i32.add
                            set_local 17
                            ;; if (eqz addr start)
                            get_local 17
                            i32.eqz
                            if
                                ;; trap 
                                unreachable
                            end
                            ;; $mem = store s32 start, 0, typeMap
                            get_local 17
                            get_local 2
                            i32.store
                            ;; f = add i32 f, 8
                            get_local 8
                            i32.const 8
                            i32.add
                            set_local 8
                        end
                    end
                    ;; $mem = store i32 block, 4, (add i32 (load i32 block, 4), 1)
                    get_local 9
                    get_local 9
                    i32.load offset=4
                    i32.const 1
                    i32.add
                    i32.store offset=4
                    ;; return addr f
                    get_local 8
                    return
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
        ;; call (addr) => () 5, (call (i32,i32,addr,i32,i8) => (addr) 7, 1, 65536, 0, 3, 0)
        ;; parameter 0
        ;; parameter 0
        i32.const 1
        ;; parameter 1
        i32.const 65536
        ;; parameter 2
        i32.const 0
        ;; parameter 3
        i32.const 3
        ;; parameter 4
        i32.const 0
        get_local 3
        call 7
        get_local 3
        call 5
        ;; return addr (call (i32,i32,addr) => (addr) 8, elementCount, elementSize, typeMap)
        ;; parameter 0
        get_local 0
        ;; parameter 1
        get_local 1
        ;; parameter 2
        get_local 2
        get_local 3
        call 8
        return
        ;; end 
    )
    (func $free (param i32) (param i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; block = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; call (addr,i32) => () 10, (and i32 ptr, (xor i32 65535, -1)), (shr_u i32 (and i32 ptr, 65535), 5)
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
        call 10
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
                    ;; if (ge_u i32 (%290 = shr_u i32 area_nr, 1), 1024)
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
                    ;; if (eqz i8 (and i8 (load i8 (add ptr block, %290), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))))
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
                                ;; if (ge_u i32 (%304 = shr_u i32 next_area_nr, 1), 1024)
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
                                ;; if (ne i8 (and i8 (load i8 (add ptr block, %304), 0), (shl i32 4, (shl i32 (and i32 next_area_nr, 1), 2))), 0)
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
                    ;; if (ge_u i32 (%315 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %319 = and i8 (load i8 (%317 = add ptr block, %315), 0), (xor i8 (shl i32 15, (shl i32 (and i32 area_nr, 1), 2)), -1)
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
                    ;; $mem = store i8 %317, 0, %319
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
                                ;; if (ge_u i32 (%330 = shr_u i32 buddy_area_nr, 1), 1024)
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
                                ;; if (ne i8 (and i8 (load i8 (add ptr block, %330), 0), (shl i32 3, (shl i32 (and i32 buddy_area_nr, 1), 2))), 0)
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
                                    ;; if (ge_u i32 (%354 = shr_u i32 area_nr, 1), 1024)
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
                                    ;; %358 = and i8 (load i8 (%356 = add ptr block, %354), 0), (xor i8 (shl i32 4, (shl i32 (and i32 area_nr, 1), 2)), -1)
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
                                    ;; $mem = store i8 %356, 0, %358
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
                                    ;; if (ge_u i32 (%363 = shr_u i32 buddy_area_nr, 3), 1024)
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
                                    ;; %367 = and i8 (load i8 (%365 = add ptr block, %363), 0), (xor i8 (shl i32 4, (shl i32 (and i32 buddy_area_nr, 1), 2)), -1)
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
                                    ;; $mem = store i8 %365, 0, %367
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
                    ;; if (ge_u i32 (%388 = shr_u i32 end_block_nr, 1), 32768)
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
                    ;; if (eq i8 (and i8 (load i8 (add ptr root, %388), 112), (shl i8 4, (shl i32 (and i32 end_block_nr, 1), 2))), 4)
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
        ;; count = call (i32) => (i32) 12, block_nr
        ;; parameter 0
        get_local 0
        get_local 1
        call 12
        set_local 2
        ;; index = call (i32) => (i32) 11, count
        ;; parameter 0
        get_local 2
        get_local 1
        call 11
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
        ;; count = call (i32) => (i32) 12, block_nr
        ;; parameter 0
        get_local 1
        get_local 2
        call 12
        set_local 3
        ;; if (ge_u i32 (%412 = shr_u i32 block_nr, 1), 32768)
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
        ;; %416 = and i8 (load i8 (%414 = add ptr root, %412), 112), (xor i8 (shl i8 4, (shl i32 (and i32 block_nr, 1), 2)), -1)
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
        ;; $mem = store i8 %414, 112, %416
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
            ;; index = call (i32) => (i32) 11, (load i32 free, 8)
            ;; parameter 0
            get_local 4
            i32.load offset=8
            get_local 2
            call 11
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
        ;; index = call (i32) => (i32) 11, (load i32 free, 8)
        ;; parameter 0
        get_local 4
        i32.load offset=8
        get_local 2
        call 11
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
        ;; if (eqz addr (%452 = load ptr (addr_of ptr coroutine), 0))
        i32.const 336
        i32.load
        tee_local 3
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr %452, 8, (call () => (addr) -8)
        get_local 3
        get_local 0
        i32.store offset=8
        ;; call (addr,addr) => () 21, 0, (call () => (addr) -4)
        ;; parameter 0
        i32.const 0
        ;; parameter 1
        get_global 1
        get_local 0
        call 21
        ;; call (ptr) => () 0, 32
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
        i32.const 32
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
                    ;; if (ge_u i32 (%460 = shr_u i32 block_nr, 1), 32768)
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
                    ;; flags = and i8 (shr_u i8 (load i8 (add ptr root, %460), 112), (shl i32 (and i32 block_nr, 1), 2)), 15
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
                        ;; call (ptr) => () 0, 56
                        ;; Create stack frame for 0
                        get_local 0
                        i32.const 8
                        i32.sub
                        set_local 0
                        ;; Store typemap
                        get_local 0
                        i32.const 488
                        i32.store offset=4
                        ;; parameter 0
                        get_local 0
                        i32.const 56
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
                            ;; call (ptr) => () 0, 72
                            ;; Create stack frame for 0
                            get_local 0
                            i32.const 8
                            i32.sub
                            set_local 0
                            ;; Store typemap
                            get_local 0
                            i32.const 504
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
                            ;; $mem = store i32 block, 8, 0
                            get_local 7
                            i32.const 0
                            i32.store offset=8
                            ;; br 2
                            br 2
                        end
                        ;; call (ptr) => () 0, 96
                        ;; Create stack frame for 0
                        get_local 0
                        i32.const 8
                        i32.sub
                        set_local 0
                        ;; Store typemap
                        get_local 0
                        i32.const 520
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
                                    ;; if (ge_u i32 (%485 = shr_u i32 area_nr, 1), 1024)
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
                                    ;; area_flags = and i8 (shr_u i8 (load i8 (add ptr block, %485), 0), (shl i32 (and i32 area_nr, 1), 2)), 15
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
                                        ;; call (ptr) => () 0, 120
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 536
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
                                        ;; call (addr,i32) => () 10, block, area_nr
                                        ;; parameter 0
                                        get_local 7
                                        ;; parameter 1
                                        get_local 8
                                        get_local 0
                                        call 10
                                        ;; call (ptr) => () 0, 144
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 552
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 144
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
                                ;; call (ptr) => () 0, 160
                                ;; Create stack frame for 0
                                get_local 0
                                i32.const 8
                                i32.sub
                                set_local 0
                                ;; Store typemap
                                get_local 0
                                i32.const 568
                                i32.store offset=4
                                ;; parameter 0
                                get_local 0
                                i32.const 160
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
                                ;; if (ge_u i32 (%518 = shr_u i32 block_nr, 1), 32768)
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
                                ;; %522 = and i8 (load i8 (%520 = add ptr root, %518), 112), (xor i8 (shl i32 3, (shl i32 (and i32 block_nr, 1), 2)), -1)
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
                                ;; $mem = store i8 %520, 112, %522
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
                                        ;; call (ptr) => () 0, 192
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 584
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 192
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
                                        ;; call (i32) => () 13, latestFreeBlock_nr
                                        ;; parameter 0
                                        get_local 2
                                        get_local 0
                                        call 13
                                    else
                                        ;; call (ptr) => () 0, 224
                                        ;; Create stack frame for 0
                                        get_local 0
                                        i32.const 8
                                        i32.sub
                                        set_local 0
                                        ;; Store typemap
                                        get_local 0
                                        i32.const 600
                                        i32.store offset=4
                                        ;; parameter 0
                                        get_local 0
                                        i32.const 224
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
                                        ;; call (i32,i32) => () 14, latestFreeBlock_nr, block_nr
                                        ;; parameter 0
                                        get_local 2
                                        ;; parameter 1
                                        get_local 4
                                        get_local 0
                                        call 14
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
        ;; if (ge_u i32 (%537 = shr_u i32 block_nr, 1), 32768)
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
        ;; flags = and i8 (shr_u i8 (load i8 (add ptr root, %537), 112), (shl i32 (and i32 block_nr, 1), 2)), 15
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
            ;; call (addr,i32) => () 17, (shl i32 block_nr, 16), (shr_u i32 (and addr ptr, 65535), 5)
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
            call 17
        else
            ;; if (ne i8 (and i8 flags, 3), 0)
            get_local 3
            i32.const 3
            i32.and
            i32.const 0
            i32.ne
            if
                ;; call (i32) => () 18, block_nr
                ;; parameter 0
                get_local 2
                get_local 1
                call 18
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
                    ;; if (ge_u i32 (%558 = shr_u i32 area_nr, 1), 1024)
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
                    ;; area_flags = and i8 (shr_u i8 (load i8 (add ptr block, %558), 0), (shl i32 (and i32 area_nr, 1), 2)), 15
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
                    ;; if (ge_u i32 (%572 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %576 = xor i8 (load i8 (%574 = add ptr block, %572), 0), (shl i8 3, (shl i32 (and i32 area_nr, 1), 2))
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
                    ;; $mem = store i8 %574, 0, %576
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
                        ;; call (addr) => () 19, (add i32 block, (shl i32 area_nr, 5))
                        ;; parameter 0
                        get_local 0
                        get_local 1
                        i32.const 5
                        i32.shl
                        i32.add
                        get_local 2
                        call 19
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
                    ;; if (ge_u i32 (%589 = shr_u i32 block_nr, 1), 32768)
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
                    ;; flags = and i8 (shr_u i8 (load i8 (add ptr root, %589), 112), (shl i32 (and i32 block_nr, 1), 2)), 15
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
                        ;; if (ge_u i32 (%599 = shr_u i32 block_nr, 1), 32768)
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
                        ;; %603 = xor i8 (load i8 (%601 = add ptr root, %599), 112), (shl i8 3, (shl i32 (and i32 block_nr, 1), 2))
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
                        ;; $mem = store i8 %601, 112, %603
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
                            ;; call (addr) => () 19, (shl i32 block_nr, 16)
                            ;; parameter 0
                            get_local 0
                            i32.const 16
                            i32.shl
                            get_local 1
                            call 19
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
                            ;; if (ge_u i32 (%613 = shr_u i32 block_nr, 1), 32768)
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
                            ;; %617 = or i8 (load i8 (%615 = add ptr root, %613), 112), (shl i8 gcEpoch, (shl i32 (and i32 block_nr, 1), 2))
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
                            ;; $mem = store i8 %615, 112, %617
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
    (func $traverseHeapArea (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; iptr = decl_var addr 
        ;; first = decl_var s32 
        ;; elementCount = decl_var i32 
        ;; typemap = decl_var addr 
        ;; size = decl_var i32 
        ;; data = decl_var addr 
        ;; iptr = copy addr ptr
        get_local 0
        set_local 2
        ;; first = load s32 iptr, 0
        get_local 2
        i32.load
        set_local 3
        ;; typemap = decl_var addr 
        ;; if (gt_s s32 first, 0)
        get_local 3
        i32.const 0
        i32.gt_s
        if
            ;; call (addr,addr) => () 21, (add i32 iptr, 4), (copy addr first)
            ;; parameter 0
            get_local 2
            i32.const 4
            i32.add
            ;; parameter 1
            get_local 3
            get_local 1
            call 21
            ;; return 
            return
        end
        ;; if (eqz s32 first)
        get_local 3
        i32.eqz
        if
            ;; call (addr) => () 20, ptr
            ;; parameter 0
            get_local 0
            get_local 1
            call 20
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
        ;; iptr = add addr iptr, 4
        get_local 2
        i32.const 4
        i32.add
        set_local 2
        ;; typemap = load s32 iptr, 0
        get_local 2
        i32.load
        set_local 5
        ;; size = load s32 typemap, 0
        get_local 5
        i32.load
        set_local 6
        ;; iptr = add addr iptr, 4
        get_local 2
        i32.const 4
        i32.add
        set_local 2
        ;; data = copy addr iptr
        get_local 2
        set_local 7
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 9
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, elementCount)), 1
                get_local 9
                get_local 4
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; call (addr,addr) => () 21, data, typemap
                    ;; parameter 0
                    get_local 7
                    ;; parameter 1
                    get_local 5
                    get_local 1
                    call 21
                    ;; data = add addr data, (mul i32 size, 4)
                    get_local 7
                    get_local 6
                    i32.const 4
                    i32.mul
                    i32.add
                    set_local 7
                end
                ;; i = add i32 i, 1
                get_local 9
                i32.const 1
                i32.add
                set_local 9
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
        ;; call (ptr) => () 0, 248
        ;; Create stack frame for 0
        get_local 1
        i32.const 8
        i32.sub
        set_local 1
        ;; Store typemap
        get_local 1
        i32.const 616
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
                    ;; call (ptr) => () 0, 272
                    ;; Create stack frame for 0
                    get_local 1
                    i32.const 8
                    i32.sub
                    set_local 1
                    ;; Store typemap
                    get_local 1Yang Yu <yang.yu.r@stud.uni-due.de>
                    i32.const 632
                    i32.store offset=4
                    ;; parameter 0
                    get_local 1
                    i32.const 272
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
                        ;; ptr = add addr ptr, (mul i32 typemapOrSize, 4)
                        get_local 3
                        get_local 4
                        i32.const 4
                        i32.mul
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
                        ;; ptr = sub addr ptr, (mul i32 (load s32 typemap, 0), 4)
                        get_local 3
                        get_local 5
                        i32.load
                        i32.const 4
                        i32.mul
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
                        ;; call (addr,addr) => () 21, ptr, typemap
                        ;; parameter 0
                        get_local 3
                        ;; parameter 1
                        get_local 5
                        get_local 1
                        call 21
                    end
                    ;; call (ptr) => () 0, 288
                    ;; Create stack frame for 0
                    get_local 1
                    i32.const 8
                    i32.sub
                    set_local 1
                    ;; Store typemap
                    get_local 1
                    i32.const 648
                    i32.store offset=4
                    ;; parameter 0
                    get_local 1
                    i32.const 288
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
        ;; call (ptr) => () 0, 312
        ;; Create stack frame for 0
        get_local 2
        i32.const 8
        i32.sub
        set_local 2
        ;; Store typemap
        get_local 2
        i32.const 664
        i32.store offset=4
        ;; parameter 0
        get_local 2
        i32.const 312
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
                                        ;; call (addr,addr) => () 21, ptr2, typemap2
                                        ;; parameter 0
                                        get_local 10
                                        ;; parameter 1
                                        get_local 9
                                        get_local 2
                                        call 21
                                        ;; ptr2 = add addr ptr2, (mul i32 size, 4)
                                        get_local 10
                                        get_local 10
                                        i32.const 4
                                        i32.mul
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
                                        ;; call (addr) => () 16, ptr2
                                        ;; parameter 0
                                        get_local 11
                                        get_local 2
                                        call 16
                                        ;; ptr2 = add addr ptr2, (mul i32 4, 4)
                                        get_local 11
                                        i32.const 4
                                        i32.const 4
                                        i32.mul
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
                        ;; call (addr) => () 16, (load addr (add i32 ptr, a), 0)
                        ;; parameter 0
                        get_local 0
                        get_local 5
                        i32.add
                        i32.load
                        get_local 2
                        call 16
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
    (func $string_concat (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
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
        ;; p = call (i32,i32,addr) => (addr) 8, (add i32 4, (add i32 s1, s2)), 1, 0
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
        get_local 0
        call 8
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
    (func $string_compare (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
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
    (func $make_string (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32)
        ;; src = decl_param addr 
        ;; length = decl_param i32 
        ;; $return = decl_result ptr 
        ;; p = decl_var addr 
        ;; dest = decl_var addr 
        ;; p = call (i32,i32,addr) => (addr) 8, (add i32 4, length), 1, 0
        ;; parameter 0
        i32.const 4
        get_local 1
        i32.add
        ;; parameter 1
        i32.const 1
        ;; parameter 2
        i32.const 0
        get_local 2
        call 8
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
    (data (i32.const 0) "\00\00\00\00")
    (data (i32.const 8) "\0f\00\00\00\48\65\6c\6c\6f\20\66\72\6f\6d\20\6d\61\69\6e")
    (data (i32.const 32) "\0e\00\00\00\2e\2e\2e\20\67\63\20\72\75\6e\6e\69\6e\67")
    (data (i32.const 56) "\0a\00\00\00\41\72\65\61\20\62\6c\6f\63\6b")
    (data (i32.const 72) "\10\00\00\00\41\6c\6c\20\61\72\65\61\73\20\6d\61\72\6b\65\64")
    (data (i32.const 96) "\0e\00\00\00\42\6c\6f\63\6b\20\6e\65\65\64\73\20\67\63")
    (data (i32.const 120) "\0f\00\00\00\20\20\20\66\72\65\65\69\6e\67\20\61\72\65\61")
    (data (i32.const 144) "\07\00\00\00\20\20\20\66\72\65\65")
    (data (i32.const 160) "\17\00\00\00\46\72\65\65\20\73\65\71\75\65\6e\63\65\20\6f\66\20\62\6c\6f\63\6b\73")
    (data (i32.const 192) "\1a\00\00\00\46\72\65\65\20\73\69\6e\67\6c\65\20\62\6c\6f\63\6b\20\73\65\71\75\65\6e\63\65")
    (data (i32.const 224) "\14\00\00\00\4d\65\72\67\65\20\62\6c\6f\63\6b\20\73\65\71\75\65\6e\63\65")
    (data (i32.const 248) "\0f\00\00\00\74\72\61\76\65\72\73\69\6e\67\53\74\61\63\6b")
    (data (i32.const 272) "\0b\00\00\00\73\74\61\63\6b\20\66\72\61\6d\65")
    (data (i32.const 288) "\11\00\00\00\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d\2d")
    (data (i32.const 312) "\0c\00\00\00\74\72\61\76\65\72\73\65\54\79\70\65")
    (data (i32.const 360) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 344) "\00\00\00\00\02\00\00\00\48\01\00\00\50\01\00\00")
    (data (i32.const 376) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 392) "\03\00\00\00\01\00\00\00\08\00\00\00")
    (data (i32.const 408) "\03\00\00\00\01\00\00\00\08\00\00\00")
    (data (i32.const 424) "\03\00\00\00\01\00\00\00\08\00\00\00")
    (data (i32.const 440) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 456) "\03\00\00\00\01\00\00\00\08\00\00\00")
    (data (i32.const 472) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 488) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 504) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 520) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 536) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 552) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 568) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 584) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 600) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 616) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 632) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 648) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (data (i32.const 664) "\02\00\00\00\01\00\00\00\00\00\00\00")
    (export "main" (func 2))
    (export "useless" (func 3))
    (export "initializeMemory" (func 4))
    (export "initializeBlock" (func 5))
    (export "split" (func 6))
    (export "allocBlocks" (func 7))
    (export "alloc" (func 8))
    (export "free" (func 9))
    (export "free_intern" (func 10))
    (export "blockCountToIndex" (func 11))
    (export "countBlocks" (func 12))
    (export "freeBlocks" (func 13))
    (export "mergeAndFreeBlocks" (func 14))
    (export "garbageCollect" (func 15))
    (export "mark" (func 16))
    (export "markArea" (func 17))
    (export "markBlocks" (func 18))
    (export "traverseHeapArea" (func 19))
    (export "traverseStack" (func 20))
    (export "traverseType" (func 21))
    (export "copy" (func 22))
    (export "string_concat" (func 23))
    (export "string_compare" (func 24))
    (export "make_string" (func 25))
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
