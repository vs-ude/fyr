import {
    func logNumber(int)
} from "imports"

type Point struct {
    x int
    y int
}

type Rect struct {
    p1 Point
    p2 Point
}

func demoPoint(x int, y int) *Point {
    var r Point
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

func demoObjectLiteral() Point {
    var r Point = {x: 42, y: 333}
    return r
}

func demoObjectLiteral2() Point {
    return {x: 42, y: 333}
}

func demoObjectLiteral3() Point {
    return {y: 333}
}

func demoObjectLiteral4() *Point {
    var r *Point = &{x: 42, y: 333}
    return r
}

func demoObjectLiteral5() *Rect {
    return &{p1: {x: 555, y: 666}, p2: {x: 777, y: 888}}
}

func demoObjectLiteral6() *Rect {
    return &{p2: {x: 777, y: 888}}
}

type Dummy struct {
    x int
    y int
}

func demoObjectLiteral7() *Point | *Dummy {
    return &{x: 42, y:33}
}