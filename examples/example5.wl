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

func demoVector() {
    var vec [3]int
    vec[0] = 1
    vec[1] = 2
}