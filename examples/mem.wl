import {
    func logNumber(int)
} from "imports"

type RootBlock struct {
    // Pointers to free blocks of size 1 << (5 + i).
    free  [11]#Free  // 11 * 4 = 44 Bytes
}

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

type Free struct {
    next #Free
    prev #Free
    size uint
}

func initializeRootBlock(r #RootBlock) {
    for(var i = 0; i < 11; i++) {
        r.free[i] = 0
    }
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
        var f #Free = 1 << (5 + i) + (uint)b
        f.next = r.free[i]
        f.prev = 0
        f.size = 1 << (5 + i)
        if (f.next != 0) {
            f.next.prev = f
        }
        r.free[i] = f
        var area_nr = 1 << i
        logNumber((int)f)
        b.area[area_nr >> 3] |= (byte)(1 << (area_nr & 7))
    }
}

func split(r #RootBlock, f #Free, index uint) {
    index--
    // Split the free area and add the upper half to the free-list
    var f2 #Free = (uint)f + (1 << (index + 5))
    f2.next = r.free[index]
    f2.prev = 0
    if (f2.next != 0) {
        f2.next.prev = f2
    }
    r.free[index] = f2
    // Mark the the new free area as the beginning of an area
    var block #Block = (uint)f2 &^ 0xffff
    var area_nr = ((uint)f2 & 0xffff) >> 5
    block.area[area_nr >> 3] |= (byte)(1 << (area_nr & 7))
}

// epoch is either 1 (binary 01) or 2 (binary 10) to indicate the current GC epoch.
// epoch is 11 if alloc is supposed to allocate memory for a stack.
func alloc(r #RootBlock, size uint, epoch uint) #void {
    // Determine the granularity
    var index uint
    if (size > 1<<15) {             // Needs entire blocks
        // TODO: allocate a sequence of blocks
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
        var f = r.free[index]
        if (f == 0) {
            continue
        }
        r.free[index] = f.next
        if (f.next != 0) {
            f.next.prev = 0
        }
        logNumber((int)index)
        logNumber((int)targetIndex)
        logNumber((int)f)
        // Split the area if it is too large
        for (; index > targetIndex; index--) {
            logNumber(-1)
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

    // Nothing free
    // TODO: Add one more block and allocate again
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
            var f #Free = (uint)block + area_nr << 5

            // Try to merge with a buddy, but only up to a size of 16k. 32k areas are not merged, because each block has only one
            for(; index < 10; index++) {
                // Find the buddy by flipping one bit
                var buddy_area_nr = area_nr ^ (1 << index)
                // Is the buddy in use? Then do nothing
                if (block.mark[buddy_area_nr >> 2] & (byte)(3 << ((buddy_area_nr & 3) << 1)) != 0) {
                    break
                }
                // Remove the buddy from the free list
                var f_buddy #Free = (uint)block + buddy_area_nr << 5
                if (f_buddy.next != 0) {
                    f_buddy.next.prev = f_buddy.prev
                }
                if (f_buddy.prev != 0) {
                    f_buddy.prev.next = f_buddy.next
                } else {
                    r.free[index] = f_buddy.next
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
            f.next = r.free[index]
            f.prev = 0
            if (f.next != 0) {
                f.next.prev = f
            }
            r.free[index] = f

            return
        }
        area_nr &^= 1 << i
    }
    // TODO: throw
}