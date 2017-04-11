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
    return x == 5 || x < 5
}