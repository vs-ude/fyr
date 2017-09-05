import . {
    func logString(string)
    func logNumber(uint)
} from "imports"

func hashString(str string) uint32 {
    var len = *<#uint>str
    var ptr #byte = <#byte>str + 4
    var result uint32 = 1
    for(var i uint = 0; i < len; i++) {
        result = 31 * result + <uint32>ptr[i]
    }
    return result
}

type MapHead struct {
    size uint
    used uint
    freeNext uint
}

type StringMapEntry struct {
    // A value of 0 means end of list
    hashNext uint
    // A value of 0 means end of list
    listNext uint
    hash uint
    key string
    value byte
}

func insertStringKey(m #StringMapEntry, key string, valuePtr #void, valueSize uint, typemap #int) #StringMapEntry {
    var h = <#MapHead>m
    var size uint
    var newSize uint
    // Allocate a map of null
    if (m == null) {
        newSize = 16
    } else if (h.used == h.size) {
        size = h.size
        newSize = size * 2
    } else {
        size = h.size
        newSize = h.size
    }
    // Allocate a new or larger map
    if (size != newSize) {
        var m2 = <#StringMapEntry>alloc(newSize + 1, 4 + 4 + valueSize, typemap)
        var h2 = <#MapHead>m2
        h2.size = newSize
        h2.used = h.used
        h2.freeNext = 1
        for(var i uint = 1; i < newSize; i++) {
            m2[i].listNext = i
        }
        m2[newSize].listNext = 0
    }
    // Hash the key. The hash must not be 1
    var hash = hashString(key)
    if (hash == 0) {
        hash = 1
    }
    for {
        // Get a free entry and fill it
        var freeIndex = h.freeNext
        h.freeNext = m[freeIndex].listNext        
        m[freeIndex].hash = hash
        m[freeIndex].key = key
//        copy(&m[freeIndex].value, valuePtr, valueSize)
        // The default location for this hash
        var index = hash % newSize + 1
        m[freeIndex].listNext = m[index].hashNext
        m[index].hashNext = freeIndex
        h.used++

        // Copy over the old map if required.
        if (size == 0) {
            return m
        }
        size--
        key = m[size].key
        hash = m[size].hash
        valuePtr = &m[size].value
    }
    return m
}

func lookupStringKey(m #StringMapEntry, key string) #void {
    if (m == null) {
        return null
    }
    var h = <#MapHead>m
    // Hash the key. The hash must not be 1
    var hash = hashString(key)
    if (hash == 0) {
        hash = 1
    }
    var index = m[hash % h.size + 1].hashNext
    for (index != 0) {
        if (m[index].hash == hash && m[index].key == key) {
            return &m[index].value
        }
        index = m[index].listNext
    }
    return null
}

func removeStringKey(m #StringMapEntry, key string) bool {
    if (m == null) {
        return false
    }
    var h = <#MapHead>m
    // Hash the key. The hash must not be 1
    var hash = hashString(key)
    if (hash == 0) {
        hash = 1
    }
    var prevIndex uint = 0
    var index = m[hash % h.size + 1].hashNext
    for (index != 0) {
        if (m[index].hash == hash && m[index].key == key) {
            if (prevIndex != 0) {
                m[prevIndex].listNext = m[index].listNext
            } else {
                m[hash % h.size + 1].hashNext = 0
            }
            m[index].hash = 0
            m[index].listNext = h.freeNext
            h.freeNext = index
            return true
        }
        index = m[index].listNext
    }
    return false
}
