import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

func hashString(ptr #byte) uint64 {
    if (ptr == null) {
        return 1
    }
    var len = *<#uint>ptr
    ptr += 4
    var result uint64 = <uint64>len
    for(var i uint = 0; i < len; i++) {
        result = 31 * result + <uint64>ptr[i]
    }
    if (result == 0) {
        return 1
    }
    return result
}

type MapHead struct {
    nextHead *MapHead
    size int
    free int
    freeList #MapEntry
}

type MapEntry struct {
    // A value of null means end of list
    hashNext #MapEntry
    // A value of null means end of list
    listNext #MapEntry
    hash uint64
    key uint32
    value uint32
}

func createMap(headTypeMap #int, count int, entryTypeMap #int) *MapHead {
    var entrySize = <uint>*entryTypeMap << 2
    var headSize = <uint>*headTypeMap << 2
    var h = <#MapHead>alloc(<uint>count, entrySize, entryTypeMap, headSize, headTypeMap)
    var m = <#MapEntry>(h + 1)
    h.size = count
    h.free = count
    h.freeList = m
    for(var i = 1; i < count; i++) {
        var m2 = <#MapEntry>(<#void>m + entrySize)
        m.listNext = m2
        m = m2
    }
    m.listNext = null
    return h
}

func setMap(head *MapHead, hash uint64, keyType int32, tuplePtr *void, tupleSize uint) {
    var h #MapHead = head
    if (h == null) {
        // TODO throw
    } else if (h.nextHead != null) {
        h = h.nextHead
    }
    var m = <#MapEntry>(h + 1)
    // Lookup the key. If it already exists, overwrite it
    var tuple #void = lookupMap(h, hash, keyType, tuplePtr)

    // An entry with this key does currently not exist? Create a new entry
    if (tuple == null) {
        // Determine the size of the table
        var iptr #int = <#int>h - 1
        var entryTypeMap #int = -*(iptr - 1)
        var entrySize = <uint>*entryTypeMap << 2

        // No space left? Resize the table
        if (h.free == 0) {
            var headTypeMap #int = -*iptr
            var head2 = createMap(headTypeMap, h.size * 2, entryTypeMap)
            var h2 #MapHead = head2
            var m2 = <#void>(h2 + 1)
            for(var mh = h; mh != null; mh = mh.nextHead) {
                var oldEntry = <#MapEntry>(mh + 1)
                for(var i = 0; i < mh.size; i++) {
                    var index = <uint>(oldEntry.hash % <uint64>h2.size)
                    var newEntry = <#MapEntry>(m2 + index * entrySize)
                    oldEntry.listNext = newEntry.hashNext
                    newEntry.hashNext = oldEntry
                    oldEntry = <#void>oldEntry + entrySize
                }
            }
            h2.nextHead = h.nextHead
            h.nextHead = h2
            head = head2
            h = h2
            m = m2
        }

        // Get a free entry and fill it
        var p = h.freeList
        h.freeList = p.listNext
        p.hash = hash
        // The default location for this hash
        var index = <uint>(hash % <uint64>h.size)
        var p2 = <#MapEntry>(<#void>m + index * entrySize)
        p.listNext = p2.hashNext
        p2.hashNext = p
        h.free--
        tuple = &p.key
    }
    copy(tuple, tuplePtr, tupleSize)
}

// We use unsafe pointers here because it is faster and we know that lookup does not cause any allocations
func lookupMap(h #MapHead, hash uint64, keyType int32, tupleKeyPtr #void) #void {
    if (h == null) {
        return null
    } else if (h.nextHead != null) {
        h = h.nextHead
    }
    var iptr #int = <#int>h - 2
    var entryTypeMap #int = -*iptr
    var m = <#void>(h + 1)
    var entrySize = <uint>*entryTypeMap << 2
    // Iterate over the list at this hash position
    for (var p = (<#MapEntry>(m + <uint>(hash % <uint64>h.size) * entrySize)).hashNext; p != null; p = p.listNext) {
        if (p.hash == hash && compareMapKey(p, keyType, tupleKeyPtr)) {
            return &p.key
        }
    }
    
    return null
}

// We use unsafe pointers here because it is faster and we know that compare does not cause any allocations
func compareMapKey(p #MapEntry, keyType int32, tupleKeyPtr #void) bool {
    if (keyType == 1) {
        return compareString(<string>tupleKeyPtr, <string><#void>p.key) == 0
    } else if (keyType == 2) {
        return *<#uint32>p.key == *<#uint32>tupleKeyPtr
    } else if (keyType == 3) {
        return *<#uint64>&p.key == *<#uint64>tupleKeyPtr
    } else if (keyType == 4) {
        return *<#float>&p.key == *<#float>tupleKeyPtr
    } else if (keyType == 5) {
        return *<#double>&p.key == *<#double>tupleKeyPtr
    } else {
        // TODO: Throw
    }
    return false;
}

// We use unsafe pointers here because they are faster and remove does not perform any allocations
func removeMapKey(h #MapHead, hash uint64, keyType int32, tupleKeyPtr #void) bool {
    if (h == null) {
        return false
    } else if (h.nextHead != null) {
        h = h.nextHead
    }
    var iptr #int = <#int>h - 1
    var entryTypeMap #int = -*(iptr - 1)
    var entrySize = <uint>*entryTypeMap << 2
    var m = <#MapEntry>(h + 1)
    var prev #MapEntry
    // Iterate over the list at this hash position
    for (var p = (<#MapEntry>(m + <uint>(hash % <uint64>h.size) * entrySize)).hashNext; p != null; p = p.listNext) {
        if (p.hash == hash && compareMapKey(p, keyType, tupleKeyPtr)) {
            if (prev != null) {
                prev.listNext = p.listNext
            } else {
                (<#MapEntry>(<#void>m + <uint>(hash % <uint64>h.size) * <uint>*entryTypeMap)).hashNext = p.listNext
            }
            p.hash = 0
            p.listNext = h.freeList
            h.freeList = p
            h.free++
            return true
        }
    }
    return false
}
