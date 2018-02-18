(module
    (func $logString (import "imports" "logString") (param i32) )
    (func $logNumber (import "imports" "logNumber") (param i32 i32) )
    (import "imports" "mem" (memory 3))
    (global $root (mut i32) (i32.const 0))
    (global $stackEnd (mut i32) (i32.const 0))
    (global $heapStartBlockNr (mut i32) (i32.const 0))
    (global $heapEndBlockNr (mut i32) (i32.const 0))
    (global $gcEpoch (mut i32) (i32.const 0))
    (func $getTuple (param i32) (local i32)
        get_local 0
        set_local 1
        ;; $return = decl_result struct{...} 
        ;; return struct{...} (struct struct{...} 82, 164)
        get_local 0
        i32.const 82
        i32.store
        get_local 0
        i32.const 164
        i32.store offset=4
        return
        ;; end 
    )
    (func $useTuple (param i32) (result i32) (local i32) (local i32) (local i32) (local i32)
        get_local 0
        i32.const 8
        i32.sub
        tee_local 0
        set_local 1
        ;; $return = decl_result s32 
        ;; a = decl_var s32 
        ;; b = decl_var s32 
        ;; %1 = call () => (struct{...}) 2
        get_local 1
        ;; Create stack frame
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        get_local 0
        call 2
        get_local 0
        i64.load align=4
        i64.store align=4
        ;; Remove stack frame and restore the SP
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        ;; return s32 (add s32 (load s32 (%2 = addr_of ptr %1), 0), (load s32 %2, 0))
        get_local 1
        tee_local 4
        i32.load
        get_local 4
        i32.load
        i32.add
        return
        ;; end 
    )
    (func $compare1 (param i32) (result i32)
        ;; $return = decl_result s32 
        ;; if (lt_s i32 (call (ptr,ptr) => (s32) 42, (call () => (ptr) 10), (call () => (ptr) 11)), 0)
        ;; Create stack frame for 42
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 0
        call 10
        i32.store
        ;; parameter 1
        get_local 0
        get_local 0
        call 11
        i32.store offset=4
        get_local 0
        call 42
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        i32.const 0
        i32.lt_s
        if
            ;; return s32 42
            i32.const 42
            return
        end
        ;; return s32 84
        i32.const 84
        return
        ;; end 
    )
    (func $compare2 (param i32) (result i32)
        ;; $return = decl_result s32 
        ;; if (ne i32 (call (ptr,ptr) => (s32) 42, (call () => (ptr) 10), (call () => (ptr) 11)), 0)
        ;; Create stack frame for 42
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 0
        call 10
        i32.store
        ;; parameter 1
        get_local 0
        get_local 0
        call 11
        i32.store offset=4
        get_local 0
        call 42
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        i32.const 0
        i32.ne
        if
            ;; return s32 42
            i32.const 42
            return
        end
        ;; return s32 84
        i32.const 84
        return
        ;; end 
    )
    (func $compare3 (param i32) (result i32)
        ;; $return = decl_result s32 
        ;; if (eqz i32 (call (ptr,ptr) => (s32) 42, (call () => (ptr) 10), (call () => (ptr) 11)))
        ;; Create stack frame for 42
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 0
        call 10
        i32.store
        ;; parameter 1
        get_local 0
        get_local 0
        call 11
        i32.store offset=4
        get_local 0
        call 42
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        i32.eqz
        if
            ;; return s32 42
            i32.const 42
            return
        end
        ;; return s32 84
        i32.const 84
        return
        ;; end 
    )
    (func $main (param i32) (result i32) (local i32)
        ;; $return = decl_result ptr 
        ;; name = decl_var ptr 
        ;; call (ptr) => () 0, 8
        ;; Create stack frame for 0
        get_local 0
        i32.const 4
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        i32.const 8
        i32.store
        get_local 0
        call 0
        ;; Remove parameters
        get_local 0
        i32.const 4
        i32.add
        set_local 0
        ;; return ptr (call (ptr,ptr) => (ptr) 41, 32, (call () => (ptr) 8))
        ;; Create stack frame for 41
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        i32.const 32
        i32.store
        ;; parameter 1
        get_local 0
        get_local 0
        call 8
        i32.store offset=4
        get_local 0
        call 41
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        return
        ;; end 
    )
    (func $action (param i32) (result i32)
        ;; $return = decl_result ptr 
        ;; return ptr 48
        i32.const 48
        return
        ;; end 
    )
    (func $fuck (param i32) (result i32)
        ;; $return = decl_result ptr 
        ;; return ptr (call (ptr,ptr) => (ptr) 41, (call () => (ptr) 10), (call (ptr,ptr) => (ptr) 41, 64, (call () => (ptr) 11)))
        ;; Create stack frame for 41
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 0
        call 10
        i32.store
        ;; parameter 1
        get_local 0
        ;; Create stack frame for 41
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        i32.const 64
        i32.store
        ;; parameter 1
        get_local 0
        get_local 0
        call 11
        i32.store offset=4
        get_local 0
        call 41
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        i32.store offset=4
        get_local 0
        call 41
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        return
        ;; end 
    )
    (func $action1 (param i32) (result i32)
        ;; $return = decl_result ptr 
        ;; return ptr 72
        i32.const 72
        return
        ;; end 
    )
    (func $action2 (param i32) (result i32)
        ;; $return = decl_result ptr 
        ;; return ptr 80
        i32.const 80
        return
        ;; end 
    )
    (func $action3 (param i32) (result i32)
        ;; $return = decl_result ptr 
        ;; return ptr 88
        i32.const 88
        return
        ;; end 
    )
    (func $dummy (param i32) (result i32)
        ;; $return = decl_result ptr 
        ;; return ptr (call (ptr,ptr) => (ptr) 41, (call () => (ptr) 10), (call (ptr,ptr) => (ptr) 41, (call () => (ptr) 11), (call () => (ptr) 12)))
        ;; Create stack frame for 41
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 0
        call 10
        i32.store
        ;; parameter 1
        get_local 0
        ;; Create stack frame for 41
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 0
        call 11
        i32.store
        ;; parameter 1
        get_local 0
        get_local 0
        call 12
        i32.store offset=4
        get_local 0
        call 41
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        i32.store offset=4
        get_local 0
        call 41
        ;; Remove parameters
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        return
        ;; end 
    )
    (func $newPoint (param i32) (local i32)
        get_local 0
        set_local 1
        ;; $return = decl_result Point 
        ;; return Point (struct Point 42, 84)
        get_local 0
        i32.const 42
        i32.store
        get_local 0
        i32.const 84
        i32.store offset=4
        return
        ;; end 
    )
    (func $allocPoint (param i32) (result i32) (local i32) (local i32)
        ;; $return = decl_result ptr 
        ;; $mem = store Point (%32 = alloc Point 1), 0, (struct Point 42, 84)
        i32.const 1
        i32.const 8
        i32.const 0
        get_local 0
        call $alloc
        tee_local 1
        tee_local 2
        get_local 2
        i32.const 42
        i32.store
        tee_local 2
        get_local 2
        i32.const 84
        i32.store offset=4
        drop
        ;; return ptr %32
        get_local 1
        return
        ;; end 
    )
    (func $translate (param i32) (local i32) (local i32) (local i32)
        get_local 0
        i32.const 8
        i32.sub
        tee_local 0
        set_local 1
        ;; $return = decl_result Point 
        ;; p = decl_var Point 
        ;; p = call () => (Point) 14
        get_local 1
        ;; Create stack frame
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        get_local 0
        call 14
        get_local 0
        i64.load align=4
        i64.store align=4
        ;; Remove stack frame and restore the SP
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        ;; %36 = add s32 (load s32 (%34 = addr_of ptr p), 0), 2
        get_local 1
        tee_local 3
        i32.load
        i32.const 2
        i32.add
        set_local 2
        ;; $mem = store s32 %34, 0, %36
        get_local 3
        get_local 2
        i32.store
        ;; return Point p
        get_local 1
        get_local 0
        i64.load align=4
        i64.store offset=8 align=4
        return
        ;; end 
    )
    (func $toX (param i32) (result i32) (local i32)
        get_local 0
        i32.const 8
        i32.sub
        tee_local 0
        set_local 1
        ;; $return = decl_result s32 
        ;; %37 = call () => (Point) 14
        get_local 1
        ;; Create stack frame
        get_local 0
        i32.const 8
        i32.sub
        set_local 0
        get_local 0
        call 14
        get_local 0
        i64.load align=4
        i64.store align=4
        ;; Remove stack frame and restore the SP
        get_local 0
        i32.const 8
        i32.add
        set_local 0
        ;; return s32 (load s32 (addr_of ptr %37), 4)
        get_local 1
        i32.load offset=4
        return
        ;; end 
    )
    (func $width (param i32) (result i32) (local i32) (local i32)
        get_local 0
        set_local 1
        ;; this = decl_param ptr 
        ;; $return = decl_result s32 
        ;; if (eqz addr this)
        get_local 1
        i32.load
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; %41 = load s32 this, 8
        get_local 1
        i32.load
        i32.load offset=8
        set_local 2
        ;; if (eqz addr this)
        get_local 1
        i32.load
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; return s32 (sub s32 %41, (load s32 this, 0))
        get_local 2
        get_local 1
        i32.load
        i32.load
        i32.sub
        return
        ;; end 
    )
    (func $newRect (param i32) (local i32)
        get_local 0
        set_local 1
        ;; $return = decl_result Rect 
        ;; return Rect (struct Rect (struct Point 42, 84), (struct Point 168, 336))
        get_local 0
        i32.const 42
        i32.store
        get_local 0
        i32.const 84
        i32.store offset=4
        get_local 0
        i32.const 168
        i32.store offset=8
        get_local 0
        i32.const 336
        i32.store offset=12
        return
        ;; end 
    )
    (func $useRect (param i32) (local i32) (local i32) (local i32)
        get_local 0
        i32.const 16
        i32.sub
        tee_local 0
        set_local 1
        ;; r = decl_var Rect 
        ;; r = call () => (Rect) 19
        get_local 1
        ;; Create stack frame
        get_local 0
        i32.const 16
        i32.sub
        set_local 0
        get_local 0
        call 19
        get_local 0
        set_local 2
        tee_local 3
        get_local 2
        i64.load align=4
        i64.store align=4
        get_local 3
        get_local 2
        i64.load offset=8 align=4
        i64.store offset=8 align=4
        ;; Remove stack frame and restore the SP
        get_local 0
        i32.const 16
        i32.add
        set_local 0
        ;; call (s32) => () 1, (call (ptr) => (s32) 18, (addr_of ptr r))
        ;; parameter 0
        ;; Create stack frame for 18
        get_local 0
        i32.const 4
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 1
        i32.store
        get_local 0
        call 18
        ;; Remove parameters
        get_local 0
        i32.const 4
        i32.add
        set_local 0
        get_local 0
        call 1
        ;; call (s32) => () 1, (call (ptr) => (s32) 21, (add i32 (addr_of ptr r), 8))
        ;; parameter 0
        ;; Create stack frame for 21
        get_local 0
        i32.const 4
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        get_local 1
        i32.const 8
        i32.add
        i32.store
        get_local 0
        call 21
        ;; Remove parameters
        get_local 0
        i32.const 4
        i32.add
        set_local 0
        get_local 0
        call 1
        ;; end 
    )
    (func $dist (param i32) (result i32) (local i32) (local i32)
        get_local 0
        set_local 1
        ;; this = decl_param ptr 
        ;; $return = decl_result s32 
        ;; if (eqz addr this)
        get_local 1
        i32.load
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; %57 = load s32 this, 0
        get_local 1
        i32.load
        i32.load
        set_local 2
        ;; if (eqz addr this)
        get_local 1
        i32.load
        i32.eqz
        if
            ;; trap 
            unreachable
        end
        ;; return s32 (add s32 %57, (load s32 this, 4))
        get_local 2
        get_local 1
        i32.load
        i32.load offset=4
        i32.add
        return
        ;; end 
    )
    (func $prefix (param i32) (local i32) (local i32)
        get_local 0
        i32.const 4
        i32.sub
        tee_local 0
        set_local 1
        ;; [gc]s = decl_var ptr 
        ;; [gc]s = const ptr 96
        get_local 1
        i32.const 96
        i32.store
        ;; if (gt_u i32 3, (load i32 [gc]s, 0))
        i32.const 3
        get_local 1
        i32.load
        i32.load
        i32.gt_u
        if
            ;; trap 
            unreachable
        end
        ;; call (ptr) => () 0, (call (addr,i32) => (ptr) 43, (add ptr [gc]s, 4), (sub i32 3, 0))
        ;; Create stack frame for 0
        get_local 0
        i32.const 4
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        ;; parameter 0
        get_local 1
        i32.load
        i32.const 4
        i32.add
        ;; parameter 1
        i32.const 3
        i32.const 0
        i32.sub
        get_local 0
        call 43
        i32.store
        get_local 0
        call 0
        ;; Remove parameters
        get_local 0
        i32.const 4
        i32.add
        set_local 0
        ;; if (gt_u i32 6, (%67 = load i32 [gc]s, 0))
        i32.const 6
        get_local 1
        i32.load
        i32.load
        tee_local 2
        i32.gt_u
        if
            ;; trap 
            unreachable
        end
        ;; if (gt_u i32 8, %67)
        i32.const 8
        get_local 2
        i32.gt_u
        if
            ;; trap 
            unreachable
        end
        ;; call (ptr) => () 0, (call (addr,i32) => (ptr) 43, (add ptr [gc]s, 10), (sub i32 8, 6))
        ;; Create stack frame for 0
        get_local 0
        i32.const 4
        i32.sub
        set_local 0
        ;; parameter 0
        get_local 0
        ;; parameter 0
        get_local 1
        i32.load
        i32.const 10
        i32.add
        ;; parameter 1
        i32.const 8
        i32.const 6
        i32.sub
        get_local 0
        call 43
        i32.store
        get_local 0
        call 0
        ;; Remove parameters
        get_local 0
        i32.const 4
        i32.add
        set_local 0
        ;; end 
    )
    (func $initializeMemory (param i32) (param i32) (param i32) (param i32) (result i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; r = decl_param addr 
        ;; heapEnd = decl_param addr 
        ;; stackSize = decl_param i32 
        ;; $return = decl_result addr 
        ;; b = decl_var addr 
        ;; stackBlockCount = decl_var i32 
        ;; f = decl_var addr 
        ;; freeBlockNr = decl_var i32 
        ;; stack_block_nr = decl_var i32 
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
        set_local 4
        ;; stackBlockCount = div_u i32 (add i32 stackSize, 65535), 65536
        get_local 2
        i32.const 65535
        i32.add
        i32.const 65536
        i32.div_u
        set_local 5
        ;; heapEndBlockNr = shr_u i32 heapEnd, 16
        get_local 1
        i32.const 16
        i32.shr_u
        set_global 3
        ;; if (ge_u i32 (%81 = shr_u i32 (heapStartBlockNr = shr_u i32 b, 16), 1), 32768)
        get_local 4
        i32.const 16
        i32.shr_u
        tee_local 17
        set_global 2
        get_local 17
        i32.const 1
        i32.shr_u
        tee_local 9
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store i8 (add ptr r, %81), 112, (shl i8 7, (shl i32 (and i32 heapStartBlockNr, 1), 2))
        get_local 0
        get_local 9
        i32.add
        i32.const 7
        get_global 2
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.store8 offset=112
        ;; call (addr) => () 24, b
        ;; parameter 0
        get_local 4
        get_local 3
        call 24
        ;; f = add i32 b, 65536
        get_local 4
        i32.const 65536
        i32.add
        set_local 6
        ;; freeBlockNr = add i32 heapStartBlockNr, 1
        get_global 2
        i32.const 1
        i32.add
        set_local 7
        ;; if (ge_u i32 (%90 = shr_u i32 freeBlockNr, 1), 32768)
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
        ;; %94 = or i8 (load i8 (%92 = add ptr r, %90), 112), (shl i8 4, (shl i32 (and i32 freeBlockNr, 1), 2))
        get_local 0
        get_local 10
        i32.add
        tee_local 12
        i32.load8_u offset=112
        i32.const 4
        get_local 7
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 11
        ;; $mem = store i8 %92, 112, %94
        get_local 12
        get_local 11
        i32.store8 offset=112
        ;; $mem = store i32 f, 8, (sub i32 heapEndBlockNr, (sub i32 heapStartBlockNr, (sub i32 1, stackBlockCount)))
        get_local 6
        get_global 3
        get_global 2
        i32.const 1
        get_local 5
        i32.sub
        i32.sub
        i32.sub
        i32.store offset=8
        ;; if (ge_u i32 (%102 = call (i32) => (i32) 30, (load i32 f, 8)), 15)
        ;; parameter 0
        get_local 6
        i32.load offset=8
        get_local 3
        call 30
        tee_local 13
        i32.const 15
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; $mem = store addr (add ptr r, (mul i32 %102, 4)), 48, f
        get_local 0
        get_local 13
        i32.const 4
        i32.mul
        i32.add
        get_local 6
        i32.store offset=48
        ;; stack_block_nr = sub i32 heapEndBlockNr, stackBlockCount
        get_global 3
        get_local 5
        i32.sub
        set_local 8
        ;; stackEnd = shl i32 heapEndBlockNr, 16
        get_global 3
        i32.const 16
        i32.shl
        set_global 1
        ;; if (ge_u i32 (%109 = shr_u i32 stack_block_nr, 1), 32768)
        get_local 8
        i32.const 1
        i32.shr_u
        tee_local 14
        i32.const 32768
        i32.ge_u
        if
            ;; trap 
            unreachable
        end
        ;; %113 = or i8 (load i8 (%111 = add ptr r, %109), 112), (shl i8 (or i32 8, (or i32 4, gcEpoch)), (shl i32 (and i32 stack_block_nr, 1), 2))
        get_local 0
        get_local 14
        i32.add
        tee_local 16
        i32.load8_u offset=112
        i32.const 8
        i32.const 4
        get_global 4
        i32.or
        i32.or
        get_local 8
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.or
        set_local 15
        ;; $mem = store i8 %111, 112, %113
        get_local 16
        get_local 15
        i32.store8 offset=112
        ;; return addr stackEnd
        get_global 1
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
                    get_global 0
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
                    get_global 0
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
                    ;; if (ge_u i32 (%140 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %144 = or i8 (load i8 (%142 = add ptr b, %140), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
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
                    ;; $mem = store i8 %142, 0, %144
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
        get_global 0
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
        get_global 0
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
        ;; if (ge_u i32 (%165 = shr_u i32 area_nr, 1), 1024)
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
        ;; %169 = or i8 (load i8 (%167 = add ptr block, %165), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))
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
        ;; $mem = store i8 %167, 0, %169
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
                    get_global 0
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
            ;; call () => () 34
            get_local 5
            call 34
            ;; return addr (call (i32,i32,addr,i32,i8) => (addr) 26, elementCount, elementSize, typeMap, epoch, 1)
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
            call 26
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
        get_global 0
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
                get_global 0
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
                    get_global 0
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
                get_global 0
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
                get_global 0
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
        get_global 0
        i32.sub
        i32.const 16
        i32.shr_u
        i32.const 1
        i32.sub
        set_local 11
        ;; if (ge_u i32 (%247 = shr_u i32 block_nr, 1), 32768)
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
        ;; %251 = or i8 (load i8 (%249 = add ptr root, %247), 112), (shl i32 flags, (shl i32 (and i32 block_nr, 1), 2))
        get_global 0
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
        ;; $mem = store i8 %249, 112, %251
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
        get_global 4
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
            ;; return addr (call (i32,i32,addr,i32,i8) => (addr) 26, elementCount, elementSize, typeMap, gcEpoch, 0)
            ;; parameter 0
            get_local 0
            ;; parameter 1
            get_local 1
            ;; parameter 2
            get_local 2
            ;; parameter 3
            get_global 4
            ;; parameter 4
            i32.const 0
            get_local 3
            call 26
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
                    get_global 0
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
                    get_global 0
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
                                ;; call (addr,i32) => () 25, f, index
                                ;; parameter 0
                                get_local 8
                                ;; parameter 1
                                get_local 6
                                get_local 3
                                call 25
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
                    ;; if (ge_u i32 (%301 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %305 = or i8 (load i8 (%303 = add ptr block, %301), 0), (shl i32 flags, (shl i32 (and i32 area_nr, 1), 2))
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
                    ;; $mem = store i8 %303, 0, %305
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
                    ;; $mem = store s32 block, 4, (add s32 (load s32 block, 4), 1)
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
        ;; call (addr) => () 24, (call (i32,i32,addr,i32,i8) => (addr) 26, 1, 65536, 0, 3, 0)
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
        call 26
        get_local 3
        call 24
        ;; return addr (call (i32,i32,addr) => (addr) 27, elementCount, elementSize, typeMap)
        ;; parameter 0
        get_local 0
        ;; parameter 1
        get_local 1
        ;; parameter 2
        get_local 2
        get_local 3
        call 27
        return
        ;; end 
    )
    (func $free (param i32) (param i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; block = decl_var addr 
        ;; area_nr = decl_var i32 
        ;; call (addr,i32) => () 29, (and i32 ptr, (xor i32 65535, -1)), (shr_u i32 (and i32 ptr, 65535), 5)
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
        call 29
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
                    ;; if (ge_u i32 (%335 = shr_u i32 area_nr, 1), 1024)
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
                    ;; if (eqz i8 (and i8 (load i8 (add ptr block, %335), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))))
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
                                ;; if (ge_u i32 (%349 = shr_u i32 next_area_nr, 1), 1024)
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
                                ;; if (ne i8 (and i8 (load i8 (add ptr block, %349), 0), (shl i32 4, (shl i32 (and i32 next_area_nr, 1), 2))), 0)
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
                    ;; if (ge_u i32 (%360 = shr_u i32 area_nr, 1), 1024)
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
                    ;; %364 = and i8 (load i8 (%362 = add ptr block, %360), 0), (xor i8 (shl i32 15, (shl i32 (and i32 area_nr, 1), 2)), -1)
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
                    ;; $mem = store i8 %362, 0, %364
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
                                ;; if (ge_u i32 (%375 = shr_u i32 buddy_area_nr, 1), 1024)
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
                                ;; if (ne i8 (and i8 (load i8 (add ptr block, %375), 0), (shl i32 3, (shl i32 (and i32 buddy_area_nr, 1), 2))), 0)
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
                                    get_global 0
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
                                    ;; if (ge_u i32 (%399 = shr_u i32 area_nr, 1), 1024)
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
                                    ;; %403 = and i8 (load i8 (%401 = add ptr block, %399), 0), (xor i8 (shl i32 4, (shl i32 (and i32 area_nr, 1), 2)), -1)
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
                                    ;; $mem = store i8 %401, 0, %403
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
                                    ;; if (ge_u i32 (%408 = shr_u i32 buddy_area_nr, 3), 1024)
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
                                    ;; %412 = and i8 (load i8 (%410 = add ptr block, %408), 0), (xor i8 (shl i32 4, (shl i32 (and i32 buddy_area_nr, 1), 2)), -1)
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
                                    ;; $mem = store i8 %410, 0, %412
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
                    get_global 0
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
                    get_global 0
                    get_local 4
                    i32.const 4
                    i32.mul
                    i32.add
                    get_local 5
                    i32.store
                    ;; $mem = store s32 block, 4, (sub s32 (load s32 block, 4), 1)
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
                get_global 3
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%433 = shr_u i32 end_block_nr, 1), 32768)
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
                    ;; if (eq i8 (and i8 (load i8 (add ptr root, %433), 112), (shl i8 4, (shl i32 (and i32 end_block_nr, 1), 2))), 4)
                    get_global 0
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
        ;; count = call (i32) => (i32) 31, block_nr
        ;; parameter 0
        get_local 0
        get_local 1
        call 31
        set_local 2
        ;; index = call (i32) => (i32) 30, count
        ;; parameter 0
        get_local 2
        get_local 1
        call 30
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
        get_global 0
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
        get_global 0
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
        ;; count = call (i32) => (i32) 31, block_nr
        ;; parameter 0
        get_local 1
        get_local 2
        call 31
        set_local 3
        ;; if (ge_u i32 (%457 = shr_u i32 block_nr, 1), 32768)
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
        ;; %461 = and i8 (load i8 (%459 = add ptr root, %457), 112), (xor i8 (shl i8 4, (shl i32 (and i32 block_nr, 1), 2)), -1)
        get_global 0
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
        ;; $mem = store i8 %459, 112, %461
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
            ;; index = call (i32) => (i32) 30, (load i32 free, 8)
            ;; parameter 0
            get_local 4
            i32.load offset=8
            get_local 2
            call 30
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
            get_global 0
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
        ;; index = call (i32) => (i32) 30, (load i32 free, 8)
        ;; parameter 0
        get_local 4
        i32.load offset=8
        get_local 2
        call 30
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
        get_global 0
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
        get_global 0
        get_local 5
        i32.const 4
        i32.mul
        i32.add
        get_local 4
        i32.store offset=48
        ;; end 
    )
    (func $garbageCollect (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; latestFreeBlock_nr = decl_var i32 
        ;; gcEpoch = xor i32 gcEpoch, 3
        get_global 4
        i32.const 3
        i32.xor
        set_global 4
        ;; block_nr = decl_var i32 
        ;; flags = decl_var i8 
        ;; block_nr = copy i32 heapStartBlockNr
        get_global 2
        set_local 2
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 block_nr, heapEndBlockNr)), 1
                get_local 2
                get_global 3
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%498 = shr_u i32 block_nr, 1), 32768)
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
                    ;; flags = and i8 (load i8 (add ptr root, %498), 112), (shl i32 15, (shl i32 (and i32 block_nr, 1), 2))
                    get_global 0
                    get_local 4
                    i32.add
                    i32.load8_u offset=112
                    i32.const 15
                    get_local 2
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.and
                    set_local 3
                    ;; block = decl_var addr 
                    ;; if (eq i8 (and i8 flags, 3), 3)
                    get_local 3
                    i32.const 3
                    i32.and
                    i32.const 3
                    i32.eq
                    if
                        ;; latestFreeBlock_nr = const i32 0
                        i32.const 0
                        set_local 1
                        ;; block = shl i32 block_nr, 16
                        get_local 2
                        i32.const 16
                        i32.shl
                        set_local 5
                        ;; if (eq s32 (load s32 block, 4), (load s32 block, 8))
                        get_local 5
                        i32.load offset=4
                        get_local 5
                        i32.load offset=8
                        i32.eq
                        if
                            ;; $mem = store s32 block, 8, 0
                            get_local 5
                            i32.const 0
                            i32.store offset=8
                            ;; br 2
                            br 2
                        end
                        ;; area_nr = decl_var i32 
                        ;; area_nr = const i32 32
                        i32.const 32
                        set_local 6
                        ;; block 
                        block
                            ;; loop 
                            loop
                                ;; br_if (eqz i8 (lt_u i32 area_nr, 2048)), 1
                                get_local 6
                                i32.const 2048
                                i32.lt_u
                                i32.eqz
                                br_if 1
                                ;; block 
                                block
                                    ;; if (ge_u i32 (%514 = shr_u i32 area_nr, 1), 1024)
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
                                    ;; if (eqz i8 (and i8 (load i8 (add ptr block, %514), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))))
                                    get_local 5
                                    get_local 7
                                    i32.add
                                    i32.load8_u
                                    i32.const 4
                                    get_local 6
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shl
                                    i32.and
                                    i32.eqz
                                    if
                                        ;; br 1
                                        br 1
                                    end
                                    ;; if (ge_u i32 (%523 = shr_u i32 area_nr, 1), 1024)
                                    get_local 6
                                    i32.const 1
                                    i32.shr_u
                                    tee_local 8
                                    i32.const 1024
                                    i32.ge_u
                                    if
                                        ;; trap 
                                        unreachable
                                    end
                                    ;; if (ne i8 (and i8 (load i8 (add ptr block, %523), 0), (shl i32 3, (shl i32 (and i32 area_nr, 1), 2))), gcEpoch)
                                    get_local 5
                                    get_local 8
                                    i32.add
                                    i32.load8_u
                                    i32.const 3
                                    get_local 6
                                    i32.const 1
                                    i32.and
                                    i32.const 2
                                    i32.shl
                                    i32.shl
                                    i32.and
                                    get_global 4
                                    i32.ne
                                    if
                                        ;; call (addr,i32) => () 29, block, area_nr
                                        ;; parameter 0
                                        get_local 5
                                        ;; parameter 1
                                        get_local 6
                                        get_local 0
                                        call 29
                                    end
                                end
                                ;; area_nr = add i32 area_nr, 1
                                get_local 6
                                i32.const 1
                                i32.add
                                set_local 6
                                ;; br 0
                                br 0
                            end
                        end
                    else
                        ;; if (eqz i8 (and i8 flags, 3))
                        get_local 3
                        i32.const 3
                        i32.and
                        i32.eqz
                        if
                            ;; if (eqz i32 latestFreeBlock_nr)
                            get_local 1
                            i32.eqz
                            if
                                ;; latestFreeBlock_nr = copy i32 block_nr
                                get_local 2
                                set_local 1
                            end
                        else
                            ;; if (ne i8 (and i8 flags, 3), gcEpoch)
                            get_local 3
                            i32.const 3
                            i32.and
                            get_global 4
                            i32.ne
                            if
                                ;; if (ge_u i32 (%538 = shr_u i32 block_nr, 1), 32768)
                                get_local 2
                                i32.const 1
                                i32.shr_u
                                tee_local 6
                                i32.const 32768
                                i32.ge_u
                                if
                                    ;; trap 
                                    unreachable
                                end
                                ;; %542 = and i8 (load i8 (%540 = add ptr root, %538), 112), (xor i8 (shl i32 3, (shl i32 (and i32 block_nr, 1), 2)), -1)
                                get_global 0
                                get_local 6
                                i32.add
                                tee_local 8
                                i32.load8_u offset=112
                                i32.const 3
                                get_local 2
                                i32.const 1
                                i32.and
                                i32.const 2
                                i32.shl
                                i32.shl
                                i32.const -1
                                i32.xor
                                i32.and
                                set_local 7
                                ;; $mem = store i8 %540, 112, %542
                                get_local 8
                                get_local 7
                                i32.store8 offset=112
                                ;; if (eq i8 (and i8 flags, 4), 4)
                                get_local 3
                                i32.const 4
                                i32.and
                                i32.const 4
                                i32.eq
                                if
                                    ;; if (eqz i32 latestFreeBlock_nr)
                                    get_local 1
                                    i32.eqz
                                    if
                                        ;; latestFreeBlock_nr = copy i32 block_nr
                                        get_local 2
                                        set_local 1
                                        ;; call (i32) => () 32, latestFreeBlock_nr
                                        ;; parameter 0
                                        get_local 1
                                        get_local 0
                                        call 32
                                    else
                                        ;; call (i32,i32) => () 33, latestFreeBlock_nr, (shl i32 block_nr, 16)
                                        ;; parameter 0
                                        get_local 1
                                        ;; parameter 1
                                        get_local 2
                                        i32.const 16
                                        i32.shl
                                        get_local 0
                                        call 33
                                    end
                                end
                            end
                        end
                    end
                end
                ;; block_nr = add i32 block_nr, 1
                get_local 2
                i32.const 1
                i32.add
                set_local 2
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
        get_global 2
        i32.lt_u
        if
            ;; return 
            return
        end
        ;; if (ge_u i32 (%555 = shr_u i32 block_nr, 1), 32768)
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
        ;; flags = and i8 (load i8 (add ptr root, %555), 112), (shl i8 15, (shl i32 (and i32 block_nr, 1), 2))
        get_global 0
        get_local 4
        i32.add
        i32.load8_u offset=112
        i32.const 15
        get_local 2
        i32.const 1
        i32.and
        i32.const 2
        i32.shl
        i32.shl
        i32.and
        set_local 3
        ;; if (eq i8 (and i8 flags, 3), gcEpoch)
        get_local 3
        i32.const 3
        i32.and
        get_global 4
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
            ;; call (addr,i32) => () 36, (shl i32 block_nr, 16), (shr_u i32 (and addr ptr, 65535), 5)
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
            call 36
        else
            ;; if (ne i8 (and i8 flags, 3), 0)
            get_local 3
            i32.const 3
            i32.and
            i32.const 0
            i32.ne
            if
                ;; call (i32) => () 37, block_nr
                ;; parameter 0
                get_local 2
                get_local 1
                call 37
            end
        end
        ;; end 
    )
    (func $markArea (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; block = decl_param addr 
        ;; area_nr = decl_param i32 
        ;; i = decl_var i32 
        ;; flags = decl_var i8 
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
                    ;; if (ge_u i32 (%576 = shr_u i32 area_nr, 1), 1024)
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
                    ;; if (eqz i8 (and i8 (load i8 (add ptr block, %576), 0), (shl i32 4, (shl i32 (and i32 area_nr, 1), 2))))
                    get_local 0
                    get_local 5
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
                    ;; if (ge_u i32 (%587 = shr_u i32 area_nr, 1), 1024)
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
                    ;; flags = and i8 (load i8 (add ptr block, %587), 0), (shl i8 15, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 0
                    get_local 6
                    i32.add
                    i32.load8_u
                    i32.const 15
                    get_local 1
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.and
                    set_local 4
                    ;; if (eq i8 (and i8 flags, 3), gcEpoch)
                    get_local 4
                    i32.const 3
                    i32.and
                    get_global 4
                    i32.eq
                    if
                        ;; return 
                        return
                    end
                    ;; if (ge_u i32 (%597 = shr_u i32 area_nr, 1), 1024)
                    get_local 1
                    i32.const 1
                    i32.shr_u
                    tee_local 7
                    i32.const 1024
                    i32.ge_u
                    if
                        ;; trap 
                        unreachable
                    end
                    ;; %601 = xor i8 (load i8 (%599 = add ptr block, %597), 0), (shl i8 3, (shl i32 (and i32 area_nr, 1), 2))
                    get_local 0
                    get_local 7
                    i32.add
                    tee_local 9
                    i32.load8_u
                    i32.const 3
                    get_local 1
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.xor
                    set_local 8
                    ;; $mem = store i8 %599, 0, %601
                    get_local 9
                    get_local 8
                    i32.store8
                    ;; $mem = store s32 block, 8, (add s32 (load s32 block, 8), 1)
                    get_local 0
                    get_local 0
                    i32.load offset=8
                    i32.const 1
                    i32.add
                    i32.store offset=8
                    ;; if (eq i8 (and i8 flags, 8), 8)
                    get_local 4
                    i32.const 8
                    i32.and
                    i32.const 8
                    i32.eq
                    if
                        ;; call (addr) => () 38, (add i32 block, (shl i32 area_nr, 5))
                        ;; parameter 0
                        get_local 0
                        get_local 1
                        i32.const 5
                        i32.shl
                        i32.add
                        get_local 2
                        call 38
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
                get_global 2
                i32.ge_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; if (ge_u i32 (%614 = shr_u i32 block_nr, 1), 32768)
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
                    ;; flags = and i8 (load i8 (add ptr root, %614), 112), (shl i8 15, (shl i32 (and i32 block_nr, 1), 2))
                    get_global 0
                    get_local 3
                    i32.add
                    i32.load8_u offset=112
                    i32.const 15
                    get_local 0
                    i32.const 1
                    i32.and
                    i32.const 2
                    i32.shl
                    i32.shl
                    i32.and
                    set_local 2
                    ;; if (eq i8 (and i8 flags, 4), 4)
                    get_local 2
                    i32.const 4
                    i32.and
                    i32.const 4
                    i32.eq
                    if
                        ;; if (ge_u i32 (%624 = shr_u i32 block_nr, 1), 32768)
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
                        ;; %628 = xor i8 (load i8 (%626 = add ptr root, %624), 112), (shl i8 3, (shl i32 (and i32 block_nr, 1), 2))
                        get_global 0
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
                        ;; $mem = store i8 %626, 112, %628
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
                            ;; call (addr) => () 38, (shl i32 block_nr, 16)
                            ;; parameter 0
                            get_local 0
                            i32.const 16
                            i32.shl
                            get_local 1
                            call 38
                        end
                        ;; return 
                        return
                    else
                        ;; if (eq i8 (and i8 flags, 3), gcEpoch)
                        get_local 2
                        i32.const 3
                        i32.and
                        get_global 4
                        i32.eq
                        if
                            ;; return 
                            return
                        else
                            ;; if (ge_u i32 (%638 = shr_u i32 block_nr, 1), 32768)
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
                            ;; %642 = or i8 (load i8 (%640 = add ptr root, %638), 112), (shl i8 gcEpoch, (shl i32 (and i32 block_nr, 1), 2))
                            get_global 0
                            get_local 4
                            i32.add
                            tee_local 6
                            i32.load8_u offset=112
                            get_global 4
                            get_local 0
                            i32.const 1
                            i32.and
                            i32.const 2
                            i32.shl
                            i32.shl
                            i32.or
                            set_local 5
                            ;; $mem = store i8 %640, 112, %642
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
    (func $traverseHeap (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; elementCount = decl_var i32 
        ;; iptr = decl_var addr 
        ;; typemap = decl_var addr 
        ;; size = decl_var i32 
        ;; data = decl_var addr 
        ;; elementCount = const i32 1
        i32.const 1
        set_local 2
        ;; iptr = copy addr ptr
        get_local 0
        set_local 3
        ;; typemap = decl_var addr 
        ;; if (gt_s s32 (load s32 iptr, 0), 0)
        get_local 3
        i32.load
        i32.const 0
        i32.gt_s
        if
            ;; call (addr,addr) => () 39, (add i32 iptr, 4), (load s32 iptr, 0)
            ;; parameter 0
            get_local 3
            i32.const 4
            i32.add
            ;; parameter 1
            get_local 3
            i32.load
            get_local 1
            call 39
            ;; return 
            return
        end
        ;; elementCount = add s32 (xor s32 (load s32 iptr, 0), -1), 1
        get_local 3
        i32.load
        i32.const -1
        i32.xor
        i32.const 1
        i32.add
        set_local 2
        ;; iptr = add addr iptr, 4
        get_local 3
        i32.const 4
        i32.add
        set_local 3
        ;; typemap = load s32 iptr, 0
        get_local 3
        i32.load
        set_local 4
        ;; size = load s32 typemap, 0
        get_local 4
        i32.load
        set_local 5
        ;; iptr = add addr iptr, 4
        get_local 3
        i32.const 4
        i32.add
        set_local 3
        ;; data = copy addr iptr
        get_local 3
        set_local 6
        ;; i = decl_var i32 
        ;; i = const i32 0
        i32.const 0
        set_local 8
        ;; block 
        block
            ;; loop 
            loop
                ;; br_if (eqz i8 (lt_u i32 i, elementCount)), 1
                get_local 8
                get_local 2
                i32.lt_u
                i32.eqz
                br_if 1
                ;; block 
                block
                    ;; call (addr,addr) => () 39, data, typemap
                    ;; parameter 0
                    get_local 6
                    ;; parameter 1
                    get_local 4
                    get_local 1
                    call 39
                    ;; data = add addr data, size
                    get_local 6
                    get_local 5
                    i32.add
                    set_local 6
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
        ;; end 
    )
    (func $traverseType (param i32) (param i32) (param i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32) (local i32)
        ;; ptr = decl_param addr 
        ;; typemap = decl_param addr 
        ;; entries_end = decl_var s32 
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
                            set_local 8
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
                            set_local 9
                            ;; size = load s32 typemap2, 0
                            get_local 8
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
                                        ;; call (addr,addr) => () 39, ptr2, typemap2
                                        ;; parameter 0
                                        get_local 9
                                        ;; parameter 1
                                        get_local 8
                                        get_local 2
                                        call 39
                                        ;; ptr2 = add addr ptr2, size
                                        get_local 9
                                        get_local 10
                                        i32.add
                                        set_local 9
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
                                        ;; call (addr) => () 35, ptr2
                                        ;; parameter 0
                                        get_local 11
                                        get_local 2
                                        call 35
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
                        ;; call (addr) => () 35, (add i32 ptr, a)
                        ;; parameter 0
                        get_local 0
                        get_local 5
                        i32.add
                        get_local 2
                        call 35
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
        ;; p = call (i32,i32,addr) => (addr) 27, (add i32 4, (add i32 s1, s2)), 1, 0
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
        call 27
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
        ;; p = call (i32,i32,addr) => (addr) 27, (add i32 4, length), 1, 0
        ;; parameter 0
        i32.const 4
        get_local 1
        i32.add
        ;; parameter 1
        i32.const 1
        ;; parameter 2
        i32.const 0
        get_local 2
        call 27
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
    (data (i32.const 8) "\12\00\00\00\48\65\6c\6c\6f\20\66\72\6f\6d\20\6d\61\69\6e\21\21\21")
    (data (i32.const 32) "\05\00\00\00\46\72\65\64\20")
    (data (i32.const 48) "\05\00\00\00\73\75\63\6b\73")
    (data (i32.const 64) "\01\00\00\00\78")
    (data (i32.const 72) "\02\00\00\00\41\31")
    (data (i32.const 80) "\02\00\00\00\41\32")
    (data (i32.const 88) "\02\00\00\00\41\33")
    (data (i32.const 96) "\0b\00\00\00\48\65\6c\6c\6f\20\57\6f\72\6c\64")
    (data (i32.const 120) "\00\00\00\00\01\00\00\00\70\00\00\00")
    (export "getTuple" (func 2))
    (export "useTuple" (func 3))
    (export "compare1" (func 4))
    (export "compare2" (func 5))
    (export "compare3" (func 6))
    (export "main" (func 7))
    (export "action" (func 8))
    (export "fuck" (func 9))
    (export "action1" (func 10))
    (export "action2" (func 11))
    (export "action3" (func 12))
    (export "dummy" (func 13))
    (export "newPoint" (func 14))
    (export "allocPoint" (func 15))
    (export "translate" (func 16))
    (export "toX" (func 17))
    (export "width" (func 18))
    (export "newRect" (func 19))
    (export "useRect" (func 20))
    (export "dist" (func 21))
    (export "prefix" (func 22))
    (export "initializeMemory" (func 23))
    (export "initializeBlock" (func 24))
    (export "split" (func 25))
    (export "allocBlocks" (func 26))
    (export "alloc" (func 27))
    (export "free" (func 28))
    (export "free_intern" (func 29))
    (export "blockCountToIndex" (func 30))
    (export "countBlocks" (func 31))
    (export "freeBlocks" (func 32))
    (export "mergeAndFreeBlocks" (func 33))
    (export "garbageCollect" (func 34))
    (export "mark" (func 35))
    (export "markArea" (func 36))
    (export "markBlocks" (func 37))
    (export "traverseHeap" (func 38))
    (export "traverseType" (func 39))
    (export "copy" (func 40))
    (export "string_concat" (func 41))
    (export "string_compare" (func 42))
    (export "make_string" (func 43))
    (type $callbackFn (func (param i32 i32) (result i32) ))
)
