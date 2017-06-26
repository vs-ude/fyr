
var root #RootBlock

// The value is either binary 01 or 10
var gcEpoch uint

type RootBlock struct {
    // Pointers to free areas of size 1 << (5 + i).
    freeAreas  [11]#FreeArea  // 11 * 4 = 44 Bytes
    dummy int32               // Alignment
    // Pointers to free block sequences of "(1 << i) <= count < (1 << (i+1))" blocks.
    // The largest allocatable size is 2GB
    freeBlocks [15]#FreeBlock // 15 * 4 Bytes = 60 Bytes
    dummy2 int32              // Alignment
    // Each block has 4 bit.
    // 8: block contains pointers and must be inspected by the GC
    // 4: block is the beginning of an (either allocated or free) sequence of blocks
    // 1 & 2: 00 means free, 01 and 10 means in-use and marked in an epoch, 11 means its a block of areas 
    blocks [1 << 15]byte         // 65536 * 4 Bit = 32768 Bytes
}

type FreeBlock struct {
    next #FreeBlock  // Pointer to the next sequence of free blocks
    prev #FreeBlock  // Pointer to the prev sequence of free blocks
    count uint // Number of free blocks in the sequence
}

// Blocks are 64KB large and split into smaller areas.
type Block struct {
    // 8: area contains pointers and must be inspected by the GC
    // 4: 32-byte unit iss the beginning of an area.
    //    Areas are split (if necessary) upon allocation, and rejoined upon free.
    // 1, 2: Two bits to indicate the epoch when the block has been marked during mark & sweep.
    // These bits are only meaningful if the block is the beginning or an area.
    // 11 has no meaning
    // 01 means allocated in GC epoch 1.
    // 10 means allocated in GC epoch 2.
    // 00 means free
    area [1024]byte           // 4*2048 Bits
    data  [65536 - 1024]byte  // 2016 units of 32 byte each = 64512 bytes
}

type FreeArea struct {
    next #FreeArea
    prev #FreeArea
    size uint
}

// The RootBlock must not cross a 64K boundary.
// blockCount is the number of free blocks, not including the root block.
func initializeRootBlock(r #RootBlock, blockCount uint) {
    root = r
    // Initialize the first free block for area allocation.
    // The first free block starts at the next 64K boundary.
    var b #Block = (<uint>r &^ 0xffff) + (1 << 16)
    r.blocks[0] = 4 | 2 | 1 // Beginning of a sequence of free blocks
    initializeBlock(b)
    // All blocks are free, except the first one which is initialized for area allocation
    var f #FreeBlock = <uint>b + (1 << 16)
    r.blocks[0] |= 4 << 4 // Beginning of a sequence of free blocks
    f.count = blockCount - 1
    for(var i uint = 0; i < 15; i++) {
        if (1 << i <= blockCount && blockCount < 1 << (i+1)) {
            r.freeBlocks[i] = f
        } else {
            r.freeBlocks[i] = 0
        }
    }
}

func initializeBlock(b #Block) {
    // Initialize the arrays 'area' and 'mark' with zero 
    var ptr #uint64 = <#uint64>(&b.area)
    for(var i = 0; i < 1024/8; i++) {
        *ptr = 0
        ptr++
    }
    // Mark the first 1024 byte area as in-use.
    b.area[0] = 1 | 2
    for(var i uint = 5; i < 11; i++) {
        var f #FreeArea = 1 << (5 + i) + <uint>b
        f.next = root.freeAreas[i]
        f.prev = 0
        f.size = 1 << (5 + i)
        if (f.next != 0) {
            f.next.prev = f
        }
        root.freeAreas[i] = f
        var area_nr = 1 << i
        b.area[area_nr >> 1] |= <byte>(4 << ((area_nr & 1) << 2))
    }
}

func split(f #FreeArea, index uint) {
    index--
    // Split the free area and add the upper half to the free-list
    var f2 #FreeArea = <uint>f + (1 << (index + 5))
    f2.next = root.freeAreas[index]
    f2.prev = 0
    if (f2.next != 0) {
        f2.next.prev = f2
    }
    root.freeAreas[index] = f2
    // Mark the the new free area as the beginning of an area
    var block #Block = <uint>f2 &^ 0xffff
    var area_nr = (<uint>f2 & 0xffff) >> 5
    block.area[area_nr >> 1] |= <byte>(4 << ((area_nr & 1) << 2))
}

func allocBlocks(count uint, epoch uint, gc_pointers bool, has_gc bool) #void {
    // Compute the block-count as a power of two
    var index uint = 14
    for(; index >= 0; index--) {
        if (1 << index <= count) {
            break
        }
    }
    // Find a sequence of blocks that is large enough
    for(; index < 15; index++) {
        if (root.freeBlocks[index] != 0) {
            break
        }
    }
    // TODO: panic if index == 15 -> out of memory
    if (index == 15) {
        if (has_gc) {
            // TODO: Throw out-of-memory exception
            return 0
        }
        return allocBlocks(count, epoch, gc_pointers, true)
    }

    var f #FreeBlock = root.freeBlocks[index]
    if (f.count == count) {
        // Use all of the blocks in this sequence.
        // Remove this sequence from the free list.
        if (f.prev == 0) {
            root.freeBlocks[index] = f.next
        } else {
            f.prev.next = f.next
        }
        if (f.next != 0) {
            f.next.prev = f.prev
        }
    } else {
        // Split the block sequence and allocate the tail of the sequence
        var f2 = f
        f2.count -= count
        f = <uint>f + (1 << 16) * f2.count
        // Compute the remaining size as a power of two
        var index2 uint = 14
        for(; index2 >= 0; index2--) {
            if (1 << index2 <= f2.count) {
                break
            }
        }
        if (index2 != index) {
            // Insert the remaining sequence of free blocks in another queue
            if (f.prev == 0) {
                root.freeBlocks[index] = f.next
            } else {
                f.prev.next = f.next
            }
            if (f.next != 0) {
                f.next.prev = f.prev
            }
            f2.prev = 0
            f2.next = root.freeBlocks[index2]
            if (f2.next != 0) {
                f2.next.prev = f2
            }
            root.freeBlocks[index2] = f2
        }
    }
    // Mark start of allocated sequence
    var block_nr = (<uint>f - <uint>root) >> 16 - 1 
    root.blocks[block_nr >> 1] |= <byte>(((<uint>gc_pointers << 3) | 4 | epoch) << ((block_nr & 1) << 2))
    return <#void>f
}

func alloc(size uint, gc_pointers bool) #void {
    // Determine the granularity
    var index uint
    if (size > 1<<15) {             // Needs entire blocks
        // allocate a sequence of blocks
        return allocBlocks((size + 0xffff) / (1<<16), gcEpoch, gc_pointers, false) 
    } else if (size > 1 << 14) {    // 32k
        index = 10
    } else if (size > 1 << 13) {    // 16k
        index = 9
    } else if (size > 1 << 12) {    // 8k
        index = 8
    } else if (size > 1 << 11) {    // 4k
        index = 7
    } else if (size > 1 << 10) {    // 2k
        index = 6
    } else if (size > 1 << 9) {     // 1k
        index = 5
    } else if (size > 1 << 8) {     // 512b
        index = 4
    } else if (size > 1 << 7) {     // 256b
        index = 3
    } else if (size > 1 << 6) {     // 128b
        index = 2
    } else if (size > 1 << 5) {     // 64b
        index = 1
    } else {                        // 32b
        index = 0
    }

    // Find a free space in existing blocks
    var targetIndex = index
    for(; index < 11; index++) {
        // Get a free area of the requested or larger size
        var f = root.freeAreas[index]
        if (f == 0) {
            continue
        }
        root.freeAreas[index] = f.next
        if (f.next != 0) {
            f.next.prev = 0
        }
        // Split the area if it is too large
        for (; index > targetIndex; index--) {
            split(f, index)
        }

        // Mark the area as allocated in a certain epoch
        var block #Block = <uint>f &^ 0xffff
        var area_nr = (<uint>f & 0xffff) >> 5
        block.area[area_nr >> 1] |= <byte>(((<uint>gc_pointers << 3) | 4 | gcEpoch) << ((area_nr & 1) << 2))

        // Fill with zeros
        var ptr #uint64 = <#uint64>f
        var iterations = (size + 7)/8
        for(var i uint = 0; i < iterations; i++) {
            *ptr = 0
            ptr++
        }

        return <#void>f
    }

    // Nothing free. Add one more block and allocate again
    initializeBlock(<#Block>allocBlocks(1, 1 | 2, false, false))
    return alloc(size, gc_pointers)
}

func free(ptr #void) {
    // Compute start of block
    var block #Block = <uint>ptr &^ 0xffff
    var area_nr = (<uint>ptr & 0xffff) >> 5
    for(var i uint = 0; i < 11; i++) {
        if (block.area[area_nr >> 1] & <byte>(4 << ((area_nr & 1) << 2)) != 0) {
            // Determine the size as a power of two
            var index uint = 0
            for (var next_area_nr = area_nr + 1; next_area_nr < 2048; next_area_nr = area_nr + 1 << index) {
                if (block.area[next_area_nr >> 1] & <byte>(4 << ((next_area_nr & 1) << 2)) != 0) {
                    break
                }
                index++
            }
            // Mark the block as free by setting the mark bits to 00
            block.area[area_nr >> 1] &^= <byte>(15 << ((area_nr & 1) << 2))

            // Comnpute the address of the free area
            var f #FreeArea = <uint>block + area_nr << 5

            // Try to merge with a buddy, but only up to a size of 16k. 32k areas are not merged, because each block has only one
            for(; index < 10; index++) {
                // Find the buddy by flipping one bit
                var buddy_area_nr = area_nr ^ (1 << index)
                // Is the buddy in use? Then do nothing
                if (block.area[buddy_area_nr >> 1] & <byte>(3 << ((buddy_area_nr & 1) << 2)) != 0) {
                    break
                }
                // Remove the buddy from the free list
                var f_buddy #FreeArea = <uint>block + buddy_area_nr << 5
                if (f_buddy.next != 0) {
                    f_buddy.next.prev = f_buddy.prev
                }
                if (f_buddy.prev != 0) {
                    f_buddy.prev.next = f_buddy.next
                } else {
                    root.freeAreas[index] = f_buddy.next
                }
                // Take the area with the smaller area_nr
                if (buddy_area_nr < area_nr) {
                    block.area[area_nr >> 1] &^= <byte>(4 << ((area_nr & 1) << 2))
                    area_nr = buddy_area_nr
                    f = f_buddy
                } else {
                    block.area[buddy_area_nr >> 3] &^= <byte>(4 << ((buddy_area_nr & 1) << 2))                    
                }
            }

            // Add the area to the free list
            f.next = root.freeAreas[index]
            f.prev = 0
            if (f.next != 0) {
                f.next.prev = f
            }
            root.freeAreas[index] = f

            return
        }
        area_nr &^= 1 << i
    }
    // TODO: throw
}

func garbageCollect() {
    // Switch the epoch
    gcEpoch = gcEpoch ^ 3
}

func copy(dest #byte, src #byte, count int) {
    for(count--; count >= 0; count--) {
        dest[count] = src[count]
    }
}

func string_concat(str1 string, str2 string) string {
    var s1 = *<#uint>str1
    var s2 = *<#uint>str2
    var p #void = alloc(4 + s1 + s2, false)
    *<#uint>p = s1 + s2
    var dest #byte = <#byte>p + 4
    var src #byte = <#byte>str1 + 4
    for(var i uint = 0; i < s1; i++) {
        dest[i] = src[i]
    }
    dest += s1
    src = <#byte>str2 + 4
    for(var i uint = 0; i < s2; i++) {
        dest[i] = src[i]
    }
    return <string>p
}

func string_compare(str1 string, str2 string) int {
    var s1 = *<#uint>str1
    var s2 = *<#uint>str2
    var ptr1 #byte = <#byte>str1 + 4
    var ptr2 #byte = <#byte>str2 + 4
    var min = s2
    if (s1 < s2) {
        min = s1
    }
    for(var i uint = 0; i < min; i++) {
        if (ptr1[i] < ptr2[i]) {
            return -1
        } else if (ptr1[i] > ptr2[i]) {
            return 1
        }
    }
    if (s1 == s2) {
        return 0
    }
    if (s1 < s2) {
        return -1
    }
    return 1
}

func make_string(src #byte, length uint) string {
    var p #byte = <#byte>alloc(4 + length, false)
    *<#uint>p = length
    var dest = p + 4
    for(var i uint = 0; i < length; i++) {
        dest[i] = src[i]
    }
    return <string>p
}