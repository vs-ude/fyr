import {
    func logNumber(int)
} from "imports"

type Block struct {
    free [11]#Free  // 11 * 4 = 44 Bytes
    align [256]byte // 2048 Bits = 256 Bytes
    mark [512]byte  // 2*2048 Bits = 512 Bytes
    data [65536 - 44 - 256 - 512]byte
}

type Free struct {
    next #Free
}

func initializeBlock(b #Block) {
    for(var i = 0; i < 5; i++) {
        b.free[i] = 0
    }
    for(var i = 5; i < 11; i++) {
        b.free[i] = 1 << (5 + i)
    }
}

func allocInBlock(b #Block, size int) #void {
    return 0
}

func freeInBlock(b #Block, ptr #void) {

}