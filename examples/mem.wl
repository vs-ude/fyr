import {
    func logNumber(int)
} from "imports"

type Block struct {
    free  [11]#Free  // 11 * 4 = 44 Bytes
    fill  [20]byte   // 20 byte fill
    align [256]byte // 2048 Bits = 256 Bytes
    mark  [512]byte  // 2*2048 Bits = 512 Bytes
    data  [65536 - 44 - 256 - 512]byte
}

type Free struct {
    next #Free
}

func initializeBlock(b #Block) {
    for(var i = 0; i < 5; i++) {
        b.free[i] = 0
    }
    for(var i uint = 5; i < 11; i++) {
        b.free[i] = 1 << (5 + i) + (uint)b
        b.free[i].next = 0
    }
    var ptr #uint64 = (#uint64)(&b.align)
    for(var i = 0; i < (256 + 512)/8; i++) {
        *ptr = 0
        ptr++
    }
}

func allocInBlock(b #Block, size int) #void {
    return (#void)b
}

func freeInBlock(b #Block, ptr #void) {

}