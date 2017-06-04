import {
    func logNumber(int)
} from "imports"

type RootBlock struct {
    free  [11]#Free  // 11 * 4 = 44 Bytes
}

type Block struct {
    align [256]byte  // 1*2048 Bits
    mark  [512]byte  // 2*2048 Bits = 512 Bytes
    data  [65536 - 256 - 512]byte
}

type Free struct {
    next #Free
}

func initializeRootBlock(r #RootBlock) {
    for(var i = 0; i < 11; i++) {
        r.free[i] = 0
    }
}

func initializeBlock(r #RootBlock, b #Block) {
    for(var i uint = 5; i < 11; i++) {
        var f #Free = 1 << (5 + i) + (uint)b
        f.next = r.free[i]
        r.free[i] = f
    }
    var ptr #uint64 = (#uint64)(&b.align)
    for(var i = 0; i < (256 + 512)/8; i++) {
        *ptr = 0
        ptr++
    }
}

func split(r #RootBlock, f #Free, index uint) {
    index--
    var f2 #Free = (uint)f + (1 << index)
    f2.next = r.free[index]
    r.free[index] = f2
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
        // Get a block
        var f = r.free[index]
        if (f == 0) {
            continue
        }
        r.free[index] = f.next
        for (; index > targetIndex; index--) {
            split(r, f, index)
        }

        // Fill with zeros
        var ptr #uint64 = (#uint64)f
        for(var i = 0; i < size/4; i++) {
            *ptr = 0
            ptr++
        }

        // Set alignment
        var block #Block = (uint)f &^ 0xffff
        var block_nr = ((uint)f & 0xffff) >> 5
        block.align[block_nr >> 3] |= (byte)(1 << (block_nr & 7))

        return (#void)f
    }

    // Nothing free
    // TODO: Add one more block and allocate again
    return alloc(r, size)
}

func freeInBlock(b #Block, ptr #void) {

}