func demo() int {
    var x = 5
    if (x >= 5) {
        x = 10
    } else {
        x = 4
    }
    if (var y = 10; x == y) {
        x = 1
    }
    return fibonacci(6, 0, 1)
}

func demo2() int {
    var sum = 0
    for (var x = 1; x < 10; x++) {
        sum += x
    }
    return sum
}

func demo3() int {
    var sum = 0
    for (var x = 1; ; x++) {
        if (x == 10) {
            break
        }
        sum += x
    }
    return sum
}

func demo4() byte {
    var ptr #byte = 0
    for(var x = 0; x < 10; x++) {
        *ptr = 3
        ptr++
    }
    ptr = 0
    var b byte = 0
    for(var x = 0; x < 10; x++) {
        b += *ptr
        ptr++
    }
    return b
}

func demo5() int16 {
    var ptr #int16 = 0
    for(var x = 0; x < 10; x++) {
        ptr[x] = 4
    }
    ptr = 0
    var b int16 = 0
    for(var x = 0; x < 10; x++) {
        b += ptr[x]
    }
    return b
}

func fibonacci(count int, a int, b int) int {
    if (count == 0) {
        return b;
    }
    return fibonacci(count - 1, b, a + b)
}
