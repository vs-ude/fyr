import {
    func logNumber(int)
} from "imports"

type Rect struct {
    x int
    y int
}

func demoRect(x int, y int) *Rect {
    var r Rect
    r.x = x
    r.y = y
    logNumber(r.y)
    return &r    
}

func demoVector() int {
    var vec [3]int
    vec[0] = 1
    vec[1] = 2
    return vec[0]
}

func demoSliceLiteral() int16 {
    var arr []int16 = [3, 5, 8]
    return arr[0]
}

func demoArrayLiteral() int16 {
    var arr [3]int16 = [3, 5, 8]
    return arr[0]
}

func demoTupleLiteral() (int16, string) {
    var tuple (int16, string) = (42, "Hallo!")
    return tuple
}

func demoString() byte {
    var str = "Hallo"
    return str[1]
}

func demoObjectLiteral() Rect {
    var r Rect = {x: 42, y: 333}
    return r
}

func demoObjectLiteral2() Rect {
    return {x: 42, y: 333}
}

//func demoObjectLiteral3() Rect {
//    return {y: 333}
//}

func demoObjectLiteral4() *Rect {
    var r *Rect = &{x: 42, y: 333}
    return r
}
