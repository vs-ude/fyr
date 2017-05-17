func strFunc(x byte, y int) {
//    var str string
    var str2 = "Hallo"
    x = str2[3]
    var arr []int
    y = arr[4]
//    1
//    str[2]
    y = add(y, 2)
    y %= 2
    for( y < 10 ) {
        y--
        if (y > 100) {
            continue
        } else {
            y = 100
        }
        break
    }
    for(var i = 0; i < y; i++) {
        arr[0] = i
    }
    var ptr #int = 0
    *ptr = 42
    y = *ptr
}

func add(a int, b int) int {
    return a + b
}