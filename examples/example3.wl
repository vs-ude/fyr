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

func fibonacci(count int, a int, b int) int {
    if (count == 0) {
        return b;
    }
    return fibonacci(count - 1, b, a + b)
}
