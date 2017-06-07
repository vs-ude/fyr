import {
    func logNumber(int)
} from "imports"

type RootBlock struct {
    // Pointers to free areas of size 1 << (5 + i).
    freeAreas  [11]#FreeArea  // 11 * 4 = 44 Bytes
    dummy int32               // Alignment
    // Pointers to free block sequences of "(1 << i) <= count < (1 << (i+1))" blocks.
    // The largest allocatable size is 2GB
    freeBlocks [15]#FreeBlock // 15 * 4 Bytes = 60 Bytes
    dummy2 int32              // Alignment
    blocks [8192]byte         // 65536 * 1 Bit = 8192 Bytes
}

type FreeBlock struct {
    next #FreeBlock  // Pointer to the next sequence of free blocks
    prev #FreeBlock  // Pointer to the prev sequence of free blocks
    start #FreeBlock // Pointer to the first free block in this sequence. Only set on the last block of the sequence
    count uint // Number of free blocks in the sequence
}

// Blocks are 64KB large and split into smaller areas.
type Block struct {
    // One bit per block. If 1, the block is the beginning of an area.
    // Areas are split (if necessary) upon allocation, and rejoined upon free.
    area [256]byte  // 1*2048 Bits
    // Two bits to indicate the epoch when the block has been marked during mark & sweep.
    // These bits are only meaningful if the block is the beginning or an area.
    // 11 means allocated for use in a stack.
    // 01 means allocated in GC epoch 1.
    // 10 means allocated in GC epoch 2.
    // 00 means free
    mark  [512]byte  // 2*2048 Bits = 512 Bytes
    data  [65536 - 256 - 512]byte
}

type FreeArea struct {
    next #FreeArea
    prev #FreeArea
    size uint
}

// The RootBlock must not cross a 64K boundary.
// blockCount is the number of free blocks, not including the root block.
func initializeRootBlock(r #RootBlock, blockCount uint) {
    for(var i = 0; i < 11; i++) {
        r.freeAreas[i] = 0
    }
    // All blocks are free, except the first one which is initialized for area allocation
    var b #FreeBlock = ((uint)r &^ 0xffff) + 2*(1 << 16)
    b.count = blockCount - 1
    for(var i uint = 0; i < 15; i++) {
        if (1 << i <= blockCount && blockCount < 1 << (i+1)) {
            r.freeBlocks[i] = b
        } else {
            r.freeBlocks[i] = 0
        }
    }
    // Initialize the first block
    b = ((uint)r &^ 0xffff) + (1 << 16)
    initializeBlock(r, (#Block)b)
}

func initializeBlock(r #RootBlock, b #Block) {
    // Initialize the arrays 'area' and 'mark' with zero 
    var ptr #uint64 = (#uint64)(&b.area)
    for(var i = 0; i < (256 + 512)/8; i++) {
        *ptr = 0
        ptr++
    }
    // Mark the first 1024 byte area as in-use.
    b.mark[0] = 3
    for(var i uint = 5; i < 11; i++) {
        var f #FreeArea = 1 << (5 + i) + (uint)b
        f.next = r.freeAreas[i]
        f.prev = 0
        f.size = 1 << (5 + i)
        if (f.next != 0) {
            f.next.prev = f
        }
        r.freeAreas[i] = f
        var area_nr = 1 << i
        b.area[area_nr >> 3] |= (byte)(1 << (area_nr & 7))
    }
}

func split(r #RootBlock, f #FreeArea, index uint) {
    index--
    // Split the free area and add the upper half to the free-list
    var f2 #FreeArea = (uint)f + (1 << (index + 5))
    f2.next = r.freeAreas[index]
    f2.prev = 0
    if (f2.next != 0) {
        f2.next.prev = f2
    }
    r.freeAreas[index] = f2
    // Mark the the new free area as the beginning of an area
    var block #Block = (uint)f2 &^ 0xffff
    var area_nr = ((uint)f2 & 0xffff) >> 5
    block.area[area_nr >> 3] |= (byte)(1 << (area_nr & 7))
}

func allocBlocks(r #RootBlock, count uint) #void {
    // Compute the block-count as a power of two
    var index uint = 14
    for(; index >= 0; index--) {
        if (1 << index <= count) {
            break
        }
    }
    // Find a sequence of blocks that is large enough
    for(; index < 15; index++) {
        if (r.freeBlocks[index] != 0) {
            break
        }
    }
    // TODO: panic if index == 15 -> out of memory
    var f #FreeBlock = r.freeBlocks[index]
    if (f.count == count) {
        // Use all of the blocks in this sequence.
        // Remove this sequence from the free list.
        if (f.prev == 0) {
            r.freeBlocks[index] = f.next
        } else {
            f.prev.next = f.next
        }
        if (f.next != 0) {
            f.next.prev = f.prev
        }
    } else {
        // Split
        var f2 = f
        f2.count -= count
        var f3 #FreeBlock = (uint)f2 + (1 << 16) * (f2.count - 1)
        f3.start = f2
        f = (uint)f + (1 << 16) * f2.count
        // Compute the remaining size as a power of two
        var index2 uint = 14
        for(; index2 >= 0; index2--) {
            if (1 << index2 <= f2.count) {
                break
            }
        }
        // Insert the remaining sequence of free blocks in another queue
        if (index2 != index) {
            if (f.prev == 0) {
                r.freeBlocks[index] = f.next
            } else {
                f.prev.next = f.next
            }
            if (f.next != 0) {
                f.next.prev = f.prev
            }
            f2.prev = 0
            f2.next = r.freeBlocks[index2]
            if (f2.next != 0) {
                f2.next.prev = f2
            }
            r.freeBlocks[index2] = f2
        }
    }
    // Mark the blocks as allocated
    var block_nr = ((uint)f - (uint)r) >> 16 - 1 
    for(var i uint = block_nr; i < block_nr + count; i++) {
        r.blocks[i >> 3] |= (byte)(1 << (i & 7))
    }
    return (#void)f
}

// epoch is either 1 (binary 01) or 2 (binary 10) to indicate the current GC epoch.
// epoch is 11 if alloc is supposed to allocate memory for a stack.
func alloc(r #RootBlock, size uint, epoch uint) #void {
    // Determine the granularity
    var index uint
    if (size > 1<<15) {             // Needs entire blocks
        // allocate a sequence of blocks
        return allocBlocks(r, (size + 0xffff) / (1<<16)) 
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
        var f = r.freeAreas[index]
        if (f == 0) {
            continue
        }
        r.freeAreas[index] = f.next
        if (f.next != 0) {
            f.next.prev = 0
        }
        // Split the area if it is too large
        for (; index > targetIndex; index--) {
            split(r, f, index)
        }

        // Mark the area as allocated in a certain epoch
        var block #Block = (uint)f &^ 0xffff
        var area_nr = ((uint)f & 0xffff) >> 5
        block.mark[area_nr >> 2] |= (byte)(epoch << ((area_nr & 3) << 1))

        // Fill with zeros
        var ptr #uint64 = (#uint64)f
        var iterations = (size + 7)/8
        for(var i uint = 0; i < iterations; i++) {
            *ptr = 0
            ptr++
        }

        return (#void)f
    }

    // Nothing free. Add one more block and allocate again
    initializeBlock(r, (#Block)allocBlocks(r, 1))
    return alloc(r, size, epoch)
}

func free(r #RootBlock, ptr #void) {
    // Compute start of block
    var block #Block = (uint)ptr &^ 0xffff
    var area_nr = ((uint)ptr & 0xffff) >> 5
    for(var i uint = 0; i < 11; i++) {
        if (block.area[area_nr >> 3] & (byte)(1 << (area_nr & 7)) == 1) {
            // Determine the size as a power of two
            var index uint = 0
            for (var next_area_nr = area_nr + 1; next_area_nr < 2048; next_area_nr = area_nr + 1 << index) {
                if (block.area[next_area_nr >> 3] & (byte)(1 << (next_area_nr & 7)) == 1) {
                    break
                }
                index++
            }
            // Mark the block as free by setting the mark bits to 00
            block.mark[area_nr >> 2] &^= (byte)(3 << ((area_nr & 3) << 1))

            // Comnpute the address of the free area
            var f #FreeArea = (uint)block + area_nr << 5

            // Try to merge with a buddy, but only up to a size of 16k. 32k areas are not merged, because each block has only one
            for(; index < 10; index++) {
                // Find the buddy by flipping one bit
                var buddy_area_nr = area_nr ^ (1 << index)
                // Is the buddy in use? Then do nothing
                if (block.mark[buddy_area_nr >> 2] & (byte)(3 << ((buddy_area_nr & 3) << 1)) != 0) {
                    break
                }
                // Remove the buddy from the free list
                var f_buddy #FreeArea = (uint)block + buddy_area_nr << 5
                if (f_buddy.next != 0) {
                    f_buddy.next.prev = f_buddy.prev
                }
                if (f_buddy.prev != 0) {
                    f_buddy.prev.next = f_buddy.next
                } else {
                    r.freeAreas[index] = f_buddy.next
                }
                // Take the area with the smaller area_nr
                if (buddy_area_nr < area_nr) {
                    block.area[area_nr >> 3] &^= (byte)(1 << (area_nr & 7))
                    area_nr = buddy_area_nr
                    f = f_buddy
                } else {
                    block.area[buddy_area_nr >> 3] &^= (byte)(1 << (buddy_area_nr & 7))                    
                }
            }

            // Add the area to the free list
            f.next = r.freeAreas[index]
            f.prev = 0
            if (f.next != 0) {
                f.next.prev = f
            }
            r.freeAreas[index] = f

            return
        }
        area_nr &^= 1 << i
    }
    // TODO: throw
}