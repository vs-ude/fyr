func demo() bool {
    var x = 5
    if (x >= 5) {
        x = 10
    } else {
        x = 4
    }
    if (var y = 10; x == y) {
        x = 1
    }
    fibonacci(5, 0, 1)
    return x == 5 || x < 5
}

func fibonacci(count int, a int, b int) int {
    if (count == 0) {
        return b;
    }
    return fibonacci(count - 1, b, a + b)
}
