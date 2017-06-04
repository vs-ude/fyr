import {
    func logNumber(int)
} from "imports"

type RootBlock struct {
    // Pointers to free blocks of size 1 << (5 + i).
    free  [11]#Free  // 11 * 4 = 44 Bytes
}

type Block struct {
    // One bit per block. If 1, the block is the beginning of an allocated area.
    area [256]byte  // 1*2048 Bits
    // Two bits to indicate the epoch when the block has been marked during mark & sweep.
    mark  [512]byte  // 2*2048 Bits = 512 Bytes
    data  [65536 - 256 - 512]byte
}

type Free struct {
    next #Free
    prev #Free
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
    for(var i uint = 5; i < 11; i++) {
        var f #Free = 1 << (5 + i) + (uint)b
        f.next = r.free[i]
        f.prev = 0
        if (f.next != 0) {
            f.next.prev = f
        }
        r.free[i] = f
        var block_nr = 1 << i
        b.area[block_nr >> 3] |= (byte)(1 << (block_nr & 7))
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
    var block #Block = (uint)f &^ 0xffff
    var block_nr = ((uint)f & 0xffff) >> 5
    block.area[block_nr >> 3] |= (byte)(1 << (block_nr & 7))
}

func alloc(r #RootBlock, size int) #void {
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
        // Split the block if it is too large
        for (; index > targetIndex; index--) {
            split(r, f, index)
        }

        // Fill with zeros
        var ptr #uint64 = (#uint64)f
        var iterations = (size + 7)/8
        for(var i = 0; i < iterations; i++) {
            *ptr = 0
            ptr++
        }

        return (#void)f
    }

    // Nothing free
    // TODO: Add one more block and allocate again
    return alloc(r, size)
}

func freeInBlock(r #RootBlock, block #Block, ptr #void) {
    // Compute start of block
    var block_nr = ((uint)ptr & 0xffff) >> 5
    for(var i uint = 0; i < 11; i++) {
        if (block.area[block_nr >> 3] & (byte)(1 << (block_nr & 7)) == 1) {
            // Determine the size as a power of two
            var index uint = 0
            for (var next_block_nr = block_nr + 1; next_block_nr < 2048; next_block_nr = block_nr + 1 << index) {
                if (block.area[next_block_nr >> 3] & (byte)(1 << (next_block_nr & 7)) == 1) {
                    break
                }
                index++
            }
            // TODO: Find the buddy

            // Add the area to the free list
            var f #Free = (uint)block + block_nr << 5
            f.next = r.free[index]
            f.prev = 0
            if (f.next != 0) {
                f.next.prev = f
            }
            r.free[index] = f
            return
        }
        block_nr &^= 1 << i
    }
    // TODO: throw
}