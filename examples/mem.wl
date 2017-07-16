
var root #RootBlock

var stackStart #void
// Pointer to the beginning of the stack.
// Initially, this is the last byte of linear memory.
var stackEnd #void

// The first block available for the heap
var heapStartBlockNr uint
// The first block that is no longer available for the heap
// TODO: Compute with current_memory
var heapEndBlockNr uint

// The value is either binary 01 or 10
var gcEpoch uint

type RootBlock struct {
    // Pointers to free areas of size 1 << (5 + i).
    freeAreas  [11]#FreeArea   // 11 * 4 = 44 Bytes
    dummy1 int32               // Alignment
    // Pointers to free block sequences of "(1 << i) <= count < (1 << (i+1))" blocks.
    // The largest allocatable size is 2GB.
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
    // 4: 32-byte unit is the beginning of an area.
    //    Areas are split (if necessary) upon allocation, and rejoined upon free.
    // 1 & 2: Two bits to indicate the epoch when the block has been marked during mark & sweep.
    // These bits are only meaningful if the block is the beginning or an area.
    // 11 means the area is allocated for meta-data
    // 01 means allocated in GC epoch 1.
    // 10 means allocated in GC epoch 2.
    // 00 means free
    area [1024]byte           // 4*2048 Bits = 1024 bytes
    data  [65536 - 1024]byte  // 2016 units of 32 byte each = 64512 bytes
}

// The first 16 bytes of the area array are not used, except for the very first byte.
// This is used to store additional data
type BlockWithMetaData struct {
    area1 [1] byte // Contains information that the block starts with a meta-data area
    area2 [3] byte // Unused 
    allocatedAreas int
    markedAreas int
    next #Block
    area3 [1024 - 16]byte
    data  [65536 - 1024]byte  // 2016 units of 32 byte each = 64512 bytes
}

type FreeArea struct {
    next #FreeArea
    prev #FreeArea
    size uint
}

// The RootBlock must not cross a 64K boundary.
// The SP must point to the end of linear memory.
// blockCount is the number of free blocks, not including the root block.
func initializeMemory(r #RootBlock, heapEnd #void, stackSize uint) #void {
    root = r
    // The first free block starts at the next 64K boundary.
    var b #Block = (<uint>r &^ 0xffff) + (1 << 16)
    var stackBlockCount = (stackSize + 0xffff) / 0x10000
    heapStartBlockNr = <uint>b >> 16
    heapEndBlockNr = <uint>heapEnd >> 16
    r.blocks[heapStartBlockNr >> 1] = <byte>(4 | 2 | 1) << ((heapStartBlockNr & 1) << 2) // Beginning of a sequence of free blocks
    // Initialize the first free block for area allocation.
    initializeBlock(b)

    // All heap blocks are free, except the first one which is initialized for area allocation
    var f #FreeBlock = <uint>b + (1 << 16)
    var freeBlockNr = heapStartBlockNr + 1
    r.blocks[freeBlockNr >> 1] |= <byte>4 << ((freeBlockNr & 1) << 2) // Beginning of a sequence of free blocks
    f.count = heapEndBlockNr - heapStartBlockNr - 1 - stackBlockCount
    r.freeBlocks[blockCountToIndex(f.count)] = f

    // Allocate the stack and hold a pointer to it
    var stack_block_nr = heapEndBlockNr - stackBlockCount
    stackEnd = <uint>heapEndBlockNr << 16
    stackStart = stack_block_nr << 16
    r.blocks[stack_block_nr >> 1] |= <byte>(8 | 4 | gcEpoch) << ((stack_block_nr & 1) << 2)
    return stackEnd
}

func initializeBlock(b #Block) {
    // Initialize the array 'area' with zero 
    var ptr #uint64 = <#uint64>(&b.area)
    for(var i = 0; i < 1024/8; i++) {
        *ptr = 0
        ptr++
    }
    // Mark the first 1024 byte area as in-use.
    b.area[0] = 1 | 2
    // Split the remaining block in areas and assign them to the freeAreas list of the root block
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

func allocBlocks(elementCount uint, elementSize uint, typeMap #int, epoch uint, has_gc bool) #void {
    var size = elementCount * elementSize
    var flags uint = epoch | 4
    if (typeMap != 0) {
        // Add space for the type typeMap
        size += 4 // Additional 4 bytes for the typeMap pointer
        if (elementCount != 1) {
            size += 4 // additional 4 bytes for the elementCount
        }
        flags |= 8
    }
    // Round the size up to the next block size and compute the block count
    var count = (size + 0xffff) / (1<<16)
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
        garbageCollect()
        return allocBlocks(elementCount, elementSize, typeMap, epoch, true)
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
    // root.blocks[block_nr >> 1] &^= <byte>(0xf << ((block_nr & 1) << 2))
    // Entries of unused blocks are zero. Hence, no need to clear bits before setting them
    root.blocks[block_nr >> 1] |= <byte>(flags << ((block_nr & 1) << 2))

    if (typeMap != 0) {
        var start #int = <#int>f
        if (elementCount == 1) {
            *start = <int>typeMap
            f = <uint>f + 4
        } else {
            *start = -<int>elementCount
            start++
            *start = <int>typeMap            
            f = <uint>f + 8
        }
    }
    return <#void>f
}

func alloc(elementCount uint, elementSize uint, typeMap #int) #void {
    // Determine the brutto size (i.e. including space for the TypeMap)
    var size = elementCount * elementSize
    var flags = 4 | gcEpoch
    if (typeMap != 0) {
        size += 4 // Additional 4 bytes for the typeMap pointer
        if (elementCount != 1) {
            size += 4 // additional 4 bytes for the elementCount
        }
        flags |= 8
    }

    // Needs entire blocks?
    if (size > 1<<15) {
        // Allocate a sequence of blocks
        return allocBlocks(elementCount, elementSize, typeMap, gcEpoch, false)
    }

    // Determine the granularity
    var index uint
    if (size > 1 << 14) {    // 32k
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
        block.area[area_nr >> 1] |= <byte>(flags << ((area_nr & 1) << 2))

        // Fill with zeros
        var ptr #uint64 = <#uint64>f
        var iterations = (size + 7)/8
        for(var i uint = 0; i < iterations; i++) {
            *ptr = 0
            ptr++
        }

        // Store the TypeMap for the GC
        if (typeMap != 0) {
            var start #int = <#int>f
            if (elementCount == 1) {
                *start = <int>typeMap
                f = <uint>f + 4
            } else {
                *start = -<int>elementCount
                start++
                *start = <int>typeMap            
                f = <uint>f + 8
            }
        }

        // Increase the count of allocated areas
        (<#BlockWithMetaData>block).allocatedAreas++
        return <#void>f
    }

    // Nothing free. Add one more block and allocate again
    initializeBlock(<#Block>allocBlocks(1, 65536, 0, 1 | 2, false))
    return alloc(elementCount, elementSize, typeMap)
}

func free(ptr #void) {
    // Compute the block address, ptr is pointing to
    var block #Block = <uint>ptr &^ 0xffff
    // Compute the area number inside the block, where ptr is pointing to, assuming the area has a minimal size
    var area_nr = (<uint>ptr & 0xffff) >> 5
    free_intern(block, area_nr)
}

func free_intern(block #Block, area_nr uint) {
    // Determine the size of the area by clearing bits of area_nr starting with the least significant bit
    for(var i uint = 0; i < 11; i++) {
        // Not the beginning of a block? -> the area must be larger
        if (block.area[area_nr >> 1] & <byte>(4 << ((area_nr & 1) << 2)) == 0) {
            area_nr &^= 1 << i
            continue
        }
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

        (<#BlockWithMetaData>block).allocatedAreas--

        return
    }
    // TODO: throw
}

func blockCountToIndex(count uint) uint {
    var limit uint = 2
    for (var i uint = 0; ; i++) {
        if (count < limit) {
            return i
        }
        limit <<= 1
    }
    return 14 // Should never happen
}

func countBlocks(block_nr uint) uint {
    var end_block_nr = block_nr + 1
    for(; end_block_nr < heapEndBlockNr; end_block_nr++) {
        if (root.blocks[end_block_nr >> 1] & <byte>4 << ((end_block_nr & 1) << 2) == 4) {
            break
        }
    }
    return end_block_nr - block_nr
}

func freeBlocks(block_nr uint) {
    var count = countBlocks(block_nr)
    var index = blockCountToIndex(count)
    var free #FreeBlock = block_nr >> 16
    free.count = count
    free.next = root.freeBlocks[index]
    free.prev = 0
    if (free.next != 0) {
        free.next.prev = free
    }
    root.freeBlocks[index] = free
}

func mergeAndFreeBlocks(free_nr uint, block_nr uint) {
    var count = countBlocks(block_nr)
    // The block is no longer the start of a sequence
    root.blocks[block_nr >> 1] &^= <byte>4 << ((block_nr & 1) << 2)
    // Remove the free block from its list, because it is growing
    var free #FreeBlock = free_nr >> 16
    if (free.next != 0) {
        free.next.prev = free.prev
    }
    if (free.prev != 0) {
        free.prev.next = free.next
    } else {
        var index = blockCountToIndex(free.count)
        root.freeBlocks[index] = free.next
    }
    // Re-add the free block to a list
    free.count += count
    var index = blockCountToIndex(free.count)
    free.next = root.freeBlocks[index]
    free.prev = 0
    if (free.next != 0) {
        free.next.prev = free
    }
    root.freeBlocks[index] = free
}

// A mark & sweep algorithm that frees areas and blocks that are no longer referenced
func garbageCollect() {
    // Switch the epoch
    gcEpoch = gcEpoch ^ 3

    //
    // Mark all data that is still being used.
    // Therefore, traverse the all global variables, which point to the stack, which points to more heap data.
    //

    // TODO

    //
    // Sweep all data that is no longer being used
    //

    var latestFreeBlock_nr uint

    // Iterate over all blocks and free everything that is not marked with the current gc epoch
    for(var block_nr = heapStartBlockNr; block_nr < heapEndBlockNr; block_nr++) {
        var flags = root.blocks[block_nr >> 1] & <byte>(15 << ((block_nr & 1) << 2))
        // The block is subject to area allocation ?
        if (flags & 3 == 3) {
            latestFreeBlock_nr = 0
            var block #Block = block_nr << 16
            // All allocated areas have been marked? Nothing to free here
            if ((<#BlockWithMetaData>block).allocatedAreas == (<#BlockWithMetaData>block).markedAreas) {
                (<#BlockWithMetaData>block).markedAreas = 0
                continue
            }
        
            // Test all areas, except for the first 32 ones which contain meta data
            for (var area_nr uint = 32; area_nr < 2048; area_nr++) {
                // If the area is not the beginning of an area, continue
                if (block.area[area_nr >> 1] & <byte>(4 << ((area_nr & 1) << 2)) == 0) {
                    continue
                }
                if (block.area[area_nr >> 1] & <byte>(3 << ((area_nr & 1) << 2)) != <byte>gcEpoch) {
                    free_intern(block, area_nr)
                }
            }
        } else if (flags & 3 == 0) {
            if (latestFreeBlock_nr == 0) {
                latestFreeBlock_nr = block_nr
            }
        } else if (flags & 3 != <byte>gcEpoch) {
            // The block has not been marked. In every case, mark it as being free
            root.blocks[block_nr >> 1] &^= <byte>(3 << ((block_nr & 1) << 2))
            // The block is the beginning of an allocated sequence of blocks?
            if (flags & 4 == 4) {
                if (latestFreeBlock_nr == 0) {
                    latestFreeBlock_nr = block_nr
                    freeBlocks(latestFreeBlock_nr)
                } else {
                    mergeAndFreeBlocks(latestFreeBlock_nr, block_nr << 16)
                }
            }
        }
    }
}

func mark(ptr #void) {
    var block_nr = <uint>ptr >> 16
    // Pointing to static data? -> Do nothing
    if (block_nr < heapStartBlockNr) {
        return
    }
    var flags = root.blocks[block_nr >> 1] & <byte>15 << ((block_nr & 1) << 2)
    // The block already has the right gc epoch? -> Do nothing
    if (flags & 3 == <byte>gcEpoch) {
        return
    }
    // The block is subject to area allocation?
    if (flags & 3 == 3) {
        markArea(<#Block>(block_nr << 16), <uint>(ptr & 0xffff) >> 5)
    } else if (flags & 3 != 0) {
        markBlocks(block_nr)
    }
}

func markArea(block #Block, area_nr uint) {
    // Determine the start of the area by clearing bits of area_nr starting with the least significant bit
    for(var i uint = 0; i < 11; i++) {
        // Not the beginning of a block? -> the area must be larger
        if (block.area[area_nr >> 1] & <byte>(4 << ((area_nr & 1) << 2)) == 0) {
            area_nr &^= 1 << i
            continue
        }
        var flags = block.area[area_nr >> 1] & <byte>15 << ((area_nr & 1) << 2)
        // The area is already marked?
        if (flags & 3 == <byte>gcEpoch) {
            return
        }
        // Switch the gcEpoch
        block.area[area_nr >> 1] ^= <byte>3 << ((area_nr & 1) << 2)
        (<#BlockWithMetaData>block).markedAreas++
        // Need to follow pointers inside the area?
        if (flags & 8 == 8) {
            traverseHeap(<uint>block + area_nr << 5)
        }
        return
    }
    // TODO: throw Implementation error
}

func markBlocks(block_nr uint) {
    // Find the beginning of the sequence of blocks
    for (; block_nr >= heapStartBlockNr; block_nr--) {
        var flags = root.blocks[block_nr >> 1] & <byte>15 << ((block_nr & 1) << 2)
        if (flags & 4 == 4) {
            // Switch the gc epoch by toggling both bits
            root.blocks[block_nr >> 1] ^= <byte>3 << ((block_nr & 1) << 2)
            if (flags & 8 == 8) {
                // Traverse the type map
                traverseHeap(block_nr << 16)
            }
            return
        } else if (flags & 3 == <byte>gcEpoch) {
            // The sequence of blocks has already been marked. Nothing to do here
            return
        } else {
            // Mark the block as being treated in the current gcEpoch
            root.blocks[block_nr >> 1] |= <byte>gcEpoch << ((block_nr & 1) << 2)
        }
    }
}

func traverseHeap(ptr #void) {
    var elementCount uint = 1
    var iptr #int = <uint>ptr
    if (*iptr > 0) {
        var typemap #int = <uint>*iptr
        traverseType(<uint>iptr + 4, typemap)
        return
    }

    elementCount = <uint>(-*iptr)
    iptr++
    var typemap #int = <uint>*iptr
    var size uint = <uint>*typemap
    iptr++
    var data #uint = <uint>iptr
    // Now inspect all elements according to the type map
    for(var i uint = 0; i < elementCount; i++) {
        traverseType(data, typemap)
        data += size
    }
}

func traverseType(ptr #uint, typemap #int) {
    // The second entry in typemap tells how many entries the typemap has
    var entries_end = typemap[1] + 2
    // Iterate over all entries in the typemap
    for(var i = 2; i < entries_end; i++) {
        var a = typemap[i]
        if (a < 0) {
            var count = -a
            i++
            var b = typemap[i]
            if (b < 0) {
                var typemap2 #int = <uint>-b
                i++
                var ptr2 #uint = <uint>ptr + <uint>typemap[i]
                var size uint = <uint>*typemap2 
                for(var k = 0; k < count; k++) {
                    traverseType(<uint>ptr2, typemap2)
                    ptr2 += size
                }
            } else {
                var ptr2 #uint = <uint>ptr + <uint>b
                for(var k = 0; k < count; k++) {
                    mark(ptr2)
                    ptr2 += 4
                }
            }
        } else {
            mark(<uint>ptr + <uint>a)
        }
    }
}

func copy(dest #byte, src #byte, count int) {
    for(count--; count >= 0; count--) {
        dest[count] = src[count]
    }
}

func string_concat(str1 string, str2 string) string {
    var s1 = *<#uint>str1
    var s2 = *<#uint>str2
    var p #void = alloc(4 + s1 + s2, 1, 0)
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
    var p #byte = <#byte>alloc(4 + length, 1, 0)
    *<#uint>p = length
    var dest = p + 4
    for(var i uint = 0; i < length; i++) {
        dest[i] = src[i]
    }
    return <string>p
}