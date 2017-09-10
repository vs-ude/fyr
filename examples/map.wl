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

func createMapEntry(head #MapHead, hash uint64) #MapEntry {
    var h #MapHead = head
    if (h == null) {
        // TODO throw
    } else if (h.nextHead != null) {
        h = h.nextHead
    }

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
    }

    // Get a free entry and fill it
    var p = h.freeList
    h.freeList = p.listNext
    p.hash = hash
    // The default location for this hash
    var index = <uint>(hash % <uint64>h.size)
    var p2 = <#MapEntry>(<#void>(h + 1) + index * entrySize)
    p.listNext = p2.hashNext
    p2.hashNext = p
    h.free--
    return p
}

type StringMapEntry struct {
    extends MapEntry
    key string
    value byte
}

func setMap(head *MapHead, key string) #void {
    // Lookup the key. If it already exists, overwrite it
    var valuePtr #void = lookupMap(head, <#void>key)

    if (valuePtr != null) {
        return valuePtr
    }

    // An entry with this key does currently not exist? Create a new entry
    // Compute the hash for the string
    var hash = hashString(<#void>key)
    var p = <#StringMapEntry>createMapEntry(head, hash)
    p.key = key
    return &p.value
}

// We use unsafe pointers here because it is faster and we know that lookup does not cause any allocations
func lookupMap(h #MapHead, key #void) #void {
    if (h == null) {
        return null
    } else if (h.nextHead != null) {
        h = h.nextHead
    }
    var hash = hashString(key)
    var iptr #int = <#int>h - 2
    var entryTypeMap #int = -*iptr
    var m = <#void>(h + 1)
    var entrySize = <uint>*entryTypeMap << 2
    // Iterate over the list at this hash position
    for (var p = <#StringMapEntry>((<#MapEntry>(m + <uint>(hash % <uint64>h.size) * entrySize)).hashNext); p != null; p = <#StringMapEntry>p.listNext) {
        if (p.hash == hash && p.key == <string>key) {
            return &p.value
        }
    }
    return null
}

// We use unsafe pointers here because they are faster and remove does not perform any allocations
func removeMapKey(h #MapHead, key #void) bool {
    if (h == null) {
        return false
    } else if (h.nextHead != null) {
        h = h.nextHead
    }
    var hash = hashString(key)
    var iptr #int = <#int>h - 1
    var entryTypeMap #int = -*(iptr - 1)
    var entrySize = <uint>*entryTypeMap << 2
    var m = <#void>(h + 1)
    var prev #StringMapEntry
    // Iterate over the list at this hash position
    for (var p = <#StringMapEntry>((<#MapEntry>(m + <uint>(hash % <uint64>h.size) * entrySize)).hashNext); p != null; p = <#StringMapEntry>p.listNext) {
        if (p.hash == hash && p.key == <string>key) {
            if (prev != null) {
                prev.listNext = p.listNext
            } else {
                (<#StringMapEntry>(m + <uint>(hash % <uint64>h.size) * <uint>*entryTypeMap)).hashNext = p.listNext
            }
            p.hash = 0
            p.listNext = h.freeList
            h.freeList = <#MapEntry>p
            h.free++
            return true
        }
        prev = p
    }
    return false
}

type NumericMapEntry struct {
    extends MapEntry
    value byte
}

func setNumericMap(head *MapHead, key uint64) #void {
    // Lookup the key. If it already exists, overwrite it
    var valuePtr #void = lookupNumericMap(head, key)

    if (valuePtr != null) {
        return valuePtr
    }

    // An entry with this key does currently not exist? Create a new entry
    var p = <#NumericMapEntry>createMapEntry(head, key)
    return &p.value
}

// We use unsafe pointers here because it is faster and we know that lookup does not cause any allocations
func lookupNumericMap(h #MapHead, key uint64) #void {
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
    for (var p = <#NumericMapEntry>((<#MapEntry>(m + <uint>(key % <uint64>h.size) * entrySize)).hashNext); p != null; p = <#NumericMapEntry>p.listNext) {
        if (p.hash == key) {
            return &p.value
        }
    }
    return null
}

// We use unsafe pointers here because they are faster and remove does not perform any allocations
func removeNumericMapKey(h #MapHead, key uint64) bool {
    if (h == null) {
        return false
    } else if (h.nextHead != null) {
        h = h.nextHead
    }
    var iptr #int = <#int>h - 1
    var entryTypeMap #int = -*(iptr - 1)
    var entrySize = <uint>*entryTypeMap << 2
    var m = <#void>(h + 1)
    var prev #NumericMapEntry
    // Iterate over the list at this hash position
    for (var p = <#NumericMapEntry>((<#MapEntry>(m + <uint>(key % <uint64>h.size) * entrySize)).hashNext); p != null; p = <#NumericMapEntry>p.listNext) {
        if (p.hash == key) {
            logString("Found key")
            logNumber(<uint>key)
            if (prev != null) {
                prev.listNext = p.listNext
            } else {
                (<#NumericMapEntry>(m + <uint>(key % <uint64>h.size) * <uint>*entryTypeMap)).hashNext = p.listNext
            }
            p.hash = 0
            p.listNext = h.freeList
            h.freeList = <#MapEntry>p
            h.free++
            return true
        }
        prev = p
    }
    return false
}
